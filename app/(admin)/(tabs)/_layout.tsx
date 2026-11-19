import { Tabs } from 'expo-router';

import { tabIcon, useTabBarOptions } from '@/components/ui';

export default function AdminTabsLayout() {
  const screenOptions = useTabBarOptions();

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={{ title: '오늘', tabBarIcon: tabIcon('today-outline', 'today') }} />
      <Tabs.Screen name="calendar" options={{ title: '달력', tabBarIcon: tabIcon('calendar-outline', 'calendar') }} />
      <Tabs.Screen name="members" options={{ title: '회원', tabBarIcon: tabIcon('people-outline', 'people') }} />
      <Tabs.Screen name="profile" options={{ title: '내 정보', tabBarIcon: tabIcon('person-outline', 'person') }} />
    </Tabs>
  );
}
