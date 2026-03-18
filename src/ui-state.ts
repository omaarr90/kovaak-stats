import { type AppDashboardView, type UIState } from './types'

type StoredActiveView = AppDashboardView | 'today'

type StoredUiState = Partial<Omit<UIState, 'activeView'>> & {
  activeView?: StoredActiveView | null
}

const APP_DASHBOARD_VIEWS: AppDashboardView[] = ['overview', 'analysis', 'practice', 'settings']

export const INITIAL_UI_STATE: UIState = {
  activeView: 'overview',
  playlistQuery: '',
  scenarioQuery: '',
  scenarioTrendFilter: 'declining',
  scenarioVolumeFilter: 'all',
  scenarioRecencyFilter: 'played30d',
  scenarioSortField: 'deltaPct',
  selectedScenarioName: null,
  visibleMonthKey: null,
  selectedDateKey: null,
  activeFocusPreset: 'declining',
  selectedFocusAreaId: null,
  planDurationMinutes: 20,
  liveMilestonesEnabled: true,
  selectedPlaylistId: null,
  trackedScenarioQuery: '',
}

export function normalizeStoredUiState(parsed?: StoredUiState | null): UIState {
  const nextActiveView = migrateActiveView(parsed?.activeView)

  return {
    ...INITIAL_UI_STATE,
    ...parsed,
    activeView: nextActiveView,
  }
}

function migrateActiveView(activeView?: StoredActiveView | null): AppDashboardView {
  if (activeView === 'today') {
    return 'overview'
  }

  if (activeView && APP_DASHBOARD_VIEWS.includes(activeView)) {
    return activeView
  }

  return INITIAL_UI_STATE.activeView
}
