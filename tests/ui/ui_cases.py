"""화면 테스트 케이스 (가짜 Supabase 서버 + 실제 앱 웹 빌드). usage: python3 ui_cases.py <shot_dir> <out.json>"""
import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

OUT, RESULT = sys.argv[1], sys.argv[2]
BASE = 'http://127.0.0.1:54321'
results, native_dialogs, errors = [], [], []


def case(cid, area, title, expected):
    def wrap(fn):
        t0 = time.time()
        try:
            actual = fn() or '기대와 같음'
            results.append(dict(id=cid, area=area, title=title, expected=expected, actual=actual, pass_=True, shot=f'{cid}.png', ms=int((time.time() - t0) * 1000)))
            print('PASS', cid, actual)
        except Exception as e:  # noqa: BLE001
            results.append(dict(id=cid, area=area, title=title, expected=expected, actual=str(e).split('\n')[0][:300], pass_=False, shot=f'{cid}.png', ms=int((time.time() - t0) * 1000)))
            print('FAIL', cid, e)
        return fn
    return wrap


with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}))
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='ko-KR', timezone_id='Asia/Seoul')
    pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)[:300]))
    pg.on('console', lambda m: errors.append('console: ' + m.text[:300]) if m.type == 'error' else None)

    def on_dialog(d):  # 브라우저 기본 팝업이 뜨면 기록(뜨면 안 됨)
        native_dialogs.append(d.message[:140])
        d.dismiss()
    pg.on('dialog', on_dialog)
    shot = lambda cid, full=False: pg.screenshot(path=f'{OUT}/{cid}.png', full_page=full)  # noqa: E731

    def login(email):
        pg.goto(BASE + '/')
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=30000)
        pg.fill('input[placeholder="name@example.com"]', email)
        pg.fill('input[placeholder="비밀번호"]', 'x')
        pg.get_by_text('로그인', exact=True).last.click()

    @case('TC-U01', '로그인', '로그인 화면 제목이 "로그인"으로 표시된다', '"로그인" 제목, "다시 오셨네요" 문구 없음')
    def _():
        pg.goto(BASE + '/')
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=30000)
        pg.wait_for_timeout(400)
        shot('TC-U01')
        assert pg.get_by_text('다시 오셨네요').count() == 0, '"다시 오셨네요" 문구가 남아 있음'
        assert pg.get_by_text('로그인', exact=True).count() >= 1
        return '제목 "로그인", 예전 문구 0건'

    login('owner@x.com')
    pg.wait_for_selector('text=전체 강사 보기', timeout=30000)
    pg.wait_for_timeout(600)

    @case('TC-U02', '출석 시간', '시작 3시간 전 수업은 출석·노쇼 버튼이 비활성이고 안내 문구가 보인다', '회색 안내 "출석은 HH:mm부터…", 출석·노쇼 버튼 disabled')
    def _():
        card = pg.get_by_text('[테스트] 저녁 그룹').first
        card.scroll_into_view_if_needed()
        note = pg.get_by_text('출석은', exact=False).first
        note.wait_for(timeout=5000)
        text = note.inner_text()
        btns = pg.locator('[aria-disabled="true"]')
        n = btns.count()
        assert n >= 2, f'비활성 버튼 {n}개'
        before = urllib.request.urlopen(BASE + '/__rpc_log').read()
        btns.first.click(force=True)
        pg.wait_for_timeout(500)
        after = urllib.request.urlopen(BASE + '/__rpc_log').read()
        assert before == after, '비활성 버튼을 눌렀는데 서버 호출이 발생함'
        shot('TC-U02')
        return f'안내 "{text}", 비활성 버튼 {n}개, 눌러도 서버 호출 0건'

    @case('TC-U03', '대신 예약', '수업 상세에 "회원 대신 예약" 버튼이 있고 누르면 회원 목록이 열린다', '버튼 노출 → 예약 화면, 회원별 남은 횟수 표시')
    def _():
        pg.goto(BASE + '/class/c11')
        pg.get_by_text('회원 대신 예약').first.wait_for(timeout=15000)
        pg.wait_for_timeout(300)
        shot('TC-U03a')
        pg.get_by_text('회원 대신 예약').first.click()
        pg.wait_for_selector('input[placeholder="이름 또는 전화번호"]', timeout=10000)
        pg.wait_for_timeout(500)
        shot('TC-U03')
        assert '/book/c11' in pg.url, pg.url
        return f'이동 {pg.url.replace(BASE, "")}, 회원 {pg.get_by_text("그룹 잔여", exact=False).count()}명 잔여 표시'

    @case('TC-U04', '대신 예약', '이미 예약한 회원과 수강권 없는 회원은 고를 수 없다', '김하늘 "이미 예약(대기)함", 오세훈 "사용 가능한 그룹 수강권 없음" 비활성')
    def _():
        already = pg.get_by_text('이미 예약(대기)함').count()
        none = pg.get_by_text('사용 가능한 그룹 수강권 없음').count()
        assert already == 1 and none == 1, f'이미 예약 {already}, 수강권 없음 {none}'
        dis = pg.locator('[aria-disabled="true"]').count()
        assert dis >= 2, f'비활성 {dis}'
        return f'이미 예약 1명·수강권 없음 1명 비활성(총 {dis}개)'

    @case('TC-U05', '대신 예약', '이름·전화번호로 검색할 수 있다', '"정민" 입력 → 정민서만 표시')
    def _():
        pg.fill('input[placeholder="이름 또는 전화번호"]', '정민')
        pg.wait_for_timeout(300)
        shot('TC-U05')
        assert pg.get_by_text('정민서').count() == 1 and pg.get_by_text('최지우').count() == 0
        pg.fill('input[placeholder="이름 또는 전화번호"]', '')
        return '정민서 1명만 표시'

    @case('TC-U06', '대신 예약', '회원을 고르면 차감 내용을 보여주고, 예약하면 완료 안내 후 수업 화면으로 돌아간다', '확인창 "잔여 12회 → 11회" → 예약 → "예약했습니다" → 수업 상세')
    def _():
        pg.get_by_text('최지우').click()
        pg.get_by_text('대신 예약', exact=True).wait_for(timeout=5000)
        msg = pg.get_by_text('수강권 1회가 차감', exact=False).first.inner_text()
        pg.wait_for_timeout(500)
        shot('TC-U06a')
        pg.get_by_role('button', name='예약', exact=True).click()
        pg.get_by_text('예약했습니다').wait_for(timeout=5000)
        pg.wait_for_timeout(500)
        shot('TC-U06b')
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        call = [x for x in log if x['fn'] == 'book_class'][-1]
        assert call['args'] == {'p_class_id': 'c11', 'p_member_id': 'mm0'}, call
        pg.get_by_role('button', name='확인').click()
        pg.wait_for_timeout(500)
        shot('TC-U06')
        assert '/class/c11' in pg.url, pg.url
        return f'확인창 "{msg.strip()}", 서버 호출 book_class(c11, 최지우), 완료 후 {pg.url.replace(BASE, "")}'

    @case('TC-U07', '자동 승격', '수강권 변동 내역에서 자동 승격은 처리자 대신 "자동"으로 표시된다', '"대기 승격 차감" 줄에 "· 자동", 메모 표시')
    def _():
        pg.goto(BASE + '/pass/p2')
        pg.get_by_text('대기 승격 차감').first.wait_for(timeout=15000)
        pg.get_by_text('대기 승격 차감').first.scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        shot('TC-U07')
        row = pg.get_by_text('대기 승격 차감').first.locator('xpath=..')
        t = row.inner_text()
        assert '자동' in t and '이도윤' not in t, t
        return t.replace('\n', ' / ')

    @case('TC-U08', '회원 메모', '메모를 편집해도 화면이 밀리지 않고 입력칸에 바로 입력할 수 있다', '편집 전후 화면 위치 변화 0px, 입력칸 포커스')
    def _():
        pg.goto(BASE + '/member/m1')
        pg.get_by_text('허리 디스크', exact=False).first.wait_for(timeout=15000)
        pg.wait_for_timeout(400)
        y_before = pg.evaluate('() => document.scrollingElement.scrollTop')
        top_before = pg.get_by_text('김하늘', exact=True).first.bounding_box()['y']
        memo_before = pg.get_by_text('허리 디스크', exact=False).first.locator('xpath=..').bounding_box()['y']
        pg.get_by_text('허리 디스크', exact=False).first.click()
        pg.wait_for_timeout(500)
        focused = pg.evaluate('() => document.activeElement && document.activeElement.tagName')
        y_after = pg.evaluate('() => document.scrollingElement.scrollTop')
        top_after = pg.get_by_text('김하늘', exact=True).first.bounding_box()['y']
        memo_after = pg.locator('textarea').bounding_box()['y']
        shot('TC-U08')
        assert focused == 'TEXTAREA', f'포커스 {focused}'
        assert y_before == y_after, f'문서 스크롤 {y_before}→{y_after}'
        assert abs(top_after - top_before) < 1, f'회원 이름 위치 {top_before}→{top_after}'
        assert abs(memo_after - memo_before) < 4, f'메모 칸 위치 {memo_before}→{memo_after}'
        pg.keyboard.type(' / 테스트')
        pg.get_by_text('저장', exact=True).click()
        pg.wait_for_timeout(600)
        return f'문서 스크롤 {y_before}→{y_after}px, 이름 위치 {top_before:.0f}→{top_after:.0f}px, 메모 칸 {memo_before:.0f}→{memo_after:.0f}px, 포커스 {focused}'

    @case('TC-U09', '로그아웃', '로그아웃은 앱 안 확인창으로 묻고, "닫기"는 유지·"로그아웃"은 로그인 화면으로', '앱 안 확인창, 닫기 후 유지, 로그아웃 후 로그인 화면')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_text('로그아웃', exact=True).last.wait_for(timeout=15000)
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_text('로그아웃할까요?').wait_for(timeout=5000)
        pg.wait_for_timeout(500)
        shot('TC-U09a')
        pg.get_by_role('button', name='닫기').click()
        pg.wait_for_timeout(400)
        assert pg.get_by_text('로그아웃할까요?').count() == 0
        assert '/profile' in pg.url
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_text('로그아웃할까요?').wait_for(timeout=5000)
        pg.get_by_role('button', name='로그아웃').last.click()
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=10000)
        pg.wait_for_timeout(400)
        shot('TC-U09')
        return f'닫기 → 내 정보 유지, 로그아웃 → 로그인 화면({pg.url.replace(BASE, "") or "/"})'

    @case('TC-U10', '공통', '테스트 내내 브라우저 기본 팝업(confirm/alert)과 화면 오류가 없다', '브라우저 기본 팝업 0건, 페이지 오류 0건')
    def _():
        real = [e for e in errors if 'favicon' not in e]
        assert not native_dialogs, f'기본 팝업 {native_dialogs}'
        assert not real, real[:3]
        return '기본 팝업 0건, 페이지 오류 0건'

    b.close()

for r in results:
    r['pass'] = r.pop('pass_')
json.dump({'results': results, 'errors': errors, 'native_dialogs': native_dialogs}, open(RESULT, 'w'), ensure_ascii=False, indent=2)
print(f"{sum(r['pass'] for r in results)}/{len(results)} passed")
