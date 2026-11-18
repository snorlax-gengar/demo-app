import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { unregisterPush } from '@/lib/push';
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Membership, UserProfile } from '@/lib/types';

const ACTIVE_STUDIO_KEY = 'activeStudioId';

interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  /** 내가 소속된 스튜디오들(활성) */
  memberships: Membership[];
  /** 지금 보고 있는 스튜디오. 앱을 다시 켜도 유지 */
  activeStudioId: string | null;
  /** 저장된 세션 복원이 끝났는지 */
  initialized: boolean;
  /** 프로필 + 소속을 한 번이라도 불러왔는지 */
  accountLoaded: boolean;
  profileError: string | null;
  /** 앱 시작 시 1회 호출. 반환값은 구독 해제 함수 */
  initialize: () => () => void;
  /** 프로필과 소속 스튜디오를 다시 불러온다 (스튜디오 만들기/참여 후에도 호출) */
  loadAccount: () => Promise<void>;
  setActiveStudio: (studioId: string) => void;
  signOut: () => Promise<void>;
}

/** 저장된 선택이 아직 유효하면 그대로, 아니면 첫 번째 스튜디오 */
function pickActive(memberships: Membership[], preferred: string | null): string | null {
  if (preferred && memberships.some((m) => m.studio_id === preferred)) return preferred;
  return memberships[0]?.studio_id ?? null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  memberships: [],
  activeStudioId: null,
  initialized: false,
  accountLoaded: false,
  profileError: null,

  initialize: () => {
    Promise.all([supabase.auth.getSession(), AsyncStorage.getItem(ACTIVE_STUDIO_KEY).catch(() => null)])
      .then(async ([{ data }, saved]) => {
        set({ session: data.session, activeStudioId: saved });
        if (data.session) await get().loadAccount();
      })
      .finally(() => set({ initialized: true }));

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const previousUserId = get().session?.user.id;
      set({ session });

      if (!session) {
        set({ profile: null, memberships: [], accountLoaded: false, profileError: null });
        queryClient.clear();
        return;
      }
      // 토큰 갱신은 다시 불러올 필요가 없다
      if (event === 'TOKEN_REFRESHED' && previousUserId === session.user.id) return;
      if (previousUserId !== session.user.id) set({ profile: null, memberships: [], accountLoaded: false });
      // onAuthStateChange 콜백 안에서 supabase 를 바로 호출하면 교착될 수 있어 다음 틱으로 미룬다
      setTimeout(() => {
        void get().loadAccount();
      }, 0);
    });

    return () => data.subscription.unsubscribe();
  },

  loadAccount: async () => {
    const userId = get().session?.user.id;
    if (!userId) return;

    const [profileRes, membershipRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).maybeSingle(),
      supabase
        .from('studio_members')
        .select('studio_id, role, status, memo, joined_at, studio:studios(*)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true }),
    ]);

    if (get().session?.user.id !== userId) return; // 그 사이 로그아웃/계정 전환
    const error = profileRes.error ?? membershipRes.error;
    if (error) {
      set({ profileError: error.message });
      return;
    }
    if (!profileRes.data) {
      set({ profileError: '프로필 정보를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }

    const memberships = ((membershipRes.data ?? []) as unknown as Membership[]).filter((m) => m.studio);
    const activeStudioId = pickActive(memberships, get().activeStudioId);
    set({
      profile: profileRes.data as UserProfile,
      memberships,
      activeStudioId,
      accountLoaded: true,
      profileError: null,
    });
    if (activeStudioId) void AsyncStorage.setItem(ACTIVE_STUDIO_KEY, activeStudioId).catch(() => {});
  },

  setActiveStudio: (studioId) => {
    if (!get().memberships.some((m) => m.studio_id === studioId)) return;
    set({ activeStudioId: studioId });
    void AsyncStorage.setItem(ACTIVE_STUDIO_KEY, studioId).catch(() => {});
  },

  signOut: async () => {
    // 이 기기로 이전 계정의 알림이 오지 않도록 토큰부터 해제 (실패해도 로그아웃은 진행)
    await unregisterPush().catch(() => {});
    // 서버 세션 종료에 실패해도(네트워크 오류 등) 이 기기에서는 반드시 로그아웃되도록
    try {
      const { error } = await supabase.auth.signOut();
      if (error) await supabase.auth.signOut({ scope: 'local' });
    } catch {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    // 이벤트(SIGNED_OUT)가 늦거나 빠져도 화면은 즉시 로그인으로 돌아가도록 직접 비운다
    set({ session: null, profile: null, memberships: [], accountLoaded: false, profileError: null });
    queryClient.clear();
  },
}));

/** 지금 보고 있는 스튜디오에서의 내 소속 정보 */
export function useActiveMembership(): Membership | null {
  return useAuthStore((s) => s.memberships.find((m) => m.studio_id === s.activeStudioId) ?? null);
}
