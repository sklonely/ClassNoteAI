//! Phase 7 Sprint 0 task S0.4 — reusable in-memory SQLite test harness
//! for the `storage::database` module.
//!
//! Existing tests inside `database.rs` use `tempfile::TempDir` to spin up
//! a real on-disk DB. That works but it (a) hits the filesystem on every
//! run and (b) lives inside `database.rs` so it can't be reused from
//! sibling modules. Sprint 3 needs a fast, file-system-free harness for
//! cascade delete / restore / hard_delete TDD, so this module exposes:
//!
//! * `make_test_db()` — open an in-memory SQLite DB with the production
//!   migration applied. Same `init_tables` path as `Database::new`.
//! * `seed_minimal(&db)` — insert one course + one lecture under the
//!   auto-created `default_user`, enough for smoke tests / starting
//!   point for cascade-delete fixtures.
//!
//! Both helpers are `#[cfg(test)]` only — the `mod database_test` line
//! in `storage::mod` is itself `#[cfg(test)]` so none of this ships in
//! release binaries.
//!
//! The `#[cfg(test)]` constructor `Database::open_in_memory()` and the
//! `Database::conn()` accessor (also `#[cfg(test)]`) are the only two
//! production-file additions. Both are minimal and test-gated.

#![cfg(test)]

use super::database::Database;
use chrono::Utc;
use rusqlite::Result as SqlResult;

/// Open a fresh in-memory SQLite DB with the full production schema
/// (every `init_tables` migration step executed against an empty DB).
///
/// Returns the owned `Database` directly — there is no temp dir to
/// keep alive because nothing touches the filesystem.
pub fn make_test_db() -> Database {
    Database::open_in_memory().expect("failed to open in-memory test DB")
}

/// Insert the smallest possible fixture for higher-level tests:
///
/// * `default_user` is already created by `init_tables` (INSERT OR
///   IGNORE during migration), so we don't insert a user row here —
///   re-inserting is a no-op anyway.
/// * one course `c1` owned by `default_user`.
/// * one lecture `l1` under `c1` with status `completed`.
///
/// Idempotent: uses `INSERT OR IGNORE` so calling twice on the same
/// DB is safe (helpful when a future fixture stacks on top of this).
pub fn seed_minimal(db: &Database) {
    seed_minimal_inner(db).expect("seed_minimal failed");
}

