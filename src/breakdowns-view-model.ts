import {
  type PlaytimeSummary,
  type PlaylistPlaytime,
  type ScenarioAnalytics,
  type ScenarioRecencyFilter,
  type ScenarioSortField,
  type ScenarioTrendFilter,
  type ScenarioVolumeFilter,
} from './types'

export type BreakdownsFilters = {
  playlistQuery: string
  scenarioQuery: string
  trendFilter: ScenarioTrendFilter
  volumeFilter: ScenarioVolumeFilter
  recencyFilter: ScenarioRecencyFilter
  sortField: ScenarioSortField
  selectedScenarioName: string | null
}

export type BreakdownsViewModel = {
  filteredPlaylists: PlaylistPlaytime[]
  visibleScenarios: ScenarioAnalytics[]
  selectedScenario: ScenarioAnalytics | null
}

export function buildBreakdownsViewModel(
  summary: PlaytimeSummary | null,
  filters: BreakdownsFilters,
): BreakdownsViewModel {
  if (!summary) {
    return {
      filteredPlaylists: [],
      visibleScenarios: [],
      selectedScenario: null,
    }
  }

  const normalizedPlaylistQuery = filters.playlistQuery.trim().toLowerCase()
  const normalizedScenarioQuery = filters.scenarioQuery.trim().toLowerCase()
  const filteredPlaylists = summary.playlists.filter((playlist) =>
    playlist.name.toLowerCase().includes(normalizedPlaylistQuery),
  )
  const visibleScenarios = [...summary.scenarioAnalytics]
    .filter((scenario) => scenario.scenarioName.toLowerCase().includes(normalizedScenarioQuery))
    .filter((scenario) => matchesTrendFilter(scenario, filters.trendFilter))
    .filter((scenario) => matchesVolumeFilter(scenario, filters.volumeFilter))
    .filter((scenario) => matchesRecencyFilter(scenario, filters.recencyFilter))
    .sort((left, right) => compareScenarios(left, right, filters.sortField))
  const selectedScenario =
    visibleScenarios.find((scenario) => scenario.scenarioName === filters.selectedScenarioName) ??
    visibleScenarios[0] ??
    null

  return {
    filteredPlaylists,
    visibleScenarios,
    selectedScenario,
  }
}

function matchesTrendFilter(
  scenario: ScenarioAnalytics,
  trendFilter: ScenarioTrendFilter,
): boolean {
  return trendFilter === 'all' || scenario.trendStatus === trendFilter
}

function matchesVolumeFilter(
  scenario: ScenarioAnalytics,
  volumeFilter: ScenarioVolumeFilter,
): boolean {
  if (volumeFilter === 'all') {
    return true
  }

  if (volumeFilter === 'active7d') {
    return scenario.secondsLast7d > 0
  }

  if (volumeFilter === 'active30d') {
    return scenario.secondsLast30d > 0
  }

  const baselineWeekSeconds = Math.max(Math.floor(scenario.secondsLast30d / 4), 60)
  return scenario.secondsLast30d > 0 && scenario.secondsLast7d < baselineWeekSeconds
}

function matchesRecencyFilter(
  scenario: ScenarioAnalytics,
  recencyFilter: ScenarioRecencyFilter,
): boolean {
  const daysSinceLastPlayed = calculateDaysSinceLastPlayed(scenario.lastPlayedAt)
  if (recencyFilter === 'all') {
    return true
  }

  if (daysSinceLastPlayed === null) {
    return recencyFilter === 'stale30d'
  }

  if (recencyFilter === 'played7d') {
    return daysSinceLastPlayed <= 7
  }

  if (recencyFilter === 'played30d') {
    return daysSinceLastPlayed <= 30
  }

  if (recencyFilter === 'played90d') {
    return daysSinceLastPlayed <= 90
  }

  return daysSinceLastPlayed > 30
}

function compareScenarios(
  left: ScenarioAnalytics,
  right: ScenarioAnalytics,
  sortField: ScenarioSortField,
): number {
  const byField = compareNumbers(getSortValue(right, sortField), getSortValue(left, sortField))
  if (byField !== 0) {
    return byField
  }

  return left.scenarioName.localeCompare(right.scenarioName)
}

function getSortValue(scenario: ScenarioAnalytics, sortField: ScenarioSortField): number {
  if (sortField === 'lastPlayedAt') {
    return scenario.lastPlayedAt ?? 0
  }

  if (sortField === 'deltaPct') {
    return scenario.deltaPct ?? Number.NEGATIVE_INFINITY
  }

  if (sortField === 'personalBest') {
    return scenario.personalBest ?? Number.NEGATIVE_INFINITY
  }

  return scenario[sortField] as number
}

function compareNumbers(left: number, right: number): number {
  if (left > right) {
    return 1
  }
  if (left < right) {
    return -1
  }
  return 0
}

function calculateDaysSinceLastPlayed(lastPlayedAt?: number | null): number | null {
  if (!lastPlayedAt) {
    return null
  }

  return Math.max(0, Math.floor((Date.now() - lastPlayedAt * 1000) / (24 * 60 * 60 * 1000)))
}
