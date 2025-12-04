/**
 * VAD（語音活動檢測）服務
 * 使用 Rust 後端的 VAD 功能進行語音段落檢測
 */

import { invoke } from '@tauri-apps/api/core';

export interface SpeechSegment {
  start_sample: number;
  end_sample: number;
  start_ms: number;
  end_ms: number;
  avg_energy: number;
}

export interface VadOptions {
  energy_threshold?: number; // 能量閾值（0.0-1.0），默認 0.01
  min_speech_duration_ms?: number; // 最小語音時長（毫秒），默認 2000
  max_speech_duration_ms?: number; // 最大語音時長（毫秒），默認 10000
}

/**
 * 檢測語音段落
 * @param audioData 音頻數據（Int16Array）
 * @param sampleRate 採樣率（默認 16000）
 * @param options VAD 選項
 */
export async function detectSpeechSegments(
  audioData: Int16Array,
  sampleRate: number = 16000,
  options: VadOptions = {}
): Promise<SpeechSegment[]> {
  try {
    const segments = await invoke<SpeechSegment[]>('detect_speech_segments', {
      audioData: Array.from(audioData),
      sampleRate,
      energyThreshold: options.energy_threshold,
      minSpeechDurationMs: options.min_speech_duration_ms,
      maxSpeechDurationMs: options.max_speech_duration_ms,
    });

    // console.log('[VADService] 檢測到', segments.length, '個語音段落');
    return segments;
  } catch (error) {
    console.error('[VADService] 語音段落檢測失敗:', error);
    throw error;
  }
}

/**
 * 從語音段落提取音頻數據
 * @param audioData 完整音頻數據
 * @param segment 語音段落
 */
export function extractAudioSegment(
  audioData: Int16Array,
  segment: SpeechSegment
): Int16Array {
  return audioData.slice(segment.start_sample, segment.end_sample);
}


