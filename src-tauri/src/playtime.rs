use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use rusqlite::{params, Connection};
use serde::Deserialize;

use crate::types::{
  CoachReasonStats, CoachRecommendation, CoachRecommendationReason, ConsistencySummary,
  DailyPlaylistPlaytime, DailyPlaytime, HighlightsSummary, PlaylistPlaytime, PlaytimeSummary,
  ProgressCoach, QualityMetricType, QualitySample, ScenarioAnalytics, ScenarioPlaytime,
  ScenarioTrend, TrendHighlight, TrendStatus,
};

const STATS_FOLDER_SEGMENTS: [&str; 4] = ["steamapps", "common", "FPSAimTrainer", "FPSAimTrainer"];
const MAX_ATTEMPT_DURATION_HOURS: i64 = 4;
const SCORE_PREFIXES: [&str; 3] = ["Score:,", "Challenge Score:,", "Total Score:,"];
const ACCURACY_PREFIXES: [&str; 3] = ["Accuracy:,", "Hit Accuracy:,", "Acc:,"];
const TREND_WINDOW_7_DAYS_SECONDS: i64 = 7 * 24 * 60 * 60;
const TREND_WINDOW_30_DAYS_SECONDS: i64 = 30 * 24 * 60 * 60;
const TREND_WINDOW_90_DAYS_SECONDS: i64 = 90 * 24 * 60 * 60;
const TREND_MIN_RUNS_7_DAYS: usize = 3;
const TREND_MIN_RUNS_30_DAYS: usize = 5;
const TREND_DELTA_THRESHOLD: f64 = 0.03;
const COACH_SLOT_MINUTES: i64 = 5;
const COACH_SLOT_COUNT: usize = 4;
const HIGHLIGHT_LIMIT: usize = 3;
const RECENT_QUALITY_SAMPLE_LIMIT: usize = 12;
const APP_DATA_FOLDER: &str = "com.omaarr90.kovaakstats";
const CACHE_STATUS_PARSED: &str = "parsed";
const CACHE_STATUS_SKIPPED: &str = "skipped";

