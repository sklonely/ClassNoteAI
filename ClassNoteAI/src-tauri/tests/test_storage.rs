use classnoteai_lib::storage::{Database, Lecture, Note, Subtitle};
use tempfile::TempDir;

/// 創建臨時數據庫用於測試
fn create_test_db() -> (TempDir, Database) {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    let db = Database::new(&db_path).unwrap();
    (temp_dir, db)
}

#[test]
fn test_database_initialization() {
    let (_temp_dir, _db) = create_test_db();
    // 如果初始化成功，測試通過
}

#[test]
fn test_save_and_get_lecture() {
    let (_temp_dir, db) = create_test_db();

    let lecture = Lecture::new(
        "測試課程".to_string(),
        Some("/path/to/test.pdf".to_string()),
    );
    let lecture_id = lecture.id.clone();

    // 保存課程
    db.save_lecture(&lecture).unwrap();

    // 獲取課程
    let retrieved = db.get_lecture(&lecture_id).unwrap().unwrap();

    assert_eq!(retrieved.id, lecture_id);
    assert_eq!(retrieved.title, "測試課程");
    assert_eq!(retrieved.pdf_path, Some("/path/to/test.pdf".to_string()));
    assert_eq!(retrieved.status, "recording");
}

#[test]
fn test_list_lectures() {
    let (_temp_dir, db) = create_test_db();

    // 創建多個課程
    let lecture1 = Lecture::new("課程1".to_string(), None);
    let lecture2 = Lecture::new("課程2".to_string(), None);

    db.save_lecture(&lecture1).unwrap();
    db.save_lecture(&lecture2).unwrap();

    // 列出所有課程
    let lectures = db.list_lectures().unwrap();

    assert_eq!(lectures.len(), 2);
    assert!(lectures.iter().any(|l| l.title == "課程1"));
    assert!(lectures.iter().any(|l| l.title == "課程2"));
}

#[test]
fn test_delete_lecture() {
    let (_temp_dir, db) = create_test_db();

    let lecture = Lecture::new("待刪除課程".to_string(), None);
    let lecture_id = lecture.id.clone();

    db.save_lecture(&lecture).unwrap();

    // 確認課程存在
    assert!(db.get_lecture(&lecture_id).unwrap().is_some());

    // 刪除課程
    db.delete_lecture(&lecture_id).unwrap();

    // 確認課程已刪除
    assert!(db.get_lecture(&lecture_id).unwrap().is_none());
}

#[test]
fn test_update_lecture_status() {
    let (_temp_dir, db) = create_test_db();

    let lecture = Lecture::new("測試課程".to_string(), None);
    let lecture_id = lecture.id.clone();

    db.save_lecture(&lecture).unwrap();

    // 更新狀態
    db.update_lecture_status(&lecture_id, "completed").unwrap();

    // 驗證狀態已更新
    let updated = db.get_lecture(&lecture_id).unwrap().unwrap();
    assert_eq!(updated.status, "completed");
}

#[test]
fn test_save_and_get_subtitle() {
    let (_temp_dir, db) = create_test_db();

    // 先創建一個課程
    let lecture = Lecture::new("測試課程".to_string(), None);
    let lecture_id = lecture.id.clone();
    db.save_lecture(&lecture).unwrap();

    // 創建字幕
    let subtitle = Subtitle::new(
        lecture_id.clone(),
        10.5,
        "Hello world".to_string(),
        Some("你好世界".to_string()),
        "rough".to_string(),
        Some(0.95),
    );
    let subtitle_id = subtitle.id.clone();

    // 保存字幕
    db.save_subtitle(&subtitle).unwrap();

    // 獲取字幕
    let subtitles = db.get_subtitles(&lecture_id).unwrap();

    assert_eq!(subtitles.len(), 1);
    assert_eq!(subtitles[0].id, subtitle_id);
    assert_eq!(subtitles[0].text_en, "Hello world");
    assert_eq!(subtitles[0].text_zh, Some("你好世界".to_string()));
    assert_eq!(subtitles[0].timestamp, 10.5);
}

