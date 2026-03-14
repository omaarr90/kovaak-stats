import {
  type FocusPreset,
  type FocusArea,
  type FocusAreaSummary,
  type FocusPresetId,
  type GoalProgress,
  type PersonalBestTimelineEntry,
  type PlaytimeSummary,
  type PracticeDuration,
  type ReadinessSummary,
  type SessionRecap,
  type TrainingPlan,
  type TrainingPlanBlock,
  type TrainingGoal,
  type UIState,
} from './types'

export const FOCUS_PRESETS: FocusPreset[] = [
  {
    id: 'declining',
    label: 'Declining',
    description: 'Recover scenarios where recent quality is below your broader baseline.',
  },
  {
    id: 'improving',
    label: 'Improving',
    description: 'Lean into momentum and keep trending scenarios hot.',
  },
  {
    id: 'stale',
    label: 'Stale',
    description: 'Bring neglected scenarios back into rotation before they drift further.',
  },
  {
    id: 'pbHunt',
    label: 'PB Hunt',
    description: 'Queue up scenarios where you are close enough to challenge your personal best.',
  },
]

export const DEFAULT_TRAINING_GOALS: TrainingGoal[] = [
  { id: 'weeklyHours', label: 'Weekly playtime', unit: 'hours', target: 5 },
  { id: 'activeDays', label: 'Active days', unit: 'days', target: 5 },
  { id: 'scenarioRotation', label: 'Scenario rotation', unit: 'scenarios', target: 12 },
]

export function buildGoalProgress(
  summary: PlaytimeSummary | null,
  goals: TrainingGoal[],
): GoalProgress[] {
  return goals.map((goal) => {
    const current = calculateGoalCurrent(summary, goal.id)
    return {
      ...goal,
      current,
      progress: goal.target > 0 ? Math.min(1, current / goal.target) : 0,
    }
  })
}

function calculateGoalCurrent(summary: PlaytimeSummary | null, goalId: TrainingGoal['id']): number {
  if (!summary) {
    return 0
  }

  if (goalId === 'weeklyHours') {
    const seconds = summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast7d, 0)
    return Math.round((seconds / 3600) * 10) / 10
  }

  if (goalId === 'activeDays') {
    return summary.consistency.activeDays7d
  }

  return summary.scenarioAnalytics.filter((scenario) => scenario.secondsLast7d > 0).length
}

export function buildSessionRecap(
  summary: PlaytimeSummary | null,
  dateKey: string,
): SessionRecap {
  const selectedDay = summary?.dailySummaries.find((day) => day.dateKey === dateKey)
  const personalBestScenarioNames =
    summary?.scenarioAnalytics
      .filter((scenario) => toDateKeyFromTimestamp(scenario.personalBestAt) === dateKey)
      .map((scenario) => scenario.scenarioName)
      .slice(0, 3) ?? []
  const decliningScenarioNames =
    selectedDay?.scenarios
      .filter((scenario) =>
        summary?.scenarioAnalytics.some(
          (analytics) =>
            analytics.scenarioName === scenario.name && analytics.trendStatus === 'declining',
        ),
      )
      .map((scenario) => scenario.name)
      .slice(0, 3) ?? []
  const suggestedNextScenarioNames =
    summary?.progressCoach.recommendations.map((recommendation) => recommendation.scenarioName).slice(0, 3) ?? []

  return {
    dateKey,
    totalSeconds: selectedDay?.totalSeconds ?? 0,
    attemptCount: selectedDay?.attemptCount ?? 0,
    topScenarioNames: selectedDay?.scenarios.slice(0, 3).map((scenario) => scenario.name) ?? [],
    personalBestScenarioNames,
    decliningScenarioNames,
    suggestedNextScenarioNames,
  }
}

