"""증적 보고서(단일 HTML) 생성. usage: python3 build_report.py <out.html>"""
import base64
import html
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
load = lambda n: json.load(open(os.path.join(D, n)))  # noqa: E731
db = load('r_new.json')['results'] + load('r_d29.json')['results']
db.sort(key=lambda r: r['id'])
before = {r['id']: r for r in load('r_before.json')['results']}
patched = {r['id']: r for r in load('r_p56.json')['results']}
ui = load('ui.json')['results']
e = lambda s: html.escape(str(s).replace('Missing expected rejection.', '거절되어야 하는데 허용됨'))  # noqa: E731


def img(name):
    p = os.path.join(D, name.replace('.png', '.jpg'))
    if not os.path.exists(p):
        return ''
    from PIL import Image
    w, h = Image.open(p).size
    cls = ' class="wide"' if w > h else ''
    return f'<img{cls} src="data:image/jpeg;base64,{base64.b64encode(open(p, "rb").read()).decode()}" alt="{e(name)}">'


def badge(ok):
    return '<span class="b ok">통과</span>' if ok else '<span class="b ng">실패</span>'


db_pass = sum(r['pass'] for r in db)
ui_pass = sum(r['pass'] for r in ui)
total, total_pass = len(db) + len(ui), db_pass + ui_pass

rows_db = ''.join(
    f'<tr><td class="id">{e(r["id"])}</td><td>{e(r["area"])}</td><td>{e(r["title"])}</td><td>{e(r["expected"])}</td>'
    f'<td>{e(r["actual"])}</td><td>{badge(r["pass"])}</td></tr>' for r in db)

extra_shots = {'TC-U11': ['TC-U11a.png', 'TC-U11.png'], 'TC-U03': ['TC-U03a.png', 'TC-U03.png'], 'TC-U06': ['TC-U06a.png', 'TC-U06b.png', 'TC-U06.png'], 'TC-U09': ['TC-U09a.png', 'TC-U09.png']}
cards_ui = ''
for r in ui:
    shots = extra_shots.get(r['id'], [r['shot']])
    pics = ''.join(img(s) for s in shots if os.path.exists(os.path.join(D, s.replace('.png', '.jpg'))))
    cards_ui += (f'<div class="card"><div class="ch"><span class="id">{e(r["id"])}</span> {badge(r["pass"])} <span class="area">{e(r["area"])}</span></div>'
                 f'<h4>{e(r["title"])}</h4><dl><dt>기대</dt><dd>{e(r["expected"])}</dd><dt>실제</dt><dd>{e(r["actual"]).replace(chr(10), " ")}</dd></dl>'
                 f'<div class="pics">{pics}</div></div>')

cmp_rows = ''
for cid in ['TC-D09', 'TC-D30', 'TC-D33']:
    b, a, p = before[cid], next(r for r in db if r['id'] == cid), patched[cid]
    cmp_rows += (f'<tr><td class="id">{cid}</td><td>수정 전 (GitHub 64e7e1b schema)</td><td>{e(b["actual"])}</td><td>{badge(b["pass"])}</td></tr>'
                 f'<tr><td class="id">{cid}</td><td>수정 전 + 패치 005·006 (운영 DB 상태)</td><td>{e(p["actual"])}</td><td>{badge(p["pass"])}</td></tr>'
                 f'<tr><td class="id">{cid}</td><td>수정 후 schema.sql (새로 설치)</td><td>{e(a["actual"])}</td><td>{badge(a["pass"])}</td></tr>')
before_total = f'{sum(r["pass"] for r in before.values())}/{len(before)}'
patched_total = f'{sum(r["pass"] for r in patched.values())}/{len(patched)}'

