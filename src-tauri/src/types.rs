use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QualityMetricType {
  Score,
  Accuracy,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrendStatus {
  Improving,
  Flat,
  Declining,
  InsufficientData,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CoachRecommendationReason {
  Declining,
  UnderTrained,
}

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
pub struct DailyPlaylistPlaytime {
  pub name: String,
  pub total_seconds: i64,
  pub matched_scenarios: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPlaytime {
  pub date_key: String,
  pub total_seconds: i64,
  pub attempt_count: i64,
  pub playlists: Vec<DailyPlaylistPlaytime>,
  pub scenarios: Vec<ScenarioPlaytime>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioTrend {
  pub scenario_name: String,
  pub metric_type: QualityMetricType,
  pub personal_best: f64,
  pub avg7d: Option<f64>,
  pub avg30d: Option<f64>,
  pub delta_pct: Option<f64>,
  pub status: TrendStatus,
  pub run_count7d: i64,
  pub run_count30d: i64,
  pub seconds_last7d: i64,
  pub seconds_last30d: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachRecommendation {
  pub scenario_name: String,
  pub minutes: i64,
  pub reason: CoachRecommendationReason,
  pub note: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressCoach {
  pub improving_count: i64,
  pub flat_count: i64,
  pub declining_count: i64,
  pub insufficient_data_count: i64,
  pub scenario_trends: Vec<ScenarioTrend>,
  pub recommendations: Vec<CoachRecommendation>,
  pub has_quality_data: bool,
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
  pub daily_summaries: Vec<DailyPlaytime>,
  pub progress_coach: ProgressCoach,
}
