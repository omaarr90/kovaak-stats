use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Local, NaiveDateTime, NaiveTime, TimeZone};
use serde::Deserialize;

use crate::types::{
  CoachRecommendation, CoachRecommendationReason, DailyPlaylistPlaytime, DailyPlaytime,
  PlaylistPlaytime, PlaytimeSummary, ProgressCoach, QualityMetricType, ScenarioPlaytime,
  ScenarioTrend, TrendStatus,
};

const STATS_FOLDER_SEGMENTS: [&str; 4] = ["steamapps", "common", "FPSAimTrainer", "FPSAimTrainer"];
const MAX_ATTEMPT_DURATION_HOURS: i64 = 4;
const SCORE_PREFIXES: [&str; 3] = ["Score:,", "Challenge Score:,", "Total Score:,"];
const ACCURACY_PREFIXES: [&str; 3] = ["Accuracy:,", "Hit Accuracy:,", "Acc:,"];
const TREND_WINDOW_7_DAYS_SECONDS: i64 = 7 * 24 * 60 * 60;
const TREND_WINDOW_30_DAYS_SECONDS: i64 = 30 * 24 * 60 * 60;
const TREND_MIN_RUNS_7_DAYS: usize = 3;
const TREND_MIN_RUNS_30_DAYS: usize = 5;
const TREND_DELTA_THRESHOLD: f64 = 0.03;
const COACH_SLOT_MINUTES: i64 = 5;
const COACH_SLOT_COUNT: usize = 4;

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
struct ScenarioTrendBuild {
  scenario_key: String,
  trend: ScenarioTrend,
  undertrained_ratio: Option<f64>,
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
  let entries = fs::read_dir(&stats_dir)
    .map_err(|error| format!("failed to read stats directory {}: {error}", stats_dir.display()))?;

  let mut attempts = Vec::<AttemptSummary>::new();
  let mut skipped_files = 0_i64;

  for entry in entries.flatten() {
    let path = entry.path();
    if !matches!(path.extension().and_then(|value| value.to_str()), Some("csv")) {
      continue;
    }

    match parse_attempt_file(&path) {
      Ok(Some(attempt)) => attempts.push(attempt),
      Ok(None) => skipped_files += 1,
      Err(_) => skipped_files += 1,
    }
  }

  if attempts.is_empty() {
    return Err(format!(
      "No parseable KovaaK stats CSV files were found in {}.",
      stats_dir.display()
    ));
  }

  let playlist_definitions = read_playlist_definitions(&stats_dir);
  let total_seconds = attempts.iter().map(|attempt| attempt.duration_seconds).sum();
  let attempt_count = attempts.len() as i64;
  let last_attempt_at = attempts.iter().map(|attempt| attempt.ended_at).max();
  let scenarios = summarize_scenarios(&attempts);
  let playlists = build_overall_playlist_totals(&playlist_definitions, &scenarios);
  let daily_summaries = summarize_daily_playtime(&attempts, &playlist_definitions);
  let progress_coach = build_progress_coach(&attempts, Local::now().timestamp());

