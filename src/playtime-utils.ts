import { type CalendarCell, type CoachRecommendationReason, type DailyPlaytime, type QualityMetricType, type TrendStatus } from './types'

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function padNumber(value: number): string {
  return String(value).padStart(2, '0')
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`
}

export function getLocalTodayDateKey(): string {
  const now = new Date()
  return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split('-').map(Number)
  return {
    year,
    month,
    day,
  }
}

export function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number)
  return {
    year,
    month,
  }
}

export function shiftMonthKey(monthKey: string, offset: number): string {
  const { year, month } = parseMonthKey(monthKey)
  const shifted = new Date(year, month - 1 + offset, 1)
  return toDateKey(shifted.getFullYear(), shifted.getMonth() + 1, 1).slice(0, 7)
}

export function clampDateKey(dateKey: string, minDateKey: string, maxDateKey: string): string {
  if (dateKey < minDateKey) {
    return minDateKey
  }
  if (dateKey > maxDateKey) {
    return maxDateKey
  }
  return dateKey
}

export function clampMonthKey(monthKey: string, minMonthKey: string, maxMonthKey: string): string {
  if (monthKey < minMonthKey) {
    return minMonthKey
  }
  if (monthKey > maxMonthKey) {
    return maxMonthKey
  }
  return monthKey
}

export function formatDuration(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  return `${hours}h ${minutes}m`
}

export function formatCompactDuration(totalSeconds: number): string {
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

export function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) {
    return 'Unknown'
  }

  return new Date(timestamp * 1000).toLocaleString()
}

export function formatQualityValue(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--'
  }

  if (Math.abs(value) >= 1000) {
    return value.toFixed(0)
  }

  return value.toFixed(2).replace(/\.00$/, '')
}

export function formatDeltaPercent(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--'
  }

  const percent = value * 100
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(1)}%`
}

export function formatMetricType(metricType: QualityMetricType): string {
  return metricType === 'score' ? 'Score' : 'Accuracy'
}

export function formatTrendStatus(status: TrendStatus): string {
  if (status === 'insufficientData') {
    return 'Insufficient Data'
  }
  return status[0].toUpperCase() + status.slice(1)
}

export function formatRecommendationReason(reason: CoachRecommendationReason): string {
  return reason === 'underTrained' ? 'Under-trained' : 'Declining'
}

export function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey)
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
}

export function formatDateLabel(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export function formatRefreshTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return 'Not refreshed yet'
  }
  return `Last refresh ${new Date(timestamp).toLocaleTimeString()}`
}

export function buildCalendarCells(
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

export function pickLatestPlayedOnOrBefore(dailySummaries: DailyPlaytime[], maxDateKey: string): string | null {
  for (let index = dailySummaries.length - 1; index >= 0; index -= 1) {
    const candidate = dailySummaries[index]
    if (candidate.dateKey <= maxDateKey) {
      return candidate.dateKey
    }
  }

  return null
}

export function pickMonthSelection(
  monthKey: string,
  dailySummaries: DailyPlaytime[],
  rangeStart: string,
  rangeEnd: string,
): string {
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

export function createEmptyDay(dateKey: string): DailyPlaytime {
  return {
    dateKey,
    totalSeconds: 0,
    attemptCount: 0,
    playlists: [],
    scenarios: [],
  }
}

export function buildDailyLookup(dailySummaries: DailyPlaytime[]): Record<string, DailyPlaytime> {
  const lookup: Record<string, DailyPlaytime> = {}
  for (const dailySummary of dailySummaries) {
    lookup[dailySummary.dateKey] = dailySummary
  }
  return lookup
}