fn seed_minimal_inner(db: &Database) -> SqlResult<()> {
    let conn = db.conn();
    let now = Utc::now().to_rfc3339();

    // Spec calls this a "default user" with display_name='Test User',
    // but the actual `local_users` schema is (username, created_at,
    // sync_status) — there is no display_name column. The migration
    // already inserted ('default_user', _, 'synced'); we keep that
    // and rely on it being present rather than fight the schema.
    // INSERT OR IGNORE is defensive in case a future migration
    // changes that default.
    conn.execute(
        "INSERT OR IGNORE INTO local_users (username, created_at, sync_status) \
         VALUES ('default_user', ?1, 'synced')",
        rusqlite::params![now],
    )?;

    // courses columns (post-migration):
    //   id, title, description, keywords, syllabus_info, user_id,
    //   is_deleted, canvas_course_id, created_at, updated_at
    // The `name` field referenced in the S0.4 spec is `title` in the
    // actual schema — we use `title='Test Course'`.
    conn.execute(
        "INSERT OR IGNORE INTO courses \
         (id, title, description, keywords, user_id, is_deleted, created_at, updated_at) \
         VALUES ('c1', 'Test Course', NULL, NULL, 'default_user', 0, ?1, ?1)",
        rusqlite::params![now],
    )?;

    // lectures columns: id, course_id, title, date, duration,
    //   pdf_path, audio_path, video_path, status, created_at,
    //   updated_at, is_deleted. Same `name`→`title` mapping.
    conn.execute(
        "INSERT OR IGNORE INTO lectures \
         (id, course_id, title, date, duration, pdf_path, audio_path, video_path, \
          status, created_at, updated_at, is_deleted) \
         VALUES ('l1', 'c1', 'Test Lec', ?1, 0, NULL, NULL, NULL, 'completed', ?1, ?1, 0)",
        rusqlite::params![now],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_test_db_can_open_in_memory() {
        // Compilation + a non-panicking call is the contract here.
        // If init_tables ever regresses against a virgin DB this test
        // catches it before any other suite even runs.
        let _db = make_test_db();
    }

    #[test]
    fn seed_minimal_inserts_one_lecture() {
        let db = make_test_db();
        seed_minimal(&db);

        let count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM lectures", [], |row| row.get(0))
            .expect("COUNT(*) FROM lectures should succeed");
        assert_eq!(
            count, 1,
            "seed_minimal should leave exactly one lecture row"
        );

        // Sanity-check the joined shape so future cascade-delete tests
        // can rely on the FK chain being intact.
        let course_id: String = db
            .conn()
            .query_row(
                "SELECT course_id FROM lectures WHERE id = 'l1'",
                [],
                |row| row.get(0),
            )
            .expect("lecture l1 should exist");
        assert_eq!(course_id, "c1");
    }

    /// Re-seeding the same DB shouldn't blow up — the cascade-delete
    /// suite will sometimes restore data and re-seed in the same test.
    #[test]
    fn seed_minimal_is_idempotent() {
        let db = make_test_db();
        seed_minimal(&db);
        seed_minimal(&db);
        let count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM lectures", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    // ============================================================
    // Phase 7 S3.f-RS — cascade delete + restore + hard delete +
    // schema migration. The new column set (cascade_deleted_with,
    // deleted_at, started_at_ms, summary_status, …) plus the trash-bin
    // semantics live here. Tests exercise the public `Database` methods
    // so they cover the same code path the Tauri commands invoke.
    // ============================================================

    /// Helper: insert a second lecture under the existing seed course.
    /// Useful for fixtures where we need to distinguish individually-
    /// trashed lectures from cascade-trashed ones.
    fn insert_lecture(db: &Database, lecture_id: &str, course_id: &str) {
        let now = Utc::now().to_rfc3339();
        db.conn()
            .execute(
                "INSERT INTO lectures (id, course_id, title, date, duration, pdf_path, audio_path, \
                 video_path, status, created_at, updated_at, is_deleted) \
                 VALUES (?1, ?2, ?3, ?1, 0, NULL, NULL, NULL, 'completed', ?1, ?1, 0)",
                rusqlite::params![lecture_id, course_id, "Extra Lec"],
            )
            .expect("insert_lecture failed");
        // Set timestamps explicitly via UPDATE because we re-used ?1 as
        // a sentinel — repair the date/created/updated to match `now`.
        db.conn()
            .execute(
                "UPDATE lectures SET date = ?2, created_at = ?2, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![lecture_id, now],
            )
            .unwrap();
    }

    fn lecture_is_deleted(db: &Database, id: &str) -> i64 {
        db.conn()
            .query_row(
                "SELECT is_deleted FROM lectures WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
    }

    fn lecture_cascade_marker(db: &Database, id: &str) -> Option<String> {
        db.conn()
            .query_row(
                "SELECT cascade_deleted_with FROM lectures WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
    }

    /// S3.f-RS-2 schema-migration smoke test: every Phase 7 column
    /// should exist on the empty in-memory DB after `init_tables`. If
    /// `run_v8_migration` regresses (forgets a column, or guards
    /// incorrectly so the ALTER never runs) this test detects it
    /// before any cascade-delete logic is exercised.
    #[test]
    fn migration_v8_adds_phase7_columns() {
        let db = make_test_db();

        // lectures
        let lec_cols: Vec<String> = db
            .conn()
            .prepare("PRAGMA table_info(lectures)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        for col in [
            "started_at_ms",
            "summary_status",
            "summary_provider",
            "import_source",
            "cascade_deleted_with",
            "deleted_at",
        ] {
            assert!(
                lec_cols.iter().any(|c| c == col),
                "lectures missing column {col}"
            );
        }

        // notes
        let note_cols: Vec<String> = db
            .conn()
            .prepare("PRAGMA table_info(notes)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        for col in ["summary", "status", "provider"] {
            assert!(
                note_cols.iter().any(|c| c == col),
                "notes missing column {col}"
            );
        }

        // settings
        let set_cols: Vec<String> = db
            .conn()
            .prepare("PRAGMA table_info(settings)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            set_cols.iter().any(|c| c == "user_id"),
            "settings missing user_id"
        );

        // courses (Phase 7 added deleted_at for the trash-bin sweep)
        let course_cols: Vec<String> = db
            .conn()
            .prepare("PRAGMA table_info(courses)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            course_cols.iter().any(|c| c == "deleted_at"),
            "courses missing deleted_at"
        );
    }

    /// Idempotency: running `init_tables` twice (which is what every
    /// new `Connection::open` does in production) must not blow up on
    /// duplicate ALTER TABLE.
    #[test]
    fn migration_v8_is_idempotent() {
        let db = make_test_db();
        // The init_tables runs are guarded; explicit re-call to stress
        // the column-exists detection.
        db.init_tables().expect("first re-init");
        db.init_tables().expect("second re-init");
    }

    /// S3.f-RS-3 cascade delete: deleting a course with two lectures
    /// soft-deletes both lectures, stamps cascade_deleted_with, and
    /// stamps deleted_at on every row. Exercises the transaction
    /// boundary in `delete_course`.
    #[test]
    fn delete_course_cascades_lectures() {
        let db = make_test_db();
        seed_minimal(&db);
        insert_lecture(&db, "l2", "c1");

        db.delete_course("c1").expect("delete_course");

        // Both lectures soft-deleted.
        assert_eq!(lecture_is_deleted(&db, "l1"), 1);
        assert_eq!(lecture_is_deleted(&db, "l2"), 1);

        // Both lectures marked with the cascade source.
        assert_eq!(lecture_cascade_marker(&db, "l1").as_deref(), Some("c1"));
        assert_eq!(lecture_cascade_marker(&db, "l2").as_deref(), Some("c1"));

        // Course itself is soft-deleted with deleted_at populated.
        let (course_deleted, course_deleted_at): (i64, Option<i64>) = db
            .conn()
            .query_row(
                "SELECT is_deleted, deleted_at FROM courses WHERE id = 'c1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(course_deleted, 1);
        assert!(course_deleted_at.is_some(), "course.deleted_at should be set");
    }

    /// Cascade should NOT touch lectures that were already individually
    /// trashed BEFORE the course delete — that's the whole point of the
    /// `cascade_deleted_with` marker. Without this guard, a later
    /// `restore_course` would silently revive a lecture the user had
    /// already discarded.
    #[test]
    fn delete_course_skips_already_deleted_lectures() {
        let db = make_test_db();
        seed_minimal(&db);
        insert_lecture(&db, "l2", "c1");

        // Individually delete l1 first (no cascade marker).
        db.delete_lecture("l1").unwrap();
        assert_eq!(lecture_cascade_marker(&db, "l1"), None);

        // Now cascade-delete the course.
        db.delete_course("c1").unwrap();

        // l1 stays without the cascade marker (its trashing pre-dated
        // the course delete).
        assert_eq!(lecture_cascade_marker(&db, "l1"), None);
        // l2 picked up the cascade marker.
        assert_eq!(lecture_cascade_marker(&db, "l2").as_deref(), Some("c1"));
    }

    /// S3.f-RS-3: restoring a lecture whose course is alive must
    /// succeed and clear is_deleted / deleted_at / cascade marker.
    #[test]
    fn restore_lecture_when_course_alive_succeeds() {
        let db = make_test_db();
        seed_minimal(&db);

        db.delete_lecture("l1").unwrap();
        assert_eq!(lecture_is_deleted(&db, "l1"), 1);

        db.restore_lecture("l1").expect("restore_lecture");

        assert_eq!(lecture_is_deleted(&db, "l1"), 0);
        let deleted_at: Option<i64> = db
            .conn()
            .query_row(
                "SELECT deleted_at FROM lectures WHERE id = 'l1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_none(), "deleted_at should clear on restore");
    }

    /// S3.f-RS-3: restoring a lecture whose parent course is itself
    /// trashed must error. Without this guard the restored lecture
    /// would be invisible (joined queries filter out lectures whose
    /// course is_deleted=1) and the user would get a "where did my
    /// lecture go" silent failure.
    #[test]
    fn restore_lecture_when_course_dead_returns_error() {
        let db = make_test_db();
        seed_minimal(&db);

        db.delete_course("c1").unwrap(); // cascades to l1
        let result = db.restore_lecture("l1");

        assert!(result.is_err(), "should refuse to restore orphaned lecture");
        let msg = format!("{}", result.unwrap_err());
        assert!(
            msg.contains("仍在垃圾桶") || msg.to_lowercase().contains("constraint"),
            "error should mention parent course; got: {msg}"
        );
        // l1 should still be soft-deleted.
        assert_eq!(lecture_is_deleted(&db, "l1"), 1);
    }

    /// S3.f-RS-3: `restore_course` reverse-cascade brings back ONLY
    /// lectures that were cascade-deleted with this course, not
    /// previously-individually-deleted siblings.
    #[test]
    fn restore_course_brings_back_cascaded_lectures_only() {
        let db = make_test_db();
        seed_minimal(&db);
        insert_lecture(&db, "l2", "c1");

        // Trash l1 individually first.
        db.delete_lecture("l1").unwrap();
        // Now cascade-delete the course (only l2 picks up marker).
        db.delete_course("c1").unwrap();

        let restored = db.restore_course("c1").expect("restore_course");
        // Exactly one lecture (l2) should have been resurrected.
        assert_eq!(restored, 1);

        // l2 alive, l1 still trashed.
        assert_eq!(lecture_is_deleted(&db, "l2"), 0);
        assert_eq!(lecture_is_deleted(&db, "l1"), 1);
        // Marker cleared on l2.
        assert_eq!(lecture_cascade_marker(&db, "l2"), None);
    }

    /// S3.f-RS-3 + §9.5 W3: rows older than `days` get hard-deleted;
    /// fresher rows survive. Uses raw SQL to backdate `deleted_at`
    /// because we can't time-travel the test wall clock.
    #[test]
    fn hard_delete_trashed_older_than_30_days() {
        let db = make_test_db();
        seed_minimal(&db);
        insert_lecture(&db, "l2", "c1");

        let now_ms: i64 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let day_ms: i64 = 86_400_000;

        // l1 deleted 31 days ago — should be purged.
        db.conn()
            .execute(
                "UPDATE lectures SET is_deleted = 1, deleted_at = ?1 WHERE id = 'l1'",
                rusqlite::params![now_ms - 31 * day_ms],
            )
            .unwrap();
        // l2 deleted 5 days ago — should survive.
        db.conn()
            .execute(
                "UPDATE lectures SET is_deleted = 1, deleted_at = ?1 WHERE id = 'l2'",
                rusqlite::params![now_ms - 5 * day_ms],
            )
            .unwrap();

        let purged = db.hard_delete_trashed_older_than(30, "default_user").expect("hard_delete");

        assert_eq!(purged, vec!["l1".to_string()]);

        // l1 physically gone, l2 still there.
        let still_have_l1: bool = db
            .conn()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lectures WHERE id = 'l1')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!still_have_l1, "l1 should have been physically deleted");
        let still_have_l2: bool = db
            .conn()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lectures WHERE id = 'l2')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(still_have_l2, "l2 (5 days) should survive");
    }

    /// `hard_delete_trashed_older_than` should be safe to call on an
    /// empty trash — App.tsx invokes it on every boot, including the
    /// first launch.
    #[test]
    fn hard_delete_trashed_older_than_empty_trash_is_noop() {
        let db = make_test_db();
        seed_minimal(&db);
        let purged = db.hard_delete_trashed_older_than(30, "default_user").unwrap();
        assert!(purged.is_empty());
    }

    /// cp75.6: hard_delete must NOT touch other users' trash. User A's
    /// expired lecture survives a sweep run as user B.
    #[test]
    fn hard_delete_trashed_older_than_skips_other_user() {
        let db = make_test_db();
        let now = chrono::Utc::now().to_rfc3339();

        // Two users, each with one course + one trashed lecture > 30 days old.
        db.conn().execute(
            "INSERT INTO local_users (username, created_at, sync_status) \
             VALUES ('alice', ?1, 'synced'), ('bob', ?1, 'synced')",
            rusqlite::params![now],
        ).unwrap();
        db.conn().execute(
            "INSERT INTO courses (id, title, description, keywords, user_id, is_deleted, created_at, updated_at) \
             VALUES ('ca', 'Alice Course', NULL, NULL, 'alice', 0, ?1, ?1), \
                    ('cb', 'Bob Course', NULL, NULL, 'bob', 0, ?1, ?1)",
            rusqlite::params![now],
        ).unwrap();
        let now_ms: i64 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        let day_ms: i64 = 86_400_000;
        db.conn().execute(
            "INSERT INTO lectures \
                (id, course_id, title, date, duration, status, is_deleted, deleted_at, created_at, updated_at) \
             VALUES ('la', 'ca', 'A lec', '2026-01-01', 0, 'completed', 1, ?1, ?2, ?2), \
                    ('lb', 'cb', 'B lec', '2026-01-01', 0, 'completed', 1, ?1, ?2, ?2)",
            rusqlite::params![now_ms - 31 * day_ms, now],
        ).unwrap();

        // Bob runs the boot sweep — Alice's expired lecture must survive.
        let purged = db.hard_delete_trashed_older_than(30, "bob").unwrap();
        assert_eq!(purged, vec!["lb".to_string()]);
        let alice_still_there: bool = db.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM lectures WHERE id = 'la')", [], |r| r.get(0),
        ).unwrap();
        assert!(alice_still_there, "Alice's expired lecture must NOT be touched by Bob's sweep");
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 7 cp74.1 — subtitle two-axis schema (v9) + new commands
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn migration_v9_adds_subtitle_columns() {
        let db = make_test_db();
        let cols = db.column_names("subtitles").unwrap();
        assert!(cols.iter().any(|c| c == "source"), "missing source");
        assert!(cols.iter().any(|c| c == "fine_text"), "missing fine_text");
        assert!(
            cols.iter().any(|c| c == "fine_translation"),
            "missing fine_translation"
        );
        assert!(
            cols.iter().any(|c| c == "fine_confidence"),
            "missing fine_confidence"
        );
    }

    #[test]
    fn migration_v9_reverses_v8_type_live_to_rough() {
        // Simulate a v8-mislabeled row by directly inserting type='live'.
        // After init_tables runs (which calls v9), the row should flip
        // back to 'rough' with source='live'.
        let db = make_test_db();
        seed_minimal(&db);
        // Need a lecture to attach to — seed_minimal made l1.
        // Direct INSERT bypassing save_subtitle to plant the legacy state.
        let conn = db.conn();
        conn.execute(
            "INSERT INTO subtitles (id, lecture_id, timestamp, text_en, text_zh, type, confidence, created_at, source) \
             VALUES ('s-legacy', 'l1', 0.0, 'hi', NULL, 'live', NULL, '2026-04-28T00:00:00Z', 'live')",
            [],
        )
        .unwrap();

        // Re-run init_tables — v9 migration is idempotent and should
        // catch the type='live' row.
        db.init_tables().unwrap();

        let (typ, src): (String, String) = conn
            .query_row(
                "SELECT type, source FROM subtitles WHERE id = 's-legacy'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(typ, "rough");
        assert_eq!(src, "live");
    }

    #[test]
    fn save_and_get_subtitle_round_trips_new_fields() {
        let db = make_test_db();
        seed_minimal(&db);

        let mut sub = crate::storage::models::Subtitle::new(
            "l1".to_string(),
            12.345,
            "hello world".to_string(),
            Some("你好".to_string()),
            "rough".to_string(),
            Some(0.91),
        );
        sub.source = "live".to_string();
        sub.fine_text = Some("hello, world!".to_string());
        sub.fine_translation = Some("你好，世界！".to_string());
        sub.fine_confidence = Some(0.99);

        db.save_subtitle(&sub).unwrap();

        let got = db.get_subtitles("l1").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].source, "live");
        assert_eq!(got[0].fine_text.as_deref(), Some("hello, world!"));
        assert_eq!(got[0].fine_translation.as_deref(), Some("你好，世界！"));
        assert_eq!(got[0].fine_confidence, Some(0.99));
    }

    #[test]
    fn save_subtitle_legacy_caller_defaults_source_to_live() {
        // Subtitle::new() defaults source='live', fine_*=None — verify
        // that path persists to DB without complaint.
        let db = make_test_db();
        seed_minimal(&db);
        let sub = crate::storage::models::Subtitle::new(
            "l1".to_string(),
            0.0,
            "rough only".to_string(),
            None,
            "rough".to_string(),
            None,
        );
        db.save_subtitle(&sub).unwrap();
        let got = db.get_subtitles("l1").unwrap();
        assert_eq!(got[0].source, "live");
        assert!(got[0].fine_text.is_none());
    }

    #[test]
    fn hard_delete_lectures_by_ids_purges_only_trashed() {
        // Seed: l1 (live), l2 (trashed). Caller asks to purge both.
        let db = make_test_db();
        seed_minimal(&db);
        let conn = db.conn();
        conn.execute(
            "INSERT INTO lectures \
                (id, course_id, title, date, status, duration, is_deleted, deleted_at, created_at, updated_at) \
             VALUES ('l2', 'c1', 'trashed lec', '2026-04-28', 'completed', 0, 1, \
                strftime('%s', 'now')*1000, strftime('%s', 'now'), strftime('%s', 'now'))",
            [],
        )
        .unwrap();

        let purged = db
            .hard_delete_lectures_by_ids(&["l1".to_string(), "l2".to_string()])
            .unwrap();
        // Only l2 was trashed; l1 (live) is silently skipped.
        assert_eq!(purged, vec!["l2".to_string()]);

        // Confirm l1 still exists, l2 is gone.
        let l1_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lectures WHERE id = 'l1')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let l2_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lectures WHERE id = 'l2')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(l1_exists);
        assert!(!l2_exists);
    }

    #[test]
    fn hard_delete_lectures_by_ids_empty_input_is_noop() {
        let db = make_test_db();
        seed_minimal(&db);
        let purged = db.hard_delete_lectures_by_ids(&[]).unwrap();
        assert!(purged.is_empty());
    }
}
