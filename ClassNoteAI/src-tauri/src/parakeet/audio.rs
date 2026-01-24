use anyhow::Result;

/// Process audio data for Parakeet model.
/// Converts i16 samples to f32, normalizes range, and handles gain.
pub fn process_audio(audio_data: &[i16]) -> Result<Vec<f32>> {
    // Basic conversion to f32
    let mut audio_f32: Vec<f32> = audio_data
        .iter()
        .map(|&sample| sample as f32 / 32768.0)
        .collect();

    // Calculate RMS
    let rms: f32 = audio_f32.iter().map(|&x| x * x).sum::<f32>() / audio_f32.len() as f32;
    let rms = rms.sqrt();

    // Gain control (Reuse logic from Whisper implementation)
    // Target RMS around 0.1-0.2
    if rms > 0.0 && rms < 0.01 {
        let gain = 0.2 / rms;
        let max_gain = 3.0; // Cap gain
        let gain = gain.min(max_gain);
        
        // Apply gain
        audio_f32.iter_mut().for_each(|x| *x = (*x * gain).clamp(-1.0, 1.0));
    } else if rms > 0.5 {
        let gain = 0.3 / rms;
        audio_f32.iter_mut().for_each(|x| *x = (*x * gain).clamp(-1.0, 1.0));
    }

    Ok(audio_f32)
}
