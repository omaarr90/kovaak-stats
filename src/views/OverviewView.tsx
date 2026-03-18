import { type CSSProperties } from 'react'
import EmptyState from '../components/primitives/EmptyState'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import {
  WEEKDAY_LABELS,
  formatCompactDuration,
  formatDateLabel,
  formatDuration,
  formatMonthLabel,
} from '../playtime-utils'
import { type CalendarCell, type PlaytimeSummary } from '../types'

type OverviewViewProps = {
  summary: PlaytimeSummary | null
  statusMessage: string
  hasCalendarRange: boolean
  activeMonthKey: string
  canGoPrevious: boolean
  canGoNext: boolean
  calendarCells: CalendarCell[]
  effectiveSelectedDateKey: string
  visibleMonthPeakSeconds: number
  onMonthChange: (offset: number) => void
  onSelectDate: (dateKey: string) => void
  onOpenSettings: () => void
}

function OverviewView({
  summary,
  statusMessage,
  hasCalendarRange,
  activeMonthKey,
  canGoPrevious,
  canGoNext,
  calendarCells,
  effectiveSelectedDateKey,
  visibleMonthPeakSeconds,
  onMonthChange,
  onSelectDate,
  onOpenSettings,
}: OverviewViewProps) {
  if (!summary) {
    return (
      <div className="view-shell">
        <PanelCard className="hero-panel">
          <SectionHeader
            eyebrow="Overview"
            title="No play history loaded yet"
            description={statusMessage || 'Point the app at your KovaaK files, then refresh to build lifetime playtime and daily history.'}
            actions={
              <button className="btn" type="button" onClick={onOpenSettings}>
                Open settings
              </button>
            }
          />
        </PanelCard>
      </div>
    )
  }

  return (
    <div className="view-shell">
      <PanelCard className="hero-panel">
        <SectionHeader
          eyebrow="Overview"
          title={formatDuration(summary.totalSeconds)}
          description="Total time played across all parsed KovaaK history."
        />
      </PanelCard>

      <PanelCard>
        <SectionHeader
          title="Playtime by Day"
          description="Each day shows recorded time played."
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
            description="Complete a scenario and refresh to populate your day-by-day history."
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

export default OverviewView
