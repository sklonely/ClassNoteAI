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
}
