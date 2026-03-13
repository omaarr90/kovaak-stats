import { describe, expect, it } from 'vitest'
import { createDashboardViewModel } from './dashboard-view-model'
import { type PlaytimeSummary } from './types'

describe('createDashboardViewModel', () => {
  it('defaults to the latest played day in the current month range', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const summary = buildSummary([
      {
        dateKey: toDateKey(yesterday),
        totalSeconds: 900,
        attemptCount: 3,
        playlists: [],
        scenarios: [],
      },
      {
        dateKey: toDateKey(today),
        totalSeconds: 1200,
        attemptCount: 4,
        playlists: [],
        scenarios: [],
      },
    ])

    const model = createDashboardViewModel(summary, null, null)

    expect(model.hasCalendarRange).toBe(true)
    expect(model.effectiveSelectedDateKey).toBe(toDateKey(today))
    expect(model.selectedDay.totalSeconds).toBe(1200)
  })

  it('clamps the visible month and selected date into the known range', () => {
    const start = new Date()
    start.setMonth(start.getMonth() - 1)
    start.setDate(2)
    const end = new Date()
    end.setDate(3)
    const summary = buildSummary([
      {
        dateKey: toDateKey(start),
        totalSeconds: 600,
        attemptCount: 2,
        playlists: [],
        scenarios: [],
      },
      {
        dateKey: toDateKey(end),
        totalSeconds: 1800,
        attemptCount: 5,
        playlists: [],
        scenarios: [],
      },
    ])

    const model = createDashboardViewModel(summary, '2099-12', '2000-01-01')

    expect(model.activeMonthKey).toBe(toDateKey(end).slice(0, 7))
    expect(model.effectiveSelectedDateKey).toBe(toDateKey(start))
  })
})

function buildSummary(dailySummaries: PlaytimeSummary['dailySummaries']): PlaytimeSummary {
  return {
    totalSeconds: dailySummaries.reduce((total, day) => total + day.totalSeconds, 0),
    attemptCount: dailySummaries.reduce((total, day) => total + day.attemptCount, 0),
    skippedFiles: 0,
    lastAttemptAt: null,
    sourcePath: 'C:\\stats',
    scenarios: [],
    playlists: [],
    dailySummaries,
    consistency: {
      currentStreakDays: 0,
      longestStreakDays: 0,
      activeDays7d: 0,
      activeDays30d: 0,
      bestWeekSeconds: 0,
    },
    highlights: {
      recentPersonalBests7d: 0,
      topImprovers: [],
      topDecliners: [],
    },
    scenarioAnalytics: [],
    progressCoach: {
      improvingCount: 0,
      flatCount: 0,
      decliningCount: 0,
      insufficientDataCount: 0,
      scenarioTrends: [],
      recommendations: [],
      hasQualityData: false,
    },
  }
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
