import type { BookingStatus, ClassType, PassLogReason, PaymentMethod, Role } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  owner: '원장',
  manager: '관리자',
  instructor: '강사',
  member: '회원',
};

export const isStaffRole = (role?: Role | null) => role === 'owner' || role === 'manager' || role === 'instructor';
export const isAdminRole = (role?: Role | null) => role === 'owner' || role === 'manager';

/** 정원으로 수업 유형 라벨 생성: 1 → '1:1 개인', 4 → '4:1 그룹' */
export function classTypeLabel(type: ClassType, capacity?: number): string {
  if (type === 'private') return '1:1 개인';
  return capacity ? `${capacity}:1 그룹` : '그룹';
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: '예약 확정',
  waitlist: '대기',
  cancelled: '취소',
  attended: '출석',
  no_show: '노쇼',
};

/** 상태별 배지 색 (NativeWind 클래스) */
export const BOOKING_STATUS_TONE: Record<BookingStatus, { bg: string; text: string }> = {
  confirmed: { bg: 'bg-brand-50', text: 'text-brand-700' },
  waitlist: { bg: 'bg-amber-50', text: 'text-amber-700' },
  cancelled: { bg: 'bg-stone-100', text: 'text-stone-500' },
  attended: { bg: 'bg-sky-50', text: 'text-sky-700' },
  no_show: { bg: 'bg-rose-50', text: 'text-rose-700' },
};

export const PASS_LOG_LABEL: Record<PassLogReason, string> = {
  issued: '발급',
  booking: '예약 차감',
  waitlist_promotion: '대기 승격 차감',
  cancel_refund: '취소 복구',
  class_cancelled: '폐강 복구',
  admin_adjust: '횟수 조정',
  extended: '기간 변경',
  deactivated: '사용 중지',
  reactivated: '사용 재개',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: '카드',
  cash: '현금',
  transfer: '계좌이체',
  other: '기타',
};

/** 120000 → '120,000원' */
export const formatWon = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
