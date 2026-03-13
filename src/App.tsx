import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import { buildBreakdownsViewModel } from './breakdowns-view-model'
import { createDashboardViewModel } from './dashboard-view-model'
import {
  clampMonthKey,
  formatRefreshTimestamp,
  getLocalTodayDateKey,
  monthKeyFromDateKey,
  pickLatestPlayedOnOrBefore,
  pickMonthSelection,
  shiftMonthKey,
} from './playtime-utils'
import { type DashboardView, type PlaytimeSummary, type UIState } from './types'
import BreakdownsView from './views/BreakdownsView'
import CalendarView from './views/CalendarView'
import CoachView from './views/CoachView'
import OverviewView from './views/OverviewView'

const VIEW_OPTIONS: { id: DashboardView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'breakdowns', label: 'Breakdowns' },
  { id: 'coach', label: 'Coach' },
]

const INITIAL_UI_STATE: UIState = {
  activeView: 'overview',
  playlistQuery: '',
  scenarioQuery: '',
  scenarioTrendFilter: 'all',
  scenarioVolumeFilter: 'all',
  scenarioRecencyFilter: 'all',
  scenarioSortField: 'totalSeconds',
  selectedScenarioName: null,
  visibleMonthKey: null,
  selectedDateKey: null,
}

function App() {
  const [summary, setSummary] = useState<PlaytimeSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null)
  const [uiState, setUiState] = useState<UIState>(INITIAL_UI_STATE)

  const deferredPlaylistQuery = useDeferredValue(uiState.playlistQuery)
  const deferredScenarioQuery = useDeferredValue(uiState.scenarioQuery)
  const dashboardModel = useMemo(
    () => createDashboardViewModel(summary, uiState.visibleMonthKey, uiState.selectedDateKey),
    [summary, uiState.visibleMonthKey, uiState.selectedDateKey],
  )
  const breakdownsModel = useMemo(
    () =>
      buildBreakdownsViewModel(summary, {
        playlistQuery: deferredPlaylistQuery,
        scenarioQuery: deferredScenarioQuery,
        trendFilter: uiState.scenarioTrendFilter,
        volumeFilter: uiState.scenarioVolumeFilter,
        recencyFilter: uiState.scenarioRecencyFilter,
        sortField: uiState.scenarioSortField,
        selectedScenarioName: uiState.selectedScenarioName,
      }),
    [
      deferredPlaylistQuery,
      deferredScenarioQuery,
      summary,
      uiState.scenarioRecencyFilter,
      uiState.scenarioSortField,
      uiState.scenarioTrendFilter,
      uiState.scenarioVolumeFilter,
      uiState.selectedScenarioName,
    ],
  )

  async function loadPlaytime(showSpinner = true) {
    if (showSpinner) {
      setIsLoading(true)
    }

    try {
      const nextSummary = await invoke<PlaytimeSummary>('get_kovaak_playtime')
      setSummary(nextSummary)
      setStatusMessage('')
      setLastRefreshAt(Date.now())
    } catch (error) {
      setStatusMessage(`Failed to read KovaaK playtime: ${String(error)}`)
    } finally {
      if (showSpinner) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadPlaytime()

    const timer = window.setInterval(() => {
      void loadPlaytime(false)
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!summary || summary.dailySummaries.length === 0) {
      return
    }

    const todayDateKey = getLocalTodayDateKey()
    const firstPlayedDateKey = summary.dailySummaries[0].dateKey
    if (firstPlayedDateKey > todayDateKey) {
      return
    }

    const latestDateKey = pickLatestPlayedOnOrBefore(summary.dailySummaries, todayDateKey) ?? firstPlayedDateKey
    setUiState((current) => ({
      ...current,
      visibleMonthKey: current.visibleMonthKey ?? monthKeyFromDateKey(latestDateKey),
      selectedDateKey: current.selectedDateKey ?? latestDateKey,
    }))
  }, [summary])

  async function handleQuit() {
    await invoke('request_app_quit')
  }

  function handleMonthChange(offset: number) {
    if (!summary || !dashboardModel.hasCalendarRange) {
      return
    }

    const shifted = shiftMonthKey(dashboardModel.activeMonthKey, offset)
    const nextMonthKey = clampMonthKey(
      shifted,
      dashboardModel.rangeStartMonthKey as string,
      dashboardModel.rangeEndMonthKey as string,
    )
    if (nextMonthKey === dashboardModel.activeMonthKey) {
      return
    }

    setUiState((current) => ({
      ...current,
      visibleMonthKey: nextMonthKey,
      selectedDateKey: pickMonthSelection(
        nextMonthKey,
        summary.dailySummaries,
        dashboardModel.rangeStartDateKey as string,
        dashboardModel.rangeEndDateKey as string,
      ),
    }))
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-main">
          <div>
            <p className="eyebrow app-eyebrow">KovaaK Stats</p>
            <h1 className="app-title">Performance Dashboard</h1>
            <p className="subtle">{formatRefreshTimestamp(lastRefreshAt)}</p>
          </div>

          <div className="header-actions">
            <button className="btn" onClick={() => void loadPlaytime()} disabled={isLoading} type="button">
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className="btn btn-secondary" onClick={() => void handleQuit()} disabled={isLoading} type="button">
              Quit App
            </button>
          </div>
        </div>

        <nav className="view-switcher" aria-label="Dashboard sections">
          {VIEW_OPTIONS.map((viewOption) => {
            const isActive = uiState.activeView === viewOption.id
            return (
              <button
                key={viewOption.id}
                className={`view-switch-button${isActive ? ' is-active' : ''}`}
                type="button"
                onClick={() => setUiState((current) => ({ ...current, activeView: viewOption.id }))}
                aria-pressed={isActive}
              >
                {viewOption.label}
              </button>
            )
          })}
        </nav>
      </header>

      <section className="content-frame" aria-live="polite">
        {uiState.activeView === 'overview' ? (
          <OverviewView
            summary={summary}
            selectedDay={dashboardModel.selectedDay}
            statusMessage={statusMessage}
          />
        ) : null}

        {uiState.activeView === 'calendar' ? (
          <CalendarView
            hasCalendarRange={dashboardModel.hasCalendarRange}
            activeMonthKey={dashboardModel.activeMonthKey}
            canGoPrevious={dashboardModel.canGoPrevious}
            canGoNext={dashboardModel.canGoNext}
            calendarCells={dashboardModel.calendarCells}
            effectiveSelectedDateKey={dashboardModel.effectiveSelectedDateKey}
            selectedDay={dashboardModel.selectedDay}
            visibleMonthPeakSeconds={dashboardModel.visibleMonthPeakSeconds}
            onMonthChange={handleMonthChange}
            onSelectDate={(dateKey) => setUiState((current) => ({ ...current, selectedDateKey: dateKey }))}
          />
        ) : null}

        {uiState.activeView === 'breakdowns' ? (
          <BreakdownsView
            summary={summary}
            playlistQuery={uiState.playlistQuery}
            scenarioQuery={uiState.scenarioQuery}
            scenarioTrendFilter={uiState.scenarioTrendFilter}
            scenarioVolumeFilter={uiState.scenarioVolumeFilter}
            scenarioRecencyFilter={uiState.scenarioRecencyFilter}
            scenarioSortField={uiState.scenarioSortField}
            filteredPlaylists={breakdownsModel.filteredPlaylists}
            filteredScenarios={breakdownsModel.visibleScenarios}
            selectedScenario={breakdownsModel.selectedScenario}
            onPlaylistQueryChange={(next) => setUiState((current) => ({ ...current, playlistQuery: next }))}
            onScenarioQueryChange={(next) => setUiState((current) => ({ ...current, scenarioQuery: next }))}
            onScenarioTrendFilterChange={(next) => setUiState((current) => ({ ...current, scenarioTrendFilter: next }))}
            onScenarioVolumeFilterChange={(next) => setUiState((current) => ({ ...current, scenarioVolumeFilter: next }))}
            onScenarioRecencyFilterChange={(next) =>
              setUiState((current) => ({ ...current, scenarioRecencyFilter: next }))
            }
            onScenarioSortFieldChange={(next) => setUiState((current) => ({ ...current, scenarioSortField: next }))}
            onSelectScenario={(next) => setUiState((current) => ({ ...current, selectedScenarioName: next }))}
          />
        ) : null}

        {uiState.activeView === 'coach' ? <CoachView summary={summary} /> : null}
      </section>
    </main>
  )
}

export default App
