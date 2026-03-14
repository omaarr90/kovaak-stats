import { type CSSProperties } from 'react'
import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  WEEKDAY_LABELS,
  formatCompactDuration,
  formatDateLabel,
  formatDeltaPercent,
  formatDuration,
  formatMetricType,
  formatMonthLabel,
  formatQualityValue,
  formatTimestamp,
  formatTrendStatus,
} from '../playtime-utils'
import {
  buildMonthlyTotals,
  buildWeekdayInsights,
  buildWeeklyActivity,
  FOCUS_PRESETS,
} from '../training-insights'
import {
  type CalendarCell,
  type DailyPlaytime,
  type FocusAreaSummary,
  type FocusPresetId,
  type PersonalBestTimelineEntry,
  type PlaytimeSummary,
  type ReadinessSummary,
  type ScenarioAnalytics,
  type ScenarioRecencyFilter,
  type ScenarioSortField,
  type ScenarioTrendFilter,
  type ScenarioVolumeFilter,
} from '../types'

type AnalysisViewProps = {
  summary: PlaytimeSummary | null
  statusMessage: string
  playlistQuery: string
  scenarioQuery: string
  scenarioTrendFilter: ScenarioTrendFilter
  scenarioVolumeFilter: ScenarioVolumeFilter
  scenarioRecencyFilter: ScenarioRecencyFilter
  scenarioSortField: ScenarioSortField
  activeFocusPreset: FocusPresetId
  focusAreaSummaries: FocusAreaSummary[]
  readinessSummary: ReadinessSummary
  personalBestTimeline: PersonalBestTimelineEntry[]
  filteredPlaylists: PlaytimeSummary['playlists']
  filteredScenarios: PlaytimeSummary['scenarioAnalytics']
  selectedScenario: ScenarioAnalytics | null
  hasCalendarRange: boolean
  activeMonthKey: string
  canGoPrevious: boolean
  canGoNext: boolean
  calendarCells: CalendarCell[]
  effectiveSelectedDateKey: string
  selectedDay: DailyPlaytime
  visibleMonthPeakSeconds: number
  onMonthChange: (offset: number) => void
  onSelectDate: (dateKey: string) => void
  onPlaylistQueryChange: (next: string) => void
  onScenarioQueryChange: (next: string) => void
  onScenarioTrendFilterChange: (next: ScenarioTrendFilter) => void
  onScenarioVolumeFilterChange: (next: ScenarioVolumeFilter) => void
  onScenarioRecencyFilterChange: (next: ScenarioRecencyFilter) => void
  onScenarioSortFieldChange: (next: ScenarioSortField) => void
  onSelectScenario: (next: string) => void
  onApplyFocusPreset: (presetId: FocusPresetId) => void
}

const TREND_FILTER_OPTIONS: { value: ScenarioTrendFilter; label: string }[] = [
  { value: 'all', label: 'All trends' },
  { value: 'declining', label: 'Declining' },
  { value: 'flat', label: 'Flat' },
  { value: 'improving', label: 'Improving' },
  { value: 'insufficientData', label: 'Insufficient' },
]

const VOLUME_FILTER_OPTIONS: { value: ScenarioVolumeFilter; label: string }[] = [
  { value: 'all', label: 'All volume' },
  { value: 'active7d', label: 'Played in 7d' },
  { value: 'active30d', label: 'Played in 30d' },
  { value: 'quiet7d', label: 'Quiet this week' },
]

const RECENCY_FILTER_OPTIONS: { value: ScenarioRecencyFilter; label: string }[] = [
  { value: 'all', label: 'Any recency' },
  { value: 'played7d', label: 'Played in 7d' },
  { value: 'played30d', label: 'Played in 30d' },
  { value: 'played90d', label: 'Played in 90d' },
  { value: 'stale30d', label: 'Stale 30d+' },
]

const SORT_OPTIONS: { value: ScenarioSortField; label: string }[] = [
  { value: 'totalSeconds', label: 'Total time' },
  { value: 'secondsLast30d', label: '30d time' },
  { value: 'attemptsLast30d', label: '30d runs' },
  { value: 'deltaPct', label: 'Delta' },
  { value: 'lastPlayedAt', label: 'Last played' },
  { value: 'personalBest', label: 'Personal best' },
]

