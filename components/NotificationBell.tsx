import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useNotifications } from '@/hooks/queries';

/** 읽지 않은 알림 수가 붙은 종 아이콘 → 알림함 */
export function NotificationBell() {
  const router = useRouter();
  const unread = (useNotifications().data ?? []).filter((n) => !n.read_at).length;
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={unread ? `알림 ${unread}개 새로 옴` : '알림'}
      className="h-11 w-11 items-center justify-center rounded-full bg-white active:opacity-70">
      <Ionicons name="notifications-outline" size={22} color="#1B1F1E" />
      {unread ? (
        <View className="absolute right-1.5 top-1.5 min-w-[18px] items-center rounded-full bg-rose-500 px-1">
          <Text className="text-[11px] font-bold leading-[18px] text-white">{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
