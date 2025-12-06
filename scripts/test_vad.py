#!/usr/bin/env python3
"""
測試 VAD 檢測功能
讀取 WAV 文件並分析音頻能量，幫助調試 VAD 參數
"""

import wave
import numpy as np
import sys
import os

def analyze_audio(wav_path):
    """分析音頻文件的能量分佈"""
    print(f"分析音頻文件: {wav_path}")
    
    # 讀取 WAV 文件
    with wave.open(wav_path, 'rb') as wf:
        sample_rate = wf.getframerate()
        n_channels = wf.getnchannels()
        n_frames = wf.getnframes()
        sample_width = wf.getsampwidth()
        
        print(f"採樣率: {sample_rate} Hz")
        print(f"聲道數: {n_channels}")
        print(f"樣本數: {n_frames}")
        print(f"時長: {n_frames / sample_rate:.2f} 秒")
        print(f"樣本寬度: {sample_width} bytes")
        
        # 讀取音頻數據
        audio_data = wf.readframes(n_frames)
        
        # 轉換為 numpy 數組
        if sample_width == 1:
            # 8-bit unsigned
            audio = np.frombuffer(audio_data, dtype=np.uint8)
            audio = (audio.astype(np.int16) - 128) * 256
        elif sample_width == 2:
            # 16-bit signed
            audio = np.frombuffer(audio_data, dtype=np.int16)
        elif sample_width == 4:
            # 32-bit
            audio = np.frombuffer(audio_data, dtype=np.int32)
        else:
            raise ValueError(f"不支持的樣本寬度: {sample_width}")
        
        # 如果是立體聲，只取第一個聲道
        if n_channels == 2:
            audio = audio[::2]
        
        # 重採樣到 16kHz（如果需要）- 簡單線性插值
        if sample_rate != 16000:
            target_rate = 16000
            num_samples = int(len(audio) * target_rate / sample_rate)
            indices = np.linspace(0, len(audio) - 1, num_samples)
            audio = np.interp(indices, np.arange(len(audio)), audio).astype(np.int16)
            sample_rate = target_rate
            print(f"重採樣到 16kHz，新樣本數: {len(audio)}")
    
    # 計算能量統計
    window_size = 1600  # 100ms @ 16kHz
    energies = []
    
    for i in range(0, len(audio), window_size // 2):
        end = min(i + window_size, len(audio))
        if end <= i:
            break
        
        window = audio[i:end]
        # 計算 RMS 能量（與 Rust 實現一致）
        normalized = window.astype(np.float64) / 32768.0
        rms = np.sqrt(np.mean(normalized ** 2))
        energies.append(rms)
    
    if not energies:
        print("錯誤: 無法計算能量")
        return
    
    energies = np.array(energies)
    
    # 統計信息
    print("\n=== 能量分析 ===")
    print(f"能量窗口數: {len(energies)}")
    print(f"最小能量: {energies.min():.6f}")
    print(f"最大能量: {energies.max():.6f}")
    print(f"平均能量: {energies.mean():.6f}")
    print(f"中位數能量: {np.median(energies):.6f}")
    print(f"標準差: {energies.std():.6f}")
    
    # 能量分佈
    print("\n=== 能量分佈 ===")
    thresholds = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1]
    for threshold in thresholds:
        above = np.sum(energies > threshold)
        percentage = above / len(energies) * 100
        print(f"閾值 {threshold:.3f}: {above}/{len(energies)} ({percentage:.1f}%) 窗口超過")
    
    # 音頻數據統計
    print("\n=== 音頻數據統計 ===")
    print(f"最小樣本值: {audio.min()}")
    print(f"最大樣本值: {audio.max()}")
    print(f"平均樣本值: {audio.mean():.2f}")
    print(f"非零樣本數: {np.count_nonzero(audio)}/{len(audio)} ({np.count_nonzero(audio)/len(audio)*100:.1f}%)")
    
    # 建議的 VAD 參數
    print("\n=== 建議的 VAD 參數 ===")
    # 使用 5% 分位數作為能量閾值
    energy_threshold_5pct = np.percentile(energies, 95)
    energy_threshold_10pct = np.percentile(energies, 90)
    energy_threshold_mean = energies.mean()
    
    print(f"建議能量閾值（95%分位數）: {energy_threshold_5pct:.6f}")
    print(f"建議能量閾值（90%分位數）: {energy_threshold_10pct:.6f}")
    print(f"建議能量閾值（平均值）: {energy_threshold_mean:.6f}")
    print(f"當前默認閾值: 0.01")
    
    # 檢測語音段落（使用建議閾值）
    print("\n=== 使用不同閾值檢測語音段落 ===")
    for threshold in [0.001, 0.005, 0.01, energy_threshold_mean]:
        segments = detect_speech_segments(energies, threshold, window_size, sample_rate)
        print(f"閾值 {threshold:.6f}: 檢測到 {len(segments)} 個語音段落")
        for i, seg in enumerate(segments):
            print(f"  段落 {i+1}: {seg['start_ms']:.0f}ms - {seg['end_ms']:.0f}ms ({seg['duration_ms']:.0f}ms)")

def detect_speech_segments(energies, threshold, window_size, sample_rate):
    """簡單的語音段落檢測"""
    segments = []
    in_speech = False
    speech_start_idx = 0
    
    for idx, energy in enumerate(energies):
        is_speech = energy > threshold
        timestamp_ms = (idx * window_size // 2 * 1000) // sample_rate
        
        if is_speech and not in_speech:
            in_speech = True
            speech_start_idx = idx
        elif not is_speech and in_speech:
            start_ms = (speech_start_idx * window_size // 2 * 1000) // sample_rate
            duration_ms = timestamp_ms - start_ms
            if duration_ms >= 2000:  # 最小 2 秒
                segments.append({
                    'start_ms': start_ms,
                    'end_ms': timestamp_ms,
                    'duration_ms': duration_ms
                })
            in_speech = False
    
    # 處理最後一個段落
    if in_speech:
        start_ms = (speech_start_idx * window_size // 2 * 1000) // sample_rate
        end_ms = ((len(energies) - 1) * window_size // 2 * 1000) // sample_rate
        duration_ms = end_ms - start_ms
        if duration_ms >= 2000:
            segments.append({
                'start_ms': start_ms,
                'end_ms': end_ms,
                'duration_ms': duration_ms
            })
    
    return segments

if __name__ == '__main__':
    wav_path = sys.argv[1] if len(sys.argv) > 1 else 'recording-1764664393263.wav'
    
    if not os.path.exists(wav_path):
        print(f"錯誤: 文件不存在: {wav_path}")
        sys.exit(1)
    
    try:
        analyze_audio(wav_path)
    except Exception as e:
        print(f"錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

