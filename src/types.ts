export type ScenarioPlaytime = {
  name: string
  totalSeconds: number
  attemptCount: number
}

export type PlaylistPlaytime = {
  name: string
  totalSeconds: number
  matchedScenarios: number
  totalScenarios: number
  lastPlayedAt?: number | null
  secondsLast30d: number
}

export type DailyPlaylistPlaytime = {
  name: string
  totalSeconds: number
  matchedScenarios: number
}

export type DailyPlaytime = {
  dateKey: string
  totalSeconds: number
  attemptCount: number
  playlists: DailyPlaylistPlaytime[]
  scenarios: ScenarioPlaytime[]
}

export type QualityMetricType = 'score' | 'accuracy'
export type TrendStatus = 'improving' | 'flat' | 'declining' | 'insufficientData'
export type CoachRecommendationReason = 'declining' | 'underTrained' | 'stale'

export type ScenarioTrend = {
  scenarioName: string
  metricType: QualityMetricType
  personalBest: number
  avg7d?: number | null
  avg30d?: number | null
  deltaPct?: number | null
  status: TrendStatus
  runCount7d: number
  runCount30d: number
  secondsLast7d: number
  secondsLast30d: number
}

export type CoachRecommendation = {
  scenarioName: string
  minutes: number
  reason: CoachRecommendationReason
  note: string
  priorityScore: number
  confidence: number
  reasonStats: {
    declineSeverity: number
    undertrainingGap: number
    recencyGap: number
    daysSinceLastPlayed: number
    deltaPct?: number | null
    secondsLast7d: number
    secondsLast30d: number
    attemptsLast30d: number
  }
}

export type ProgressCoach = {
  improvingCount: number
  flatCount: number
  decliningCount: number
  insufficientDataCount: number
  scenarioTrends: ScenarioTrend[]
  recommendations: CoachRecommendation[]
  hasQualityData: boolean
}

export type ConsistencySummary = {
  currentStreakDays: number
  longestStreakDays: number
  activeDays7d: number
  activeDays30d: number
  bestWeekSeconds: number
}

export type TrendHighlight = {
  scenarioName: string
  deltaPct: number
}

export type HighlightsSummary = {
  recentPersonalBests7d: number
  topImprovers: TrendHighlight[]
  topDecliners: TrendHighlight[]
}

export type QualitySample = {
  endedAt: number
  value: number
}

export type ScenarioAnalytics = {
  scenarioName: string
  metricType?: QualityMetricType | null
  totalSeconds: number
  attemptCount: number
  lastPlayedAt?: number | null
  secondsLast7d: number
  secondsLast30d: number
  secondsLast90d: number
  attemptsLast7d: number
  attemptsLast30d: number
  attemptsLast90d: number
  trendStatus: TrendStatus
  deltaPct?: number | null
  personalBest?: number | null
  personalBestAt?: number | null
  latestQualityValue?: number | null
  recentQualitySamples: QualitySample[]
}

export type PlaytimeSummary = {
  totalSeconds: number
  attemptCount: number
  skippedFiles: number
  lastAttemptAt?: number | null
  sourcePath: string
  scenarios: ScenarioPlaytime[]
  playlists: PlaylistPlaytime[]
  dailySummaries: DailyPlaytime[]
  consistency: ConsistencySummary
  highlights: HighlightsSummary
  scenarioAnalytics: ScenarioAnalytics[]
  progressCoach: ProgressCoach
}

export type CalendarCell =
  | {
      kind: 'spacer'
      key: string
    }
  | {
      kind: 'day'
      key: string
      dateKey: string
      dayNumber: number
      summary: DailyPlaytime | null
    }

export type DashboardView = 'overview' | 'calendar' | 'breakdowns' | 'coach'

export type AppDashboardView = 'overview' | 'analysis' | 'practice' | 'settings'

export type ScenarioTrendFilter = 'all' | 'improving' | 'flat' | 'declining' | 'insufficientData'
export type ScenarioVolumeFilter = 'all' | 'active7d' | 'active30d' | 'quiet7d'
export type ScenarioRecencyFilter = 'all' | 'played7d' | 'played30d' | 'played90d' | 'stale30d'
export type ScenarioSortField =
  | 'totalSeconds'
  | 'secondsLast30d'
  | 'attemptsLast30d'
  | 'deltaPct'
  | 'lastPlayedAt'
  | 'personalBest'

