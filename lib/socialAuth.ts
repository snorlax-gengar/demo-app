import type { UserIdentity } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { authRedirect, parseAuthLink } from '@/lib/authLinks';
import { supabase } from '@/lib/supabase';

export type SocialProvider = 'kakao' | 'google' | 'apple';

export const SOCIAL_LABEL: Record<SocialProvider, string> = { kakao: '카카오', google: 'Google', apple: 'Apple' };

/** 결과: null = 성공(세션 저장됨) / 'cancelled' = 사용자가 닫음 / 그 밖의 문자열 = 오류 안내 */
export type SocialResult = null | 'cancelled' | string;

WebBrowser.maybeCompleteAuthSession();

/** 이 기기에서 애플 로그인을 쓸 수 있는지 (iOS 13+ 실기기·개발 빌드. Expo Go·안드로이드·웹은 false) */
export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/** 카카오·구글: Supabase 로그인 페이지를 앱 안 브라우저로 열고, 돌아온 주소의 토큰으로 로그인 */
export async function signInWithBrowser(provider: 'kakao' | 'google'): Promise<SocialResult> {
  const redirectTo = authRedirect('/auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      // 카카오는 Supabase 가 account_email·profile_image·profile_nickname 을 기본 요청함 (docs/social-login-setup.md)
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error || !data?.url) return error?.message ?? '로그인을 시작하지 못했어요.';

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';
  return finishFromUrl(result.url);
}

/** 브라우저 로그인 후 돌아온 주소(#access_token=… 또는 ?code=…)로 세션 저장 */
export async function finishFromUrl(url: string): Promise<SocialResult> {
  const p = parseAuthLink(url);
  if (p.error) return friendlyError(p.error);
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    return error ? friendlyError(error.message) : null;
  }
  if (!p.accessToken || !p.refreshToken) return '로그인 정보를 받지 못했어요. 다시 시도해 주세요.';
  const { error } = await supabase.auth.setSession({ access_token: p.accessToken, refresh_token: p.refreshToken });
  return error ? friendlyError(error.message) : null;
}

/** 애플(iOS): 기기의 애플 로그인 창 → 받은 토큰으로 Supabase 로그인. 이름은 처음 한 번만 오므로 저장해 둔다 */
export async function signInWithApple(): Promise<SocialResult> {
  const rawNonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return 'cancelled';
    return '애플 로그인을 시작하지 못했어요.';
  }
  if (!credential.identityToken) return '애플에서 로그인 정보를 받지 못했어요.';
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  if (error) return friendlyError(error.message);
  const name = [credential.fullName?.familyName, credential.fullName?.givenName].filter(Boolean).join('');
  if (name) await supabase.auth.updateUser({ data: { name } }).catch(() => {});
  return null;
}

/** 현재 로그인 계정에 연결된 로그인 수단 목록 (이메일 · 카카오 · 구글 · 애플) */
export async function getLinkedIdentities(): Promise<UserIdentity[]> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (!error && data?.identities) return data.identities;
  const { data: u } = await supabase.auth.getUser();
  return u.user?.identities ?? [];
}

/** 기존 로그인 계정에 카카오·구글·애플 소셜 계정을 추가 연결 (Supabase 'Enable Manual Linking' 필요) */
export async function linkSocialAccount(provider: SocialProvider): Promise<SocialResult> {
  const redirectTo = authRedirect('/auth-callback');
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error || !data?.url) return friendlyError(error?.message ?? '연결을 시작하지 못했어요.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';
  const done = await finishFromUrl(result.url);
  if (!done) await supabase.auth.refreshSession().catch(() => {});
  return done;
}

/** 연결된 소셜 로그인 수단 해제 (최소 1개 로그인 수단이 남아 있어야 가능) */
export async function unlinkSocialAccount(identity: UserIdentity): Promise<string | null> {
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) return friendlyError(error.message);
  await supabase.auth.refreshSession().catch(() => {});
  return null;
}

function friendlyError(message: string): string {
  if (/provider is not enabled|Unsupported provider/i.test(message)) return '아직 준비 중인 로그인 방법이에요. 이메일로 로그인해 주세요.';
  if (/manual linking is disabled/i.test(message)) return '서버에서 간편 로그인 연결 설정(Enable Manual Linking)이 아직 켜지지 않았어요.';
  if (/identity_already_exists|already linked|already exists/i.test(message)) return '이미 다른 PIQ 계정에 연결된 소셜 계정이에요.';
  if (/at least 2 identities|last identity/i.test(message)) return '로그인 수단은 최소 1개 이상 남아 있어야 해제할 수 있어요.';
  if (/access_denied|cancel/i.test(message)) return 'cancelled';
  if (/banned|deleted/i.test(message)) return '탈퇴한 계정입니다. 새로 가입해 주세요.';
  return message;
}

/** 소셜 계정에서 받은 이름 (카카오 닉네임·구글 이름·애플 이름) */
export function nameFromMetadata(meta: Record<string, unknown> | undefined): string {
  const pick = (k: string) => (typeof meta?.[k] === 'string' ? (meta[k] as string).trim() : '');
  return pick('name') || pick('full_name') || pick('nickname') || pick('preferred_username') || pick('user_name');
}
