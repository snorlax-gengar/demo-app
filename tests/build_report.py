"""증적 보고서(단일 HTML) 생성. usage: python3 build_report.py <out.html>"""
import base64
import html
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
load = lambda n: json.load(open(os.path.join(D, n)))  # noqa: E731
db = load('r_new.json')['results'] + load('r_d29.json')['results'] + load('r_d36.json')['results'] + load('r_push.json')['results'] + load('r_withdraw.json')['results'] + load('r_audit.json')['results'] + load('r_release.json')['results']
db.sort(key=lambda r: r['id'])
before = {r['id']: r for r in load('r_before.json')['results']}
patched = {r['id']: r for r in load('r_p511.json')['results']}
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


def badge(ok, status=None):
    if status == 'warn':
        return '<span class="b warn">확인 필요</span>'
    return '<span class="b ok">통과</span>' if ok else '<span class="b ng">실패</span>'


db_pass = sum(r['pass'] for r in db)
ui_pass = sum(r['pass'] for r in ui)
total, total_pass = len(db) + len(ui), db_pass + ui_pass

rows_db = ''.join(
    f'<tr><td class="id">{e(r["id"])}</td><td>{e(r["area"])}</td><td>{e(r["title"])}</td><td>{e(r["expected"])}</td>'
    f'<td>{e(r["actual"])}</td><td>{badge(r["pass"], r.get("status"))}</td></tr>' for r in db)

extra_shots = {'TC-U41': ['TC-U41a.png', 'TC-U41b.png', 'TC-U41.png'], 'TC-U42': ['TC-U42a.png', 'TC-U42b.png', 'TC-U42c.png', 'TC-U42.png'], 'TC-U19': ['TC-U19a.png', 'TC-U19m.png', 'TC-U19.png'], 'TC-U34': ['TC-U34a.png', 'TC-U34b.png', 'TC-U34.png'], 'TC-U36': ['TC-U36a.png', 'TC-U36.png'], 'TC-U37': ['TC-U37a.png', 'TC-U37.png'], 'TC-U32': ['TC-U32a.png', 'TC-U32.png'], 'TC-U33': ['TC-U33a.png', 'TC-U33.png'], 'TC-U28': ['TC-U28a.png', 'TC-U28.png'], 'TC-U29': ['TC-U29a.png', 'TC-U29.png'], 'TC-U24': ['TC-U24a.png', 'TC-U24.png'], 'TC-U25': ['TC-U25a.png', 'TC-U25b.png', 'TC-U25c.png', 'TC-U25.png'], 'TC-U27': ['TC-U27a.png', 'TC-U27b.png', 'TC-U27.png'], 'TC-U22': ['TC-U22a.png', 'TC-U22.png', 'TC-U22b.png'], 'TC-U19': ['TC-U19a.png', 'TC-U19.png'], 'TC-U15': ['TC-U15a.png', 'TC-U15b.png', 'TC-U15.png'], 'TC-U17': ['TC-U17a.png'], 'TC-U12': ['TC-U12a.png', 'TC-U12.png'], 'TC-U11': ['TC-U11a.png', 'TC-U11.png'], 'TC-U03': ['TC-U03a.png', 'TC-U03.png'], 'TC-U06': ['TC-U06a.png', 'TC-U06b.png', 'TC-U06.png'], 'TC-U09': ['TC-U09a.png', 'TC-U09.png']}
cards_ui = ''
for r in ui:
    shots = extra_shots.get(r['id'], [r['shot']])
    pics = ''.join(img(s) for s in shots if os.path.exists(os.path.join(D, s.replace('.png', '.jpg'))))
    cards_ui += (f'<div class="card"><div class="ch"><span class="id">{e(r["id"])}</span> {badge(r["pass"])} <span class="area">{e(r["area"])}</span></div>'
                 f'<h4>{e(r["title"])}</h4><dl><dt>기대</dt><dd>{e(r["expected"])}</dd><dt>실제</dt><dd>{e(r["actual"]).replace(chr(10), " ")}</dd></dl>'
                 f'<div class="pics">{pics}</div></div>')

cmp_rows = ''
for cid in ['TC-D09', 'TC-D30', 'TC-D33', 'TC-D35', 'TC-D37', 'TC-D40', 'TC-D42']:
    b, a, p = before[cid], next(r for r in db if r['id'] == cid), patched[cid]
    cmp_rows += (f'<tr><td class="id">{cid}</td><td>수정 전 (GitHub 64e7e1b schema)</td><td>{e(b["actual"])}</td><td>{badge(b["pass"])}</td></tr>'
                 f'<tr><td class="id">{cid}</td><td>수정 전 + 패치 005~018 (운영 DB 상태)</td><td>{e(p["actual"])}</td><td>{badge(p["pass"])}</td></tr>'
                 f'<tr><td class="id">{cid}</td><td>수정 후 schema.sql (새로 설치)</td><td>{e(a["actual"])}</td><td>{badge(a["pass"])}</td></tr>')
