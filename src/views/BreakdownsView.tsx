import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  formatDeltaPercent,
  formatDuration,
  formatMetricType,
  formatQualityValue,
  formatTimestamp,
  formatTrendStatus,
} from '../playtime-utils'
import {
  type PlaytimeSummary,
  type ScenarioAnalytics,
  type ScenarioRecencyFilter,
  type ScenarioSortField,
  type ScenarioTrendFilter,
  type ScenarioVolumeFilter,
} from '../types'

type BreakdownsViewProps = {
  summary: PlaytimeSummary | null
  playlistQuery: string
  scenarioQuery: string
  scenarioTrendFilter: ScenarioTrendFilter
  scenarioVolumeFilter: ScenarioVolumeFilter
  scenarioRecencyFilter: ScenarioRecencyFilter
  scenarioSortField: ScenarioSortField
  filteredPlaylists: PlaytimeSummary['playlists']
  filteredScenarios: PlaytimeSummary['scenarioAnalytics']
  selectedScenario: ScenarioAnalytics | null
  onPlaylistQueryChange: (next: string) => void
  onScenarioQueryChange: (next: string) => void
  onScenarioTrendFilterChange: (next: ScenarioTrendFilter) => void
  onScenarioVolumeFilterChange: (next: ScenarioVolumeFilter) => void
  onScenarioRecencyFilterChange: (next: ScenarioRecencyFilter) => void
  onScenarioSortFieldChange: (next: ScenarioSortField) => void
  onSelectScenario: (next: string) => void
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

function BreakdownsView({
  summary,
  playlistQuery,
  scenarioQuery,
  scenarioTrendFilter,
  scenarioVolumeFilter,
  scenarioRecencyFilter,
  scenarioSortField,
  filteredPlaylists,
  filteredScenarios,
  selectedScenario,
  onPlaylistQueryChange,
  onScenarioQueryChange,
  onScenarioTrendFilterChange,
  onScenarioVolumeFilterChange,
  onScenarioRecencyFilterChange,
  onScenarioSortFieldChange,
  onSelectScenario,
}: BreakdownsViewProps) {
  const playlistColumns: DataTableColumn<PlaytimeSummary['playlists'][number]>[] = [
    {
      id: 'name',
      header: 'Playlist',
      width: '34%',
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
      width: '16%',
      align: 'right',
      render: (playlist) => formatDuration(playlist.secondsLast30d),
    },
    {
      id: 'time',
      header: 'Total',
      width: '16%',
      align: 'right',
      render: (playlist) => formatDuration(playlist.totalSeconds),
    },
    {
      id: 'lastPlayed',
      header: 'Last Played',
      width: '20%',
      align: 'right',
      render: (playlist) => formatTimestamp(playlist.lastPlayedAt),
    },
  ]

  const scenarioColumns: DataTableColumn<ScenarioAnalytics>[] = [
    {
      id: 'scenario',
      header: 'Scenario',
      width: '30%',
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
      width: '12%',
      align: 'right',
      render: (scenario) => formatDuration(scenario.secondsLast30d),
    },
    {
      id: 'total',
      header: 'Total',
      width: '12%',
      align: 'right',
      render: (scenario) => formatDuration(scenario.totalSeconds),
    },
    {
      id: 'delta',
      header: 'Delta',
      width: '12%',
      align: 'right',
      render: (scenario) => formatDeltaPercent(scenario.deltaPct),
    },
    {
      id: 'lastPlayed',
      header: 'Last Played',
      width: '20%',
      align: 'right',
      render: (scenario) => formatTimestamp(scenario.lastPlayedAt),
    },
  ]

  return (
    <div className="view-shell">
      <div className="panel-grid-two breakdown-grid">
        <PanelCard>
          <SectionHeader
            title="Per Playlist Time"
            description="Current playlist files are used to infer total and recent time."
          />

          <input
            className="search-input"
            type="search"
            value={playlistQuery}
            onChange={(event) => onPlaylistQueryChange(event.target.value)}
            placeholder="Search playlists"
            aria-label="Search playlists"
          />

          {summary ? (
            <DataTable
              columns={playlistColumns}
              rows={filteredPlaylists}
              rowKey={(playlist) => playlist.name}
              emptyMessage="No matching playlists."
            />
          ) : (
            <EmptyState title="Loading playlist data..." description="Reading KovaaK stats CSV files." />
          )}
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Scenario Analytics"
            description="Search, filter, and drill into momentum, recency, and quality trends."
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
              aria-label="Filter scenarios by trend"
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
              aria-label="Filter scenarios by recent volume"
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
              aria-label="Filter scenarios by recency"
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
              aria-label="Sort scenarios"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {summary ? (
            <DataTable
              columns={scenarioColumns}
              rows={filteredScenarios}
              rowKey={(scenario) => scenario.scenarioName}
              emptyMessage="No scenarios match the current filters."
            />
          ) : (
            <EmptyState title="Loading scenario analytics..." description="Reading KovaaK stats CSV files." />
          )}
        </PanelCard>
      </div>

      <PanelCard>
        <SectionHeader
          title={selectedScenario?.scenarioName ?? 'Scenario Detail'}
          description={
            selectedScenario
              ? 'Recent volume, quality checkpoints, and the selected sparkline.'
              : 'Select a scenario from the analytics table to inspect it.'
          }
        />

        {selectedScenario ? (
          <>
            <div className="chip-grid">
              <div className="metric-chip">
                <span className="label">Last 7 days</span>
                <strong>{formatDuration(selectedScenario.secondsLast7d)}</strong>
                <span className="subtle">{selectedScenario.attemptsLast7d} runs</span>
              </div>
              <div className="metric-chip">
                <span className="label">Last 30 days</span>
                <strong>{formatDuration(selectedScenario.secondsLast30d)}</strong>
                <span className="subtle">{selectedScenario.attemptsLast30d} runs</span>
              </div>
              <div className="metric-chip">
                <span className="label">Last 90 days</span>
                <strong>{formatDuration(selectedScenario.secondsLast90d)}</strong>
                <span className="subtle">{selectedScenario.attemptsLast90d} runs</span>
              </div>
              <div className="metric-chip">
                <span className="label">Personal best</span>
                <strong>{formatQualityValue(selectedScenario.personalBest)}</strong>
                <span className="subtle">{formatTimestamp(selectedScenario.personalBestAt)}</span>
              </div>
              <div className="metric-chip">
                <span className="label">Latest quality</span>
                <strong>{formatQualityValue(selectedScenario.latestQualityValue)}</strong>
                <span className="subtle">
                  {selectedScenario.metricType ? formatMetricType(selectedScenario.metricType) : 'No quality metric'}
                </span>
              </div>
              <div className="metric-chip">
                <span className="label">Last played</span>
                <strong>{formatTimestamp(selectedScenario.lastPlayedAt)}</strong>
                <span className="subtle">{formatTrendStatus(selectedScenario.trendStatus)}</span>
              </div>
            </div>

            <div className="panel-grid-two detail-grid">
              <PanelCard className="nested-panel">
                <SectionHeader
                  title="Recent Quality Sparkline"
                  description={
                    selectedScenario.metricType
                      ? `${formatMetricType(selectedScenario.metricType)} checkpoints from recent runs.`
                      : 'Quality data appears after scored or accuracy-based runs are parsed.'
                  }
                />
                {selectedScenario.recentQualitySamples.length > 1 ? (
                  <QualitySparkline scenario={selectedScenario} />
                ) : (
                  <EmptyState
                    title="Not enough quality samples yet."
                    description="Play more scored scenarios to unlock a visible sparkline."
                  />
                )}
              </PanelCard>

              <PanelCard className="nested-panel">
                <SectionHeader title="Trend Snapshot" />
                <dl className="key-value-list">
                  <div>
                    <dt className="label">Trend status</dt>
                    <dd>{formatTrendStatus(selectedScenario.trendStatus)}</dd>
                  </div>
                  <div>
                    <dt className="label">30d delta</dt>
                    <dd>{formatDeltaPercent(selectedScenario.deltaPct)}</dd>
                  </div>
                  <div>
                    <dt className="label">Tracked metric</dt>
                    <dd>{selectedScenario.metricType ? formatMetricType(selectedScenario.metricType) : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt className="label">Total runs</dt>
                    <dd>{selectedScenario.attemptCount}</dd>
                  </div>
                </dl>
              </PanelCard>
            </div>
          </>
        ) : (
          <EmptyState
            title="No scenario selected."
            description="Adjust filters or pick a scenario from the analytics table."
          />
        )}
      </PanelCard>
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
        <defs>
          <linearGradient id="sparkline-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(125, 211, 252, 0.9)" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0.12)" />
          </linearGradient>
        </defs>
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

export default BreakdownsView