#[derive(Clone, Debug, PartialEq)]
struct AttemptQuality {
  metric_type: QualityMetricType,
  value: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct AttemptSummary {
  scenario_name: String,
  duration_seconds: i64,
  ended_at: i64,
  date_key: String,
  quality: Option<AttemptQuality>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PlaylistDefinition {
  name: String,
  scenario_names: Vec<String>,
  total_scenarios: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PlaylistAggregate {
  name: String,
  total_seconds: i64,
  matched_scenarios: i64,
  total_scenarios: i64,
}

#[derive(Default)]
struct DailyAccumulator {
  total_seconds: i64,
  attempt_count: i64,
  scenarios: HashMap<String, ScenarioPlaytime>,
}

#[derive(Clone, Debug)]
struct ScenarioAnalyticsBuild {
  scenario_key: String,
  analytics: ScenarioAnalytics,
  trend: Option<ScenarioTrend>,
  recent_personal_best: bool,
  days_since_last_played: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CachedFileMetadata {
  modified_ms: i64,
  file_size: i64,
}

#[derive(Clone, Debug)]
struct StatsFileMetadata {
  path: PathBuf,
  cache_key: String,
  modified_ms: i64,
  file_size: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistFile {
  playlist_name: Option<String>,
  scenario_list: Option<Vec<PlaylistScenarioEntry>>,
}

#[derive(Debug, Deserialize)]
struct PlaylistScenarioEntry {
  scenario_name: Option<String>,
}

pub fn read_kovaak_playtime() -> Result<PlaytimeSummary, String> {
  let stats_dir = find_stats_dir()?;
  let cache_path = analytics_cache_path()?;
  read_kovaak_playtime_from_paths(&stats_dir, &cache_path, Local::now().timestamp())
}

fn read_kovaak_playtime_from_paths(
  stats_dir: &Path,
  cache_path: &Path,
  now: i64,
) -> Result<PlaytimeSummary, String> {
  let (attempts, skipped_files) = sync_cached_attempts(stats_dir, cache_path)?;
  if attempts.is_empty() {
    return Err(format!(
      "No parseable KovaaK stats CSV files were found in {}.",
      stats_dir.display()
    ));
  }

  Ok(build_playtime_summary(&attempts, skipped_files, stats_dir, now))
}

fn analytics_cache_path() -> Result<PathBuf, String> {
  let root = env::var("LOCALAPPDATA")
    .map(PathBuf::from)
    .unwrap_or_else(|_| env::temp_dir());
  Ok(root.join(APP_DATA_FOLDER).join("analytics.sqlite"))
}

fn build_playtime_summary(
  attempts: &[AttemptSummary],
  skipped_files: i64,
  stats_dir: &Path,
  now: i64,
) -> PlaytimeSummary {
  let playlist_definitions = read_playlist_definitions(stats_dir);
  let total_seconds = attempts.iter().map(|attempt| attempt.duration_seconds).sum();
  let attempt_count = attempts.len() as i64;
  let last_attempt_at = attempts.iter().map(|attempt| attempt.ended_at).max();
  let scenarios = summarize_scenarios(attempts);
  let daily_summaries = summarize_daily_playtime(attempts, &playlist_definitions);
  let scenario_analytics = build_scenario_analytics(attempts, now);
  let consistency = build_consistency(&daily_summaries, now);
  let highlights = build_highlights(&scenario_analytics);
  let playlists = build_overall_playlist_totals_from_analytics(&playlist_definitions, &scenario_analytics);
  let progress_coach = build_progress_coach_from_analytics(&scenario_analytics);

  PlaytimeSummary {
    total_seconds,
    attempt_count,
    skipped_files,
    last_attempt_at,
    source_path: stats_dir.display().to_string(),
    scenarios,
    playlists,
    daily_summaries,
    consistency,
    highlights,
    scenario_analytics: scenario_analytics
      .iter()
      .map(|scenario| scenario.analytics.clone())
      .collect(),
    progress_coach,
  }
}

fn sync_cached_attempts(stats_dir: &Path, cache_path: &Path) -> Result<(Vec<AttemptSummary>, i64), String> {
  let stats_files = collect_stats_files(stats_dir)?;
  if let Some(parent) = cache_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("failed to create analytics cache directory {}: {error}", parent.display()))?;
  }

  let mut conn = Connection::open(cache_path)
    .map_err(|error| format!("failed to open analytics cache {}: {error}", cache_path.display()))?;
  conn
    .execute_batch(
      r#"
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS analytics_attempts (
        source_path TEXT PRIMARY KEY,
        modified_ms INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        parse_status TEXT NOT NULL,
        scenario_name TEXT,
        duration_seconds INTEGER,
        ended_at INTEGER,
        date_key TEXT,
        quality_type TEXT,
        quality_value REAL
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_attempts_status
      ON analytics_attempts(parse_status);
      "#,
    )
    .map_err(|error| format!("failed to initialize analytics cache schema: {error}"))?;

  let existing = load_cached_file_metadata(&conn)?;
  let transaction = conn
    .transaction()
    .map_err(|error| format!("failed to open analytics cache transaction: {error}"))?;
  let mut current_paths = HashSet::<String>::new();

  for file in stats_files {
    current_paths.insert(file.cache_key.clone());
    let should_refresh = existing
      .get(&file.cache_key)
      .map(|cached| cached.modified_ms != file.modified_ms || cached.file_size != file.file_size)
      .unwrap_or(true);
    if !should_refresh {
      continue;
    }

    match parse_attempt_file(&file.path) {
      Ok(Some(attempt)) => {
        let (quality_type, quality_value) = attempt
          .quality
          .as_ref()
          .map(|quality| (Some(quality_metric_key(quality.metric_type)), Some(quality.value)))
          .unwrap_or((None, None));
        transaction
          .execute(
            r#"
            INSERT INTO analytics_attempts(
              source_path,
              modified_ms,
              file_size,
              parse_status,
              scenario_name,
              duration_seconds,
              ended_at,
              date_key,
              quality_type,
              quality_value
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(source_path) DO UPDATE SET
              modified_ms = excluded.modified_ms,
              file_size = excluded.file_size,
              parse_status = excluded.parse_status,
              scenario_name = excluded.scenario_name,
              duration_seconds = excluded.duration_seconds,
              ended_at = excluded.ended_at,
              date_key = excluded.date_key,
              quality_type = excluded.quality_type,
              quality_value = excluded.quality_value
            "#,
            params![
              file.cache_key,
              file.modified_ms,
              file.file_size,
              CACHE_STATUS_PARSED,
              attempt.scenario_name,
              attempt.duration_seconds,
              attempt.ended_at,
              attempt.date_key,
              quality_type,
              quality_value,
            ],
          )
          .map_err(|error| format!("failed to write parsed analytics cache row: {error}"))?;
      }
      Ok(None) | Err(_) => {
        transaction
          .execute(
            r#"
            INSERT INTO analytics_attempts(
              source_path,
              modified_ms,
              file_size,
              parse_status,
              scenario_name,
              duration_seconds,
              ended_at,
              date_key,
              quality_type,
              quality_value
            ) VALUES(?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, NULL, NULL)
            ON CONFLICT(source_path) DO UPDATE SET
              modified_ms = excluded.modified_ms,
              file_size = excluded.file_size,
              parse_status = excluded.parse_status,
              scenario_name = excluded.scenario_name,
              duration_seconds = excluded.duration_seconds,
              ended_at = excluded.ended_at,
              date_key = excluded.date_key,
              quality_type = excluded.quality_type,
              quality_value = excluded.quality_value
            "#,
            params![file.cache_key, file.modified_ms, file.file_size, CACHE_STATUS_SKIPPED],
          )
          .map_err(|error| format!("failed to write skipped analytics cache row: {error}"))?;
      }
    }
  }

  for stale_path in existing.keys().filter(|path| !current_paths.contains(*path)) {
    transaction
      .execute(
        "DELETE FROM analytics_attempts WHERE source_path = ?1",
        params![stale_path],
      )
      .map_err(|error| format!("failed to delete stale analytics cache row: {error}"))?;
  }

  transaction
    .commit()
    .map_err(|error| format!("failed to commit analytics cache transaction: {error}"))?;

  load_cached_attempts(&conn)
}

fn collect_stats_files(stats_dir: &Path) -> Result<Vec<StatsFileMetadata>, String> {
  let entries = fs::read_dir(stats_dir)
    .map_err(|error| format!("failed to read stats directory {}: {error}", stats_dir.display()))?;
  let mut stats_files = Vec::<StatsFileMetadata>::new();

  for entry in entries.flatten() {
    let path = entry.path();
    if !matches!(path.extension().and_then(|value| value.to_str()), Some("csv")) {
      continue;
    }

    let metadata = fs::metadata(&path).ok();
    let modified_ms = metadata
      .as_ref()
      .and_then(|value| value.modified().ok())
      .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
      .map(|value| value.as_millis() as i64)
      .unwrap_or(0);
    let file_size = metadata.map(|value| value.len() as i64).unwrap_or(0);
    stats_files.push(StatsFileMetadata {
      cache_key: path.to_string_lossy().to_string(),
      path,
      modified_ms,
      file_size,
    });
  }

  stats_files.sort_by(|left, right| left.cache_key.cmp(&right.cache_key));
  Ok(stats_files)
}

fn load_cached_file_metadata(conn: &Connection) -> Result<HashMap<String, CachedFileMetadata>, String> {
  let mut stmt = conn
    .prepare("SELECT source_path, modified_ms, file_size FROM analytics_attempts")
    .map_err(|error| format!("failed to prepare analytics cache metadata query: {error}"))?;
  let rows = stmt
    .query_map([], |row| {
      Ok((
        row.get::<_, String>(0)?,
        CachedFileMetadata {
          modified_ms: row.get(1)?,
          file_size: row.get(2)?,
        },
      ))
    })
    .map_err(|error| format!("failed to query analytics cache metadata: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("failed to decode analytics cache metadata row: {error}"))?;
  Ok(rows.into_iter().collect())
}

fn load_cached_attempts(conn: &Connection) -> Result<(Vec<AttemptSummary>, i64), String> {
  let mut attempts_stmt = conn
    .prepare(
      r#"
      SELECT scenario_name, duration_seconds, ended_at, date_key, quality_type, quality_value
      FROM analytics_attempts
      WHERE parse_status = ?1
      ORDER BY ended_at ASC, source_path ASC
      "#,
    )
    .map_err(|error| format!("failed to prepare analytics cache attempt query: {error}"))?;
  let attempts = attempts_stmt
    .query_map(params![CACHE_STATUS_PARSED], |row| {
      let quality = match (
        row.get::<_, Option<String>>(4)?,
        row.get::<_, Option<f64>>(5)?,
      ) {
        (Some(metric_type), Some(value)) => quality_metric_from_key(&metric_type).map(|metric_type| AttemptQuality {
          metric_type,
          value,
        }),
        _ => None,
      };
      Ok(AttemptSummary {
        scenario_name: row.get(0)?,
        duration_seconds: row.get(1)?,
        ended_at: row.get(2)?,
        date_key: row.get(3)?,
        quality,
      })
    })
    .map_err(|error| format!("failed to query analytics cache attempts: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("failed to decode analytics cache attempt row: {error}"))?;
  let skipped_files = conn
    .query_row(
      "SELECT COUNT(*) FROM analytics_attempts WHERE parse_status = ?1",
      params![CACHE_STATUS_SKIPPED],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|error| format!("failed to count skipped analytics cache rows: {error}"))?;
  Ok((attempts, skipped_files))
}

fn quality_metric_key(metric_type: QualityMetricType) -> &'static str {
  match metric_type {
    QualityMetricType::Score => "score",
    QualityMetricType::Accuracy => "accuracy",
  }
}

fn quality_metric_from_key(value: &str) -> Option<QualityMetricType> {
  match value {
    "score" => Some(QualityMetricType::Score),
    "accuracy" => Some(QualityMetricType::Accuracy),
    _ => None,
  }
}

fn find_stats_dir() -> Result<PathBuf, String> {
  let mut candidates = stats_dir_candidates();
  candidates.sort();
  candidates.dedup();

  candidates
    .into_iter()
    .find(|path| path.is_dir())
    .ok_or_else(|| "KovaaK stats folder was not found in the detected Steam libraries.".to_string())
}

fn stats_dir_candidates() -> Vec<PathBuf> {
  let mut candidates = Vec::new();
  for steam_root in steam_roots() {
    for library in steam_library_paths(&steam_root) {
      let mut candidate = library.clone();
      for segment in STATS_FOLDER_SEGMENTS {
        candidate.push(segment);
      }
      candidate.push("stats");
      candidates.push(candidate);
    }
  }
  candidates
}

fn summarize_scenarios(attempts: &[AttemptSummary]) -> Vec<ScenarioPlaytime> {
  let mut scenarios = HashMap::<String, ScenarioPlaytime>::new();
  for attempt in attempts {
    add_attempt_to_scenarios(&mut scenarios, attempt);
  }
  sort_scenarios(scenarios.into_values().collect())
}

fn summarize_daily_playtime(
  attempts: &[AttemptSummary],
  playlist_definitions: &[PlaylistDefinition],
) -> Vec<DailyPlaytime> {
  let mut daily = BTreeMap::<String, DailyAccumulator>::new();

  for attempt in attempts {
    let day = daily.entry(attempt.date_key.clone()).or_default();
    day.total_seconds += attempt.duration_seconds;
    day.attempt_count += 1;
    add_attempt_to_scenarios(&mut day.scenarios, attempt);
  }

  daily
    .into_iter()
    .map(|(date_key, accumulator)| {
      let scenarios = sort_scenarios(accumulator.scenarios.into_values().collect());
      let playlists = build_daily_playlist_totals(playlist_definitions, &scenarios);
      DailyPlaytime {
        date_key,
        total_seconds: accumulator.total_seconds,
        attempt_count: accumulator.attempt_count,
        playlists,
        scenarios,
      }
    })
    .collect()
}

fn build_scenario_analytics(attempts: &[AttemptSummary], now: i64) -> Vec<ScenarioAnalyticsBuild> {
  let mut attempts_by_scenario = HashMap::<String, Vec<&AttemptSummary>>::new();
  for attempt in attempts {
    attempts_by_scenario
      .entry(normalize_name(&attempt.scenario_name))
      .or_default()
      .push(attempt);
  }

  let mut scenarios = attempts_by_scenario
    .into_iter()
    .map(|(scenario_key, scenario_attempts)| build_scenario_analytics_entry(&scenario_key, &scenario_attempts, now))
    .collect::<Vec<_>>();
  scenarios.sort_by(|left, right| {
    right
      .analytics
      .total_seconds
      .cmp(&left.analytics.total_seconds)
      .then_with(|| {
        left
          .analytics
          .scenario_name
          .to_lowercase()
          .cmp(&right.analytics.scenario_name.to_lowercase())
      })
  });
  scenarios
}

fn build_scenario_analytics_entry(
  scenario_key: &str,
  scenario_attempts: &[&AttemptSummary],
  now: i64,
) -> ScenarioAnalyticsBuild {
  let cutoff7 = now - TREND_WINDOW_7_DAYS_SECONDS;
  let cutoff30 = now - TREND_WINDOW_30_DAYS_SECONDS;
  let cutoff90 = now - TREND_WINDOW_90_DAYS_SECONDS;
  let total_seconds = scenario_attempts.iter().map(|attempt| attempt.duration_seconds).sum();
  let attempt_count = scenario_attempts.len() as i64;
  let last_played_at = scenario_attempts.iter().map(|attempt| attempt.ended_at).max();
  let seconds_last7d = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff7)
    .map(|attempt| attempt.duration_seconds)
    .sum();
  let seconds_last30d = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff30)
    .map(|attempt| attempt.duration_seconds)
    .sum();
  let seconds_last90d = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff90)
    .map(|attempt| attempt.duration_seconds)
    .sum();
  let attempts_last7d = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff7)
    .count() as i64;
  let attempts_last30d = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff30)
    .count() as i64;
  let attempts_last90d = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff90)
    .count() as i64;
  let scenario_name = scenario_attempts
    .iter()
    .max_by_key(|attempt| attempt.ended_at)
    .map(|attempt| attempt.scenario_name.clone())
    .unwrap_or_else(|| scenario_key.to_string());

  let score_runs_30 = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff30)
    .filter(|attempt| {
      attempt
        .quality
        .as_ref()
        .map(|quality| quality.metric_type == QualityMetricType::Score)
        .unwrap_or(false)
    })
    .count();
  let accuracy_runs_30 = scenario_attempts
    .iter()
    .filter(|attempt| attempt.ended_at >= cutoff30)
    .filter(|attempt| {
      attempt
        .quality
        .as_ref()
        .map(|quality| quality.metric_type == QualityMetricType::Accuracy)
        .unwrap_or(false)
    })
    .count();
  let metric_type = select_scenario_metric(score_runs_30, accuracy_runs_30);
  let mut trend = None;
  let mut trend_status = TrendStatus::InsufficientData;
  let mut delta_pct = None;
  let mut personal_best = None;
  let mut personal_best_at = None;
  let mut latest_quality_value = None;
  let mut recent_quality_samples = Vec::<QualitySample>::new();

  if let Some(metric_type) = metric_type {
    let mut selected_samples = scenario_attempts
      .iter()
      .filter_map(|attempt| {
        let quality = attempt.quality.as_ref()?;
        if quality.metric_type != metric_type {
          return None;
        }

        Some((attempt.ended_at, quality.value))
      })
      .collect::<Vec<_>>();
    selected_samples.sort_by_key(|(ended_at, _)| *ended_at);

    if !selected_samples.is_empty() {
      let personal_best_sample = selected_samples
        .iter()
        .copied()
        .max_by(|left, right| {
          left
            .1
            .partial_cmp(&right.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
        });
      personal_best = personal_best_sample.map(|(_, value)| value);
      personal_best_at = personal_best_sample.map(|(ended_at, _)| ended_at);
      latest_quality_value = selected_samples.last().map(|(_, value)| *value);
      recent_quality_samples = selected_samples
        .iter()
        .rev()
        .take(RECENT_QUALITY_SAMPLE_LIMIT)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|(ended_at, value)| QualitySample { ended_at, value })
        .collect();

      let samples_7d = selected_samples
        .iter()
        .filter(|(ended_at, _)| *ended_at >= cutoff7)
        .map(|(_, value)| *value)
        .collect::<Vec<_>>();
      let samples_30d = selected_samples
        .iter()
        .filter(|(ended_at, _)| *ended_at >= cutoff30)
        .map(|(_, value)| *value)
        .collect::<Vec<_>>();
      let run_count7d = samples_7d.len();
      let run_count30d = samples_30d.len();
      let avg7d = average(&samples_7d);
      let avg30d = average(&samples_30d);
      delta_pct = match (avg7d, avg30d) {
        (Some(avg7), Some(avg30)) => Some((avg7 - avg30) / avg30.max(0.0001)),
        _ => None,
      };
      trend_status = classify_trend(run_count7d, run_count30d, delta_pct);
      trend = Some(ScenarioTrend {
        scenario_name: scenario_name.clone(),
        metric_type,
        personal_best: personal_best.unwrap_or(0.0),
        avg7d,
        avg30d,
        delta_pct,
        status: trend_status,
        run_count7d: run_count7d as i64,
        run_count30d: run_count30d as i64,
        seconds_last7d,
        seconds_last30d,
      });
    }
  }

  let days_since_last_played = last_played_at
    .map(|last_played_at| ((now - last_played_at).max(0)) / (24 * 60 * 60))
    .unwrap_or(0);

  ScenarioAnalyticsBuild {
    scenario_key: scenario_key.to_string(),
    analytics: ScenarioAnalytics {
      scenario_name,
      metric_type,
      total_seconds,
      attempt_count,
      last_played_at,
      seconds_last7d,
      seconds_last30d,
      seconds_last90d,
      attempts_last7d,
      attempts_last30d,
      attempts_last90d,
      trend_status,
      delta_pct,
      personal_best,
      personal_best_at,
      latest_quality_value,
      recent_quality_samples,
    },
    trend,
    recent_personal_best: personal_best_at
      .map(|ended_at| ended_at >= cutoff7)
      .unwrap_or(false),
    days_since_last_played,
  }
}

fn build_consistency(daily_summaries: &[DailyPlaytime], now: i64) -> ConsistencySummary {
  if daily_summaries.is_empty() {
    return ConsistencySummary {
      current_streak_days: 0,
      longest_streak_days: 0,
      active_days7d: 0,
      active_days30d: 0,
      best_week_seconds: 0,
    };
  }

  let mut active_days = daily_summaries
    .iter()
    .filter_map(|summary| {
      NaiveDate::parse_from_str(&summary.date_key, "%Y-%m-%d")
        .ok()
        .map(|date| (date, summary.total_seconds))
    })
    .collect::<Vec<_>>();
  active_days.sort_by_key(|(date, _)| *date);

  let today = Local
    .timestamp_opt(now, 0)
    .single()
    .unwrap_or_else(Local::now)
    .date_naive();
  let recent7_start = today - Duration::days(6);
  let recent30_start = today - Duration::days(29);
  let active_days7d = active_days
    .iter()
    .filter(|(date, _)| *date >= recent7_start)
    .count() as i64;
  let active_days30d = active_days
    .iter()
    .filter(|(date, _)| *date >= recent30_start)
    .count() as i64;

  let mut longest_streak_days = 0_i64;
  let mut streak = 0_i64;
  let mut previous_date = None::<NaiveDate>;
  for (date, _) in &active_days {
    streak = if previous_date
      .map(|previous| *date == previous + Duration::days(1))
      .unwrap_or(false)
    {
      streak + 1
    } else {
      1
    };
    previous_date = Some(*date);
    longest_streak_days = longest_streak_days.max(streak);
  }

  let mut current_streak_days = 0_i64;
  if let Some((last_active_date, _)) = active_days.last() {
    if *last_active_date >= today - Duration::days(1) {
      let mut expected_date = *last_active_date;
      for (date, _) in active_days.iter().rev() {
        if *date == expected_date {
          current_streak_days += 1;
          expected_date -= Duration::days(1);
        } else {
          break;
        }
      }
    }
  }

  let mut best_week_seconds = 0_i64;
  let mut rolling_total = 0_i64;
  let mut window_start = 0_usize;
  for (date, seconds) in &active_days {
    rolling_total += *seconds;
    while active_days[window_start].0 < *date - Duration::days(6) {
      rolling_total -= active_days[window_start].1;
      window_start += 1;
    }
    best_week_seconds = best_week_seconds.max(rolling_total);
  }

  ConsistencySummary {
    current_streak_days,
    longest_streak_days,
    active_days7d,
    active_days30d,
    best_week_seconds,
  }
}

fn build_highlights(scenarios: &[ScenarioAnalyticsBuild]) -> HighlightsSummary {
  let recent_personal_bests7d = scenarios
    .iter()
    .filter(|scenario| scenario.recent_personal_best)
    .count() as i64;
  let mut top_improvers = scenarios
    .iter()
    .filter_map(|scenario| {
      let trend = scenario.trend.as_ref()?;
      let delta_pct = trend.delta_pct?;
      if trend.status != TrendStatus::Improving {
        return None;
      }
      Some(TrendHighlight {
        scenario_name: trend.scenario_name.clone(),
        delta_pct,
      })
    })
    .collect::<Vec<_>>();
  top_improvers.sort_by(|left, right| {
    right
      .delta_pct
      .partial_cmp(&left.delta_pct)
      .unwrap_or(std::cmp::Ordering::Equal)
      .then_with(|| left.scenario_name.to_lowercase().cmp(&right.scenario_name.to_lowercase()))
  });
  top_improvers.truncate(HIGHLIGHT_LIMIT);

  let mut top_decliners = scenarios
    .iter()
    .filter_map(|scenario| {
      let trend = scenario.trend.as_ref()?;
      let delta_pct = trend.delta_pct?;
      if trend.status != TrendStatus::Declining {
        return None;
      }
      Some(TrendHighlight {
        scenario_name: trend.scenario_name.clone(),
        delta_pct,
      })
    })
    .collect::<Vec<_>>();
  top_decliners.sort_by(|left, right| {
    left
      .delta_pct
      .partial_cmp(&right.delta_pct)
      .unwrap_or(std::cmp::Ordering::Equal)
      .then_with(|| left.scenario_name.to_lowercase().cmp(&right.scenario_name.to_lowercase()))
  });
  top_decliners.truncate(HIGHLIGHT_LIMIT);

  HighlightsSummary {
    recent_personal_bests7d,
    top_improvers,
    top_decliners,
  }
}

fn select_scenario_metric(score_runs_30: usize, accuracy_runs_30: usize) -> Option<QualityMetricType> {
  if score_runs_30 >= TREND_MIN_RUNS_7_DAYS {
    return Some(QualityMetricType::Score);
  }

  if accuracy_runs_30 >= TREND_MIN_RUNS_7_DAYS {
    return Some(QualityMetricType::Accuracy);
  }

  if score_runs_30 == 0 && accuracy_runs_30 == 0 {
    return None;
  }

  if score_runs_30 >= accuracy_runs_30 {
    Some(QualityMetricType::Score)
  } else {
    Some(QualityMetricType::Accuracy)
  }
}

fn average(values: &[f64]) -> Option<f64> {
  if values.is_empty() {
    return None;
  }

  let total: f64 = values.iter().sum();
  Some(total / values.len() as f64)
}

fn classify_trend(run_count7d: usize, run_count30d: usize, delta_pct: Option<f64>) -> TrendStatus {
  if run_count7d < TREND_MIN_RUNS_7_DAYS || run_count30d < TREND_MIN_RUNS_30_DAYS {
    return TrendStatus::InsufficientData;
  }

  let Some(delta_pct) = delta_pct else {
    return TrendStatus::InsufficientData;
  };

  if delta_pct >= TREND_DELTA_THRESHOLD {
    TrendStatus::Improving
  } else if delta_pct <= -TREND_DELTA_THRESHOLD {
    TrendStatus::Declining
  } else {
    TrendStatus::Flat
  }
}

fn trend_sort_rank(status: TrendStatus) -> i32 {
  match status {
    TrendStatus::Declining => 0,
    TrendStatus::Flat => 1,
    TrendStatus::Improving => 2,
    TrendStatus::InsufficientData => 3,
  }
}

#[cfg_attr(not(test), allow(dead_code))]
fn build_progress_coach(attempts: &[AttemptSummary], now: i64) -> ProgressCoach {
  let scenario_analytics = build_scenario_analytics(attempts, now);
  build_progress_coach_from_analytics(&scenario_analytics)
}

fn build_progress_coach_from_analytics(scenarios: &[ScenarioAnalyticsBuild]) -> ProgressCoach {
  let mut scenario_trends = scenarios
    .iter()
    .filter_map(|scenario| scenario.trend.clone())
    .collect::<Vec<_>>();
  scenario_trends.sort_by(|left, right| {
    trend_sort_rank(left.status)
      .cmp(&trend_sort_rank(right.status))
      .then_with(|| match (left.delta_pct, right.delta_pct) {
        (Some(left_delta), Some(right_delta)) => left_delta
          .partial_cmp(&right_delta)
          .unwrap_or(std::cmp::Ordering::Equal),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
      })
      .then_with(|| left.scenario_name.to_lowercase().cmp(&right.scenario_name.to_lowercase()))
  });

  let mut improving_count = 0_i64;
  let mut flat_count = 0_i64;
  let mut declining_count = 0_i64;
  let mut insufficient_data_count = 0_i64;
  for trend in &scenario_trends {
    match trend.status {
      TrendStatus::Improving => improving_count += 1,
      TrendStatus::Flat => flat_count += 1,
      TrendStatus::Declining => declining_count += 1,
      TrendStatus::InsufficientData => insufficient_data_count += 1,
    }
  }

  ProgressCoach {
    improving_count,
    flat_count,
    declining_count,
    insufficient_data_count,
    recommendations: build_daily_recommendations(scenarios),
    has_quality_data: !scenario_trends.is_empty(),
    scenario_trends,
  }
}

fn build_daily_recommendations(scenarios: &[ScenarioAnalyticsBuild]) -> Vec<CoachRecommendation> {
  let mut ranked = scenarios
    .iter()
    .map(|scenario| {
      let decline_severity = clamp_unit(
        scenario
          .analytics
          .delta_pct
          .map(|delta_pct| delta_pct.min(0.0).abs() / 0.15)
          .unwrap_or(0.0),
      );
      let undertraining_gap = clamp_unit(
        1.0
          - ((scenario.analytics.seconds_last7d as f64)
            / ((scenario.analytics.seconds_last30d as f64 / 4.0).max(1.0)))
            .min(1.0),
      );
      let recency_gap = clamp_unit(scenario.days_since_last_played as f64 / 14.0);
      let confidence = clamp_unit(scenario.analytics.attempts_last30d as f64 / 10.0);
      let priority_score =
        0.45 * decline_severity + 0.25 * undertraining_gap + 0.20 * recency_gap + 0.10 * confidence;
      let reason = coach_reason_from_components(decline_severity, undertraining_gap, recency_gap);
      let reason_stats = CoachReasonStats {
        decline_severity,
        undertraining_gap,
        recency_gap,
        days_since_last_played: scenario.days_since_last_played,
        delta_pct: scenario.analytics.delta_pct,
        seconds_last7d: scenario.analytics.seconds_last7d,
        seconds_last30d: scenario.analytics.seconds_last30d,
        attempts_last30d: scenario.analytics.attempts_last30d,
      };

      CoachRecommendation {
        scenario_name: scenario.analytics.scenario_name.clone(),
        minutes: COACH_SLOT_MINUTES,
        reason,
        note: format_coach_note(scenario, &reason_stats, reason),
        priority_score,
        confidence,
        reason_stats,
      }
    })
    .collect::<Vec<_>>();
  ranked.sort_by(|left, right| {
    right
      .priority_score
      .partial_cmp(&left.priority_score)
      .unwrap_or(std::cmp::Ordering::Equal)
      .then_with(|| right.confidence.partial_cmp(&left.confidence).unwrap_or(std::cmp::Ordering::Equal))
      .then_with(|| left.scenario_name.to_lowercase().cmp(&right.scenario_name.to_lowercase()))
  });
  ranked.truncate(COACH_SLOT_COUNT);
  ranked
}

fn format_coach_note(
  scenario: &ScenarioAnalyticsBuild,
  reason_stats: &CoachReasonStats,
  reason: CoachRecommendationReason,
) -> String {
  match reason {
    CoachRecommendationReason::Declining => {
      let (avg7d, avg30d) = scenario
        .trend
        .as_ref()
        .map(|trend| (trend.avg7d.unwrap_or(0.0), trend.avg30d.unwrap_or(0.0)))
        .unwrap_or((0.0, 0.0));
      let delta_pct = reason_stats.delta_pct.unwrap_or(0.0) * 100.0;
      format!("7d avg {avg7d:.2} vs 30d avg {avg30d:.2} ({delta_pct:+.1}%).")
    }
    CoachRecommendationReason::UnderTrained => {
      let weekly_target_minutes = ((scenario.analytics.seconds_last30d as f64 / 4.0) / 60.0).round() as i64;
      let minutes_7d = (scenario.analytics.seconds_last7d as f64 / 60.0).round() as i64;
      format!("7d volume {minutes_7d}m against a {weekly_target_minutes}m weekly pace.")
    }
    CoachRecommendationReason::Stale => {
      format!(
        "Last played {} days ago with {} runs in the last 30 days.",
        reason_stats.days_since_last_played,
        scenario.analytics.attempts_last30d,
      )
    }
  }
}

fn coach_reason_from_components(
  decline_severity: f64,
  undertraining_gap: f64,
  recency_gap: f64,
) -> CoachRecommendationReason {
  if decline_severity >= undertraining_gap && decline_severity >= recency_gap {
    CoachRecommendationReason::Declining
  } else if recency_gap >= undertraining_gap {
    CoachRecommendationReason::Stale
  } else {
    CoachRecommendationReason::UnderTrained
  }
}

fn clamp_unit(value: f64) -> f64 {
  value.clamp(0.0, 1.0)
}

fn add_attempt_to_scenarios(
  scenarios: &mut HashMap<String, ScenarioPlaytime>,
  attempt: &AttemptSummary,
) {
  scenarios
    .entry(attempt.scenario_name.clone())
    .and_modify(|scenario| {
      scenario.total_seconds += attempt.duration_seconds;
      scenario.attempt_count += 1;
    })
    .or_insert(ScenarioPlaytime {
      name: attempt.scenario_name.clone(),
      total_seconds: attempt.duration_seconds,
      attempt_count: 1,
    });
}

fn sort_scenarios(mut scenarios: Vec<ScenarioPlaytime>) -> Vec<ScenarioPlaytime> {
  scenarios.sort_by(|left, right| {
    right
      .total_seconds
      .cmp(&left.total_seconds)
      .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
  });
  scenarios
}

#[cfg_attr(not(test), allow(dead_code))]
fn build_overall_playlist_totals(
  playlist_definitions: &[PlaylistDefinition],
  scenarios: &[ScenarioPlaytime],
) -> Vec<PlaylistPlaytime> {
  collect_playlist_aggregates(playlist_definitions, scenarios, true)
    .into_iter()
    .map(|playlist| PlaylistPlaytime {
      name: playlist.name,
      total_seconds: playlist.total_seconds,
      matched_scenarios: playlist.matched_scenarios,
      total_scenarios: playlist.total_scenarios,
      last_played_at: None,
      seconds_last30d: 0,
    })
    .collect()
}

fn build_overall_playlist_totals_from_analytics(
  playlist_definitions: &[PlaylistDefinition],
  scenarios: &[ScenarioAnalyticsBuild],
) -> Vec<PlaylistPlaytime> {
  let scenario_lookup = scenarios
    .iter()
    .map(|scenario| (scenario.scenario_key.clone(), &scenario.analytics))
    .collect::<HashMap<_, _>>();
  let mut playlists = playlist_definitions
    .iter()
    .map(|playlist| {
      let mut total_seconds = 0_i64;
      let mut matched_scenarios = 0_i64;
      let mut last_played_at = None::<i64>;
      let mut seconds_last30d = 0_i64;

      for scenario_name in &playlist.scenario_names {
        if let Some(scenario) = scenario_lookup.get(scenario_name) {
          total_seconds += scenario.total_seconds;
          matched_scenarios += 1;
          seconds_last30d += scenario.seconds_last30d;
          last_played_at = match (last_played_at, scenario.last_played_at) {
            (Some(left), Some(right)) => Some(left.max(right)),
            (None, Some(right)) => Some(right),
            (Some(left), None) => Some(left),
            (None, None) => None,
          };
        }
      }

      PlaylistPlaytime {
        name: playlist.name.clone(),
        total_seconds,
        matched_scenarios,
        total_scenarios: playlist.total_scenarios,
        last_played_at,
        seconds_last30d,
      }
    })
    .collect::<Vec<_>>();
  playlists.sort_by(|left, right| {
    right
      .total_seconds
      .cmp(&left.total_seconds)
      .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
  });
  playlists
}

fn build_daily_playlist_totals(
  playlist_definitions: &[PlaylistDefinition],
  scenarios: &[ScenarioPlaytime],
) -> Vec<DailyPlaylistPlaytime> {
  collect_playlist_aggregates(playlist_definitions, scenarios, false)
    .into_iter()
    .map(|playlist| DailyPlaylistPlaytime {
      name: playlist.name,
      total_seconds: playlist.total_seconds,
      matched_scenarios: playlist.matched_scenarios,
    })
    .collect()
}

fn collect_playlist_aggregates(
  playlist_definitions: &[PlaylistDefinition],
  scenarios: &[ScenarioPlaytime],
  include_empty: bool,
) -> Vec<PlaylistAggregate> {
  let scenario_lookup = scenarios
    .iter()
    .map(|scenario| (normalize_name(&scenario.name), scenario))
    .collect::<HashMap<_, _>>();
  let mut playlists = playlist_definitions
    .iter()
    .map(|playlist| {
      let mut total_seconds = 0_i64;
      let mut matched_scenarios = 0_i64;

      for scenario_name in &playlist.scenario_names {
        if let Some(scenario) = scenario_lookup.get(scenario_name) {
          total_seconds += scenario.total_seconds;
          matched_scenarios += 1;
        }
      }

      PlaylistAggregate {
        name: playlist.name.clone(),
        total_seconds,
        matched_scenarios,
        total_scenarios: playlist.total_scenarios,
      }
    })
    .collect::<Vec<_>>();

  if !include_empty {
    playlists.retain(|playlist| playlist.total_seconds > 0);
  }

  playlists.sort_by(|left, right| {
    right
      .total_seconds
      .cmp(&left.total_seconds)
      .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
  });
  playlists
}

fn read_playlist_definitions(stats_dir: &Path) -> Vec<PlaylistDefinition> {
  let Some(playlists_dir) = playlists_dir_from_stats_dir(stats_dir) else {
    return Vec::new();
  };

  let Ok(entries) = fs::read_dir(playlists_dir) else {
    return Vec::new();
  };

  let mut playlists = Vec::<PlaylistDefinition>::new();

  for entry in entries.flatten() {
    let path = entry.path();
    if !matches!(path.extension().and_then(|value| value.to_str()), Some("json")) {
      continue;
    }

    let Ok(content) = fs::read_to_string(&path) else {
      continue;
    };
    let Ok(playlist_file) = serde_json::from_str::<PlaylistFile>(&content) else {
      continue;
    };

    let name = playlist_file
      .playlist_name
      .as_deref()
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(ToOwned::to_owned)
      .or_else(|| path.file_stem().and_then(|value| value.to_str()).map(ToOwned::to_owned));
    let Some(name) = name else {
      continue;
    };

    let scenario_list = playlist_file.scenario_list.unwrap_or_default();
    let mut unique_names = HashSet::<String>::new();

    for entry in scenario_list {
      let Some(scenario_name) = entry
        .scenario_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
      else {
        continue;
      };

      let normalized = normalize_name(scenario_name);
      if !unique_names.insert(normalized.clone()) {
        continue;
      }
    }

    let total_scenarios = unique_names.len() as i64;
    playlists.push(PlaylistDefinition {
      name,
      scenario_names: unique_names.into_iter().collect(),
      total_scenarios,
    });
  }

  playlists
}

fn playlists_dir_from_stats_dir(stats_dir: &Path) -> Option<PathBuf> {
  let game_dir = stats_dir.parent()?;
  Some(game_dir.join("Saved").join("SaveGames").join("Playlists"))
}

fn steam_roots() -> Vec<PathBuf> {
  let mut roots = Vec::<PathBuf>::new();

  if let Ok(program_files_x86) = env::var("PROGRAMFILES(X86)") {
    roots.push(PathBuf::from(program_files_x86).join("Steam"));
  }

  if let Ok(program_files) = env::var("PROGRAMFILES") {
    roots.push(PathBuf::from(program_files).join("Steam"));
  }

  roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
  roots.push(PathBuf::from(r"C:\Program Files\Steam"));
  roots
}

fn steam_library_paths(steam_root: &Path) -> Vec<PathBuf> {
  let mut libraries = vec![steam_root.to_path_buf()];
  let libraryfolders = steam_root.join("steamapps").join("libraryfolders.vdf");
  let Ok(content) = fs::read_to_string(libraryfolders) else {
    return libraries;
  };

  for line in content.lines() {
    let tokens = extract_quoted_tokens(line.trim());
    if let [key, value, ..] = tokens.as_slice() {
      if key == "path" {
        libraries.push(PathBuf::from(value.replace("\\\\", "\\")));
      }
    }
  }

  libraries
}

fn parse_attempt_file(path: &Path) -> Result<Option<AttemptSummary>, String> {
  let Some(end_at) = parse_end_time_from_filename(path)
    .or_else(|| file_modified_local_time(path).ok())
  else {
    return Ok(None);
  };

  let file = fs::File::open(path)
    .map_err(|error| format!("failed to open {}: {error}", path.display()))?;
  let reader = BufReader::new(file);

  let mut challenge_start = None;
  let mut scenario_name = None;
  let mut score = None;
  let mut accuracy = None;
  for line in reader.lines() {
    let line = line.map_err(|error| format!("failed reading {}: {error}", path.display()))?;
    if let Some(value) = line.strip_prefix("Challenge Start:,") {
      challenge_start = Some(value.trim().to_string());
      continue;
    }

    if let Some(value) = line.strip_prefix("Scenario:,") {
      let value = value.trim();
      if !value.is_empty() {
        scenario_name = Some(value.to_string());
      }
    }

    if score.is_none() {
      score = parse_metric_from_line(&line, &SCORE_PREFIXES);
    }

    if accuracy.is_none() {
      accuracy = parse_metric_from_line(&line, &ACCURACY_PREFIXES);
    }
  }

  let Some(challenge_start) = challenge_start else {
    return Ok(None);
  };
  let scenario_name = scenario_name
    .or_else(|| parse_scenario_name_from_filename(path))
    .unwrap_or_else(|| "Unknown Scenario".to_string());

  let start_time = NaiveTime::parse_from_str(&challenge_start, "%H:%M:%S%.3f")
    .map_err(|error| format!("failed to parse challenge start in {}: {error}", path.display()))?;

  let mut start_date = end_at.date_naive();
  if start_time > end_at.time() {
    start_date = start_date.pred_opt().unwrap_or(start_date);
  }

  let start_at = start_date.and_time(start_time);
  let duration = end_at.naive_local() - start_at;
  if duration <= Duration::zero() || duration > Duration::hours(MAX_ATTEMPT_DURATION_HOURS) {
    return Ok(None);
  }

  let quality = score
    .map(|value| AttemptQuality {
      metric_type: QualityMetricType::Score,
      value,
    })
    .or_else(|| {
      accuracy.map(|value| AttemptQuality {
        metric_type: QualityMetricType::Accuracy,
        value,
      })
    });

  Ok(Some(AttemptSummary {
    scenario_name,
    duration_seconds: duration.num_seconds(),
    ended_at: end_at.timestamp(),
    date_key: end_at.format("%Y-%m-%d").to_string(),
    quality,
  }))
}

fn parse_metric_from_line(line: &str, prefixes: &[&str]) -> Option<f64> {
  for prefix in prefixes {
    if let Some(raw) = line.strip_prefix(prefix) {
      return parse_metric_value(raw);
    }
  }

  None
}

fn parse_metric_value(raw: &str) -> Option<f64> {
  let token = raw
    .trim()
    .split(',')
    .next()
    .map(|value| value.trim().trim_end_matches('%').trim())?;
  if token.is_empty() {
    return None;
  }

  let value = token.parse::<f64>().ok()?;
  if !value.is_finite() {
    return None;
  }

  Some(value)
}

fn parse_scenario_name_from_filename(path: &Path) -> Option<String> {
  let file_name = path.file_name()?.to_str()?;
  let (scenario_name, _) = file_name.rsplit_once(" - Challenge - ")?;
  Some(scenario_name.to_string())
}

fn normalize_name(value: &str) -> String {
  value.trim().to_lowercase()
}

fn parse_end_time_from_filename(path: &Path) -> Option<DateTime<Local>> {
  let file_name = path.file_name()?.to_str()?;
  let trimmed = file_name.strip_suffix(" Stats.csv")?;
  let (_, timestamp) = trimmed.rsplit_once(" - ")?;
  let naive = NaiveDateTime::parse_from_str(timestamp, "%Y.%m.%d-%H.%M.%S").ok()?;
  Local.from_local_datetime(&naive).earliest()
}

fn file_modified_local_time(path: &Path) -> Result<DateTime<Local>, String> {
  let metadata = fs::metadata(path)
    .map_err(|error| format!("failed to read metadata for {}: {error}", path.display()))?;
  let modified = metadata
    .modified()
    .map_err(|error| format!("failed to read modified time for {}: {error}", path.display()))?;
  Ok(DateTime::<Local>::from(modified))
}

fn extract_quoted_tokens(line: &str) -> Vec<String> {
  let mut tokens = Vec::new();
  let mut current = String::new();
  let mut in_quotes = false;
  let mut escaped = false;

  for ch in line.chars() {
    if !in_quotes {
      if ch == '"' {
        in_quotes = true;
        current.clear();
      }
      continue;
    }

    if escaped {
      current.push(ch);
      escaped = false;
      continue;
    }

    match ch {
      '\\' => escaped = true,
      '"' => {
        tokens.push(current.clone());
        current.clear();
        in_quotes = false;
      }
      _ => current.push(ch),
    }
  }

  tokens
}

#[cfg(test)]
mod tests {
  use std::fs;
  use std::path::PathBuf;
  use std::thread;
  use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};

