import { describe, expect, it } from 'vitest'
import { buildBreakdownsViewModel } from './breakdowns-view-model'
import { type PlaytimeSummary } from './types'

describe('buildBreakdownsViewModel', () => {
  it('filters scenarios by trend, volume, and recency', () => {
    const summary = buildSummary()

    const model = buildBreakdownsViewModel(summary, {
      playlistQuery: '',
      scenarioQuery: '',
      trendFilter: 'declining',
      volumeFilter: 'active30d',
      recencyFilter: 'played30d',
      sortField: 'secondsLast30d',
      selectedScenarioName: null,
    })

    expect(model.visibleScenarios.map((scenario) => scenario.scenarioName)).toEqual(['Declining Close'])
    expect(model.selectedScenario?.scenarioName).toBe('Declining Close')
  })

  it('falls back to the first visible scenario when the selected one is filtered out', () => {
    const summary = buildSummary()

    const model = buildBreakdownsViewModel(summary, {
      playlistQuery: 'voltaic',
      scenarioQuery: 'switch',
      trendFilter: 'all',
      volumeFilter: 'all',
      recencyFilter: 'all',
      sortField: 'totalSeconds',
      selectedScenarioName: 'Declining Close',
    })

    expect(model.filteredPlaylists.map((playlist) => playlist.name)).toEqual(['Voltaic Fundamentals'])
    expect(model.visibleScenarios.map((scenario) => scenario.scenarioName)).toEqual(['Switch Active'])
    expect(model.selectedScenario?.scenarioName).toBe('Switch Active')
  })
})

function buildSummary(): PlaytimeSummary {
  const now = Math.floor(Date.now() / 1000)
  const threeDaysAgo = now - 3 * 24 * 60 * 60
  const fortyDaysAgo = now - 40 * 24 * 60 * 60

  return {
    totalSeconds: 7200,
    attemptCount: 24,
    skippedFiles: 0,
    lastAttemptAt: now,
    sourcePath: 'C:\\stats',
    scenarios: [],
    playlists: [
      {
        name: 'Voltaic Fundamentals',
        totalSeconds: 3600,
        matchedScenarios: 5,
        totalScenarios: 6,
        lastPlayedAt: now,
        secondsLast30d: 1800,
      },
      {
        name: 'Static Only',
        totalSeconds: 1200,
        matchedScenarios: 2,
        totalScenarios: 4,
        lastPlayedAt: fortyDaysAgo,
        secondsLast30d: 0,
      },
    ],
    dailySummaries: [],
    consistency: {
      currentStreakDays: 2,
      longestStreakDays: 4,
      activeDays7d: 3,
      activeDays30d: 8,
      bestWeekSeconds: 2400,
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
        lastPlayedAt: threeDaysAgo,
        secondsLast7d: 600,
        secondsLast30d: 1200,
        secondsLast90d: 2400,
        attemptsLast7d: 2,
        attemptsLast30d: 5,
        attemptsLast90d: 9,
        trendStatus: 'declining',
        deltaPct: -0.12,
        personalBest: 112.5,
        personalBestAt: threeDaysAgo,
        latestQualityValue: 96.2,
        recentQualitySamples: [],
      },
      {
        scenarioName: 'Switch Active',
        metricType: 'score',
        totalSeconds: 1800,
        attemptCount: 10,
        lastPlayedAt: now,
        secondsLast7d: 900,
        secondsLast30d: 1500,
        secondsLast90d: 1800,
        attemptsLast7d: 5,
        attemptsLast30d: 8,
        attemptsLast90d: 10,
        trendStatus: 'improving',
        deltaPct: 0.08,
        personalBest: 135,
        personalBestAt: now,
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
      recommendations: [],
      hasQualityData: true,
    },
  }
}
