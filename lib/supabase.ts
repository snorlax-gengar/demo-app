import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * 빌드에 Supabase 주소·키가 빠졌을 때의 안내. 앱을 바로 죽이지 않고 첫 화면에서 보여준다
 * (배포 빌드는 .env 를 쓰지 않으므로 EAS 환경 변수에 넣어야 한다 — docs/production-checklist.md)
 */
export const SUPABASE_CONFIG_ERROR =
  !supabaseUrl || !supabaseKey
    ? '앱 설정(Supabase 주소·키)이 빠진 채로 만들어졌습니다. 개발 중이면 .env.example 을 .env 로 복사해 값을 채운 뒤 서버를 다시 시작하고, 배포 빌드라면 EAS 환경 변수에 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY 를 넣고 다시 빌드하세요.'
    : null;

export const supabase = createClient(supabaseUrl || 'https://missing-config.invalid', supabaseKey || 'missing', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// 앱이 포그라운드일 때만 토큰 자동 갱신
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