function AnalysisView({
  summary,
  statusMessage,
  playlistQuery,
  scenarioQuery,
  scenarioTrendFilter,
  scenarioVolumeFilter,
  scenarioRecencyFilter,
  scenarioSortField,
  activeFocusPreset,
  focusAreaSummaries,
  readinessSummary,
  personalBestTimeline,
  filteredPlaylists,
  filteredScenarios,
  selectedScenario,
  hasCalendarRange,
  activeMonthKey,
  canGoPrevious,
  canGoNext,
  calendarCells,
  effectiveSelectedDateKey,
  selectedDay,
  visibleMonthPeakSeconds,
  onMonthChange,
  onSelectDate,
  onPlaylistQueryChange,
  onScenarioQueryChange,
  onScenarioTrendFilterChange,
  onScenarioVolumeFilterChange,
  onScenarioRecencyFilterChange,
  onScenarioSortFieldChange,
  onSelectScenario,
  onApplyFocusPreset,
}: AnalysisViewProps) {
  if (!summary) {
    return (
      <div className="view-shell">
        <PanelCard>
          <SectionHeader title="Analysis workspace" description="Load historical sessions to unlock the drill-down surfaces." />
          <EmptyState
            title="No historical data loaded."
            description={statusMessage || 'Once CSV stats are detected, this view becomes the analytics workspace.'}
          />
        </PanelCard>
      </div>
    )
  }

  const weeklyActivity = buildWeeklyActivity(summary.dailySummaries)
  const monthlyTotals = buildMonthlyTotals(summary.dailySummaries)
  const weekdayInsights = buildWeekdayInsights(summary)
  const neglectedCount = summary.scenarioAnalytics.filter((scenario) => !scenario.lastPlayedAt || daysSince(scenario.lastPlayedAt) > 30).length
  const bestDay = [...summary.dailySummaries].sort((left, right) => right.totalSeconds - left.totalSeconds)[0]

  const playlistColumns: DataTableColumn<PlaytimeSummary['playlists'][number]>[] = [
    {
      id: 'name',
      header: 'Playlist',
      width: '46%',
      truncate: true,
      render: (playlist) => playlist.name,
      title: (playlist) => playlist.name,
    },
    {
      id: 'matched',
      header: 'Matched',
      width: '14%',
      align: 'right',
      render: (playlist) => `${playlist.matchedScenarios}/${playlist.totalScenarios}`,
    },
    {
      id: 'recent',
      header: '30d',
      width: '18%',
      align: 'right',
      render: (playlist) => formatDuration(playlist.secondsLast30d),
    },
    {
      id: 'total',
      header: 'Total',
      width: '22%',
      align: 'right',
      render: (playlist) => formatDuration(playlist.totalSeconds),
    },
  ]

  const scenarioColumns: DataTableColumn<ScenarioAnalytics>[] = [
    {
      id: 'scenario',
      header: 'Scenario',
      width: '32%',
      render: (scenario) => (
        <button
          type="button"
          className={`table-link-button${selectedScenario?.scenarioName === scenario.scenarioName ? ' is-active' : ''}`}
          onClick={() => onSelectScenario(scenario.scenarioName)}
        >
          {scenario.scenarioName}
        </button>
      ),
      title: (scenario) => scenario.scenarioName,
    },
    {
      id: 'trend',
      header: 'Trend',
      width: '14%',
      render: (scenario) => (
        <span className={`status-pill ${scenario.trendStatus}`}>{formatTrendStatus(scenario.trendStatus)}</span>
      ),
    },
    {
      id: 'recent',
      header: '30d',
      width: '14%',
      align: 'right',
      render: (scenario) => formatDuration(scenario.secondsLast30d),
    },
    {
      id: 'delta',
      header: 'Delta',
      width: '14%',
      align: 'right',
      render: (scenario) => formatDeltaPercent(scenario.deltaPct),
    },
    {
      id: 'lastPlayed',
      header: 'Last played',
      width: '26%',
      align: 'right',
      render: (scenario) => formatTimestamp(scenario.lastPlayedAt),
    },
  ]

  return (
    <div className="view-shell">
      <PanelCard>
        <SectionHeader
          eyebrow="Analysis"
          title="Training history, calendar, and scenario explorer"
          description="Use the preset cards to drive filters, then inspect a scenario in the side panel."
        />

        <div className="preset-grid">
          {FOCUS_PRESETS.map((preset) => {
            const isActive = activeFocusPreset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                className={`preset-card${isActive ? ' is-active' : ''}`}
                onClick={() => onApplyFocusPreset(preset.id)}
              >
                <strong>{preset.label}</strong>
                <span className="subtle">{preset.description}</span>
              </button>
            )
          })}
        </div>

        <div className="chip-grid">
          <MetricChip label="Selected preset" value={FOCUS_PRESETS.find((preset) => preset.id === activeFocusPreset)?.label ?? 'Custom'} />
          <MetricChip label="Neglected scenarios" value={neglectedCount} tone="declining" />
          <MetricChip label="Best day" value={bestDay ? formatDateLabel(bestDay.dateKey) : '--'} />
          <MetricChip label="Best session" value={bestDay ? formatDuration(bestDay.totalSeconds) : '--'} />
        </div>
      </PanelCard>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader title="12-Week Activity Strip" description="Weekly totals from the last twelve calendar weeks." />
          <ActivityStrip weeks={weeklyActivity} />
        </PanelCard>

        <PanelCard>
          <SectionHeader title="Monthly Totals" description="Recent monthly volume and your strongest training days." />
          <MonthlyBars months={monthlyTotals} />
          <div className="weekday-grid">
            {weekdayInsights.slice(0, 3).map((day) => (
              <div key={day.label} className="weekday-chip">
                <span className="label">{day.label}</span>
                <strong>{formatDuration(day.totalSeconds)}</strong>
              </div>
            ))}
          </div>
        </PanelCard>
      </div>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Readiness & Rotation"
            description="Baseline workload versus recent load, plus whether your recent training is too narrow."
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
              label="Focus coverage"
              value={`${Math.round(readinessSummary.focusAreaCoverage * 100)}%`}
              tone={readinessSummary.narrowTrainingWarning ? 'declining' : 'improving'}
            />
          </div>
          <p className="subtle">{readinessSummary.message}</p>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Focus Area Balance"
            description="User-defined buckets show where your recent time is concentrated and what has gone neglected."
          />
          {focusAreaSummaries.length > 0 ? (
            <div className="goal-list">
              {focusAreaSummaries.map((focusArea) => (
                <div key={focusArea.id} className="goal-item">
                  <div className="goal-item-head">
                    <strong>{focusArea.label}</strong>
                    <span className="subtle">{focusArea.scenarioCount} scenarios</span>
                  </div>
                  <span className="subtle">
                    {formatDuration(focusArea.secondsLast7d)} in 7d, {formatDuration(focusArea.secondsLast30d)} in 30d
                  </span>
                  <span className="subtle">{focusArea.neglectedCount} neglected scenarios</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No focus areas yet."
              description="Create them in Practice to unlock balance and neglect reporting."
            />
          )}
        </PanelCard>
      </div>

      <PanelCard>
        <SectionHeader
          title="Personal Best Timeline"
          description="Recent PB checkpoints, ordered from newest to oldest."
        />
        {personalBestTimeline.length > 0 ? (
          <div className="goal-list timeline-list">
            {personalBestTimeline.map((entry) => (
              <div key={`${entry.scenarioName}-${entry.personalBestAt}`} className="goal-item">
                <div className="goal-item-head">
                  <strong>{entry.scenarioName}</strong>
                  <span className="subtle">{formatTimestamp(entry.personalBestAt)}</span>
                </div>
                <span className="subtle">
                  PB {formatQualityValue(entry.personalBest)}
                  {entry.metricType ? ` | ${formatMetricType(entry.metricType)}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No PB timeline yet." description="Play more scored scenarios to populate this timeline." />
        )}
      </PanelCard>

      <div className="panel-grid-two analysis-calendar-grid">
        <PanelCard>
          <SectionHeader
            title="Daily Calendar"
            description="Select a day to inspect the session recap and scenario mix."
            actions={
              <div className="calendar-toolbar">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => onMonthChange(-1)}
                  disabled={!canGoPrevious}
                >
                  Previous
                </button>
                <strong className="calendar-month">{formatMonthLabel(activeMonthKey)}</strong>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => onMonthChange(1)}
                  disabled={!canGoNext}
                >
                  Next
                </button>
              </div>
            }
          />

          {hasCalendarRange ? (
            <>
              <div className="calendar-weekdays" aria-hidden="true">
                {WEEKDAY_LABELS.map((label) => (
                  <span key={label} className="calendar-weekday">
                    {label}
                  </span>
                ))}
              </div>

              <div className="calendar-grid" role="grid" aria-label="Playtime by day">
                {calendarCells.map((cell) => {
                  if (cell.kind === 'spacer') {
                    return <div key={cell.key} className="calendar-spacer" aria-hidden="true" />
                  }

                  const isSelected = cell.dateKey === effectiveSelectedDateKey
                  const totalSeconds = cell.summary?.totalSeconds ?? 0
                  const attemptCount = cell.summary?.attemptCount ?? 0
                  const activityStrength = visibleMonthPeakSeconds > 0 ? totalSeconds / visibleMonthPeakSeconds : 0

                  return (
                    <button
                      key={cell.key}
                      className={`calendar-day${isSelected ? ' is-selected' : ''}${totalSeconds > 0 ? ' is-played' : ''}`}
                      onClick={() => onSelectDate(cell.dateKey)}
                      type="button"
                      style={{ '--activity-strength': activityStrength.toFixed(3) } as CSSProperties}
                      aria-pressed={isSelected}
                      aria-label={`${formatDateLabel(cell.dateKey)}, ${formatCompactDuration(totalSeconds)}, ${attemptCount} runs`}
                    >
                      <span className="calendar-day-number">{cell.dayNumber}</span>
                      <span className="calendar-day-duration">{formatCompactDuration(totalSeconds)}</span>
                      <span className="calendar-day-runs">{attemptCount > 0 ? `${attemptCount} runs` : 'No play'}</span>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <EmptyState
              title="No calendar data yet."
              description="Complete a scenario and refresh to populate your calendar history."
            />
          )}
        </PanelCard>

        <PanelCard>
          <SectionHeader title={formatDateLabel(selectedDay.dateKey)} description="Session recap for the selected day." />
          <div className="chip-grid">
            <MetricChip label="Playtime" value={formatDuration(selectedDay.totalSeconds)} />
            <MetricChip label="Runs" value={selectedDay.attemptCount} />
            <MetricChip label="Playlists" value={selectedDay.playlists.length} />
            <MetricChip label="Scenarios" value={selectedDay.scenarios.length} />
          </div>
          <DataTable
            columns={[
              {
                id: 'name',
                header: 'Scenario',
                width: '60%',
                truncate: true,
                render: (scenario) => scenario.name,
                title: (scenario) => scenario.name,
              },
              {
                id: 'time',
                header: 'Time',
                width: '20%',
                align: 'right',
                render: (scenario) => formatDuration(scenario.totalSeconds),
              },
              {
                id: 'runs',
                header: 'Runs',
                width: '20%',
                align: 'right',
                render: (scenario) => scenario.attemptCount,
              },
            ]}
            rows={selectedDay.scenarios}
            rowKey={(scenario) => `${selectedDay.dateKey}-${scenario.name}`}
            emptyMessage="No scenarios recorded on this day."
            compact
          />
        </PanelCard>
      </div>

      <div className="analysis-workspace">
        <PanelCard className="analysis-main-panel">
          <SectionHeader
            title="Scenario Explorer"
            description="Search, filter, and sort scenarios before opening the detail inspector."
          />
          <div className="filter-grid">
            <input
              className="search-input"
              type="search"
              value={scenarioQuery}
              onChange={(event) => onScenarioQueryChange(event.target.value)}
              placeholder="Search scenarios"
              aria-label="Search scenarios"
            />
            <select
              className="filter-select"
              value={scenarioTrendFilter}
              onChange={(event) => onScenarioTrendFilterChange(event.target.value as ScenarioTrendFilter)}
            >
              {TREND_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={scenarioVolumeFilter}
              onChange={(event) => onScenarioVolumeFilterChange(event.target.value as ScenarioVolumeFilter)}
            >
              {VOLUME_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={scenarioRecencyFilter}
              onChange={(event) => onScenarioRecencyFilterChange(event.target.value as ScenarioRecencyFilter)}
            >
              {RECENCY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={scenarioSortField}
              onChange={(event) => onScenarioSortFieldChange(event.target.value as ScenarioSortField)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <DataTable
            columns={scenarioColumns}
            rows={filteredScenarios}
            rowKey={(scenario) => scenario.scenarioName}
            emptyMessage="No scenarios match the current filters."
          />
        </PanelCard>

        <PanelCard className="analysis-side-panel">
          <SectionHeader
            title={selectedScenario?.scenarioName ?? 'Scenario detail'}
            description={
              selectedScenario
                ? 'The inspector stays focused on one scenario while filters and lists change around it.'
                : 'Pick a scenario from the explorer to inspect it here.'
            }
          />

          {selectedScenario ? (
            <>
              <div className="chip-grid">
                <MetricChip label="Trend" value={formatTrendStatus(selectedScenario.trendStatus)} />
                <MetricChip label="30d delta" value={formatDeltaPercent(selectedScenario.deltaPct)} />
                <MetricChip label="PB" value={formatQualityValue(selectedScenario.personalBest)} />
                <MetricChip label="Last played" value={formatTimestamp(selectedScenario.lastPlayedAt)} />
              </div>

              <div className="panel-grid-two detail-grid">
                <PanelCard className="nested-panel">
                  <SectionHeader
                    title="Quality sparkline"
                    description={
                      selectedScenario.metricType
                        ? `${formatMetricType(selectedScenario.metricType)} checkpoints from recent runs`
                        : 'Quality data appears after scored or accuracy-based runs are parsed.'
                    }
                  />
                  {selectedScenario.recentQualitySamples.length > 1 ? (
                    <QualitySparkline scenario={selectedScenario} />
                  ) : (
                    <EmptyState
                      title="Not enough samples yet."
                      description="Play more scored scenarios to unlock the sparkline."
                    />
                  )}
                </PanelCard>

                <PanelCard className="nested-panel">
                  <SectionHeader title="Inspector notes" />
                  <dl className="key-value-list">
                    <div>
                      <dt className="label">Tracked metric</dt>
                      <dd>{selectedScenario.metricType ? formatMetricType(selectedScenario.metricType) : 'Unavailable'}</dd>
                    </div>
                    <div>
                      <dt className="label">Recent volume</dt>
                      <dd>{formatDuration(selectedScenario.secondsLast7d)} in 7d, {formatDuration(selectedScenario.secondsLast30d)} in 30d</dd>
                    </div>
                    <div>
                      <dt className="label">Attempts</dt>
                      <dd>{selectedScenario.attemptsLast7d} in 7d, {selectedScenario.attemptsLast30d} in 30d</dd>
                    </div>
                    <div>
                      <dt className="label">Latest quality</dt>
                      <dd>{formatQualityValue(selectedScenario.latestQualityValue)}</dd>
                    </div>
                  </dl>
                </PanelCard>
              </div>
            </>
          ) : (
            <EmptyState
              title="No scenario selected."
              description="Choose a scenario from the explorer table."
            />
          )}
        </PanelCard>
      </div>

      <PanelCard>
        <SectionHeader title="Playlist Explorer" description="Current playlist files are inferred from the latest KovaaK playlist JSON files." />
        <input
          className="search-input"
          type="search"
          value={playlistQuery}
          onChange={(event) => onPlaylistQueryChange(event.target.value)}
          placeholder="Search playlists"
          aria-label="Search playlists"
        />
        <DataTable
          columns={playlistColumns}
          rows={filteredPlaylists}
          rowKey={(playlist) => playlist.name}
          emptyMessage="No matching playlists."
        />
      </PanelCard>

      {statusMessage ? (
        <PanelCard className="error-panel">
          <SectionHeader title="Read Error" description={statusMessage} />
        </PanelCard>
      ) : null}
    </div>
  )
}

function ActivityStrip({ weeks }: { weeks: { label: string; totalSeconds: number }[] }) {
  const width = 560
  const height = 140
  const barWidth = 32
  const gap = 12
  const peak = Math.max(...weeks.map((week) => week.totalSeconds), 1)

  return (
    <div className="weekly-strip-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="weekly-strip" role="img" aria-label="Weekly activity strip">
        <rect x="0" y="0" width={width} height={height} rx="18" className="sparkline-bg" />
        {weeks.map((week, index) => {
          const x = 22 + index * (barWidth + gap)
          const barHeight = Math.max(8, (week.totalSeconds / peak) * 88)
          const y = 108 - barHeight
          return (
            <g key={week.label}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="12" className="activity-bar">
                <title>{`${week.label}: ${formatDuration(week.totalSeconds)}`}</title>
              </rect>
              <text x={x + barWidth / 2} y="126" textAnchor="middle" className="activity-label">
                {week.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function MonthlyBars({ months }: { months: { monthKey: string; totalSeconds: number }[] }) {
  if (months.length === 0) {
    return <EmptyState title="No monthly totals yet." description="Play more sessions to build a monthly comparison." />
  }

  const peak = Math.max(...months.map((month) => month.totalSeconds), 1)
  return (
    <div className="monthly-bars">
      {months.map((month) => (
        <div key={month.monthKey} className="monthly-bar-item">
          <span className="label">{formatMonthLabel(month.monthKey)}</span>
          <div className="goal-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(8, Math.round((month.totalSeconds / peak) * 100))}%` }} />
          </div>
          <strong>{formatDuration(month.totalSeconds)}</strong>
        </div>
      ))}
    </div>
  )
}

function QualitySparkline({ scenario }: { scenario: ScenarioAnalytics }) {
  const width = 420
  const height = 140
  const paddingX = 14
  const paddingY = 16
  const values = scenario.recentQualitySamples.map((sample) => sample.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = Math.max(maxValue - minValue, 1)
  const pointGap = values.length > 1 ? (width - paddingX * 2) / (values.length - 1) : 0
  const points = scenario.recentQualitySamples
    .map((sample, index) => {
      const x = paddingX + pointGap * index
      const normalized = (sample.value - minValue) / range
      const y = height - paddingY - normalized * (height - paddingY * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="sparkline-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" role="img" aria-label={`${scenario.scenarioName} quality sparkline`}>
        <rect x="0" y="0" width={width} height={height} rx="16" className="sparkline-bg" />
        <polyline
          points={points}
          fill="none"
          stroke="rgba(125, 211, 252, 0.95)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {scenario.recentQualitySamples.map((sample, index) => {
          const x = paddingX + pointGap * index
          const normalized = (sample.value - minValue) / range
          const y = height - paddingY - normalized * (height - paddingY * 2)
          return (
            <circle key={sample.endedAt} cx={x} cy={y} r="4" className="sparkline-point">
              <title>{`${formatTimestamp(sample.endedAt)}: ${formatQualityValue(sample.value)}`}</title>
            </circle>
          )
        })}
      </svg>
      <div className="sparkline-scale">
        <span>{formatQualityValue(minValue)}</span>
        <span>{formatQualityValue(maxValue)}</span>
      </div>
    </div>
  )
}

function daysSince(lastPlayedAt?: number | null): number {
  if (!lastPlayedAt) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(0, Math.floor((Date.now() - lastPlayedAt * 1000) / (24 * 60 * 60 * 1000)))
}

export default AnalysisView
