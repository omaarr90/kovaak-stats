use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Local, NaiveDateTime, NaiveTime, TimeZone};
use serde::Deserialize;

use crate::types::{
  DailyPlaylistPlaytime, DailyPlaytime, PlaylistPlaytime, PlaytimeSummary, ScenarioPlaytime,
};

const STATS_FOLDER_SEGMENTS: [&str; 4] = ["steamapps", "common", "FPSAimTrainer", "FPSAimTrainer"];
const MAX_ATTEMPT_DURATION_HOURS: i64 = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
struct AttemptSummary {
  scenario_name: String,
  duration_seconds: i64,
  ended_at: i64,
  date_key: String,
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

  Ok(PlaytimeSummary {
    total_seconds,
    attempt_count,
    skipped_files,
    last_attempt_at,
    source_path: stats_dir.display().to_string(),
    scenarios,
    playlists,
    daily_summaries,
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

  Ok(Some(AttemptSummary {
    scenario_name,
    duration_seconds: duration.num_seconds(),
    ended_at: end_at.timestamp(),
    date_key: end_at.format("%Y-%m-%d").to_string(),
  }))
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

  use super::{
    build_overall_playlist_totals, extract_quoted_tokens, parse_attempt_file,
    playlists_dir_from_stats_dir, read_playlist_definitions, steam_library_paths,
    summarize_daily_playtime, summarize_scenarios, AttemptSummary,
  };

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
      AttemptSummary {
        scenario_name: "Scenario A".to_string(),
        duration_seconds: 30,
        ended_at: 1,
        date_key: "2026-03-08".to_string(),
      },
      AttemptSummary {
        scenario_name: "Scenario A".to_string(),
        duration_seconds: 45,
        ended_at: 2,
        date_key: "2026-03-08".to_string(),
      },
      AttemptSummary {
        scenario_name: "Scenario B".to_string(),
        duration_seconds: 60,
        ended_at: 3,
        date_key: "2026-03-09".to_string(),
      },
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
      AttemptSummary {
        scenario_name: "Scenario A".to_string(),
        duration_seconds: 30,
        ended_at: 1,
        date_key: "2026-03-08".to_string(),
      },
      AttemptSummary {
        scenario_name: "Scenario B".to_string(),
        duration_seconds: 45,
        ended_at: 2,
        date_key: "2026-03-08".to_string(),
      },
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
}
