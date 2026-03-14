use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::{
  ActiveSegmentContribution, ActiveSession, AppSettings, PlaylistRecord, PlaylistStat, ScenarioRef,
  StatsOverview, TrackerDiagnostics, UpdateSettingsInput,
};

const SETTINGS_SESSION_PATH_OVERRIDE: &str = "session_path_override";
const SETTINGS_START_WITH_WINDOWS: &str = "start_with_windows";
const SETTINGS_MINIMIZE_TO_TRAY: &str = "minimize_to_tray";
const SETTINGS_AUTO_CHECK_UPDATES: &str = "auto_check_updates";
const SETTINGS_REFRESH_INTERVAL_SECONDS: &str = "refresh_interval_seconds";
const UNMAPPED_PLAYLIST_NAME: &str = "Unmapped Playlist";
const DEFAULT_REFRESH_INTERVAL_SECONDS: i64 = 60;

#[derive(Clone, Debug)]
pub struct Database {
  path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct NewSegment {
  pub started_at: i64,
  pub ended_at: i64,
  pub scenario_path: String,
  pub scenario_name: String,
  pub playlist_in_progress: bool,
}

impl Database {
  pub fn new(path: PathBuf) -> Self {
    Self { path }
  }

  pub fn init_schema(&self) -> Result<(), String> {
    if let Some(parent) = self.path.parent() {
      fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create app data directory {}: {error}", parent.display()))?;
    }

    let conn = self.connection()?;
    conn
      .execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS segments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at INTEGER NOT NULL,
          ended_at INTEGER NOT NULL,
          seconds INTEGER NOT NULL,
          scenario_path TEXT NOT NULL,
          scenario_name TEXT NOT NULL,
          playlist_in_progress INTEGER NOT NULL,
          playlist_id INTEGER,
          FOREIGN KEY(playlist_id) REFERENCES playlists(id)
        );

        CREATE INDEX IF NOT EXISTS idx_segments_scenario_path ON segments (scenario_path);
        CREATE INDEX IF NOT EXISTS idx_segments_playlist ON segments (playlist_id);
        CREATE INDEX IF NOT EXISTS idx_segments_started_at ON segments (started_at);

        CREATE TABLE IF NOT EXISTS playlists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS playlist_scenario_map (
          playlist_id INTEGER NOT NULL,
          scenario_path TEXT NOT NULL UNIQUE,
          PRIMARY KEY (playlist_id, scenario_path),
          FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        "#,
      )
      .map_err(|error| format!("failed to initialize sqlite schema: {error}"))?;

    self.upsert_setting(SETTINGS_SESSION_PATH_OVERRIDE, "")?;
    self.upsert_setting(SETTINGS_START_WITH_WINDOWS, "1")?;
    self.upsert_setting(SETTINGS_MINIMIZE_TO_TRAY, "1")?;
    self.upsert_setting(SETTINGS_AUTO_CHECK_UPDATES, "1")?;
    self.upsert_setting(
      SETTINGS_REFRESH_INTERVAL_SECONDS,
      &DEFAULT_REFRESH_INTERVAL_SECONDS.to_string(),
    )?;
    Ok(())
  }

  pub fn default_session_path() -> Option<PathBuf> {
    let local_app_data = env::var("LOCALAPPDATA").ok()?;
    Some(
      PathBuf::from(local_app_data)
        .join("FPSAimTrainer")
        .join("Saved")
        .join("SaveGames")
        .join("session.sav"),
    )
  }

  pub fn get_session_path(&self) -> Result<PathBuf, String> {
    let settings = self.get_settings()?;
    Ok(self.resolve_session_path(&settings))
  }

  pub fn resolve_session_path(&self, settings: &AppSettings) -> PathBuf {
    if let Some(path) = settings
      .session_path_override
      .as_ref()
      .map(|value| value.trim())
      .filter(|value| !value.is_empty())
    {
      return PathBuf::from(path);
    }

    Self::default_session_path().unwrap_or_else(|| PathBuf::from("session.sav"))
  }

