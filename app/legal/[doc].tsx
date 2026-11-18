import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { isLegalDocId, LEGAL_DOCS, LEGAL_INFO } from '@/lib/legal';

/** 이용약관 / 개인정보 처리방침 — 로그인 전(가입 화면)에도 열 수 있다 */
export default function LegalScreen() {
  const router = useRouter();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const content = isLegalDocId(doc) ? LEGAL_DOCS[doc] : null;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#1B1F1E" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink">{content?.title ?? '문서를 찾을 수 없습니다'}</Text>
      </View>
      {content ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
          <Text className="mb-4 text-xs text-stone-500">
            {LEGAL_INFO.appName} · 시행일 {LEGAL_INFO.effectiveDate}
          </Text>
          {content.sections.map((s) => (
            <View key={s.heading} className="mb-5">
              <Text className="mb-1.5 text-base font-bold text-ink">{s.heading}</Text>
              <Text selectable className="text-sm leading-6 text-stone-700">
                {s.body}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
