import { type CSSProperties, useDeferredValue, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type ScenarioPlaytime = {
  name: string
  totalSeconds: number
  attemptCount: number
}

type PlaylistPlaytime = {
  name: string
  totalSeconds: number
  matchedScenarios: number
  totalScenarios: number
}

type DailyPlaylistPlaytime = {
  name: string
  totalSeconds: number
  matchedScenarios: number
}

type DailyPlaytime = {
  dateKey: string
  totalSeconds: number
  attemptCount: number
  playlists: DailyPlaylistPlaytime[]
  scenarios: ScenarioPlaytime[]
}

type QualityMetricType = 'score' | 'accuracy'
type TrendStatus = 'improving' | 'flat' | 'declining' | 'insufficientData'
type CoachRecommendationReason = 'declining' | 'underTrained'

type ScenarioTrend = {
  scenarioName: string
  metricType: QualityMetricType
  personalBest: number
  avg7d?: number | null
  avg30d?: number | null
  deltaPct?: number | null
  status: TrendStatus
  runCount7d: number
  runCount30d: number
  secondsLast7d: number
  secondsLast30d: number
}

type CoachRecommendation = {
  scenarioName: string
  minutes: number
  reason: CoachRecommendationReason
  note: string
}

type ProgressCoach = {
  improvingCount: number
  flatCount: number
  decliningCount: number
  insufficientDataCount: number
  scenarioTrends: ScenarioTrend[]
  recommendations: CoachRecommendation[]
  hasQualityData: boolean
}

type PlaytimeSummary = {
  totalSeconds: number
  attemptCount: number
  skippedFiles: number
  lastAttemptAt?: number | null
  sourcePath: string
  scenarios: ScenarioPlaytime[]
  playlists: PlaylistPlaytime[]
  dailySummaries: DailyPlaytime[]
  progressCoach: ProgressCoach
}

type CalendarCell =
  | {
      kind: 'spacer'
      key: string
    }
  | {
      kind: 'day'
      key: string
      dateKey: string
      dayNumber: number
      summary: DailyPlaytime | null
    }

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function padNumber(value: number): string {
  return String(value).padStart(2, '0')
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`
}

function getLocalTodayDateKey(): string {
  const now = new Date()
  return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split('-').map(Number)
  return {
    year,
    month,
    day,
  }
}

function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number)
  return {
    year,
    month,
  }
}

function shiftMonthKey(monthKey: string, offset: number): string {
  const { year, month } = parseMonthKey(monthKey)
  const shifted = new Date(year, month - 1 + offset, 1)
  return toDateKey(shifted.getFullYear(), shifted.getMonth() + 1, 1).slice(0, 7)
}

function clampDateKey(dateKey: string, minDateKey: string, maxDateKey: string): string {
  if (dateKey < minDateKey) {
    return minDateKey
  }
  if (dateKey > maxDateKey) {
    return maxDateKey
  }
  return dateKey
}

function clampMonthKey(monthKey: string, minMonthKey: string, maxMonthKey: string): string {
  if (monthKey < minMonthKey) {
    return minMonthKey
  }
  if (monthKey > maxMonthKey) {
    return maxMonthKey
  }
  return monthKey
}

function formatDuration(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function formatCompactDuration(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  if (normalized === 0) {
    return '0m'
  }

  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${padNumber(minutes)}m`
  }

  return `${Math.max(1, minutes)}m`
}

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) {
    return 'Unknown'
  }

  return new Date(timestamp * 1000).toLocaleString()
}

function formatQualityValue(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--'
  }

  if (Math.abs(value) >= 1000) {
    return value.toFixed(0)
  }

  return value.toFixed(2).replace(/\.00$/, '')
}