#[test]
fn test_save_multiple_subtitles() {
    let (_temp_dir, db) = create_test_db();

    // 先創建一個課程
    let lecture = Lecture::new("測試課程".to_string(), None);
    let lecture_id = lecture.id.clone();
    db.save_lecture(&lecture).unwrap();

    // 創建多個字幕
    let subtitles = vec![
        Subtitle::new(
            lecture_id.clone(),
            10.0,
            "First subtitle".to_string(),
            Some("第一個字幕".to_string()),
            "rough".to_string(),
            None,
        ),
        Subtitle::new(
            lecture_id.clone(),
            20.0,
            "Second subtitle".to_string(),
            Some("第二個字幕".to_string()),
            "rough".to_string(),
            None,
        ),
    ];

    // 批量保存
    db.save_subtitles(&subtitles).unwrap();

    // 獲取所有字幕
    let retrieved = db.get_subtitles(&lecture_id).unwrap();

    assert_eq!(retrieved.len(), 2);
    assert_eq!(retrieved[0].timestamp, 10.0);
    assert_eq!(retrieved[1].timestamp, 20.0);
}

#[test]
fn test_save_and_get_setting() {
    let (_temp_dir, db) = create_test_db();

    // 保存設置
    db.save_setting("test_key", "test_value").unwrap();

    // 獲取設置
    let value = db.get_setting("test_key").unwrap().unwrap();

    assert_eq!(value, "test_value");
}

#[test]
fn test_get_nonexistent_setting() {
    let (_temp_dir, db) = create_test_db();

    // 獲取不存在的設置
    let value = db.get_setting("nonexistent_key").unwrap();

    assert!(value.is_none());
}

#[test]
fn test_save_and_get_note() {
    let (_temp_dir, db) = create_test_db();

    // 先創建一個課程
    let lecture = Lecture::new("測試課程".to_string(), None);
    let lecture_id = lecture.id.clone();
    db.save_lecture(&lecture).unwrap();

    // 創建筆記
    let note_content = r#"{"sections":[],"qa_records":[]}"#;
    let note = Note::new(
        lecture_id.clone(),
        "測試筆記".to_string(),
        note_content.to_string(),
    );

    // 保存筆記
    db.save_note(&note).unwrap();

    // 獲取筆記
    let retrieved = db.get_note(&lecture_id).unwrap().unwrap();

    assert_eq!(retrieved.lecture_id, lecture_id);
    assert_eq!(retrieved.title, "測試筆記");
    assert_eq!(retrieved.content, note_content);
}

#[test]
fn test_cascade_delete() {
    let (_temp_dir, db) = create_test_db();

    // 創建課程
    let lecture = Lecture::new("測試課程".to_string(), None);
    let lecture_id = lecture.id.clone();
    db.save_lecture(&lecture).unwrap();

    // 創建字幕
    let subtitle = Subtitle::new(
        lecture_id.clone(),
        10.0,
        "Test".to_string(),
        None,
        "rough".to_string(),
        None,
    );
    db.save_subtitle(&subtitle).unwrap();

    // 創建筆記
    let note = Note::new(
        lecture_id.clone(),
        "Test Note".to_string(),
        "{}".to_string(),
    );
    db.save_note(&note).unwrap();

    // 確認數據存在
    assert_eq!(db.get_subtitles(&lecture_id).unwrap().len(), 1);
    assert!(db.get_note(&lecture_id).unwrap().is_some());

    // 刪除課程（應該級聯刪除字幕和筆記）
    db.delete_lecture(&lecture_id).unwrap();

    // 確認級聯刪除
    assert_eq!(db.get_subtitles(&lecture_id).unwrap().len(), 0);
    assert!(db.get_note(&lecture_id).unwrap().is_none());
}
