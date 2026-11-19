import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const BRAND = '#0B7A4D';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** 하단 탭 아이콘: <Tabs.Screen options={{ tabBarIcon: tabIcon('home-outline', 'home') }} /> */
export function tabIcon(name: IoniconName, activeName?: IoniconName) {
  return function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused?: boolean }) {
    return <Ionicons name={focused && activeName ? activeName : name} size={size} color={typeof color === 'string' ? color : BRAND} />;
  };
}

/** 회원/관리자 탭 바 공통 스타일. 한글 라벨이 잘리지 않도록 높이와 줄 높이를 명시한다 */
export function useTabBarOptions() {
  const insets = useSafeAreaInsets();
  return {
    headerShown: false,
    tabBarActiveTintColor: BRAND,
    tabBarInactiveTintColor: '#A8A29E',
    tabBarStyle: {
      backgroundColor: '#FFFFFF',
      borderTopColor: '#E7E5E4',
      height: 62 + insets.bottom,
      paddingTop: 2,
      paddingBottom: insets.bottom + 2,
    },
    tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  } as const;
}

/** 상단 안전 영역을 포함한 화면 컨테이너 */
export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {children}
    </View>
  );
}

export function Badge({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <View className={`rounded-full px-2.5 py-1 ${bg}`}>
      <Text className={`text-xs font-semibold ${text}`}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="mb-3 mt-6 flex-row items-center justify-between px-5">
      <Text className="text-lg font-bold text-ink">{title}</Text>
      {right}
    </View>
  );
}

export function LoadingView() {
  return (
    <View className="flex-1 items-center justify-center py-16">
      <ActivityIndicator color={BRAND} />
    </View>
  );
}

export function EmptyView({
  icon,
  title,
  description,
}: {
  icon: IoniconName;
  title: string;
  description?: string;
}) {
  return (
    <View className="mx-5 items-center rounded-2xl border border-dashed border-stone-300 px-6 py-10">
      <Ionicons name={icon} size={28} color="#A8A29E" />
      <Text className="mt-3 text-base font-semibold text-stone-600">{title}</Text>
      {description ? <Text className="mt-1 text-center text-sm text-stone-400">{description}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="mx-5 items-center rounded-2xl bg-rose-50 px-6 py-8">
      <Ionicons name="alert-circle-outline" size={28} color="#BE123C" />
      <Text className="mt-2 text-center text-sm text-rose-700">{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} className="mt-4 rounded-full bg-rose-700 px-5 py-2 active:opacity-80">
          <Text className="text-sm font-semibold text-white">다시 시도</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
