import { useMemo, useState } from 'react'
import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  formatDeltaPercent,
  formatMetricType,
  formatQualityValue,
  formatRecommendationReason,
  formatTrendStatus,
} from '../playtime-utils'
import { type PlaytimeSummary } from '../types'

type CoachViewProps = {
  summary: PlaytimeSummary | null
}

type CoachTrendFilter = 'all' | 'improving' | 'flat' | 'declining'

const TREND_FILTER_OPTIONS: { id: CoachTrendFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'improving', label: 'Improving' },
  { id: 'flat', label: 'Flat' },
  { id: 'declining', label: 'Declining' },
]

const TREND_COLUMNS: DataTableColumn<PlaytimeSummary['progressCoach']['scenarioTrends'][number]>[] = [
  {
    id: 'scenario',
    header: 'Scenario',
    width: '32%',
    truncate: true,
    render: (trend) => trend.scenarioName,
    title: (trend) => trend.scenarioName,
  },
  {
    id: 'metric',
    header: 'Metric',
    width: '12%',
    render: (trend) => formatMetricType(trend.metricType),
  },
  {
    id: 'pb',
    header: 'PB',
    width: '10%',
    align: 'right',
    render: (trend) => formatQualityValue(trend.personalBest),
  },
  {
    id: 'avg7',
    header: '7d Avg',
    width: '10%',
    align: 'right',
    render: (trend) => formatQualityValue(trend.avg7d),
  },
  {
    id: 'avg30',
    header: '30d Avg',
    width: '10%',
    align: 'right',
    render: (trend) => formatQualityValue(trend.avg30d),
  },
  {
    id: 'delta',
    header: 'Delta',
    width: '10%',
    align: 'right',
    render: (trend) => formatDeltaPercent(trend.deltaPct),
  },
  {
    id: 'status',
    header: 'Status',
    width: '16%',
    render: (trend) => <span className={`status-pill ${trend.status}`}>{formatTrendStatus(trend.status)}</span>,
  },
]

function CoachView({ summary }: CoachViewProps) {
  const [trendFilter, setTrendFilter] = useState<CoachTrendFilter>('all')
  const filteredTrends = useMemo(() => {
    if (!summary) {
      return []
    }

    const trendsWithoutInsufficient = summary.progressCoach.scenarioTrends.filter(
      (trend) => trend.status !== 'insufficientData',
    )
    if (trendFilter === 'all') {
      return trendsWithoutInsufficient
    }
    return trendsWithoutInsufficient.filter((trend) => trend.status === trendFilter)
  }, [summary, trendFilter])

  if (!summary) {
    return (
      <div className="view-shell">
        <PanelCard>
          <SectionHeader title="Progress Coach" />
          <EmptyState title="Loading coach metrics..." description="Reading KovaaK stats CSV files." />
        </PanelCard>
      </div>
    )
  }

  if (!summary.progressCoach.hasQualityData) {
    return (
      <div className="view-shell">
        <PanelCard>
          <SectionHeader
            title="Progress Coach"
            description="Quality trends from score and accuracy values parsed from KovaaK stats CSV files."
          />
          <EmptyState
            title="No quality metrics parsed yet."
            description="Play scored scenarios and refresh. Progress Coach appears once score or accuracy values are found."
          />
        </PanelCard>
      </div>
    )
  }

  return (
    <div className="view-shell">
      <PanelCard>
        <SectionHeader
          title="Progress Coach"
          description="Quality trends from score and accuracy metrics parsed from KovaaK stats CSV files."
        />

        <div className="chip-grid coach-chip-grid">
          <MetricChip label="Improving" value={summary.progressCoach.improvingCount} tone="improving" />
          <MetricChip label="Flat" value={summary.progressCoach.flatCount} tone="flat" />
          <MetricChip label="Declining" value={summary.progressCoach.decliningCount} tone="declining" />
          <MetricChip
            label="Insufficient Data"
            value={summary.progressCoach.insufficientDataCount}
            tone="insufficient"
          />
        </div>
      </PanelCard>

      <div className="panel-grid-two coach-grid">
        <PanelCard>
          <SectionHeader
            title="Scenario Quality Trends"
            actions={
              <div className="coach-filter-row" role="group" aria-label="Filter trends by status">
                {TREND_FILTER_OPTIONS.map((option) => {
                  const isActive = trendFilter === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`coach-filter-button${isActive ? ' is-active' : ''}`}
                      onClick={() => setTrendFilter(option.id)}
                      aria-pressed={isActive}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            }
          />
          <DataTable
            columns={TREND_COLUMNS}
            rows={filteredTrends}
            rowKey={(trend) => `${trend.scenarioName}-${trend.metricType}`}
            emptyMessage="No trends found for the selected filter."
          />
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Today's 20-Minute Plan"
            description="Four focused blocks of 5 minutes each, prioritized by decline risk and under-training."
          />

          {summary.progressCoach.recommendations.length > 0 ? (
            <ol className="coach-plan">
              {summary.progressCoach.recommendations.map((recommendation, index) => (
                <li key={`${recommendation.scenarioName}-${index}`} className="coach-plan-item">
                  <div className="coach-plan-head">
                    <strong className="cell-truncate" title={recommendation.scenarioName}>
                      {recommendation.scenarioName}
                    </strong>
                    <span className="coach-plan-minutes">{recommendation.minutes}m</span>
                  </div>
                  <span className="coach-plan-tag">
                    {formatRecommendationReason(recommendation.reason)}
                  </span>
                  <span className="subtle">{recommendation.note}</span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No recommendations yet."
              description="Keep playing scored scenarios to unlock a daily plan."
            />
          )}
        </PanelCard>
      </div>
    </div>
  )
}

export default CoachView