  use chrono::{Local, Timelike};
  use crate::types::{CoachRecommendationReason, QualityMetricType, TrendStatus};

  use super::{
    build_playtime_summary, build_progress_coach, build_overall_playlist_totals,
    extract_quoted_tokens, parse_attempt_file, playlists_dir_from_stats_dir,
    read_kovaak_playtime_from_paths, read_playlist_definitions, steam_library_paths,
    summarize_daily_playtime, summarize_scenarios, AttemptQuality, AttemptSummary,
  };

  fn attempt(
    scenario_name: &str,
    duration_seconds: i64,
    ended_at: i64,
    date_key: &str,
    quality: Option<(QualityMetricType, f64)>,
  ) -> AttemptSummary {
    AttemptSummary {
      scenario_name: scenario_name.to_string(),
      duration_seconds,
      ended_at,
      date_key: date_key.to_string(),
      quality: quality.map(|(metric_type, value)| AttemptQuality { metric_type, value }),
    }
  }

  fn unique_temp_dir(label: &str) -> PathBuf {
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock should be after unix epoch")
      .as_nanos();
    let path = std::env::temp_dir().join(format!("{label}-{unique}"));
    fs::create_dir_all(&path).expect("temp dir should be created");
    path
  }

  #[test]
  fn parses_duration_from_filename_and_challenge_start() {
    let dir = std::env::temp_dir().join("kovaak-stats-playtime-tests");
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("Test Scenario - Challenge - 2026.03.08-20.00.34 Stats.csv");
    fs::write(
      &file_path,
      "Kill #,Timestamp\n\nChallenge Start:,19:59:34.247\n",
    )
    .expect("sample stats file should be written");

    let attempt = parse_attempt_file(&file_path)
      .expect("file should parse")
      .expect("attempt should exist");
    assert_eq!(attempt.scenario_name, "Test Scenario");
    assert_eq!(attempt.duration_seconds, 59);
    assert_eq!(attempt.date_key, "2026-03-08");
    assert!(attempt.quality.is_none());
  }