  pub fn get_settings(&self) -> Result<AppSettings, String> {
    let conn = self.connection()?;
    let session_override = self
      .get_setting_from_conn(&conn, SETTINGS_SESSION_PATH_OVERRIDE)?
      .and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
          None
        } else {
          Some(trimmed)
        }
      });
    let start_with_windows = self
      .get_setting_from_conn(&conn, SETTINGS_START_WITH_WINDOWS)?
      .as_deref()
      .map(parse_bool)
      .unwrap_or(true);
    let minimize_to_tray = self
      .get_setting_from_conn(&conn, SETTINGS_MINIMIZE_TO_TRAY)?
      .as_deref()
      .map(parse_bool)
      .unwrap_or(true);
    let auto_check_updates = self
      .get_setting_from_conn(&conn, SETTINGS_AUTO_CHECK_UPDATES)?
      .as_deref()
      .map(parse_bool)
      .unwrap_or(true);
    let refresh_interval_seconds = self
      .get_setting_from_conn(&conn, SETTINGS_REFRESH_INTERVAL_SECONDS)?
      .as_deref()
      .and_then(|value| value.parse::<i64>().ok())
      .map(|value| value.clamp(15, 15 * 60))
      .unwrap_or(DEFAULT_REFRESH_INTERVAL_SECONDS);

    Ok(AppSettings {
      session_path_override: session_override,
      start_with_windows,
      minimize_to_tray,
      auto_check_updates,
      refresh_interval_seconds,
    })
  }

  pub fn update_settings(&self, input: UpdateSettingsInput) -> Result<AppSettings, String> {
    let current = self.get_settings()?;
    let next = AppSettings {
      session_path_override: input.session_path_override.or(current.session_path_override),
      start_with_windows: input.start_with_windows.unwrap_or(current.start_with_windows),
      minimize_to_tray: input.minimize_to_tray.unwrap_or(current.minimize_to_tray),
      auto_check_updates: input.auto_check_updates.unwrap_or(current.auto_check_updates),
      refresh_interval_seconds: input
        .refresh_interval_seconds
        .unwrap_or(current.refresh_interval_seconds)
        .clamp(15, 15 * 60),
    };

    let override_value = next
      .session_path_override
      .as_deref()
      .map(str::trim)
      .unwrap_or_default()
      .to_string();
    self.upsert_setting(SETTINGS_SESSION_PATH_OVERRIDE, &override_value)?;
    self.upsert_setting(
      SETTINGS_START_WITH_WINDOWS,
      if next.start_with_windows { "1" } else { "0" },
    )?;
    self.upsert_setting(
      SETTINGS_MINIMIZE_TO_TRAY,
      if next.minimize_to_tray { "1" } else { "0" },
    )?;
    self.upsert_setting(
      SETTINGS_AUTO_CHECK_UPDATES,
      if next.auto_check_updates { "1" } else { "0" },
    )?;
    self.upsert_setting(
      SETTINGS_REFRESH_INTERVAL_SECONDS,
      &next.refresh_interval_seconds.to_string(),
    )?;
    self.get_settings()
  }

  pub fn create_playlist(&self, name: &str) -> Result<PlaylistRecord, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
      return Err("playlist name cannot be empty".to_string());
    }

    let conn = self.connection()?;
    conn
      .execute(
        "INSERT INTO playlists(name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        params![normalized],
      )
      .map_err(|error| format!("failed to create playlist: {error}"))?;

    let id = conn
      .query_row(
        "SELECT id FROM playlists WHERE name = ?1",
        params![normalized],
        |row| row.get::<_, i64>(0),
      )
      .map_err(|error| format!("failed to fetch playlist id: {error}"))?;

    Ok(PlaylistRecord {
      id,
      name: normalized.to_string(),
      scenario_paths: Vec::new(),
    })
  }

  pub fn get_playlists(&self) -> Result<Vec<PlaylistRecord>, String> {
    let conn = self.connection()?;
    let mut playlists_stmt = conn
      .prepare("SELECT id, name FROM playlists ORDER BY name COLLATE NOCASE ASC")
      .map_err(|error| format!("failed to prepare playlist query: {error}"))?;
    let mut playlists = playlists_stmt
      .query_map([], |row| {
        Ok(PlaylistRecord {
          id: row.get(0)?,
          name: row.get(1)?,
          scenario_paths: Vec::new(),
        })
      })
      .map_err(|error| format!("failed to read playlists: {error}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to decode playlist row: {error}"))?;

    let mut mappings_stmt = conn
      .prepare("SELECT playlist_id, scenario_path FROM playlist_scenario_map")
      .map_err(|error| format!("failed to prepare playlist mapping query: {error}"))?;
    let mapping_rows = mappings_stmt
      .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
      .map_err(|error| format!("failed to read playlist mappings: {error}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to decode playlist mapping row: {error}"))?;

    let mut lookup = HashMap::<i64, Vec<String>>::new();
    for (playlist_id, scenario_path) in mapping_rows {
      lookup.entry(playlist_id).or_default().push(scenario_path);
    }

    for playlist in &mut playlists {
      if let Some(paths) = lookup.remove(&playlist.id) {
        let mut normalized = paths;
        normalized.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
        playlist.scenario_paths = normalized;
      }
    }

    Ok(playlists)
  }

  pub fn set_playlist_mappings(&self, playlist_id: i64, scenario_paths: Vec<String>) -> Result<(), String> {
    let mut conn = self.connection()?;
    let transaction = conn
      .transaction()
      .map_err(|error| format!("failed to open transaction: {error}"))?;

    let playlist_exists = transaction
      .query_row(
        "SELECT EXISTS(SELECT 1 FROM playlists WHERE id = ?1)",
        params![playlist_id],
        |row| row.get::<_, i64>(0),
      )
      .map_err(|error| format!("failed to validate playlist id: {error}"))?
      == 1;
    if !playlist_exists {
      return Err("playlist does not exist".to_string());
    }

    transaction
      .execute(
        "DELETE FROM playlist_scenario_map WHERE playlist_id = ?1",
        params![playlist_id],
      )
      .map_err(|error| format!("failed to remove old playlist mappings: {error}"))?;

    let mut unique_paths = HashSet::<String>::new();
    for raw in scenario_paths {
      let normalized = raw.trim();
      if normalized.is_empty() {
        continue;
      }
      unique_paths.insert(normalized.to_string());
    }

    for scenario_path in unique_paths {
      transaction
        .execute(
          r#"
          INSERT INTO playlist_scenario_map(playlist_id, scenario_path)
          VALUES(?1, ?2)
          ON CONFLICT(scenario_path) DO UPDATE SET playlist_id = excluded.playlist_id
          "#,
          params![playlist_id, scenario_path],
        )
        .map_err(|error| format!("failed to insert playlist mapping: {error}"))?;
    }

    Self::recompute_segment_playlist_ids(&transaction)?;
    transaction
      .commit()
      .map_err(|error| format!("failed to commit playlist mapping transaction: {error}"))?;
    Ok(())
  }

  pub fn insert_segment(&self, segment: NewSegment) -> Result<(), String> {
    if segment.ended_at <= segment.started_at {
      return Ok(());
    }

    let conn = self.connection()?;
    let playlist_id = if segment.playlist_in_progress {
      Self::resolve_playlist_id_for_scenario_with_conn(&conn, &segment.scenario_path)?
    } else {
      None
    };

    let seconds = segment.ended_at - segment.started_at;
    conn
      .execute(
        r#"
        INSERT INTO segments (
          started_at,
          ended_at,
          seconds,
          scenario_path,
          scenario_name,
          playlist_in_progress,
          playlist_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
          segment.started_at,
          segment.ended_at,
          seconds,
          segment.scenario_path,
          segment.scenario_name,
          if segment.playlist_in_progress { 1 } else { 0 },
          playlist_id
        ],
      )
      .map_err(|error| format!("failed to insert segment: {error}"))?;
    Ok(())
  }

  pub fn get_scenarios(&self, active: Option<ActiveSegmentContribution>) -> Result<Vec<ScenarioRef>, String> {
    Ok(self.get_stats_overview(active)?.scenarios)
  }

  pub fn get_stats_overview(
    &self,
    active: Option<ActiveSegmentContribution>,
  ) -> Result<StatsOverview, String> {
    self.get_stats_overview_with_diagnostics(active, TrackerDiagnostics::default())
  }

  pub fn get_stats_overview_with_diagnostics(
    &self,
    active: Option<ActiveSegmentContribution>,
    diagnostics: TrackerDiagnostics,
  ) -> Result<StatsOverview, String> {
    let conn = self.connection()?;
    let mut total_seconds = conn
      .query_row("SELECT COALESCE(SUM(seconds), 0) FROM segments", [], |row| {
        row.get::<_, i64>(0)
      })
      .map_err(|error| format!("failed to compute total playtime: {error}"))?;

    let mut scenarios = self.query_scenarios(&conn)?;
    let mut playlists = self.query_playlists(&conn)?;
    let mut unmapped_playlist_seconds = conn
      .query_row(
        "SELECT COALESCE(SUM(seconds), 0) FROM segments WHERE playlist_in_progress = 1 AND playlist_id IS NULL",
        [],
        |row| row.get::<_, i64>(0),
      )
      .map_err(|error| format!("failed to compute unmapped playlist totals: {error}"))?;

    let active_session = if let Some(active_segment) = active {
      let now = current_unix_seconds();
      let elapsed = (now - active_segment.started_at).max(0);
      total_seconds += elapsed;
      Self::add_or_update_scenario(
        &mut scenarios,
        &active_segment.scenario_path,
        &active_segment.scenario_name,
        elapsed,
      );

      if active_segment.playlist_in_progress {
        let active_playlist_id =
          Self::resolve_playlist_id_for_scenario_with_conn(&conn, &active_segment.scenario_path)?;
        if let Some(playlist_id) = active_playlist_id {
          Self::add_or_update_playlist(&mut playlists, Some(playlist_id), elapsed);
        } else {
          unmapped_playlist_seconds += elapsed;
        }
      }

      ActiveSession {
        is_tracking: true,
        scenario_path: Some(active_segment.scenario_path),
        scenario_name: Some(active_segment.scenario_name),
        started_at: Some(active_segment.started_at),
      }
    } else {
      ActiveSession::default()
    };

    scenarios.sort_by(|left, right| {
      right
        .total_seconds
        .cmp(&left.total_seconds)
        .then_with(|| left.scenario_name.to_lowercase().cmp(&right.scenario_name.to_lowercase()))
    });
    playlists.sort_by(|left, right| left.playlist_name.to_lowercase().cmp(&right.playlist_name.to_lowercase()));

    playlists.push(PlaylistStat {
      playlist_id: None,
      playlist_name: UNMAPPED_PLAYLIST_NAME.to_string(),
      total_seconds: unmapped_playlist_seconds,
    });

    Ok(StatsOverview {
      total_seconds,
      scenarios,
      playlists,
      active_session,
      diagnostics,
    })
  }

  fn query_scenarios(&self, conn: &Connection) -> Result<Vec<ScenarioRef>, String> {
    let mut stmt = conn
      .prepare(
        r#"
        SELECT
          scenario_path,
          MAX(scenario_name) AS scenario_name,
          SUM(seconds) AS total_seconds
        FROM segments
        GROUP BY scenario_path
        ORDER BY total_seconds DESC
        "#,
      )
      .map_err(|error| format!("failed to prepare scenario totals query: {error}"))?;
    let scenarios = stmt
      .query_map([], |row| {
        Ok(ScenarioRef {
          scenario_path: row.get(0)?,
          scenario_name: row.get(1)?,
          total_seconds: row.get(2)?,
        })
      })
      .map_err(|error| format!("failed to execute scenario totals query: {error}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to decode scenario totals row: {error}"))?;
    Ok(scenarios)
  }

  fn query_playlists(&self, conn: &Connection) -> Result<Vec<PlaylistStat>, String> {
    let mut stmt = conn
      .prepare(
        r#"
        SELECT
          p.id,
          p.name,
          COALESCE(SUM(s.seconds), 0) AS total_seconds
        FROM playlists p
        LEFT JOIN segments s ON s.playlist_id = p.id
        GROUP BY p.id, p.name
        "#,
      )
      .map_err(|error| format!("failed to prepare playlist totals query: {error}"))?;
    let playlists = stmt
      .query_map([], |row| {
        Ok(PlaylistStat {
          playlist_id: Some(row.get(0)?),
          playlist_name: row.get(1)?,
          total_seconds: row.get(2)?,
        })
      })
      .map_err(|error| format!("failed to execute playlist totals query: {error}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to decode playlist totals row: {error}"))?;
    Ok(playlists)
  }

  fn resolve_playlist_id_for_scenario_with_conn(
    conn: &Connection,
    scenario_path: &str,
  ) -> Result<Option<i64>, String> {
    conn
      .query_row(
        "SELECT playlist_id FROM playlist_scenario_map WHERE scenario_path = ?1",
        params![scenario_path],
        |row| row.get::<_, i64>(0),
      )
      .optional()
      .map_err(|error| format!("failed to resolve playlist mapping: {error}"))
  }

  fn recompute_segment_playlist_ids(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
      .execute(
        "UPDATE segments SET playlist_id = NULL WHERE playlist_in_progress = 1",
        [],
      )
      .map_err(|error| format!("failed to clear playlist ids before recompute: {error}"))?;
    transaction
      .execute(
        r#"
        UPDATE segments
        SET playlist_id = (
          SELECT playlist_id
          FROM playlist_scenario_map
          WHERE playlist_scenario_map.scenario_path = segments.scenario_path
        )
        WHERE playlist_in_progress = 1
        "#,
        [],
      )
      .map_err(|error| format!("failed to recompute segment playlist ids: {error}"))?;
    Ok(())
  }

  fn add_or_update_scenario(
    scenarios: &mut Vec<ScenarioRef>,
    scenario_path: &str,
    scenario_name: &str,
    elapsed: i64,
  ) {
    if elapsed <= 0 {
      return;
    }

    if let Some(existing) = scenarios
      .iter_mut()
      .find(|scenario| scenario.scenario_path == scenario_path)
    {
      existing.total_seconds += elapsed;
      return;
    }

    scenarios.push(ScenarioRef {
      scenario_path: scenario_path.to_string(),
      scenario_name: scenario_name.to_string(),
      total_seconds: elapsed,
    });
  }

  fn add_or_update_playlist(playlists: &mut Vec<PlaylistStat>, playlist_id: Option<i64>, elapsed: i64) {
    if elapsed <= 0 {
      return;
    }

    if let Some(existing) = playlists.iter_mut().find(|playlist| playlist.playlist_id == playlist_id) {
      existing.total_seconds += elapsed;
    }
  }

  fn upsert_setting(&self, key: &str, value: &str) -> Result<(), String> {
    let conn = self.connection()?;
    conn
      .execute(
        r#"
        INSERT INTO settings(key, value) VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        "#,
        params![key, value],
      )
      .map_err(|error| format!("failed to upsert setting {key}: {error}"))?;
    Ok(())
  }

  fn get_setting_from_conn(&self, conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn
      .query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
      )
      .optional()
      .map_err(|error| format!("failed to fetch setting {key}: {error}"))
  }

  fn connection(&self) -> Result<Connection, String> {
    let conn =
      Connection::open(&self.path).map_err(|error| format!("failed to open sqlite database: {error}"))?;
    conn
      .execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        "#,
      )
      .map_err(|error| format!("failed to configure sqlite pragmas: {error}"))?;
    Ok(conn)
  }
}