export function getScenariosForPreset(summary: PlaytimeSummary | null, presetId: FocusPresetId) {
  const scenarios = summary?.scenarioAnalytics ?? []

  if (presetId === 'declining') {
    return [...scenarios]
      .filter((scenario) => scenario.trendStatus === 'declining')
      .sort((left, right) => (left.deltaPct ?? 0) - (right.deltaPct ?? 0))
  }

  if (presetId === 'improving') {
    return [...scenarios]
      .filter((scenario) => scenario.trendStatus === 'improving')
      .sort((left, right) => (right.deltaPct ?? 0) - (left.deltaPct ?? 0))
  }

  if (presetId === 'stale') {
    return [...scenarios]
      .filter((scenario) => calculateDaysSinceLastPlayed(scenario.lastPlayedAt) > 30)
      .sort((left, right) => (left.lastPlayedAt ?? 0) - (right.lastPlayedAt ?? 0))
  }

  return [...scenarios]
    .filter(
      (scenario) =>
        scenario.personalBest &&
        scenario.latestQualityValue &&
        scenario.personalBest > 0 &&
        scenario.metricType,
    )
    .sort((left, right) => personalBestCloseness(left) - personalBestCloseness(right))
    .slice(0, 12)
}

function personalBestCloseness(
  scenario: PlaytimeSummary['scenarioAnalytics'][number],
) {
  if (!scenario.personalBest || !scenario.latestQualityValue || scenario.personalBest <= 0) {
    return Number.POSITIVE_INFINITY
  }

  return Math.abs(1 - scenario.latestQualityValue / scenario.personalBest)
}

export function getPresetFilters(
  presetId: FocusPresetId,
): Pick<
  UIState,
  'scenarioTrendFilter' | 'scenarioVolumeFilter' | 'scenarioRecencyFilter' | 'scenarioSortField'
> {
  if (presetId === 'declining') {
    return {
      scenarioTrendFilter: 'declining',
      scenarioVolumeFilter: 'all',
      scenarioRecencyFilter: 'played30d',
      scenarioSortField: 'deltaPct',
    }
  }

  if (presetId === 'improving') {
    return {
      scenarioTrendFilter: 'improving',
      scenarioVolumeFilter: 'active7d',
      scenarioRecencyFilter: 'played30d',
      scenarioSortField: 'deltaPct',
    }
  }

  if (presetId === 'stale') {
    return {
      scenarioTrendFilter: 'all',
      scenarioVolumeFilter: 'all',
      scenarioRecencyFilter: 'stale30d',
      scenarioSortField: 'lastPlayedAt',
    }
  }

  return {
    scenarioTrendFilter: 'all',
    scenarioVolumeFilter: 'active30d',
    scenarioRecencyFilter: 'played30d',
    scenarioSortField: 'personalBest',
  }
}

export function buildWeeklyActivity(dailySummaries: PlaytimeSummary['dailySummaries']) {
  const weekTotals = new Map<string, number>()
  const now = new Date()
  const endOfWeek = new Date(now)
  endOfWeek.setHours(0, 0, 0, 0)
  endOfWeek.setDate(endOfWeek.getDate() - endOfWeek.getDay())

  for (let index = 0; index < 12; index += 1) {
    const weekStart = new Date(endOfWeek)
    weekStart.setDate(endOfWeek.getDate() - (11 - index) * 7)
    const key = toLocalDateKey(weekStart)
    weekTotals.set(key, 0)
  }

  for (const day of dailySummaries) {
    const date = new Date(`${day.dateKey}T00:00:00`)
    date.setDate(date.getDate() - date.getDay())
    const weekKey = toLocalDateKey(date)
    if (weekTotals.has(weekKey)) {
      weekTotals.set(weekKey, (weekTotals.get(weekKey) ?? 0) + day.totalSeconds)
    }
  }

  return [...weekTotals.entries()].map(([dateKey, totalSeconds]) => {
    const date = new Date(`${dateKey}T00:00:00`)
    return {
      label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
      totalSeconds,
    }
  })
}

export function buildMonthlyTotals(dailySummaries: PlaytimeSummary['dailySummaries']) {
  const totals = new Map<string, number>()

  for (const daily of dailySummaries) {
    const monthKey = daily.dateKey.slice(0, 7)
    totals.set(monthKey, (totals.get(monthKey) ?? 0) + daily.totalSeconds)
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-6)
    .map(([monthKey, totalSeconds]) => ({
      monthKey,
      totalSeconds,
    }))
}

export function buildWeekdayInsights(summary: PlaytimeSummary | null) {
  if (!summary) {
    return []
  }

  const totals = new Map<string, number>()
  for (const day of summary.dailySummaries) {
    const date = new Date(`${day.dateKey}T00:00:00`)
    const label = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
    totals.set(label, (totals.get(label) ?? 0) + day.totalSeconds)
  }

  return [...totals.entries()]
    .map(([label, totalSeconds]) => ({ label, totalSeconds }))
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
}

