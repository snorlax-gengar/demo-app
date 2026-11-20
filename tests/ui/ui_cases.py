"""화면 테스트 케이스 (가짜 Supabase 서버 + 실제 앱 웹 빌드). usage: python3 ui_cases.py <shot_dir> <out.json>"""
import json
import os
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

OUT, RESULT = sys.argv[1], sys.argv[2]
BASE = 'http://127.0.0.1:54321'
# 처리방침에 나와야 할 문의 주소는 lib/legal.ts 에서 읽는다 (테스트 코드에 직접 적지 않음)
LEGAL_EMAIL = re.search(r"email: '([^']+)'", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'lib', 'legal.ts'), encoding='utf-8').read()).group(1)
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

    @case('TC-U08', '회원 메모', '메모를 편집해도 화면이 밀리지 않고 입력칸에 바로 입력할 수 있다', '편집 전후 화면 위치 변화 0px, 입력칸 포커스, 기존 메모 뒤에 이어 쓰기')
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
        typed = pg.locator('textarea').input_value()
        assert typed.endswith(' / 테스트'), f'입력이 끝에 붙지 않음: "{typed}"'
        pg.get_by_text('저장', exact=True).click()
        pg.wait_for_timeout(600)
        return f'입력 결과 "{typed}", 문서 스크롤 {y_before}→{y_after}px, 이름 위치 {top_before:.0f}→{top_after:.0f}px, 메모 칸 {memo_before:.0f}→{memo_after:.0f}px, 포커스 {focused}'

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

    def cancel_buttons():
        """회원 상세 '다가오는 예약'의 취소 버튼들 → 같은 줄에 있는 수업 제목 목록"""
        btns = pg.locator('div[tabindex="0"]').filter(has_text=re.compile(r'^취소$'))
        out = []
        for i in range(btns.count()):
            y = btns.nth(i).bounding_box()['y']
            for t in ['박서연 강사 그룹', '이도윤 원장 그룹']:
                if abs(pg.get_by_text(t, exact=False).first.bounding_box()['y'] - y) < 40:
                    out.append(t)
        return out

    @case('TC-U11', '강사 권한', '회원 상세에서 강사는 본인 수업 예약에만 "취소" 버튼이 보이고, 원장은 모든 수업에 보인다', '원장: 2건 모두 / 강사(박서연): 본인 수업 1건만')
    def _():
        login('owner@x.com')
        pg.wait_for_selector('text=전체 강사 보기', timeout=30000)
        pg.goto(BASE + '/member/m1')
        pg.get_by_text('박서연 강사 그룹', exact=False).first.wait_for(timeout=15000)
        pg.get_by_text('다가오는 예약').first.evaluate('e => e.scrollIntoView({block: "start"})')
        pg.wait_for_timeout(400)
        shot('TC-U11a')
        owner = cancel_buttons()
        assert sorted(owner) == ['박서연 강사 그룹', '이도윤 원장 그룹'], f'원장 {owner}'
        pg.goto(BASE + '/profile')
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_role('button', name='로그아웃').last.click()
        login('teacher@x.com')
        pg.wait_for_selector('text=오늘의 내 수업', timeout=30000)
        pg.goto(BASE + '/member/m1')
        pg.get_by_text('박서연 강사 그룹', exact=False).first.wait_for(timeout=15000)
        pg.get_by_text('다가오는 예약').first.evaluate('e => e.scrollIntoView({block: "start"})')
        pg.wait_for_timeout(400)
        shot('TC-U11')
        teacher = cancel_buttons()
        assert teacher == ['박서연 강사 그룹'], f'강사 {teacher}'
        return f'원장: {", ".join(owner)} / 강사: {", ".join(teacher)}'

    @case('TC-U12', '매출', '원장의 내 정보에 이번 달 매출 카드가 보이고, 누르면 매출 화면이 열린다', '카드 "1,520,000원" → 합계·지난달 대비 26.7% 증가·건수 5건·평균 304,000원')
    def _():
        pg.goto(BASE + '/profile')  # 직전 케이스는 강사로 끝남 → 로그아웃 후 원장으로
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_role('button', name='로그아웃').last.click()
        login('owner@x.com'); pg.wait_for_selector('text=전체 강사 보기', timeout=30000); pg.goto(BASE + '/profile')
        card = pg.get_by_label('매출 보기')
        card.wait_for(timeout=15000)
        pg.get_by_text('1,520,000원').first.wait_for(timeout=10000)
        shot('TC-U12a')
        card.click()
        pg.get_by_label('결제 합계').wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        shot('TC-U12', full=True)
        total = pg.get_by_label('결제 합계').inner_text()
        page = pg.inner_text('body')
        for must in ['1,520,000원', '지난달보다 26.7% 증가', '5건', '304,000원', '카드', '계좌이체', '현금', '결제 내역 5건', '재등록 할인']:
            assert must in page, f'"{must}" 없음'
        return f'합계 {total}, 지난달 대비 26.7% 증가, 5건·평균 304,000원, 수단 3종·내역 5건 표시'

    @case('TC-U13', '매출', '결제 수단·수강권 유형별 금액과 이전 달 이동이 맞게 표시된다', '카드 1,020,000원(67%) / 1:1 450,000원 / 이전 달 합계 1,200,000원')
    def _():
        page = pg.inner_text('body')
        assert '1,020,000원' in page and '67%' in page, '카드 합계/비율'
        assert '450,000원' in page and '1,070,000원' in page, '유형별 합계'
        pg.get_by_label('이전 달').click()
        pg.wait_for_timeout(800)
        prev = pg.get_by_label('결제 합계').inner_text()
        shot('TC-U13')
        assert prev == '1,200,000원', prev
        pg.get_by_label('다음 달').click()
        pg.wait_for_timeout(500)
        nxt = pg.get_by_label('다음 달').get_attribute('aria-disabled')
        return f'카드 1,020,000원(67%), 그룹 1,070,000원·1:1 450,000원, 이전 달 {prev}, 이번 달에서 다음 달 버튼 비활성={nxt}'

    @case('TC-U15', '수강권 상품', '원장이 상품을 등록하면 목록에 "횟수·기간·가격"으로 보인다 (이름 비우면 자동 이름)', '"그룹 20회 · 3개월" 480,000원 등록')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_label('수강권 상품 관리').click()
        pg.get_by_text('등록된 상품이 없습니다').wait_for(timeout=15000)
        shot('TC-U15a')
        pg.get_by_label('상품 추가').click()
        pg.get_by_text('상품 추가', exact=True).wait_for(timeout=10000)
        pg.get_by_role('radio', name='20회').click()
        pg.get_by_role('radio', name='3개월').click()
        pg.get_by_label('가격').fill('480000')
        pg.wait_for_timeout(300)
        shot('TC-U15b')
        pg.get_by_text('등록', exact=True).click()
        pg.get_by_text('상품을 등록했습니다').wait_for(timeout=5000)
        pg.get_by_role('button', name='확인').click()
        pg.get_by_text('그룹 20회 · 3개월', exact=True).wait_for(timeout=10000)
        pg.wait_for_timeout(300)
        shot('TC-U15')
        row = pg.inner_text('body')
        assert '480,000원' in row and '20회 · 3개월' in row
        return '자동 이름 "그룹 20회 · 3개월", 20회 · 3개월 · 480,000원으로 목록 표시'

    @case('TC-U16', '수강권 상품', '일 단위 체험권을 등록하고, 수정 화면에서 숨기면 "숨긴 상품"으로 내려간다', '"체험 1회" 1회 · 14일 · 30,000원 → 숨김')
    def _():
        pg.get_by_label('상품 추가').click()
        pg.get_by_text('상품 추가', exact=True).wait_for(timeout=10000)
        pg.get_by_role('radio', name='1회').click()
        pg.get_by_role('radio', name='일 단위').click()
        pg.get_by_role('radio', name='14일').click()
        pg.get_by_label('가격').fill('30000')
        pg.get_by_label('상품 이름').fill('체험 1회')
        pg.get_by_text('등록', exact=True).click()
        pg.get_by_text('상품을 등록했습니다').wait_for(timeout=5000)
        pg.get_by_role('button', name='확인').click()
        pg.get_by_text('체험 1회', exact=True).wait_for(timeout=10000)
        before = pg.inner_text('body')
        assert '1회 · 14일' in before and '30,000원' in before
        # 수정 → 숨김
        pg.get_by_text('체험 1회', exact=True).click()
        pg.get_by_text('상품 수정').wait_for(timeout=10000)
        pg.get_by_label('발급 화면에 보이기').click()
        pg.get_by_text('저장', exact=True).click()
        pg.get_by_text('수정했습니다').wait_for(timeout=5000)
        pg.get_by_role('button', name='확인').click()
        pg.get_by_text('숨긴 상품 1개').wait_for(timeout=10000)
        pg.wait_for_timeout(300)
        shot('TC-U16')
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        return '체험 1회(1회 · 14일 · 30,000원) 등록 → 숨김 후 "숨긴 상품 1개" 아래 표시'

    @case('TC-U17', '수강권 상품', '발급 화면에서 상품을 고르면 유형·횟수·이름·기간·금액이 채워지고, 숨긴 상품은 안 보인다', '상품 1개만 표시 → 선택 시 20회·3개월·480,000원, 만료일=시작일+3개월-1일 → 발급 요청 값 일치')
    def _():
        pg.goto(BASE + '/pass/new?memberId=mm3')
        pg.get_by_text('상품에서 고르기').wait_for(timeout=15000)
        n = pg.locator('[aria-label^="상품 "]').count()
        assert n == 1, f'보이는 상품 {n}개 (숨긴 상품 제외여야 함)'
        pg.get_by_label('상품 그룹 20회 · 3개월').click()
        pg.wait_for_timeout(300)
        page = pg.inner_text('body')
        import datetime
        start = datetime.date.today()
        m = start.month - 1 + 3
        y, m = start.year + m // 12, m % 12 + 1
        import calendar
        d = min(start.day, calendar.monthrange(y, m)[1])
        exp = datetime.date(y, m, d) - datetime.timedelta(days=1)
        assert '480,000' in page, '금액 자동 입력'
        assert exp.strftime('%Y.%m.%d') in page, f'만료일 {exp}'
        shot('TC-U17a')
        pg.get_by_text('발급', exact=True).last.click()
        pg.get_by_role('button', name='발급').last.click()
        pg.wait_for_timeout(800)
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        call = [x for x in log if x['fn'] == 'issue_pass'][-1]['args']
        assert call['p_total'] == 20 and call['p_amount'] == 480000 and call['p_class_type'] == 'group' and call['p_name'] == '그룹 20회 · 3개월', call
        assert call['p_expires_on'] == exp.isoformat(), call
        shot('TC-U17')
        return f"보이는 상품 1개, 발급 요청: {call['p_name']} / {call['p_total']}회 / {call['p_starts_on']}~{call['p_expires_on']} / {call['p_amount']:,}원"

    @case('TC-U18', '수강권 상품', '일 단위로 바꾸면 만료일이 시작일+N-1일로 계산된다', '14일 선택 → 만료일 = 오늘+13일')
    def _():
        pg.goto(BASE + '/pass/new?memberId=mm3')
        pg.get_by_text('유효기간').wait_for(timeout=15000)
        pg.get_by_role('radio', name='일 단위').click()
        pg.get_by_role('radio', name='14일').click()
        pg.wait_for_timeout(300)
        import datetime
        exp = datetime.date.today() + datetime.timedelta(days=13)
        page = pg.inner_text('body')
        assert exp.strftime('%Y.%m.%d') in page and '14일' in page
        pg.get_by_text('유효기간').scroll_into_view_if_needed()
        shot('TC-U18')
        return f'14일권 만료일 {exp.strftime("%Y.%m.%d")} (오늘+13일)'

    @case('TC-U19', '결제 추가', '원장이 수강권 상세에서 나중에 받은 금액을 추가하면 결제 기록·합계에 바로 보인다', '50,000원·계좌이체·어제·"잔금" 추가 → 2건, 합계 220,000원')
    def _():
        import datetime
        pg.goto(BASE + '/pass/p6')
        pg.get_by_text('결제 기록 · 원장만 보임').wait_for(timeout=15000)
        pg.get_by_text('합계 170,000원').wait_for(timeout=10000)
        pg.get_by_label('결제 추가').click()
        pg.get_by_label('결제 금액').fill('50000')
        pg.get_by_role('radio', name='계좌이체').click()
        plus_disabled = pg.get_by_label('하루 뒤', exact=True).last.get_attribute('aria-disabled')
        # 날짜를 누르면 달력 창이 열리고, 오늘 이후 날짜는 고를 수 없다
        pg.get_by_label(re.compile('달력에서 선택$')).last.click()
        pg.get_by_text('결제일 선택').wait_for(timeout=5000)
        tomorrow = datetime.date.today() + datetime.timedelta(days=1)
        cal_future = pg.locator(f'[aria-label="{tomorrow.strftime("%Y.%m.%d")}"]')
        fut_dis = cal_future.first.get_attribute('aria-disabled') if cal_future.count() else 'next-month'
        shot('TC-U19m')
        pg.get_by_label('닫기').last.click()
        pg.get_by_label('하루 전', exact=True).last.click()
        pg.get_by_label('결제 메모').fill('잔금')
        pg.wait_for_timeout(300)
        shot('TC-U19a')
        pg.get_by_text('추가', exact=True).last.click()
        pg.get_by_role('button', name='추가').last.click()
        pg.get_by_text('결제를 추가했습니다').wait_for(timeout=5000)
        pg.get_by_role('button', name='확인').click()
        pg.get_by_text('합계 220,000원').wait_for(timeout=10000)
        pg.wait_for_timeout(300)
        shot('TC-U19')
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        call = [x for x in log if x['fn'] == 'add_pass_payment'][-1]['args']
        y = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        assert call == {'p_pass_id': 'p6', 'p_amount': 50000, 'p_method': 'transfer', 'p_paid_on': y, 'p_memo': '잔금'}, call
        assert plus_disabled == 'true', f'오늘 이후 버튼 {plus_disabled}'
        assert fut_dis in ('true', 'next-month'), f'달력의 내일 날짜 {fut_dis}'
        return f'요청 add_pass_payment(50,000원, transfer, {y}, 잔금), 합계 170,000→220,000원, "하루 뒤" 버튼·달력의 내일 날짜 비활성({fut_dis})'

    @case('TC-U20', '결제 추가', '추가한 결제가 매출 화면 합계에 반영된다', '이번 달 1,520,000원 → 1,570,000원 (결제일이 이번 달일 때)')
    def _():
        import datetime
        y = datetime.date.today() - datetime.timedelta(days=1)
        expect = '1,570,000원' if y.month == datetime.date.today().month else '1,520,000원'
        pg.goto(BASE + '/revenue')
        pg.get_by_label('결제 합계').wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        total = pg.get_by_label('결제 합계').inner_text()
        assert total == expect, total
        assert '잔금' in pg.inner_text('body')
        shot('TC-U20')
        return f'매출 합계 {total}, 결제 내역에 "잔금" 표시'

    @case('TC-U14', '매출', '강사에게는 매출·수강권 상품 카드가 없고, 매출 주소로 들어가도 "원장만 볼 수 있습니다"', '카드 0개 / 잠금 안내, 결제 조회 요청 0건')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_role('button', name='로그아웃').last.click()
        login('teacher@x.com')
        pg.wait_for_selector('text=오늘의 내 수업', timeout=30000)
        pg.goto(BASE + '/profile')
        pg.get_by_text('내 스튜디오').wait_for(timeout=15000)
        cards = pg.get_by_label('매출 보기').count() + pg.get_by_label('수강권 상품 관리').count()
        reqs = []
        pg.on('request', lambda r: reqs.append(r.url) if 'pass_payments' in r.url else None)
        pg.goto(BASE + '/revenue')
        pg.get_by_text('원장만 볼 수 있습니다').wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        shot('TC-U14')
        assert cards == 0, f'카드 {cards}'
        assert not reqs, reqs
        return f'매출·상품 카드 {cards}개, /revenue → 잠금 안내, 결제 조회 요청 {len(reqs)}건'

    @case('TC-U21', '결제 추가', '실장은 결제 목록은 못 보지만 결제를 추가할 수 있다', '"결제 기록은 원장만 볼 수 있습니다" 안내 + 결제 추가 성공')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_role('button', name='로그아웃').last.click()
        login('manager@x.com')
        pg.wait_for_selector('text=전체 강사 보기', timeout=30000)
        pg.goto(BASE + '/pass/p6')
        pg.get_by_text('결제 기록은 원장만 볼 수 있습니다', exact=False).wait_for(timeout=15000)
        listed = pg.get_by_text('합계', exact=False).count()
        pg.get_by_label('결제 추가').click()
        pg.get_by_label('결제 금액').fill('30000')
        pg.get_by_text('추가', exact=True).last.click()
        pg.get_by_role('button', name='추가').last.click()
        pg.get_by_text('결제를 추가했습니다').wait_for(timeout=5000)
        pg.wait_for_timeout(300)
        shot('TC-U21')
        pg.get_by_role('button', name='확인').click()
        assert listed == 0, f'실장에게 합계 {listed}개 노출'
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        call = [x for x in log if x['fn'] == 'add_pass_payment'][-1]['args']
        assert call['p_amount'] == 30000
        return f'결제 목록·합계 노출 0, 추가 요청 {call["p_amount"]:,}원 성공'

    @case('TC-U23', '알림', '직원(실장)의 내 정보에도 알림함이 있고, 알림이 없으면 안내가 보인다', '"알림" 줄 → "아직 알림이 없습니다", 웹에서는 휴대폰 알림 불가 안내')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_label('알림함').click()
        pg.get_by_text('아직 알림이 없습니다').wait_for(timeout=15000)
        note = pg.locator('text=이 기기(웹·시뮬레이터)에서는 휴대폰 알림을 받을 수 없어요. 알림은 여기에서 확인하세요.').locator('visible=true').count()
        shot('TC-U23')
        assert note == 1
        return '알림함 빈 안내 표시, 웹 안내 문구 표시'

    @case('TC-U22', '알림', '회원 홈의 종 아이콘에 안 읽은 알림 수가 보이고, 알림함을 열면 목록이 보이고 잠시 뒤 읽음 처리된다', '종 "2" → 알림 3건(새 알림 2) → 읽음 처리 요청 → 돌아오면 숫자 사라짐')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_role('button', name='로그아웃').last.click()
        login('member@x.com')
        pg.wait_for_selector('text=내 수강권', timeout=30000)
        bell = pg.get_by_label('알림 2개 새로 옴')
        bell.wait_for(timeout=15000)
        shot('TC-U22a')
        bell.click()
        pg.get_by_text('대기에서 예약이 확정됐어요').wait_for(timeout=15000)
        rows = pg.locator('[aria-label^="알림 "]').locator('visible=true').count()
        dots = pg.get_by_label('새 알림').locator('visible=true').count()
        shot('TC-U22')
        pg.wait_for_timeout(2500)
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        marked = [x for x in log if x['fn'] == 'mark_notifications_read']
        pg.get_by_label('뒤로').click()
        pg.wait_for_selector('text=내 수강권', timeout=15000)
        pg.wait_for_timeout(800)
        after = pg.get_by_label('알림', exact=True).locator('visible=true').count()
        shot('TC-U22b')
        assert rows == 3 and dots == 2, f'목록 {rows}, 새 알림 {dots}'
        assert len(marked) == 1 and marked[0]['args'] == {'p_ids': None}, marked
        assert after == 1, '읽음 후 종 숫자 남음'
        return f'종 배지 2 → 알림 {rows}건(새 알림 {dots}) → 읽음 처리 1회 → 종 배지 사라짐'

    def open_member_profile():  # 회원의 '내 정보'는 탭으로 연다 (/profile 주소는 직원 탭과 겹침)
        pg.goto(BASE + '/')
        pg.wait_for_selector('text=내 수강권', timeout=30000)
        pg.get_by_text('내 정보', exact=True).last.click()
        pg.get_by_text('로그아웃', exact=True).last.wait_for(timeout=15000)

    @case('TC-U24', '약관', '내 정보 아래의 링크로 이용약관·개인정보 처리방침을 볼 수 있다', '이용약관(제1조~부칙, 탈퇴 조항) / 처리방침(처리 항목·보관·국외 이전·간편 로그인·보호책임자), 운영자 정보 채워짐(자리표시 없음)')
    def _():
        open_member_profile()
        pg.get_by_role('link', name='이용약관').last.click()
        pg.get_by_text('제7조 (탈퇴)').wait_for(timeout=15000)
        n_terms = pg.locator('text=/^제\\d+조/').locator('visible=true').count()
        shot('TC-U24a')
        pg.get_by_label('뒤로').locator('visible=true').click()
        pg.get_by_role('link', name='개인정보 처리방침').last.click()
        pg.get_by_text('8. 개인정보 보호책임자').wait_for(timeout=15000)
        holder = pg.get_by_text(LEGAL_EMAIL, exact=False).locator('visible=true').count()
        leftover = pg.locator('text=/\\[(운영자명|문의 이메일|시행일|리전)/').count()
        shot('TC-U24')
        pg.get_by_label('뒤로').locator('visible=true').click()
        assert n_terms >= 10, n_terms
        assert holder >= 1 and leftover == 0, (holder, leftover)
        return f'이용약관 {n_terms}개 조항, 처리방침에 보호책임자 연락처 표시, 남은 자리표시 {leftover}개'

    @case('TC-U25', '회원 탈퇴', '안내 확인 체크 전에는 탈퇴 버튼이 막혀 있고, 확인 → 최종 확인창 → 탈퇴 완료 후 로그인 화면으로 돌아간다', '체크 전 비활성(요청 0) → 체크 → "정말 탈퇴할까요?" → 탈퇴하기 → "탈퇴가 완료됐어요" → 로그인 화면, 요청 1번(본인)')
    def _():
        open_member_profile()
        pg.get_by_role('link', name='회원 탈퇴').last.click()
        pg.get_by_text('바로 삭제돼요').wait_for(timeout=15000)
        btn = pg.get_by_label('회원 탈퇴하기')
        disabled_before = btn.get_attribute('aria-disabled')
        btn.click(force=True)
        pg.wait_for_timeout(300)
        log0 = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'delete-account']
        shot('TC-U25a', full=True)
        pg.get_by_label('안내를 모두 확인했어요').click()
        btn.click()
        pg.get_by_text('정말 탈퇴할까요?').wait_for(timeout=5000)
        pg.wait_for_timeout(600)  # 확인창이 다 나타난 뒤 캡처
        shot('TC-U25b')
        pg.get_by_role('button', name='탈퇴하기', exact=True).click()
        pg.get_by_text('탈퇴가 완료됐어요').wait_for(timeout=10000)
        pg.wait_for_timeout(600)  # 확인창이 다 나타난 뒤 캡처
        shot('TC-U25c')
        pg.get_by_role('button', name='확인').click()
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=15000)
        pg.wait_for_timeout(300)
        shot('TC-U25')
        log = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'delete-account']
        assert disabled_before == 'true' and len(log0) == 0, (disabled_before, log0)
        assert len(log) == 1 and log[0]['args']['me'] == 'm1', log
        return '체크 전 비활성·요청 0 → 확인창 → 탈퇴 완료 → 로그인 화면, 탈퇴 요청 1번(회원 본인)'

    @case('TC-U26', '회원 탈퇴', '탈퇴가 막히는 경우(유일한 원장) 서버 안내를 그대로 보여주고 로그인은 유지된다', '"탈퇴할 수 없습니다" + 스튜디오 이름이 든 안내, 확인 후 탈퇴 화면에 그대로')
    def _():
        login('owner@x.com')
        pg.wait_for_selector('text=전체 강사 보기', timeout=30000)
        pg.goto(BASE + '/withdraw')
        n_err = len(errors)
        pg.get_by_label('안내를 모두 확인했어요').click()
        pg.get_by_label('회원 탈퇴하기').click()
        pg.get_by_role('button', name='탈퇴하기', exact=True).click()
        pg.get_by_text('탈퇴할 수 없습니다').wait_for(timeout=10000)
        msg = pg.get_by_text('다른 원장이 없는 스튜디오가 있어', exact=False).last.inner_text()
        # 서버가 400 으로 거절한 것은 의도한 동작 → 공통 오류 검사(TC-U10)에서 제외
        expected_400 = [e for e in errors[n_err:] if 'status of 400' in e]
        for e in expected_400:
            errors.remove(e)
        pg.wait_for_timeout(600)  # 확인창이 다 나타난 뒤 캡처
        shot('TC-U26')
        pg.get_by_role('button', name='확인').click()
        pg.wait_for_timeout(300)
        still = pg.get_by_text('바로 삭제돼요').count()
        assert '데모 필라테스' in msg and still == 1
        return f'안내 "{msg[:40]}…", 확인 후 탈퇴 화면 유지(로그인 유지), 서버 거절 응답 400 {len(expected_400)}건(의도)'

    @case('TC-U27', '약관', '가입은 약관 동의를 체크해야 할 수 있고, 로그인 전에도 약관을 열어 볼 수 있으며, 동의 시각이 계정 정보에 남는다', '동의 전 가입 버튼 비활성 → 처리방침 링크 열림(비로그인) → 동의 후 가입 요청에 terms_agreed_at·terms_version 포함')
    def _():
        pg.goto(BASE + '/profile')
        pg.get_by_text('로그아웃', exact=True).last.click()
        pg.get_by_role('button', name='로그아웃').last.click()
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=15000)
        pg.get_by_text('회원가입', exact=False).last.click()
        pg.wait_for_selector('input[placeholder="홍길동"]', timeout=15000)
        pg.fill('input[placeholder="홍길동"]', '새회원')
        pg.locator('input[placeholder="name@example.com"]').locator('visible=true').fill('fresh@x.com')
        pg.locator('input[placeholder="비밀번호"]').locator('visible=true').fill('abcdef')
        submit = pg.get_by_text('가입하기', exact=True).locator('visible=true')
        submit.click(force=True)
        pg.wait_for_timeout(300)
        before = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'signup']
        shot('TC-U27a', full=True)
        pg.get_by_text('개인정보 처리방침', exact=True).locator('visible=true').click()
        pg.get_by_text('1. 처리하는 개인정보').wait_for(timeout=10000)
        opened = pg.url.replace(BASE, '')
        pg.get_by_label('뒤로').locator('visible=true').click()
        pg.wait_for_selector('input[placeholder="홍길동"]', timeout=10000)
        if not pg.locator('input[placeholder="홍길동"]').locator('visible=true').input_value():
            pg.fill('input[placeholder="홍길동"]', '새회원')
            pg.locator('input[placeholder="name@example.com"]').locator('visible=true').fill('fresh@x.com')
            pg.locator('input[placeholder="비밀번호"]').locator('visible=true').fill('abcdef')
        pg.get_by_label('이용약관과 개인정보 처리방침에 동의').locator('visible=true').click()
        shot('TC-U27b', full=True)
        pg.get_by_text('가입하기', exact=True).locator('visible=true').click()
        pg.get_by_text('인증 메일을 보냈습니다').wait_for(timeout=10000)
        pg.wait_for_timeout(600)  # 확인창이 다 나타난 뒤 캡처
        shot('TC-U27')
        pg.get_by_role('button', name='확인').click()
        after = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'signup']
        assert len(before) == 0, before
        assert opened == '/legal/privacy', opened
        assert len(after) == 1 and after[0]['args']['data'].get('terms_agreed_at') and after[0]['args']['data'].get('terms_version'), after
        assert after[0]['args']['redirect_to'], '인증 메일이 돌아올 주소(emailRedirectTo) 없음'
        return f'동의 전 요청 0 → 비로그인 {opened} 열림 → 동의 후 가입 요청 1번(terms_agreed_at {after[0]["args"]["data"]["terms_agreed_at"][:19]}, 약관 {after[0]["args"]["data"]["terms_version"]})'

    @case('TC-U28', '비밀번호 찾기', '로그인 화면의 "비밀번호를 잊으셨나요?" → 이메일 입력 → 재설정 메일 요청, 가입 여부는 드러내지 않는다', '메일 요청 1번(돌아올 주소 /reset-password), "가입된 계정이 있으면 … 보냈어요" 안내')
    def _():
        pg.goto(BASE + '/')
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=30000)
        pg.get_by_text('비밀번호를 잊으셨나요?').click()
        pg.get_by_text('비밀번호 찾기', exact=True).wait_for(timeout=10000)
        btn = pg.get_by_label('재설정 메일 보내기')
        dis = btn.get_attribute('aria-disabled')
        pg.locator('input[placeholder="name@example.com"]').locator('visible=true').fill('member@x.com')
        shot('TC-U28a')
        btn.click()
        pg.get_by_text('가입된 계정이 있으면', exact=False).wait_for(timeout=10000)
        pg.wait_for_timeout(300)
        shot('TC-U28')
        call = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'recover']
        assert dis == 'true', dis
        assert len(call) == 1 and call[0]['args']['email'] == 'member@x.com' and call[0]['args']['redirect_to'].endswith('/reset-password'), call
        return f'입력 전 버튼 비활성 → 요청 1번(email, redirect_to …{call[0]["args"]["redirect_to"][-15:]}) → 안내 표시'

    @case('TC-U29', '비밀번호 찾기', '메일의 재설정 링크로 열면 새 비밀번호를 두 번 입력해 바꾸고, 앱 로그인 상태는 건드리지 않는다', '불일치 시 "두 비밀번호가 달라요"·버튼 비활성 → 일치 → 변경 요청 1번(링크의 계정) → "비밀번호를 바꿨어요" → 로그인 화면(자동 로그인 없음)')
    def _():
        import base64
        b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')  # noqa: E731
        tok = f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': 'm1', 'email': 'member@x.com', 'role': 'authenticated', 'exp': int(time.time()) + 3600})}.sig"
        pg.goto(BASE + f'/reset-password#access_token={tok}&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery')
        pg.get_by_text('새 비밀번호', exact=True).first.wait_for(timeout=20000)
        pg.locator('input[placeholder="새 비밀번호"]').fill('newpass1')
        pg.locator('input[placeholder="새 비밀번호 확인"]').fill('newpass2')
        mismatch = pg.get_by_text('두 비밀번호가 달라요.').count()
        dis = pg.get_by_label('비밀번호 바꾸기').get_attribute('aria-disabled')
        shot('TC-U29a')
        pg.locator('input[placeholder="새 비밀번호 확인"]').fill('newpass1')
        pg.get_by_label('비밀번호 바꾸기').click()
        pg.get_by_text('비밀번호를 바꿨어요').wait_for(timeout=10000)
        pg.wait_for_timeout(600)
        shot('TC-U29')
        pg.get_by_role('button', name='확인').click()
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=15000)
        call = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'update_user']
        assert mismatch == 1 and dis == 'true', (mismatch, dis)
        assert len(call) == 1 and call[0]['args']['me'] == 'm1' and call[0]['args']['password'] == '(입력됨)', call
        return '불일치 안내·버튼 비활성 → 변경 요청 1번(링크의 계정 m1) → 완료 → 로그인 화면(자동 로그인 없음)'

    @case('TC-U30', '비밀번호 찾기', '만료됐거나 이미 쓴 링크로 열면 입력칸 대신 다시 받기 안내가 보인다', '"링크가 만료됐거나 이미 사용됐어요" + "메일 다시 받기" → 비밀번호 찾기 화면')
    def _():
        pg.goto(BASE + '/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
        pg.get_by_text('링크가 만료됐거나 이미 사용됐어요', exact=False).wait_for(timeout=20000)
        inputs = pg.locator('input[placeholder="새 비밀번호"]').count()
        shot('TC-U30')
        pg.get_by_text('메일 다시 받기').click()
        pg.get_by_text('비밀번호 찾기', exact=True).wait_for(timeout=10000)
        assert inputs == 0
        return f'만료 안내 표시, 입력칸 {inputs}개, "메일 다시 받기" → {pg.url.replace(BASE, "")}'

    @case('TC-U31', '로그인', '이메일 인증 전에 로그인하면 영어 오류 대신 한국어 안내가 보인다', '"이메일 인증이 아직 안 됐어요…"')
    def _():
        pg.goto(BASE + '/')
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=30000)
        pg.fill('input[placeholder="name@example.com"]', 'unconfirmed@x.com')
        pg.fill('input[placeholder="비밀번호"]', 'x')
        pg.get_by_text('로그인', exact=True).last.click()
        pg.get_by_text('이메일 인증이 아직 안 됐어요', exact=False).wait_for(timeout=10000)
        n_err = len(errors)
        shot('TC-U31')
        for e in [e for e in errors if 'status of 400' in e]:
            errors.remove(e)  # 서버가 400 으로 거절하는 것이 의도한 동작
        return '안내 "이메일 인증이 아직 안 됐어요. 가입할 때 받은 메일의 링크를 눌러 주세요."'

    @case('TC-U32', '소셜 로그인', '로그인 화면의 "카카오로 계속하기" → 카카오 로그인(가짜 서버) → 앱으로 돌아와 로그인되고, 처음이면 약관 동의 화면이 뜬다', '카카오·구글 버튼 표시(웹은 애플 숨김) → 인증 요청(provider=kakao, 돌아올 주소 /auth-callback) → "거의 다 됐어요", 이름칸에 카카오 닉네임')
    def _():
        pg.goto(BASE + '/')
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=30000)
        kakao, google = pg.get_by_label('카카오로 계속하기'), pg.get_by_label('Google로 계속하기')
        n_k, n_g = kakao.count(), google.count()
        # 버튼 모양 통일: 높이·글자 크기·글자 굵기가 같고, 구글 G 는 컬러 이미지
        look = pg.evaluate('''() => ['카카오로 계속하기','Google로 계속하기'].map(l => { const b = document.querySelector(`[aria-label="${l}"]`); const t = [...b.querySelectorAll('div')].find(d => d.textContent === l && !d.children.length) || b; const cs = getComputedStyle(t); return [Math.round(b.getBoundingClientRect().height), cs.fontSize, cs.fontWeight, !!b.querySelector('img')]; })''')
        shot('TC-U32a', full=True)
        with c.expect_page(timeout=15000) as pop:
            kakao.click()
        popup = pop.value
        popup.wait_for_load_state()
        back_url = popup.url  # 카카오(가짜) 로그인 후 돌아온 주소: …/auth-callback#access_token=…
        popup.close()
        # 휴대폰에서는 앱 안 브라우저가 이 주소를 앱에 넘겨준다. 웹 테스트에서는 같은 주소를 앱에서 열어 재현
        pg.goto(back_url)
        pg.get_by_text('거의 다 됐어요').wait_for(timeout=20000)
        name = pg.locator('input[placeholder="홍길동"]').input_value()
        pg.wait_for_timeout(300)
        shot('TC-U32')
        call = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'authorize']
        assert n_k == 1 and n_g == 1, (n_k, n_g)
        assert look[0][:3] == look[1][:3] and look[1][3] and not look[0][3], look
        assert '/auth-callback#access_token=' in back_url, back_url
        assert len(call) == 1 and call[0]['args']['provider'] == 'kakao' and call[0]['args']['redirect_to'].endswith('/auth-callback'), call
        assert name == '카카오닉네임', name
        return f'버튼 카카오·구글 높이 {look[0][0]}px·글자 {look[0][1]} 동일, 구글 컬러 G 이미지 → 인증 요청 provider={call[0]["args"]["provider"]} → 로그인 후 약관 동의 화면, 이름칸 "{name}"'

    @case('TC-U33', '소셜 로그인', '약관 동의 화면: 동의 체크 전에는 진행할 수 없고, 이름을 고쳐 동의하면 이름·동의 시각이 저장되고 스튜디오 참여 화면으로 간다', '체크 전 버튼 비활성 → 이름 "김카카오"로 수정·동의 → users.name 수정 + 계정 정보에 terms_agreed_at → 스튜디오 만들기/참여 화면')
    def _():
        btn = pg.get_by_label('동의하고 시작하기')
        dis = btn.get_attribute('aria-disabled')
        pg.locator('input[placeholder="홍길동"]').fill('김카카오')
        pg.get_by_label('이용약관과 개인정보 처리방침에 동의').click()
        shot('TC-U33a')
        btn.click()
        pg.get_by_text('초대 코드', exact=False).first.wait_for(timeout=20000)
        pg.wait_for_timeout(500)
        shot('TC-U33')
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        upd = [x for x in log if x['fn'] == 'users_update']
        meta = [x for x in log if x['fn'] == 'update_user' and x['args'].get('data')]
        assert dis == 'true', dis
        assert upd and upd[-1]['args'] == {'id': 'k1', 'name': '김카카오'}, upd
        assert meta and meta[-1]['args']['data'].get('terms_agreed_at') and meta[-1]['args']['data']['name'] == '김카카오', meta
        return f'체크 전 비활성 → 이름 "김카카오" 저장, 동의 시각 {meta[-1]["args"]["data"]["terms_agreed_at"][:19]} 기록 → 스튜디오 참여 화면'

    def fresh_login(email, wait_text):  # 저장된 로그인 지우고 다시 로그인
        pg.goto(BASE + '/')
        pg.evaluate('localStorage.clear()')
        login(email)
        pg.wait_for_selector(f'text={wait_text}', timeout=30000)

    @case('TC-U34', '수업 수정', '원장이 예정 수업의 이름·장소·날짜를 고치면, 예약자가 있을 때 안내를 거쳐 저장된다', '수업 정보 수정 → 이름·장소 변경, 날짜 +1일 → "예약된 회원이 있습니다"(1명) → 변경하기 → "수정했습니다", 수정 요청 1번(제목·장소·하루 뒤 시간)')
    def _():
        import datetime
        fresh_login('owner@x.com', '전체 강사 보기')
        pg.goto(BASE + '/class/c11')
        pg.get_by_text('수업 정보 수정 (시간·장소·강사)').click()
        pg.locator('input[placeholder="예: A룸"]').wait_for(timeout=15000)
        pg.locator('input[placeholder="[테스트] 저녁 그룹"]').fill('저녁 그룹 (변경)')
        pg.locator('input[placeholder="예: A룸"]').fill('C룸')
        pg.get_by_label('하루 뒤', exact=True).first.click()
        pg.wait_for_timeout(300)
        shot('TC-U34a', full=True)
        pg.get_by_text('저장', exact=True).last.click()
        pg.get_by_text('예약된 회원이 있습니다').wait_for(timeout=5000)
        warn = pg.get_by_text('예약·대기 중인 회원이 1명', exact=False).count()
        pg.wait_for_timeout(500)
        shot('TC-U34b')
        pg.get_by_role('button', name='변경하기').click()
        pg.get_by_text('수정했습니다').wait_for(timeout=10000)
        pg.wait_for_timeout(500)
        shot('TC-U34')
        pg.get_by_role('button', name='확인').click()
        call = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'classes_update']
        assert warn >= 1, warn
        assert len(call) == 1 and call[0]['args']['title'] == '저녁 그룹 (변경)' and call[0]['args']['location'] == 'C룸', call
        moved = datetime.datetime.fromisoformat(call[0]['args']['starts_at'].replace('Z', '+00:00')) - datetime.datetime.now(datetime.timezone.utc)
        assert 20 < moved.total_seconds() / 3600 < 30, moved
        return f'안내(예약 1명) → 수정 요청 1번: 제목 "{call[0]["args"]["title"]}", 장소 C룸, 시작 {round(moved.total_seconds() / 3600)}시간 뒤로'

    @case('TC-U35', '수업 수정', '이미 시작된 수업은 수정 화면에서 막히고 이유를 보여준다', '"이미 시작된 수업은 수정할 수 없습니다", 저장 버튼 없음')
    def _():
        pg.goto(BASE + '/class/edit?id=c9')
        pg.get_by_text('이미 시작된 수업은 수정할 수 없습니다.').wait_for(timeout=15000)
        save_btn = pg.get_by_text('저장', exact=True).locator('visible=true').count()
        pg.wait_for_timeout(300)
        shot('TC-U35')
        assert save_btn == 0, save_btn
        return '시작된 수업 c9 → 안내 표시, 저장 버튼 0개'

    @case('TC-U36', '회원 이력', '회원 홈에서 지난 수업 이력과 수강권 사용 내역을 볼 수 있다', '지난 수업 이력: 출석·취소 통계와 목록 / 수강권 카드 → 사용·변동 내역(지급·사용·환불·자동 확정)')
    def _():
        fresh_login('member@x.com', '내 수강권')
        pg.get_by_label('지난 수업 이력 보기').click()
        pg.get_by_text('출석률').wait_for(timeout=15000)
        body = pg.inner_text('body')
        pg.wait_for_timeout(300)
        shot('TC-U36a', full=True)
        pg.get_by_label('뒤로').locator('visible=true').click()
        pg.get_by_label(re.compile('사용 내역 보기$')).nth(1).click()  # 두 번째 카드 = 그룹 수강권(p2)
        pg.get_by_text('사용 · 변동 내역', exact=False).wait_for(timeout=15000)
        logs = pg.inner_text('body')
        pg.wait_for_timeout(300)
        shot('TC-U36', full=True)
        assert '4:1 그룹 리포머' in body, body[:300]
        n = re.search(r'사용 · 변동 내역 (\d+)건', logs)
        assert n and int(n.group(1)) == 5, logs[:300]
        return f'이력 화면(출석·노쇼·취소·출석률, 지난 수업 목록) → 수강권 사용·변동 내역 {n.group(1)}건'

    @case('TC-U37', '간편 로그인 연결', '내 정보에서 연결된 간편 로그인을 보고 해제할 수 있으며, 서버의 수동 연결 설정이 꺼져 있으면 그 이유를 안내한다', '구글 "연결됨"·해제 → 확인 → 해제 요청 1번 → "연결 안 됨" / 카카오 연결 → "Enable Manual Linking" 안내')
    def _():
        pg.goto(BASE + '/')
        pg.wait_for_selector('text=내 수강권', timeout=30000)
        pg.get_by_text('내 정보', exact=True).last.click()
        pg.get_by_text('간편 로그인 연결').wait_for(timeout=15000)
        pg.get_by_label('Google 연결 해제').scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        shot('TC-U37a')
        pg.get_by_label('Google 연결 해제').click()
        pg.get_by_role('button', name='해제', exact=True).click()
        pg.get_by_label('Google 연결하기').wait_for(timeout=10000)
        pg.get_by_label('카카오 연결하기').click()
        pg.get_by_text('연결하지 못했어요').wait_for(timeout=10000)
        msg = pg.get_by_text('Enable Manual Linking', exact=False).count()
        pg.wait_for_timeout(500)
        shot('TC-U37')
        pg.get_by_role('button', name='확인').click()
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        un = [x for x in log if x['fn'] == 'unlink_identity']
        ln = [x for x in log if x['fn'] == 'link_identity']
        for e in [e for e in errors if 'status of 422' in e]:
            errors.remove(e)  # 연결 설정이 꺼진 서버의 거절(422)은 의도한 상황
        assert un and un[-1]['args'] == {'me': 'm1', 'identity_id': 'iid-m1-google'}, un
        assert ln and ln[-1]['args']['provider'] == 'kakao' and msg >= 1, (ln, msg)
        return '구글 해제 요청 1번 → "연결 안 됨"·연결 버튼, 카카오 연결 시 서버 설정(Enable Manual Linking) 안내'

    @case('TC-U38', '소셜 로그인', 'PKCE 방식(?code=)으로 돌아왔지만 확인 정보가 없거나 만료된 경우 앱이 멈추지 않고 안내 후 로그인 화면으로 돌아간다', '"로그인하지 못했어요" 안내 → 로그인 화면')
    def _():
        pg.goto(BASE + '/')
        pg.evaluate('localStorage.clear()')
        pg.goto(BASE + '/auth-callback?code=expired-or-foreign-code')
        pg.get_by_text('로그인하지 못했어요').wait_for(timeout=15000)
        pg.wait_for_timeout(400)
        shot('TC-U38')
        pg.get_by_role('button', name='확인').click()
        pg.wait_for_selector('input[placeholder="name@example.com"]', timeout=15000)
        for e in [e for e in errors if 'status of 4' in e or 'code verifier' in e.lower()]:
            errors.remove(e)
        return '만료/다른 기기 코드 → 안내 후 로그인 화면 (앱 멈춤 없음)'

    SITE = 'http://127.0.0.1:8090'
    TINY_PNG = '/tmp/piq_photo.png'
    import base64 as _b64
    open(TINY_PNG, 'wb').write(_b64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR42mNk+M+AFzCOKhhVAAAbsgP9+xsE8gAAAABJRU5ErkJggg=='))
    rpc_log = lambda: json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())  # noqa: E731
    trials_db = lambda: json.loads(urllib.request.urlopen(BASE + '/__trials').read())  # noqa: E731

    def close_dialog():
        pg.get_by_role('button', name='확인').last.click()
        pg.wait_for_timeout(300)

    @case('TC-U44', '로그인', '비밀번호 입력칸의 눈 아이콘을 누르면 입력한 비밀번호가 보이고, 다시 누르면 가려진다 (로그인·가입·재설정 공통)', '처음 type=password·"비밀번호 보기" → 누르면 일반 글자칸·"비밀번호 숨기기" → 다시 누르면 password / 가입 화면 비밀번호칸에도 눈 아이콘')
    def _():
        pg.goto(BASE + '/')
        pg.evaluate('localStorage.clear()')
        pg.goto(BASE + '/')
        box = pg.locator('input[placeholder="비밀번호"]')
        box.wait_for(timeout=30000)
        box.fill('piq-secret-123')
        t0 = box.get_attribute('type')
        pg.get_by_label('비밀번호 보기').first.click()
        t1 = box.get_attribute('type')
        val = box.input_value()
        shot('TC-U44a')
        pg.get_by_label('비밀번호 숨기기').first.click()
        t2 = box.get_attribute('type')
        pg.goto(BASE + '/signup')
        pg.wait_for_timeout(1200)
        eyes = pg.get_by_label('비밀번호 보기').locator('visible=true').count()
        shot('TC-U44')
        assert t0 == 'password' and t1 in ('text', None) and t2 == 'password', (t0, t1, t2)  # type 없음 = 일반 글자칸
        assert val == 'piq-secret-123' and eyes == 1, (val, eyes)
        return f'type {t0} → {t1 or "text"}(입력값 그대로 보임) → {t2} · 가입 화면 비밀번호칸 눈 아이콘 {eyes}개'

    @case('TC-U45', '알림', '알림함을 열어 둔 채 새 알림이 오면, 다시 불러올 때 바로 읽음 처리된다 (처음 한 번만 읽음 처리하던 문제 수정)', '알림함 열림(모두 읽음) → 새 알림 도착 → 화면 다시 불러오기 → 새 알림 표시 + 읽음 처리 요청 1번 더 → 종 배지 없음')
    def _():
        fresh_login('member@x.com', '내 수강권')
        pg.get_by_label('알림', exact=True).first.click()
        pg.get_by_text('대기에서 예약이 확정됐어요').wait_for(timeout=15000)
        pg.wait_for_timeout(1500)
        before = len([x for x in rpc_log() if x['fn'] == 'mark_notifications_read'])
        urllib.request.urlopen(BASE + '/__notify?user=m1').read()
        pg.evaluate("""() => { const set = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); };
            set('hidden'); set('visible'); }""")
        pg.get_by_text('방금 도착한 알림').wait_for(timeout=15000)
        dot = pg.get_by_label('새 알림').locator('visible=true').count()
        shot('TC-U45a')
        pg.wait_for_timeout(2500)
        after = len([x for x in rpc_log() if x['fn'] == 'mark_notifications_read'])
        pg.get_by_label('뒤로').click()
        pg.wait_for_selector('text=내 수강권', timeout=15000)
        pg.wait_for_timeout(800)
        badge = pg.locator('[aria-label$="새로 옴"]').locator('visible=true').count()
        shot('TC-U45')
        assert after == before + 1, (before, after)
        assert badge == 0, badge
        return f'새 알림 표시(새 표시 {dot}개) → 약 0.8초 뒤 읽음 처리 요청 {before}→{after}번 → 종 배지 0개'

    @case('TC-U46', '소개 페이지', '원장 내 정보에 "소개 페이지(공개 중)"와 "체험 신청(새 신청 수)"이 보이고, 소개 페이지 편집 화면에 저장된 내용과 공개 주소가 나온다', '내 정보 → 소개 페이지 "공개 중" · 체험 신청 배지 1 → 편집 화면: piq.expo.app/s/demo-pilates · 링크 공유/페이지 열기 · 한 줄 소개 등 채워짐 · 대표 사진 1장')
    def _():
        fresh_login('owner@x.com', '전체 강사 보기')
        pg.get_by_text('내 정보', exact=True).last.click()
        row = pg.get_by_label('스튜디오 소개 페이지')
        row.wait_for(timeout=15000)
        row.scroll_into_view_if_needed()
        pg.get_by_text('공개 중 · 링크를 공유해 홍보하세요').wait_for(timeout=10000)
        badge = pg.get_by_label('체험 신청').inner_text()
        pg.wait_for_timeout(300)
        shot('TC-U46a')
        row.click()
        pg.get_by_label('소개 페이지 주소').wait_for(timeout=15000)
        url = pg.get_by_label('소개 페이지 주소').inner_text()
        head = pg.get_by_label('한 줄 소개').input_value()
        slug = pg.get_by_label('주소 이름').input_value()
        cover = pg.get_by_label('대표 사진').count()
        share = pg.get_by_label('링크 공유').count()
        pg.wait_for_timeout(400)
        shot('TC-U46', full=True)
        assert '1' in badge.split(), badge
        assert url == 'piq.expo.app/s/demo-pilates' and slug == 'demo-pilates', (url, slug)
        assert head == '소수 정예 기구 필라테스' and cover == 1 and share == 1, (head, cover, share)
        return f'내 정보: 공개 중 · 체험 신청 새 1건 → 편집 화면 주소 "{url}", 한 줄 소개 "{head}", 대표 사진 {cover}장'

    @case('TC-U47', '소개 페이지', '주소 이름·카카오 링크가 규칙에 맞지 않으면 저장하지 않고 안내하며, 대문자·한글·공백은 입력할 때 자동으로 걸러진다', '"My Studio!" 입력 → "mystudio" / "ab" → "주소 이름은…3~30자" 안내, 서버 저장 0번 / 카카오 링크 http://evil → 안내, 저장 0번')
    def _():
        box = pg.get_by_label('주소 이름')
        box.fill('My Studio!한글')
        cleaned = box.input_value()
        box.fill('ab')
        pg.get_by_label('소개 페이지 저장').click()
        pg.get_by_text('주소 이름은 영어 소문자', exact=False).wait_for(timeout=5000)
        shot('TC-U47a')
        close_dialog()
        box.fill('demo-pilates')
        pg.get_by_label('카카오톡 링크').fill('http://evil.example/x')
        pg.get_by_label('소개 페이지 저장').click()
        pg.get_by_text('카카오톡 링크는', exact=False).wait_for(timeout=5000)
        shot('TC-U47')
        close_dialog()
        pg.get_by_label('카카오톡 링크').fill('https://open.kakao.com/o/demo')
        saves = [x for x in rpc_log() if x['fn'] == 'save_studio_page']
        assert cleaned == 'mystudio', cleaned
        assert not saves, saves
        return f'"My Studio!한글" → "{cleaned}" · 짧은 주소/잘못된 카카오 링크 → 안내만, 서버 저장 0번'

    @case('TC-U48', '소개 페이지', '사진을 올리고 한 줄 소개를 고쳐 저장하면, 사진이 스토리지(스튜디오 폴더)에 올라가고 저장 결과와 공개 주소를 안내한다', '사진 추가 → 파일 선택 → 사진 2장 → 한 줄 소개 수정(<b> 태그 포함) → 저장 → "저장했어요 · 공개 중" + 주소 / 서버: 업로드 1번(S1/…jpg) · 저장 1번(사진 2장, 새 한 줄 소개)')
    def _():
        with pg.expect_file_chooser(timeout=10000) as fc:
            pg.get_by_label('사진 추가').click()
        fc.value.set_files(TINY_PNG)
        pg.get_by_label('사진 2', exact=True).wait_for(timeout=20000)
        pg.get_by_label('한 줄 소개').fill('<b>소수</b> 정예 & 1:1 "맞춤"')
        pg.wait_for_timeout(300)
        shot('TC-U48a', full=True)
        pg.get_by_label('소개 페이지 저장').click()
        pg.get_by_text('저장했어요 · 공개 중').wait_for(timeout=10000)
        msg = pg.get_by_text('piq.expo.app/s/demo-pilates', exact=False).last.inner_text()
        pg.wait_for_timeout(300)
        shot('TC-U48')
        close_dialog()
        log = rpc_log()
        up = [x for x in log if x['fn'] == 'storage_upload']
        sv = [x for x in log if x['fn'] == 'save_studio_page']
        assert len(up) == 1 and up[0]['args']['key'].startswith('S1/') and up[0]['args']['key'].endswith('.jpg'), up
        assert len(sv) == 1 and len(sv[0]['args']['p_page']['photos']) == 2 and sv[0]['args']['p_page']['headline'].startswith('<b>'), sv
        return f'업로드 {up[0]["args"]["key"]} → 저장 1번(사진 2장) → 안내 "{msg.strip()[:40]}"'

    # ---- 공개 페이지 (piq.expo.app/s/<주소>) : 로그인 없는 방문자 ----
    sp = c.new_page()
    sp.on('pageerror', lambda e: errors.append('site pageerror: ' + str(e)[:300]))
    sp.on('console', lambda m: errors.append('site console: ' + m.text[:300]) if m.type == 'error' else None)
    sshot = lambda cid, full=False: sp.screenshot(path=f'{OUT}/{cid}.png', full_page=full)  # noqa: E731

    @case('TC-U49', '공개 페이지', '카카오톡처럼 자바스크립트 없이 읽어도 스튜디오별 미리보기 정보(og 제목·설명·대표 사진·주소)가 들어 있고, 원장이 쓴 글의 태그는 글자로만 보인다', 'GET /s/demo-pilates → 200 · og:title "데모 필라테스 · 필라테스" · og:image 대표 사진 · og:url · 보안 헤더(CSP) / 화면: 사진·시간표·운영 시간·지도 링크, "<b>소수</b>" 가 굵게 바뀌지 않고 글자로 보임')
    def _():
        req = urllib.request.Request(SITE + '/s/demo-pilates', headers={'User-Agent': 'facebookexternalhit/1.1 kakaotalk-scrap/1.0'})
        r = urllib.request.urlopen(req)
        html = r.read().decode()
        og = dict(re.findall(r'<meta property="og:([a-z_]+)" content="([^"]*)"', html))
        csp = r.headers.get('content-security-policy', '')
        sp.goto(SITE + '/s/demo-pilates')
        sp.get_by_role('heading', name='데모 필라테스').wait_for(timeout=15000)
        bold = sp.locator('p.headline b').count()
        headline = sp.locator('p.headline').inner_text()
        imgs = sp.locator('.photos img').count()
        sched = sp.locator('.cls').count()
        maps = sp.get_by_text('네이버 지도에서 보기').count()
        sp.wait_for_timeout(300)
        sshot('TC-U49', full=True)
        assert r.status == 200 and og.get('title') == '데모 필라테스 · 필라테스', og
        assert og.get('image', '').endswith('/storage/v1/object/public/studio-photos/S1/cover.jpg') and og.get('url', '').endswith('/s/demo-pilates'), og
        assert '&lt;b&gt;' in html and '<b>소수' not in html, 'escape'
        assert "script-src 'nonce-" in csp and "frame-ancestors 'none'" in csp, csp
        assert bold == 0 and headline.startswith('<b>소수</b>') and imgs == 2 and sched >= 1 and maps == 1, (bold, headline, imgs, sched, maps)
        return f'og:title "{og["title"]}", og:image 대표 사진, og:description "{og["description"][:20]}…" · CSP 있음 · 사진 {imgs}장·시간표 {sched}개 · 태그는 글자로 표시'

    @case('TC-U50', '공개 페이지', '체험 신청 폼: 이름·연락처·동의가 빠지면 서버에 보내지 않고 바로 안내한다', '빈 채로 신청 → "이름을 적어 주세요." / 연락처 "010" → "전화번호를 정확히" / 동의 안 함 → "동의해 주세요." / 서버 요청 0번')
    def _():
        sp.get_by_role('link', name='체험 수업 신청').click()
        submit = sp.locator('#f-submit')
        msgs = []
        submit.click(); msgs.append(sp.locator('#f-msg-box').inner_text())
        sp.fill('#f-name', '테스트 방문자')
        sp.fill('#f-phone', '010')
        submit.click(); msgs.append(sp.locator('#f-msg-box').inner_text())
        sp.fill('#f-phone', '010-4444-9999')
        submit.click(); msgs.append(sp.locator('#f-msg-box').inner_text())
        sp.wait_for_timeout(200)
        sshot('TC-U50')
        calls = [x for x in rpc_log() if x['fn'] == 'submit_trial_request']
        assert msgs == ['이름을 적어 주세요.', '연락받을 전화번호를 정확히 적어 주세요.', '개인정보 수집·이용에 동의해 주세요.'], msgs
        assert not calls, calls
        return ' → '.join(f'"{m}"' for m in msgs) + ' · 서버 요청 0번'

    @case('TC-U51', '공개 페이지', '동의하고 신청하면 저장되고 완료 안내가 나오며, 같은 번호로 다시 신청하면 막고, 숨김칸(봇)이 채워진 신청은 저장하지 않는다', '동의 → 신청하기 → "신청했어요!" · 신청 목록 +1(번호는 숫자만) / 같은 번호 재신청 → "이미 신청했어요" / 숨김칸 채운 신청 → 성공처럼 보이지만 저장 0건')
    def _():
        n0 = len(trials_db())
        sp.fill('#f-pref', '평일 저녁 7시 이후')
        sp.fill('#f-msg', '처음이에요')
        sp.check('#f-consent')
        sp.locator('#f-submit').click()
        sp.get_by_text('신청했어요!', exact=False).wait_for(timeout=10000)
        sp.wait_for_timeout(200)
        sshot('TC-U51a')
        db = trials_db()
        mine = db[0]
        # 같은 번호로 다시
        sp.reload(); sp.fill('#f-name', '테스트 방문자'); sp.fill('#f-phone', '01044449999'); sp.check('#f-consent'); sp.locator('#f-submit').click()
        sp.get_by_text('이미 신청했어요', exact=False).wait_for(timeout=10000)
        sshot('TC-U51b')
        errors[:] = [e for e in errors if not ('site console' in e and 'status of 400' in e)]  # 중복 신청 거절(400)은 의도된 응답
        # 봇: 숨김칸을 채움
        sp.reload(); sp.fill('#f-name', '봇'); sp.fill('#f-phone', '01012120000'); sp.check('#f-consent')
        sp.evaluate("document.getElementById('f-company').value = 'spam inc'")
        sp.locator('#f-submit').click()
        sp.get_by_text('신청했어요!', exact=False).wait_for(timeout=10000)
        sshot('TC-U51')
        n1 = len(trials_db())
        assert len(db) == n0 + 1 and mine['phone'] == '01044449999' and mine['name'] == '테스트 방문자' and mine['status'] == 'new', mine
        assert n1 == n0 + 1, (n0, n1)
        return f'신청 저장(번호 {mine["phone"][:3]}-****-{mine["phone"][-4:]}, 상태 new) → 같은 번호 재신청 차단 → 봇 신청 저장 0건 (목록 {n0}→{n1})'

    @case('TC-U52', '공개 페이지', '없는 주소·비공개 페이지·잘못된 주소 모양은 "페이지를 찾을 수 없어요"(404)로 보이고 검색에 노출되지 않는다', '/s/no-such-studio → 404 + 안내 + noindex / /s/<script> 모양 → 404')
    def _():
        codes = []
        for path in ['/s/no-such-studio', '/s/%3Cscript%3E']:
            try:
                urllib.request.urlopen(SITE + path)
                codes.append(200)
            except urllib.error.HTTPError as e:  # noqa: PERF203
                codes.append(e.code)
                body = e.read().decode()
        sp.goto(SITE + '/s/no-such-studio')
        sp.get_by_text('페이지를 찾을 수 없어요').first.wait_for(timeout=10000)
        robots = sp.locator('meta[name="robots"]').get_attribute('content')
        sshot('TC-U52')
        errors[:] = [e for e in errors if not ('site console' in e and '404' in e)]
        assert codes == [404, 404] and robots == 'noindex' and '<script>' not in body, (codes, robots)
        return f'없는 주소 {codes[0]}, 잘못된 모양 {codes[1]} · 안내 화면 · robots=noindex'

    @case('TC-U53', '체험 신청', '원장 앱의 체험 신청 화면에 방금 들어온 신청이 보이고, 상태를 "연락함"으로 바꾸고 메모를 저장할 수 있다', '체험 신청 → 진행 중 3건(새 신청 "테스트 방문자" 맨 위, 희망 시간·남길 말·전화/문자 버튼) → 연락함 → 메모 저장 / 서버: update_trial_request(contacted, 메모)')
    def _():
        sp.close()
        pg.goto(BASE + '/trials')
        card = pg.get_by_label('체험 신청 테스트 방문자')
        card.wait_for(timeout=15000)
        open_tab = pg.get_by_role('tab').first.inner_text()
        txt = card.inner_text()
        calls = pg.get_by_label('테스트 방문자에게 전화').count()
        shot('TC-U53a', full=True)
        card.get_by_role('radio', name='연락함').click()
        pg.wait_for_timeout(800)
        pg.get_by_label('테스트 방문자 메모').fill('토요일 10시 체험 안내함')
        pg.get_by_label('테스트 방문자 메모 저장').click()
        pg.wait_for_timeout(1000)
        shot('TC-U53')
        ups = [x for x in rpc_log() if x['fn'] == 'update_trial_request']
        mine = [t for t in trials_db() if t['name'] == '테스트 방문자'][0]
        assert '평일 저녁 7시 이후' in txt and '처음이에요' in txt and calls == 1, txt
        assert ups and ups[0]['args']['p_status'] == 'contacted' and mine['memo'] == '토요일 10시 체험 안내함' and mine['status'] == 'contacted', (ups, mine)
        return f'탭 "{open_tab}" · 새 신청 카드(희망 시간·남길 말·전화 버튼) → 연락함 → 메모 저장 (서버 {len(ups)}번, 상태 {mine["status"]})'


    @case('TC-U39', '운영 종료', '원장이 아닌 사람(회원)의 내 정보에는 "스튜디오 운영 종료" 메뉴가 없다', '회원 내 정보: "회원 탈퇴"는 보이고 "스튜디오 운영 종료"는 0개')
    def _():
        fresh_login('member@x.com', '내 수강권')
        pg.get_by_text('내 정보', exact=True).last.click()
        pg.get_by_text('회원 탈퇴').wait_for(timeout=15000)
        pg.get_by_text('회원 탈퇴').scroll_into_view_if_needed()
        n = pg.get_by_text('스튜디오 운영 종료').count()
        pg.wait_for_timeout(300)
        shot('TC-U39')
        assert n == 0, n
        return '회원 → "스튜디오 운영 종료" 0개, "회원 탈퇴"만 표시'

    @case('TC-U40', '운영 종료', '회원에게 남은 수강권이 있으면 운영 종료 화면에서 바로 종료할 수 없고, 남은 수강권(회원 수·횟수·명단)과 운영자 승인 절차를 안내한다', '내 정보 → 스튜디오 운영 종료 → "남은 수강권이 있어 바로 종료할 수 없어요"·회원 4명 · 39회·명단 / 이름 확인칸 없음 / 사유 5자 미만이면 요청 버튼 비활성')
    def _():
        fresh_login('owner@x.com', '전체 강사 보기')
        pg.get_by_text('내 정보', exact=True).last.click()
        pg.get_by_text('스튜디오 운영 종료').last.scroll_into_view_if_needed()
        pg.get_by_text('스튜디오 운영 종료').last.click()
        pg.get_by_text('남은 수강권이 있어 바로 종료할 수 없어요').wait_for(timeout=15000)
        summary = pg.get_by_label('남은 수강권 요약').inner_text()
        body = pg.inner_text('body')
        name_box = pg.get_by_label('스튜디오 이름 확인').count()
        pg.get_by_label('운영 종료 요청 사유').fill('환불')
        dis = pg.get_by_label('운영 종료 요청 보내기').get_attribute('aria-disabled')
        pg.wait_for_timeout(300)
        shot('TC-U40', full=True)
        assert '회원 4명 · 남은 횟수 39회' in summary, summary
        assert '김하늘' in body and '20회' in body, body[:500]
        assert name_box == 0 and dis == 'true', (name_box, dis)
        return f'"{summary}" + 명단(김하늘 20회 등) · 이름 확인칸 0개 · 사유 2자 → 요청 버튼 비활성'

    @case('TC-U41', '운영 종료', '사유를 적어 운영 종료 요청을 보내면 "검토 중" 상태로 바뀌고, 원장은 요청을 취소할 수 있다', '사유 입력 → 요청 보내기 → 확인창 → "요청을 보냈어요" → "운영 종료 요청을 검토 중이에요"(사유 표시) → 요청 취소 → 다시 요청 화면 / 서버: 요청 1번(사유)·취소 1번')
    def _():
        reason = '남은 회원 4명 모두 남은 횟수만큼 환불을 마쳤습니다.'
        pg.get_by_label('운영 종료 요청 사유').fill(reason)
        pg.get_by_label('운영 종료 요청 보내기').click()
        pg.get_by_text('운영 종료를 요청할까요?').wait_for(timeout=5000)
        pg.get_by_role('button', name='요청 보내기', exact=True).click()
        pg.get_by_text('요청을 보냈어요').wait_for(timeout=10000)
        pg.wait_for_timeout(400)
        shot('TC-U41a')
        pg.get_by_role('button', name='확인').click()
        pg.get_by_text('운영 종료 요청을 검토 중이에요').wait_for(timeout=10000)
        shown = pg.get_by_text(reason, exact=False).count()
        pg.wait_for_timeout(300)
        shot('TC-U41b', full=True)
        pg.get_by_label('운영 종료 요청 취소').click()
        pg.get_by_role('button', name='요청 취소', exact=True).click()
        pg.get_by_label('운영 종료 요청 사유').wait_for(timeout=10000)
        pg.wait_for_timeout(300)
        shot('TC-U41')
        log = json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read())
        rq = [x for x in log if x['fn'] == 'request_studio_close']
        cc = [x for x in log if x['fn'] == 'cancel_studio_close_request']
        cl = [x for x in log if x['fn'] == 'close_studio']
        assert len(rq) == 1 and rq[0]['args']['p_reason'] == reason, rq
        assert len(cc) == 1 and not cl and shown >= 1, (cc, cl, shown)
        return '요청 1번(사유 그대로) → 검토 중 카드에 사유 표시 → 요청 취소 1번 → 다시 요청 화면 · 바로 종료 요청 0번'

    @case('TC-U42', '운영 종료', '남은 수강권이 없으면(모두 정리됨) 스튜디오 이름을 정확히 입력하고 한 번 더 확인해 바로 종료하고, 남은 다른 스튜디오로 이동한다', '정리 완료 후 다시 열기 → 안내 카드 없음 → 이름 "데모"만 입력 시 비활성 → 정확히 입력 → "정말 종료할까요?" → 운영 종료 → "운영을 종료했습니다" → 확인 → 이선생 수학교실 화면')
    def _():
        urllib.request.urlopen(BASE + '/__settle?studio=S1').read()
        pg.goto(BASE + '/close-studio')
        pg.get_by_label('스튜디오 이름 확인').wait_for(timeout=20000)
        warn = pg.get_by_text('남은 수강권이 있어 바로 종료할 수 없어요').count()
        pg.get_by_label('스튜디오 이름 확인').fill('데모')
        dis = pg.get_by_label('스튜디오 운영 종료하기').get_attribute('aria-disabled')
        pg.get_by_label('스튜디오 이름 확인').fill('데모 필라테스')
        pg.wait_for_timeout(300)
        shot('TC-U42a', full=True)
        pg.get_by_label('스튜디오 운영 종료하기').click()
        pg.get_by_text('정말 종료할까요?').wait_for(timeout=5000)
        pg.wait_for_timeout(600)
        shot('TC-U42b')
        pg.get_by_role('button', name='운영 종료', exact=True).click()
        pg.get_by_text('운영을 종료했습니다').wait_for(timeout=10000)
        msg = pg.get_by_text('명에게 종료 알림', exact=False).inner_text()
        pg.wait_for_timeout(400)
        shot('TC-U42c')
        pg.get_by_role('button', name='확인').click()
        pg.get_by_text('이선생 수학교실', exact=False).first.wait_for(timeout=20000)
        pg.wait_for_timeout(600)
        shot('TC-U42')
        calls = [x for x in json.loads(urllib.request.urlopen(BASE + '/__rpc_log').read()) if x['fn'] == 'close_studio']
        assert warn == 0 and dis == 'true', (warn, dis)
        assert len(calls) == 1 and calls[0]['args']['p_confirm_name'] == '데모 필라테스', calls
        return f'안내 카드 0개, 이름 불일치 시 비활성 → 종료 요청 1번 → "{msg.splitlines()[0]}" → 남은 스튜디오 "이선생 수학교실"로 이동'

    @case('TC-U43', '운영 종료', '앱을 켜 둔 채 다른 기기에서 스튜디오가 운영 종료돼도, 앱이 다시 앞으로 오면 소속을 새로 불러와 스튜디오 만들기/참여 화면으로 바뀐다 (F-09)', '이선생 수학교실 화면 → (원장이 운영 종료 + 종료 알림) → 앱 전환 후 복귀 → "환영합니다" 만들기/참여 화면, 소속 다시 불러오기 요청 발생')
    def _():
        before = pg.get_by_text('이선생 수학교실', exact=False).count()
        urllib.request.urlopen(BASE + '/__close_elsewhere?studio=S2&user=a1').read()
        pg.wait_for_timeout(500)
        stale = pg.get_by_text('이선생 수학교실', exact=False).count()
        pg.evaluate("""() => {
          const set = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
                               Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
                               document.dispatchEvent(new Event('visibilitychange')); };
          set('hidden'); set('visible');
        }""")
        pg.get_by_text('환영합니다', exact=False).first.wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        shot('TC-U43')
        assert before >= 1 and stale >= 1, (before, stale)
        return f'종료 직후에도 화면에는 예전 스튜디오({stale}곳 표시) → 앱 복귀 시 소속 새로 불러옴 → 스튜디오 만들기/참여 화면'

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
