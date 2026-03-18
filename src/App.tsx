import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { listen } from '@tauri-apps/api/event'
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
import {
  buildGoalProgress,
  buildFocusAreaSummaries,
  buildPersonalBestTimeline,
  buildReadinessSummary,
  buildTrainingPlan,
  DEFAULT_TRAINING_GOALS,
  getPresetFilters,
  getScenariosForPreset,
} from './training-insights'
import { INITIAL_UI_STATE, normalizeStoredUiState } from './ui-state'
import {
  createFocusAreaDraft,
  createTrainingGoalDraft,
  finalizeFocusAreaDraft,
  finalizeTrainingGoalDraft,
  haveFocusAreaDraftChanges,
  haveTrainingGoalDraftChanges,
} from './practice-drafts'
import {
  type AppDashboardView,
  type FocusArea,
  type LiveNotification,
  type PlaylistRecord,
  type PlaytimeSummary,
  type ScenarioRef,
  type StatsOverview,
  type TrainingGoal,
  type UIState,
  type UserSettings,
} from './types'
import AnalysisView from './views/AnalysisView'
import OverviewView from './views/OverviewView'
import PracticeView from './views/PracticeView'
import SettingsView from './views/SettingsView'

const VIEW_OPTIONS: { id: AppDashboardView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'practice', label: 'Practice' },
  { id: 'settings', label: 'Settings' },
]

const UI_STORAGE_KEY = 'kovaak-stats-ui-v2'
const GOALS_STORAGE_KEY = 'kovaak-stats-goals-v1'
const FOCUS_AREAS_STORAGE_KEY = 'kovaak-stats-focus-areas-v1'
const LIVE_POLL_INTERVAL_MS = 5_000

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

function readStoredUiState(): UIState {
  try {
    const raw = window.localStorage.getItem(UI_STORAGE_KEY)
    if (!raw) {
      return INITIAL_UI_STATE
    }

    return normalizeStoredUiState(JSON.parse(raw))
  } catch {
    return INITIAL_UI_STATE
  }
}

function readStoredGoals(): TrainingGoal[] {
  try {
    const raw = window.localStorage.getItem(GOALS_STORAGE_KEY)
    if (!raw) {
      return finalizeTrainingGoalDraft(DEFAULT_TRAINING_GOALS)
    }

    const parsed = JSON.parse(raw) as TrainingGoal[]
    return DEFAULT_TRAINING_GOALS.map((goal) => {
      const stored = parsed.find((candidate) => candidate.id === goal.id)
      return stored ? { ...goal, ...stored } : { ...goal }
    })
  } catch {
    return finalizeTrainingGoalDraft(DEFAULT_TRAINING_GOALS)
  }
}

function readStoredFocusAreas(): FocusArea[] {
  try {
    const raw = window.localStorage.getItem(FOCUS_AREAS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as FocusArea[]
    return finalizeFocusAreaDraft(parsed.filter((focusArea) => focusArea.id && focusArea.label))
  } catch {
    return []
  }
}

function writeStoredGoals(goals: TrainingGoal[]) {
  window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals))
}

