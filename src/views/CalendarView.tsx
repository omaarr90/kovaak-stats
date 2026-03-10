import { type CSSProperties } from 'react'
import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
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
import { type CalendarCell, type DailyPlaytime } from '../types'

type CalendarViewProps = {
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
}

const PLAYLIST_COLUMNS: DataTableColumn<DailyPlaytime['playlists'][number]>[] = [
  {
    id: 'name',
    header: 'Playlist',
    width: '58%',
    truncate: true,
    render: (playlist) => playlist.name,
    title: (playlist) => playlist.name,
  },
  {
    id: 'time',
    header: 'Time',
    width: '22%',
    render: (playlist) => formatDuration(playlist.totalSeconds),
  },
  {
    id: 'matched',
    header: 'Matched',
    width: '20%',
    align: 'right',
    render: (playlist) => playlist.matchedScenarios,
  },
]

const SCENARIO_COLUMNS: DataTableColumn<DailyPlaytime['scenarios'][number]>[] = [
  {
    id: 'name',
    header: 'Scenario',
    width: '58%',
    truncate: true,
    render: (scenario) => scenario.name,
    title: (scenario) => scenario.name,
  },
  {
    id: 'time',
    header: 'Time',
    width: '22%',
    render: (scenario) => formatDuration(scenario.totalSeconds),
  },
  {
    id: 'runs',
    header: 'Runs',
    width: '20%',
    align: 'right',
    render: (scenario) => scenario.attemptCount,
  },
]

function CalendarView({
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
}: CalendarViewProps) {
  return (
    <div className="view-shell">
      <PanelCard>
        <SectionHeader
          title="Daily Calendar"
          description="See how much you played each day and inspect the selected date below."
          actions={
            <div className="calendar-toolbar">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => onMonthChange(-1)}
                disabled={!canGoPrevious}
                aria-label="Go to previous month"
              >
                Previous
              </button>
              <strong className="calendar-month">{formatMonthLabel(activeMonthKey)}</strong>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => onMonthChange(1)}
                disabled={!canGoNext}
                aria-label="Go to next month"
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
        <SectionHeader
          title={formatDateLabel(selectedDay.dateKey)}
          description="Playlist totals are inferred from your current KovaaK playlist files."
        />

        <div className="chip-grid">
          <div className="metric-chip">
            <span className="label">Playtime</span>
            <strong>{formatDuration(selectedDay.totalSeconds)}</strong>
          </div>
          <div className="metric-chip">
            <span className="label">Runs</span>
            <strong>{selectedDay.attemptCount}</strong>
          </div>
        </div>

        {selectedDay.totalSeconds > 0 ? (
          <div className="panel-grid-two">
            <PanelCard className="nested-panel">
              <SectionHeader title="Playlists Played" />
              <DataTable
                columns={PLAYLIST_COLUMNS}
                rows={selectedDay.playlists}
                rowKey={(playlist) => `${selectedDay.dateKey}-${playlist.name}`}
                emptyMessage="No playlists matched this day."
              />
            </PanelCard>

            <PanelCard className="nested-panel">
              <SectionHeader title="Scenarios Played" />
              <DataTable
                columns={SCENARIO_COLUMNS}
                rows={selectedDay.scenarios}
                rowKey={(scenario) => `${selectedDay.dateKey}-${scenario.name}`}
                emptyMessage="No scenarios recorded this day."
              />
            </PanelCard>
          </div>
        ) : (
          <EmptyState
            title="No recorded playtime on this day."
            description="Pick another date or browse to a different month."
          />
        )}
      </PanelCard>
    </div>
  )
}

export default CalendarView