export function buildPersonalBestTimeline(
  summary: PlaytimeSummary | null,
  limit = 8,
): PersonalBestTimelineEntry[] {
  if (!summary) {
    return []
  }

  return summary.scenarioAnalytics
    .filter((scenario) => scenario.personalBest && scenario.personalBestAt)
    .map((scenario) => ({
      scenarioName: scenario.scenarioName,
      personalBest: scenario.personalBest as number,
      personalBestAt: scenario.personalBestAt as number,
      metricType: scenario.metricType,
    }))
    .sort((left, right) => right.personalBestAt - left.personalBestAt)
    .slice(0, limit)
}

export function buildFocusAreaSummaries(
  summary: PlaytimeSummary | null,
  focusAreas: FocusArea[],
): FocusAreaSummary[] {
  if (!summary) {
    return []
  }

  const scenarioLookup = new Map(
    summary.scenarioAnalytics.map((scenario) => [scenario.scenarioName, scenario]),
  )

  return focusAreas.map((focusArea) => {
    const assignedScenarios = focusArea.scenarioNames
      .map((name) => scenarioLookup.get(name))
      .filter((scenario): scenario is NonNullable<typeof scenario> => Boolean(scenario))

    return {
      id: focusArea.id,
      label: focusArea.label,
      scenarioCount: assignedScenarios.length,
      secondsLast7d: assignedScenarios.reduce((total, scenario) => total + scenario.secondsLast7d, 0),
      secondsLast30d: assignedScenarios.reduce((total, scenario) => total + scenario.secondsLast30d, 0),
      neglectedCount: assignedScenarios.filter((scenario) => calculateDaysSinceLastPlayed(scenario.lastPlayedAt) > 30).length,
      assignedScenarioNames: assignedScenarios.map((scenario) => scenario.scenarioName),
    }
  })
}

export function buildReadinessSummary(
  summary: PlaytimeSummary | null,
  focusAreaSummaries: FocusAreaSummary[],
): ReadinessSummary {
  if (!summary) {
    return {
      status: 'underloaded',
      recentLoadSeconds: 0,
      baselineWeeklySeconds: 0,
      diversityRatio: 0,
      focusAreaCoverage: 0,
      narrowTrainingWarning: false,
      message: 'No recent training data yet.',
    }
  }

  const recentLoadSeconds = summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast7d, 0)
  const baselineWeeklySeconds = Math.max(
    1,
    Math.floor(summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast30d, 0) / 4),
  )
  const loadRatio = recentLoadSeconds / baselineWeeklySeconds
  const recentlyActiveCount = summary.scenarioAnalytics.filter((scenario) => scenario.secondsLast7d > 0).length
  const monthlyActiveCount = Math.max(
    1,
    summary.scenarioAnalytics.filter((scenario) => scenario.secondsLast30d > 0).length,
  )
  const diversityRatio = recentlyActiveCount / monthlyActiveCount
  const coveredAreas = focusAreaSummaries.filter((area) => area.secondsLast7d > 0).length
  const focusAreaCoverage =
    focusAreaSummaries.length > 0 ? coveredAreas / focusAreaSummaries.length : diversityRatio
  const narrowTrainingWarning = diversityRatio < 0.45 || focusAreaCoverage < 0.5

  if (loadRatio < 0.6) {
    return {
      status: 'underloaded',
      recentLoadSeconds,
      baselineWeeklySeconds,
      diversityRatio,
      focusAreaCoverage,
      narrowTrainingWarning,
      message: 'Recent load is well below your 30-day baseline. You can push more volume safely.',
    }
  }

  if (loadRatio > 1.35) {
    return {
      status: 'overloaded',
      recentLoadSeconds,
      baselineWeeklySeconds,
      diversityRatio,
      focusAreaCoverage,
      narrowTrainingWarning,
      message: 'Recent load is high versus your baseline. Tighten scope or keep the next block shorter.',
    }
  }

  return {
    status: 'balanced',
    recentLoadSeconds,
    baselineWeeklySeconds,
    diversityRatio,
    focusAreaCoverage,
    narrowTrainingWarning,
    message: narrowTrainingWarning
      ? 'Load is fine, but the recent rotation is narrow. Bring in a stale or neglected scenario.'
      : 'Load and scenario rotation both look stable enough for focused work.',
  }
}