fn parse_bool(raw: &str) -> bool {
  matches!(raw, "1" | "true" | "TRUE" | "True")
}

fn current_unix_seconds() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs() as i64)
    .unwrap_or(0)
}

#[cfg(test)]
mod tests {
  use std::time::{SystemTime, UNIX_EPOCH};

  use super::{Database, NewSegment};
  use crate::types::UpdateSettingsInput;

  fn test_db() -> Database {
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock should be after unix epoch")
      .as_nanos();
    let db_path = std::env::temp_dir().join(format!("kovaak-stats-test-{unique}.db"));
    let db = Database::new(db_path);
    db.init_schema().expect("schema should initialize");
    db
  }

  #[test]
  fn aggregates_totals_for_scenarios_and_playlists() {
    let db = test_db();
    let created_playlist = db
      .create_playlist("VT Playlist")
      .expect("playlist should be created");
    db
      .set_playlist_mappings(created_playlist.id, vec!["scenario://a".to_string()])
      .expect("mapping should be stored");
    db
      .insert_segment(NewSegment {
        started_at: 10,
        ended_at: 20,
        scenario_path: "scenario://a".to_string(),
        scenario_name: "Scenario A".to_string(),
        playlist_in_progress: true,
      })
      .expect("segment a should be inserted");
    db
      .insert_segment(NewSegment {
        started_at: 20,
        ended_at: 30,
        scenario_path: "scenario://b".to_string(),
        scenario_name: "Scenario B".to_string(),
        playlist_in_progress: true,
      })
      .expect("segment b should be inserted");

    let overview = db.get_stats_overview(None).expect("stats should load");
    assert_eq!(overview.total_seconds, 20);
    assert_eq!(overview.scenarios.len(), 2);
    let mapped_playlist = overview
      .playlists
      .iter()
      .find(|playlist| playlist.playlist_id == Some(created_playlist.id))
      .expect("mapped playlist should exist");
    assert_eq!(mapped_playlist.total_seconds, 10);
    let unmapped = overview
      .playlists
      .iter()
      .find(|playlist| playlist.playlist_id.is_none())
      .expect("unmapped playlist bucket should exist");
    assert_eq!(unmapped.total_seconds, 10);
  }

