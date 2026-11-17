import { daysUntil } from './date';
import type { ClassType, PassLite } from './types';

/** 잔여 횟수가 이 값 이하이면 '재등록 안내' 대상으로 강조 */
export const LOW_REMAINING = 3;
/** 만료까지 남은 일수가 이 값 이하이면 '만료 임박' */
export const EXPIRING_DAYS = 7;

/** 지금 쓸 수 있는 수강권인지 (활성 + 잔여 > 0 + 만료 전) */
export function isPassUsable(pass: PassLite): boolean {
  return pass.is_active && pass.remaining_count > 0 && daysUntil(pass.expires_on) >= 0;
}

export interface PassTypeSummary {
  /** 사용 가능한 수강권들의 잔여 횟수 합 */
  remaining: number;
  /** 가장 먼저 만료되는 수강권까지 남은 일수 */
  daysLeft: number;
  expiresOn: string;
  passCount: number;
}

export interface PassSummary {
  byType: Record<ClassType, PassTypeSummary | null>;
  hasUsable: boolean;
  /** 한 유형이라도 잔여가 LOW_REMAINING 이하 */
  low: boolean;
  /** 한 유형이라도 EXPIRING_DAYS 이내 만료 */
  expiring: boolean;
  minRemaining: number | null;
  minDaysLeft: number | null;
}

/** 회원의 수강권 목록 → 유형별 잔여 횟수·가장 가까운 만료일 요약 */
export function summarizePasses(passes: PassLite[] | null | undefined): PassSummary {
  const byType: Record<ClassType, PassTypeSummary | null> = { private: null, group: null };

  for (const pass of passes ?? []) {
    if (!isPassUsable(pass)) continue;
    const days = daysUntil(pass.expires_on);
    const current = byType[pass.class_type];
    if (!current) {
      byType[pass.class_type] = { remaining: pass.remaining_count, daysLeft: days, expiresOn: pass.expires_on, passCount: 1 };
    } else {
      current.remaining += pass.remaining_count;
      current.passCount += 1;
      if (days < current.daysLeft) {
        current.daysLeft = days;
        current.expiresOn = pass.expires_on;
      }
    }
  }

  const usable = [byType.private, byType.group].filter((s): s is PassTypeSummary => s !== null);
  return {
    byType,
    hasUsable: usable.length > 0,
    low: usable.some((s) => s.remaining <= LOW_REMAINING),
    expiring: usable.some((s) => s.daysLeft <= EXPIRING_DAYS),
    minRemaining: usable.length ? Math.min(...usable.map((s) => s.remaining)) : null,
    minDaysLeft: usable.length ? Math.min(...usable.map((s) => s.daysLeft)) : null,
  };
}

export const dDayLabel = (daysLeft: number) => (daysLeft === 0 ? '오늘 만료' : `D-${daysLeft}`);
