/**
 * 語音活動檢測（VAD）模塊
 * 實現基於能量的語音活動檢測
 * 
 * 方案 A：VAD + 固定時間上限
 * 1. 使用 VAD 檢測語音活動
 * 2. 在語音段落邊界進行切片
 * 3. 設置最大時長限制（8-10秒）防止過長
 * 4. 設置最小時長限制（2-3秒）確保有足夠上下文
 */

use serde::{Deserialize, Serialize};

/// 語音活動檢測結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadResult {
    /// 是否檢測到語音
    pub is_speech: bool,
    /// 語音能量（0.0-1.0）
    pub energy: f32,
    /// 時間戳（毫秒）
    pub timestamp_ms: u64,
}

/// 語音段落
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechSegment {
    /// 開始時間（樣本索引）
    pub start_sample: usize,
    /// 結束時間（樣本索引）
    pub end_sample: usize,
    /// 開始時間（毫秒）
    pub start_ms: u64,
    /// 結束時間（毫秒）
    pub end_ms: u64,
    /// 平均能量
    pub avg_energy: f32,
}

/// VAD 配置
#[derive(Debug, Clone)]
pub struct VadConfig {
    /// 能量閾值（0.0-1.0），低於此值視為靜音
    pub energy_threshold: f32,
    /// 最小語音時長（毫秒）
    pub min_speech_duration_ms: u64,
    /// 最大語音時長（毫秒），超過此值強制切片
    pub max_speech_duration_ms: u64,
    /// 最小靜音時長（毫秒），用於合併相近的語音段
    pub min_silence_duration_ms: u64,
    /// 採樣率
    pub sample_rate: u32,
    /// 分析窗口大小（樣本數）
    pub window_size_samples: usize,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            energy_threshold: 0.002, // 0.2% 的能量閾值（更靈敏，適合實際錄音）
            min_speech_duration_ms: 1000, // 最小 1 秒（降低以檢測更多語音）
            max_speech_duration_ms: 10000, // 最大 10 秒
            min_silence_duration_ms: 500, // 0.5 秒靜音用於合併
            sample_rate: 16000,
            window_size_samples: 1600, // 100ms @ 16kHz
        }
    }
}

/// VAD 檢測器
pub struct VadDetector {
    config: VadConfig,
}

impl VadDetector {
    /// 創建新的 VAD 檢測器
    pub fn new(config: VadConfig) -> Self {
        Self { config }
    }

    /// 使用默認配置創建 VAD 檢測器
    pub fn with_default_config() -> Self {
        Self {
            config: VadConfig::default(),
        }
    }

    /// 檢測語音活動
    /// 
    /// 返回語音段落列表
    pub fn detect_speech_segments(&self, audio_data: &[i16]) -> Vec<SpeechSegment> {
        let sample_rate = self.config.sample_rate;
        let window_size = self.config.window_size_samples;
        let energy_threshold = self.config.energy_threshold;
        
        // 計算每個窗口的能量
        let mut energies = Vec::new();
        let mut timestamps = Vec::new();
        
        for i in (0..audio_data.len()).step_by(window_size / 2) {
            let end = (i + window_size).min(audio_data.len());
            if end <= i {
                break;
            }
            
            let window = &audio_data[i..end];
            let energy = self.calculate_energy(window);
            
            energies.push(energy);
            timestamps.push(i);
        }
        
        // 檢測語音段落
        let mut segments = Vec::new();
        let mut in_speech = false;
        let mut speech_start_sample = 0;
        let mut speech_energies = Vec::new();
        
        for (idx, &energy) in energies.iter().enumerate() {
            let is_speech_now = energy > energy_threshold;
            let sample_idx = timestamps[idx];
            let timestamp_ms = (sample_idx as u64 * 1000) / sample_rate as u64;
            
            if is_speech_now && !in_speech {
                // 開始語音段落
                in_speech = true;
                speech_start_sample = sample_idx;
                speech_energies.clear();
                speech_energies.push(energy);
            } else if is_speech_now && in_speech {
                // 繼續語音段落
                speech_energies.push(energy);
            } else if !is_speech_now && in_speech {
                // 檢測到靜音，但需要確認是否真的結束
                // 延遲確認：檢查後續幾個窗口是否都是靜音
                let mut silence_count = 0;
                let mut confirmed_end = false;
                
                // 檢查後續 3 個窗口（約 150ms）
                for check_idx in (idx + 1)..energies.len().min(idx + 4) {
                    if check_idx < energies.len() {
                        let check_energy = energies[check_idx];
                        if check_energy <= energy_threshold {
                            silence_count += 1;
                        } else {
                            // 如果後續有語音，繼續當前段落
                            break;
                        }
                    }
                }
                
                // 如果連續 3 個窗口都是靜音，確認結束
                if silence_count >= 3 {
                    confirmed_end = true;
                } else if idx == energies.len() - 1 {
                    // 最後一個窗口，直接結束
                    confirmed_end = true;
                }
                
                if confirmed_end {
                    // 結束語音段落
                    // 檢查是否達到最小時長
                    let start_ms = (speech_start_sample as u64 * 1000) / sample_rate as u64;
                    let duration_ms = timestamp_ms.saturating_sub(start_ms);
                    
                    if duration_ms >= self.config.min_speech_duration_ms {
                        let avg_energy = speech_energies.iter().sum::<f32>() / speech_energies.len() as f32;
                        let end_sample = sample_idx;
                        let end_ms = timestamp_ms;
                        
                        segments.push(SpeechSegment {
                            start_sample: speech_start_sample,
                            end_sample,
                            start_ms,
                            end_ms,
                            avg_energy,
                        });
                    }
                    
                    in_speech = false;
                }
            }
        }
        
        // 處理最後一個語音段落（如果還在語音中）
        if in_speech {
            let end_sample = audio_data.len();
            let start_ms = (speech_start_sample as u64 * 1000) / sample_rate as u64;
            let end_ms = (end_sample as u64 * 1000) / sample_rate as u64;
            let duration_ms = end_ms.saturating_sub(start_ms);
            
            if duration_ms >= self.config.min_speech_duration_ms {
                let avg_energy = if speech_energies.is_empty() {
                    0.0
                } else {
                    speech_energies.iter().sum::<f32>() / speech_energies.len() as f32
                };
                
                segments.push(SpeechSegment {
                    start_sample: speech_start_sample,
                    end_sample,
                    start_ms,
                    end_ms,
                    avg_energy,
                });
            }
        }
        
        // 合併相近的語音段落
        self.merge_nearby_segments(segments)
    }

