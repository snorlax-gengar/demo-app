import { dayjs, type Dayjs } from './date';
import type { ClassType, PaymentMethod } from './types';

/** 매출 화면용 결제 1건 (pass_payments + 수강권·회원 이름) */
export interface RevenueRow {
  id: string;
  amount: number;
  method: PaymentMethod;
  paid_on: string; // YYYY-MM-DD (한국 날짜)
  memo: string | null;
  pass: { id: string; name: string; class_type: ClassType } | null;
  member: { id: string; name: string } | null;
}

export interface RevenueSummary {
  total: number;
  count: number;
  /** 1건 평균 (건수 0 이면 0) */
  average: number;
  /** 지난달 대비 증감률(%). 지난달 0원이면 null */
  changePct: number | null;
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  byType: { type: ClassType; amount: number; count: number }[];
  /** 그 달 1일~말일, 날짜별 합계 */
  byDay: { day: number; amount: number }[];
}

const METHODS: PaymentMethod[] = ['card', 'transfer', 'cash', 'other'];
const TYPES: ClassType[] = ['group', 'private'];

/** month: 그 달 아무 날 / prevTotal: 지난달 합계 */
export function summarizeRevenue(rows: RevenueRow[], month: Dayjs, prevTotal: number): RevenueSummary {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const count = rows.length;
  const days = month.daysInMonth();
  const byDay = Array.from({ length: days }, (_, i) => ({ day: i + 1, amount: 0 }));
  for (const r of rows) {
    const d = dayjs(r.paid_on);
    if (d.isSame(month, 'month')) byDay[d.date() - 1].amount += r.amount;
  }
  return {
    total,
    count,
    average: count ? Math.round(total / count) : 0,
    changePct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null,
    byMethod: METHODS.map((method) => {
      const list = rows.filter((r) => r.method === method);
      return { method, amount: list.reduce((s, r) => s + r.amount, 0), count: list.length };
    }).filter((x) => x.count > 0),
    byType: TYPES.map((type) => {
      const list = rows.filter((r) => r.pass?.class_type === type);
      return { type, amount: list.reduce((s, r) => s + r.amount, 0), count: list.length };
    }).filter((x) => x.count > 0),
    byDay,
  };
}

/** 120000 → '12만', 1250000 → '125만', 9800 → '9,800' (차트 눈금용) */
export function shortWon(amount: number): string {
  if (amount >= 10000) {
    const man = amount / 10000;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}만`;
  }
  return amount.toLocaleString('ko-KR');
}
