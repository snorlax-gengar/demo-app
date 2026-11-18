import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, Choice, Field, Stepper } from '@/components/form';
import { ErrorView, LoadingView, Screen } from '@/components/ui';
import { usePassProducts, useSavePassProduct } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { showDialog } from '@/lib/dialog';
import { formatWon } from '@/lib/labels';
import { PRODUCT_LIMITS, durationLabel, validateProduct, type DurationUnit } from '@/lib/products';
import type { ClassType } from '@/lib/types';

const COUNT_PRESETS = [1, 4, 8, 10, 20, 30];
const PERIODS: Record<DurationUnit, number[]> = { month: [1, 2, 3, 6, 12], day: [7, 14, 30, 60] };

/** 수강권 상품 등록·수정. id 가 있으면 수정 */
export default function PassProductEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { studioId, isAdmin, isOwner } = useStudio();
  const productsQuery = usePassProducts(studioId, isAdmin);
  const save = useSavePassProduct();
  const existing = id ? productsQuery.data?.find((p) => p.id === id) : undefined;

  const [type, setType] = useState<ClassType>('group');
  const [count, setCount] = useState(10);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<DurationUnit>('month');
  const [duration, setDuration] = useState(3);
  const [priceText, setPriceText] = useState('');
  const [active, setActive] = useState(true);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!existing || loaded) return;
    setType(existing.class_type);
    setCount(existing.total_count);
    setName(existing.name);
    setUnit(existing.duration_unit);
    setDuration(existing.duration_value);
    setPriceText(existing.price === null ? '' : String(existing.price));
    setActive(existing.is_active);
    setLoaded(true);
  }, [existing, loaded]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(admin)/products'));
  const autoName = `${type === 'private' ? '1:1 개인' : '그룹'} ${count}회 · ${durationLabel(duration, unit)}`;
  const price = priceText ? Number(priceText) : null;
  const maxDuration = unit === 'month' ? PRODUCT_LIMITS.months : PRODUCT_LIMITS.days;

  const switchUnit = (next: DurationUnit) => {
    if (next === unit) return;
    setUnit(next);
    setDuration(next === 'month' ? 1 : 14);
  };

  const submit = () => {
    const values = { name: name.trim() || autoName, class_type: type, total_count: count, duration_value: duration, duration_unit: unit, price, is_active: active };
    const problem = validateProduct(values);
    if (problem) {
      showDialog('저장할 수 없습니다', problem);
      return;
    }
    save.mutate(
      { studioId, id, values },
      {
        onSuccess: () => {
          showDialog(id ? '수정했습니다' : '상품을 등록했습니다', `${values.name}\n${values.total_count}회 · ${durationLabel(duration, unit)}${price !== null ? ` · ${formatWon(price)}` : ''}`);
          close();
        },
        onError: (error) => showDialog('저장할 수 없습니다', error.message),
      },
    );
  };

  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable onPress={close} accessibilityLabel="닫기" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="close" size={24} color="#1B1F1E" />
      </Pressable>
      <Text className="ml-1 text-lg font-bold text-ink">{id ? '상품 수정' : '상품 추가'}</Text>
    </View>
  );

  if (!isAdmin) {
    return (
      <Screen>
        {header}
        <ErrorView message="원장 또는 관리자만 상품을 관리할 수 있습니다." onRetry={close} />
      </Screen>
    );
  }
  if (id && !loaded) {
    return (
      <Screen>
        {header}
        {productsQuery.isLoading ? <LoadingView /> : <ErrorView message="상품을 찾을 수 없습니다." onRetry={close} />}
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
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
                onPlus={() => setCount((c) => Math.min(PRODUCT_LIMITS.count, c + 1))}
                minusDisabled={count <= 1}
                plusDisabled={count >= PRODUCT_LIMITS.count}
              />
            </View>
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
            <View className="mt-3 flex-row items-center justify-between rounded-2xl bg-white px-4 py-3">
              <Text className="text-base text-ink">직접 입력</Text>
              <Stepper
                value={durationLabel(duration, unit)}
                onMinus={() => setDuration((d) => Math.max(1, d - 1))}
                onPlus={() => setDuration((d) => Math.min(maxDuration, d + 1))}
                minusDisabled={duration <= 1}
                plusDisabled={duration >= maxDuration}
              />
            </View>
          </Field>

          <Field label="가격 (선택)">
            <View className="flex-row items-center rounded-2xl border border-stone-200 bg-white px-4">
              <TextInput
                value={priceText ? Number(priceText).toLocaleString('ko-KR') : ''}
                onChangeText={(t) => setPriceText(t.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9))}
                placeholder="예: 480,000"
                placeholderTextColor="#A8A29E"
                keyboardType="number-pad"
                accessibilityLabel="가격"
                className="flex-1 py-3.5 text-[16px] text-ink"
              />
              <Text className="text-base text-stone-500">원</Text>
            </View>
            <Text className="mt-2 text-xs text-stone-400">
              발급할 때 결제 금액으로 자동 입력됩니다(바꿀 수 있음).{isOwner ? '' : ' 상품 가격은 원장·관리자에게 보입니다.'}
            </Text>
          </Field>

          <Field label="상품 이름">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={autoName}
              placeholderTextColor="#A8A29E"
              maxLength={PRODUCT_LIMITS.name}
              accessibilityLabel="상품 이름"
              className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
            />
            <Text className="mt-2 text-xs text-stone-400">비워 두면 "{autoName}"(으)로 저장됩니다. 발급되는 수강권 이름도 이 이름이 됩니다.</Text>
          </Field>

          {id ? (
            <View className="mt-5 flex-row items-center rounded-2xl bg-white px-4 py-3">
              <View className="flex-1 pr-3">
                <Text className="text-base text-ink">발급 화면에 보이기</Text>
                <Text className="mt-0.5 text-xs text-stone-400">끄면 숨김 처리됩니다. 언제든 다시 켤 수 있어요.</Text>
              </View>
              <Switch value={active} onValueChange={setActive} accessibilityLabel="발급 화면에 보이기" trackColor={{ true: '#24766A' }} />
            </View>
          ) : null}
        </ScrollView>

        <View className="border-t border-stone-200 bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
            {name.trim() || autoName}
          </Text>
          <Text className="mt-0.5 text-sm text-stone-500">
            {count}회 · {durationLabel(duration, unit)} · {price === null ? '가격 미정' : formatWon(price)}
          </Text>
          <Pressable onPress={submit} disabled={save.isPending} className="mt-3 items-center rounded-2xl bg-brand-600 py-4 active:opacity-80">
            {save.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">{id ? '저장' : '등록'}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
