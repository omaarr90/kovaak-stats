import {
  buildCalendarCells,
  buildDailyLookup,
  clampDateKey,
  clampMonthKey,
  createEmptyDay,
  getLocalTodayDateKey,
  monthKeyFromDateKey,
  pickLatestPlayedOnOrBefore,
} from './playtime-utils'
import { type DailyPlaytime, type PlaytimeSummary } from './types'

export type DashboardViewModel = {
  todayDateKey: string
  hasCalendarRange: boolean
  rangeStartDateKey: string | null
  rangeEndDateKey: string | null
  rangeStartMonthKey: string | null
  rangeEndMonthKey: string | null
  activeMonthKey: string
  effectiveSelectedDateKey: string
  selectedDay: DailyPlaytime
  calendarCells: ReturnType<typeof buildCalendarCells>
  visibleMonthPeakSeconds: number
  canGoPrevious: boolean
  canGoNext: boolean
  latestPlayedDateKey: string | null
}

export function createDashboardViewModel(
  summary: PlaytimeSummary | null,
  visibleMonthKey: string | null,
  selectedDateKey: string | null,
): DashboardViewModel {
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

  const dailyLookup = summary ? buildDailyLookup(summary.dailySummaries) : {}
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

  return {
    todayDateKey,
    hasCalendarRange,
    rangeStartDateKey,
    rangeEndDateKey,
    rangeStartMonthKey,
    rangeEndMonthKey,
    activeMonthKey,
    effectiveSelectedDateKey,
    selectedDay,
    calendarCells,
    visibleMonthPeakSeconds,
    canGoPrevious,
    canGoNext,
    latestPlayedDateKey,
  }
}
