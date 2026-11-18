// Supabase Edge Function: delete-account (회원 탈퇴)
// 앱의 '회원 탈퇴' 버튼이 로그인 토큰과 함께 호출한다. 로직은 core.ts, DB 쪽은 patch 012(withdraw_account).
// 배포: npx supabase functions deploy delete-account --project-ref <ref> --use-api --no-verify-jwt
//       (로그인 확인은 아래 코드가 직접 한다: 토큰이 없거나 잘못되면 401. 대시보드의 'Verify JWT' 를 켜 두면
//        새 JWT 서명 키를 쓰는 프로젝트에서 정상 요청도 막힐 수 있어 끈다)
// 필요한 값: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (모두 기본 제공)
import { createClient } from 'npm:@supabase/supabase-js@2';

import { deleteAccount, type WithdrawResult } from './core.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405, headers: cors });

  const authorization = req.headers.get('Authorization') ?? '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  // 요청한 사람 권한으로 DB 를 부른다 → withdraw_account() 안의 auth.uid() 가 그 사람
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });

  const result = await deleteAccount({
    userId: async () => (jwt ? (await admin.auth.getUser(jwt)).data.user?.id ?? null : null),
    withdraw: async () => {
      const { data, error } = await asUser.rpc('withdraw_account');
      if (error) throw new Error(error.message);
      return data as WithdrawResult;
    },
    softDelete: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id, true); // true = 소프트 삭제(기록 보존)
      if (error) throw error;
    },
  });
  return Response.json(result.body, { status: result.status, headers: cors });
});
