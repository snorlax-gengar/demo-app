import type { Dayjs } from './date';
import type { ClassType } from './types';

export type DurationUnit = 'day' | 'month';

/** 수강권 상품(스튜디오 가격표) */
export interface PassProduct {
  id: string;
  studio_id: string;
  name: string;
  class_type: ClassType;
  total_count: number;
  duration_value: number;
  duration_unit: DurationUnit;
  price: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export type PassProductInput = Pick<PassProduct, 'name' | 'class_type' | 'total_count' | 'duration_value' | 'duration_unit' | 'price' | 'is_active'>;

/** DB 제약과 동일하게 유지 */
export const PRODUCT_LIMITS = { count: 500, days: 730, months: 24, price: 100_000_000, name: 40 } as const;

export const durationLabel = (value: number, unit: DurationUnit) => (unit === 'month' ? `${value}개월` : `${value}일`);

/** 시작일 포함 기간의 마지막 날. 3개월권 11/17 시작 → 2/16, 14일권 11/17 시작 → 11/30 */
export function expiresFrom(start: Dayjs, value: number, unit: DurationUnit): Dayjs {
  return start.add(value, unit).subtract(1, 'day');
}

/** 저장 전 검사 → 문제 있으면 사용자에게 보여줄 문장 */
export function validateProduct(p: PassProductInput): string | null {
  if (!p.name.trim()) return '상품 이름을 입력해 주세요.';
  if (p.name.trim().length > PRODUCT_LIMITS.name) return `상품 이름은 ${PRODUCT_LIMITS.name}자까지 입력할 수 있습니다.`;
  if (p.total_count < 1 || p.total_count > PRODUCT_LIMITS.count) return `횟수는 1~${PRODUCT_LIMITS.count}회 사이로 정해 주세요.`;
  const max = p.duration_unit === 'month' ? PRODUCT_LIMITS.months : PRODUCT_LIMITS.days;
  if (p.duration_value < 1 || p.duration_value > max) return `기간은 1~${max}${p.duration_unit === 'month' ? '개월' : '일'} 사이로 정해 주세요.`;
  if (p.price !== null && (p.price < 0 || p.price > PRODUCT_LIMITS.price)) return '가격이 올바르지 않습니다.';
  return null;
}
