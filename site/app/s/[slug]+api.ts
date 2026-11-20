import { renderNotFound, renderStudioPage, securityHeaders, type PublicStudioPage, type SiteConfig } from '../../lib/page';

/**
 * GET /s/<주소 이름> — 공개 스튜디오 소개 페이지를 서버에서 HTML 로 만든다.
 * 카카오톡·인스타그램 등은 링크 미리보기를 만들 때 자바스크립트를 실행하지 않으므로, og 태그를 여기서 채워야 스튜디오별 미리보기가 뜬다.
 */
const cfg: SiteConfig = {
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  siteUrl: (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://piq.expo.app').replace(/\/$/, ''),
};

export async function GET(_request: Request, { slug }: { slug: string }) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const headers = securityHeaders(cfg, nonce);
  const clean = String(slug ?? '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(clean) || !cfg.supabaseUrl || !cfg.anonKey) {
    return new Response(renderNotFound(cfg), { status: 404, headers });
  }
  let page: PublicStudioPage | null = null;
  try {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/get_public_studio_page`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: cfg.anonKey, authorization: `Bearer ${cfg.anonKey}` },
      body: JSON.stringify({ p_slug: clean }),
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    const text = await res.text();
    page = (text && text !== 'null' ? JSON.parse(text) : null) as PublicStudioPage | null;
  } catch {
    return new Response(renderNotFound(cfg).replace('페이지를 찾을 수 없어요</h1>', '잠시 후 다시 열어 주세요</h1>'), {
      status: 503,
      headers: { ...headers, 'retry-after': '30' },
    });
  }
  if (!page) return new Response(renderNotFound(cfg), { status: 404, headers: { ...headers, 'cache-control': 'public, max-age=60' } });
  return new Response(renderStudioPage(page, cfg, nonce), {
    status: 200,
    headers: { ...headers, 'cache-control': 'public, max-age=60, s-maxage=120' },
  });
}
