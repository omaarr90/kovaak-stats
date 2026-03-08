use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioPlaytime {
  pub name: String,
  pub total_seconds: i64,
  pub attempt_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPlaytime {
  pub name: String,
  pub total_seconds: i64,
  pub matched_scenarios: i64,
  pub total_scenarios: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeSummary {
  pub total_seconds: i64,
  pub attempt_count: i64,
  pub skipped_files: i64,
  pub last_attempt_at: Option<i64>,
  pub source_path: String,
  pub scenarios: Vec<ScenarioPlaytime>,
  pub playlists: Vec<PlaylistPlaytime>,
}
