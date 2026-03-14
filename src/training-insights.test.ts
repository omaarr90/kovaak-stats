import { describe, expect, it } from 'vitest'
import {
  buildFocusAreaSummaries,
  buildGoalProgress,
  buildPersonalBestTimeline,
  buildReadinessSummary,
  buildSessionRecap,
  buildTrainingPlan,
  getPresetFilters,
  getScenariosForPreset,
} from './training-insights'
import { type FocusArea, type PlaytimeSummary, type TrainingGoal } from './types'

describe('training-insights', () => {
  it('builds goal progress from recent volume and activity', () => {
    const goals: TrainingGoal[] = [
      { id: 'weeklyHours', label: 'Weekly playtime', unit: 'hours', target: 2 },
      { id: 'activeDays', label: 'Active days', unit: 'days', target: 5 },
      { id: 'scenarioRotation', label: 'Scenario rotation', unit: 'scenarios', target: 3 },
    ]

    const progress = buildGoalProgress(buildSummary(), goals)

    expect(progress.map((goal) => goal.current)).toEqual([2.1, 4, 2])
    expect(progress[0].progress).toBe(1)
  })

  it('builds session recap using selected-day play and personal best timestamps', () => {
    const summary = buildSummary()

    const recap = buildSessionRecap(summary, '2026-03-12')

    expect(recap.topScenarioNames).toEqual(['Declining Close', 'Switch Active'])
    expect(recap.personalBestScenarioNames).toEqual(['Switch Active'])
    expect(recap.decliningScenarioNames).toEqual(['Declining Close'])
    expect(recap.suggestedNextScenarioNames).toEqual(['Declining Close'])
  })

  it('returns preset filters and candidate ordering for stale practice', () => {
    const summary = buildSummary()

    const filters = getPresetFilters('stale')
    const scenarios = getScenariosForPreset(summary, 'stale')

    expect(filters.scenarioRecencyFilter).toBe('stale30d')
    expect(filters.scenarioSortField).toBe('lastPlayedAt')
    expect(scenarios.map((scenario) => scenario.scenarioName)).toEqual(['Dormant Static'])
  })

  it('summarizes focus areas and workload readiness from recent rotation', () => {
    const summary = buildSummary()
    const focusAreas: FocusArea[] = [
      {
        id: 'precision',
        label: 'Precision',
        scenarioNames: ['Declining Close', 'Dormant Static'],
      },
      {
        id: 'switching',
        label: 'Switching',
        scenarioNames: ['Switch Active'],
      },
    ]

    const focusAreaSummaries = buildFocusAreaSummaries(summary, focusAreas)
    const readiness = buildReadinessSummary(summary, focusAreaSummaries)

    expect(focusAreaSummaries).toHaveLength(2)
    expect(focusAreaSummaries[0].neglectedCount).toBe(1)
    expect(focusAreaSummaries[1].secondsLast7d).toBe(3900)
    expect(readiness.status).toBe('overloaded')
    expect(readiness.focusAreaCoverage).toBe(1)
    expect(readiness.narrowTrainingWarning).toBe(false)
  })

  it('builds a structured plan and PB timeline for coach-first practice', () => {
    const summary = buildSummary()
    const focusAreas: FocusArea[] = [
      {
        id: 'precision',
        label: 'Precision',
        scenarioNames: ['Declining Close', 'Dormant Static'],
      },
    ]

    const plan = buildTrainingPlan(summary, focusAreas, 'declining', 'precision', 30)
    const timeline = buildPersonalBestTimeline(summary)

    expect(plan.durationMinutes).toBe(30)
    expect(plan.focusAreaLabel).toBe('Precision')
    expect(plan.blocks.map((block) => block.phase)).toEqual(['warmup', 'main', 'main', 'cleanup'])
    expect(plan.blocks[1].scenarioName).toBe('Declining Close')
    expect(plan.blocks.some((block) => block.scenarioName === 'Dormant Static')).toBe(true)
    expect(timeline.map((entry) => entry.scenarioName)).toEqual(['Switch Active', 'Declining Close'])
  })
})

