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
        plus_disabled = pg.get_by_label('결제일 하루 뒤').get_attribute('aria-disabled')
        pg.get_by_label('결제일 하루 전').click()
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
        return f'요청 add_pass_payment(50,000원, transfer, {y}, 잔금), 합계 170,000→220,000원, 오늘 이후 날짜 버튼 비활성'

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
