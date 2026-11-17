import { dayjs } from './date';

/**
 * 출석은 수업 시작 몇 분 전부터 체크할 수 있는지.
 * DB 함수 mark_attendance 의 '30 minutes' 와 반드시 같게 유지할 것 (supabase/patches/004_attendance_window.sql)
 */
export const CHECKIN_OPEN_MINUTES = 30;

/** 지금 이 수업에서 출석·노쇼를 처리할 수 있는지 (되돌리기는 언제나 가능) */
export function attendanceWindow(startsAt: string, now = dayjs()) {
  const start = dayjs(startsAt);
  const opensAt = start.subtract(CHECKIN_OPEN_MINUTES, 'minute');
  return {
    /** 출석: 시작 30분 전부터 */
    canAttend: !now.isBefore(opensAt),
    /** 노쇼: 수업 시작 후 */
    canNoShow: !now.isBefore(start),
    opensAt,
    start,
  };
}