before_total = f'{sum(r["pass"] for r in before.values())}/{len(before)}'
patched_total = f'{sum(r["pass"] for r in patched.values())}/{len(patched)}'

manual = [
    ('TC-M01', '강사 계정 실제 로그인', '강사로 로그인 → 내 수업만 보임(전체 강사 보기 토글 없음), 회원 탭은 보기 전용(발급·역할·메모 편집 없음), 초대 코드 카드 없음',
     '토글 없음, 회원 상세에 발급 버튼·역할 변경·메모 없음, 내 정보에 초대 코드 카드 없음 (기대 결과의 "회원 탭 없음"은 설계와 달라 "보기 전용"으로 정정)', 'ok', ['M01-1.jpg', 'M01-2.jpg', 'M01-3.jpg', 'M01-4.jpg']),
    ('TC-M02', '운영 DB 패치 005', 'Supabase SQL Editor 에서 005 실행', '사용자가 실행 완료 (2026-11-18)', 'ok', []),
    ('TC-M03', '휴대폰 실행 (iPhone, Expo Go SDK 58)', '휴대폰 기본 팝업, 입력칸 글자 잘림 없음, 키보드가 메모 입력칸을 가리지 않음, 탭 글자 잘림 없음',
     '로그아웃 확인창이 iOS 기본 팝업으로 표시, 입력 중 글자 하단 잘림 발견(F-03) → 수정 후 정상, 메모 입력 시 입력칸이 키보드 위에 보임, 하단 탭 글자 정상', 'ok', ['M03-0.jpg', 'M03-2.jpg', 'M03-1.jpg', 'M03-3.jpg']),
    ('TC-M04', '24시간 이내 취소(실제 데이터)', '회원(노이솔)으로 오늘 19:00 그룹 예약 → 취소 → 경고 후 취소, 횟수 복구 안 됨',
     '예약 시 그룹 20→19회, 취소 전 "24시간 이내 복구 안 됨" 경고, 취소 후 "복구되지 않았습니다" 안내, 잔여 19회 유지·다가오는 예약에서 사라짐', 'ok', [f'M04-{i}.jpg' for i in range(1, 7)]),
    ('TC-M05', '수강권 상품 → 발급 → 매출 (운영 DB, 원장)', '필라테스 나무에서 상품 "[테스트] 그룹 10회 1개월"(200,000원) 등록 → 테스트회원6 발급 화면에서 선택 → 발급 → 매출 반영',
     '상품 등록됨, 선택 시 10회·1개월(11/18~12/17)·200,000원 자동 입력, 발급 완료, 매출 11월 합계 500,000원(기존 11/17 300,000 + 11/18 200,000, 한국 날짜로 집계)', 'ok', [f'M05-{i}.jpg' for i in range(1, 6)]),
    ('TC-M06', '발급 후 결제 추가 (운영 DB, 원장)', '테스트회원6의 "[테스트] 그룹 10회 1개월"에 50,000원·계좌이체·오늘·"[테스트] 잔금" 추가 → 결제 기록·매출 반영',
     '결제일 + 버튼이 오늘에서 비활성, 추가 후 결제 기록 2건·합계 200,000→250,000원, 매출 11월 550,000원·3건·계좌이체 50,000원(9%)·내역에 "[테스트] 잔금" 표시', 'ok', [f'M06-{i}.jpg' for i in range(1, 5)]),
    ('TC-M07', '휴대폰 푸시 (iPhone Expo Go, 운영 DB)', '회원(노이솔) 휴대폰 알림 허용 → 원장이 웹에서 11/19 20:00 [테스트] 수업에 대신 예약 → 직원 취소(복구) → 휴대폰에 푸시 2건',
     '"예약이 확정됐어요 — 11월 19일 (목) 20:00 … 필라테스 나무에서 대신 예약했어요. 수강권 1회가 차감됐어요." / "예약이 취소됐어요 — … 필라테스 나무에서 취소했어요. 수강권 1회가 복구됐어요." 둘 다 즉시 도착, 수강권 19→18→19회', 'ok', ['M07-1.jpg', 'M07-p1.jpg', 'M07-2.jpg', 'M07-3.jpg', 'M07-p2.jpg']),
    ('TC-M08', '대기·자동 확정·폐강·전날 알림 푸시 + 알림 누르기 (iPhone Expo Go, 운영 DB)', '새 [테스트] 수업(정원 2)에서 대신 대기 → 자동 확정 → 폐강, SQL 로 전날 알림 생성 → 앱을 내려둔 상태에서 푸시 누르기 → 알림함',
     '푸시 4종(대기 신청 등록·대기에서 확정·폐강·내일 수업) 도착, 누르면 Studio 앱의 알림함으로 이동. 알림함 위 새로고침 표시가 남는 문제 발견(F-04) → 수정. 참고: 앱을 완전히 종료한 뒤 누르면 Expo Go 첫 화면이 열림(Expo Go 한계, 배포 앱에서는 앱이 바로 열림)', 'ok', ['M08-1.jpg', 'M08-t1.jpg', 'M08-t14.jpg', 'M08-t25.jpg', 'M08-t27.jpg']),
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
<title>테스트 증적 2026-11-20</title><style>
:root{{--ink:#1B1F1E;--brand:#24766A;--muted:#6B6B66;--line:#E7E5E0;--bg:#F6F5F1}}
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}}
main{{max-width:1180px;margin:0 auto;padding:32px 20px 80px}}h1{{font-size:26px;margin:0 0 4px}}h2{{font-size:19px;margin:40px 0 12px}}h4{{margin:6px 0 8px;font-size:15px}}
.sub{{color:var(--muted);font-size:14px}}.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}}
.kpi{{background:#fff;border-radius:14px;padding:16px}}.kpi b{{display:block;font-size:26px}}.kpi span{{color:var(--muted);font-size:13px}}
table{{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;font-size:13px}}th,td{{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
th{{background:#EEF6F3;font-weight:600}}.id{{font-family:ui-monospace,Consolas,monospace;white-space:nowrap;font-size:12px}}
.b{{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap}}.ok{{background:#DCF2E8;color:#14653F}}.ng{{background:#FDE2E2;color:#A12020}}.wait{{background:#F1EFEA;color:#6B6B66}}.warn{{background:#FEF3C7;color:#92400E}}
.card{{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px}}.ch{{display:flex;gap:8px;align-items:center}}.area{{color:var(--muted);font-size:12px}}
dl{{display:grid;grid-template-columns:44px 1fr;gap:2px 8px;margin:0 0 10px;font-size:13px}}dt{{color:var(--muted)}}dd{{margin:0}}
.pics{{display:flex;gap:10px;overflow-x:auto}}.pics img{{width:240px;border-radius:10px;border:1px solid var(--line);flex:none}}.pics img.wide{{width:540px}}
.note{{background:#fff;border-left:4px solid var(--brand);padding:12px 14px;border-radius:8px;font-size:14px}}code{{background:#F1EFEA;padding:1px 5px;border-radius:4px;font-size:12px}}
@media(max-width:720px){{.kpis{{grid-template-columns:repeat(2,1fr)}}table{{font-size:12px}}}}
</style></head><body><main>
<h1>테스트 증적 — 2026-11-20</h1>
<div class="sub">대상: snorlax-gengar/demo-app (main 64e7e1b 이후 변경분) · 작성: Claude</div>
<div class="kpis">
<div class="kpi"><b>{total_pass}/{total}</b><span>자동 테스트 통과</span></div>
<div class="kpi"><b>{db_pass}/{len(db)}</b><span>DB 규칙·보안 점검·출시 설정·로직</span></div>
<div class="kpi"><b>{ui_pass}/{len(ui)}</b><span>화면 (앱 웹 빌드)</span></div>
<div class="kpi"><b>{manual_ok}/{len(manual)}</b><span>직접 확인 (실제 계정·DB)</span></div></div>

<div class="note"><b>테스트 방법</b><br>
· <b>DB 규칙</b>: 저장소의 <code>supabase/schema.sql</code>을 메모리 Postgres(PGlite)에 그대로 설치하고, 원장·실장·강사·회원 6명·다른 스튜디오 원장 계정으로 실제 함수(<code>book_class</code>, <code>cancel_booking</code>, <code>cancel_class</code>, <code>mark_attendance</code>, <code>issue_pass</code> 등)와 접근 권한(RLS)을 호출해 검증.<br>
· <b>화면</b>: 앱을 웹으로 빌드해 가짜 Supabase 서버에 연결하고, 크롬(390×844 휴대폰 크기)으로 실제 클릭·입력하며 캡처. 가짜 데이터이므로 실제 개인정보는 없음.<br>
· <b>푸시 발송</b>: Edge Function 의 발송 로직(core.ts)을 가짜 DB·가짜 Expo 서버로 Node 에서 실행해 검증(실제 휴대폰 발송은 설정 후 확인).<br>
· 자동 테스트는 실제 Supabase DB 와 실제 계정을 건드리지 않음.</div>

<h2>1. 이번 변경 사항</h2>
<table><tr><th>구분</th><th>내용</th><th>관련 테스트</th></tr>
<tr><td>정책 변경</td><td><b>남은 수강권이 있으면 운영자 승인 후 종료 (먹튀 방지)</b>: 회원에게 남은 수강권이 있으면 원장이 바로 종료할 수 없고, 사유를 적어 "운영 종료 요청" → 운영자(app_operators 등록 계정)에게 앱 알림·푸시 → 운영자가 SQL Editor 에서 확인 후 승인(즉시 종료·회원 알림·원장 승인 알림) 또는 반려(원장에게 사유 알림, 재요청 가능). "남은 수강권" = 만료 전 남은 횟수 + 앞으로 확정된 예약 + 최근 30일 안에 줄인 횟수, 중지한 수강권 포함 → 중지·0회로 줄여 놓고 닫는 우회 차단. 원장은 검토 중 요청을 취소할 수 있음. 운영자 처리 함수는 앱 사용자가 실행할 수 없음. 패치 <code>015_close_requests.sql</code>, 운영자용 <code>supabase/admin/close_requests.sql</code><br><b>F-09 수정</b>: 앱을 켜 둔 채 스튜디오가 종료되면 소속 목록이 예전 그대로 남던 문제 → 운영 종료 알림이 새로 오거나 앱이 다시 앞으로 올 때 소속을 다시 불러옴 (<code>components/MembershipSync.tsx</code>)</td><td class="id">TC-D53·D55~D57, TC-U40~U43</td></tr>
<tr><td>신규 기능</td><td><b>스튜디오 운영 종료 + 혼자인 원장 탈퇴 시 자동 종료</b>: 원장이 내 정보 → "스튜디오 운영 종료"에서 영향(폐강될 수업·취소될 예약·알림 받을 사람)을 숫자로 확인하고, 스튜디오 이름을 그대로 입력 + 한 번 더 확인해야 종료. 종료 시 앞으로의 수업 폐강·확정 예약 수강권 횟수 복구 → 남은 사람에게 "운영 종료" 알림 1건 → 모두 나감 처리·초대 코드로 재참여 차단. 지난 예약·출석·수강권·결제 기록은 보관. 회원·강사가 없는 스튜디오의 유일한 원장이 탈퇴하면 그 스튜디오는 자동 종료(알림 없음), 사람이 남은 경우엔 "원장 지정 또는 운영 종료" 안내와 함께 탈퇴를 막음. 종료 직후 미리보기를 다시 불러 권한 오류(400)가 나던 문제를 테스트 중 발견해 고침. 패치 <code>014_close_studio.sql</code> (예전 schema + 패치 005~014 연속 적용, 2회 적용 모두 정상)</td><td class="id">TC-D53·D54, TC-U39~U41</td></tr>
<tr><td>보안 점검</td><td><b>출시 전 보안 점검 1차</b>: 초대 코드 무작위 대입 차단(패치 <code>018_join_rate_limit.sql</code> — 틀린 시도 기록, 1시간 10번·전체 10분 300번 초과 시 차단), 비밀번호 8자 이상, 처리방침에 푸시 전달(Google·Apple)·소개 페이지 호스팅(Expo) 위탁·국외 이전과 만 14세 미만 항목 추가, 체험 신청 보호자 안내. 패치 연속 적용 005~018(018 2회) 정상</td><td class="id">TC-D62, TC-U54, TC-U27</td></tr>
<tr><td>신규 기능</td><td><b>스튜디오 소개 페이지 + 체험 수업 신청</b>: 원장·실장이 앱(내 정보 → 소개 페이지)에서 사진(최대 6장, 스튜디오 폴더에만 업로드)·한 줄 소개·소개글·위치·연락처·운영 시간·시간표 공개·체험 신청을 설정해 <code>piq.expo.app/s/&lt;주소&gt;</code> 로 공개. 페이지는 서버에서 HTML 로 만들어 카카오톡·인스타 링크 미리보기에 스튜디오 이름·대표 사진이 뜸(og 태그), 원장이 쓴 글은 모두 이스케이프, CSP·noindex(404). 방문자는 로그인 없이 이름·연락처·동의로 체험 신청 → 원장·실장에게 알림 + 앱 「체험 신청」 화면(전화·문자·상태·메모). 중복 번호 24시간·스튜디오당 시간당 20건·봇 숨김칸 차단, 180일 뒤/운영 종료 시 자동 삭제, 처리방침 1-1항 추가. 함께 고침: 비밀번호 칸 눈 아이콘(로그인·가입·재설정), 알림함을 열어 둔 채 새 알림이 오면 바로 읽음 처리. 패치 <code>016_studio_pages.sql</code> (예전 schema + 패치 005~018 연속 적용, 016 2회 적용 모두 정상). 실서버 테스트에서 사진 지우기 문제(F-10) 발견 → 패치 <code>017_studio_photos_select.sql</code></td><td class="id">TC-D58~D61, TC-S04, TC-U44~U53</td></tr>
<tr><td>회귀 테스트(2026-11-20)</td><td><b>최신 main(a177cf0) 전체 재검증</b>: 다른 작업에서 추가된 수업 수정·내 기록·내 수강권·간편 로그인 연결/해제·PKCE 콜백·패치 013 포함. 결제일 선택이 달력 창(DatePickerModal)으로 바뀌어 TC-U19 를 새 화면에 맞게 고침(F-07). 새 기능 테스트 추가: 수업 수정 권한·정원·유형(TC-D51·D52), 수업 수정 화면(TC-U34·U35), 회원 이력·수강권 내역(TC-U36), 간편 로그인 연결 관리(TC-U37), PKCE 코드 오류 처리(TC-U38). 공개 페이지 실서버 재확인</td><td class="id">TC-D51·D52, TC-U19·U34~U38</td></tr>
<tr><td>디자인</td><td><b>PIQ 마크·브랜드 색</b>: 받은 마크를 벡터로 정리해 앱 아이콘·안드로이드 적응형·스플래시·로그인 로고·공개 페이지에 적용. 앱 색을 마크 기준으로 — 흰 바탕, 글자 진회색 #2F3842, 메인 초록 #0B7A4D(버튼·수강권 카드), 마크 민트 #53FAA6 는 진행 막대 등 포인트만, 카드는 연한 회색 #F4F7F5. 글자 대비 자동 점검 추가</td><td class="id">TC-R03, TC-R11, 화면 전체</td></tr>
<tr><td>신규 기능</td><td><b>간편 로그인 (카카오·애플·구글)</b>: 로그인 화면 버튼(애플은 iPhone 개발 빌드·배포 앱에서만 기본 애플 버튼). 카카오·구글은 앱 안 브라우저로 로그인 후 앱으로 복귀, 애플은 기기 로그인 창 → 토큰으로 로그인. 처음 들어온 사람과 약관 이전 가입자는 <b>이름 확인 + 약관 동의</b> 화면을 거치고 동의 시각을 계정 정보에 기록. 각 회사 앱 등록·Supabase 키 입력은 <code>docs/social-login-setup.md</code></td><td class="id">TC-U32·U33, TC-R10</td></tr>
<tr><td>운영 설정</td><td><b>Supabase 대시보드 점검·적용(2026-11-18)</b>: Redirect URLs 에 <code>piq://**</code>·<code>exp://**</code> 추가, 탈퇴 함수 Verify JWT 끔. 확인 결과 커스텀 SMTP 없음(기본 메일은 팀원에게만·시간당 2통), 요금제 FREE, Confirm email 꺼짐(SMTP 연결 후 켜야 함), 리전 싱가포르 → 처리방침에 국외 이전 항목 추가. EAS 환경 변수 0개 확인</td><td class="id">—</td></tr>
<tr><td>출시 준비</td><td><b>보안 점검</b>: Supabase 기본 권한(새 표·함수 전부 공개)을 재현한 상태에서 RLS·비로그인 차단·직접 쓰기 권한·권한 상승 함수 설정·내부 함수 차단을 자동 점검 (<code>tests/db/audit.mjs</code>). 점검 중 탈퇴 트리거 함수의 실행 권한을 막는 보완 1건(F-06)</td><td class="id">TC-S01~S07</td></tr>
<tr><td>출시 준비</td><td><b>배포 설정</b>: <code>eas.json</code>(개발 빌드·내부 테스트 APK·스토어 배포, 빌드 번호 자동 증가), expo-dev-client, 암호화 수출 답변, 배포 빌드에 Supabase 값이 빠져도 앱이 꺼지지 않고 안내. 점검 스크립트 <code>scripts/check-release.mjs</code>, 대시보드 설정 목록 <code>docs/production-checklist.md</code></td><td class="id">TC-R01~R09</td></tr>
<tr><td>신규 기능</td><td><b>비밀번호 찾기</b>: 로그인 화면 링크 → 재설정 메일 → 메일의 링크로 앱이 열리면 새 비밀번호 두 번 입력. 앱의 로그인 상태는 건드리지 않고(임시 세션) 변경 후 새 비밀번호로 로그인. 만료 링크 안내, 가입 여부 비노출. 가입 인증 메일도 앱으로 돌아오게(emailRedirectTo), "이메일 인증 전" 로그인 오류 한국어 안내</td><td class="id">TC-U28~U31</td></tr>
<tr><td>출시 준비</td><td><b>스토어용 공개 웹페이지</b>: 개인정보 처리방침·이용약관·계정 삭제 요청 페이지를 앱과 같은 문서에서 생성(<code>scripts/build-legal-site.mjs</code> → <code>public-site/</code>). Google Play 는 앱 안 탈퇴와 별도로 웹 삭제 요청 링크를 요구</td><td class="id">TC-R09</td></tr>
<tr><td>신규 기능</td><td><b>회원 탈퇴</b>: 내 정보 맨 아래 "회원 탈퇴" → 삭제·보존 항목 안내 + 확인 체크 → 최종 확인 → 탈퇴. 이름 "탈퇴 회원"·연락처·이메일·회원 메모·푸시 토큰·알림 삭제, 소속은 탈퇴 처리, 앞으로의 예약·대기는 취소(대기자 자동 확정). 지난 예약·출석·수강권·결제 기록은 익명으로 보존(매출 유지). 로그인 계정은 Edge Function <code>delete-account</code>가 소프트 삭제(행을 지우지 않아 기록 연쇄 삭제 없음, 같은 이메일로 재가입 가능). 다른 원장이 없는 스튜디오의 원장·진행 예정 수업 담당 강사는 먼저 정리하도록 막음. 패치 <code>012_withdraw_account.sql</code></td><td class="id">TC-D48~D50, TC-W01~W04, TC-U25·U26</td></tr>
<tr><td>신규 기능</td><td><b>이용약관·개인정보 처리방침</b>: 앱 안 문서 화면(로그인 전에도 열림), 내 정보 하단 링크, 가입 시 필수 동의 체크(동의 시각·약관 버전을 계정 정보에 기록). 운영자 정보는 <code>lib/legal.ts</code> 의 [자리표시]로 두었음</td><td class="id">TC-U24, TC-U27</td></tr>
<tr><td>출시 준비</td><td><b>앱 이름 PIQ</b>: 표시 이름·로그인 화면 로고·아이콘(안드로이드 적응형 포함)·스플래시·파비콘, 번들 ID <code>com.gengarileo.piq</code>(iOS·Android), 링크 스킴 <code>piq://</code>. EAS 프로젝트 연결이 끊기지 않도록 slug 는 유지</td><td class="id">—</td></tr>
<tr><td>신규 기능</td><td><b>알림 (알림함 + 휴대폰 푸시)</b>: 대신 예약·대신 대기·대기 자동 확정·직원 취소·폐강·수업 전날 20:00 에 회원에게 알림이 쌓임(본인이 한 일은 제외). 회원 홈 종 아이콘(안 읽은 수)·내 정보 "알림" → 알림함, 열면 읽음 처리. 휴대폰은 로그인 시 푸시 토큰 등록·로그아웃 시 해제, 알림을 누르면 앱으로 이동. 발송은 Edge Function <code>send-push</code>(Expo Push, 중복 방지·죽은 토큰 정리)를 알림이 쌓일 때 DB 가 pg_net 으로 직접 호출(Database Webhooks 화면 불필요, 5분마다 재확인). 패치 <code>010_notifications.sql</code>·<code>011_push_hook.sql</code>, 설정 안내 <code>docs/push-setup.md</code></td><td class="id">TC-D42~D47, TC-P01~P04, TC-U22·U23</td></tr>
<tr><td>신규 기능</td><td><b>발급 후 결제 추가</b>: 수강권 상세의 "결제 추가"로 나중에 받은 금액·분할 결제를 금액·수단·결제일(오늘까지, 1년 이내)·메모와 함께 기록 → 매출에 반영. 원장·실장이 추가 가능, 결제 목록은 원장만 보임. 패치 <code>009_add_pass_payment.sql</code></td><td class="id">TC-D40, TC-D41, TC-U19~U21</td></tr>
<tr><td>신규 기능</td><td><b>수강권 상품(가격표)</b>: 원장·실장이 내 정보 → "수강권 상품 관리"에서 이름·유형·횟수·기간(개월/일)·가격을 등록·수정·숨김. 발급 화면 맨 위 "상품에서 고르기"로 고르면 유형·횟수·이름·기간·금액이 자동으로 채워짐(수정 가능). 발급 화면에 일 단위 기간 추가. 강사·회원은 상품을 볼 수 없음. 패치 <code>008_pass_products.sql</code></td><td class="id">TC-D37~D39, TC-U15~U18</td></tr>
<tr><td>신규 기능</td><td><b>원장용 매출 화면</b>: 내 정보의 "이번 달 매출" 카드 → 월별 결제 합계·지난달 대비·건수·건당 평균·일별 막대·결제 수단/수강권 유형별·결제 내역(누르면 수강권 상세), 금액 없이 발급한 수강권 안내. 원장 외에는 카드가 없고 주소로 들어가도 잠금 (결제 기록은 DB 보안 규칙으로 원장만 조회)</td><td class="id">TC-D34, TC-U12~U14</td></tr>
<tr><td>버그 수정</td><td>결제일·수강권 시작일 기본값이 UTC 날짜라 한국 오전 9시 전 결제가 전날로 기록되던 문제 → 한국 날짜로. 기존 기록 보정 포함. 패치 <code>007_kst_dates.sql</code></td><td class="id">TC-D35, TC-D36</td></tr>
<tr><td>버그 수정</td><td>대기 자동 승격 시 수강권 변동 내역에 빈자리를 만든 사람(원장 등)이 처리자로 기록되던 문제 → 처리자 없음 + "자동 확정" 메모, 앱에서 "· 자동" 표시. 패치 <code>005_auto_promotion_actor.sql</code> (기존 기록도 정리)</td><td class="id">TC-D09, TC-D29, TC-U07</td></tr>
<tr><td>권한 수정</td><td>강사는 <b>본인 수업</b>의 예약만 취소·대신 예약, 원장·실장은 모든 수업 관리 (F-01). DB 함수 + 회원 상세 취소 버튼. 패치 <code>006_class_scoped_staff.sql</code></td><td class="id">TC-D30~D33, TC-U11</td></tr>
<tr><td>버그 수정</td><td>iPhone 한 줄 입력칸에서 입력 중 글자 아래가 잘리던 문제 (F-03)</td><td class="id">TC-M03</td></tr>
<tr><td>개선</td><td>회원 메모 편집 시 화면이 밀리던 문제(웹) 수정, 휴대폰에서 키보드가 입력칸을 가리지 않도록 처리. 편집을 열면 커서가 기존 메모 <b>끝</b>에 오도록 수정 (F-02)</td><td class="id">TC-U08</td></tr>
<tr><td>정리</td><td><code>Claude outputs/</code> 폴더를 git 제외 목록에 추가(테스트 보고서의 개인정보 보호)</td><td>-</td></tr>
<tr><td>지난 변경 검증</td><td>로그아웃(앱 안 확인창), 회원 대신 예약, 출석·노쇼 시간 제한, 로그인 문구</td><td class="id">TC-U01~U06, U09, U10</td></tr></table>

<h2>2. 수정 전/후 비교</h2>
<table><tr><th>케이스</th><th>DB 상태</th><th>결과</th><th>판정</th></tr>{cmp_rows}</table>
<p class="sub">전체 DB 케이스: 수정 전 {before_total} · 수정 전+패치 005~018 {patched_total} · 수정 후 {db_pass}/{len(db)}</p>

<h2>3. DB 규칙 테스트 ({db_pass}/{len(db)})</h2>
<table><tr><th>ID</th><th>영역</th><th>시나리오</th><th>기대 결과</th><th>실제 결과</th><th>판정</th></tr>{rows_db}</table>

<h2>4. 화면 테스트 ({ui_pass}/{len(ui)})</h2>
{cards_ui}

<h2>5. 직접 확인 (실제 계정·운영 DB)</h2>
<p class="sub">로그인은 사용자가 직접 하고, TC-M04~M08 조작은 Claude 가 브라우저에서 진행. TC-M03 캡처 순서: 수정 전 입력칸 → 수정 후 입력칸 → 기본 팝업·하단 탭 → 메모 입력. 캡처의 이메일·연락처·초대 코드는 가림 처리.</p>
<table><tr><th>ID</th><th>항목</th><th>기대 결과</th><th>실제 결과</th><th>판정</th></tr>{rows_manual}</table>
{manual_cards}
<h2>6. 발견 사항</h2>
<table><tr><th>ID</th><th>내용</th><th>근거</th><th>조치</th></tr>
<tr><td class="id">F-01</td><td>강사가 <b>다른 강사 수업</b>의 회원 예약도 취소(기본 횟수 복구)·대신 예약할 수 있었음</td><td>TC-M01 캡처 3, DB <code>cancel_booking</code>·<code>book_class</code> 가 직원 전체 허용</td><td><span class="b ok">조치 완료</span> 강사는 본인 수업만, 원장·실장은 전체 (패치 006, TC-D30~D33·TC-U11)</td></tr>
<tr><td class="id">F-02</td><td>웹에서 기존 메모를 편집하면 커서가 맨 앞에 와서 입력이 앞에 붙음</td><td>화면 테스트 중 발견 ("/ 테스트허리 디스크…")</td><td><span class="b ok">조치 완료</span> 커서를 끝으로 이동, TC-U08 에 검사 추가</td></tr>
<tr><td class="id">F-03</td><td>iPhone 에서 한 줄 입력칸에 입력하는 동안 글자 아래(g, @ 등)가 잘려 보임 (키보드를 내리면 정상)</td><td>TC-M03 캡처 1 (수정 전) — 한 줄 입력칸에 줄 높이가 함께 지정된 iOS 동작</td><td><span class="b ok">조치 완료</span> 한 줄 입력칸 12곳을 글자 크기만 지정하도록 변경, 캡처 2 (수정 후)</td></tr>
<tr><td class="id">F-04</td><td>푸시를 눌러 알림함이 열릴 때 위쪽 새로고침 표시(스피너)가 사라지지 않고 목록이 밀린 채 남음 (iOS)</td><td>TC-M08 화면 기록 마지막 장면 — 알림 수신·읽음 처리로 생긴 자동 새로고침에도 스피너를 켜던 구조</td><td><span class="b ok">조치 완료</span> 사용자가 직접 당겼을 때만 표시하도록 11개 화면 변경 (hooks/usePullRefresh)</td></tr>
<tr><td class="id">F-05</td><td>수업 등록 화면을 주소로 바로 열면 등록 후 개발용 "GO_BACK" 경고, 확인창 버튼에 접근성 이름 없음</td><td>TC-M08 준비 중 발견</td><td><span class="b ok">조치 완료</span> 돌아갈 화면이 없으면 달력으로, 확인창 버튼에 버튼 글자를 접근성 이름으로 지정</td></tr>
<tr><td class="id">F-06</td><td>탈퇴 재참여 차단용 트리거 함수(_guard_withdrawn_member)에 로그인 사용자 실행 권한이 남아 있음 (직접 호출해도 트리거 밖에서는 실행 불가라 실제 위험은 없음)</td><td>TC-S04·S05 보안 점검 중 발견</td><td><span class="b ok">조치 완료</span> 패치 012·schema.sql 에 실행 권한 회수 추가</td></tr>
<tr><td class="id">F-07</td><td>결제 추가 화면의 결제일 선택이 ±1일 버튼에서 달력 창으로 바뀌어 기존 화면 테스트(TC-U19)가 옛 버튼 이름을 찾다 실패, 뒤 테스트가 연쇄 실패(22/33)</td><td>2026-11-20 회귀 테스트</td><td><span class="b ok">조치 완료</span> 테스트를 새 화면에 맞추고, 달력 창에서 내일 날짜가 막히는지도 검사하도록 보강 → 38/38</td></tr>
<tr><td class="id">F-08</td><td>내 정보의 "간편 로그인 연결"은 Supabase 의 <b>Allow manual linking</b> 이 켜져 있어야 동작함. 11-18 점검 때 꺼져 있었음(앱은 이 경우 이유를 안내 — TC-U37). 카카오 <b>Allow users without an email</b> 도 꺼져 있어 이메일 제공에 동의하지 않은 카카오 사용자는 가입 실패 가능</td><td>설정 점검</td><td><span class="b warn">확인 필요</span> Supabase 대시보드에서 두 설정 켜기(사용자 결정)</td></tr>
<tr><td class="id">F-09</td><td>운영이 종료되는 순간 앱을 켜 두고 있던 회원은 내 정보에 종료된 스튜디오가 "사용 중"으로 남음(앱을 다시 열면 정상)</td><td>2026-11-20 실DB 테스트(live-test 증적 LT-07)</td><td><span class="b ok">조치 완료</span> 종료 알림 수신·앱 복귀 시 소속 다시 불러오기, TC-U43</td></tr>
<tr><td class="id">F-10</td><td>소개 페이지에서 저장 전에 지운 사진이 저장소에 그대로 남음 (Storage 지우기에 필요한 조회 정책 누락)</td><td>2026-11-20 실서버 테스트(live-test 증적 LP-04)</td><td><span class="b ok">조치 완료</span> 패치 017 (조회 정책 추가), 보안 점검 TC-S09 — 운영 DB 적용 필요</td></tr>
<tr><td class="id">F-11</td><td>작은 사진도 1600px 로 키워서 올림</td><td>2026-11-20 실서버 테스트</td><td><span class="b ok">조치 완료</span> 긴 변이 1600px 보다 클 때만 줄임</td></tr></table>
</main></body></html>'''
open(OUT, 'w').write(page)
print('written', OUT, len(page) // 1024, 'KB')
