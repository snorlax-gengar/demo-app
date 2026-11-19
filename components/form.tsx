import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 입력 화면 공용 부품 (수업 등록, 수강권 발급) */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mt-5">
      <Text className="mb-2 text-sm font-semibold text-stone-600">{label}</Text>
      {children}
    </View>
  );
}

export function Row({ label, children, border }: { label: string; children: ReactNode; border?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${border ? 'border-t border-stone-100' : ''}`}>
      <Text className="text-base text-ink">{label}</Text>
      {children}
    </View>
  );
}

export function Choice({ label, sub, active, onPress }: { label: string; sub: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      className={`flex-1 rounded-2xl border-2 px-4 py-3 ${active ? 'border-brand-600 bg-brand-50' : 'border-transparent bg-surface'}`}>
      <Text className={`text-base font-bold ${active ? 'text-brand-700' : 'text-ink'}`}>{label}</Text>
      <Text className="mt-0.5 text-xs text-stone-500">{sub}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, large }: { label: string; active: boolean; onPress: () => void; large?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      className={`rounded-full ${large ? 'px-4 py-2.5' : 'px-3 py-1.5'} ${active ? 'bg-ink' : 'bg-surface'}`}>
      <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-stone-600'}`}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={onMinus}
        disabled={minusDisabled}
        accessibilityLabel="줄이기"
        className={`h-8 w-8 items-center justify-center rounded-full bg-stone-100 active:opacity-70 ${minusDisabled ? 'opacity-30' : ''}`}>
        <Ionicons name="remove" size={18} color="#44403C" />
      </Pressable>
      <Text className="mx-2 min-w-[28px] text-center text-base font-bold text-ink">{value}</Text>
      <Pressable
        onPress={onPlus}
        disabled={plusDisabled}
        accessibilityLabel="늘리기"
        className={`h-8 w-8 items-center justify-center rounded-full bg-stone-100 active:opacity-70 ${plusDisabled ? 'opacity-30' : ''}`}>
        <Ionicons name="add" size={18} color="#44403C" />
      </Pressable>
    </View>
  );
}
