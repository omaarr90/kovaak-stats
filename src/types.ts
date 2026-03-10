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
export type CoachRecommendationReason = 'declining' | 'underTrained'

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

export type PlaytimeSummary = {
  totalSeconds: number
  attemptCount: number
  skippedFiles: number
  lastAttemptAt?: number | null
  sourcePath: string
  scenarios: ScenarioPlaytime[]
  playlists: PlaylistPlaytime[]
  dailySummaries: DailyPlaytime[]
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

export type UIState = {
  activeView: DashboardView
  playlistQuery: string
  scenarioQuery: string
  visibleMonthKey: string | null
  selectedDateKey: string | null
}
