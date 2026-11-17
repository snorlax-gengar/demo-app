import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { PassCard } from '@/components/PassCard';
import { BRAND, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useAdjustPass, useExtendPass, usePassDetail, useSetPassActive } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDate } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { PASS_LOG_LABEL, PAYMENT_METHOD_LABEL, formatWon } from '@/lib/labels';
import type { PassLog } from '@/lib/types';

const EXTEND_PRESETS = [7, 14, 30];

/** 수강권 상세: 기간 연장·횟수 조정·사용 중지/재개(원장·관리자) + 변동 내역 + 결제(원장만) */
export default function PassDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin, isOwner } = useStudio();
  const detailQuery = usePassDetail(id);
  const extendPass = useExtendPass();
  const adjustPass = useAdjustPass();
  const setActive = useSetPassActive();
  const [memo, setMemo] = useState('');

  const busy = extendPass.isPending || adjustPass.isPending || setActive.isPending;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/members'));
  const onDone = () => setMemo('');
  const onError = (title: string) => (error: Error) => showDialog(title, error.message);

  const data = detailQuery.data;

  const confirmExtend = (days: number) => {
    if (!data) return;
    const next = dayjs(data.pass.expires_on).add(days, 'day');
    showDialog(`${days > 0 ? `${days}일 연장` : `${-days}일 단축`}`, `만료일 ${formatDate(data.pass.expires_on)} → ${formatDate(next.toISOString())}`, [
      { text: '닫기', style: 'cancel' },
      {
        text: '적용',
        onPress: () => extendPass.mutate({ passId: data.pass.id, days, memo }, { onSuccess: onDone, onError: onError('변경할 수 없습니다') }),
      },
    ]);
  };

  const confirmAdjust = (delta: number) => {
    if (!data) return;
    const next = data.pass.remaining_count + delta;
    showDialog(
      delta > 0 ? `${delta}회 추가` : `${-delta}회 차감`,
      `남은 횟수 ${data.pass.remaining_count}회 → ${next}회` + (next > data.pass.total_count ? `\n(총 횟수도 ${next}회로 늘어납니다)` : ''),
      [
        { text: '닫기', style: 'cancel' },
        {
          text: '적용',
          onPress: () => adjustPass.mutate({ passId: data.pass.id, delta, memo }, { onSuccess: onDone, onError: onError('조정할 수 없습니다') }),
        },
      ],
    );
  };

  const confirmToggle = () => {
    if (!data) return;
    const active = data.pass.is_active;
    showDialog(
      active ? '사용 중지' : '다시 사용',
      active
        ? '중지하면 이 수강권으로 새 예약을 할 수 없습니다. 이미 잡힌 예약은 그대로 유지됩니다. (환불·양도 등)'
        : '이 수강권으로 다시 예약할 수 있게 됩니다.',
      [
        { text: '닫기', style: 'cancel' },
        {
          text: active ? '중지' : '재개',
          style: active ? 'destructive' : 'default',
          onPress: () =>
            setActive.mutate({ passId: data.pass.id, active: !active, memo }, { onSuccess: onDone, onError: onError('변경할 수 없습니다') }),
        },
      ],
    );
  };

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#1B1F1E" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink" numberOfLines={1}>
          {data?.pass.member?.name ? `${data.pass.member.name}님 수강권` : '수강권'}
        </Text>
        {busy ? <ActivityIndicator color={BRAND} style={{ marginRight: 12 }} /> : null}
      </View>

      {detailQuery.isLoading ? (
        <LoadingView />
      ) : detailQuery.isError || !data ? (
        <ErrorView message={detailQuery.error?.message ?? '수강권을 불러오지 못했습니다.'} onRetry={() => void detailQuery.refetch()} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={detailQuery.isRefetching} onRefresh={() => void detailQuery.refetch()} tintColor={BRAND} />}>
          <View className="mt-1">
            <PassCard pass={data.pass} />
          </View>
          <Text className="mt-2 text-xs text-stone-400">
            총 {data.pass.total_count}회 · {formatDate(data.pass.starts_on)} ~ {formatDate(data.pass.expires_on)}
          </Text>

          {/* 결제 (원장만 — 다른 역할은 DB 가 빈 결과를 준다) */}
          {isOwner ? (
            <View className="mt-4 rounded-2xl bg-white px-4 py-3.5">
              <Text className="text-sm font-semibold text-stone-600">결제 기록 · 원장만 보임</Text>
              {data.payments.length === 0 ? (
                <Text className="mt-1 text-sm text-stone-400">기록 없음</Text>
              ) : (
                data.payments.map((p) => (
                  <Text key={p.id} className="mt-1 text-base text-ink">
                    {formatWon(p.amount)} · {PAYMENT_METHOD_LABEL[p.method]} · {formatDate(p.paid_on)}
                  </Text>
                ))
              )}
            </View>
          ) : null}

          {/* 관리 (원장·관리자) */}
          {isAdmin ? (
            <View className="mt-5">
              <Text className="mb-2 text-sm font-semibold text-stone-600">관리</Text>
              <View className="rounded-2xl bg-white p-4">
                <TextInput
                  value={memo}
                  onChangeText={setMemo}
                  placeholder="사유 메모 (선택) — 예: 여행 홀딩, 수업 보상"
                  placeholderTextColor="#A8A29E"
                  maxLength={200}
                  className="rounded-xl bg-stone-100 px-3 py-3 text-sm text-ink"
                />

                <Text className="mt-4 text-sm font-semibold text-ink">기간 연장 (홀딩·보상)</Text>
                <View className="mt-2 flex-row gap-2">
                  {EXTEND_PRESETS.map((d) => (
                    <ActionButton key={d} label={`+${d}일`} onPress={() => confirmExtend(d)} disabled={busy} />
                  ))}
                  <ActionButton label="-7일" onPress={() => confirmExtend(-7)} disabled={busy} muted />
                </View>

                <Text className="mt-4 text-sm font-semibold text-ink">횟수 조정</Text>
                <View className="mt-2 flex-row gap-2">
                  <ActionButton label="+1회" onPress={() => confirmAdjust(1)} disabled={busy} />
                  <ActionButton label="-1회" onPress={() => confirmAdjust(-1)} disabled={busy || data.pass.remaining_count === 0} muted />
                </View>

                <Pressable
                  onPress={confirmToggle}
                  disabled={busy}
                  className="mt-5 flex-row items-center border-t border-stone-100 pt-4 active:opacity-60">
                  <Ionicons
                    name={data.pass.is_active ? 'pause-circle-outline' : 'play-circle-outline'}
                    size={20}
                    color={data.pass.is_active ? '#E11D48' : '#24766A'}
                  />
                  <Text className={`ml-2 text-base font-semibold ${data.pass.is_active ? 'text-rose-600' : 'text-brand-700'}`}>
                    {data.pass.is_active ? '사용 중지 (환불·양도 등)' : '다시 사용'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* 변동 내역 */}
          <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">변동 내역 {data.logs.length}건</Text>
          <View className="rounded-2xl bg-white px-4">
            {data.logs.map((log, i) => (
              <LogRow key={log.id} log={log} first={i === 0} />
            ))}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function ActionButton({ label, onPress, disabled, muted }: { label: string; onPress: () => void; disabled?: boolean; muted?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 items-center rounded-xl py-2.5 active:opacity-70 ${muted ? 'bg-stone-100' : 'bg-brand-50'} ${disabled ? 'opacity-40' : ''}`}>
      <Text className={`text-sm font-bold ${muted ? 'text-stone-600' : 'text-brand-700'}`}>{label}</Text>
    </Pressable>
  );
}

function LogRow({ log, first }: { log: PassLog; first: boolean }) {
  const deltaText = log.delta === 0 ? '' : log.delta > 0 ? `+${log.delta}` : `${log.delta}`;
  return (
    <View className={`flex-row py-3 ${first ? '' : 'border-t border-stone-100'}`}>
      <View className="flex-1 pr-2">
        <Text className="text-sm font-semibold text-ink">{PASS_LOG_LABEL[log.reason]}</Text>
        {log.memo ? <Text className="mt-0.5 text-xs text-stone-500">{log.memo}</Text> : null}
        <Text className="mt-0.5 text-xs text-stone-400">
          {dayjs(log.created_at).format('YYYY.MM.DD HH:mm')}
          {log.actor?.name ? ` · ${log.actor.name}` : log.reason === 'waitlist_promotion' ? ' · 자동' : ''}
        </Text>
      </View>
      <View className="items-end">
        {deltaText ? (
          <Text className={`text-base font-bold ${log.delta > 0 ? 'text-brand-700' : 'text-rose-600'}`}>{deltaText}</Text>
        ) : null}
        <Text className="text-xs text-stone-400">잔여 {log.remaining_after}회</Text>
      </View>
    </View>
  );
}
