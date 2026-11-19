import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { StaffClassCard, type AttendanceTarget } from '@/components/StaffClassCard';
import { BRAND, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useCancelClass, useClassDetail, useMarkAttendance, useUpdateCapacity } from '@/hooks/queries';
import { dayjs, formatDay, formatTimeRange } from '@/lib/date';
import type { TimelineBooking } from '@/lib/types';
import { useStudio } from '@/hooks/useStudio';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useAuthStore } from '@/stores/auth';
import { showDialog } from '@/lib/dialog';

const MAX_GROUP = 10;

/** 수업 상세: 출석부 + 정원 변경 + 폐강 */
export default function ClassDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useAuthStore((s) => s.profile);
  const { isAdmin } = useStudio();
  const detailQuery = useClassDetail(id);
  const pull = usePullRefresh(detailQuery.refetch);
  const markAttendance = useMarkAttendance();
  const updateCapacity = useUpdateCapacity();
  const cancelClass = useCancelClass();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/calendar'));
  const cls = detailQuery.data;

  const onMark = (booking: TimelineBooking, target: AttendanceTarget) =>
    markAttendance.mutate(
      { bookingId: booking.id, status: booking.status === target ? 'confirmed' : target },
      { onError: (error) => showDialog('처리할 수 없습니다', error.message) },
    );
  const openMember = (memberId: string) => router.push({ pathname: '/(admin)/member/[id]', params: { id: memberId } });

  const body = () => {
    if (detailQuery.isLoading) return <LoadingView />;
    if (detailQuery.isError || !cls) {
      return (
        <ErrorView message={detailQuery.error?.message ?? '수업을 불러오지 못했습니다.'} onRetry={() => void detailQuery.refetch()} />
      );
    }

    const cancelled = cls.status === 'cancelled';
    const started = !dayjs(cls.starts_at).isAfter(dayjs());
    const canManage = isAdmin || cls.instructor_id === profile?.id;
    const seated = cls.bookings.filter((b) => b.status !== 'waitlist').length;
    const waiting = cls.bookings.filter((b) => b.status === 'waitlist').length;
    const minCapacity = Math.max(2, seated);
    const editable = canManage && !cancelled && !started;

    const changeCapacity = (next: number) =>
      updateCapacity.mutate(
        { classId: cls.id, capacity: next },
        {
          onSuccess: () => {
            if (next > cls.max_capacity && waiting > 0) {
              showDialog('정원을 늘렸습니다', '대기자가 순서대로 자동 예약 확정되었습니다.');
            }
          },
          onError: (error) => showDialog('변경할 수 없습니다', error.message),
        },
      );

    const confirmCancelClass = () =>
      showDialog(
        '폐강',
        `${formatDay(cls.starts_at)} ${cls.title}을(를) 폐강합니다.\n\n예약 확정 ${seated}명은 수강권 1회가 복구되고, 대기 ${waiting}명은 취소됩니다. 되돌릴 수 없습니다.`,
        [
          { text: '닫기', style: 'cancel' },
          {
            text: '폐강',
            style: 'destructive',
            onPress: () =>
              cancelClass.mutate(cls.id, {
                onSuccess: (count) => {
                  showDialog('폐강했습니다', count > 0 ? `예약 ${count}건을 정리했습니다.` : undefined);
                  goBack();
                },
                onError: (error) => showDialog('폐강할 수 없습니다', error.message),
              }),
          },
        ],
      );

    return (
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={BRAND} />
        }>
        <Text className="mt-2 text-sm font-semibold text-brand-600">{formatDay(cls.starts_at)}</Text>
        <Text className="mt-0.5 text-2xl font-bold text-ink">{formatTimeRange(cls.starts_at, cls.ends_at)}</Text>
        <Text className="mt-1 text-sm text-stone-500">
          {cls.instructor?.name} 강사{cls.location ? ` · ${cls.location}` : ''}
        </Text>

        {cancelled ? (
          <View className="mt-4 flex-row items-center rounded-2xl bg-stone-200 px-4 py-3">
            <Ionicons name="close-circle" size={18} color="#57534E" />
            <Text className="ml-2 text-sm font-semibold text-stone-600">폐강된 수업입니다</Text>
          </View>
        ) : null}

        <View className="mt-4">
          <StaffClassCard cls={cls} showInstructor={false} onMark={onMark} onOpenMember={openMember} />
        </View>

        {editable ? (
          <Pressable
            onPress={() => router.push({ pathname: '/(admin)/book/[classId]', params: { classId: cls.id } })}
            accessibilityRole="button"
            className="mt-3 flex-row items-center justify-center rounded-2xl border border-brand-200 bg-brand-50 py-3.5 active:opacity-70">
            <Ionicons name="person-add-outline" size={18} color="#0B7A4D" />
            <Text className="ml-2 text-base font-semibold text-brand-700">회원 대신 예약</Text>
          </Pressable>
        ) : null}

        {editable ? (
          <View className="mt-6">
            <Text className="mb-2 text-sm font-semibold text-stone-600">수업 관리</Text>
            <View className="rounded-2xl bg-surface px-4">
              {cls.class_type === 'group' ? (
                <View className="py-3.5">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-base text-ink">정원</Text>
                    <View className="flex-row items-center">
                      <Pressable
                        onPress={() => changeCapacity(cls.max_capacity - 1)}
                        disabled={cls.max_capacity <= minCapacity || updateCapacity.isPending}
                        accessibilityLabel="정원 줄이기"
                        className={`h-9 w-9 items-center justify-center rounded-full bg-stone-100 active:opacity-70 ${
                          cls.max_capacity <= minCapacity ? 'opacity-30' : ''
                        }`}>
                        <Ionicons name="remove" size={18} color="#44403C" />
                      </Pressable>
                      <Text className="mx-3 min-w-[36px] text-center text-base font-bold text-ink">{cls.max_capacity}명</Text>
                      <Pressable
                        onPress={() => changeCapacity(cls.max_capacity + 1)}
                        disabled={cls.max_capacity >= MAX_GROUP || updateCapacity.isPending}
                        accessibilityLabel="정원 늘리기"
                        className={`h-9 w-9 items-center justify-center rounded-full bg-stone-100 active:opacity-70 ${
                          cls.max_capacity >= MAX_GROUP ? 'opacity-30' : ''
                        }`}>
                        <Ionicons name="add" size={18} color="#44403C" />
                      </Pressable>
                    </View>
                  </View>
                  <Text className="mt-1.5 text-xs text-stone-400">
                    {waiting > 0
                      ? `정원을 늘리면 대기 ${waiting}명이 순서대로 자동 예약 확정됩니다.`
                      : `현재 예약 인원(${seated}명) 아래로는 줄일 수 없습니다.`}
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => router.push({ pathname: '/(admin)/class/edit', params: { id: cls.id } })}
                accessibilityRole="button"
                className={`flex-row items-center py-4 active:opacity-60 ${cls.class_type === 'group' ? 'border-t border-stone-100' : ''}`}>
                <Ionicons name="create-outline" size={18} color="#0B7A4D" />
                <Text className="ml-2 flex-1 text-base font-semibold text-ink">수업 정보 수정 (시간·장소·강사)</Text>
                <Ionicons name="chevron-forward" size={18} color="#A8A29E" />
              </Pressable>
              <Pressable
                onPress={confirmCancelClass}
                disabled={cancelClass.isPending}
                className="flex-row items-center border-t border-stone-100 py-4 active:opacity-60">
                <Ionicons name="trash-outline" size={18} color="#E11D48" />
                <Text className="ml-2 text-base font-semibold text-rose-600">폐강 (예약자 수강권 복구)</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={goBack}
          accessibilityLabel="뒤로"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#2F3842" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink" numberOfLines={1}>
          {cls?.title ?? '수업 상세'}
        </Text>
      </View>
      {body()}
    </Screen>
  );
}
