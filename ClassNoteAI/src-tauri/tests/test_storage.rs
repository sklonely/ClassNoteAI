use classnoteai_lib::storage::{Course, Database, Lecture, Note, Subtitle};
use tempfile::TempDir;

const TEST_USER: &str = "test_user";

fn create_test_db() -> (TempDir, Database) {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    let db = Database::new(&db_path).unwrap();
    (temp_dir, db)
}

fn create_course(db: &Database, title: &str) -> Course {
    let course = Course::new(TEST_USER.to_string(), title.to_string(), None, None, None);
    db.save_course(&course).unwrap();
    course
}

fn create_lecture(
    db: &Database,
    course: &Course,
    title: &str,
    pdf_path: Option<String>,
) -> Lecture {
    let lecture = Lecture::new(course.id.clone(), title.to_string(), pdf_path);
    db.save_lecture(&lecture, TEST_USER).unwrap();
    lecture
}

#[test]
fn test_database_initialization() {
    let (_temp_dir, _db) = create_test_db();
}

#[test]
fn test_save_and_get_lecture() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "測試科目");
    let lecture = create_lecture(
        &db,
        &course,
        "測試課堂",
        Some("/path/to/test.pdf".to_string()),
    );

    let retrieved = db.get_lecture(&lecture.id).unwrap().unwrap();

    assert_eq!(retrieved.id, lecture.id);
    assert_eq!(retrieved.course_id, course.id);
    assert_eq!(retrieved.title, "測試課堂");
    assert_eq!(retrieved.pdf_path, Some("/path/to/test.pdf".to_string()));
    assert_eq!(retrieved.status, "recording");
    assert!(!retrieved.is_deleted);
}

#[test]
fn test_list_lectures_for_user() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "測試科目");
    let lecture1 = create_lecture(&db, &course, "課堂 1", None);
    let lecture2 = create_lecture(&db, &course, "課堂 2", None);

    let lectures = db.list_lectures(TEST_USER).unwrap();

    assert_eq!(lectures.len(), 2);
    assert!(lectures.iter().any(|lecture| lecture.id == lecture1.id));
    assert!(lectures.iter().any(|lecture| lecture.id == lecture2.id));
}

#[test]
fn test_delete_lecture_marks_it_soft_deleted_and_hides_from_listing() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "測試科目");
    let lecture = create_lecture(&db, &course, "待刪除課堂", None);

    db.delete_lecture(&lecture.id).unwrap();

    let deleted = db.get_lecture(&lecture.id).unwrap().unwrap();
    assert!(deleted.is_deleted);

    let lectures = db.list_lectures(TEST_USER).unwrap();
    assert!(lectures.iter().all(|item| item.id != lecture.id));
}

#[test]
fn test_update_lecture_status() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "測試科目");
    let lecture = create_lecture(&db, &course, "狀態更新測試", None);

    db.update_lecture_status(&lecture.id, "completed").unwrap();

    let updated = db.get_lecture(&lecture.id).unwrap().unwrap();
    assert_eq!(updated.status, "completed");
}

#[test]
fn test_save_and_get_subtitle() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "字幕科目");
    let lecture = create_lecture(&db, &course, "字幕課堂", None);

    let subtitle = Subtitle::new(
        lecture.id.clone(),
        10.5,
        "Hello world".to_string(),
        Some("你好世界".to_string()),
        "rough".to_string(),
        Some(0.95),
    );
    let subtitle_id = subtitle.id.clone();

    db.save_subtitle(&subtitle).unwrap();

    let subtitles = db.get_subtitles(&lecture.id).unwrap();
    assert_eq!(subtitles.len(), 1);
    assert_eq!(subtitles[0].id, subtitle_id);
    assert_eq!(subtitles[0].text_en, "Hello world");
    assert_eq!(subtitles[0].text_zh, Some("你好世界".to_string()));
    assert_eq!(subtitles[0].timestamp, 10.5);
}

#[test]
fn test_save_multiple_subtitles() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "字幕科目");
    let lecture = create_lecture(&db, &course, "字幕課堂", None);

    let subtitles = vec![
        Subtitle::new(
            lecture.id.clone(),
            10.0,
            "First subtitle".to_string(),
            Some("第一個字幕".to_string()),
            "rough".to_string(),
            None,
        ),
        Subtitle::new(
            lecture.id.clone(),
            20.0,
            "Second subtitle".to_string(),
            Some("第二個字幕".to_string()),
            "rough".to_string(),
            None,
        ),
    ];

    db.save_subtitles(&subtitles).unwrap();

    let retrieved = db.get_subtitles(&lecture.id).unwrap();
    assert_eq!(retrieved.len(), 2);
    assert_eq!(retrieved[0].timestamp, 10.0);
    assert_eq!(retrieved[1].timestamp, 20.0);
}

#[test]
fn test_save_and_get_setting() {
    let (_temp_dir, db) = create_test_db();

    db.save_setting("test_key", "test_value").unwrap();
    let value = db.get_setting("test_key").unwrap().unwrap();

    assert_eq!(value, "test_value");
}

#[test]
fn test_get_nonexistent_setting() {
    let (_temp_dir, db) = create_test_db();
    let value = db.get_setting("nonexistent_key").unwrap();

    assert!(value.is_none());
}

#[test]
fn test_save_and_get_note() {
    let (_temp_dir, db) = create_test_db();
    let course = create_course(&db, "筆記科目");
    let lecture = create_lecture(&db, &course, "筆記課堂", None);
    let note_content = r#"{"sections":[],"qa_records":[]}"#;
    let note = Note::new(
        lecture.id.clone(),
        "測試筆記".to_string(),
        note_content.to_string(),
    );

    db.save_note(&note).unwrap();

    let retrieved = db.get_note(&lecture.id).unwrap().unwrap();
    assert_eq!(retrieved.lecture_id, lecture.id);
    assert_eq!(retrieved.title, "測試筆記");
    assert_eq!(retrieved.content, note_content);
}