export function buildTrainingPlan(
  summary: PlaytimeSummary | null,
  focusAreas: FocusArea[],
  activeFocusPreset: FocusPresetId,
  selectedFocusAreaId: string | null,
  durationMinutes: PracticeDuration,
): TrainingPlan {
  const selectedFocusArea = focusAreas.find((focusArea) => focusArea.id === selectedFocusAreaId) ?? null
  const filterByFocusArea = (scenarioName: string) =>
    !selectedFocusArea || selectedFocusArea.scenarioNames.includes(scenarioName)

  const presetCandidates = getScenariosForPreset(summary, activeFocusPreset).filter((scenario) =>
    filterByFocusArea(scenario.scenarioName),
  )
  const improvingCandidates = getScenariosForPreset(summary, 'improving').filter((scenario) =>
    filterByFocusArea(scenario.scenarioName),
  )
  const staleCandidates = getScenariosForPreset(summary, 'stale').filter((scenario) =>
    filterByFocusArea(scenario.scenarioName),
  )
  const pbCandidates = getScenariosForPreset(summary, 'pbHunt').filter((scenario) =>
    filterByFocusArea(scenario.scenarioName),
  )
  const recommendationCandidates = (summary?.progressCoach.recommendations ?? []).filter((recommendation) =>
    filterByFocusArea(recommendation.scenarioName),
  )

  const queue = uniqueScenarioNames([
    ...recommendationCandidates.map((recommendation) => recommendation.scenarioName),
    ...presetCandidates.map((scenario) => scenario.scenarioName),
    ...improvingCandidates.map((scenario) => scenario.scenarioName),
    ...staleCandidates.map((scenario) => scenario.scenarioName),
    ...pbCandidates.map((scenario) => scenario.scenarioName),
  ])

  const warmupMinutes = durationMinutes === 45 ? 10 : 5
  const cleanupMinutes = durationMinutes === 20 ? 5 : 10
  const mainMinutes = Math.max(5, durationMinutes - warmupMinutes - cleanupMinutes)

  const blocks: TrainingPlanBlock[] = []
  blocks.push({
    phase: 'warmup',
    minutes: warmupMinutes,
    scenarioName: improvingCandidates[0]?.scenarioName ?? queue[0] ?? 'Any active scenario',
    reason: 'Open with a stable, recently played scenario to raise consistency before harder work.',
  })

  let remainingMainMinutes = mainMinutes
  let mainIndex = 0
  while (remainingMainMinutes > 0) {
    const blockMinutes = Math.min(10, remainingMainMinutes)
    blocks.push({
      phase: 'main',
      minutes: blockMinutes,
      scenarioName: queue[mainIndex % Math.max(1, queue.length)] ?? 'Coach pick',
      reason:
        mainIndex === 0
          ? 'Main block starts with the highest-priority recommendation from your current preset.'
          : 'Keep pressure on the same focus lane without widening scope too early.',
    })
    remainingMainMinutes -= blockMinutes
    mainIndex += 1
  }

  blocks.push({
    phase: 'cleanup',
    minutes: cleanupMinutes,
    scenarioName:
      pbCandidates[0]?.scenarioName ??
      staleCandidates[0]?.scenarioName ??
      queue[queue.length - 1] ??
      'PB watch or stale scenario',
    reason: 'Close with a PB watch or neglected scenario to widen coverage before you stop.',
  })

  return {
    durationMinutes,
    focusAreaId: selectedFocusArea?.id ?? null,
    focusAreaLabel: selectedFocusArea?.label ?? null,
    blocks,
    summary: selectedFocusArea
      ? `${durationMinutes}-minute ${activeFocusPreset} plan inside ${selectedFocusArea.label}.`
      : `${durationMinutes}-minute ${activeFocusPreset} plan across your full scenario pool.`,
  }
}

export function calculateDaysSinceLastPlayed(lastPlayedAt?: number | null): number {
  if (!lastPlayedAt) {
    return Number.POSITIVE_INFINITY
  }

  return Math.max(0, Math.floor((Date.now() - lastPlayedAt * 1000) / (24 * 60 * 60 * 1000)))
}

function toDateKeyFromTimestamp(timestamp?: number | null): string | null {
  if (!timestamp) {
    return null
  }

  return toLocalDateKey(new Date(timestamp * 1000))
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function uniqueScenarioNames(names: string[]): string[] {
  return [...new Set(names.filter(Boolean))]
}
