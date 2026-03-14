import EmptyState from '../components/primitives/EmptyState'
import MetricChip from '../components/primitives/MetricChip'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  formatDateLabel,
  formatDeltaPercent,
  formatDuration,
  formatRecommendationReason,
  formatTimestamp,
} from '../playtime-utils'
import {
  type DailyPlaytime,
  type FocusPreset,
  type FocusPresetId,
  type GoalProgress,
  type PersonalBestTimelineEntry,
  type PlaytimeSummary,
  type ReadinessSummary,
  type SessionRecap,
  type StatsOverview,
  type UserSettings,
} from '../types'

type TodayViewProps = {
  summary: PlaytimeSummary | null
  trackedOverview: StatsOverview | null
  settings: UserSettings | null
  selectedDay: DailyPlaytime
  sessionRecap: SessionRecap
  goalProgress: GoalProgress[]
  readinessSummary: ReadinessSummary
  personalBestTimeline: PersonalBestTimelineEntry[]
  focusPresets: FocusPreset[]
  activeFocusPreset: FocusPresetId
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
  selectedDay,
  sessionRecap,
  goalProgress,
  readinessSummary,
  personalBestTimeline,
  focusPresets,
  activeFocusPreset,
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
  const activeSessionSeconds =
    trackedOverview?.activeSession.isTracking && trackedOverview.activeSession.startedAt
      ? Math.max(0, Math.floor(Date.now() / 1000) - trackedOverview.activeSession.startedAt)
      : 0
  const nextRecommendation = summary.progressCoach.recommendations[0]
  const onboardingIncomplete =
    !summary.progressCoach.hasQualityData ||
    !trackedOverview?.diagnostics.sessionFileExists ||
    (trackedOverview?.scenarios.length ?? 0) === 0

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

        <div className="chip-grid">
          <MetricChip label="Tracked playtime" value={formatDuration(summary.totalSeconds)} />
          <MetricChip label="Current streak" value={`${summary.consistency.currentStreakDays} days`} />
          <MetricChip label="Last 7 days" value={formatDuration(recent7dSeconds)} />
          <MetricChip label="Last 30 days" value={formatDuration(recent30dSeconds)} />
          <MetricChip
            label="Live session"
            value={
              trackedOverview?.activeSession.isTracking
                ? `${formatDuration(activeSessionSeconds)} live`
                : 'Idle'
            }
            tone={trackedOverview?.activeSession.isTracking ? 'improving' : 'default'}
          />
          <MetricChip label="Last attempt" value={formatTimestamp(summary.lastAttemptAt)} />
        </div>
      </PanelCard>

      {onboardingIncomplete ? (
        <PanelCard>
          <SectionHeader
            title="First-Run Progress"
            description="Use this checklist to finish the setup path from raw files to live coaching."
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
            title="Daily Status"
            description={`Selected day: ${formatDateLabel(selectedDay.dateKey)}`}
          />
          <div className="chip-grid">
            <MetricChip label="Playtime" value={formatDuration(selectedDay.totalSeconds)} />
            <MetricChip label="Runs" value={selectedDay.attemptCount} />
            <MetricChip label="Playlists" value={selectedDay.playlists.length} />
            <MetricChip
              label="Recent PBs"
              value={summary.highlights.recentPersonalBests7d}
              tone="improving"
            />
          </div>

          <dl className="key-value-list">
            <div>
              <dt className="label">Stats folder</dt>
              <dd className="mono">{summary.sourcePath}</dd>
            </div>
            <div>
              <dt className="label">Detected session file</dt>
              <dd className="mono">{trackedOverview?.diagnostics.sessionPath || 'Not available yet'}</dd>
            </div>
            <div>
              <dt className="label">File quality</dt>
              <dd>{summary.progressCoach.hasQualityData ? 'Score and accuracy samples found' : 'Time-only data so far'}</dd>
            </div>
          </dl>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Momentum"
            description="Trend balance and what the coach thinks you should attack next."
          />
          <div className="chip-grid">
            <MetricChip label="Improving" value={summary.progressCoach.improvingCount} tone="improving" />
            <MetricChip label="Flat" value={summary.progressCoach.flatCount} tone="flat" />
            <MetricChip label="Declining" value={summary.progressCoach.decliningCount} tone="declining" />
            <MetricChip label="Insufficient" value={summary.progressCoach.insufficientDataCount} tone="insufficient" />
          </div>

          {nextRecommendation ? (
            <div className="recommendation-explainer">
              <strong>{nextRecommendation.scenarioName}</strong>
              <p className="subtle">{nextRecommendation.note}</p>
              <div className="chip-grid compact-chip-grid">
                <MetricChip label="Reason" value={formatRecommendationReason(nextRecommendation.reason)} />
                <MetricChip
                  label="30d delta"
                  value={formatDeltaPercent(nextRecommendation.reasonStats.deltaPct)}
                  tone={nextRecommendation.reason === 'declining' ? 'declining' : 'default'}
                />
                <MetricChip
                  label="Recent load"
                  value={`${formatDuration(nextRecommendation.reasonStats.secondsLast7d)} / ${formatDuration(
                    nextRecommendation.reasonStats.secondsLast30d,
                  )}`}
                />
                <MetricChip label="Confidence" value={`${Math.round(nextRecommendation.confidence * 100)}%`} />
              </div>
            </div>
          ) : (
            <EmptyState
              title="No coach recommendation yet."
              description="More runs unlock better prioritization and sharper explanations."
            />
          )}
        </PanelCard>
      </div>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Today's 20-Minute Plan"
            description="Four focused blocks ranked from decline severity, undertraining, and recency."
          />

          {summary.progressCoach.recommendations.length > 0 ? (
            <ol className="coach-plan">
              {summary.progressCoach.recommendations.map((recommendation) => (
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

        <PanelCard>
          <SectionHeader
            title="Readiness & Workload"
            description="Compare 7d load vs 30d baseline and check whether your recent rotation is too narrow."
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
              label="Diversity"
              value={`${Math.round(readinessSummary.diversityRatio * 100)}%`}
              tone={readinessSummary.narrowTrainingWarning ? 'declining' : 'improving'}
            />
          </div>
          <p className="subtle">{readinessSummary.message}</p>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Goal Tracking"
            description="Weekly targets are stored locally and persist across refreshes."
          />
          <div className="goal-list">
            {goalProgress.map((goal) => (
              <div key={goal.id} className="goal-item">
                <div className="goal-item-head">
                  <strong>{goal.label}</strong>
                  <span className="subtle">
                    {goal.current} / {goal.target} {goal.unit}
                  </span>
                </div>
                <div className="goal-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(6, Math.round(goal.progress * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </PanelCard>
      </div>

      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Focus Presets"
            description="Saved one-click filters for the practice and analysis workspaces."
          />
          <div className="preset-grid">
            {focusPresets.map((preset) => {
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
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Recent Personal Bests"
            description="Most recent PB checkpoints detected from your historical quality metrics."
          />
          <div className="goal-list">
            {personalBestTimeline.length > 0 ? (
              personalBestTimeline.slice(0, 5).map((entry) => (
                <div key={`${entry.scenarioName}-${entry.personalBestAt}`} className="goal-item">
                  <div className="goal-item-head">
                    <strong>{entry.scenarioName}</strong>
                    <span className="subtle">{formatTimestamp(entry.personalBestAt)}</span>
                  </div>
                  <span className="subtle">PB {entry.personalBest}</span>
                </div>
              ))
            ) : (
              <EmptyState title="No PB timeline yet." description="Quality metrics will unlock this feed." />
            )}
          </div>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Session Recap"
            description={`Recap for ${formatDateLabel(sessionRecap.dateKey)}`}
          />
          <dl className="key-value-list">
            <div>
              <dt className="label">Top scenarios</dt>
              <dd>{sessionRecap.topScenarioNames.join(', ') || 'No runs recorded'}</dd>
            </div>
            <div>
              <dt className="label">Personal bests</dt>
              <dd>{sessionRecap.personalBestScenarioNames.join(', ') || 'No PBs on this day'}</dd>
            </div>
            <div>
              <dt className="label">Watch list</dt>
              <dd>{sessionRecap.decliningScenarioNames.join(', ') || 'No declining scenarios played'}</dd>
            </div>
            <div>
              <dt className="label">Next suggestions</dt>
              <dd>{sessionRecap.suggestedNextScenarioNames.join(', ') || 'No suggestion yet'}</dd>
            </div>
          </dl>
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

export default TodayView