function writeStoredFocusAreas(focusAreas: FocusArea[]) {
  window.localStorage.setItem(FOCUS_AREAS_STORAGE_KEY, JSON.stringify(focusAreas))
}

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
  const [trackedOverview, setTrackedOverview] = useState<StatsOverview | null>(null)
  const [playlistRecords, setPlaylistRecords] = useState<PlaylistRecord[]>([])
  const [trackedScenarios, setTrackedScenarios] = useState<ScenarioRef[]>([])
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<UserSettings | null>(null)
  const [goals, setGoals] = useState<TrainingGoal[]>(readStoredGoals)
  const [goalDrafts, setGoalDrafts] = useState<TrainingGoal[]>(() => createTrainingGoalDraft(readStoredGoals()))
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>(readStoredFocusAreas)
  const [focusAreaDrafts, setFocusAreaDrafts] = useState<FocusArea[]>(() => createFocusAreaDraft(readStoredFocusAreas()))
  const [goalsSaveMessage, setGoalsSaveMessage] = useState('')
  const [goalsSaveTone, setGoalsSaveTone] = useState<'neutral' | 'error'>('neutral')
  const [focusAreasSaveMessage, setFocusAreasSaveMessage] = useState('')
  const [focusAreasSaveTone, setFocusAreasSaveTone] = useState<'neutral' | 'error'>('neutral')
  const [liveNotifications, setLiveNotifications] = useState<LiveNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null)
  const [settingsSaveMessage, setSettingsSaveMessage] = useState('')
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [uiState, setUiState] = useState<UIState>(readStoredUiState)
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateStatusMessage, setUpdateStatusMessage] = useState('')
  const [updateStatusTone, setUpdateStatusTone] = useState<'neutral' | 'error'>('neutral')
  const availableUpdateRef = useRef<Update | null>(null)
  const hasAutoCheckedRef = useRef(false)
  const liveMilestoneRef = useRef<{
    sessionKey: string | null
    thresholds: Set<number>
    pbWatchScenario: string | null
  }>({
    sessionKey: null,
    thresholds: new Set<number>(),
    pbWatchScenario: null,
  })

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
  const presetScenarios = useMemo(
    () => getScenariosForPreset(summary, uiState.activeFocusPreset),
    [summary, uiState.activeFocusPreset],
  )
  const focusAreaSummaries = useMemo(() => buildFocusAreaSummaries(summary, focusAreas), [summary, focusAreas])
  const readinessSummary = useMemo(
    () => buildReadinessSummary(summary, focusAreaSummaries),
    [summary, focusAreaSummaries],
  )
  const personalBestTimeline = useMemo(() => buildPersonalBestTimeline(summary), [summary])
  const practiceGoalProgress = useMemo(() => buildGoalProgress(summary, goalDrafts), [summary, goalDrafts])
  const practiceFocusAreaSummaries = useMemo(
    () => buildFocusAreaSummaries(summary, focusAreaDrafts),
    [summary, focusAreaDrafts],
  )
  const practiceReadinessSummary = useMemo(
    () => buildReadinessSummary(summary, practiceFocusAreaSummaries),
    [summary, practiceFocusAreaSummaries],
  )
  const practiceTrainingPlan = useMemo(
    () =>
      buildTrainingPlan(
        summary,
        focusAreaDrafts,
        uiState.activeFocusPreset,
        uiState.selectedFocusAreaId,
        uiState.planDurationMinutes,
      ),
    [focusAreaDrafts, summary, uiState.activeFocusPreset, uiState.planDurationMinutes, uiState.selectedFocusAreaId],
  )
  const isGoalsDirty = useMemo(() => haveTrainingGoalDraftChanges(goals, goalDrafts), [goals, goalDrafts])
  const isFocusAreasDirty = useMemo(
    () => haveFocusAreaDraftChanges(focusAreas, focusAreaDrafts),
    [focusAreas, focusAreaDrafts],
  )

  const pushLiveNotification = useEffectEvent((notification: Omit<LiveNotification, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const nextNotification: LiveNotification = {
      id,
      ...notification,
    }

    setLiveNotifications((current) => [...current.slice(-3), nextNotification])
    window.setTimeout(() => {
      setLiveNotifications((current) => current.filter((item) => item.id !== id))
    }, 6_000)

    if (uiState.liveMilestonesEnabled && 'Notification' in window) {
      if (window.Notification.permission === 'granted') {
        void Promise.resolve().then(() => new window.Notification(notification.title, { body: notification.body }))
      }
    }
  })

  async function loadPlaytimeNow(showSpinner = true) {
    if (showSpinner) {
      setIsLoading(true)
    }

    try {
      const nextSummary = await invoke<PlaytimeSummary>('get_kovaak_playtime')
      setSummary(nextSummary)
      setStatusMessage('')
      setLastRefreshAt(Date.now())
    } catch (error) {
      if (!summary) {
        setSummary(null)
      }
      setStatusMessage(`Failed to read KovaaK playtime: ${String(error)}`)
    } finally {
      if (showSpinner) {
        setIsLoading(false)
      }
    }
  }

  const loadPlaytime = useEffectEvent(async (showSpinner = true) => {
    await loadPlaytimeNow(showSpinner)
  })

  async function loadSettingsNow() {
    try {
      const nextSettings = await invoke<UserSettings>('get_app_settings')
      setSettings(nextSettings)
      setSettingsDraft(nextSettings)
    } catch (error) {
      setSettingsSaveMessage(`Failed to load settings: ${String(error)}`)
    }
  }

  async function loadTrackingWorkspaceNow() {
    try {
      const [nextOverview, nextPlaylists, nextTrackedScenarios] = await Promise.all([
        invoke<StatsOverview>('get_tracked_stats_overview'),
        invoke<PlaylistRecord[]>('get_playlist_records'),
        invoke<ScenarioRef[]>('get_tracking_scenarios'),
      ])
      setTrackedOverview(nextOverview)
      setPlaylistRecords(nextPlaylists)
      setTrackedScenarios(nextTrackedScenarios)
      setUiState((current) => ({
        ...current,
        selectedPlaylistId:
          current.selectedPlaylistId ?? nextPlaylists[0]?.id ?? null,
      }))
    } catch (error) {
      console.error('Failed to load tracking workspace', error)
    }
  }

  const loadTrackingWorkspace = useEffectEvent(async () => {
    await loadTrackingWorkspaceNow()
  })

  async function refreshWorkspaceNow(showSpinner = true) {
    await Promise.all([loadPlaytimeNow(showSpinner), loadTrackingWorkspaceNow(), loadSettingsNow()])
  }

  const refreshWorkspace = useEffectEvent(async (showSpinner = true) => {
    await refreshWorkspaceNow(showSpinner)
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

  async function runUpdateCheckNow({
    showNoUpdateMessage,
    showErrors,
  }: {
    showNoUpdateMessage: boolean
    showErrors: boolean
  }) {
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
  }

  const runUpdateCheck = useEffectEvent(async (options: { showNoUpdateMessage: boolean; showErrors: boolean }) => {
    await runUpdateCheckNow(options)
  })

  async function installAvailableUpdateNow() {
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
  }

  useEffect(() => {
    window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiState))
  }, [uiState])

  useEffect(() => {
    void refreshWorkspace()

    return () => {
      const pendingUpdate = availableUpdateRef.current
      availableUpdateRef.current = null
      if (pendingUpdate) {
        void pendingUpdate.close().catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    if (!settings?.autoCheckUpdates || hasAutoCheckedRef.current) {
      return
    }

    hasAutoCheckedRef.current = true
    void runUpdateCheck({
      showNoUpdateMessage: false,
      showErrors: false,
    })
  }, [settings?.autoCheckUpdates])

  useEffect(() => {
    if (!settings) {
      return
    }

    const timer = window.setInterval(() => {
      void loadPlaytime(false)
    }, settings.refreshIntervalSeconds * 1000)

    return () => window.clearInterval(timer)
  }, [settings])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTrackingWorkspace()
    }, LIVE_POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!uiState.liveMilestonesEnabled || !('Notification' in window)) {
      return
    }

    if (window.Notification.permission === 'default') {
      void window.Notification.requestPermission().catch(() => {})
    }
  }, [uiState.liveMilestonesEnabled])

  useEffect(() => {
    if (!uiState.liveMilestonesEnabled || !trackedOverview?.activeSession.startedAt || !trackedOverview.activeSession.isTracking) {
      liveMilestoneRef.current = {
        sessionKey: null,
        thresholds: new Set<number>(),
        pbWatchScenario: null,
      }
      return
    }

    const sessionKey = `${trackedOverview.activeSession.startedAt}:${trackedOverview.activeSession.scenarioPath ?? ''}`
    const current = liveMilestoneRef.current
    if (current.sessionKey !== sessionKey) {
      liveMilestoneRef.current = {
        sessionKey,
        thresholds: new Set<number>(),
        pbWatchScenario: null,
      }
      pushLiveNotification({
        title: 'Live tracking started',
        body: trackedOverview.activeSession.scenarioName
          ? `Tracking ${trackedOverview.activeSession.scenarioName}.`
          : 'A live KovaaK session is now being tracked.',
        tone: 'neutral',
      })
    }

    const elapsedMinutes = Math.floor((Date.now() / 1000 - trackedOverview.activeSession.startedAt) / 60)
    for (const threshold of [10, 20, 30, 45, 60]) {
      if (elapsedMinutes >= threshold && !liveMilestoneRef.current.thresholds.has(threshold)) {
        liveMilestoneRef.current.thresholds.add(threshold)
        pushLiveNotification({
          title: 'Session milestone',
          body: `You have been in-session for ${threshold} minutes.`,
          tone: threshold >= 45 ? 'declining' : 'improving',
        })
      }
    }

    const pbWatchScenario = getScenariosForPreset(summary, 'pbHunt').find(
      (scenario) => scenario.scenarioName === trackedOverview.activeSession.scenarioName,
    )
    if (
      pbWatchScenario &&
      liveMilestoneRef.current.pbWatchScenario !== pbWatchScenario.scenarioName
    ) {
      liveMilestoneRef.current.pbWatchScenario = pbWatchScenario.scenarioName
      pushLiveNotification({
        title: 'PB watch',
        body: `${pbWatchScenario.scenarioName} is close to its personal best. Good time to push quality.`,
        tone: 'improving',
      })
    }
  }, [summary, trackedOverview, uiState.liveMilestonesEnabled])

  useEffect(() => {
    const unlisten = listen('app://hidden-to-tray', () => {
      pushLiveNotification({
        title: 'Hidden to tray',
        body: 'The app is still running in the system tray.',
        tone: 'neutral',
      })
    })

    return () => {
      void unlisten.then((cleanup) => cleanup())
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

  function applyFocusPreset(presetId: UIState['activeFocusPreset']) {
    const nextFilters = getPresetFilters(presetId)
    setUiState((current) => ({
      ...current,
      activeFocusPreset: presetId,
      ...nextFilters,
    }))
  }

  function updateGoalTarget(goalId: TrainingGoal['id'], target: number) {
    setGoalsSaveMessage('')
    setGoalsSaveTone('neutral')
    setGoalDrafts((current) =>
      current.map((goal) =>
        goal.id === goalId
          ? { ...goal, target: Math.max(1, Number.isFinite(target) ? Math.round(target) : goal.target) }
          : goal,
      ),
    )
  }

  function handleSaveGoals() {
    const nextGoals = finalizeTrainingGoalDraft(goalDrafts)
    try {
      writeStoredGoals(nextGoals)
      setGoals(nextGoals)
      setGoalDrafts(createTrainingGoalDraft(nextGoals))
      setGoalsSaveMessage('Goals saved. Overview and Analysis now use the new targets.')
      setGoalsSaveTone('neutral')
    } catch (error) {
      setGoalsSaveMessage(`Failed to save goals: ${String(error)}`)
      setGoalsSaveTone('error')
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft) {
      return
    }

    setIsSavingSettings(true)
    setSettingsSaveMessage('')
    try {
      const nextSettings = await invoke<UserSettings>('update_app_settings', {
        input: {
          sessionPathOverride: settingsDraft.sessionPathOverride ?? '',
          startWithWindows: settingsDraft.startWithWindows,
          minimizeToTray: settingsDraft.minimizeToTray,
          autoCheckUpdates: settingsDraft.autoCheckUpdates,
          refreshIntervalSeconds: settingsDraft.refreshIntervalSeconds,
        },
      })
      setSettings(nextSettings)
      setSettingsDraft(nextSettings)
      setSettingsSaveMessage('Settings saved.')
    } catch (error) {
      setSettingsSaveMessage(`Failed to save settings: ${String(error)}`)
    } finally {
      setIsSavingSettings(false)
    }
  }

  async function handleCreatePlaylist(name: string) {
    const created = await invoke<PlaylistRecord>('create_playlist_record', { name })
    const nextPlaylists = await invoke<PlaylistRecord[]>('get_playlist_records')
    setPlaylistRecords(nextPlaylists)
    setUiState((current) => ({
      ...current,
      selectedPlaylistId: created.id,
    }))
  }

  async function handleSavePlaylistMappings(playlistId: number, scenarioPaths: string[]) {
    const nextPlaylists = await invoke<PlaylistRecord[]>('set_playlist_record_mappings', {
      playlist_id: playlistId,
      scenario_paths: scenarioPaths,
    })
    setPlaylistRecords(nextPlaylists)
    await loadTrackingWorkspaceNow()
  }

  function handleCreateFocusArea(label: string) {
    const normalized = label.trim()
    if (!normalized) {
      return
    }

    const nextFocusArea: FocusArea = {
      id: `focus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: normalized,
      scenarioNames: [],
    }
    setFocusAreasSaveMessage('')
    setFocusAreasSaveTone('neutral')
    setFocusAreaDrafts((current) => [...current, nextFocusArea])
    setUiState((current) => ({
      ...current,
      selectedFocusAreaId: nextFocusArea.id,
    }))
  }

  function handleDeleteFocusArea(focusAreaId: string) {
    setFocusAreasSaveMessage('')
    setFocusAreasSaveTone('neutral')
    setFocusAreaDrafts((current) => current.filter((focusArea) => focusArea.id !== focusAreaId))
    setUiState((current) => ({
      ...current,
      selectedFocusAreaId:
        current.selectedFocusAreaId === focusAreaId ? null : current.selectedFocusAreaId,
    }))
  }

  function handleToggleFocusAreaScenario(focusAreaId: string, scenarioName: string) {
    setFocusAreasSaveMessage('')
    setFocusAreasSaveTone('neutral')
    setFocusAreaDrafts((current) =>
      current.map((focusArea) =>
        focusArea.id !== focusAreaId
          ? focusArea
          : {
              ...focusArea,
              scenarioNames: focusArea.scenarioNames.includes(scenarioName)
                ? focusArea.scenarioNames.filter((name) => name !== scenarioName)
                : [...focusArea.scenarioNames, scenarioName],
            },
      ),
    )
  }

  function handleSaveFocusAreas() {
    const nextFocusAreas = finalizeFocusAreaDraft(focusAreaDrafts)
    try {
      writeStoredFocusAreas(nextFocusAreas)
      setFocusAreas(nextFocusAreas)
      setFocusAreaDrafts(createFocusAreaDraft(nextFocusAreas))
      setFocusAreasSaveMessage('Focus areas saved. Analysis and Overview now reflect the updated buckets.')
      setFocusAreasSaveTone('neutral')
    } catch (error) {
      setFocusAreasSaveMessage(`Failed to save focus areas: ${String(error)}`)
      setFocusAreasSaveTone('error')
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-main">
          <div>
            <p className="eyebrow app-eyebrow">KovaaK Stats</p>
            <h1 className="app-title">KovaaK Activity Console</h1>
            <p className="subtle">{formatRefreshTimestamp(lastRefreshAt)}</p>
          </div>

          <div className="header-actions">
            <button className="btn" onClick={() => void refreshWorkspaceNow()} disabled={isLoading} type="button">
              {isLoading ? 'Refreshing...' : 'Refresh'}
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
                  {formatUpdateDate(availableUpdate.date) ? ` | Published ${formatUpdateDate(availableUpdate.date)}` : ''}
                </p>
              </div>

              <div className="update-banner-actions">
                <button className="btn" onClick={() => void installAvailableUpdateNow()} disabled={isInstallingUpdate} type="button">
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

      {liveNotifications.length > 0 ? (
        <aside className="toast-stack" aria-live="polite">
          {liveNotifications.map((notification) => (
            <div key={notification.id} className={`toast-card tone-${notification.tone}`}>
              <strong>{notification.title}</strong>
              <span className="subtle">{notification.body}</span>
            </div>
          ))}
        </aside>
      ) : null}

      <section className="content-frame">
        {uiState.activeView === 'overview' ? (
          <OverviewView
            summary={summary}
            statusMessage={statusMessage}
            hasCalendarRange={dashboardModel.hasCalendarRange}
            activeMonthKey={dashboardModel.activeMonthKey}
            canGoPrevious={dashboardModel.canGoPrevious}
            canGoNext={dashboardModel.canGoNext}
            calendarCells={dashboardModel.calendarCells}
            effectiveSelectedDateKey={dashboardModel.effectiveSelectedDateKey}
            visibleMonthPeakSeconds={dashboardModel.visibleMonthPeakSeconds}
            onMonthChange={handleMonthChange}
            onSelectDate={(dateKey) => setUiState((current) => ({ ...current, selectedDateKey: dateKey }))}
            onOpenSettings={() => setUiState((current) => ({ ...current, activeView: 'settings' }))}
          />
        ) : null}

        {uiState.activeView === 'analysis' ? (
          <AnalysisView
            summary={summary}
            statusMessage={statusMessage}
            playlistQuery={uiState.playlistQuery}
            scenarioQuery={uiState.scenarioQuery}
            scenarioTrendFilter={uiState.scenarioTrendFilter}
            scenarioVolumeFilter={uiState.scenarioVolumeFilter}
            scenarioRecencyFilter={uiState.scenarioRecencyFilter}
            scenarioSortField={uiState.scenarioSortField}
            activeFocusPreset={uiState.activeFocusPreset}
            focusAreaSummaries={focusAreaSummaries}
            readinessSummary={readinessSummary}
            personalBestTimeline={personalBestTimeline}
            filteredPlaylists={breakdownsModel.filteredPlaylists}
            filteredScenarios={breakdownsModel.visibleScenarios}
            selectedScenario={breakdownsModel.selectedScenario}
            selectedScenarioIsVisible={breakdownsModel.selectedScenarioIsVisible}
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
            onPlaylistQueryChange={(next) => setUiState((current) => ({ ...current, playlistQuery: next }))}
            onScenarioQueryChange={(next) => setUiState((current) => ({ ...current, scenarioQuery: next }))}
            onScenarioTrendFilterChange={(next) => setUiState((current) => ({ ...current, scenarioTrendFilter: next }))}
            onScenarioVolumeFilterChange={(next) => setUiState((current) => ({ ...current, scenarioVolumeFilter: next }))}
            onScenarioRecencyFilterChange={(next) => setUiState((current) => ({ ...current, scenarioRecencyFilter: next }))}
            onScenarioSortFieldChange={(next) => setUiState((current) => ({ ...current, scenarioSortField: next }))}
            onSelectScenario={(next) => setUiState((current) => ({ ...current, selectedScenarioName: next }))}
            onApplyFocusPreset={applyFocusPreset}
          />
        ) : null}

        {uiState.activeView === 'practice' ? (
          <PracticeView
            summary={summary}
            trackedOverview={trackedOverview}
            activeFocusPreset={uiState.activeFocusPreset}
            selectedFocusAreaId={uiState.selectedFocusAreaId}
            planDurationMinutes={uiState.planDurationMinutes}
            presetScenarios={presetScenarios}
            focusAreas={focusAreaDrafts}
            focusAreaSummaries={practiceFocusAreaSummaries}
            readinessSummary={practiceReadinessSummary}
            trainingPlan={practiceTrainingPlan}
            goals={goalDrafts}
            goalProgress={practiceGoalProgress}
            playlistRecords={playlistRecords}
            trackedScenarios={trackedScenarios}
            selectedPlaylistId={uiState.selectedPlaylistId}
            trackedScenarioQuery={uiState.trackedScenarioQuery}
            isGoalsDirty={isGoalsDirty}
            goalsSaveMessage={goalsSaveMessage}
            goalsSaveTone={goalsSaveTone}
            isFocusAreasDirty={isFocusAreasDirty}
            focusAreasSaveMessage={focusAreasSaveMessage}
            focusAreasSaveTone={focusAreasSaveTone}
            onActivateFocusPreset={applyFocusPreset}
            onGoalTargetChange={updateGoalTarget}
            onSaveGoals={handleSaveGoals}
            onSelectFocusArea={(focusAreaId) => setUiState((current) => ({ ...current, selectedFocusAreaId: focusAreaId }))}
            onPlanDurationChange={(planDurationMinutes) =>
              setUiState((current) => ({
                ...current,
                planDurationMinutes,
              }))
            }
            onOpenAnalysisPreset={() =>
              setUiState((current) => ({
                ...current,
                activeView: 'analysis',
              }))
            }
            onCreateFocusArea={handleCreateFocusArea}
            onDeleteFocusArea={handleDeleteFocusArea}
            onToggleFocusAreaScenario={handleToggleFocusAreaScenario}
            onSaveFocusAreas={handleSaveFocusAreas}
            onSelectPlaylist={(playlistId) => setUiState((current) => ({ ...current, selectedPlaylistId: playlistId }))}
            onTrackedScenarioQueryChange={(value) =>
              setUiState((current) => ({
                ...current,
                trackedScenarioQuery: value,
              }))
            }
            onCreatePlaylist={handleCreatePlaylist}
            onSavePlaylistMappings={handleSavePlaylistMappings}
          />
        ) : null}

        {uiState.activeView === 'settings' ? (
          <SettingsView
            settings={settings}
            draft={settingsDraft}
            summary={summary}
            trackedOverview={trackedOverview}
            isSaving={isSavingSettings}
            saveMessage={settingsSaveMessage}
            liveMilestonesEnabled={uiState.liveMilestonesEnabled}
            onChange={setSettingsDraft}
            onSave={() => void handleSaveSettings()}
            onQuit={() => void handleQuit()}
            onToggleLiveMilestones={(enabled) =>
              setUiState((current) => ({
                ...current,
                liveMilestonesEnabled: enabled,
              }))
            }
            onCheckForUpdates={() =>
              void runUpdateCheckNow({
                showNoUpdateMessage: true,
                showErrors: true,
              })
            }
          />
        ) : null}
      </section>
    </main>
  )
}

export default App
