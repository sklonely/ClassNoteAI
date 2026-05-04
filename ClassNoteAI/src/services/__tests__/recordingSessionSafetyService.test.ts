import { describe, expect, it } from 'vitest';
import {
  deriveRecordingSafetyDecision,
  type RecordingSafetyState,
} from '../recordingSessionSafetyService';

const baseState: RecordingSafetyState = {
  startedAtMs: 0,
  lastSpeechAtMs: 0,
  silenceGraceUntilMs: null,
  stopRequested: false,
};

const config = {
  hardMaxMs: 1000,
  longSilenceMs: 300,
  silenceGraceMs: 100,
};

describe('deriveRecordingSafetyDecision', () => {
  it('requests a hard stop when the duration cap is reached', () => {
    const decision = deriveRecordingSafetyDecision(baseState, 1000, config);
    expect(decision.stopReason).toBe('hard_duration_cap');
    expect(decision.nextState.stopRequested).toBe(true);
  });

  it('warns once when long silence starts, then waits for the grace window', () => {
    const first = deriveRecordingSafetyDecision(baseState, 300, config);
    expect(first.warnLongSilence).toBe(true);
    expect(first.stopReason).toBeNull();
    expect(first.nextState.silenceGraceUntilMs).toBe(400);

    const second = deriveRecordingSafetyDecision(first.nextState, 350, config);
    expect(second.warnLongSilence).toBe(false);
    expect(second.stopReason).toBeNull();
  });

  it('requests stop when silence remains past the grace window', () => {
    const warned = {
      ...baseState,
      silenceGraceUntilMs: 400,
    };
    const decision = deriveRecordingSafetyDecision(warned, 401, config);
    expect(decision.stopReason).toBe('long_silence');
    expect(decision.nextState.stopRequested).toBe(true);
  });

  it('clears pending silence grace after speech activity updates lastSpeechAt', () => {
    const state = {
      ...baseState,
      lastSpeechAtMs: 390,
      silenceGraceUntilMs: 400,
    };
    const decision = deriveRecordingSafetyDecision(state, 410, config);
    expect(decision.stopReason).toBeNull();
    expect(decision.nextState.silenceGraceUntilMs).toBeNull();
  });
});