manual = [
    ('TC-M01', '강사 계정 실제 로그인', '강사로 로그인 → 내 수업만 보임(전체 강사 보기 토글 없음), 회원 탭은 보기 전용(발급·역할·메모 편집 없음), 초대 코드 카드 없음',
     '토글 없음, 회원 상세에 발급 버튼·역할 변경·메모 없음, 내 정보에 초대 코드 카드 없음 (기대 결과의 "회원 탭 없음"은 설계와 달라 "보기 전용"으로 정정)', 'ok', ['M01-1.jpg', 'M01-2.jpg', 'M01-3.jpg', 'M01-4.jpg']),
    ('TC-M02', '운영 DB 패치 005', 'Supabase SQL Editor 에서 005 실행', '사용자가 실행 완료 (2026-11-18)', 'ok', []),
    ('TC-M03', '휴대폰 실행', 'Expo Go 로 실행 → 휴대폰 기본 팝업, 키보드가 메모 입력칸을 가리지 않음, 탭 글자 잘림 없음', '실행 방법 안내함, 결과 대기', 'wait', []),
    ('TC-M04', '24시간 이내 취소(실제 데이터)', '회원(노이솔)으로 오늘 19:00 그룹 예약 → 취소 → 경고 후 취소, 횟수 복구 안 됨',
     '예약 시 그룹 20→19회, 취소 전 "24시간 이내 복구 안 됨" 경고, 취소 후 "복구되지 않았습니다" 안내, 잔여 19회 유지·다가오는 예약에서 사라짐', 'ok', [f'M04-{i}.jpg' for i in range(1, 7)]),
]
def mrow(m):
    st = {'ok': '<span class="b ok">통과</span>', 'wait': '<span class="b wait">대기</span>'}[m[4]]
    return f'<tr><td class="id">{m[0]}</td><td>{e(m[1])}</td><td>{e(m[2])}</td><td>{e(m[3])}</td><td>{st}</td></tr>'
manual_cards = ''.join(
    f'<div class="card"><div class="ch"><span class="id">{m[0]}</span> <span class="b ok">통과</span> <span class="area">{e(m[1])}</span></div>'
    f'<div class="pics">{"".join(img(x) for x in m[5])}</div></div>' for m in manual if m[5])
rows_manual = ''.join(mrow(m) for m in manual)
manual_ok = sum(m[4] == 'ok' for m in manual)

