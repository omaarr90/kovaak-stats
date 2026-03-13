import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  formatDateLabel,
  formatDeltaPercent,
  formatDuration,
  formatTimestamp,
} from '../playtime-utils'
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

const SCENARIO_COLUMNS: DataTableColumn<PlaytimeSummary['scenarioAnalytics'][number]>[] = [
  {
    id: 'name',
    header: 'Scenario',
    width: '50%',
    truncate: true,
    render: (scenario) => scenario.scenarioName,
    title: (scenario) => scenario.scenarioName,
  },
  {
    id: 'time',
    header: 'Time',
    width: '20%',
    align: 'right',
    render: (scenario) => formatDuration(scenario.totalSeconds),
  },
  {
    id: 'delta',
    header: 'Delta',
    width: '30%',
    align: 'right',
    render: (scenario) => formatDeltaPercent(scenario.deltaPct),
  },
]

function OverviewView({ summary, selectedDay, statusMessage }: OverviewViewProps) {
  const recent7dSeconds = summary ? summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast7d, 0) : 0
  const recent30dSeconds = summary
    ? summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast30d, 0)
    : 0
  const topPlaylists = summary ? [...summary.playlists].slice(0, 5) : []
  const topScenarios = summary ? [...summary.scenarioAnalytics].slice(0, 5) : []
  const weeklyActivity = summary ? buildWeeklyActivity(summary.dailySummaries) : []

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
          <MetricChip label="Tracked runs" value={summary ? `${summary.attemptCount} CSV files` : 'Loading...'} />
          <MetricChip label="Scenarios" value={summary ? summary.scenarioAnalytics.length : '--'} />
          <MetricChip label="Playlists" value={summary ? summary.playlists.length : '--'} />
          <MetricChip label="Last attempt" value={summary ? formatTimestamp(summary.lastAttemptAt) : 'Loading...'} />
          <MetricChip label="Last 7 days" value={summary ? formatDuration(recent7dSeconds) : '--'} />
          <MetricChip label="Last 30 days" value={summary ? formatDuration(recent30dSeconds) : '--'} />
        </div>
      </PanelCard>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader title="Consistency" description="Daily play cadence across recent weeks." />
          <div className="chip-grid">
            <MetricChip label="Current streak" value={summary ? `${summary.consistency.currentStreakDays} days` : '--'} />
            <MetricChip label="Longest streak" value={summary ? `${summary.consistency.longestStreakDays} days` : '--'} />
            <MetricChip label="Active days (7d)" value={summary ? summary.consistency.activeDays7d : '--'} />
            <MetricChip label="Active days (30d)" value={summary ? summary.consistency.activeDays30d : '--'} />
            <MetricChip label="Best week" value={summary ? formatDuration(summary.consistency.bestWeekSeconds) : '--'} />
          </div>
        </PanelCard>

        <PanelCard>
          <SectionHeader title="Momentum" description="Trend counts plus the strongest recent movers." />
          <div className="chip-grid">
            <MetricChip label="Improving" value={summary ? summary.progressCoach.improvingCount : '--'} tone="improving" />
            <MetricChip label="Flat" value={summary ? summary.progressCoach.flatCount : '--'} tone="flat" />
            <MetricChip label="Declining" value={summary ? summary.progressCoach.decliningCount : '--'} tone="declining" />
            <MetricChip
              label="Recent PBs (7d)"
              value={summary ? summary.highlights.recentPersonalBests7d : '--'}
              tone="improving"
            />
          </div>
          {summary ? (
            <div className="highlight-grid">
              <div className="highlight-list">
                <p className="label">Top improvers</p>
                {summary.highlights.topImprovers.length > 0 ? (
                  summary.highlights.topImprovers.map((highlight) => (
                    <div key={highlight.scenarioName} className="highlight-item">
                      <span className="cell-truncate" title={highlight.scenarioName}>
                        {highlight.scenarioName}
                      </span>
                      <strong>{formatDeltaPercent(highlight.deltaPct)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="subtle">No improving scenarios yet.</p>
                )}
              </div>
              <div className="highlight-list">
                <p className="label">Top decliners</p>
                {summary.highlights.topDecliners.length > 0 ? (
                  summary.highlights.topDecliners.map((highlight) => (
                    <div key={highlight.scenarioName} className="highlight-item">
                      <span className="cell-truncate" title={highlight.scenarioName}>
                        {highlight.scenarioName}
                      </span>
                      <strong>{formatDeltaPercent(highlight.deltaPct)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="subtle">No declining scenarios yet.</p>
                )}
              </div>
            </div>
          ) : null}
        </PanelCard>
      </div>

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

      <PanelCard>
        <SectionHeader
          title="12-Week Activity Strip"
          description="Weekly totals from the last twelve calendar weeks."
        />
        {summary ? <WeeklyActivityStrip weeks={weeklyActivity} /> : null}
      </PanelCard>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader title="Top Playlists" description="Highest total playtime across all parsed runs." />
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
          <SectionHeader title="Top Scenarios" description="Most-played scenarios by total time and trend." />
          {summary ? (
            <DataTable
              columns={SCENARIO_COLUMNS}
              rows={topScenarios}
              rowKey={(scenario) => scenario.scenarioName}
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

function WeeklyActivityStrip({
  weeks,
}: {
  weeks: { label: string; totalSeconds: number }[]
}) {
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

function buildWeeklyActivity(dailySummaries: PlaytimeSummary['dailySummaries']) {
  const weekTotals = new Map<string, number>()
  const now = new Date()
  const endOfWeek = new Date(now)
  endOfWeek.setHours(0, 0, 0, 0)
  endOfWeek.setDate(endOfWeek.getDate() - endOfWeek.getDay())

  for (let index = 0; index < 12; index += 1) {
    const weekStart = new Date(endOfWeek)
    weekStart.setDate(endOfWeek.getDate() - (11 - index) * 7)
    const key = toLocalDateKey(weekStart)
    weekTotals.set(key, 0)
  }

  for (const day of dailySummaries) {
    const date = new Date(`${day.dateKey}T00:00:00`)
    date.setDate(date.getDate() - date.getDay())
    const weekKey = toLocalDateKey(date)
    if (weekTotals.has(weekKey)) {
      weekTotals.set(weekKey, (weekTotals.get(weekKey) ?? 0) + day.totalSeconds)
    }
  }

  return [...weekTotals.entries()].map(([dateKey, totalSeconds]) => {
    const date = new Date(`${dateKey}T00:00:00`)
    return {
      label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
      totalSeconds,
    }
  })
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default OverviewView
