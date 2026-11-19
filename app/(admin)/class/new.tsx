import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DatePickerModal';
import { Chip, Choice, Field, Row, Stepper } from '@/components/form';
import { Screen } from '@/components/ui';
import { useCreateClasses, useInstructors } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDay } from '@/lib/date';
import type { ClassType, NewClassInput } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';
import { showDialog } from '@/lib/dialog';

const DURATIONS = [30, 50, 60, 90];
const REPEATS = [
  { weeks: 1, label: '반복 안 함' },
  { weeks: 4, label: '4주' },
  { weeks: 8, label: '8주' },
  { weeks: 12, label: '12주' },
];
const MIN_GROUP = 2;
const MAX_GROUP = 10;

const defaultTitle = (type: ClassType, capacity: number) =>
  type === 'private' ? '1:1 개인 레슨' : `${capacity}:1 그룹 레슨`;

export default function NewClassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; hour?: string }>();
  const profile = useAuthStore((s) => s.profile);
  const { studioId, isAdmin } = useStudio();
  const instructorsQuery = useInstructors(studioId);
  const createClasses = useCreateClasses();

  const initialDate = params.date && dayjs(params.date).isValid() ? dayjs(params.date).startOf('day') : dayjs().startOf('day');
  const initialHour = Math.min(23, Math.max(0, Number(params.hour ?? 10) || 10));

  const [type, setType] = useState<ClassType>('group');
  const [capacity, setCapacity] = useState(4);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [hour, setHour] = useState(initialHour);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(50);
  const [instructorId, setInstructorId] = useState(profile?.id ?? '');
  const [location, setLocation] = useState('');
  const [repeatWeeks, setRepeatWeeks] = useState(1);

  // 주소로 바로 연 경우(뒤로 갈 화면 없음)에는 달력으로
  const close = () => (router.canGoBack() ? router.back() : router.replace('/calendar'));
  const effectiveCapacity = type === 'private' ? 1 : capacity;
  const finalTitle = title.trim() || defaultTitle(type, effectiveCapacity);
  const start = date.hour(hour).minute(minute).second(0).millisecond(0);
  const end = start.add(duration, 'minute');
  const isPast = !start.isAfter(dayjs());

  const instructorName = useMemo(
    () => instructorsQuery.data?.find((i) => i.id === instructorId)?.name ?? profile?.name ?? '',
    [instructorsQuery.data, instructorId, profile?.name],
  );

  const summary =
    repeatWeeks === 1
      ? `${formatDay(start)} ${start.format('HH:mm')}–${end.format('HH:mm')} · 1회`
      : `${formatDay(start)}부터 매주 ${start.format('dd')}요일 ${start.format('HH:mm')}–${end.format('HH:mm')} · 총 ${repeatWeeks}회`;

  const onSubmit = () => {
    if (isPast) {
      showDialog('시간을 확인해 주세요', '이미 지난 시간에는 수업을 등록할 수 없습니다.');
      return;
    }
    if (!instructorId) {
      showDialog('담당 강사를 선택해 주세요');
      return;
    }
    const rows: NewClassInput[] = Array.from({ length: repeatWeeks }, (_, i) => {
      const s = start.add(i * 7, 'day');
      return {
        studio_id: studioId,
        title: finalTitle,
        instructor_id: instructorId,
        starts_at: s.toISOString(),
        ends_at: s.add(duration, 'minute').toISOString(),
        max_capacity: effectiveCapacity,
        location: location.trim() || null,
      };
    });

    createClasses.mutate(rows, {
      onSuccess: (count) => {
        showDialog('등록했습니다', `${finalTitle} ${count}회를 달력에 추가했습니다.`);
        close();
      },
      onError: (error) =>
        showDialog(
          '등록할 수 없습니다',
          repeatWeeks > 1 ? `${error.message}\n(반복 일정 중 하나라도 겹치면 전체가 등록되지 않습니다.)` : error.message,
        ),
    });
  };

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={close}
          accessibilityLabel="닫기"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="close" size={24} color="#2F3842" />
        </Pressable>
        <Text className="ml-1 text-lg font-bold text-ink">수업 등록</Text>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {/* 유형 */}
          <Field label="수업 유형">
            <View className="flex-row gap-2">
              <Choice
                label="1:1 개인"
                sub="정원 1명 · 대기 없음"
                active={type === 'private'}
                onPress={() => setType('private')}
              />
              <Choice label="그룹" sub="만석 시 대기 신청" active={type === 'group'} onPress={() => setType('group')} />
            </View>
            {type === 'group' ? (
              <View className="mt-3 flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <Text className="text-base text-ink">정원</Text>
                <Stepper
                  value={`${capacity}명`}
                  onMinus={() => setCapacity((c) => Math.max(MIN_GROUP, c - 1))}
                  onPlus={() => setCapacity((c) => Math.min(MAX_GROUP, c + 1))}
                  minusDisabled={capacity <= MIN_GROUP}
                  plusDisabled={capacity >= MAX_GROUP}
                />
              </View>
            ) : null}
          </Field>

          {/* 이름 */}
          <Field label="수업 이름">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={defaultTitle(type, effectiveCapacity)}
              placeholderTextColor="#A8A29E"
              className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
            />
          </Field>

          {/* 날짜·시간 */}
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
                <View className="flex-row gap-1.5">
                  {DURATIONS.map((d) => (
                    <Chip key={d} label={`${d}분`} active={duration === d} onPress={() => setDuration(d)} />
                  ))}
                </View>
              </Row>
            </View>
            {isPast ? <Text className="mt-2 text-sm text-rose-600">이미 지난 시간입니다.</Text> : null}
          </Field>

          {/* 반복 */}
          <Field label="매주 반복">
            <View className="flex-row flex-wrap gap-2">
              {REPEATS.map((r) => (
                <Chip key={r.weeks} label={r.label} active={repeatWeeks === r.weeks} onPress={() => setRepeatWeeks(r.weeks)} large />
              ))}
            </View>
          </Field>

          {/* 강사 */}
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
                <Text className="text-base text-ink">{profile?.name} (나)</Text>
              </View>
            )}
          </Field>

          {/* 장소 */}
          <Field label="장소 (선택)">
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="예: A룸"
              placeholderTextColor="#A8A29E"
              className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
            />
          </Field>
        </ScrollView>

        {/* 요약 + 등록 */}
        <View className="border-t border-stone-200 bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
            {finalTitle} · {instructorName}
          </Text>
          <Text className="mt-0.5 text-sm text-stone-500">{summary}</Text>
          <Pressable
            onPress={onSubmit}
            disabled={createClasses.isPending}
            className={`mt-3 items-center rounded-2xl py-4 active:opacity-80 ${isPast ? 'bg-brand-200' : 'bg-brand-600'}`}>
            {createClasses.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-base font-bold text-white">{repeatWeeks > 1 ? `${repeatWeeks}회 등록` : '등록'}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
