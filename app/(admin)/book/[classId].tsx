import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { ErrorView, LoadingView, Screen } from '@/components/ui';
import { useBookClass, useClassDetail, useMembers } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDay, formatTimeRange } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { classTypeLabel } from '@/lib/labels';
import type { ClassType, MemberWithPasses, Pass } from '@/lib/types';

/** DB _find_usable_pass 와 같은 기준: 유형 일치 + 활성 + 잔여 > 0 + 수업 날짜가 기간 안 */
function usableRemaining(passes: Pass[], type: ClassType, startsAt: string): number {
  const day = dayjs(startsAt).format('YYYY-MM-DD');
  return passes
    .filter((p) => p.class_type === type && p.is_active && p.remaining_count > 0 && p.starts_on <= day && day <= p.expires_on)
    .reduce((sum, p) => sum + p.remaining_count, 0);
}

type Candidate = MemberWithPasses & { remaining: number; already: boolean };

/** 직원이 회원 대신 예약 (전화·카톡 예약 접수). 차감·대기 규칙은 회원 본인 예약과 같다 */
export default function StaffBookScreen() {
  const router = useRouter();
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const { studioId } = useStudio();
  const classQuery = useClassDetail(classId);
  const membersQuery = useMembers(studioId);
  const book = useBookClass();
  const [search, setSearch] = useState('');

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/calendar'));
  const cls = classQuery.data;

  const candidates = useMemo<Candidate[]>(() => {
    if (!cls) return [];
    const booked = new Set(cls.bookings.filter((b) => b.status !== 'cancelled').map((b) => b.member?.id));
    const q = search.trim().toLowerCase();
    return (membersQuery.data ?? [])
      .filter((m) => m.role === 'member')
      .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.phone ?? '').replace(/-/g, '').includes(q.replace(/-/g, '')))
      .map((m) => ({ ...m, remaining: usableRemaining(m.passes, cls.class_type, cls.starts_at), already: booked.has(m.id) }))
      // 예약 가능한 사람 먼저
      .sort((a, b) => Number(a.already || a.remaining === 0) - Number(b.already || b.remaining === 0));
  }, [cls, membersQuery.data, search]);

  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable
        onPress={goBack}
        accessibilityLabel="뒤로"
        className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="chevron-back" size={24} color="#2F3842" />
      </Pressable>
      <Text className="ml-1 flex-1 text-lg font-bold text-ink">회원 대신 예약</Text>
    </View>
  );

  if (classQuery.isLoading || membersQuery.isLoading) {
    return (
      <Screen>
        {header}
        <LoadingView />
      </Screen>
    );
  }
  if (!cls || classQuery.isError || membersQuery.isError) {
    return (
      <Screen>
        {header}
        <ErrorView
          message={classQuery.error?.message ?? membersQuery.error?.message ?? '정보를 불러오지 못했습니다.'}
          onRetry={() => {
            void classQuery.refetch();
            void membersQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const seated = cls.bookings.filter((b) => ['confirmed', 'attended', 'no_show'].includes(b.status)).length;
  const full = seated >= cls.max_capacity;
  const typeName = cls.class_type === 'private' ? '1:1 개인' : '그룹';
  const closed = cls.status === 'cancelled' || !dayjs(cls.starts_at).isAfter(dayjs());

  const pick = (m: Candidate) => {
    const outcome =
      full && cls.max_capacity === 1
        ? null
        : full
          ? '정원이 차서 대기로 등록됩니다. 자리가 나면 자동 확정되고 그때 1회 차감됩니다.'
          : `${typeName} 수강권 1회가 차감됩니다. (잔여 ${m.remaining}회 → ${m.remaining - 1}회)`;
    if (!outcome) {
      showDialog('예약할 수 없습니다', '이미 예약이 마감된 1:1 수업입니다.');
      return;
    }
    showDialog('대신 예약', `${m.name} 회원을 예약합니다.\n${formatDay(cls.starts_at)} ${formatTimeRange(cls.starts_at, cls.ends_at)} ${cls.title}\n\n${outcome}`, [
      { text: '닫기', style: 'cancel' },
      {
        text: full ? '대기 등록' : '예약',
        onPress: () =>
          book.mutate(
            { classId: cls.id, memberId: m.id },
            {
              onSuccess: (b) => {
                showDialog(
                  b.status === 'waitlist' ? '대기로 등록했습니다' : '예약했습니다',
                  `${m.name} 회원 · ${cls.title}`,
                );
                goBack();
              },
              onError: (error) => showDialog('예약할 수 없습니다', error.message),
            },
          ),
      },
    ]);
  };

  return (
    <Screen>
      {header}
      <View className="mx-5 rounded-2xl bg-surface p-4">
        <Text className="text-sm font-semibold text-brand-600">{formatDay(cls.starts_at)}</Text>
        <Text className="mt-0.5 text-base font-bold text-ink">
          {formatTimeRange(cls.starts_at, cls.ends_at)} · {cls.title}
        </Text>
        <Text className="mt-1 text-sm text-stone-500">
          {classTypeLabel(cls.class_type, cls.max_capacity)} · {seated}/{cls.max_capacity}명
          {full ? (cls.max_capacity === 1 ? ' · 마감' : ' · 정원 마감(대기 등록)') : ''}
        </Text>
      </View>

      {closed ? (
        <Text className="mx-5 mt-4 text-center text-sm text-stone-500">시작했거나 폐강된 수업은 예약할 수 없습니다.</Text>
      ) : (
        <>
          <View className="mx-5 mt-4 flex-row items-center rounded-2xl bg-surface px-4">
            <Ionicons name="search" size={18} color="#A8A29E" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="이름 또는 전화번호"
              placeholderTextColor="#A8A29E"
              className="ml-2 flex-1 py-3 text-[16px] text-ink"
              autoCorrect={false}
            />
          </View>
          <FlatList
            data={candidates}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text className="mt-6 text-center text-sm text-stone-500">해당하는 회원이 없습니다.</Text>}
            renderItem={({ item: m }) => {
              const disabled = m.already || m.remaining === 0 || book.isPending;
              const note = m.already ? '이미 예약(대기)함' : m.remaining === 0 ? `사용 가능한 ${typeName} 수강권 없음` : `${typeName} 잔여 ${m.remaining}회`;
              return (
                <Pressable
                  onPress={() => pick(m)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  className={`mb-2 flex-row items-center rounded-2xl bg-surface px-4 py-3.5 active:opacity-70 ${disabled ? 'opacity-45' : ''}`}>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-ink">{m.name}</Text>
                    <Text className={`mt-0.5 text-sm ${m.remaining === 0 && !m.already ? 'text-rose-500' : 'text-stone-500'}`}>{note}</Text>
                  </View>
                  {!disabled ? <Ionicons name="add-circle" size={26} color="#0B7A4D" /> : null}
                </Pressable>
              );
            }}
          />
        </>
      )}
    </Screen>
  );
}
