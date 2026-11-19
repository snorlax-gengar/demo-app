import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { finishFromUrl } from '@/lib/socialAuth';
import { showDialog } from '@/lib/dialog';
import { useAuthStore } from '@/stores/auth';

/**
 * 소셜 로그인 후 돌아오는 주소. 휴대폰에서는 앱 안 브라우저가 이 주소를 가로채므로 보통 거치지 않지만,
 * 바깥 브라우저로 열렸다가 돌아온 경우(또는 웹)에 토큰을 받아 로그인을 마무리한다.
 */
export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    // 웹 팝업으로 열린 경우: 여는 창(로그인 화면)이 이 주소를 읽어 마무리하므로 여기서는 아무것도 하지 않는다
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.opener) {
      WebBrowser.maybeCompleteAuthSession();
      return;
    }
    // 로그인 직후 갈 곳: 약관 동의 기록이 없으면 동의 화면, 아니면 홈
    const next = () => {
      const s = useAuthStore.getState().session;
      router.replace(s && !s.user.user_metadata?.terms_agreed_at ? '/complete-profile' : '/');
    };
    const url = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null;
    if (!url || (!url.includes('#') && !url.includes('code='))) {
      next();
      return;
    }
    void finishFromUrl(url).then((r) => {
      if (r && r !== 'cancelled') showDialog('로그인하지 못했어요', r);
      next();
    });
  }, [router]);
  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <ActivityIndicator color="#0B7A4D" />
    </View>
  );
}
