import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
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

type AvailableUpdate = {
  currentVersion: string
  version: string
  date?: string
  body?: string
}

type DownloadProgressState = {
  downloadedBytes: number
  totalBytes: number | null
}

const UP_TO_DATE_MESSAGE = 'KovaaK Stats is already up to date.'

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function formatDownloadProgress(progress: DownloadProgressState): string {
  if (progress.totalBytes && progress.totalBytes > 0) {
    const percent = Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    return `Downloading update... ${percent}% (${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)})`
  }

  return `Downloading update... ${formatBytes(progress.downloadedBytes)}`
}

function formatUpdateDate(value?: string): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toLocaleString()
}

function App() {
  const [summary, setSummary] = useState<PlaytimeSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null)
  const [uiState, setUiState] = useState<UIState>(INITIAL_UI_STATE)
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateStatusMessage, setUpdateStatusMessage] = useState('')
  const [updateStatusTone, setUpdateStatusTone] = useState<'neutral' | 'error'>('neutral')
  const availableUpdateRef = useRef<Update | null>(null)

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

  const loadPlaytime = useEffectEvent(async (showSpinner = true) => {
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
  })

  function resetAvailableUpdate(nextUpdate: Update | null) {
    const previousUpdate = availableUpdateRef.current
    availableUpdateRef.current = nextUpdate

    if (!nextUpdate) {
      setAvailableUpdate(null)
      setDownloadProgress(null)
    } else {
      setAvailableUpdate({
        currentVersion: nextUpdate.currentVersion,
        version: nextUpdate.version,
        date: nextUpdate.date,
        body: nextUpdate.body,
      })
      setDownloadProgress(null)
    }

    if (previousUpdate && previousUpdate !== nextUpdate) {
      void previousUpdate.close().catch(() => {})
    }
  }

  const runUpdateCheck = useEffectEvent(
    async ({ showNoUpdateMessage, showErrors }: { showNoUpdateMessage: boolean; showErrors: boolean }) => {
      if (isCheckingForUpdates || isInstallingUpdate) {
        return
      }

      setIsCheckingForUpdates(true)
      if (showNoUpdateMessage) {
        setUpdateStatusMessage('')
        setUpdateStatusTone('neutral')
      }

      try {
        const pendingUpdate = await check()
        if (!pendingUpdate) {
          resetAvailableUpdate(null)
          if (showNoUpdateMessage) {
            setUpdateStatusMessage(UP_TO_DATE_MESSAGE)
            setUpdateStatusTone('neutral')
          }
          return
        }

        resetAvailableUpdate(pendingUpdate)
        setUpdateStatusMessage('')
        setUpdateStatusTone('neutral')
      } catch (error) {
        if (showErrors) {
          setUpdateStatusMessage(`Failed to check for updates: ${String(error)}`)
          setUpdateStatusTone('error')
        } else {
          console.error('Automatic update check failed', error)
        }
      } finally {
        setIsCheckingForUpdates(false)
      }
    },
  )

  const installAvailableUpdate = useEffectEvent(async () => {
    const pendingUpdate = availableUpdateRef.current
    if (!pendingUpdate || isInstallingUpdate) {
      return
    }

    setIsInstallingUpdate(true)
    setUpdateStatusMessage('')
    setUpdateStatusTone('neutral')
    setDownloadProgress({
      downloadedBytes: 0,
      totalBytes: null,
    })

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        setDownloadProgress((current) => {
          if (event.event === 'Started') {
            return {
              downloadedBytes: 0,
              totalBytes: event.data.contentLength ?? null,
            }
          }

          if (event.event === 'Progress') {
            return {
              downloadedBytes: (current?.downloadedBytes ?? 0) + event.data.chunkLength,
              totalBytes: current?.totalBytes ?? null,
            }
          }

          return current
        })
      })
      resetAvailableUpdate(null)
      setUpdateStatusMessage('Update downloaded. The Windows installer should launch shortly.')
      setUpdateStatusTone('neutral')
    } catch (error) {
      setUpdateStatusMessage(`Failed to install update: ${String(error)}`)
      setUpdateStatusTone('error')
    } finally {
      setIsInstallingUpdate(false)
    }
  })

  useEffect(() => {
    void loadPlaytime()
    void runUpdateCheck({
      showNoUpdateMessage: false,
      showErrors: false,
    })

    const timer = window.setInterval(() => {
      void loadPlaytime(false)
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      const pendingUpdate = availableUpdateRef.current
      availableUpdateRef.current = null
      if (pendingUpdate) {
        void pendingUpdate.close().catch(() => {})
      }
    }
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

  function handleDismissUpdate() {
    resetAvailableUpdate(null)
    setUpdateStatusMessage('')
    setUpdateStatusTone('neutral')
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
            <button
              className="btn btn-secondary"
              onClick={() =>
                void runUpdateCheck({
                  showNoUpdateMessage: true,
                  showErrors: true,
                })
              }
              disabled={isCheckingForUpdates || isInstallingUpdate}
              type="button"
            >
              {isInstallingUpdate ? 'Installing update...' : isCheckingForUpdates ? 'Checking updates...' : 'Check for updates'}
            </button>
            <button className="btn btn-secondary" onClick={() => void handleQuit()} disabled={isLoading} type="button">
              Quit App
            </button>
          </div>
        </div>

        {availableUpdate ? (
          <section className="update-banner" aria-live="polite">
            <div className="update-banner-main">
              <div>
                <p className="eyebrow">Update available</p>
                <h2 className="update-banner-title">Version {availableUpdate.version} is ready to install</h2>
                <p className="subtle">
                  Current version {availableUpdate.currentVersion}
                  {formatUpdateDate(availableUpdate.date) ? ` • Published ${formatUpdateDate(availableUpdate.date)}` : ''}
                </p>
              </div>

              <div className="update-banner-actions">
                <button className="btn" onClick={() => void installAvailableUpdate()} disabled={isInstallingUpdate} type="button">
                  {isInstallingUpdate ? 'Installing...' : 'Install update'}
                </button>
                <button className="btn btn-secondary" onClick={handleDismissUpdate} disabled={isInstallingUpdate} type="button">
                  Later
                </button>
              </div>
            </div>

            <p className="update-banner-notes">
              {availableUpdate.body?.trim() || 'A newer KovaaK Stats release is available from GitHub Releases.'}
            </p>

            {downloadProgress ? <p className="subtle">{formatDownloadProgress(downloadProgress)}</p> : null}
            {updateStatusMessage ? (
              <p className={`header-status${updateStatusTone === 'error' ? ' is-error' : ''}`}>{updateStatusMessage}</p>
            ) : null}
          </section>
        ) : updateStatusMessage ? (
          <p className={`header-status${updateStatusTone === 'error' ? ' is-error' : ''}`}>{updateStatusMessage}</p>
        ) : null}

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