function formatDeltaPercent(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--'
  }

  const percent = value * 100
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(1)}%`
}

function formatMetricType(metricType: QualityMetricType): string {
  return metricType === 'score' ? 'Score' : 'Accuracy'
}

function formatTrendStatus(status: TrendStatus): string {
  if (status === 'insufficientData') {
    return 'Insufficient Data'
  }

  return status[0].toUpperCase() + status.slice(1)
}

function formatRecommendationReason(reason: CoachRecommendationReason): string {
  return reason === 'underTrained' ? 'Under-trained' : 'Declining'
}

function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey)
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
}

function formatDateLabel(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function buildCalendarCells(
  monthKey: string,
  dailyLookup: Record<string, DailyPlaytime>,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): CalendarCell[] {
  const { year, month } = parseMonthKey(monthKey)
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: CalendarCell[] = []

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({
      kind: 'spacer',
      key: `spacer-${monthKey}-${index}`,
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = toDateKey(year, month, day)
    if (dateKey < rangeStartDateKey || dateKey > rangeEndDateKey) {
      cells.push({
        kind: 'spacer',
        key: `hidden-${dateKey}`,
      })
      continue
    }

    cells.push({
      kind: 'day',
      key: dateKey,
      dateKey,
      dayNumber: day,
      summary: dailyLookup[dateKey] ?? null,
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      kind: 'spacer',
      key: `tail-${monthKey}-${cells.length}`,
    })
  }

  return cells
}

function pickLatestPlayedOnOrBefore(dailySummaries: DailyPlaytime[], maxDateKey: string): string | null {
  for (let index = dailySummaries.length - 1; index >= 0; index -= 1) {
    const candidate = dailySummaries[index]
    if (candidate.dateKey <= maxDateKey) {
      return candidate.dateKey
    }
  }

  return null
}

function pickMonthSelection(monthKey: string, dailySummaries: DailyPlaytime[], rangeStart: string, rangeEnd: string): string {
  for (let index = dailySummaries.length - 1; index >= 0; index -= 1) {
    const summary = dailySummaries[index]
    if (monthKeyFromDateKey(summary.dateKey) === monthKey && summary.dateKey >= rangeStart && summary.dateKey <= rangeEnd) {
      return summary.dateKey
    }
  }

  const { year, month } = parseMonthKey(monthKey)
  const monthStart = toDateKey(year, month, 1)
  const monthEnd = toDateKey(year, month, new Date(year, month, 0).getDate())
  const clampedStart = monthStart < rangeStart ? rangeStart : monthStart
  const clampedEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd
  if (clampedStart <= clampedEnd) {
    return clampedStart
  }

  return rangeStart
}

function createEmptyDay(dateKey: string): DailyPlaytime {
  return {
    dateKey,
    totalSeconds: 0,
    attemptCount: 0,
    playlists: [],
    scenarios: [],
  }
}

function App() {
  const [summary, setSummary] = useState<PlaytimeSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [playlistQuery, setPlaylistQuery] = useState('')
  const [scenarioQuery, setScenarioQuery] = useState('')
  const [visibleMonthKey, setVisibleMonthKey] = useState<string | null>(null)
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)

  const deferredPlaylistQuery = useDeferredValue(playlistQuery)
  const deferredScenarioQuery = useDeferredValue(scenarioQuery)

  async function loadPlaytime(showSpinner = true) {
    if (showSpinner) {
      setIsLoading(true)
    }

    try {
      const nextSummary = await invoke<PlaytimeSummary>('get_kovaak_playtime')
      setSummary(nextSummary)
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to read KovaaK playtime: ${String(error)}`)
    } finally {
      if (showSpinner) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadPlaytime()

    const timer = window.setInterval(() => {
      void loadPlaytime(false)
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!summary || summary.dailySummaries.length === 0) {
      return
    }

    const todayDateKey = getLocalTodayDateKey()
    const firstPlayedDateKey = summary.dailySummaries[0].dateKey
    if (firstPlayedDateKey > todayDateKey) {
      return
    }

    const latestDateKey = pickLatestPlayedOnOrBefore(summary.dailySummaries, todayDateKey) ?? firstPlayedDateKey
    setVisibleMonthKey((current) => current ?? monthKeyFromDateKey(latestDateKey))
    setSelectedDateKey((current) => current ?? latestDateKey)
  }, [summary])

  async function handleQuit() {
    await invoke('request_app_quit')
  }

  const normalizedPlaylistQuery = deferredPlaylistQuery.trim().toLowerCase()
  const normalizedScenarioQuery = deferredScenarioQuery.trim().toLowerCase()
  const filteredPlaylists = summary
    ? summary.playlists.filter((playlist) => playlist.name.toLowerCase().includes(normalizedPlaylistQuery))
    : []
  const filteredScenarios = summary
    ? summary.scenarios.filter((scenario) => scenario.name.toLowerCase().includes(normalizedScenarioQuery))
    : []

  const dailyLookup: Record<string, DailyPlaytime> = {}
  if (summary) {
    for (const dailySummary of summary.dailySummaries) {
      dailyLookup[dailySummary.dateKey] = dailySummary
    }
  }

  const todayDateKey = getLocalTodayDateKey()
  const firstPlayedDateKey = summary?.dailySummaries[0]?.dateKey ?? null
  const hasCalendarRange = Boolean(firstPlayedDateKey && firstPlayedDateKey <= todayDateKey)
  const rangeStartDateKey = hasCalendarRange ? (firstPlayedDateKey as string) : null
  const rangeEndDateKey = hasCalendarRange ? todayDateKey : null
  const rangeStartMonthKey = hasCalendarRange ? monthKeyFromDateKey(rangeStartDateKey as string) : null
  const rangeEndMonthKey = hasCalendarRange ? monthKeyFromDateKey(rangeEndDateKey as string) : null
  const latestPlayedDateKey =
    summary && hasCalendarRange
      ? pickLatestPlayedOnOrBefore(summary.dailySummaries, rangeEndDateKey as string)
      : null
  const defaultMonthKey = hasCalendarRange
    ? monthKeyFromDateKey(latestPlayedDateKey ?? (rangeEndDateKey as string))
    : monthKeyFromDateKey(todayDateKey)
  const activeMonthKey = hasCalendarRange
    ? clampMonthKey(visibleMonthKey ?? defaultMonthKey, rangeStartMonthKey as string, rangeEndMonthKey as string)
    : monthKeyFromDateKey(todayDateKey)

  const effectiveSelectedDateKey = hasCalendarRange
    ? clampDateKey(
        selectedDateKey ?? latestPlayedDateKey ?? (rangeStartDateKey as string),
        rangeStartDateKey as string,
        rangeEndDateKey as string,
      )
    : todayDateKey
  const selectedDay = dailyLookup[effectiveSelectedDateKey] ?? createEmptyDay(effectiveSelectedDateKey)
  const calendarCells = hasCalendarRange
    ? buildCalendarCells(activeMonthKey, dailyLookup, rangeStartDateKey as string, rangeEndDateKey as string)
    : []
  const visibleMonthPeakSeconds = calendarCells.reduce((peak, cell) => {
    if (cell.kind !== 'day') {
      return peak
    }

    return Math.max(peak, cell.summary?.totalSeconds ?? 0)
  }, 0)
  const canGoPrevious = hasCalendarRange && activeMonthKey > (rangeStartMonthKey as string)
  const canGoNext = hasCalendarRange && activeMonthKey < (rangeEndMonthKey as string)

  function handleMonthChange(offset: number) {
    if (!summary || !hasCalendarRange) {
      return
    }

    const shifted = shiftMonthKey(activeMonthKey, offset)
    const nextMonthKey = clampMonthKey(shifted, rangeStartMonthKey as string, rangeEndMonthKey as string)
    if (nextMonthKey === activeMonthKey) {
      return
    }

    setVisibleMonthKey(nextMonthKey)
    setSelectedDateKey(
      pickMonthSelection(
        nextMonthKey,
        summary.dailySummaries,
        rangeStartDateKey as string,
        rangeEndDateKey as string,
      ),
    )
  }

  return (
    <main className="app">
      <section className="hero">
        <p className="eyebrow">Actual KovaaK Playtime</p>
        <div className="hours">
          <span className="value">{summary ? formatDuration(summary.totalSeconds) : '--'}</span>
        </div>
        <p className="subtle">
          {summary
            ? `${formatDuration(summary.totalSeconds)} summed from KovaaK stats CSV files`
            : 'Reading KovaaK stats CSV files'}
        </p>
      </section>

      <section className="details detail-grid">
        <div className="detail">
          <span className="label">Last attempt</span>
          <strong>{summary ? formatTimestamp(summary.lastAttemptAt) : 'Loading...'}</strong>
        </div>

        <div className="detail">
          <span className="label">Tracked runs</span>
          <strong>
            {summary
              ? `${summary.attemptCount} CSV files${summary.skippedFiles ? `, ${summary.skippedFiles} skipped` : ''}`
              : 'Loading...'}
          </strong>
        </div>

        <div className="detail">
          <span className="label">Source folder</span>
          <span className="mono">{summary?.sourcePath ?? 'Looking for KovaaK stats folder...'}</span>
        </div>
      </section>

      <section className="details calendar-card">
        <div className="calendar-header">
          <div className="detail">
            <span className="label">Daily calendar</span>
            <span className="subtle">See how much you played each day and inspect the selected date below.</span>
          </div>

          <div className="calendar-toolbar">
            <button
              className="secondary calendar-button"
              onClick={() => handleMonthChange(-1)}
              type="button"
              disabled={!canGoPrevious}
            >
              Previous
            </button>
            <strong className="calendar-month">{formatMonthLabel(activeMonthKey)}</strong>
            <button
              className="secondary calendar-button"
              onClick={() => handleMonthChange(1)}
              type="button"
              disabled={!canGoNext}
            >
              Next
            </button>
          </div>
        </div>

        {hasCalendarRange ? (
          <>
            <div className="calendar-weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="calendar-weekday">
                  {label}
                </span>
              ))}
            </div>

            <div className="calendar-grid">
              {calendarCells.map((cell) => {
                if (cell.kind === 'spacer') {
                  return <div key={cell.key} className="calendar-spacer" />
                }

                const isSelected = cell.dateKey === effectiveSelectedDateKey
                const totalSeconds = cell.summary?.totalSeconds ?? 0
                const attemptCount = cell.summary?.attemptCount ?? 0
                const activityStrength = visibleMonthPeakSeconds > 0 ? totalSeconds / visibleMonthPeakSeconds : 0

                return (
                  <button
                    key={cell.key}
                    className={`calendar-day${isSelected ? ' is-selected' : ''}${totalSeconds > 0 ? ' is-played' : ''}`}
                    onClick={() => setSelectedDateKey(cell.dateKey)}
                    type="button"
                    style={{ '--activity-strength': activityStrength.toFixed(3) } as CSSProperties}
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
          <div className="empty-day-card">
            <strong>No calendar data yet.</strong>
            <span className="subtle">Complete a scenario and refresh to populate your calendar history.</span>
          </div>
        )}
      </section>

      <section className="details day-card">
        <div className="day-card-header">
          <div className="detail">
            <span className="label">Selected day</span>
            <strong>{formatDateLabel(selectedDay.dateKey)}</strong>
            <span className="subtle">
              Playlist totals are inferred from your current KovaaK playlist files.
            </span>
          </div>

          <div className="metric-row">
            <div className="metric-chip">
              <span className="label">Playtime</span>
              <strong>{formatDuration(selectedDay.totalSeconds)}</strong>
            </div>
            <div className="metric-chip">
              <span className="label">Runs</span>
              <strong>{selectedDay.attemptCount}</strong>
            </div>
          </div>
        </div>

        {selectedDay.totalSeconds > 0 ? (
          <div className="day-table-grid">
            <section className="day-table-card">
              <div className="detail">
                <span className="label">Playlists played</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Playlist</th>
                      <th>Time</th>
                      <th>Matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDay.playlists.length > 0 ? (
                      selectedDay.playlists.map((playlist) => (
                        <tr key={`${selectedDay.dateKey}-${playlist.name}`}>
                          <td>{playlist.name}</td>
                          <td>{formatDuration(playlist.totalSeconds)}</td>
                          <td>{playlist.matchedScenarios}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="empty-row">
                          No playlists matched this day.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="day-table-card">
              <div className="detail">
                <span className="label">Scenarios played</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Time</th>
                      <th>Runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDay.scenarios.map((scenario) => (
                      <tr key={`${selectedDay.dateKey}-${scenario.name}`}>
                        <td>{scenario.name}</td>
                        <td>{formatDuration(scenario.totalSeconds)}</td>
                        <td>{scenario.attemptCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="empty-day-card">
            <strong>No recorded playtime on this day.</strong>
            <span className="subtle">Pick another date or browse to a different month.</span>
          </div>
        )}
      </section>

      <section className="details table-card">
        <div className="detail">
          <span className="label">Per playlist time</span>
          <span className="subtle">
            Summed from the scenarios currently listed in each KovaaK playlist file.
          </span>
        </div>
        <input
          className="search-input"
          type="search"
          value={playlistQuery}
          onChange={(event) => setPlaylistQuery(event.target.value)}
          placeholder="Search playlists"
        />
        {summary ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Playlist</th>
                  <th>Time</th>
                  <th>Matched</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlaylists.length > 0 ? (
                  filteredPlaylists.map((playlist) => (
                    <tr key={playlist.name}>
                      <td>{playlist.name}</td>
                      <td>{formatDuration(playlist.totalSeconds)}</td>
                      <td>{`${playlist.matchedScenarios}/${playlist.totalScenarios}`}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      No matching playlists.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <span>Loading...</span>
        )}
      </section>

      <section className="details table-card">
        <div className="detail">
          <span className="label">Per scenario time</span>
        </div>
        <input
          className="search-input"
          type="search"
          value={scenarioQuery}
          onChange={(event) => setScenarioQuery(event.target.value)}
          placeholder="Search scenarios"
        />
        {summary ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Time</th>
                  <th>Runs</th>
                </tr>
              </thead>
              <tbody>
                {filteredScenarios.length > 0 ? (
                  filteredScenarios.map((scenario) => (
                    <tr key={scenario.name}>
                      <td>{scenario.name}</td>
                      <td>{formatDuration(scenario.totalSeconds)}</td>
                      <td>{scenario.attemptCount}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      No matching scenarios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <span>Loading...</span>
        )}
      </section>

      <section className="details coach-card">
        <div className="detail">
          <span className="label">Progress Coach</span>
          <span className="subtle">
            Quality trends from score and accuracy metrics parsed from KovaaK stats CSV files.
          </span>
        </div>

        {summary ? (
          summary.progressCoach.hasQualityData ? (
            <>
              <div className="coach-chip-grid">
                <div className="coach-chip improving">
                  <span className="label">Improving</span>
                  <strong>{summary.progressCoach.improvingCount}</strong>
                </div>
                <div className="coach-chip flat">
                  <span className="label">Flat</span>
                  <strong>{summary.progressCoach.flatCount}</strong>
                </div>
                <div className="coach-chip declining">
                  <span className="label">Declining</span>
                  <strong>{summary.progressCoach.decliningCount}</strong>
                </div>
                <div className="coach-chip insufficient">
                  <span className="label">Insufficient Data</span>
                  <strong>{summary.progressCoach.insufficientDataCount}</strong>
                </div>
              </div>

              <div className="coach-grid">
                <section className="coach-panel">
                  <div className="detail">
                    <span className="label">Scenario quality trends</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Metric</th>
                          <th>PB</th>
                          <th>7d Avg</th>
                          <th>30d Avg</th>
                          <th>Delta</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.progressCoach.scenarioTrends.map((trend) => (
                          <tr key={trend.scenarioName}>
                            <td>{trend.scenarioName}</td>
                            <td>{formatMetricType(trend.metricType)}</td>
                            <td>{formatQualityValue(trend.personalBest)}</td>
                            <td>{formatQualityValue(trend.avg7d)}</td>
                            <td>{formatQualityValue(trend.avg30d)}</td>
                            <td>{formatDeltaPercent(trend.deltaPct)}</td>
                            <td>
                              <span className={`status-pill ${trend.status}`}>
                                {formatTrendStatus(trend.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="coach-panel">
                  <div className="detail">
                    <span className="label">Today&apos;s 20-minute plan</span>
                    <span className="subtle">
                      Four focused blocks of 5 minutes each, prioritized by decline risk and under-training.
                    </span>
                  </div>

                  {summary.progressCoach.recommendations.length > 0 ? (
                    <ol className="coach-plan">
                      {summary.progressCoach.recommendations.map((recommendation, index) => (
                        <li key={`${recommendation.scenarioName}-${index}`} className="coach-plan-item">
                          <div className="coach-plan-head">
                            <strong>{recommendation.scenarioName}</strong>
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
                    <div className="empty-day-card">
                      <strong>No recommendations yet.</strong>
                      <span className="subtle">
                        Keep playing scored scenarios to unlock a daily plan.
                      </span>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="empty-day-card">
              <strong>No quality metrics parsed yet.</strong>
              <span className="subtle">
                Play scored scenarios and refresh. Progress Coach appears once score or accuracy values are found.
              </span>
            </div>
          )
        ) : (
          <span>Loading...</span>
        )}
      </section>

      {statusMessage && (
        <section className="details error-card">
          <div className="detail">
            <span className="label">Read error</span>
            <span>{statusMessage}</span>
          </div>
        </section>
      )}

      <footer className="footer">
        <button onClick={() => void loadPlaytime()} disabled={isLoading} type="button">
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button className="secondary" onClick={() => void handleQuit()} disabled={isLoading} type="button">
          Quit App
        </button>
      </footer>
    </main>
  )
}

export default App
