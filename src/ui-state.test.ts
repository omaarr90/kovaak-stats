import { describe, expect, it } from 'vitest'
import { INITIAL_UI_STATE, normalizeStoredUiState } from './ui-state'

describe('normalizeStoredUiState', () => {
  it('migrates the legacy today view to overview without dropping saved state', () => {
    const nextState = normalizeStoredUiState({
      activeView: 'today',
      playlistQuery: 'voltaic',
      scenarioQuery: 'static',
      selectedDateKey: '2026-03-14',
      visibleMonthKey: '2026-03',
      selectedScenarioName: '1w4ts',
    })

    expect(nextState).toEqual({
      ...INITIAL_UI_STATE,
      activeView: 'overview',
      playlistQuery: 'voltaic',
      scenarioQuery: 'static',
      selectedDateKey: '2026-03-14',
      visibleMonthKey: '2026-03',
      selectedScenarioName: '1w4ts',
    })
  })
})
