import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DatePickerModal';
import { Chip, Field, Row, Stepper } from '@/components/form';
import { ErrorView, LoadingView, Screen } from '@/components/ui';
import { useClassDetail, useInstructors, useUpdateClass } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDay } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { useAuthStore } from '@/stores/auth';

const BASE_DURATIONS = [30, 50, 60, 90];

/** 수업 정보 수정: 이름·날짜·시간·길이·담당 강사(원장·관리자)·장소 */
export default function EditClassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useAuthStore((s) => s.profile);
  const { studioId, isAdmin } = useStudio();
  const detailQuery = useClassDetail(id);
  const instructorsQuery = useInstructors(studioId);
  const updateClass = useUpdateClass();

  const cls = detailQuery.data;

  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => dayjs().startOf('day'));
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(50);
  const [instructorId, setInstructorId] = useState('');
  const [location, setLocation] = useState('');

  useEffect(() => {
    if (!cls || loaded) return;
    const s = dayjs(cls.starts_at);
    const e = dayjs(cls.ends_at);
    const mins = Math.max(10, e.diff(s, 'minute'));
    setTitle(cls.title);
    setDate(s.startOf('day'));
    setHour(s.hour());
    setMinute(s.minute());
    setDuration(mins);
    setInstructorId(cls.instructor_id);
    setLocation(cls.location ?? '');
    setLoaded(true);
  }, [cls, loaded]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/calendar'));

  const durations = useMemo(
    () => (BASE_DURATIONS.includes(duration) ? BASE_DURATIONS : [...BASE_DURATIONS, duration].sort((a, b) => a - b)),
    [duration],
  );

  const start = date.hour(hour).minute(minute).second(0).millisecond(0);
  const end = start.add(duration, 'minute');
  const isPast = !start.isAfter(dayjs());

  const instructorName = useMemo(
    () => instructorsQuery.data?.find((i) => i.id === instructorId)?.name ?? cls?.instructor?.name ?? '',
    [instructorsQuery.data, instructorId, cls?.instructor?.name],
  );

  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable
        onPress={close}
        accessibilityLabel="닫기"
        className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="close" size={24} color="#2F3842" />
      </Pressable>
      <Text className="ml-1 text-lg font-bold text-ink">수업 정보 수정</Text>
    </View>
  );

  if (detailQuery.isLoading || (cls && !loaded)) {
    return (
      <Screen>
        {header}
        <LoadingView />
      </Screen>
    );
  }

  if (detailQuery.isError || !cls) {
    return (
      <Screen>
        {header}
        <ErrorView message={detailQuery.error?.message ?? '수업을 불러오지 못했습니다.'} onRetry={() => void detailQuery.refetch()} />
      </Screen>
    );
  }

  const cancelled = cls.status === 'cancelled';
  const started = !dayjs(cls.starts_at).isAfter(dayjs());
  const canManage = isAdmin || cls.instructor_id === profile?.id;

  if (!canManage || cancelled || started) {
    return (
      <Screen>
        {header}
        <ErrorView
          message={
            cancelled
              ? '폐강된 수업은 수정할 수 없습니다.'
              : started
                ? '이미 시작된 수업은 수정할 수 없습니다.'
                : '이 수업을 수정할 권한이 없습니다.'
          }
          onRetry={close}
        />
      </Screen>
    );
  }

  const activeBookings = cls.bookings.filter((b) => b.status !== 'cancelled').length;
  const timeChanged = !start.isSame(dayjs(cls.starts_at)) || !end.isSame(dayjs(cls.ends_at));
  const finalTitle = title.trim() || cls.title;

  const save = () => {
    if (isPast) {
      showDialog('시간을 확인해 주세요', '이미 지난 시간으로는 변경할 수 없습니다.');
      return;
    }
    if (!instructorId) {
      showDialog('담당 강사를 선택해 주세요');
      return;
    }

    const commit = () =>
      updateClass.mutate(
        {
          classId: cls.id,
          title: finalTitle,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          instructor_id: instructorId,
          location: location.trim() || null,
        },
        {
          onSuccess: () => {
            showDialog('수정했습니다', `${finalTitle} · ${formatDay(start)} ${start.format('HH:mm')}–${end.format('HH:mm')}`);
            close();
          },
          onError: (error) => showDialog('수정할 수 없습니다', error.message),
        },
      );

    if (activeBookings > 0 && timeChanged) {
      showDialog(
        '예약된 회원이 있습니다',
        `현재 예약·대기 중인 회원이 ${activeBookings}명 있습니다. 수업 시간을 바꾸면 회원에게 별도로 안내해 주세요.\n\n변경할까요?`,
        [
          { text: '닫기', style: 'cancel' },
          { text: '변경하기', onPress: commit },
        ],
      );
      return;
    }
    commit();
  };

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {activeBookings > 0 ? (
            <View className="mt-2 flex-row items-start rounded-2xl bg-amber-50 px-4 py-3">
              <Ionicons name="information-circle-outline" size={18} color="#B45309" />
              <Text className="ml-2 flex-1 text-xs leading-5 text-amber-800">
                현재 예약·대기 중인 회원이 {activeBookings}명 있습니다. 시간이나 강사를 바꾸면 회원에게 직접 안내해 주세요.
              </Text>
            </View>
          ) : null}

          <Field label="수업 이름">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={cls.title}
              placeholderTextColor="#A8A29E"
              maxLength={60}
              className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
            />
          </Field>

          <Field label="날짜와 시간">
            <View className="rounded-2xl bg-surface px-4">
              <Row label="날짜">
                <DateField
                  value={date}
                  label={formatDay(date)}
                  onChange={setDate}
                  minDate={dayjs().startOf('day')}
                  modalTitle="수업 날짜 선택"
                />
              </Row>
              <Row label="시작" border>
                <View className="flex-row items-center gap-2">
                  <Stepper
                    value={String(hour).padStart(2, '0')}
                    onMinus={() => setHour((h) => (h + 23) % 24)}
                    onPlus={() => setHour((h) => (h + 1) % 24)}
                  />
                  <Text className="text-base font-bold text-ink">:</Text>
                  <Stepper
                    value={String(minute).padStart(2, '0')}
                    onMinus={() => setMinute((m) => (m + 50) % 60)}
                    onPlus={() => setMinute((m) => (m + 10) % 60)}
                  />
                </View>
              </Row>
              <Row label="길이" border>
                <View className="flex-row flex-wrap justify-end gap-1.5">
                  {durations.map((d) => (
                    <Chip key={d} label={`${d}분`} active={duration === d} onPress={() => setDuration(d)} />
                  ))}
                </View>
              </Row>
            </View>
            {isPast ? <Text className="mt-2 text-sm text-rose-600">이미 지난 시간입니다.</Text> : null}
          </Field>

          <Field label="담당 강사">
            {isAdmin ? (
              instructorsQuery.isLoading ? (
                <ActivityIndicator color="#0B7A4D" />
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {(instructorsQuery.data ?? []).map((i) => (
                    <Chip
                      key={i.id}
                      label={i.id === profile?.id ? `${i.name} (나)` : i.name}
                      active={instructorId === i.id}
                      onPress={() => setInstructorId(i.id)}
                      large
                    />
                  ))}
                </View>
              )
            ) : (
              <View className="rounded-2xl bg-surface px-4 py-3.5">
                <Text className="text-base text-ink">{cls.instructor?.name ?? profile?.name}</Text>
                <Text className="mt-0.5 text-xs text-stone-400">담당 강사 변경은 원장 또는 관리자만 할 수 있습니다.</Text>
              </View>
            )}
          </Field>

          <Field label="장소 (선택)">
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="예: A룸"
              placeholderTextColor="#A8A29E"
              maxLength={40}
              className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
            />
          </Field>
        </ScrollView>

        <View className="border-t border-stone-200 bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
            {finalTitle} · {instructorName}
          </Text>
          <Text className="mt-0.5 text-sm text-stone-500">
            {formatDay(start)} {start.format('HH:mm')}–{end.format('HH:mm')}
          </Text>
          <Pressable
            onPress={save}
            disabled={updateClass.isPending}
            className={`mt-3 items-center rounded-2xl py-4 active:opacity-80 ${isPast ? 'bg-brand-200' : 'bg-brand-600'}`}>
            {updateClass.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-base font-bold text-white">저장</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
