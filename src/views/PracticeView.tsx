import { useEffect, useId, useMemo, useState } from 'react'
import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  formatDeltaPercent,
  formatDuration,
  formatQualityValue,
  formatRecommendationReason,
  formatTimestamp,
  formatTrendStatus,
} from '../playtime-utils'
import { FOCUS_PRESETS } from '../training-insights'
import {
  type FocusArea,
  type FocusAreaSummary,
  type FocusPresetId,
  type GoalProgress,
  type PlaytimeSummary,
  type PlaylistRecord,
  type PracticeDuration,
  type ReadinessSummary,
  type ScenarioAnalytics,
  type ScenarioRef,
  type StatsOverview,
  type TrainingPlan,
  type TrainingGoal,
} from '../types'

type PracticeViewProps = {
  summary: PlaytimeSummary | null
  trackedOverview: StatsOverview | null
  activeFocusPreset: FocusPresetId
  selectedFocusAreaId: string | null
  planDurationMinutes: PracticeDuration
  presetScenarios: ScenarioAnalytics[]
  focusAreas: FocusArea[]
  focusAreaSummaries: FocusAreaSummary[]
  readinessSummary: ReadinessSummary
  trainingPlan: TrainingPlan
  goals: TrainingGoal[]
  goalProgress: GoalProgress[]
  playlistRecords: PlaylistRecord[]
  trackedScenarios: ScenarioRef[]
  selectedPlaylistId: number | null
  trackedScenarioQuery: string
  isGoalsDirty: boolean
  goalsSaveMessage: string
  goalsSaveTone: 'neutral' | 'error'
  isFocusAreasDirty: boolean
  focusAreasSaveMessage: string
  focusAreasSaveTone: 'neutral' | 'error'
  onActivateFocusPreset: (presetId: FocusPresetId) => void
  onGoalTargetChange: (goalId: TrainingGoal['id'], target: number) => void
  onSaveGoals: () => void
  onSelectFocusArea: (focusAreaId: string | null) => void
  onPlanDurationChange: (minutes: PracticeDuration) => void
  onOpenAnalysisPreset: () => void
  onCreateFocusArea: (label: string) => void
  onDeleteFocusArea: (focusAreaId: string) => void
  onToggleFocusAreaScenario: (focusAreaId: string, scenarioName: string) => void
  onSaveFocusAreas: () => void
  onSelectPlaylist: (playlistId: number) => void
  onTrackedScenarioQueryChange: (value: string) => void
  onCreatePlaylist: (name: string) => Promise<void>
  onSavePlaylistMappings: (playlistId: number, scenarioPaths: string[]) => Promise<void>
}

