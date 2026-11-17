import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { Badge } from '@/components/ui';
import { attendanceWindow } from '@/lib/attendance';
import { dayjs, formatTime } from '@/lib/date';
import { classTypeLabel } from '@/lib/labels';
import { EXPIRING_DAYS, LOW_REMAINING, dDayLabel, summarizePasses } from '@/lib/passes';
import type { ClassType, TimelineBooking, TimelineClass } from '@/lib/types';

export type AttendanceTarget = 'attended' | 'no_show';

export function classTiming(cls: Pick<TimelineClass, 'starts_at' | 'ends_at'>) {
  const now = dayjs();
  return {
    inProgress: !now.isBefore(dayjs(cls.starts_at)) && now.isBefore(dayjs(cls.ends_at)),
    finished: !now.isBefore(dayjs(cls.ends_at)),
  };
}

interface Props {
  cls: TimelineClass;
  showInstructor: boolean;
  onMark: (booking: TimelineBooking, target: AttendanceTarget) => void;
  onOpenMember: (memberId: string) => void;
  /** 지정하면 제목 영역을 눌러 수업 상세로 이동 */
  onOpenClass?: (classId: string) => void;
}

/** 강사/원장용 수업 카드: 정원·대기 배지 + 출석부(회원별 잔여 횟수) + 출석/노쇼 원클릭 */
export function StaffClassCard({ cls, showInstructor, onMark, onOpenMember, onOpenClass }: Props) {
  const { inProgress } = classTiming(cls);
  const seated = cls.bookings.filter((b) => b.status !== 'waitlist');
  const waiting = cls.bookings.filter((b) => b.status === 'waitlist');
  const full = seated.length >= cls.max_capacity;
  const isPrivate = cls.class_type === 'private';
  const { canAttend, canNoShow, opensAt, start } = attendanceWindow(cls.starts_at);
  // 아직 열리지 않은 버튼 안내 (되돌리기는 언제나 가능하므로 이미 눌린 버튼은 막지 않는다)
  const windowNote = !canAttend
    ? `출석은 ${opensAt.isSame(dayjs(), 'day') ? '' : `${opensAt.format('M/D')} `}${opensAt.format('HH:mm')}부터, 노쇼는 수업 시작 후에 처리할 수 있습니다.`
    : !canNoShow
      ? `노쇼는 수업 시작(${start.format('HH:mm')}) 후에 처리할 수 있습니다.`
      : null;

  return (
    <View className={`rounded-2xl bg-white p-4 ${inProgress ? 'border border-brand-400' : 'border border-transparent'}`}>
      <Pressable
        disabled={!onOpenClass}
        onPress={() => onOpenClass?.(cls.id)}
        accessibilityLabel={`${cls.title} 수업 상세`}
        className="flex-row items-start justify-between active:opacity-60">
        <View className="flex-1 pr-2">
          <View className="flex-row items-center">
            <Text className="shrink text-base font-bold text-ink" numberOfLines={1}>
              {cls.title}
            </Text>
            {onOpenClass ? <Ionicons name="chevron-forward" size={14} color="#A8A29E" style={{ marginLeft: 2 }} /> : null}
          </View>
          <Text className="mt-0.5 text-sm text-stone-500" numberOfLines={1}>
            {formatTime(cls.starts_at)} – {formatTime(cls.ends_at)}
            {cls.location ? ` · ${cls.location}` : ''}
            {showInstructor && cls.instructor ? ` · ${cls.instructor.name}` : ''}
          </Text>
        </View>
        {inProgress ? <Badge label="진행 중" bg="bg-brand-500" text="text-white" /> : null}
      </Pressable>

      <View className="mt-2.5 flex-row flex-wrap gap-1.5">
        <Badge
          label={classTypeLabel(cls.class_type, cls.max_capacity)}
          bg={isPrivate ? 'bg-brand-700' : 'bg-stone-100'}
          text={isPrivate ? 'text-white' : 'text-stone-600'}
        />
        <Badge
          label={`${seated.length}/${cls.max_capacity}명`}
          bg={full ? 'bg-rose-50' : 'bg-brand-50'}
          text={full ? 'text-rose-700' : 'text-brand-700'}
        />
        {waiting.length > 0 ? <Badge label={`대기 ${waiting.length}명`} bg="bg-amber-50" text="text-amber-700" /> : null}
      </View>

      {seated.length === 0 ? (
        <Text className="mt-3 text-sm text-stone-400">아직 예약한 회원이 없습니다.</Text>
      ) : (
        <View className="mt-3">
          {windowNote ? (
            <View className="mb-2 flex-row items-center rounded-lg bg-stone-100 px-3 py-2">
              <Ionicons name="time-outline" size={14} color="#78716C" />
              <Text className="ml-1.5 flex-1 text-xs text-stone-500">{windowNote}</Text>
            </View>
          ) : null}
          {seated.map((booking) => (
            <View key={booking.id} className="flex-row items-center border-t border-stone-100 py-2.5">
              <Pressable
                disabled={!booking.member}
                onPress={() => booking.member && onOpenMember(booking.member.id)}
                accessibilityLabel={`${booking.member?.name ?? '회원'} 상세 보기`}
                className="flex-1 pr-2 active:opacity-60">
                <View className="flex-row items-center">
                  <Text className="shrink text-base font-semibold text-ink" numberOfLines={1}>
                    {booking.member?.name || '이름 없음'}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color="#A8A29E" style={{ marginLeft: 2 }} />
                </View>
                <RemainingLabel booking={booking} classType={cls.class_type} />
              </Pressable>

              <AttendanceButton
                label="출석"
                active={booking.status === 'attended'}
                disabled={!canAttend && booking.status !== 'attended'}
                activeClass="bg-sky-600 border-sky-600"
                onPress={() => onMark(booking, 'attended')}
              />
              <View style={{ width: 6 }} />
              <AttendanceButton
                label="노쇼"
                active={booking.status === 'no_show'}
                disabled={!canNoShow && booking.status !== 'no_show'}
                activeClass="bg-rose-600 border-rose-600"
                onPress={() => onMark(booking, 'no_show')}
              />
            </View>
          ))}
        </View>
      )}

      {waiting.length > 0 ? (
        <View className="mt-1 rounded-xl bg-amber-50 px-3 py-2.5">
          <Text className="text-xs font-semibold text-amber-700">대기 순번</Text>
          <View className="mt-1 flex-row flex-wrap">
            {waiting.map((booking, index) => (
              <Pressable
                key={booking.id}
                disabled={!booking.member}
                onPress={() => booking.member && onOpenMember(booking.member.id)}
                className="mr-3 py-0.5 active:opacity-60">
                <Text className="text-sm text-amber-900">
                  {index + 1}. {booking.member?.name || '이름 없음'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 이 수업 유형의 잔여 횟수. 이 예약분은 이미 차감된 값이다 */
function RemainingLabel({ booking, classType }: { booking: TimelineBooking; classType: ClassType }) {
  const passes = booking.member?.passes;
  if (!passes) return null;

  const summary = summarizePasses(passes).byType[classType];
  if (!summary) {
    return <Text className="mt-0.5 text-xs font-semibold text-rose-600">남은 수강권 없음 · 재등록 필요</Text>;
  }
  const warn = summary.remaining <= LOW_REMAINING || summary.daysLeft <= EXPIRING_DAYS;
  return (
    <Text className={`mt-0.5 text-xs ${warn ? 'font-semibold text-amber-600' : 'text-stone-400'}`}>
      잔여 {summary.remaining}회 · {dDayLabel(summary.daysLeft)}
    </Text>
  );
}

function AttendanceButton({
  label,
  active,
  disabled,
  activeClass,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  activeClass: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      hitSlop={4}
      className={`min-w-[56px] items-center rounded-full border px-3 py-2 active:opacity-70 ${
        active ? activeClass : 'border-stone-300 bg-white'
      } ${disabled ? 'opacity-35' : ''}`}>
      <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-stone-600'}`}>{label}</Text>
    </Pressable>
  );
}
