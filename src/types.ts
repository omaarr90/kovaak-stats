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
  activeView: DashboardView
  playlistQuery: string
  scenarioQuery: string
  scenarioTrendFilter: ScenarioTrendFilter
  scenarioVolumeFilter: ScenarioVolumeFilter
  scenarioRecencyFilter: ScenarioRecencyFilter
  scenarioSortField: ScenarioSortField
  selectedScenarioName: string | null
  visibleMonthKey: string | null
  selectedDateKey: string | null
}