    /// 計算音頻窗口的能量
    fn calculate_energy(&self, window: &[i16]) -> f32 {
        if window.is_empty() {
            return 0.0;
        }
        
        // 計算 RMS (Root Mean Square) 能量
        let sum_squares: f64 = window.iter()
            .map(|&sample| {
                let normalized = sample as f64 / 32768.0;
                normalized * normalized
            })
            .sum();
        
        let rms = (sum_squares / window.len() as f64).sqrt();
        rms as f32
    }

    /// 合併相近的語音段落
    /// 
    /// 如果兩個語音段落之間的間隔小於 min_silence_duration_ms，則合併
    fn merge_nearby_segments(&self, mut segments: Vec<SpeechSegment>) -> Vec<SpeechSegment> {
        if segments.len() <= 1 {
            return segments;
        }
        
        let mut merged = Vec::new();
        let mut current = segments.remove(0);
        
        for segment in segments {
            let gap_ms = segment.start_ms.saturating_sub(current.end_ms);
            
            if gap_ms <= self.config.min_silence_duration_ms {
                // 合併段落
                current.end_sample = segment.end_sample;
                current.end_ms = segment.end_ms;
                // 重新計算平均能量
                current.avg_energy = (current.avg_energy + segment.avg_energy) / 2.0;
            } else {
                // 保存當前段落，開始新段落
                merged.push(current);
                current = segment;
            }
        }
        
        merged.push(current);
        merged
    }

    /// 強制在最大時長處切片
    /// 
    /// 如果語音段落超過最大時長，將其分割成多個段落
    pub fn enforce_max_duration(&self, segments: Vec<SpeechSegment>) -> Vec<SpeechSegment> {
        let mut result = Vec::new();
        
        for segment in segments {
            let duration_ms = segment.end_ms.saturating_sub(segment.start_ms);
            
            if duration_ms <= self.config.max_speech_duration_ms {
                result.push(segment);
            } else {
                // 分割成多個段落
                let num_chunks = (duration_ms / self.config.max_speech_duration_ms) as usize + 1;
                let chunk_duration_samples = (segment.end_sample - segment.start_sample) / num_chunks;
                let chunk_duration_ms = duration_ms / num_chunks as u64;
                
                for i in 0..num_chunks {
                    let start_sample = segment.start_sample + i * chunk_duration_samples;
                    let end_sample = if i == num_chunks - 1 {
                        segment.end_sample
                    } else {
                        segment.start_sample + (i + 1) * chunk_duration_samples
                    };
                    
                    let start_ms = segment.start_ms + i as u64 * chunk_duration_ms;
                    let end_ms = if i == num_chunks - 1 {
                        segment.end_ms
                    } else {
                        segment.start_ms + (i + 1) as u64 * chunk_duration_ms
                    };
                    
                    result.push(SpeechSegment {
                        start_sample,
                        end_sample,
                        start_ms,
                        end_ms,
                        avg_energy: segment.avg_energy,
                    });
                }
            }
        }
        
        result
    }

    /// 過濾太短的片段
    pub fn filter_short_segments(&self, segments: Vec<SpeechSegment>) -> Vec<SpeechSegment> {
        segments.into_iter()
            .filter(|seg| {
                let duration_ms = seg.end_ms.saturating_sub(seg.start_ms);
                duration_ms >= self.config.min_speech_duration_ms
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_energy_calculation() {
        let detector = VadDetector::with_default_config();
        
        // 測試靜音（全為 0）
        let silence = vec![0i16; 1600];
        let energy = detector.calculate_energy(&silence);
        assert!(energy < 0.001);
        
        // 測試語音（有信號）
        let speech: Vec<i16> = (0..1600)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let energy = detector.calculate_energy(&speech);
        assert!(energy > 0.01);
    }

    #[test]
    fn test_speech_detection() {
        let mut config = VadConfig::default();
        config.energy_threshold = 0.005;
        config.min_speech_duration_ms = 100;
        let detector = VadDetector::new(config);
        
        // 創建測試音頻：靜音 -> 語音 -> 靜音
        let mut audio = vec![0i16; 8000]; // 0.5秒靜音
        let speech: Vec<i16> = (0..16000)
            .map(|i| ((i as f32 * 0.1).sin() * 15000.0) as i16)
            .collect();
        audio.extend(speech); // 1秒語音
        audio.extend(vec![0i16; 8000]); // 0.5秒靜音
        
        let segments = detector.detect_speech_segments(&audio);
        assert!(!segments.is_empty());
    }
}
