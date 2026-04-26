import { subtitleStream, type SubtitleEvent } from './streaming/subtitleStream';

export type RecordingSafetyStopReason = 'hard_duration_cap' | 'long_silence';

export interface RecordingSafetyConfig {
  hardMaxMs: number;
  longSilenceMs: number;
  silenceGraceMs: number;
  checkIntervalMs: number;
  backpressureQueueDepth: number;
  backpressureOldestAgeMs: number;
  backpressureNotifyEveryMs: number;
}

export interface RecordingSafetyState {
  startedAtMs: number;
  lastSpeechAtMs: number;
  silenceGraceUntilMs: number | null;
  stopRequested: boolean;
}

export interface RecordingSafetyDecision {
  warnLongSilence: boolean;
  stopReason: RecordingSafetyStopReason | null;
  nextState: RecordingSafetyState;
}

const DEFAULT_CONFIG: RecordingSafetyConfig = {
  hardMaxMs: 4 * 60 * 60 * 1000,
  longSilenceMs: 30 * 60 * 1000,
  silenceGraceMs: 10 * 1000,
  checkIntervalMs: 30 * 1000,
  backpressureQueueDepth: 12,
  backpressureOldestAgeMs: 60 * 1000,
  backpressureNotifyEveryMs: 60 * 1000,
};

export function deriveRecordingSafetyDecision(
  state: RecordingSafetyState,
  nowMs: number,
  config: Pick<RecordingSafetyConfig, 'hardMaxMs' | 'longSilenceMs' | 'silenceGraceMs'>,
): RecordingSafetyDecision {
  if (state.stopRequested) {
    return { warnLongSilence: false, stopReason: null, nextState: state };
  }

  if (nowMs - state.startedAtMs >= config.hardMaxMs) {
    return {
      warnLongSilence: false,
      stopReason: 'hard_duration_cap',
      nextState: { ...state, stopRequested: true },
    };
  }

  const silenceMs = nowMs - state.lastSpeechAtMs;
  if (silenceMs < config.longSilenceMs) {
    return {
      warnLongSilence: false,
      stopReason: null,
      nextState: { ...state, silenceGraceUntilMs: null },
    };
  }

  if (state.silenceGraceUntilMs === null) {
    return {
      warnLongSilence: true,
      stopReason: null,
      nextState: { ...state, silenceGraceUntilMs: nowMs + config.silenceGraceMs },
    };
  }

  if (nowMs >= state.silenceGraceUntilMs) {
    return {
      warnLongSilence: false,
      stopReason: 'long_silence',
      nextState: { ...state, stopRequested: true },
    };
  }

  return { warnLongSilence: false, stopReason: null, nextState: state };
}

class RecordingSessionSafetyService {
  private config: RecordingSafetyConfig = DEFAULT_CONFIG;
  private state: RecordingSafetyState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private onStop: ((reason: RecordingSafetyStopReason) => void) | null = null;
  private onLongSilenceWarning: (() => void) | null = null;
  private onBackpressure: ((status: {
    queueDepth: number;
    oldestAgeMs: number;
  }) => void) | null = null;
  private lastBackpressureNoticeAt = 0;

  start(options: {
    config?: Partial<RecordingSafetyConfig>;
    onStop: (reason: RecordingSafetyStopReason) => void;
    onLongSilenceWarning?: () => void;
    onBackpressure?: (status: { queueDepth: number; oldestAgeMs: number }) => void;
  }): void {
    this.stop();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    const now = Date.now();
    this.state = {
      startedAtMs: now,
      lastSpeechAtMs: now,
      silenceGraceUntilMs: null,
      stopRequested: false,
    };
    this.onStop = options.onStop;
    this.onLongSilenceWarning = options.onLongSilenceWarning ?? null;
    this.onBackpressure = options.onBackpressure ?? null;
    this.lastBackpressureNoticeAt = 0;
    this.unsubscribe = subtitleStream.subscribe((event) => this.onSubtitleEvent(event));
    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.state = null;
    this.onStop = null;
    this.onLongSilenceWarning = null;
    this.onBackpressure = null;
  }

  private onSubtitleEvent(event: SubtitleEvent): void {
    if (!this.state) return;
    if (event.kind === 'partial_text' && event.text.trim()) {
      this.markSpeechActivity();
      return;
    }
    if (event.kind === 'sentence_committed') {
      this.markSpeechActivity();
      return;
    }
    if (event.kind === 'pipeline_status') {
      this.maybeNotifyBackpressure(event);
    }
  }

  private markSpeechActivity(): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      lastSpeechAtMs: Date.now(),
      silenceGraceUntilMs: null,
    };
  }

  private maybeNotifyBackpressure(event: Extract<SubtitleEvent, { kind: 'pipeline_status' }>): void {
    const overloaded =
      event.translationQueueDepth >= this.config.backpressureQueueDepth ||
      event.oldestTranslationAgeMs >= this.config.backpressureOldestAgeMs;
    if (!overloaded || !this.onBackpressure) return;

    const now = Date.now();
    if (now - this.lastBackpressureNoticeAt < this.config.backpressureNotifyEveryMs) {
      return;
    }
    this.lastBackpressureNoticeAt = now;
    this.onBackpressure({
      queueDepth: event.translationQueueDepth,
      oldestAgeMs: event.oldestTranslationAgeMs,
    });
  }

  private check(): void {
    if (!this.state) return;
    const decision = deriveRecordingSafetyDecision(this.state, Date.now(), this.config);
    this.state = decision.nextState;
    if (decision.warnLongSilence) {
      this.onLongSilenceWarning?.();
    }
    if (decision.stopReason) {
      this.onStop?.(decision.stopReason);
    }
  }
}

export const recordingSessionSafetyService = new RecordingSessionSafetyService();
