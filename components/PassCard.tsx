import { Text, View } from 'react-native';

import { daysUntil, formatDate } from '@/lib/date';
import { classTypeLabel } from '@/lib/labels';
import { isPassUsable } from '@/lib/passes';
import type { Pass } from '@/lib/types';

interface Props {
  pass: Pass;
  /** 가로 스크롤 카드 폭. 지정하지 않으면 부모 폭을 채운다 */
  width?: number;
}

export function PassCard({ pass, width }: Props) {
  const dDay = daysUntil(pass.expires_on);
  const usable = isPassUsable(pass);
  const isPrivate = pass.class_type === 'private';
  const ratio = Math.max(0, Math.min(1, pass.remaining_count / pass.total_count));

  const statusText = !pass.is_active
    ? '정지됨'
    : dDay < 0
      ? '기간 만료'
      : pass.remaining_count === 0
        ? '횟수 소진'
        : dDay === 0
          ? '오늘 만료'
          : `D-${dDay}`;

  // 1:1 은 진한 카드, 그룹은 밝은 카드로 한눈에 구분
  const tone = !usable
    ? { card: 'bg-stone-200', title: 'text-stone-500', sub: 'text-stone-400', track: 'bg-stone-300', bar: 'bg-stone-400', chip: 'bg-stone-300', chipText: 'text-stone-600' }
    : isPrivate
      ? { card: 'bg-brand-700', title: 'text-white', sub: 'text-brand-100', track: 'bg-brand-600', bar: 'bg-brand-400', chip: 'bg-brand-600', chipText: 'text-white' }
      : { card: 'bg-surface', title: 'text-ink', sub: 'text-stone-500', track: 'bg-brand-50', bar: 'bg-brand-500', chip: 'bg-brand-50', chipText: 'text-brand-700' };

  const urgent = usable && dDay <= 7;

  return (
    <View className={`rounded-3xl p-5 ${tone.card}`} style={width ? { width } : undefined}>
      <View className="flex-row items-center justify-between">
        <View className={`rounded-full px-2.5 py-1 ${tone.chip}`}>
          <Text className={`text-xs font-semibold ${tone.chipText}`}>
            {classTypeLabel(pass.class_type)}
          </Text>
        </View>
        <Text className={`text-xs font-semibold ${urgent ? (isPrivate ? 'text-amber-300' : 'text-amber-600') : tone.sub}`}>
          {statusText}
        </Text>
      </View>

      <Text className={`mt-3 text-base font-semibold ${tone.title}`} numberOfLines={1}>
        {pass.name}
      </Text>

      <View className="mt-4 flex-row items-end">
        <Text className={`text-4xl font-bold ${tone.title}`}>{pass.remaining_count}</Text>
        <Text className={`mb-1 ml-1 text-sm ${tone.sub}`}>/ {pass.total_count}회 남음</Text>
      </View>

      <View className={`mt-3 h-1.5 overflow-hidden rounded-full ${tone.track}`}>
        <View className={`h-full rounded-full ${tone.bar}`} style={{ width: `${ratio * 100}%` }} />
      </View>

      <Text className={`mt-3 text-xs ${tone.sub}`}>{formatDate(pass.expires_on)} 까지</Text>
    </View>
  );
}