  Ok(PlaytimeSummary {
    total_seconds,
    attempt_count,
    skipped_files,
    last_attempt_at,
    source_path: stats_dir.display().to_string(),
    scenarios,
    playlists,
    daily_summaries,
    progress_coach,
  })
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

fn build_progress_coach(attempts: &[AttemptSummary], now: i64) -> ProgressCoach {
  if attempts.is_empty() {
    return ProgressCoach {
      improving_count: 0,
      flat_count: 0,
      declining_count: 0,
      insufficient_data_count: 0,
      scenario_trends: Vec::new(),
      recommendations: Vec::new(),
      has_quality_data: false,
    };
  }

  let mut attempts_by_scenario = HashMap::<String, Vec<&AttemptSummary>>::new();
  for attempt in attempts {
    attempts_by_scenario
      .entry(normalize_name(&attempt.scenario_name))
      .or_default()
      .push(attempt);
  }

  let mut scenario_trends = attempts_by_scenario
    .into_iter()
    .filter_map(|(scenario_key, scenario_attempts)| {
      build_scenario_trend(&scenario_key, &scenario_attempts, now)
    })
    .collect::<Vec<_>>();

  scenario_trends.sort_by(|left, right| {
    trend_sort_rank(left.trend.status)
      .cmp(&trend_sort_rank(right.trend.status))
      .then_with(|| {
        match (left.trend.delta_pct, right.trend.delta_pct) {
          (Some(left_delta), Some(right_delta)) => left_delta
            .partial_cmp(&right_delta)
            .unwrap_or(std::cmp::Ordering::Equal),
          (Some(_), None) => std::cmp::Ordering::Less,
          (None, Some(_)) => std::cmp::Ordering::Greater,
          (None, None) => std::cmp::Ordering::Equal,
        }
      })
      .then_with(|| {
        left
          .trend
          .scenario_name
          .to_lowercase()
          .cmp(&right.trend.scenario_name.to_lowercase())
      })
  });

  let recommendations = build_daily_recommendations(&scenario_trends);
  let mut improving_count = 0_i64;
  let mut flat_count = 0_i64;
  let mut declining_count = 0_i64;
  let mut insufficient_data_count = 0_i64;

  for trend in &scenario_trends {
    match trend.trend.status {
      TrendStatus::Improving => improving_count += 1,
      TrendStatus::Flat => flat_count += 1,
      TrendStatus::Declining => declining_count += 1,
      TrendStatus::InsufficientData => insufficient_data_count += 1,
    }
  }

  let has_quality_data = !scenario_trends.is_empty();
  ProgressCoach {
    improving_count,
    flat_count,
    declining_count,
    insufficient_data_count,
    scenario_trends: scenario_trends
      .into_iter()
      .map(|trend_build| trend_build.trend)
      .collect(),
    recommendations,
    has_quality_data,
  }
}

fn build_scenario_trend(
  scenario_key: &str,
  scenario_attempts: &[&AttemptSummary],
  now: i64,
) -> Option<ScenarioTrendBuild> {
  if scenario_attempts.is_empty() {
    return None;
  }

  let cutoff7 = now - TREND_WINDOW_7_DAYS_SECONDS;
  let cutoff30 = now - TREND_WINDOW_30_DAYS_SECONDS;
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
  let Some(metric_type) = select_scenario_metric(score_runs_30, accuracy_runs_30) else {
    return None;
  };

  let selected_samples = scenario_attempts
    .iter()
    .filter_map(|attempt| {
      let quality = attempt.quality.as_ref()?;
      if quality.metric_type != metric_type {
        return None;
      }

      Some((attempt.ended_at, quality.value))
    })
    .collect::<Vec<_>>();
  if selected_samples.is_empty() {
    return None;
  }

  let personal_best = selected_samples
    .iter()
    .map(|(_, value)| *value)
    .max_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal))?;
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
  let delta_pct = match (avg7d, avg30d) {
    (Some(avg7), Some(avg30)) => Some((avg7 - avg30) / avg30.max(0.0001)),
    _ => None,
  };
  let status = classify_trend(run_count7d, run_count30d, delta_pct);
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
  let scenario_name = scenario_attempts
    .iter()
    .max_by_key(|attempt| attempt.ended_at)
    .map(|attempt| attempt.scenario_name.clone())
    .unwrap_or_else(|| scenario_key.to_string());

  Some(ScenarioTrendBuild {
    scenario_key: scenario_key.to_string(),
    trend: ScenarioTrend {
      scenario_name,
      metric_type,
      personal_best,
      avg7d,
      avg30d,
      delta_pct,
      status,
      run_count7d: run_count7d as i64,
      run_count30d: run_count30d as i64,
      seconds_last7d,
      seconds_last30d,
    },
    undertrained_ratio: if seconds_last30d > 0 {
      Some(seconds_last7d as f64 / seconds_last30d as f64)
    } else {
      None
    },
  })
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

