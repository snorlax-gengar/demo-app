import { Stack } from 'expo-router';

/** 강사/원장 영역: 하단 탭 + 탭 위로 올라오는 상세·등록 화면 */
export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="member/[id]" />
      <Stack.Screen name="class/[id]" />
      <Stack.Screen name="class/new" />
      <Stack.Screen name="class/edit" />
      <Stack.Screen name="book/[classId]" />
      <Stack.Screen name="revenue" />
      <Stack.Screen name="products/index" />
      <Stack.Screen name="products/edit" />
      <Stack.Screen name="pass/new" />
      <Stack.Screen name="pass/[id]" />
      <Stack.Screen name="close-studio" />
      <Stack.Screen name="studio-page" />
      <Stack.Screen name="trials" />
    </Stack>
  );
}