export type UIState = {
  activeView: AppDashboardView
  playlistQuery: string
  scenarioQuery: string
  scenarioTrendFilter: ScenarioTrendFilter
  scenarioVolumeFilter: ScenarioVolumeFilter
  scenarioRecencyFilter: ScenarioRecencyFilter
  scenarioSortField: ScenarioSortField
  selectedScenarioName: string | null
  visibleMonthKey: string | null
  selectedDateKey: string | null
  activeFocusPreset: FocusPresetId
  selectedFocusAreaId: string | null
  planDurationMinutes: PracticeDuration
  liveMilestonesEnabled: boolean
  selectedPlaylistId: number | null
  trackedScenarioQuery: string
}

export type UserSettings = {
  sessionPathOverride?: string | null
  startWithWindows: boolean
  minimizeToTray: boolean
  autoCheckUpdates: boolean
  refreshIntervalSeconds: number
}

export type UpdateUserSettingsInput = {
  sessionPathOverride?: string | null
  startWithWindows?: boolean
  minimizeToTray?: boolean
  autoCheckUpdates?: boolean
  refreshIntervalSeconds?: number
}

export type ScenarioRef = {
  scenarioPath: string
  scenarioName: string
  totalSeconds: number
}

export type PlaylistRecord = {
  id: number
  name: string
  scenarioPaths: string[]
}

export type PlaylistStat = {
  playlistId?: number | null
  playlistName: string
  totalSeconds: number
}

export type ActiveSession = {
  isTracking: boolean
  scenarioPath?: string | null
  scenarioName?: string | null
  startedAt?: number | null
}

export type TrackerDiagnostics = {
  isKovaakRunning: boolean
  matchedProcessName?: string | null
  sessionPath: string
  sessionFileExists: boolean
  sessionFileModifiedAt?: number | null
  lastSnapshotScenarioName?: string | null
  lastSnapshotScenarioPath?: string | null
  lastSnapshotPlaylistInProgress?: boolean | null
  lastError?: string | null
}

export type StatsOverview = {
  totalSeconds: number
  scenarios: ScenarioRef[]
  playlists: PlaylistStat[]
  activeSession: ActiveSession
  diagnostics: TrackerDiagnostics
}

export type TrainingGoalType = 'weeklyHours' | 'activeDays' | 'scenarioRotation'

export type TrainingGoal = {
  id: TrainingGoalType
  label: string
  unit: string
  target: number
}

export type GoalProgress = {
  id: TrainingGoalType
  label: string
  unit: string
  target: number
  current: number
  progress: number
}

export type FocusPresetId = 'improving' | 'declining' | 'stale' | 'pbHunt'

export type FocusPreset = {
  id: FocusPresetId
  label: string
  description: string
}

export type FocusArea = {
  id: string
  label: string
  scenarioNames: string[]
}

export type FocusAreaSummary = {
  id: string
  label: string
  scenarioCount: number
  secondsLast7d: number
  secondsLast30d: number
  neglectedCount: number
  assignedScenarioNames: string[]
}

export type PracticeDuration = 20 | 30 | 45

export type TrainingPlanPhase = 'warmup' | 'main' | 'cleanup'

export type TrainingPlanBlock = {
  phase: TrainingPlanPhase
  minutes: number
  scenarioName: string
  reason: string
}

export type TrainingPlan = {
  durationMinutes: PracticeDuration
  focusAreaId: string | null
  focusAreaLabel: string | null
  blocks: TrainingPlanBlock[]
  summary: string
}

export type ReadinessSummary = {
  status: 'underloaded' | 'balanced' | 'overloaded'
  recentLoadSeconds: number
  baselineWeeklySeconds: number
  diversityRatio: number
  focusAreaCoverage: number
  narrowTrainingWarning: boolean
  message: string
}

export type PersonalBestTimelineEntry = {
  scenarioName: string
  personalBest: number
  personalBestAt: number
  metricType?: QualityMetricType | null
}

export type LiveNotification = {
  id: string
  title: string
  body: string
  tone: 'neutral' | 'improving' | 'declining'
}

export type SessionRecap = {
  dateKey: string
  totalSeconds: number
  attemptCount: number
  topScenarioNames: string[]
  personalBestScenarioNames: string[]
  decliningScenarioNames: string[]
  suggestedNextScenarioNames: string[]
}
