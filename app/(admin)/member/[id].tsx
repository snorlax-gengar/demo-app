import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { PassCard } from '@/components/PassCard';
import { Badge, BRAND, EmptyView, ErrorView, LoadingView, Screen, SectionTitle } from '@/components/ui';
import { useCancelBooking, useMemberDetail, useSetMemberRole, useUpdateMemberMemo } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { dayjs, formatDate, formatDay, formatTimeRange } from '@/lib/date';
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_TONE, ROLE_LABEL, classTypeLabel } from '@/lib/labels';
import { isPassUsable } from '@/lib/passes';
import type { MemberBooking, Role, StudioPerson } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';
import { showDialog } from '@/lib/dialog';

/** 관리자용 회원 상세: 수강권 + 다가오는 예약 + 과거 출석/노쇼/취소 이력을 한 화면에 */
export default function MemberDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { studioId, isAdmin, isOwner } = useStudio();
  const myId = useAuthStore((s) => s.profile?.id);
  const detailQuery = useMemberDetail(studioId, id);
  const pull = usePullRefresh(detailQuery.refetch);
  const cancelBooking = useCancelBooking();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/members'));

  const { upcoming, history, stats } = useMemo(() => {
    const now = dayjs();
    const bookings = (detailQuery.data?.bookings ?? []).filter((b) => b.class !== null);
    const startOf = (b: MemberBooking) => dayjs(b.class!.starts_at).valueOf();

    const isUpcoming = (b: MemberBooking) =>
      (b.status === 'confirmed' || b.status === 'waitlist') && dayjs(b.class!.starts_at).isAfter(now);

    const attended = bookings.filter((b) => b.status === 'attended').length;
    const noShow = bookings.filter((b) => b.status === 'no_show').length;
    const cancelled = bookings.filter((b) => b.status === 'cancelled').length;

    return {
      upcoming: bookings.filter(isUpcoming).sort((a, b) => startOf(a) - startOf(b)),
      history: bookings.filter((b) => !isUpcoming(b)).sort((a, b) => startOf(b) - startOf(a)),
      stats: {
        attended,
        noShow,
        cancelled,
        rate: attended + noShow > 0 ? Math.round((attended / (attended + noShow)) * 100) : null,
      },
    };
  }, [detailQuery.data]);

  const passes = useMemo(() => {
    const all = detailQuery.data?.passes ?? [];
    return [...all.filter(isPassUsable), ...all.filter((p) => !isPassUsable(p))];
  }, [detailQuery.data]);

  /** 강사/원장 대리 취소: 횟수 복구 여부를 직접 선택 */
  const confirmCancel = (booking: MemberBooking) => {
    const run = (refund: boolean) =>
      cancelBooking.mutate(
        { bookingId: booking.id, refund },
        { onError: (error) => showDialog('취소할 수 없습니다', error.message) },
      );

    if (booking.status === 'waitlist') {
      showDialog('대기 취소', '이 회원의 대기 신청을 취소할까요?', [
        { text: '닫기', style: 'cancel' },
        { text: '대기 취소', style: 'destructive', onPress: () => run(false) },
      ]);
      return;
    }
    showDialog('예약 취소', `${booking.class?.title ?? '수업'} 예약을 취소합니다. 수강권 횟수를 복구할까요?`, [
      { text: '닫기', style: 'cancel' },
      { text: '복구하고 취소', onPress: () => run(true) },
      { text: '복구 없이 취소', style: 'destructive', onPress: () => run(false) },
    ]);
  };

  const profile = detailQuery.data?.profile;

  return (
    <Screen>
      {/* ── 상단 바 ── */}
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={goBack}
          accessibilityLabel="뒤로"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#1B1F1E" />
        </Pressable>
        <Text className="ml-1 text-lg font-bold text-ink">회원 상세</Text>
      </View>

      {detailQuery.isLoading ? (
        <LoadingView />
      ) : detailQuery.isError || !profile ? (
        <ErrorView
          message={detailQuery.error?.message ?? '회원 정보를 불러오지 못했습니다.'}
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={BRAND}
            />
          }>
          {/* ── 프로필 ── */}
          <View className="mx-5 mt-2 rounded-3xl bg-white p-5">
            <View className="flex-row items-center">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-100">
                <Text className="text-xl font-bold text-brand-700">{profile.name.slice(0, 1) || '?'}</Text>
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-xl font-bold text-ink">{profile.name || '이름 없음'}</Text>
                <Text className="mt-0.5 text-sm text-stone-500">
                  <Text className="font-semibold text-brand-600">{ROLE_LABEL[profile.role]}</Text> · 등록{' '}
                  {formatDate(profile.joined_at)}
                </Text>
              </View>
              {profile.phone ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${profile.phone!.replace(/[^\d+]/g, '')}`)}
                  accessibilityLabel="전화 걸기"
                  className="h-11 w-11 items-center justify-center rounded-full bg-brand-600 active:opacity-80">
                  <Ionicons name="call" size={18} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
            <Text className="mt-3 text-sm text-stone-600">
              {profile.phone || '연락처 없음'}
              {profile.email ? ` · ${profile.email}` : ''}
            </Text>
            <MemoEditor person={profile} studioId={studioId} editable={isAdmin} />

            {/* 출석 요약 */}
            <View className="mt-4 flex-row border-t border-stone-100 pt-4">
              <StatCell label="출석" value={`${stats.attended}`} />
              <StatCell label="노쇼" value={`${stats.noShow}`} tone={stats.noShow > 0 ? 'text-rose-600' : undefined} />
              <StatCell label="취소" value={`${stats.cancelled}`} />
              <StatCell label="출석률" value={stats.rate === null ? '-' : `${stats.rate}%`} />
            </View>
          </View>

          {/* ── 역할 (원장·관리자) ── */}
          {isAdmin && profile.id !== myId && (isOwner || !['owner', 'manager'].includes(profile.role)) ? (
            <RoleEditor person={profile} studioId={studioId} isOwner={isOwner} />
          ) : null}

          {/* ── 보유 수강권 ── */}
          {profile.role === 'member' ? (
            <>
              <SectionTitle
                title="보유 수강권"
                right={
                  isAdmin ? (
                    <Pressable
                      onPress={() => router.push({ pathname: '/(admin)/pass/new', params: { memberId: profile.id } })}
                      className="flex-row items-center rounded-full bg-brand-600 px-3 py-1.5 active:opacity-80">
                      <Ionicons name="add" size={16} color="#FFFFFF" />
                      <Text className="ml-0.5 text-sm font-bold text-white">발급</Text>
                    </Pressable>
                  ) : (
                    <Text className="text-sm text-stone-400">{passes.length}장</Text>
                  )
                }
              />
              {passes.length === 0 ? (
                <EmptyView
                  icon="ticket-outline"
                  title="등록된 수강권이 없습니다"
                  description={isAdmin ? "오른쪽 위 '발급'으로 수강권을 등록하세요." : undefined}
                />
              ) : (
                <View className="gap-3 px-5">
                  {passes.map((pass) => (
                    <Pressable
                      key={pass.id}
                      onPress={() => router.push({ pathname: '/(admin)/pass/[id]', params: { id: pass.id } })}
                      accessibilityLabel={`${pass.name} 상세`}
                      className="active:opacity-80">
                      <PassCard pass={pass} />
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          ) : null}

          {/* ── 다가오는 예약 ── */}
          <SectionTitle
            title="다가오는 예약"
            right={<Text className="text-sm text-stone-400">{upcoming.length}건</Text>}
          />
          {upcoming.length === 0 ? (
            <EmptyView icon="calendar-outline" title="예정된 예약이 없습니다" />
          ) : (
            <View className="mx-5 rounded-2xl bg-white px-4">
              {upcoming.map((booking, index) => (
                <BookingRow
                  key={booking.id}
                  booking={booking}
                  first={index === 0}
                  action={
                    // 원장·실장은 모든 수업, 강사는 본인 수업의 예약만 취소할 수 있다 (DB 도 같은 규칙)
                    isAdmin || booking.class?.instructor_id === myId ? (
                      <Pressable
                        onPress={() => confirmCancel(booking)}
                        disabled={cancelBooking.isPending}
                        hitSlop={6}
                        className="ml-2 rounded-full border border-stone-300 px-3 py-1.5 active:opacity-70">
                        <Text className="text-xs font-semibold text-stone-600">취소</Text>
                      </Pressable>
                    ) : undefined
                  }
                />
              ))}
            </View>
          )}

          {/* ── 지난 이력: 출석 / 노쇼 / 취소 ── */}
          <SectionTitle title="지난 이력" right={<Text className="text-sm text-stone-400">{history.length}건</Text>} />
          {history.length === 0 ? (
            <EmptyView icon="time-outline" title="지난 수업 이력이 없습니다" />
          ) : (
            <View className="mx-5 rounded-2xl bg-white px-4">
              {history.map((booking, index) => (
                <BookingRow key={booking.id} booking={booking} first={index === 0} />
              ))}
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className={`text-xl font-bold ${tone ?? 'text-ink'}`}>{value}</Text>
      <Text className="mt-0.5 text-xs text-stone-500">{label}</Text>
    </View>
  );
}

function BookingRow({
  booking,
  first,
  action,
}: {
  booking: MemberBooking;
  first: boolean;
  action?: ReactNode;
}) {
  const cls = booking.class;
  if (!cls) return null;

  // 수업은 지났는데 출석/노쇼 처리가 안 된 예약은 '미처리'로 눈에 띄게
  const unprocessed = booking.status === 'confirmed' && !dayjs(cls.starts_at).isAfter(dayjs());
  const tone = unprocessed ? { bg: 'bg-amber-50', text: 'text-amber-700' } : BOOKING_STATUS_TONE[booking.status];
  const label = unprocessed ? '출석 미처리' : BOOKING_STATUS_LABEL[booking.status];

  const note =
    booking.status === 'cancelled'
      ? booking.pass_id === null
        ? '대기 중 취소 (차감 없음)'
        : booking.pass_refunded
          ? '횟수 복구됨'
          : '횟수 복구 없음'
      : booking.promoted_at
        ? '대기에서 승격'
        : null;

  return (
    <View className={`flex-row items-center py-3.5 ${first ? '' : 'border-t border-stone-100'}`}>
      <View className="flex-1 pr-2">
        <Text className="text-sm font-semibold text-ink">
          {formatDay(cls.starts_at)} {formatTimeRange(cls.starts_at, cls.ends_at)}
        </Text>
        <Text className="mt-0.5 text-sm text-stone-500" numberOfLines={1}>
          {cls.title} · {classTypeLabel(cls.class_type, cls.max_capacity)}
          {cls.instructor ? ` · ${cls.instructor.name}` : ''}
        </Text>
        {note ? <Text className="mt-0.5 text-xs text-stone-400">{note}</Text> : null}
      </View>
      <Badge label={label} bg={tone.bg} text={tone.text} />
      {action}
    </View>
  );
}

/** 스튜디오 메모: 부상 이력·선호 등. 원장·관리자만 수정, 직원은 열람 */
function MemoEditor({ person, studioId, editable }: { person: StudioPerson; studioId: string; editable: boolean }) {
  const updateMemo = useUpdateMemberMemo();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person.memo ?? '');
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // 편집을 열면 입력칸에 커서를 둔다. 웹에서 autoFocus 를 쓰면 브라우저가 화면 전체를 끌어올려
  // 레이아웃이 밀리므로 preventScroll 로 포커스만 준다
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current as unknown as {
      focus: (o?: { preventScroll?: boolean }) => void;
      setSelectionRange?: (start: number, end: number) => void;
      value?: string;
    } | null;
    if (Platform.OS === 'web') {
      el?.focus({ preventScroll: true });
      // 기존 메모 뒤에 이어 쓰도록 커서를 끝으로 (웹은 기본이 맨 앞)
      const end = el?.value?.length ?? 0;
      el?.setSelectionRange?.(end, end);
    } else el?.focus();
  }, [editing]);

  if (!editing) {
    if (!person.memo && !editable) return null;
    return (
      <Pressable
        disabled={!editable}
        onPress={() => {
          setDraft(person.memo ?? '');
          setEditing(true);
        }}
        className={`mt-3 flex-row items-start rounded-xl px-3 py-2.5 ${person.memo ? 'bg-amber-50' : 'border border-dashed border-stone-300'}`}>
        <Text className={`flex-1 text-sm ${person.memo ? 'text-amber-900' : 'text-stone-400'}`}>
          {person.memo || '메모 추가 (부상 이력, 선호 시간 등)'}
        </Text>
        {editable ? <Ionicons name="create-outline" size={16} color={person.memo ? '#92400E' : '#A8A29E'} /> : null}
      </Pressable>
    );
  }

  const save = () =>
    updateMemo.mutate(
      { studioId, userId: person.id, memo: draft },
      {
        onSuccess: () => setEditing(false),
        onError: (error) => showDialog('저장할 수 없습니다', error.message),
      },
    );

  return (
    <View className="mt-3">
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="부상 이력, 선호 시간 등"
        placeholderTextColor="#A8A29E"
        ref={inputRef}
        multiline
        maxLength={500}
        className="min-h-[72px] rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        style={{ textAlignVertical: 'top' }}
      />
      <View className="mt-2 flex-row justify-end gap-2">
        <Pressable onPress={() => setEditing(false)} className="rounded-full px-4 py-2 active:opacity-70">
          <Text className="text-sm font-semibold text-stone-500">취소</Text>
        </Pressable>
        <Pressable onPress={save} disabled={updateMemo.isPending} className="min-w-[64px] items-center rounded-full bg-ink px-4 py-2 active:opacity-80">
          {updateMemo.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text className="text-sm font-semibold text-white">저장</Text>}
        </Pressable>
      </View>
    </View>
  );
}

/** 역할 변경: 원장은 관리자·강사·회원, 관리자는 강사·회원만 (관리자 지정·해제는 원장 전용) */
function RoleEditor({ person, studioId, isOwner }: { person: StudioPerson; studioId: string; isOwner: boolean }) {
  const setRole = useSetMemberRole();
  const options: Role[] = isOwner ? ['owner', 'manager', 'instructor', 'member'] : ['instructor', 'member'];
  const locked = !isOwner && (person.role === 'manager' || person.role === 'owner');

  const DESCRIPTIONS: Record<Role, string> = {
    owner: '모든 권한(매출 포함). 다른 원장·관리자 지정 가능',
    manager: '수업·회원·수강권·초대 코드 관리. 매출은 볼 수 없음',
    instructor: '본인 수업 등록·출석 처리, 회원 잔여 횟수 열람',
    member: '수업 예약·취소만',
  };

  const change = (role: Role) => {
    if (role === person.role) return;
    const warn = role === 'owner' ? '\n\n원장은 매출을 포함한 모든 정보를 볼 수 있고, 다른 원장도 해제할 수 있습니다.' : '';
    showDialog(`${person.name || '이 사람'}을(를) ${ROLE_LABEL[role]}(으)로 바꿀까요?`, DESCRIPTIONS[role] + warn, [
      { text: '닫기', style: 'cancel' },
      {
        text: '바꾸기',
        onPress: () =>
          setRole.mutate(
            { studioId, userId: person.id, role },
            { onError: (error) => showDialog('바꿀 수 없습니다', error.message) },
          ),
      },
    ]);
  };

  return (
    <View className="mx-5 mt-4 rounded-3xl bg-white p-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-ink">역할</Text>
        {setRole.isPending ? <ActivityIndicator size="small" color={BRAND} /> : null}
      </View>
      {locked ? (
        <Text className="mt-2 text-sm text-stone-500">원장·관리자의 역할은 원장만 바꿀 수 있습니다.</Text>
      ) : (
        <>
          <View className="mt-3 flex-row gap-2">
            {options.map((role) => {
              const active = person.role === role;
              return (
                <Pressable
                  key={role}
                  onPress={() => change(role)}
                  disabled={setRole.isPending}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  className={`flex-1 items-center rounded-2xl border-2 py-2.5 ${active ? 'border-brand-600 bg-brand-50' : 'border-stone-200'}`}>
                  <Text className={`text-sm font-bold ${active ? 'text-brand-700' : 'text-stone-500'}`}>{ROLE_LABEL[role]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="mt-2 text-xs text-stone-400">
            {DESCRIPTIONS[person.role]}
          </Text>
        </>
      )}
    </View>
  );
}
