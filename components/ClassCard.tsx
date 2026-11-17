import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Badge } from '@/components/ui';
import { dayjs, formatTimeRange } from '@/lib/date';
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_TONE, classTypeLabel } from '@/lib/labels';
import type { ClassOverview } from '@/lib/types';

interface Props {
  cls: ClassOverview;
  busy: boolean;
  onBook: (cls: ClassOverview) => void;
  onCancel: (cls: ClassOverview) => void;
  /** 홈의 '다가오는 예약'처럼 날짜를 함께 보여줄 때 */
  dateLabel?: string;
}

type Action =
  | { kind: 'book'; label: string; tone: 'primary' | 'waitlist' }
  | { kind: 'cancel'; label: string }
  | { kind: 'none'; label: string };

function resolveAction(cls: ClassOverview): Action {
  const started = !dayjs(cls.starts_at).isAfter(dayjs());
  const full = cls.confirmed_count >= cls.max_capacity;

  if (cls.my_booking_status === 'confirmed') return started ? { kind: 'none', label: '진행/종료' } : { kind: 'cancel', label: '예약 취소' };
  if (cls.my_booking_status === 'waitlist') return started ? { kind: 'none', label: '종료' } : { kind: 'cancel', label: '대기 취소' };
  if (cls.my_booking_status) return { kind: 'none', label: '종료' };
  if (started) return { kind: 'none', label: '종료' };
  if (!full) return { kind: 'book', label: '예약하기', tone: 'primary' };
  if (cls.max_capacity > 1) return { kind: 'book', label: '대기 신청', tone: 'waitlist' };
  return { kind: 'none', label: '마감' };
}

export function ClassCard({ cls, busy, onBook, onCancel, dateLabel }: Props) {
  const action = resolveAction(cls);
  const full = cls.confirmed_count >= cls.max_capacity;
  const isPrivate = cls.class_type === 'private';
  const myStatus = cls.my_booking_status;

  return (
    <View className={`rounded-2xl bg-white p-4 ${myStatus ? 'border border-brand-200' : 'border border-transparent'}`}>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          {dateLabel ? <Text className="mb-0.5 text-xs font-semibold text-brand-600">{dateLabel}</Text> : null}
          <Text className="text-lg font-bold text-ink">{formatTimeRange(cls.starts_at, cls.ends_at)}</Text>
          <Text className="mt-0.5 text-base text-ink" numberOfLines={1}>
            {cls.title}
          </Text>
          <View className="mt-1 flex-row items-center">
            <Ionicons name="person-outline" size={13} color="#78716C" />
            <Text className="ml-1 text-sm text-stone-500" numberOfLines={1}>
              {cls.instructor_name} 강사{cls.location ? ` · ${cls.location}` : ''}
            </Text>
          </View>
        </View>

        {myStatus ? (
          <Badge
            label={
              myStatus === 'waitlist' && cls.my_waitlist_position
                ? `대기 ${cls.my_waitlist_position}번`
                : BOOKING_STATUS_LABEL[myStatus]
            }
            bg={BOOKING_STATUS_TONE[myStatus].bg}
            text={BOOKING_STATUS_TONE[myStatus].text}
          />
        ) : null}
      </View>

      <View className="mt-3 flex-row items-center justify-between">
        {/* 버튼을 누르기 전에 정원·대기 현황을 먼저 보여준다 */}
        <View className="flex-1 flex-row flex-wrap items-center gap-1.5 pr-2">
          <Badge
            label={classTypeLabel(cls.class_type, cls.max_capacity)}
            bg={isPrivate ? 'bg-brand-700' : 'bg-stone-100'}
            text={isPrivate ? 'text-white' : 'text-stone-600'}
          />
          <Badge
            label={`${cls.confirmed_count}/${cls.max_capacity}명`}
            bg={full ? 'bg-rose-50' : 'bg-brand-50'}
            text={full ? 'text-rose-700' : 'text-brand-700'}
          />
          {cls.waitlist_count > 0 ? (
            <Badge label={`대기 ${cls.waitlist_count}명`} bg="bg-amber-50" text="text-amber-700" />
          ) : null}
        </View>

        {action.kind === 'none' ? (
          <View className="rounded-full bg-stone-100 px-4 py-2.5">
            <Text className="text-sm font-semibold text-stone-400">{action.label}</Text>
          </View>
        ) : (
          <Pressable
            disabled={busy}
            onPress={() => (action.kind === 'book' ? onBook(cls) : onCancel(cls))}
            accessibilityRole="button"
            accessibilityLabel={`${cls.title} ${action.label}`}
            className={`min-w-[92px] items-center rounded-full px-4 py-2.5 active:opacity-80 ${
              action.kind === 'cancel'
                ? 'border border-stone-300 bg-white'
                : action.tone === 'waitlist'
                  ? 'bg-amber-500'
                  : 'bg-brand-600'
            } ${busy ? 'opacity-60' : ''}`}>
            {busy ? (
              <ActivityIndicator size="small" color={action.kind === 'cancel' ? '#57534E' : '#FFFFFF'} />
            ) : (
              <Text className={`text-sm font-semibold ${action.kind === 'cancel' ? 'text-stone-600' : 'text-white'}`}>
                {action.label}
              </Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}
