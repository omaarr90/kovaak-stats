use serde::{Deserialize, Serialize};

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
  Stale,
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
  pub last_played_at: Option<i64>,
  pub seconds_last30d: i64,
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
pub struct QualitySample {
  pub ended_at: i64,
  pub value: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioAnalytics {
  pub scenario_name: String,
  pub metric_type: Option<QualityMetricType>,
  pub total_seconds: i64,
  pub attempt_count: i64,
  pub last_played_at: Option<i64>,
  pub seconds_last7d: i64,
  pub seconds_last30d: i64,
  pub seconds_last90d: i64,
  pub attempts_last7d: i64,
  pub attempts_last30d: i64,
  pub attempts_last90d: i64,
  pub trend_status: TrendStatus,
  pub delta_pct: Option<f64>,
  pub personal_best: Option<f64>,
  pub personal_best_at: Option<i64>,
  pub latest_quality_value: Option<f64>,
  pub recent_quality_samples: Vec<QualitySample>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendHighlight {
  pub scenario_name: String,
  pub delta_pct: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencySummary {
  pub current_streak_days: i64,
  pub longest_streak_days: i64,
  pub active_days7d: i64,
  pub active_days30d: i64,
  pub best_week_seconds: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightsSummary {
  pub recent_personal_bests7d: i64,
  pub top_improvers: Vec<TrendHighlight>,
  pub top_decliners: Vec<TrendHighlight>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachReasonStats {
  pub decline_severity: f64,
  pub undertraining_gap: f64,
  pub recency_gap: f64,
  pub days_since_last_played: i64,
  pub delta_pct: Option<f64>,
  pub seconds_last7d: i64,
  pub seconds_last30d: i64,
  pub attempts_last30d: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachRecommendation {
  pub scenario_name: String,
  pub minutes: i64,
  pub reason: CoachRecommendationReason,
  pub note: String,
  pub priority_score: f64,
  pub confidence: f64,
  pub reason_stats: CoachReasonStats,
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
  pub consistency: ConsistencySummary,
  pub highlights: HighlightsSummary,
  pub scenario_analytics: Vec<ScenarioAnalytics>,
  pub progress_coach: ProgressCoach,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
  pub is_tracking: bool,
  pub scenario_path: Option<String>,
  pub scenario_name: Option<String>,
  pub started_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSegmentContribution {
  pub scenario_path: String,
  pub scenario_name: String,
  pub playlist_in_progress: bool,
  pub started_at: i64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerDiagnostics {
  pub is_kovaak_running: bool,
  pub matched_process_name: Option<String>,
  pub session_path: String,
  pub session_file_exists: bool,
  pub session_file_modified_at: Option<i64>,
  pub last_snapshot_scenario_name: Option<String>,
  pub last_snapshot_scenario_path: Option<String>,
  pub last_snapshot_playlist_in_progress: Option<bool>,
  pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioRef {
  pub scenario_path: String,
  pub scenario_name: String,
  pub total_seconds: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistStat {
  pub playlist_id: Option<i64>,
  pub playlist_name: String,
  pub total_seconds: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistRecord {
  pub id: i64,
  pub name: String,
  pub scenario_paths: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsOverview {
  pub total_seconds: i64,
  pub scenarios: Vec<ScenarioRef>,
  pub playlists: Vec<PlaylistStat>,
  pub active_session: ActiveSession,
  pub diagnostics: TrackerDiagnostics,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
  pub session_path_override: Option<String>,
  pub start_with_windows: bool,
  pub minimize_to_tray: bool,
  pub auto_check_updates: bool,
  pub refresh_interval_seconds: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsInput {
  pub session_path_override: Option<String>,
  pub start_with_windows: Option<bool>,
  pub minimize_to_tray: Option<bool>,
  pub auto_check_updates: Option<bool>,
  pub refresh_interval_seconds: Option<i64>,
}
