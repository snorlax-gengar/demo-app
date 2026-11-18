import * as Linking from 'expo-linking';
import { createClient } from '@supabase/supabase-js';

/** 메일 링크가 돌아올 앱 주소 (배포 앱: piq://…, Expo Go: exp://…, 웹: https://…). Supabase Redirect URLs 에 등록 필요 */
export const authRedirect = (path: string) => Linking.createURL(path);

export interface AuthLinkParams {
  accessToken?: string;
  refreshToken?: string;
  type?: string;
  error?: string;
}

/** 메일 링크로 열린 주소의 #access_token=…&refresh_token=…&type=recovery (또는 #error_description=…) 읽기 */
export function parseAuthLink(url: string | null | undefined): AuthLinkParams {
  if (!url) return {};
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const p = new URLSearchParams([query, hash].filter(Boolean).join('&'));
  const error = p.get('error_description') ?? p.get('error') ?? undefined;
  return {
    accessToken: p.get('access_token') ?? undefined,
    refreshToken: p.get('refresh_token') ?? undefined,
    type: p.get('type') ?? undefined,
    error: error ? error.replace(/\+/g, ' ') : undefined,
  };
}

/**
 * 재설정 링크의 토큰으로 비밀번호만 바꾼다. 앱의 로그인 상태(다른 계정 포함)는 건드리지 않도록
 * 저장하지 않는 임시 클라이언트를 쓰고, 끝나면 그 세션을 버린다. 바꾼 뒤에는 새 비밀번호로 로그인.
 */
export async function resetPasswordWithLink(params: AuthLinkParams, newPassword: string): Promise<string | null> {
  if (!params.accessToken || !params.refreshToken) return '재설정 링크가 올바르지 않아요. 메일을 다시 받아 주세요.';
  const temp = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'piq-password-reset' },
  });
  const { error: sessionError } = await temp.auth.setSession({ access_token: params.accessToken, refresh_token: params.refreshToken });
  if (sessionError) return '재설정 링크가 만료됐어요. 메일을 다시 받아 주세요.';
  const { error } = await temp.auth.updateUser({ password: newPassword });
  await temp.auth.signOut({ scope: 'local' }).catch(() => {});
  if (!error) return null;
  if (/different from the old/i.test(error.message)) return '이전과 다른 비밀번호를 입력해 주세요.';
  if (/at least/i.test(error.message)) return '비밀번호가 너무 짧아요.';
  return error.message;
}
