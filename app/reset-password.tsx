import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { parseAuthLink, resetPasswordWithLink, type AuthLinkParams } from '@/lib/authLinks';
import { showDialog } from '@/lib/dialog';

/** 비밀번호 재설정 메일의 링크로 열리는 화면 (로그인 여부와 상관없이 열림) */
export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [params, setParams] = useState<AuthLinkParams | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 웹은 주소창의 #토큰, 휴대폰은 앱을 연 링크 주소에서 읽는다 (한 번 읽으면 유지)
    const source = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : url;
    if (source && !params) setParams(parseAuthLink(source));
  }, [url, params]);

  const linkError = params?.error ?? (params && !params.accessToken ? '재설정 링크가 올바르지 않아요.' : null);
  const valid = pw.length >= 6 && pw === pw2;

  const submit = async () => {
    if (!params || !valid || busy) return;
    setBusy(true);
    setError(null);
    const e = await resetPasswordWithLink(params, pw);
    setBusy(false);
    if (e) {
      setError(e);
      return;
    }
    showDialog('비밀번호를 바꿨어요', '새 비밀번호로 로그인해 주세요.', [{ text: '확인', onPress: () => router.replace('/') }]);
  };

  const field = 'rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink';
  return (
    <View className="flex-1 bg-canvas px-6" style={{ paddingTop: insets.top + 32 }}>
      <Text className="text-3xl font-bold text-ink">새 비밀번호</Text>
      {!params ? (
        <ActivityIndicator className="mt-10" color="#0B7A4D" />
      ) : linkError ? (
        <>
          <Text className="mt-3 text-base leading-6 text-stone-600">
            {/expired|invalid/i.test(linkError) ? '링크가 만료됐거나 이미 사용됐어요.' : linkError} 비밀번호 찾기에서 메일을 다시 받아 주세요.
          </Text>
          <Pressable onPress={() => router.replace('/forgot')} className="mt-8 items-center rounded-2xl bg-brand-600 py-4 active:opacity-80">
            <Text className="text-base font-bold text-white">메일 다시 받기</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text className="mt-2 text-base text-stone-500">앞으로 로그인할 때 쓸 비밀번호를 정해 주세요. (6자 이상)</Text>
          <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">새 비밀번호</Text>
          <TextInput value={pw} onChangeText={setPw} placeholder="새 비밀번호" placeholderTextColor="#A8A29E" secureTextEntry textContentType="newPassword" className={field} />
          <Text className="mb-2 mt-4 text-sm font-semibold text-stone-600">한 번 더</Text>
          <TextInput value={pw2} onChangeText={setPw2} placeholder="새 비밀번호 확인" placeholderTextColor="#A8A29E" secureTextEntry textContentType="newPassword" onSubmitEditing={submit} className={field} />
          {pw2.length > 0 && pw !== pw2 ? <Text className="mt-2 text-sm text-rose-600">두 비밀번호가 달라요.</Text> : null}
          {error ? <Text className="mt-3 text-sm text-rose-600">{error}</Text> : null}
          <Pressable
            onPress={submit}
            disabled={!valid || busy}
            accessibilityRole="button"
            accessibilityLabel="비밀번호 바꾸기"
            className={`mt-6 items-center rounded-2xl py-4 active:opacity-80 ${valid && !busy ? 'bg-brand-600' : 'bg-brand-200'}`}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">비밀번호 바꾸기</Text>}
          </Pressable>
        </>
      )}
    </View>
  );
}
