export type SpeakerRole = 'teacher' | 'student' | 'unknown';

export interface SubtitleSegment {
  id: string;

  roughText: string;
  roughTranslation?: string;
  roughConfidence?: number;

  fineText?: string;
  fineTranslation?: string;
  fineConfidence?: number;

  displayText: string;
  displayTranslation?: string;

  startTime: number;
  endTime: number;
  language?: string;
  source: 'rough' | 'fine';
  translationSource?: 'rough' | 'fine' | 'error';
  speakerRole?: SpeakerRole;
  speakerId?: string;

  fineStatus?: 'pending' | 'transcribing' | 'translating' | 'completed' | 'failed';

  fineUsage?: { inputTokens: number; outputTokens: number };

  text?: string;
  translatedText?: string;
  confidence?: number;
}

export interface SubtitleState {
  segments: SubtitleSegment[];
  currentText: string;
  currentTranslation?: string;
  isRecording: boolean;
  isTranscribing: boolean;
  lastUpdateTime: number;
}

export type SubtitleDisplayMode = 'current' | 'history' | 'both';

export interface SubtitleDisplayConfig {
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: 'top' | 'bottom' | 'center';
  maxLines: number;
  fadeDuration: number;
}