  #[test]
  fn updates_settings_with_defaults() {
    let db = test_db();
    let updated = db
      .update_settings(UpdateSettingsInput {
        session_path_override: Some("C:\\sessions\\session.sav".to_string()),
        start_with_windows: Some(false),
        minimize_to_tray: Some(false),
        auto_check_updates: Some(false),
        refresh_interval_seconds: Some(120),
      })
      .expect("settings should update");
    assert_eq!(
      updated.session_path_override,
      Some("C:\\sessions\\session.sav".to_string())
    );
    assert!(!updated.start_with_windows);
    assert!(!updated.minimize_to_tray);
    assert!(!updated.auto_check_updates);
    assert_eq!(updated.refresh_interval_seconds, 120);
  }

  #[test]
  fn synthetic_timeline_matches_expected_totals() {
    let db = test_db();
    let playlist = db
      .create_playlist("Synthetic")
      .expect("playlist should be created");
    db
      .set_playlist_mappings(
        playlist.id,
        vec!["scenario://tracked".to_string(), "scenario://tracked-2".to_string()],
      )
      .expect("playlist mappings should be saved");

    let timeline = vec![
      NewSegment {
        started_at: 100,
        ended_at: 140,
        scenario_path: "scenario://tracked".to_string(),
        scenario_name: "Tracked A".to_string(),
        playlist_in_progress: true,
      },
      NewSegment {
        started_at: 140,
        ended_at: 200,
        scenario_path: "scenario://tracked-2".to_string(),
        scenario_name: "Tracked B".to_string(),
        playlist_in_progress: true,
      },
      NewSegment {
        started_at: 200,
        ended_at: 230,
        scenario_path: "scenario://freeplay".to_string(),
        scenario_name: "Freeplay".to_string(),
        playlist_in_progress: false,
      },
    ];

    for segment in timeline {
      db.insert_segment(segment)
        .expect("synthetic segment should insert");
    }

    let overview = db.get_stats_overview(None).expect("overview should load");
    assert_eq!(overview.total_seconds, 130);
    let tracked_a = overview
      .scenarios
      .iter()
      .find(|scenario| scenario.scenario_path == "scenario://tracked")
      .expect("tracked scenario should exist");
    assert_eq!(tracked_a.total_seconds, 40);
    let tracked_b = overview
      .scenarios
      .iter()
      .find(|scenario| scenario.scenario_path == "scenario://tracked-2")
      .expect("tracked scenario 2 should exist");
    assert_eq!(tracked_b.total_seconds, 60);
    let freeplay = overview
      .scenarios
      .iter()
      .find(|scenario| scenario.scenario_path == "scenario://freeplay")
      .expect("freeplay scenario should exist");
    assert_eq!(freeplay.total_seconds, 30);
  }
}
