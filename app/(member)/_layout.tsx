import { Tabs } from 'expo-router';

import { tabIcon, useTabBarOptions } from '@/components/ui';

export default function MemberTabsLayout() {
  const screenOptions = useTabBarOptions();
  return (
    <Tabs
      screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: tabIcon('home-outline', 'home'),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: '시간표',
          tabBarIcon: tabIcon('calendar-outline', 'calendar'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '내 정보',
          tabBarIcon: tabIcon('person-outline', 'person'),
        }}
      />
    </Tabs>
  );
}
