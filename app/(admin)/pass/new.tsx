import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, Choice, Field, Row, Stepper } from '@/components/form';
import { ErrorView, LoadingView, Screen } from '@/components/ui';
import { useIssuePass, useMemberDetail, usePassProducts } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDate } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { PAYMENT_METHOD_LABEL, formatWon } from '@/lib/labels';
import { PRODUCT_LIMITS, durationLabel, expiresFrom, type DurationUnit, type PassProduct } from '@/lib/products';
import type { ClassType, PaymentMethod } from '@/lib/types';

const COUNT_PRESETS = [1, 4, 8, 10, 20, 30];
const PERIODS: Record<DurationUnit, number[]> = { month: [1, 2, 3, 6, 12], day: [7, 14, 30, 60] };
const METHODS: PaymentMethod[] = ['card', 'cash', 'transfer', 'other'];

const defaultName = (type: ClassType, count: number) => `${type === 'private' ? '1:1 개인' : '그룹'} ${count}회권`;

/** 수강권 발급 (원장·관리자). 회원 상세에서 진입 */
export default function IssuePassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { studioId, isAdmin, isOwner } = useStudio();
  const memberQuery = useMemberDetail(studioId, memberId);
  const issuePass = useIssuePass();

  const [type, setType] = useState<ClassType>('group');
  const [count, setCount] = useState(10);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(() => dayjs().startOf('day'));
  const [unit, setUnit] = useState<DurationUnit>('month');
  const [duration, setDuration] = useState(3);
  const [productId, setProductId] = useState<string | null>(null);
  const productsQuery = usePassProducts(studioId, isAdmin);
  const products = (productsQuery.data ?? []).filter((p) => p.is_active);
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [memo, setMemo] = useState('');

  const close = () => (router.canGoBack() ? router.back() : router.replace('/members'));

  // 3개월권을 11/17 에 시작하면 2/16 까지, 14일권은 11/30 까지
  const expiresOn = expiresFrom(startsOn, duration, unit);
  const maxDuration = unit === 'month' ? PRODUCT_LIMITS.months : PRODUCT_LIMITS.days;

  /** 상품을 고르면 유형·횟수·이름·기간·금액을 채운다 (채운 뒤 자유롭게 수정 가능) */
  const pickProduct = (p: PassProduct) => {
    setProductId(p.id);
    setType(p.class_type);
    setCount(p.total_count);
    setName(p.name);
    setUnit(p.duration_unit);
    setDuration(p.duration_value);
    setAmountText(p.price === null ? '' : String(p.price));
  };
  const switchUnit = (next: DurationUnit) => {
    if (next === unit) return;
    setUnit(next);
    setDuration(next === 'month' ? 1 : 14);
  };
  const finalName = name.trim() || defaultName(type, count);
  const amount = amountText ? Number(amountText) : null;

  if (!isAdmin) {
    return (
      <Screen>
        <ErrorView message="원장 또는 관리자만 수강권을 발급할 수 있습니다." onRetry={close} />
      </Screen>
    );
  }

  const member = memberQuery.data?.profile;

  const submit = () => {
    if (!member) return;
    showDialog(
      '수강권 발급',
      `${member.name}님께 ${finalName}\n${formatDate(startsOn.toISOString())} ~ ${formatDate(expiresOn.toISOString())}` +
        (amount !== null ? `\n결제 ${formatWon(amount)} · ${PAYMENT_METHOD_LABEL[method]}` : ''),
      [
        { text: '닫기', style: 'cancel' },
        {
          text: '발급',
          onPress: () =>
            issuePass.mutate(
              {
                studioId,
                memberId: member.id,
                classType: type,
                name: finalName,
                total: count,
                startsOn: startsOn.format('YYYY-MM-DD'),
                expiresOn: expiresOn.format('YYYY-MM-DD'),
                amount,
                method: amount !== null ? method : null,
                memo: memo.trim() || null,
              },
              {
                onSuccess: () => {
                  showDialog('발급했습니다', `${member.name}님 ${finalName}`);
                  close();
                },
                onError: (error) => showDialog('발급할 수 없습니다', error.message),
              },
            ),
        },
      ],
    );
  };

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable onPress={close} accessibilityLabel="닫기" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="close" size={24} color="#1B1F1E" />
        </Pressable>
        <Text className="ml-1 text-lg font-bold text-ink">수강권 발급</Text>
      </View>

      {memberQuery.isLoading ? (
        <LoadingView />
      ) : !member ? (
        <ErrorView message={memberQuery.error?.message ?? '회원을 찾을 수 없습니다.'} onRetry={() => void memberQuery.refetch()} />
      ) : (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
            <View className="mt-1 flex-row items-center rounded-2xl bg-white px-4 py-3">
              <Ionicons name="person-circle-outline" size={22} color="#24766A" />
              <Text className="ml-2 text-base font-semibold text-ink">{member.name || '이름 없음'}</Text>
              <Text className="ml-2 text-sm text-stone-500">{member.phone ?? ''}</Text>
            </View>

            {products.length > 0 ? (
              <Field label="상품에서 고르기">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {products.map((p) => {
                    const on = productId === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => pickProduct(p)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`상품 ${p.name}`}
                        className={`w-44 rounded-2xl border-2 px-3.5 py-3 ${on ? 'border-brand-600 bg-brand-50' : 'border-transparent bg-white'}`}>
                        <Text className={`text-sm font-bold ${on ? 'text-brand-700' : 'text-ink'}`} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text className="mt-0.5 text-xs text-stone-500">
                          {p.class_type === 'private' ? '1:1' : '그룹'} · {p.total_count}회 · {durationLabel(p.duration_value, p.duration_unit)}
                        </Text>
                        <Text className="mt-1 text-sm font-semibold text-ink">{p.price === null ? '가격 미정' : formatWon(p.price)}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text className="mt-2 text-xs text-stone-400">고르면 아래 칸이 채워집니다. 채운 뒤에도 바꿀 수 있어요.</Text>
              </Field>
            ) : (
              <Pressable onPress={() => router.push('/(admin)/products')} className="mt-4 flex-row items-center rounded-2xl border border-dashed border-stone-300 px-4 py-3 active:opacity-70">
                <Ionicons name="pricetags-outline" size={16} color="#78716C" />
                <Text className="ml-2 flex-1 text-sm text-stone-500">자주 쓰는 수강권을 상품으로 등록하면 골라서 바로 발급할 수 있어요</Text>
                <Ionicons name="chevron-forward" size={16} color="#A8A29E" />
              </Pressable>
            )}

            <Field label="수강권 유형">
              <View className="flex-row gap-2">
                <Choice label="1:1 개인" sub="1:1 수업 예약용" active={type === 'private'} onPress={() => setType('private')} />
                <Choice label="그룹" sub="그룹(4:1 등) 수업 예약용" active={type === 'group'} onPress={() => setType('group')} />
              </View>
            </Field>

            <Field label="횟수">
              <View className="flex-row flex-wrap gap-2">
                {COUNT_PRESETS.map((n) => (
                  <Chip key={n} label={`${n}회`} active={count === n} onPress={() => setCount(n)} large />
                ))}
              </View>
              <View className="mt-3 flex-row items-center justify-between rounded-2xl bg-white px-4 py-3">
                <Text className="text-base text-ink">직접 입력</Text>
                <Stepper
                  value={`${count}회`}
                  onMinus={() => setCount((c) => Math.max(1, c - 1))}
                  onPlus={() => setCount((c) => Math.min(500, c + 1))}
                  minusDisabled={count <= 1}
                />
              </View>
            </Field>

            <Field label="수강권 이름">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={defaultName(type, count)}
                placeholderTextColor="#A8A29E"
                className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
              />
            </Field>

            <Field label="유효기간">
              <View className="mb-3 flex-row rounded-full bg-stone-200 p-1">
                {(['month', 'day'] as const).map((u) => (
                  <Pressable
                    key={u}
                    onPress={() => switchUnit(u)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: unit === u }}
                    className={`flex-1 items-center rounded-full py-2 ${unit === u ? 'bg-white' : ''}`}>
                    <Text className={`text-sm font-semibold ${unit === u ? 'text-ink' : 'text-stone-500'}`}>{u === 'month' ? '개월 단위' : '일 단위'}</Text>
                  </Pressable>
                ))}
              </View>
              <View className="flex-row flex-wrap gap-2">
                {PERIODS[unit].map((v) => (
                  <Chip key={v} label={durationLabel(v, unit)} active={duration === v} onPress={() => setDuration(v)} large />
                ))}
              </View>
              <View className="mt-3 rounded-2xl bg-white px-4">
                <Row label="기간">
                  <Stepper
                    value={durationLabel(duration, unit)}
                    onMinus={() => setDuration((d) => Math.max(1, d - 1))}
                    onPlus={() => setDuration((d) => Math.min(maxDuration, d + 1))}
                    minusDisabled={duration <= 1}
                    plusDisabled={duration >= maxDuration}
                  />
                </Row>
                <Row label="시작일" border>
                  <Stepper
                    value={formatDate(startsOn.toISOString())}
                    onMinus={() => setStartsOn((d) => d.subtract(1, 'day'))}
                    onPlus={() => setStartsOn((d) => d.add(1, 'day'))}
                  />
                </Row>
                <Row label="만료일" border>
                  <Text className="text-base font-bold text-ink">{formatDate(expiresOn.toISOString())}</Text>
                </Row>
              </View>
            </Field>

            <Field label="결제 금액 (선택)">
              <View className="flex-row items-center rounded-2xl border border-stone-200 bg-white px-4">
                <TextInput
                  value={amountText ? Number(amountText).toLocaleString('ko-KR') : ''}
                  onChangeText={(t) => setAmountText(t.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9))}
                  placeholder="예: 550,000"
                  placeholderTextColor="#A8A29E"
                  keyboardType="number-pad"
                  className="flex-1 py-3.5 text-[16px] text-ink"
                />
                <Text className="text-base text-stone-500">원</Text>
              </View>
              {amountText ? (
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {METHODS.map((m) => (
                    <Chip key={m} label={PAYMENT_METHOD_LABEL[m]} active={method === m} onPress={() => setMethod(m)} large />
                  ))}
                </View>
              ) : null}
              <Text className="mt-2 text-xs text-stone-400">
                {isOwner
                  ? '입력한 금액은 원장만 볼 수 있으며, 나중에 매출 집계에 쓰입니다.'
                  : '입력한 금액은 원장만 볼 수 있습니다. 발급 후에는 관리자 화면에 표시되지 않습니다.'}
              </Text>
            </Field>

            <Field label="메모 (선택)">
              <TextInput
                value={memo}
                onChangeText={setMemo}
                placeholder="예: 체험 후 등록, 지인 할인"
                placeholderTextColor="#A8A29E"
                maxLength={200}
                className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
              />
            </Field>
          </ScrollView>

          <View className="border-t border-stone-200 bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
            <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
              {finalName}
              {amount !== null ? ` · ${formatWon(amount)}` : ''}
            </Text>
            <Text className="mt-0.5 text-sm text-stone-500">
              {formatDate(startsOn.toISOString())} ~ {formatDate(expiresOn.toISOString())} · {durationLabel(duration, unit)}
            </Text>
            <Pressable
              onPress={submit}
              disabled={issuePass.isPending}
              className="mt-3 items-center rounded-2xl bg-brand-600 py-4 active:opacity-80">
              {issuePass.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">발급</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}
