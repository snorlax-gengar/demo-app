/**
 * 공개 스튜디오 소개 페이지 HTML (서버에서 만든다 → 카카오톡·인스타 링크 미리보기에 스튜디오 이름·사진이 뜬다).
 * 원장이 쓴 글은 전부 이스케이프하고, 링크는 https 만 쓴다. 체험 신청 폼은 Supabase RPC 를 브라우저에서 직접 부른다.
 */

export interface PublicClass {
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  capacity: number;
  left: number;
}

export interface PublicStudioPage {
  slug: string;
  name: string;
  headline: string | null;
  intro: string | null;
  category: string | null;
  address: string | null;
  contact_phone: string | null;
  kakao_url: string | null;
  instagram: string | null;
  website_url: string | null;
  hours: string | null;
  photos: string[];
  trial_enabled: boolean;
  trial_note: string | null;
  schedule: PublicClass[] | null;
}

export interface SiteConfig {
  supabaseUrl: string;
  anonKey: string;
  siteUrl: string; // https://piq.expo.app
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const multiline = (s: string | null) => esc(s ?? '').replace(/\r?\n/g, '<br>');
const httpsOnly = (u: string | null) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

export const photoPublicUrl = (cfg: SiteConfig, path: string) =>
  `${cfg.supabaseUrl}/storage/v1/object/public/studio-photos/${path.split('/').map(encodeURIComponent).join('/')}`;

/** 한국 시간 (서버 시간대와 무관하게 +9시간) */
const kst = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
};
const pad = (n: number) => String(n).padStart(2, '0');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function scheduleHtml(list: PublicClass[]) {
  if (!list.length) return '<p class="muted">앞으로 2주 동안 열린 수업이 없어요. 체험 신청을 남겨 주시면 일정을 안내해 드려요.</p>';
  const days = new Map<string, PublicClass[]>();
  for (const c of list) {
    const t = kst(c.starts_at);
    const key = `${t.m}월 ${t.d}일 (${WEEK[t.w]})`;
    days.set(key, [...(days.get(key) ?? []), c]);
  }
  return [...days.entries()]
    .map(
      ([day, items]) => `<div class="day"><div class="dayname">${esc(day)}</div>${items
        .map((c) => {
          const s = kst(c.starts_at);
          const e = kst(c.ends_at);
          const left = c.left > 0 ? `<span class="left">${c.left}자리</span>` : '<span class="full">마감</span>';
          return `<div class="cls"><div class="time">${pad(s.hh)}:${pad(s.mm)}–${pad(e.hh)}:${pad(e.mm)}</div><div class="ctitle">${esc(c.title)}${
            c.location ? `<span class="loc"> · ${esc(c.location)}</span>` : ''
          }</div>${left}</div>`;
        })
        .join('')}</div>`,
    )
    .join('');
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;background:#FFFFFF;color:#2F3842;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;-webkit-text-size-adjust:100%}
main{max-width:560px;margin:0 auto;padding:0 0 48px}
.photos{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:0;background:#F4F7F5}
.photos img{flex:0 0 100%;width:100%;aspect-ratio:4/3;object-fit:cover;scroll-snap-align:start;display:block}
.noimg{aspect-ratio:3/1;background:linear-gradient(135deg,#0B7A4D,#0B6E46)}
.wrap{padding:20px}
.badge{display:inline-block;background:#E8F6EF;color:#0B6E46;font-size:13px;font-weight:700;border-radius:999px;padding:3px 10px}
h1{font-size:26px;line-height:1.3;margin:10px 0 4px}.headline{font-size:17px;color:#44403C;margin:0}
.cta{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.btn{flex:1;min-width:120px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:14px;padding:13px 14px;font-weight:700;font-size:15px;text-decoration:none;border:0;cursor:pointer}
.primary{background:#0B7A4D;color:#fff}.ghost{background:#F4F7F5;color:#0B6E46}
section{margin-top:28px}h2{font-size:18px;margin:0 0 10px}
.card{background:#F4F7F5;border-radius:18px;padding:16px}
.muted{color:#78716C;font-size:14px;margin:0}
.day+.day{margin-top:14px}.dayname{font-weight:700;font-size:14px;color:#57534E;margin-bottom:6px}
.cls{display:flex;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:10px 12px;margin-top:6px}
.time{font-variant-numeric:tabular-nums;font-weight:700;font-size:14px;white-space:nowrap}.ctitle{flex:1;font-size:15px}.loc{color:#78716C;font-size:13px}
.left{color:#0B6E46;font-weight:700;font-size:13px;white-space:nowrap}.full{color:#A8A29E;font-weight:700;font-size:13px}
.links a{display:block;color:#0B6E46;text-decoration:none;padding:6px 0;font-weight:600}
label{display:block;font-size:14px;font-weight:600;color:#57534E;margin:14px 0 6px}
input[type=text],input[type=tel],textarea{width:100%;font:inherit;font-size:16px;border:1px solid #E7E5E4;border-radius:14px;padding:12px 14px;background:#fff;color:#2F3842}
textarea{min-height:84px;resize:vertical}
.consent{display:flex;gap:10px;align-items:flex-start;margin-top:16px;font-size:14px}
.consent input{width:20px;height:20px;margin-top:2px;accent-color:#0B7A4D}
details{font-size:13px;color:#57534E;margin-top:8px}details p{margin:6px 0 0}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.msg{margin-top:12px;font-size:14px}.err{color:#E11D48}.ok{background:#E8F6EF;color:#0B6E46;border-radius:14px;padding:14px;font-weight:600}
footer{margin:36px 20px 0;padding-top:14px;border-top:1px solid #E6EBE8;font-size:12px;color:#A8A29E}footer a{color:#78716C}
`;

export function renderStudioPage(p: PublicStudioPage, cfg: SiteConfig, nonce: string) {
  const url = `${cfg.siteUrl}/s/${p.slug}`;
  const cover = p.photos[0] ? photoPublicUrl(cfg, p.photos[0]) : `${cfg.siteUrl}/icon.png`;
  const desc = (p.headline || p.intro || `${p.name} 소개 · 체험 수업 신청`).slice(0, 120);
  const title = p.category ? `${p.name} · ${p.category}` : p.name;
  const kakao = httpsOnly(p.kakao_url);
  const web = httpsOnly(p.website_url);
  const tel = p.contact_phone ? p.contact_phone.replace(/[^0-9+]/g, '') : '';
  const mapQ = p.address ? encodeURIComponent(p.address) : '';

  const photos = p.photos.length
    ? `<div class="photos">${p.photos.map((ph, i) => `<img src="${esc(photoPublicUrl(cfg, ph))}" alt="${esc(p.name)} 사진 ${i + 1}" ${i ? 'loading="lazy"' : ''}>`).join('')}</div>`
    : '<div class="noimg"></div>';

  const cta = [
    p.trial_enabled ? '<a class="btn primary" href="#trial">체험 수업 신청</a>' : '',
    tel ? `<a class="btn ghost" href="tel:${esc(tel)}">전화하기</a>` : '',
    kakao ? `<a class="btn ghost" href="${esc(kakao)}" target="_blank" rel="noopener">카카오톡 문의</a>` : '',
  ].join('');

  const links = [
    p.address
      ? `<div><strong>위치</strong><p style="margin:2px 0 6px">${esc(p.address)}</p><a href="https://map.naver.com/p/search/${mapQ}" target="_blank" rel="noopener">네이버 지도에서 보기</a><a href="https://map.kakao.com/?q=${mapQ}" target="_blank" rel="noopener">카카오맵에서 보기</a></div>`
      : '',
    p.contact_phone ? `<a href="tel:${esc(tel)}">전화 ${esc(p.contact_phone)}</a>` : '',
    p.instagram ? `<a href="https://www.instagram.com/${esc(p.instagram)}/" target="_blank" rel="noopener">인스타그램 @${esc(p.instagram)}</a>` : '',
    web ? `<a href="${esc(web)}" target="_blank" rel="noopener">웹사이트</a>` : '',
  ].filter(Boolean);

  const trial = p.trial_enabled
    ? `<section id="trial"><h2>체험 수업 신청</h2><div class="card">
${p.trial_note ? `<p class="muted" style="margin-bottom:6px">${multiline(p.trial_note)}</p>` : ''}
<p class="muted">남겨 주시면 스튜디오에서 연락드려요. 로그인이나 앱 설치는 필요 없어요.</p>
<form id="trial-form" novalidate>
<label for="f-name">이름</label><input id="f-name" name="name" type="text" maxlength="30" autocomplete="name" required>
<label for="f-phone">연락처</label><input id="f-phone" name="phone" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" placeholder="010-1234-5678" required>
<label for="f-pref">희망 요일·시간 (선택)</label><input id="f-pref" name="preferred" type="text" maxlength="100" placeholder="예: 평일 저녁, 토요일 오전">
<label for="f-msg">남길 말 (선택)</label><textarea id="f-msg" name="message" maxlength="500" placeholder="운동 경험, 궁금한 점 등"></textarea>
<div class="hp" aria-hidden="true"><label for="f-company">회사</label><input id="f-company" name="company" type="text" tabindex="-1" autocomplete="off"></div>
<label class="consent"><input id="f-consent" type="checkbox" name="consent"><span>[필수] 체험 수업 안내를 위한 개인정보 수집·이용에 동의합니다.</span></label>
<details><summary>자세히 보기</summary>
<p>· 수집 항목: 이름, 연락처, (선택) 희망 시간, 남길 말</p>
<p>· 목적: ${esc(p.name)}의 체험 수업 안내 연락</p>
<p>· 받는 곳: ${esc(p.name)} 원장·실장 (PIQ 앱으로 전달)</p>
<p>· 보관: 신청일로부터 180일 뒤 자동 삭제, 스튜디오가 운영을 종료하면 즉시 삭제</p>
<p>· 동의하지 않을 수 있으며, 이 경우 체험 신청을 할 수 없어요. <a href="/privacy.html">개인정보 처리방침</a></p>
</details>
<button class="btn primary" style="width:100%;margin-top:16px" type="submit" id="f-submit">신청하기</button>
<div id="f-msg-box" class="msg" role="status" aria-live="polite"></div>
</form></div></section>`
    : '';

  const script = p.trial_enabled
    ? `<script nonce="${nonce}">
(function(){var C=${JSON.stringify({ u: cfg.supabaseUrl, k: cfg.anonKey, s: p.slug }).replace(/</g, '\\u003c')};
var f=document.getElementById('trial-form'),b=document.getElementById('f-submit'),m=document.getElementById('f-msg-box');
function say(t,ok){m.className='msg '+(ok?'ok':'err');m.textContent=t;}
f.addEventListener('submit',function(e){e.preventDefault();
var v=function(id){return document.getElementById(id).value.trim();};
if(!v('f-name')){say('이름을 적어 주세요.');return;}
if(v('f-phone').replace(/[^0-9]/g,'').length<9){say('연락받을 전화번호를 정확히 적어 주세요.');return;}
if(!document.getElementById('f-consent').checked){say('개인정보 수집·이용에 동의해 주세요.');return;}
b.disabled=true;b.textContent='보내는 중…';
fetch(C.u+'/rest/v1/rpc/submit_trial_request',{method:'POST',headers:{'Content-Type':'application/json',apikey:C.k,Authorization:'Bearer '+C.k},
body:JSON.stringify({p_slug:C.s,p_name:v('f-name'),p_phone:v('f-phone'),p_preferred:v('f-pref'),p_message:v('f-msg'),p_consent:true,p_company:document.getElementById('f-company').value})})
.then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
.then(function(x){if(x.ok){f.reset();say('신청했어요! 스튜디오에서 곧 연락드릴게요.',true);b.textContent='신청 완료';}
else{say((x.j&&x.j.message)||'신청하지 못했어요. 잠시 후 다시 시도해 주세요.');b.disabled=false;b.textContent='신청하기';}})
.catch(function(){say('인터넷 연결을 확인하고 다시 시도해 주세요.');b.disabled=false;b.textContent='신청하기';});});})();
</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PIQ">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cover)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLE}</style></head><body><main>
${photos}
<div class="wrap">
${p.category ? `<span class="badge">${esc(p.category)}</span>` : ''}
<h1>${esc(p.name)}</h1>
${p.headline ? `<p class="headline">${esc(p.headline)}</p>` : ''}
${cta ? `<div class="cta">${cta}</div>` : ''}
${p.intro ? `<section><h2>소개</h2><p style="margin:0">${multiline(p.intro)}</p></section>` : ''}
${p.schedule ? `<section><h2>시간표 <span class="muted" style="font-weight:400">· 앞으로 2주</span></h2><div class="card">${scheduleHtml(p.schedule)}</div></section>` : ''}
${p.hours ? `<section><h2>운영 시간</h2><div class="card"><p style="margin:0">${multiline(p.hours)}</p></div></section>` : ''}
${links.length ? `<section><h2>위치·연락</h2><div class="card links">${links.join('')}</div></section>` : ''}
${trial}
</div>
<footer><a href="${esc(cfg.siteUrl)}/">PIQ</a>로 만든 소개 페이지 · <a href="/privacy.html">개인정보 처리방침</a></footer>
</main>${script}</body></html>`;
}

export function renderNotFound(cfg: SiteConfig) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>페이지를 찾을 수 없어요 · PIQ</title><style>${STYLE}</style></head><body><main><div class="wrap" style="padding-top:64px;text-align:center">
<h1>페이지를 찾을 수 없어요</h1><p class="muted">주소가 바뀌었거나, 스튜디오가 페이지를 비공개로 돌렸을 수 있어요.</p>
<p style="margin-top:20px"><a class="btn ghost" href="${esc(cfg.siteUrl)}/">PIQ 홈으로</a></p></div></main></body></html>`;
}

/** 브라우저에서 사진·체험 신청이 Supabase 로만 나가도록 하는 보안 헤더 */
export function securityHeaders(cfg: SiteConfig, nonce: string): Record<string, string> {
  const sb = new URL(cfg.supabaseUrl).origin;
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; img-src 'self' ${sb} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${sb}; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
}
