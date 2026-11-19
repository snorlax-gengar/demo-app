import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';

import { NotificationBell } from '@/components/NotificationBell';
import { ROLE_LABEL } from '@/lib/labels';
import { classTiming, StaffClassCard, type AttendanceTarget } from '@/components/StaffClassCard';
import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useMarkAttendance, useTimeline } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { dayjs, formatDay, formatTime } from '@/lib/date';
import type { TimelineBooking, TimelineClass } from '@/lib/types';
import { useAdminViewStore } from '@/stores/adminView';
import { useAuthStore } from '@/stores/auth';
import { showDialog } from '@/lib/dialog';

export default function StaffTimelineScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const { studioId, studio, role, isAdmin } = useStudio();

  const showAll = useAdminViewStore((s) => s.showAllInstructors);
  const setShowAll = useAdminViewStore((s) => s.setShowAllInstructors);

  const [day, setDay] = useState(() => dayjs().startOf('day'));
  const isToday = day.isSame(dayjs(), 'day');

  // [강사 뷰 고정] 강사는 항상 본인 수업만. 원장만 토글로 전체 강사를 볼 수 있다.
  const viewingAll = isAdmin && showAll;
  const timelineQuery = useTimeline(studioId, day, viewingAll ? null : (profile?.id ?? null));
  const pull = usePullRefresh(timelineQuery.refetch);
  const markAttendance = useMarkAttendance();

  const classes = timelineQuery.data ?? [];
  const seated = classes.flatMap((cls) => cls.bookings.filter((b) => b.status !== 'waitlist'));
  const summary = {
    classes: classes.length,
    booked: seated.length,
    attended: seated.filter((b) => b.status === 'attended').length,
    noShow: seated.filter((b) => b.status === 'no_show').length,
  };

  /** 원클릭 처리: 같은 버튼을 다시 누르면 '예약 확정'으로 되돌린다 */
  const onMark = (booking: TimelineBooking, target: AttendanceTarget) => {
    markAttendance.mutate(
      { bookingId: booking.id, status: booking.status === target ? 'confirmed' : target },
      { onError: (error) => showDialog('처리할 수 없습니다', error.message) },
    );
  };

  const openMember = (memberId: string) =>
    router.push({ pathname: '/(admin)/member/[id]', params: { id: memberId } });
  const openClass = (classId: string) => router.push({ pathname: '/(admin)/class/[id]', params: { id: classId } });

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={BRAND}
          />
        }>
        {/* ── 헤더 + 날짜 이동 ── */}
        <View className="flex-row items-start justify-between px-5 pt-4">
          <View className="flex-1 pr-3">
            <Text className="text-sm text-stone-500">{studio?.name} · {profile?.name} {role ? ROLE_LABEL[role] : ''}님</Text>
            <Text className="mt-0.5 text-2xl font-bold text-ink">
              {isToday ? '오늘의 ' : `${day.format('M/D')} `}
              {viewingAll ? '전체 수업' : '내 수업'}
            </Text>
          </View>
          <NotificationBell />
        </View>
        <View className="mt-2 flex-row items-center justify-between px-5">
          <Text className="text-sm text-stone-500">{formatDay(day)}</Text>
          <View className="flex-row items-center gap-2">
            {!isToday ? (
              <Pressable
                onPress={() => setDay(dayjs().startOf('day'))}
                className="rounded-full bg-brand-50 px-3 py-2 active:opacity-70">
                <Text className="text-sm font-semibold text-brand-700">오늘</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setDay(day.subtract(1, 'day'))}
              accessibilityLabel="이전 날"
              className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70">
              <Ionicons name="chevron-back" size={20} color="#44403C" />
            </Pressable>
            <Pressable
              onPress={() => setDay(day.add(1, 'day'))}
              accessibilityLabel="다음 날"
              className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70">
              <Ionicons name="chevron-forward" size={20} color="#44403C" />
            </Pressable>
          </View>
        </View>

        {/* ── 원장 전용: 전체 강사 보기 토글 ── */}
        {isAdmin ? (
          <View className="mx-5 mt-4 flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3">
            <View className="flex-1 pr-3">
              <Text className="text-base font-semibold text-ink">전체 강사 보기</Text>
              <Text className="mt-0.5 text-xs text-stone-500">
                {showAll ? '모든 강사의 수업을 보고 있습니다' : '내 담당 수업만 보고 있습니다'}
              </Text>
            </View>
            <Switch
              value={showAll}
              onValueChange={setShowAll}
              trackColor={{ true: '#0B7A4D', false: '#D6D3D1' }}
              thumbColor="#FFFFFF"
            />
          </View>
        ) : null}

        {/* ── 요약 ── */}
        <View className="mx-5 mt-4 flex-row rounded-2xl bg-brand-700 px-2 py-4">
          <SummaryCell label="수업" value={summary.classes} />
          <SummaryCell label="예약" value={summary.booked} />
          <SummaryCell label="출석" value={summary.attended} />
          <SummaryCell label="노쇼" value={summary.noShow} />
        </View>

        {/* ── 타임라인 ── */}
        <View className="mt-6">
          {timelineQuery.isLoading ? (
            <LoadingView />
          ) : timelineQuery.isError ? (
            <ErrorView message={timelineQuery.error.message} onRetry={() => void timelineQuery.refetch()} />
          ) : classes.length === 0 ? (
            <EmptyView
              icon="cafe-outline"
              title={viewingAll ? '이 날은 수업이 없습니다' : '이 날은 담당 수업이 없습니다'}
              description={isAdmin && !showAll ? "'전체 강사 보기'를 켜면 다른 강사의 수업도 볼 수 있습니다." : undefined}
            />
          ) : (
            <View className="px-5">
              {classes.map((cls, index) => (
                <TimelineItem
                  key={cls.id}
                  cls={cls}
                  isLast={index === classes.length - 1}
                  showInstructor={viewingAll}
                  onMark={onMark}
                  onOpenMember={openMember}
                  onOpenClass={openClass}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-2xl font-bold text-white">{value}</Text>
      <Text className="mt-0.5 text-xs text-brand-100">{label}</Text>
    </View>
  );
}

interface TimelineItemProps {
  cls: TimelineClass;
  isLast: boolean;
  showInstructor: boolean;
  onMark: (booking: TimelineBooking, target: AttendanceTarget) => void;
  onOpenMember: (memberId: string) => void;
  onOpenClass: (classId: string) => void;
}

/** 시간축 + 수업 카드 */
function TimelineItem({ cls, isLast, ...cardProps }: TimelineItemProps) {
  const { inProgress, finished } = classTiming(cls);

  return (
    <View className="flex-row">
      <View className="w-14 items-center">
        <Text className={`text-sm font-bold ${finished ? 'text-stone-400' : 'text-ink'}`}>{formatTime(cls.starts_at)}</Text>
        <View
          className={`mt-1.5 h-3 w-3 rounded-full border-2 ${
            inProgress ? 'border-brand-500 bg-brand-500' : finished ? 'border-stone-300 bg-stone-300' : 'border-brand-500 bg-canvas'
          }`}
        />
        {!isLast ? <View className="mt-1 w-px flex-1 bg-stone-300" /> : null}
      </View>
      <View className="mb-4 ml-2 flex-1">
        <StaffClassCard cls={cls} {...cardProps} />
      </View>
    </View>
  );
}
