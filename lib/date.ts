import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/ko';

dayjs.locale('ko');

export { dayjs };
export type { Dayjs };

/** 월요일 시작 주의 첫날 00:00 */
export function startOfWeek(d: Dayjs): Dayjs {
  return d.startOf('day').subtract((d.day() + 6) % 7, 'day');
}

/** 월~일 7일 */
export function weekDays(weekStart: Dayjs): Dayjs[] {
  return Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));
}

export const formatTime = (iso: string) => dayjs(iso).format('HH:mm');
export const formatTimeRange = (start: string, end: string) => `${formatTime(start)} – ${formatTime(end)}`;
export const formatDay = (iso: string | Dayjs) => dayjs(iso).format('M월 D일 (dd)');
export const formatDate = (iso: string) => dayjs(iso).format('YYYY.MM.DD');

/** 만료일까지 남은 일수(오늘 만료 = 0, 지남 = 음수) */
export function daysUntil(dateOnly: string): number {
  return dayjs(dateOnly).startOf('day').diff(dayjs().startOf('day'), 'day');
}

/** 회원 본인 취소 시 횟수가 복구되는 시점인지(수업 시작 24시간 전까지) */
export function isRefundableNow(startsAt: string): boolean {
  return !dayjs().isAfter(dayjs(startsAt).subtract(24, 'hour'));
}