function PracticeView({
  summary,
  trackedOverview,
  activeFocusPreset,
  selectedFocusAreaId,
  planDurationMinutes,
  presetScenarios,
  focusAreas,
  focusAreaSummaries,
  readinessSummary,
  trainingPlan,
  goals,
  goalProgress,
  playlistRecords,
  trackedScenarios,
  selectedPlaylistId,
  trackedScenarioQuery,
  isGoalsDirty,
  goalsSaveMessage,
  goalsSaveTone,
  isFocusAreasDirty,
  focusAreasSaveMessage,
  focusAreasSaveTone,
  onActivateFocusPreset,
  onGoalTargetChange,
  onSaveGoals,
  onSelectFocusArea,
  onPlanDurationChange,
  onOpenAnalysisPreset,
  onCreateFocusArea,
  onDeleteFocusArea,
  onToggleFocusAreaScenario,
  onSaveFocusAreas,
  onSelectPlaylist,
  onTrackedScenarioQueryChange,
  onCreatePlaylist,
  onSavePlaylistMappings,
}: PracticeViewProps) {
  const focusAreaInputId = useId()
  const playlistNameInputId = useId()
  const trackedScenarioSearchId = useId()
  const goalTargetIdPrefix = useId()
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [draftScenarioPaths, setDraftScenarioPaths] = useState<string[]>([])
  const [mappingStatus, setMappingStatus] = useState('')
  const [isSavingMappings, setIsSavingMappings] = useState(false)
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const [newFocusAreaLabel, setNewFocusAreaLabel] = useState('')
  const selectedPlaylist = playlistRecords.find((playlist) => playlist.id === selectedPlaylistId) ?? playlistRecords[0] ?? null
  const selectedFocusArea = focusAreas.find((focusArea) => focusArea.id === selectedFocusAreaId) ?? null
  const goalsStatusText =
    goalsSaveMessage || (isGoalsDirty ? 'Unsaved changes. Save to update Today and Analysis.' : '')
  const focusAreasStatusText =
    focusAreasSaveMessage || (isFocusAreasDirty ? 'Unsaved changes. Save to update Today and Analysis.' : '')

  useEffect(() => {
    setDraftScenarioPaths(selectedPlaylist?.scenarioPaths ?? [])
  }, [selectedPlaylist?.id, selectedPlaylist?.scenarioPaths])

  const filteredTrackedScenarios = useMemo(() => {
    const normalizedQuery = trackedScenarioQuery.trim().toLowerCase()
    return trackedScenarios.filter((scenario) =>
      scenario.scenarioName.toLowerCase().includes(normalizedQuery) ||
      scenario.scenarioPath.toLowerCase().includes(normalizedQuery),
    )
  }, [trackedScenarios, trackedScenarioQuery])

  const trackedColumns: DataTableColumn<ScenarioRef>[] = [
    {
      id: 'scenario',
      header: 'Tracked scenario',
      width: '46%',
      truncate: true,
      render: (scenario) => scenario.scenarioName,
      title: (scenario) => scenario.scenarioPath,
    },
    {
      id: 'path',
      header: 'Path',
      width: '34%',
      truncate: true,
      render: (scenario) => scenario.scenarioPath,
      title: (scenario) => scenario.scenarioPath,
    },
    {
      id: 'total',
      header: 'Tracked',
      width: '20%',
      align: 'right',
      render: (scenario) => formatDuration(scenario.totalSeconds),
    },
  ]

  const activeSessionSeconds =
    trackedOverview?.activeSession.isTracking && trackedOverview.activeSession.startedAt
      ? Math.max(0, Math.floor(Date.now() / 1000) - trackedOverview.activeSession.startedAt)
      : 0

  async function handleCreatePlaylist() {
    const normalized = newPlaylistName.trim()
    if (!normalized) {
      setMappingStatus('Enter a playlist name first.')
      return
    }

    setIsCreatingPlaylist(true)
    setMappingStatus('')
    try {
      await onCreatePlaylist(normalized)
      setNewPlaylistName('')
      setMappingStatus(`Created playlist "${normalized}".`)
    } catch (error) {
      setMappingStatus(String(error))
    } finally {
      setIsCreatingPlaylist(false)
    }
  }

  async function handleSaveMappings() {
    if (!selectedPlaylist) {
      setMappingStatus('Create or select a playlist first.')
      return
    }

    setIsSavingMappings(true)
    setMappingStatus('')
    try {
      await onSavePlaylistMappings(selectedPlaylist.id, draftScenarioPaths)
      setMappingStatus(`Saved ${draftScenarioPaths.length} mapped scenarios to ${selectedPlaylist.name}.`)
    } catch (error) {
      setMappingStatus(String(error))
    } finally {
      setIsSavingMappings(false)
    }
  }

  function toggleScenarioPath(path: string) {
    setDraftScenarioPaths((current) =>
      current.includes(path) ? current.filter((value) => value !== path) : [...current, path],
    )
  }

  function handleCreateFocusAreaClick() {
    const normalized = newFocusAreaLabel.trim()
    if (!normalized) {
      return
    }

    onCreateFocusArea(normalized)
    setNewFocusAreaLabel('')
  }

  return (
    <div className="view-shell">
      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            eyebrow="Practice"
            title="Live session companion"
            description="Tracked SQLite segments power live totals, session attribution, and future tray-first behavior."
            actions={
              <button className="btn btn-secondary" type="button" onClick={onOpenAnalysisPreset}>
                Open preset in analysis
              </button>
            }
          />

          <div className="chip-grid">
            <MetricChip
              label="Tracking"
              value={trackedOverview?.activeSession.isTracking ? 'Live now' : 'Waiting'}
              tone={trackedOverview?.activeSession.isTracking ? 'improving' : 'flat'}
            />
            <MetricChip
              label="Active scenario"
              value={trackedOverview?.activeSession.scenarioName || 'No active scenario'}
            />
            <MetricChip
              label="Elapsed"
              value={trackedOverview?.activeSession.isTracking ? formatDuration(activeSessionSeconds) : '--'}
            />
            <MetricChip
              label="KovaaK process"
              value={trackedOverview?.diagnostics.isKovaakRunning ? 'Detected' : 'Not running'}
            />
          </div>

          <dl className="key-value-list">
            <div>
              <dt className="label">Session file</dt>
              <dd className="mono">{trackedOverview?.diagnostics.sessionPath || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="label">Last modified</dt>
              <dd>{formatTimestamp(trackedOverview?.diagnostics.sessionFileModifiedAt)}</dd>
            </div>
            <div>
              <dt className="label">Last snapshot</dt>
              <dd>{trackedOverview?.diagnostics.lastSnapshotScenarioName || 'No session snapshot yet'}</dd>
            </div>
          </dl>

          {trackedOverview?.diagnostics.lastError ? (
            <EmptyState
              title="Tracker diagnostics"
              description={trackedOverview.diagnostics.lastError}
              className="error-inline"
            />
          ) : null}
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Focus Presets"
            description="These presets persist locally and keep practice aligned with the analysis workspace."
          />
          <div className="preset-grid">
            {FOCUS_PRESETS.map((preset) => {
              const isActive = preset.id === activeFocusPreset
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-card${isActive ? ' is-active' : ''}`}
                  onClick={() => onActivateFocusPreset(preset.id)}
                >
                  <strong>{preset.label}</strong>
                  <span className="subtle">{preset.description}</span>
                </button>
              )
            })}
          </div>

          <div className="practice-shortlist">
            {presetScenarios.slice(0, 5).map((scenario) => (
              <div key={scenario.scenarioName} className="practice-shortlist-item">
                <div>
                  <strong>{scenario.scenarioName}</strong>
                  <p className="subtle">{formatTrendStatus(scenario.trendStatus)}</p>
                </div>
                <div className="practice-shortlist-metrics">
                  <span>{formatDeltaPercent(scenario.deltaPct)}</span>
                  <span>{formatDuration(scenario.secondsLast30d)}</span>
                </div>
              </div>
            ))}
            {presetScenarios.length === 0 ? (
              <EmptyState
                title="No scenarios match this preset."
                description="Try another preset or build more history."
              />
            ) : null}
          </div>
        </PanelCard>
      </div>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Plan Builder"
            description="Generate a 20, 30, or 45-minute session with warmup, main work, and cleanup blocks."
          />
          <div className="playlist-pill-row">
            {[20, 30, 45].map((minutes) => {
              const isActive = planDurationMinutes === minutes
              return (
                <button
                  key={minutes}
                  type="button"
                  className={`coach-filter-button${isActive ? ' is-active' : ''}`}
                  onClick={() => onPlanDurationChange(minutes as PracticeDuration)}
                >
                  {minutes} min
                </button>
              )
            })}
          </div>
          <div className="playlist-pill-row">
            <button
              type="button"
              className={`coach-filter-button${selectedFocusAreaId === null ? ' is-active' : ''}`}
              onClick={() => onSelectFocusArea(null)}
            >
              All focus areas
            </button>
            {focusAreas.map((focusArea) => {
              const isActive = selectedFocusAreaId === focusArea.id
              return (
                <button
                  key={focusArea.id}
                  type="button"
                  className={`coach-filter-button${isActive ? ' is-active' : ''}`}
                  onClick={() => onSelectFocusArea(focusArea.id)}
                >
                  {focusArea.label}
                </button>
              )
            })}
          </div>
          <p className="subtle">{trainingPlan.summary}</p>
          <div className="goal-list">
            {trainingPlan.blocks.map((block, index) => (
              <div key={`${block.phase}-${index}`} className="goal-item">
                <div className="goal-item-head">
                  <strong>{block.phase}</strong>
                  <span className="subtle">{block.minutes}m</span>
                </div>
                <strong>{block.scenarioName}</strong>
                <span className="subtle">{block.reason}</span>
              </div>
            ))}
          </div>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Focus Areas"
            description="Create custom buckets and assign scenarios into them for balance and neglect reporting."
            actions={
              <button className="btn" type="button" onClick={onSaveFocusAreas} disabled={!isFocusAreasDirty}>
                Save focus areas
              </button>
            }
          />
          <div className="inline-input-row">
            <label className="settings-field field-grow" htmlFor={focusAreaInputId}>
              <span className="label">New focus area</span>
              <input
                id={focusAreaInputId}
                className="text-input"
                type="text"
                value={newFocusAreaLabel}
                onChange={(event) => setNewFocusAreaLabel(event.target.value)}
                placeholder="Create a focus area"
              />
            </label>
            <button className="btn" type="button" onClick={handleCreateFocusAreaClick}>
              Add focus area
            </button>
          </div>
          {focusAreasStatusText ? (
            <p className={`header-status${focusAreasSaveTone === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
              {focusAreasStatusText}
            </p>
          ) : null}
          {focusAreas.length > 0 ? (
            <>
              <div className="playlist-pill-row">
                {focusAreas.map((focusArea) => {
                  const isActive = selectedFocusAreaId === focusArea.id
                  return (
                    <button
                      key={focusArea.id}
                      type="button"
                      className={`coach-filter-button${isActive ? ' is-active' : ''}`}
                      onClick={() => onSelectFocusArea(focusArea.id)}
                    >
                      {focusArea.label}
                    </button>
                  )
                })}
              </div>
              <div className="goal-list">
                {focusAreaSummaries.map((focusArea) => (
                  <div key={focusArea.id} className="goal-item">
                    <div className="goal-item-head">
                      <strong>{focusArea.label}</strong>
                      <button className="btn btn-secondary" type="button" onClick={() => onDeleteFocusArea(focusArea.id)}>
                        Remove
                      </button>
                    </div>
                    <span className="subtle">
                      {formatDuration(focusArea.secondsLast7d)} in 7d, {formatDuration(focusArea.secondsLast30d)} in 30d
                    </span>
                    <span className="subtle">{focusArea.neglectedCount} neglected scenarios</span>
                  </div>
                ))}
              </div>
              {selectedFocusArea ? (
                <div className="mapping-checklist">
                  {summary?.scenarioAnalytics.map((scenario) => {
                    const checked = selectedFocusArea.scenarioNames.includes(scenario.scenarioName)
                    return (
                      <label key={scenario.scenarioName} className="mapping-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleFocusAreaScenario(selectedFocusArea.id, scenario.scenarioName)}
                        />
                        <span>
                          <strong>{scenario.scenarioName}</strong>
                          <span className="subtle">
                            {formatTrendStatus(scenario.trendStatus)} | {formatDuration(scenario.secondsLast30d)} in 30d
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="No focus areas yet."
              description="Create one above, then assign scenarios into it."
            />
          )}
        </PanelCard>
      </div>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Coach Explanations"
            description="Why each block was chosen, how much it has been trained recently, and how close it is to a recovery."
          />

          {summary && summary.progressCoach.recommendations.length > 0 ? (
            <ol className="coach-plan">
              {summary.progressCoach.recommendations.map((recommendation) => (
                <li key={recommendation.scenarioName} className="coach-plan-item detailed-plan-item">
                  <div className="coach-plan-head">
                    <strong>{recommendation.scenarioName}</strong>
                    <span className="coach-plan-minutes">{recommendation.minutes}m</span>
                  </div>
                  <div className="coach-plan-meta">
                    <span className="coach-plan-tag">{formatRecommendationReason(recommendation.reason)}</span>
                    <span className="subtle">Confidence {Math.round(recommendation.confidence * 100)}%</span>
                    <span className="subtle">{recommendation.reasonStats.daysSinceLastPlayed}d stale</span>
                  </div>
                  <span className="subtle">
                    {formatDeltaPercent(recommendation.reasonStats.deltaPct)} delta,
                    {' '}7d {formatDuration(recommendation.reasonStats.secondsLast7d)},
                    {' '}30d {formatDuration(recommendation.reasonStats.secondsLast30d)}
                  </span>
                  <span className="subtle">{recommendation.note}</span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No coach plan yet."
              description="Historical CSV data unlocks the ranked practice blocks."
            />
          )}
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Weekly Goals & Readiness"
            description="Targets are editable here, and recent load is checked against your longer baseline."
            actions={
              <button className="btn" type="button" onClick={onSaveGoals} disabled={!isGoalsDirty}>
                Save goals
              </button>
            }
          />
          <div className="chip-grid">
            <MetricChip
              label="Status"
              value={readinessSummary.status}
              tone={
                readinessSummary.status === 'overloaded'
                  ? 'declining'
                  : readinessSummary.status === 'balanced'
                    ? 'improving'
                    : 'flat'
              }
            />
            <MetricChip label="7d load" value={formatDuration(readinessSummary.recentLoadSeconds)} />
            <MetricChip label="Baseline" value={formatDuration(readinessSummary.baselineWeeklySeconds)} />
            <MetricChip
              label="Coverage"
              value={`${Math.round(readinessSummary.focusAreaCoverage * 100)}%`}
              tone={readinessSummary.narrowTrainingWarning ? 'declining' : 'improving'}
            />
          </div>
          <p className="subtle">{readinessSummary.message}</p>
          {goalsStatusText ? (
            <p className={`header-status${goalsSaveTone === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
              {goalsStatusText}
            </p>
          ) : null}
          <div className="goal-list">
            {goals.map((goal) => {
              const progress = goalProgress.find((item) => item.id === goal.id)
              const goalTargetId = `${goalTargetIdPrefix}-${goal.id}`
              return (
                <div key={goal.id} className="goal-item">
                  <div className="goal-item-head">
                    <strong>{goal.label}</strong>
                    <span className="subtle">
                      {progress?.current ?? 0} / {goal.target} {goal.unit}
                    </span>
                  </div>
                  <div className="goal-editor-row">
                    <label className="settings-field goal-target-field" htmlFor={goalTargetId}>
                      <span className="label">{goal.label} target</span>
                      <input
                        id={goalTargetId}
                        className="text-input small-input"
                        type="number"
                        min="1"
                        value={goal.target}
                        onChange={(event) => onGoalTargetChange(goal.id, Number(event.target.value))}
                      />
                    </label>
                    <div className="goal-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(6, Math.round((progress?.progress ?? 0) * 100))}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </PanelCard>
      </div>

      <PanelCard>
        <SectionHeader
          title="Personal Best Watchlist"
          description="Quick scan of the current preset candidates, their bests, and how recently they were played."
        />
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="align-right">PB</th>
                <th className="align-right">Latest</th>
                <th className="align-right">Trend</th>
                <th className="align-right">Last played</th>
              </tr>
            </thead>
            <tbody>
              {presetScenarios.slice(0, 8).map((scenario) => (
                <tr key={scenario.scenarioName}>
                  <td>{scenario.scenarioName}</td>
                  <td className="align-right">{formatQualityValue(scenario.personalBest)}</td>
                  <td className="align-right">{formatQualityValue(scenario.latestQualityValue)}</td>
                  <td className="align-right">{formatTrendStatus(scenario.trendStatus)}</td>
                  <td className="align-right">{formatTimestamp(scenario.lastPlayedAt)}</td>
                </tr>
              ))}
              {presetScenarios.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-row">
                    No scenarios match the active preset.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PanelCard>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Playlist Mapping"
            description="Map live-tracked scenario paths to playlists so session totals are attributed correctly."
          />

          <div className="settings-stack">
            <div className="inline-input-row">
              <label className="settings-field field-grow" htmlFor={playlistNameInputId}>
                <span className="label">New tracked playlist</span>
                <input
                  id={playlistNameInputId}
                  className="text-input"
                  type="text"
                  value={newPlaylistName}
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                  placeholder="Create a new tracked playlist"
                />
              </label>
              <button className="btn" type="button" onClick={() => void handleCreatePlaylist()} disabled={isCreatingPlaylist}>
                {isCreatingPlaylist ? 'Creating...' : 'Create playlist'}
              </button>
            </div>

            <div className="playlist-pill-row">
              {playlistRecords.map((playlist) => {
                const isActive = playlist.id === selectedPlaylist?.id
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    className={`coach-filter-button${isActive ? ' is-active' : ''}`}
                    onClick={() => onSelectPlaylist(playlist.id)}
                  >
                    {playlist.name}
                  </button>
                )
              })}
            </div>

            {selectedPlaylist ? (
              <>
                <label className="settings-field" htmlFor={trackedScenarioSearchId}>
                  <span className="label">Tracked scenario search</span>
                  <input
                    id={trackedScenarioSearchId}
                    className="search-input"
                    type="search"
                    value={trackedScenarioQuery}
                    onChange={(event) => onTrackedScenarioQueryChange(event.target.value)}
                    placeholder="Search tracked scenario paths"
                  />
                </label>
                <div className="mapping-checklist">
                  {filteredTrackedScenarios.map((scenario) => {
                    const checked = draftScenarioPaths.includes(scenario.scenarioPath)
                    return (
                      <label key={scenario.scenarioPath} className="mapping-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleScenarioPath(scenario.scenarioPath)}
                        />
                        <span>
                          <strong>{scenario.scenarioName}</strong>
                          <span className="subtle mono">{scenario.scenarioPath}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                <button className="btn" type="button" onClick={() => void handleSaveMappings()} disabled={isSavingMappings}>
                  {isSavingMappings ? 'Saving...' : 'Save mappings'}
                </button>
              </>
            ) : (
              <EmptyState
                title="No tracked playlist selected."
                description="Create a playlist first, then map tracked scenario paths into it."
              />
            )}

            {mappingStatus ? (
              <p className="header-status" role="status" aria-live="polite">
                {mappingStatus}
              </p>
            ) : null}
          </div>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Tracked Scenario Inventory"
            description="These are the scenario paths the live tracker has already seen."
          />
          <DataTable
            columns={trackedColumns}
            rows={filteredTrackedScenarios}
            rowKey={(scenario) => scenario.scenarioPath}
            emptyMessage="No tracked scenarios have been captured yet."
          />
        </PanelCard>
      </div>
    </div>
  )
}

export default PracticeView
