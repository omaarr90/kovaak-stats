import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  formatDeltaPercent,
  formatDuration,
  formatRecommendationReason,
  formatTimestamp,
} from '../playtime-utils'
import {
  type FocusPresetId,
  type PlaytimeSummary,
  type ReadinessSummary,
  type StatsOverview,
  type UserSettings,
} from '../types'

type TodayViewProps = {
  summary: PlaytimeSummary | null
  trackedOverview: StatsOverview | null
  settings: UserSettings | null
  readinessSummary: ReadinessSummary
  statusMessage: string
  onOpenPractice: () => void
  onOpenAnalysis: () => void
  onOpenSettings: () => void
  onActivateFocusPreset: (presetId: FocusPresetId) => void
}

function TodayView({
  summary,
  trackedOverview,
  settings,
  readinessSummary,
  statusMessage,
  onOpenPractice,
  onOpenAnalysis,
  onOpenSettings,
  onActivateFocusPreset,
}: TodayViewProps) {
  if (!summary) {
    return (
      <div className="view-shell">
        <PanelCard className="hero-panel">
          <SectionHeader
            eyebrow="Coach First"
            title="No historical sessions loaded yet"
            description="This app reads KovaaK CSV files directly, then turns them into daily coaching and drill-down analysis."
            actions={
              <div className="hero-actions">
                <button className="btn" type="button" onClick={onOpenAnalysis}>
                  Open analysis workspace
                </button>
                <button className="btn btn-secondary" type="button" onClick={onOpenSettings}>
                  Open settings
                </button>
              </div>
            }
          />

          <div className="chip-grid">
            <MetricChip label="Session file" value={trackedOverview?.diagnostics.sessionPath || settings?.sessionPathOverride || 'Auto-detect'} />
            <MetricChip label="Auto refresh" value={`${settings?.refreshIntervalSeconds ?? 60}s`} />
            <MetricChip label="Start with Windows" value={settings?.startWithWindows ? 'Enabled' : 'Disabled'} />
          </div>

          <EmptyState
            title="Complete a KovaaK run, then refresh."
            description={
              statusMessage ||
              'If you already have stats files, check the detected Steam library path and session file path in Settings.'
            }
          />

          <div className="goal-list">
            <div className="goal-item">
              <div className="goal-item-head">
                <strong>First-run checklist</strong>
                <span className="subtle">Status</span>
              </div>
              <dl className="key-value-list">
                <div>
                  <dt className="label">Session file detected</dt>
                  <dd>{trackedOverview?.diagnostics.sessionFileExists ? 'Ready' : 'Check Settings'}</dd>
                </div>
                <div>
                  <dt className="label">Historical CSVs parsed</dt>
                  <dd>{statusMessage ? 'Not yet' : 'Refresh after a completed run'}</dd>
                </div>
                <div>
                  <dt className="label">Live tracker</dt>
                  <dd>{trackedOverview?.diagnostics.isKovaakRunning ? 'Running now' : 'Waiting for KovaaK process'}</dd>
                </div>
              </dl>
            </div>
          </div>
        </PanelCard>
      </div>
    )
  }

  const recent7dSeconds = summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast7d, 0)
  const recent30dSeconds = summary.scenarioAnalytics.reduce((total, scenario) => total + scenario.secondsLast30d, 0)
  const nextRecommendation = summary.progressCoach.recommendations[0]
  const planSteps = summary.progressCoach.recommendations.slice(0, 4)
  const topDecliners = summary.highlights.topDecliners.slice(0, 3)
  const onboardingIncomplete =
    !summary.progressCoach.hasQualityData ||
    !trackedOverview?.diagnostics.sessionFileExists ||
    (trackedOverview?.scenarios.length ?? 0) === 0
  const readinessTone =
    readinessSummary.status === 'overloaded'
      ? 'declining'
      : readinessSummary.status === 'balanced'
        ? 'improving'
        : 'flat'
  const liveSessionValue = trackedOverview?.activeSession.isTracking
    ? 'Live now'
    : 'Idle'
  const liveSessionTone = trackedOverview?.activeSession.isTracking ? 'improving' : 'default'

  return (
    <div className="view-shell">
      <PanelCard className="hero-panel">
        <SectionHeader
          eyebrow="Today"
          title={nextRecommendation ? `Next block: ${nextRecommendation.scenarioName}` : 'Performance dashboard'}
          description={
            nextRecommendation
              ? nextRecommendation.note
              : 'Your latest session history is loaded and ready for drill-down.'
          }
          actions={
            <div className="hero-actions">
              <button className="btn" type="button" onClick={onOpenPractice}>
                Start 20-minute plan
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  onActivateFocusPreset('declining')
                  onOpenAnalysis()
                }}
              >
                Review at-risk scenarios
              </button>
            </div>
          }
        />

        <div className="chip-grid compact-chip-grid">
          <MetricChip
            label="Priority"
            value={nextRecommendation ? formatRecommendationReason(nextRecommendation.reason) : readinessSummary.status}
            tone={nextRecommendation?.reason === 'declining' ? 'declining' : 'flat'}
          />
          <MetricChip
            label="30d delta"
            value={nextRecommendation ? formatDeltaPercent(nextRecommendation.reasonStats.deltaPct) : '--'}
            tone={nextRecommendation?.reason === 'declining' ? 'declining' : 'default'}
          />
          <MetricChip
            label="Last played"
            value={nextRecommendation ? `${nextRecommendation.reasonStats.daysSinceLastPlayed}d ago` : formatTimestamp(summary.lastAttemptAt)}
          />
          <MetricChip label="Live session" value={liveSessionValue} tone={liveSessionTone} />
        </div>
      </PanelCard>

      {onboardingIncomplete ? (
        <PanelCard>
          <SectionHeader
            title="First-Run Progress"
            description="Finish these blockers once, then the home page stays focused on what to practice next."
            actions={
              <button className="btn btn-secondary" type="button" onClick={onOpenSettings}>
                Review settings
              </button>
            }
          />
          <div className="onboarding-grid">
            <div className="goal-item">
              <div className="goal-item-head">
                <strong>Historical CSVs</strong>
                <span className="subtle">{summary.attemptCount} parsed</span>
              </div>
              <p className="subtle">Source: {summary.sourcePath}</p>
            </div>
            <div className="goal-item">
              <div className="goal-item-head">
                <strong>Quality samples</strong>
                <span className="subtle">{summary.progressCoach.hasQualityData ? 'Ready' : 'Still locked'}</span>
              </div>
              <p className="subtle">
                {summary.progressCoach.hasQualityData
                  ? 'Score and accuracy samples are available.'
                  : 'Play scored or accuracy-based scenarios to unlock trend quality.'}
              </p>
            </div>
            <div className="goal-item">
              <div className="goal-item-head">
                <strong>Live tracker</strong>
                <span className="subtle">{trackedOverview?.diagnostics.sessionFileExists ? 'Ready' : 'Needs session path'}</span>
              </div>
              <p className="subtle">
                {trackedOverview?.diagnostics.sessionFileExists
                  ? 'Session file is detected and ready for live tracking.'
                  : 'Verify the detected session path in Settings.'}
              </p>
            </div>
          </div>
        </PanelCard>
      ) : null}

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Session Status"
            description="A quick read on volume and whether the live tracker is ready."
            actions={
              !trackedOverview?.diagnostics.sessionFileExists ? (
                <button className="btn btn-secondary" type="button" onClick={onOpenSettings}>
                  Fix tracking
                </button>
              ) : null
            }
          />
          <div className="chip-grid compact-chip-grid">
            <MetricChip label="Tracked playtime" value={formatDuration(summary.totalSeconds)} />
            <MetricChip label="Current streak" value={`${summary.consistency.currentStreakDays} days`} />
            <MetricChip label="Last 7 days" value={formatDuration(recent7dSeconds)} />
            <MetricChip label="Last 30 days" value={formatDuration(recent30dSeconds)} />
          </div>

          <p className="subtle">
            {trackedOverview?.activeSession.isTracking
              ? `${trackedOverview.activeSession.scenarioName || 'Current scenario'} is live right now.`
              : trackedOverview?.diagnostics.sessionFileExists
                ? 'Tracker is connected and waiting for the next KovaaK session.'
                : 'Live tracking still needs a valid session file path.'}
          </p>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Focus Signals"
            description={readinessSummary.message}
            actions={
              <button className="btn btn-secondary" type="button" onClick={onOpenAnalysis}>
                Open analysis
              </button>
            }
          />
          <div className="chip-grid compact-chip-grid">
            <MetricChip label="Readiness" value={readinessSummary.status} tone={readinessTone} />
            <MetricChip label="Declining" value={summary.progressCoach.decliningCount} tone="declining" />
            <MetricChip label="Insufficient" value={summary.progressCoach.insufficientDataCount} tone="insufficient" />
            <MetricChip label="Recent PBs" value={summary.highlights.recentPersonalBests7d} tone="improving" />
          </div>

          {topDecliners.length > 0 ? (
            <div className="goal-list">
              {topDecliners.map((scenario) => (
                <div key={scenario.scenarioName} className="goal-item">
                  <div className="goal-item-head">
                    <strong className="cell-truncate" title={scenario.scenarioName}>
                      {scenario.scenarioName}
                    </strong>
                    <span className="subtle">{formatDeltaPercent(scenario.deltaPct)}</span>
                  </div>
                  <span className="subtle">Recent quality has slipped enough to merit attention.</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No immediate red flags."
              description="Keep building quality data and use Analysis when you want the deeper breakdown."
            />
          )}
        </PanelCard>
      </div>

      <PanelCard>
        <SectionHeader
          title="Today's Plan"
          description="Use this as the default block, then switch to Practice if you want to change duration or focus."
          actions={
            <button className="btn btn-secondary" type="button" onClick={onOpenPractice}>
              Customize plan
            </button>
          }
        />

        {planSteps.length > 0 ? (
          <ol className="coach-plan">
            {planSteps.map((recommendation) => (
              <li key={recommendation.scenarioName} className="coach-plan-item detailed-plan-item">
                <div className="coach-plan-head">
                  <strong className="cell-truncate" title={recommendation.scenarioName}>
                    {recommendation.scenarioName}
                  </strong>
                  <span className="coach-plan-minutes">{recommendation.minutes}m</span>
                </div>
                <div className="coach-plan-meta">
                  <span className="coach-plan-tag">{formatRecommendationReason(recommendation.reason)}</span>
                  <span className="subtle">{formatDeltaPercent(recommendation.reasonStats.deltaPct)}</span>
                  <span className="subtle">{recommendation.reasonStats.daysSinceLastPlayed}d since played</span>
                </div>
                <span className="subtle">{recommendation.note}</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="No recommendations yet."
            description="Complete more scenarios to unlock a ranked practice block."
          />
        )}
      </PanelCard>

      {statusMessage ? (
        <PanelCard className="error-panel">
          <SectionHeader title="Read Error" description={statusMessage} />
        </PanelCard>
      ) : null}
    </div>
  )
}

export default TodayView