fn build_daily_recommendations(scenarios: &[ScenarioTrendBuild]) -> Vec<CoachRecommendation> {
  if scenarios.is_empty() {
    return Vec::new();
  }

  let mut declining = scenarios
    .iter()
    .filter(|scenario| scenario.trend.status == TrendStatus::Declining)
    .collect::<Vec<_>>();
  declining.sort_by(|left, right| {
    let left_delta = left.trend.delta_pct.unwrap_or(0.0);
    let right_delta = right.trend.delta_pct.unwrap_or(0.0);
    left_delta
      .partial_cmp(&right_delta)
      .unwrap_or(std::cmp::Ordering::Equal)
      .then_with(|| {
        left
          .trend
          .scenario_name
          .to_lowercase()
          .cmp(&right.trend.scenario_name.to_lowercase())
      })
  });

  let mut undertrained = scenarios
    .iter()
    .filter(|scenario| scenario.undertrained_ratio.is_some())
    .collect::<Vec<_>>();
  undertrained.sort_by(|left, right| {
    left
      .undertrained_ratio
      .unwrap_or(1.0)
      .partial_cmp(&right.undertrained_ratio.unwrap_or(1.0))
      .unwrap_or(std::cmp::Ordering::Equal)
      .then_with(|| {
        left
          .trend
          .scenario_name
          .to_lowercase()
          .cmp(&right.trend.scenario_name.to_lowercase())
      })
  });

  let mut recommendations = Vec::<CoachRecommendation>::new();
  let mut selected_keys = HashSet::<String>::new();
  for candidate in declining.iter().take(2) {
    push_recommendation(
      &mut recommendations,
      &mut selected_keys,
      candidate,
      CoachRecommendationReason::Declining,
      true,
    );
  }

  for candidate in &undertrained {
    if recommendations.len() >= COACH_SLOT_COUNT {
      break;
    }

    push_recommendation(
      &mut recommendations,
      &mut selected_keys,
      candidate,
      CoachRecommendationReason::UnderTrained,
      true,
    );
  }

  for candidate in &declining {
    if recommendations.len() >= COACH_SLOT_COUNT {
      break;
    }

    push_recommendation(
      &mut recommendations,
      &mut selected_keys,
      candidate,
      CoachRecommendationReason::Declining,
      true,
    );
  }

  for candidate in &undertrained {
    if recommendations.len() >= COACH_SLOT_COUNT {
      break;
    }

    push_recommendation(
      &mut recommendations,
      &mut selected_keys,
      candidate,
      CoachRecommendationReason::UnderTrained,
      true,
    );
  }

  if recommendations.len() < COACH_SLOT_COUNT {
    let mut fallback_pool = Vec::<(&ScenarioTrendBuild, CoachRecommendationReason)>::new();
    fallback_pool.extend(
      declining
        .iter()
        .map(|candidate| (*candidate, CoachRecommendationReason::Declining)),
    );
    fallback_pool.extend(
      undertrained
        .iter()
        .map(|candidate| (*candidate, CoachRecommendationReason::UnderTrained)),
    );
    if !fallback_pool.is_empty() {
      let mut index = 0_usize;
      while recommendations.len() < COACH_SLOT_COUNT {
        let (candidate, reason) = fallback_pool[index % fallback_pool.len()];
        push_recommendation(
          &mut recommendations,
          &mut selected_keys,
          candidate,
          reason,
          false,
        );
        index += 1;
      }
    }
  }

  recommendations
}

fn push_recommendation(
  recommendations: &mut Vec<CoachRecommendation>,
  selected_keys: &mut HashSet<String>,
  candidate: &ScenarioTrendBuild,
  reason: CoachRecommendationReason,
  prevent_duplicates: bool,
) {
  if prevent_duplicates && !selected_keys.insert(candidate.scenario_key.clone()) {
    return;
  }

  let note = match reason {
    CoachRecommendationReason::Declining => {
      let avg7d = candidate.trend.avg7d.unwrap_or(0.0);
      let avg30d = candidate.trend.avg30d.unwrap_or(0.0);
      let delta_pct = candidate.trend.delta_pct.unwrap_or(0.0) * 100.0;
      format!("7d avg {avg7d:.2} vs 30d avg {avg30d:.2} ({delta_pct:+.1}%).")
    }
    CoachRecommendationReason::UnderTrained => {
      let ratio = candidate.undertrained_ratio.unwrap_or(1.0);
      let minutes_7d = (candidate.trend.seconds_last7d as f64 / 60.0).round() as i64;
      let minutes_30d = (candidate.trend.seconds_last30d as f64 / 60.0).round() as i64;
      format!("7d/30d volume ratio {ratio:.2} ({minutes_7d}m vs {minutes_30d}m).")
    }
  };

  recommendations.push(CoachRecommendation {
    scenario_name: candidate.trend.scenario_name.clone(),
    minutes: COACH_SLOT_MINUTES,
    reason,
    note,
  });
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
    })
    .collect()
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

  use chrono::{Local, Timelike};
  use crate::types::{CoachRecommendationReason, QualityMetricType, TrendStatus};

  use super::{
    build_progress_coach, build_overall_playlist_totals, extract_quoted_tokens, parse_attempt_file,
    playlists_dir_from_stats_dir, read_playlist_definitions, steam_library_paths,
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