  #[test]
  fn handles_attempts_with_no_kill_rows() {
    let dir = std::env::temp_dir().join("kovaak-stats-playtime-tests");
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("Track Scenario - Challenge - 2026.03.08-21.19.20 Stats.csv");
    fs::write(
      &file_path,
      "Kill #,Timestamp\n\nKills:,0\nChallenge Start:,21:18:20.828\n",
    )
    .expect("sample tracking stats file should be written");

    let attempt = parse_attempt_file(&file_path)
      .expect("file should parse")
      .expect("attempt should exist");
    assert_eq!(attempt.scenario_name, "Track Scenario");
    assert_eq!(attempt.duration_seconds, 59);
    assert!(attempt.quality.is_none());
  }

  #[test]
  fn parses_score_metric_when_present() {
    let dir = std::env::temp_dir().join("kovaak-stats-playtime-tests");
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("Score Scenario - Challenge - 2026.03.08-21.19.20 Stats.csv");
    fs::write(
      &file_path,
      "Kill #,Timestamp\n\nChallenge Start:,21:18:20.828\nScore:,123.5\n",
    )
    .expect("sample stats file should be written");

    let attempt = parse_attempt_file(&file_path)
      .expect("file should parse")
      .expect("attempt should exist");
    let quality = attempt.quality.expect("score should parse");
    assert_eq!(quality.metric_type, QualityMetricType::Score);
    assert_eq!(quality.value, 123.5);
  }