page = f'''<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>테스트 증적 2026-11-18</title><style>
:root{{--ink:#1B1F1E;--brand:#24766A;--muted:#6B6B66;--line:#E7E5E0;--bg:#F6F5F1}}
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}}
main{{max-width:1180px;margin:0 auto;padding:32px 20px 80px}}h1{{font-size:26px;margin:0 0 4px}}h2{{font-size:19px;margin:40px 0 12px}}h4{{margin:6px 0 8px;font-size:15px}}
.sub{{color:var(--muted);font-size:14px}}.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}}
.kpi{{background:#fff;border-radius:14px;padding:16px}}.kpi b{{display:block;font-size:26px}}.kpi span{{color:var(--muted);font-size:13px}}
table{{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;font-size:13px}}th,td{{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
th{{background:#EEF6F3;font-weight:600}}.id{{font-family:ui-monospace,Consolas,monospace;white-space:nowrap;font-size:12px}}
.b{{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap}}.ok{{background:#DCF2E8;color:#14653F}}.ng{{background:#FDE2E2;color:#A12020}}.wait{{background:#F1EFEA;color:#6B6B66}}
.card{{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px}}.ch{{display:flex;gap:8px;align-items:center}}.area{{color:var(--muted);font-size:12px}}
dl{{display:grid;grid-template-columns:44px 1fr;gap:2px 8px;margin:0 0 10px;font-size:13px}}dt{{color:var(--muted)}}dd{{margin:0}}
.pics{{display:flex;gap:10px;overflow-x:auto}}.pics img{{width:240px;border-radius:10px;border:1px solid var(--line);flex:none}}.pics img.wide{{width:540px}}
.note{{background:#fff;border-left:4px solid var(--brand);padding:12px 14px;border-radius:8px;font-size:14px}}code{{background:#F1EFEA;padding:1px 5px;border-radius:4px;font-size:12px}}
@media(max-width:720px){{.kpis{{grid-template-columns:repeat(2,1fr)}}table{{font-size:12px}}}}
</style></head><body><main>
<h1>테스트 증적 — 2026-11-18</h1>
<div class="sub">대상: snorlax-gengar/demo-app (main 64e7e1b 이후 변경분) · 작성: Claude</div>
<div class="kpis">
<div class="kpi"><b>{total_pass}/{total}</b><span>자동 테스트 통과</span></div>
<div class="kpi"><b>{db_pass}/{len(db)}</b><span>DB 규칙 (실제 schema.sql)</span></div>
<div class="kpi"><b>{ui_pass}/{len(ui)}</b><span>화면 (앱 웹 빌드)</span></div>
<div class="kpi"><b>{manual_ok}/{len(manual)}</b><span>직접 확인 (실제 계정·DB)</span></div></div>

<div class="note"><b>테스트 방법</b><br>
· <b>DB 규칙</b>: 저장소의 <code>supabase/schema.sql</code>을 메모리 Postgres(PGlite)에 그대로 설치하고, 원장·실장·강사·회원 6명·다른 스튜디오 원장 계정으로 실제 함수(<code>book_class</code>, <code>cancel_booking</code>, <code>cancel_class</code>, <code>mark_attendance</code>, <code>issue_pass</code> 등)와 접근 권한(RLS)을 호출해 검증.<br>
· <b>화면</b>: 앱을 웹으로 빌드해 가짜 Supabase 서버에 연결하고, 크롬(390×844 휴대폰 크기)으로 실제 클릭·입력하며 캡처. 가짜 데이터이므로 실제 개인정보는 없음.<br>
· 실제 Supabase DB 와 실제 계정은 건드리지 않음.</div>

<h2>1. 이번 변경 사항</h2>
<table><tr><th>구분</th><th>내용</th><th>관련 테스트</th></tr>
<tr><td>버그 수정</td><td>대기 자동 승격 시 수강권 변동 내역에 빈자리를 만든 사람(원장 등)이 처리자로 기록되던 문제 → 처리자 없음 + "자동 확정" 메모, 앱에서 "· 자동" 표시. 패치 <code>005_auto_promotion_actor.sql</code> (기존 기록도 정리)</td><td class="id">TC-D09, TC-D29, TC-U07</td></tr>
<tr><td>권한 수정</td><td>강사는 <b>본인 수업</b>의 예약만 취소·대신 예약, 원장·실장은 모든 수업 관리 (F-01). DB 함수 + 회원 상세 취소 버튼. 패치 <code>006_class_scoped_staff.sql</code></td><td class="id">TC-D30~D33, TC-U11</td></tr>
<tr><td>개선</td><td>회원 메모 편집 시 화면이 밀리던 문제(웹) 수정, 휴대폰에서 키보드가 입력칸을 가리지 않도록 처리. 편집을 열면 커서가 기존 메모 <b>끝</b>에 오도록 수정 (F-02)</td><td class="id">TC-U08</td></tr>
<tr><td>정리</td><td><code>Claude outputs/</code> 폴더를 git 제외 목록에 추가(테스트 보고서의 개인정보 보호)</td><td>-</td></tr>
<tr><td>지난 변경 검증</td><td>로그아웃(앱 안 확인창), 회원 대신 예약, 출석·노쇼 시간 제한, 로그인 문구</td><td class="id">TC-U01~U06, U09, U10</td></tr></table>

<h2>2. 수정 전/후 비교</h2>
<table><tr><th>케이스</th><th>DB 상태</th><th>결과</th><th>판정</th></tr>{cmp_rows}</table>
<p class="sub">전체 DB 케이스: 수정 전 {before_total} · 수정 전+패치 005·006 {patched_total} · 수정 후 {db_pass}/{len(db)}</p>

<h2>3. DB 규칙 테스트 ({db_pass}/{len(db)})</h2>
<table><tr><th>ID</th><th>영역</th><th>시나리오</th><th>기대 결과</th><th>실제 결과</th><th>판정</th></tr>{rows_db}</table>

<h2>4. 화면 테스트 ({ui_pass}/{len(ui)})</h2>
{cards_ui}

<h2>5. 직접 확인 (실제 계정·운영 DB)</h2>
<p class="sub">로그인은 사용자가 직접 하고, TC-M04 조작은 Claude 가 브라우저에서 진행. 캡처의 이메일·연락처는 가림 처리.</p>
<table><tr><th>ID</th><th>항목</th><th>기대 결과</th><th>실제 결과</th><th>판정</th></tr>{rows_manual}</table>
{manual_cards}
<h2>6. 발견 사항</h2>
<table><tr><th>ID</th><th>내용</th><th>근거</th><th>조치</th></tr>
<tr><td class="id">F-01</td><td>강사가 <b>다른 강사 수업</b>의 회원 예약도 취소(기본 횟수 복구)·대신 예약할 수 있었음</td><td>TC-M01 캡처 3, DB <code>cancel_booking</code>·<code>book_class</code> 가 직원 전체 허용</td><td><span class="b ok">조치 완료</span> 강사는 본인 수업만, 원장·실장은 전체 (패치 006, TC-D30~D33·TC-U11)</td></tr>
<tr><td class="id">F-02</td><td>웹에서 기존 메모를 편집하면 커서가 맨 앞에 와서 입력이 앞에 붙음</td><td>화면 테스트 중 발견 ("/ 테스트허리 디스크…")</td><td><span class="b ok">조치 완료</span> 커서를 끝으로 이동, TC-U08 에 검사 추가</td></tr></table>
</main></body></html>'''
open(OUT, 'w').write(page)
print('written', OUT, len(page) // 1024, 'KB')
