use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

#[derive(Debug, Deserialize)]
pub struct DiagnosticPackageInput {
    pub lecture_meta_json: String,
    pub subtitles_json: String,
    pub audio_path: Option<String>,
    pub redacted_log_text: String,
    pub metadata_json: String,
}

pub fn build_diagnostic_zip(
    input: DiagnosticPackageInput,
    include_audio: bool,
) -> Result<PathBuf, String> {
    let downloads_dir = dirs::download_dir().ok_or_else(|| "無法定位下載資料夾".to_string())?;
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let zip_path = downloads_dir.join(format!("classnoteai-diagnostic-{}.zip", timestamp));

    let lecture_meta: Value = serde_json::from_str(&input.lecture_meta_json)
        .map_err(|e| format!("Failed to parse lecture metadata JSON: {}", e))?;
    let subtitles: Value = serde_json::from_str(&input.subtitles_json)
        .map_err(|e| format!("Failed to parse subtitles JSON: {}", e))?;
    let metadata: Value = serde_json::from_str(&input.metadata_json)
        .map_err(|e| format!("Failed to parse metadata JSON: {}", e))?;

    let transcript_json = serde_json::to_vec_pretty(&json!({
        "lecture": lecture_meta,
        "subtitles": subtitles,
    }))
    .map_err(|e| format!("Failed to serialize transcript JSON: {}", e))?;
    let metadata_json = serde_json::to_vec_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata JSON: {}", e))?;

    let file = File::create(&zip_path)
        .map_err(|e| format!("Failed to create diagnostic zip {}: {}", zip_path.display(), e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("log/classnoteai.log", options)
        .map_err(|e| format!("Failed to add log file to zip: {}", e))?;
    zip.write_all(input.redacted_log_text.as_bytes())
        .map_err(|e| format!("Failed to write log file to zip: {}", e))?;

    zip.start_file("transcript/lecture.json", options)
        .map_err(|e| format!("Failed to add transcript to zip: {}", e))?;
    zip.write_all(&transcript_json)
        .map_err(|e| format!("Failed to write transcript to zip: {}", e))?;

    zip.start_file("metadata.json", options)
        .map_err(|e| format!("Failed to add metadata to zip: {}", e))?;
    zip.write_all(&metadata_json)
        .map_err(|e| format!("Failed to write metadata to zip: {}", e))?;

    let mut included_audio_name: Option<String> = None;
    if include_audio {
        if let Some(audio_path) = input.audio_path.as_deref() {
            let path = Path::new(audio_path);
            if path.is_file() {
                let audio_bytes = fs::read(path)
                    .map_err(|e| format!("Failed to read audio file {}: {}", path.display(), e))?;
                let filename = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| "audio.bin".to_string());
                zip.start_file(format!("audio/{}", filename), options)
                    .map_err(|e| format!("Failed to add audio file to zip: {}", e))?;
                zip.write_all(&audio_bytes)
                    .map_err(|e| format!("Failed to write audio file to zip: {}", e))?;
                included_audio_name = Some(filename);
            }
        }
    }

    let generation_time = chrono::Utc::now().to_rfc3339();
    let readme = build_readme(&generation_time, included_audio_name.as_deref());

    zip.start_file("README.md", options)
        .map_err(|e| format!("Failed to add README to zip: {}", e))?;
    zip.write_all(readme.as_bytes())
        .map_err(|e| format!("Failed to write README to zip: {}", e))?;

    zip.finish()
        .map_err(|e| format!("Failed to finalize diagnostic zip: {}", e))?;

    Ok(zip_path)
}

fn build_readme(generation_time: &str, audio_filename: Option<&str>) -> String {
    let audio_line = match audio_filename {
        Some(name) => format!("- `audio/{}`：選填的原始音訊檔。", name),
        None => "- `audio/`：本次匯出未包含音訊，或原始音訊檔已不存在。".to_string(),
    };

    format!(
        concat!(
            "# ClassNoteAI 診斷封包\n\n",
            "此 ZIP 由 ClassNoteAI 在本機產生，方便回報問題時一次提供必要資料。\n",
            "程式不會自動上傳這個檔案，是否分享完全由你決定。\n\n",
            "## 內容\n",
            "- `log/classnoteai.log`：最近的應用程式日誌，已先做敏感資訊遮罩。\n",
            "- `transcript/lecture.json`：所選講座的中繼資料與字幕內容。\n",
            "- `metadata.json`：匯出時的版本、平台與封包摘要資訊。\n",
            "{audio_line}\n\n",
            "## 分享方式\n",
            "1. 先確認內容是否符合你願意分享的範圍。\n",
            "2. 將整個 ZIP 附加到 issue、Email 或其他支援管道。\n",
            "3. 若你不想分享音訊，請在匯出時取消勾選包含音訊。\n\n",
            "## 隱私提醒\n",
            "- 日誌已做基本遮罩，但仍可能包含課程標題、檔名或錯誤訊息。\n",
            "- 音訊檔可能包含個人或課堂內容，請自行判斷是否適合提供。\n\n",
            "生成時間（UTC）：{generation_time}\n"
        ),
        audio_line = audio_line,
        generation_time = generation_time
    )
}