  #[test]
  fn falls_back_to_accuracy_metric_when_score_is_missing() {
    let dir = std::env::temp_dir().join("kovaak-stats-playtime-tests");
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("Accuracy Scenario - Challenge - 2026.03.08-21.19.20 Stats.csv");
    fs::write(
      &file_path,
      "Kill #,Timestamp\n\nChallenge Start:,21:18:20.828\nAccuracy:,97.5%\n",
    )
    .expect("sample stats file should be written");

    let attempt = parse_attempt_file(&file_path)
      .expect("file should parse")
      .expect("attempt should exist");
    let quality = attempt.quality.expect("accuracy should parse");
    assert_eq!(quality.metric_type, QualityMetricType::Accuracy);
    assert_eq!(quality.value, 97.5);
  }

  #[test]
  fn keeps_valid_attempt_without_quality_metrics() {
    let dir = std::env::temp_dir().join("kovaak-stats-playtime-tests");
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("No Quality - Challenge - 2026.03.08-21.19.20 Stats.csv");
    fs::write(
      &file_path,
      "Kill #,Timestamp\n\nChallenge Start:,21:18:20.828\nRandom Key:,Value\n",
    )
    .expect("sample stats file should be written");

    let attempt = parse_attempt_file(&file_path)
      .expect("file should parse")
      .expect("attempt should exist");
    assert_eq!(attempt.duration_seconds, 59);
    assert!(attempt.quality.is_none());
  }