function buildSummary(): PlaytimeSummary {
  const now = Math.floor(new Date('2026-03-14T12:00:00').getTime() / 1000)
  const twoDaysAgo = Math.floor(new Date('2026-03-12T10:00:00').getTime() / 1000)
  const fortyDaysAgo = Math.floor(new Date('2026-02-01T10:00:00').getTime() / 1000)

  return {
    totalSeconds: 7200,
    attemptCount: 24,
    skippedFiles: 0,
    lastAttemptAt: now,
    sourcePath: 'C:\\stats',
    scenarios: [],
    playlists: [],
    dailySummaries: [
      {
        dateKey: '2026-03-12',
        totalSeconds: 1800,
        attemptCount: 6,
        playlists: [],
        scenarios: [
          { name: 'Declining Close', totalSeconds: 900, attemptCount: 3 },
          { name: 'Switch Active', totalSeconds: 900, attemptCount: 3 },
        ],
      },
    ],
    consistency: {
      currentStreakDays: 3,
      longestStreakDays: 5,
      activeDays7d: 4,
      activeDays30d: 8,
      bestWeekSeconds: 4000,
    },
    highlights: {
      recentPersonalBests7d: 1,
      topImprovers: [],
      topDecliners: [],
    },
    scenarioAnalytics: [
      {
        scenarioName: 'Declining Close',
        metricType: 'score',
        totalSeconds: 2400,
        attemptCount: 9,
        lastPlayedAt: twoDaysAgo,
        secondsLast7d: 3600,
        secondsLast30d: 5400,
        secondsLast90d: 7200,
        attemptsLast7d: 4,
        attemptsLast30d: 6,
        attemptsLast90d: 9,
        trendStatus: 'declining',
        deltaPct: -0.12,
        personalBest: 112.5,
        personalBestAt: now - 10 * 24 * 60 * 60,
        latestQualityValue: 96.2,
        recentQualitySamples: [],
      },
      {
        scenarioName: 'Switch Active',
        metricType: 'score',
        totalSeconds: 1800,
        attemptCount: 10,
        lastPlayedAt: twoDaysAgo,
        secondsLast7d: 3900,
        secondsLast30d: 4500,
        secondsLast90d: 5000,
        attemptsLast7d: 5,
        attemptsLast30d: 8,
        attemptsLast90d: 10,
        trendStatus: 'improving',
        deltaPct: 0.08,
        personalBest: 135,
        personalBestAt: twoDaysAgo,
        latestQualityValue: 134.1,
        recentQualitySamples: [],
      },
      {
        scenarioName: 'Dormant Static',
        metricType: null,
        totalSeconds: 3000,
        attemptCount: 5,
        lastPlayedAt: fortyDaysAgo,
        secondsLast7d: 0,
        secondsLast30d: 0,
        secondsLast90d: 900,
        attemptsLast7d: 0,
        attemptsLast30d: 0,
        attemptsLast90d: 2,
        trendStatus: 'insufficientData',
        deltaPct: null,
        personalBest: null,
        personalBestAt: null,
        latestQualityValue: null,
        recentQualitySamples: [],
      },
    ],
    progressCoach: {
      improvingCount: 1,
      flatCount: 0,
      decliningCount: 1,
      insufficientDataCount: 1,
      scenarioTrends: [],
      recommendations: [
        {
          scenarioName: 'Declining Close',
          minutes: 5,
          reason: 'declining',
          note: 'Recover recent quality loss before it compounds.',
          priorityScore: 0.9,
          confidence: 0.75,
          reasonStats: {
            declineSeverity: 0.12,
            undertrainingGap: 0,
            recencyGap: 2,
            daysSinceLastPlayed: 2,
            deltaPct: -0.12,
            secondsLast7d: 1200,
            secondsLast30d: 3000,
            attemptsLast30d: 6,
          },
        },
      ],
      hasQualityData: true,
    },
  }
}
