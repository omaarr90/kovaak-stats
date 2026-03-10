import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import { formatDateLabel, formatDuration, formatTimestamp } from '../playtime-utils'
import { type DailyPlaytime, type PlaytimeSummary } from '../types'

type OverviewViewProps = {
  summary: PlaytimeSummary | null
  selectedDay: DailyPlaytime
  statusMessage: string
}

const PLAYLIST_COLUMNS: DataTableColumn<PlaytimeSummary['playlists'][number]>[] = [
  {
    id: 'name',
    header: 'Playlist',
    width: '62%',
    truncate: true,
    render: (playlist) => playlist.name,
    title: (playlist) => playlist.name,
  },
  {
    id: 'time',
    header: 'Time',
    width: '38%',
    align: 'right',
    render: (playlist) => formatDuration(playlist.totalSeconds),
  },
]

const SCENARIO_COLUMNS: DataTableColumn<PlaytimeSummary['scenarios'][number]>[] = [
  {
    id: 'name',
    header: 'Scenario',
    width: '62%',
    truncate: true,
    render: (scenario) => scenario.name,
    title: (scenario) => scenario.name,
  },
  {
    id: 'time',
    header: 'Time',
    width: '38%',
    align: 'right',
    render: (scenario) => formatDuration(scenario.totalSeconds),
  },
]

function secondsInRecentWindow(summary: PlaytimeSummary, days: number): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const startTimestamp = start.getTime()

  return summary.dailySummaries.reduce((total, day) => {
    const timestamp = new Date(`${day.dateKey}T00:00:00`).getTime()
    return timestamp >= startTimestamp ? total + day.totalSeconds : total
  }, 0)
}

function OverviewView({ summary, selectedDay, statusMessage }: OverviewViewProps) {
  const recent7dSeconds = summary ? secondsInRecentWindow(summary, 7) : 0
  const recent30dSeconds = summary ? secondsInRecentWindow(summary, 30) : 0
  const topPlaylists = summary
    ? [...summary.playlists].sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 5)
    : []
  const topScenarios = summary
    ? [...summary.scenarios].sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 5)
    : []

  return (
    <div className="view-shell">
      <PanelCard className="hero-panel">
        <SectionHeader
          eyebrow="Actual KovaaK Playtime"
          title={summary ? formatDuration(summary.totalSeconds) : '--'}
          description={
            summary
              ? `${formatDuration(summary.totalSeconds)} summed from KovaaK stats CSV files`
              : 'Reading KovaaK stats CSV files'
          }
        />

        <div className="chip-grid">
          <MetricChip
            label="Tracked runs"
            value={summary ? `${summary.attemptCount} CSV files` : 'Loading...'}
          />
          <MetricChip
            label="Scenarios"
            value={summary ? summary.scenarios.length : '--'}
          />
          <MetricChip
            label="Playlists"
            value={summary ? summary.playlists.length : '--'}
          />
          <MetricChip
            label="Last attempt"
            value={summary ? formatTimestamp(summary.lastAttemptAt) : 'Loading...'}
          />
          <MetricChip
            label="Last 7 days"
            value={summary ? formatDuration(recent7dSeconds) : '--'}
          />
          <MetricChip
            label="Last 30 days"
            value={summary ? formatDuration(recent30dSeconds) : '--'}
          />
        </div>
      </PanelCard>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader title="Tracking Details" />
          <dl className="key-value-list">
            <div>
              <dt className="label">Source folder</dt>
              <dd className="mono">{summary?.sourcePath ?? 'Looking for KovaaK stats folder...'}</dd>
            </div>
            <div>
              <dt className="label">Skipped files</dt>
              <dd>{summary ? summary.skippedFiles : '--'}</dd>
            </div>
            <div>
              <dt className="label">Quality data</dt>
              <dd>{summary ? (summary.progressCoach.hasQualityData ? 'Available' : 'Not found yet') : '--'}</dd>
            </div>
          </dl>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Selected Day Snapshot"
            description="A quick summary of the currently selected calendar day."
          />
          <dl className="key-value-list">
            <div>
              <dt className="label">Date</dt>
              <dd>{formatDateLabel(selectedDay.dateKey)}</dd>
            </div>
            <div>
              <dt className="label">Playtime</dt>
              <dd>{formatDuration(selectedDay.totalSeconds)}</dd>
            </div>
            <div>
              <dt className="label">Runs</dt>
              <dd>{selectedDay.attemptCount}</dd>
            </div>
            <div>
              <dt className="label">Playlists matched</dt>
              <dd>{selectedDay.playlists.length}</dd>
            </div>
          </dl>
        </PanelCard>
      </div>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Top Playlists"
            description="Highest total playtime across all parsed runs."
          />
          {summary ? (
            <DataTable
              columns={PLAYLIST_COLUMNS}
              rows={topPlaylists}
              rowKey={(playlist) => playlist.name}
              emptyMessage="No playlist data found."
            />
          ) : (
            <EmptyState title="Loading playlist summary..." description="Reading KovaaK stats CSV files." />
          )}
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Top Scenarios"
            description="Most-played scenarios by total time."
          />
          {summary ? (
            <DataTable
              columns={SCENARIO_COLUMNS}
              rows={topScenarios}
              rowKey={(scenario) => scenario.name}
              emptyMessage="No scenario data found."
            />
          ) : (
            <EmptyState title="Loading scenario summary..." description="Reading KovaaK stats CSV files." />
          )}
        </PanelCard>
      </div>

      {statusMessage ? (
        <PanelCard className="error-panel">
          <SectionHeader title="Read Error" description={statusMessage} />
        </PanelCard>
      ) : null}
    </div>
  )
}

export default OverviewView