  #[test]
  fn attributes_overnight_attempts_to_the_end_date() {
    let dir = std::env::temp_dir().join("kovaak-stats-playtime-tests");
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("Overnight Scenario - Challenge - 2026.03.09-00.05.00 Stats.csv");
    fs::write(
      &file_path,
      "Kill #,Timestamp\n\nChallenge Start:,23:55:00.000\n",
    )
    .expect("sample stats file should be written");

    let attempt = parse_attempt_file(&file_path)
      .expect("file should parse")
      .expect("attempt should exist");
    assert_eq!(attempt.duration_seconds, 600);
    assert_eq!(attempt.date_key, "2026-03-09");
  }

  #[test]
  fn reads_library_paths_from_vdf() {
    let steam_root = std::env::temp_dir().join("kovaak-stats-library-tests");
    let steamapps = steam_root.join("steamapps");
    let _ = fs::create_dir_all(&steamapps);
    fs::write(
      steamapps.join("libraryfolders.vdf"),
      "\"libraryfolders\"\n{\n  \"0\"\n  {\n    \"path\"    \"D:\\\\SteamLibrary\"\n  }\n}\n",
    )
    .expect("libraryfolders vdf should be written");

    let libraries = steam_library_paths(&steam_root);
    assert!(libraries.iter().any(|path| path == &steam_root));
    assert!(libraries.iter().any(|path| path == &PathBuf::from(r"D:\SteamLibrary")));
  }

  #[test]
  fn tokenizes_vdf_lines() {
    let tokens = extract_quoted_tokens("\"path\"  \"C:\\\\Program Files (x86)\\\\Steam\"");
    assert_eq!(tokens, vec!["path", r"C:\Program Files (x86)\Steam"]);
  }

  #[test]
  fn local_time_conversion_is_available() {
    let now = Local::now();
    assert!(now.time().hour() <= 23);
  }

  #[test]
  fn summarizes_daily_playtime_across_dates() {
    let attempts = vec![
      attempt("Scenario A", 30, 1, "2026-03-08", None),
      attempt("Scenario A", 45, 2, "2026-03-08", None),
      attempt("Scenario B", 60, 3, "2026-03-09", None),
    ];

    let daily = summarize_daily_playtime(&attempts, &[]);

    assert_eq!(daily.len(), 2);
    assert_eq!(daily[0].date_key, "2026-03-08");
    assert_eq!(daily[0].total_seconds, 75);
    assert_eq!(daily[0].attempt_count, 2);
    assert_eq!(daily[0].scenarios.len(), 1);
    assert_eq!(daily[0].scenarios[0].name, "Scenario A");
    assert_eq!(daily[0].scenarios[0].total_seconds, 75);
    assert_eq!(daily[0].scenarios[0].attempt_count, 2);
    assert_eq!(daily[1].date_key, "2026-03-09");
    assert_eq!(daily[1].total_seconds, 60);
    assert_eq!(daily[1].attempt_count, 1);
  }

  #[test]
  fn daily_playlist_inference_matches_global_playlist_matching() {
    let root = std::env::temp_dir().join("kovaak-stats-playlist-tests");
    let playlists_dir = root.join("Saved").join("SaveGames").join("Playlists");
    let stats_dir = root.join("stats");
    let _ = fs::create_dir_all(&playlists_dir);
    let _ = fs::create_dir_all(&stats_dir);
    fs::write(
      playlists_dir.join("Example.json"),
      r#"{
        "playlistName": "Example Playlist",
        "scenarioList": [
          { "scenario_name": "Scenario A" },
          { "scenario_name": "Scenario B" },
          { "scenario_name": "Scenario B" }
        ]
      }"#,
    )
    .expect("playlist json should be written");
    fs::write(
      playlists_dir.join("Overlap.json"),
      r#"{
        "playlistName": "Overlap Playlist",
        "scenarioList": [
          { "scenario_name": "Scenario A" }
        ]
      }"#,
    )
    .expect("overlap playlist json should be written");

    let attempts = vec![
      attempt("Scenario A", 30, 1, "2026-03-08", None),
      attempt("Scenario B", 45, 2, "2026-03-08", None),
    ];
    let scenarios = summarize_scenarios(&attempts);
    let definitions = read_playlist_definitions(&stats_dir);
    let overall = build_overall_playlist_totals(&definitions, &scenarios);
    let daily = summarize_daily_playtime(&attempts, &definitions);

    assert_eq!(overall.len(), 2);
    let example = overall
      .iter()
      .find(|playlist| playlist.name == "Example Playlist")
      .expect("example playlist should exist");
    assert_eq!(example.total_seconds, 75);
    assert_eq!(example.matched_scenarios, 2);
    assert_eq!(example.total_scenarios, 2);
    let overlap = overall
      .iter()
      .find(|playlist| playlist.name == "Overlap Playlist")
      .expect("overlap playlist should exist");
    assert_eq!(overlap.total_seconds, 30);
    assert_eq!(overlap.matched_scenarios, 1);

    assert_eq!(daily.len(), 1);
    let daily_example = daily[0]
      .playlists
      .iter()
      .find(|playlist| playlist.name == "Example Playlist")
      .expect("daily example playlist should exist");
    assert_eq!(daily_example.total_seconds, example.total_seconds);
    assert_eq!(daily_example.matched_scenarios, example.matched_scenarios);
    let daily_overlap = daily[0]
      .playlists
      .iter()
      .find(|playlist| playlist.name == "Overlap Playlist")
      .expect("daily overlap playlist should exist");
    assert_eq!(daily_overlap.total_seconds, overlap.total_seconds);
    assert_eq!(daily_overlap.matched_scenarios, overlap.matched_scenarios);
    assert_eq!(playlists_dir_from_stats_dir(&stats_dir), Some(playlists_dir));
  }

  #[test]
  fn analytics_cache_bootstraps_and_refreshes_changed_files() {
    let root = unique_temp_dir("kovaak-stats-cache-bootstrap");
    let stats_dir = root.join("stats");
    fs::create_dir_all(&stats_dir).expect("stats dir should be created");
    let cache_path = root.join("cache").join("analytics.sqlite");
    let stats_file = stats_dir.join("Cache Scenario - Challenge - 2026.03.08-20.00.34 Stats.csv");

    fs::write(
      &stats_file,
      "Kill #,Timestamp\n\nChallenge Start:,19:59:34.247\nScore:,100\n",
    )
    .expect("initial stats file should be written");
    let first = read_kovaak_playtime_from_paths(&stats_dir, &cache_path, 1_000_000)
      .expect("initial summary should build");
    assert_eq!(first.total_seconds, 59);
    assert_eq!(first.skipped_files, 0);

    thread::sleep(StdDuration::from_millis(20));
    fs::write(
      &stats_file,
      "Kill #,Timestamp\n\nChallenge Start:,19:58:34.000\nScore:,101\n",
    )
    .expect("updated stats file should be written");
    let refreshed = read_kovaak_playtime_from_paths(&stats_dir, &cache_path, 1_000_000)
      .expect("refreshed summary should build");
    assert_eq!(refreshed.total_seconds, 120);
    assert_eq!(refreshed.scenario_analytics[0].latest_quality_value, Some(101.0));
  }

  #[test]
  fn analytics_cache_removes_deleted_files_and_preserves_skipped_rows() {
    let root = unique_temp_dir("kovaak-stats-cache-removal");
    let stats_dir = root.join("stats");
    fs::create_dir_all(&stats_dir).expect("stats dir should be created");
    let cache_path = root.join("cache").join("analytics.sqlite");
    let first_file = stats_dir.join("One - Challenge - 2026.03.08-20.00.34 Stats.csv");
    let second_file = stats_dir.join("Two - Challenge - 2026.03.08-20.01.34 Stats.csv");
    let skipped_file = stats_dir.join("Broken - Challenge - 2026.03.08-20.02.34 Stats.csv");

    fs::write(&first_file, "Kill #,Timestamp\n\nChallenge Start:,19:59:34.247\n")
      .expect("first stats file should be written");
    fs::write(&second_file, "Kill #,Timestamp\n\nChallenge Start:,20:00:34.000\n")
      .expect("second stats file should be written");
    fs::write(&skipped_file, "Kill #,Timestamp\n\nRandom Key:,Value\n")
      .expect("broken stats file should be written");

    let initial = read_kovaak_playtime_from_paths(&stats_dir, &cache_path, 1_000_000)
      .expect("initial summary should build");
    assert_eq!(initial.attempt_count, 2);
    assert_eq!(initial.skipped_files, 1);

    fs::remove_file(&first_file).expect("first stats file should be removed");
    let refreshed = read_kovaak_playtime_from_paths(&stats_dir, &cache_path, 1_000_000)
      .expect("summary after deletion should build");
    assert_eq!(refreshed.attempt_count, 1);
    assert_eq!(refreshed.skipped_files, 1);
    assert_eq!(refreshed.total_seconds, 60);
  }

  #[test]
  fn builds_consistency_and_recent_personal_best_highlights() {
    let root = unique_temp_dir("kovaak-stats-summary-math");
    let stats_dir = root.join("stats");
    fs::create_dir_all(&stats_dir).expect("stats dir should be created");
    let now = 4_000_000_i64;
    let day = 24 * 60 * 60;
    let attempts = vec![
      attempt("Alpha", 300, now - 2 * day, "1970-02-14", Some((QualityMetricType::Score, 90.0))),
      attempt("Alpha", 300, now - day, "1970-02-15", Some((QualityMetricType::Score, 95.0))),
      attempt("Alpha", 300, now, "1970-02-16", Some((QualityMetricType::Score, 100.0))),
      attempt("Bravo", 180, now, "1970-02-16", Some((QualityMetricType::Score, 110.0))),
    ];

    let summary = build_playtime_summary(&attempts, 0, &stats_dir, now);
    assert_eq!(summary.consistency.current_streak_days, 3);
    assert_eq!(summary.consistency.longest_streak_days, 3);
    assert_eq!(summary.consistency.active_days7d, 3);
    assert_eq!(summary.highlights.recent_personal_bests7d, 2);
  }

  #[test]
  fn coach_recommendations_fallback_to_stale_without_quality_data() {
    let now = 5_000_000_i64;
    let day = 24 * 60 * 60;
    let attempts = vec![
      attempt("No Quality A", 300, now - 40 * day, "1970-02-17", None),
      attempt("No Quality B", 300, now - 10 * day, "1970-03-19", None),
    ];

    let coach = build_progress_coach(&attempts, now);
    assert!(!coach.has_quality_data);
    assert!(!coach.recommendations.is_empty());
    assert_eq!(coach.recommendations[0].reason, CoachRecommendationReason::Stale);
  }

  #[test]
  fn metric_lock_prefers_score_when_score_has_three_recent_runs() {
    let now = 2_000_000_i64;
    let within_30_days = now - 2 * 24 * 60 * 60;
    let attempts = vec![
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 1,
        "2026-03-08",
        Some((QualityMetricType::Score, 95.0)),
      ),
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 2,
        "2026-03-08",
        Some((QualityMetricType::Score, 96.0)),
      ),
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 3,
        "2026-03-08",
        Some((QualityMetricType::Score, 97.0)),
      ),
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 4,
        "2026-03-08",
        Some((QualityMetricType::Accuracy, 88.0)),
      ),
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 5,
        "2026-03-08",
        Some((QualityMetricType::Accuracy, 89.0)),
      ),
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 6,
        "2026-03-08",
        Some((QualityMetricType::Accuracy, 90.0)),
      ),
      attempt(
        "Lock Scenario",
        60,
        within_30_days + 7,
        "2026-03-08",
        Some((QualityMetricType::Accuracy, 91.0)),
      ),
    ];

    let coach = build_progress_coach(&attempts, now);
    assert_eq!(coach.scenario_trends.len(), 1);
    assert_eq!(coach.scenario_trends[0].metric_type, QualityMetricType::Score);
  }

  #[test]
  fn classifies_improving_flat_declining_and_insufficient_trends() {
    let now = 2_000_000_i64;
    let day = 24 * 60 * 60;
    let attempts = vec![
      attempt(
        "Improving",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Improving",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Improving",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Improving",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Improving",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Declining",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Declining",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Declining",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Declining",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Declining",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Flat",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Flat",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Flat",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 101.0)),
      ),
      attempt(
        "Flat",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 101.0)),
      ),
      attempt(
        "Flat",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 101.0)),
      ),
      attempt(
        "Insufficient",
        60,
        now - 3 * day,
        "2026-03-06",
        Some((QualityMetricType::Score, 95.0)),
      ),
      attempt(
        "Insufficient",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 94.0)),
      ),
      attempt(
        "Insufficient",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 96.0)),
      ),
      attempt(
        "Insufficient",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 97.0)),
      ),
    ];

    let coach = build_progress_coach(&attempts, now);
    assert_eq!(coach.improving_count, 1);
    assert_eq!(coach.flat_count, 1);
    assert_eq!(coach.declining_count, 1);
    assert_eq!(coach.insufficient_data_count, 1);

    let improving = coach
      .scenario_trends
      .iter()
      .find(|trend| trend.scenario_name == "Improving")
      .expect("improving trend should exist");
    assert_eq!(improving.status, TrendStatus::Improving);

    let declining = coach
      .scenario_trends
      .iter()
      .find(|trend| trend.scenario_name == "Declining")
      .expect("declining trend should exist");
    assert_eq!(declining.status, TrendStatus::Declining);
  }

  #[test]
  fn builds_balanced_daily_plan_without_duplicates_when_enough_candidates_exist() {
    let now = 3_000_000_i64;
    let day = 24 * 60 * 60;
    let attempts = vec![
      attempt(
        "Decline One",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Decline One",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Decline One",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Decline One",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Decline One",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 90.0)),
      ),
      attempt(
        "Decline Two",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 110.0)),
      ),
      attempt(
        "Decline Two",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 110.0)),
      ),
      attempt(
        "Decline Two",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 98.0)),
      ),
      attempt(
        "Decline Two",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 98.0)),
      ),
      attempt(
        "Decline Two",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 98.0)),
      ),
      attempt(
        "Undertrained",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Undertrained",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Undertrained",
        60,
        now - 18 * day,
        "2026-02-20",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Undertrained",
        60,
        now - 17 * day,
        "2026-02-21",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Undertrained",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 101.0)),
      ),
      attempt(
        "Extra Scenario",
        60,
        now - 20 * day,
        "2026-02-18",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Extra Scenario",
        60,
        now - 19 * day,
        "2026-02-19",
        Some((QualityMetricType::Score, 100.0)),
      ),
      attempt(
        "Extra Scenario",
        60,
        now - 2 * day,
        "2026-03-07",
        Some((QualityMetricType::Score, 101.0)),
      ),
      attempt(
        "Extra Scenario",
        60,
        now - day,
        "2026-03-08",
        Some((QualityMetricType::Score, 101.0)),
      ),
      attempt(
        "Extra Scenario",
        60,
        now - day + 60,
        "2026-03-08",
        Some((QualityMetricType::Score, 101.0)),
      ),
    ];

    let coach = build_progress_coach(&attempts, now);
    assert_eq!(coach.recommendations.len(), 4);
    assert!(coach.recommendations.iter().all(|recommendation| recommendation.minutes == 5));
    assert_eq!(coach.recommendations[0].reason, CoachRecommendationReason::Declining);
    assert_eq!(coach.recommendations[1].reason, CoachRecommendationReason::Declining);
    assert!(
      coach
        .recommendations
        .iter()
        .any(|recommendation| recommendation.reason == CoachRecommendationReason::UnderTrained)
    );

    let unique_count = coach
      .recommendations
      .iter()
      .map(|recommendation| recommendation.scenario_name.clone())
      .collect::<std::collections::HashSet<_>>()
      .len();
    assert_eq!(unique_count, 4);
  }
}
