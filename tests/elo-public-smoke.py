"""Exercise the existing statistics and records views with isolated, mocked data."""
import asyncio
from datetime import datetime, timedelta, timezone
import functools
import http.server
import json
from pathlib import Path
import re
import threading
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'starlog' if (ROOT / 'starlog' / 'elo-public.js').exists() else ROOT
APP_PATH = '/starlog' if APP != ROOT else ''
OUTPUT = ROOT / 'test-results' / 'elo-public-smoke'
KST = ZoneInfo('Asia/Seoul')
TODAY = datetime.now(KST).date()
STAMP = datetime.now(timezone.utc).isoformat()
OLDER_DAY = TODAY - timedelta(days=1)
MONTH = TODAY.isoformat()[:7]
PREVIOUS_MONTH = (TODAY.replace(day=1) - timedelta(days=1)).isoformat()[:7]
PLAYERS = [
    {'name': '최도랑', 'race': 'P', 'eloId': 443, 'aliases': ['도랑'], 'tier': '3'},
    {'name': '정소이', 'race': 'Z', 'eloId': 513, 'aliases': ['소이', '동명이인'], 'tier': '4'},
    {'name': '만다', 'race': 'T', 'eloId': 441, 'aliases': ['동명이인'], 'tier': '4'},
]
STATS = {'wins': 22, 'losses': 16, 'games': 38, 'winRate': 57.9}
OTHER_STATS = {'wins': 60, 'losses': 30, 'games': 90, 'winRate': 66.7}


def summary(player_id):
    player = next(row for row in PLAYERS if row['eloId'] == player_id)
    stats = OTHER_STATS if player_id == 513 else STATS
    return {
        'schemaVersion': 1, 'source': 'eloboard', 'fetchedAt': STAMP,
        'sourceUrl': 'https://eloboard.com/players/' + str(player_id),
        'player': {'id': player_id, 'name': player['name'], 'race': player['race'], 'elo': 1464},
        'overall': stats, 'races': [{'race': 'Z', 'label': '저그', **stats}],
        'maps': [{'id': 1, 'label': '투혼', **stats}],
        'types': [{'key': 'sponsored', 'label': '스폰', **stats}],
        'opponents': [{'id': 441, 'name': '만다', 'race': 'T', **stats}],
    }


def activity(player_id, incomplete=False):
    unknown = {'wins': None, 'losses': None, 'games': None, 'winRate': None}
    day = OLDER_DAY if incomplete else TODAY
    snapshot_month = day.isoformat()[:7]
    previous_month = (day.replace(day=1) - timedelta(days=1)).isoformat()[:7]
    fetched_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat() if incomplete else STAMP
    return {
        'schemaVersion': 1, 'source': 'eloboard', 'playerId': player_id,
        'fetchedAt': fetched_at, 'stale': incomplete, 'asOfDate': day.isoformat(),
        'coverage': {'from': previous_month + '-28', 'to': day.isoformat(), 'complete': True, 'allMatches': False},
        'today': {'date': day.isoformat(), 'complete': True, 'wins': 2, 'losses': 1, 'games': 3, 'winRate': 66.7},
        'currentMonth': {'month': snapshot_month, 'complete': not incomplete, **(unknown if incomplete else STATS)},
        'streak': {'result': 'W', 'count': 2, 'complete': not incomplete},
        'months': [
            {'month': snapshot_month, 'complete': not incomplete, **(unknown if incomplete else STATS)},
            {'month': previous_month, 'complete': False, **unknown},
        ],
    }


def rival(player_id, opponent_id):
    return {
        'schemaVersion': 1, 'fetchedAt': STAMP,
        'player': summary(player_id)['player'], 'opponent': summary(opponent_id)['player'],
        'headToHead': {**STATS, 'from': '2023-01-01', 'to': TODAY.isoformat()},
        'maps': [{'id': 1, 'label': '투혼', **STATS}], 'types': [],
    }


def recent():
    return {
        'schemaVersion': 1, 'fetchedAt': STAMP, 'playerId': 443, 'complete': False,
        'warning': '일부 날짜는 공개 화면에 표시된 경기만 확인했어요.',
        'matches': [
            {'id': 1000 + index, 'date': TODAY.isoformat(), 'opponentId': 513,
             'opponent': '찾을 상대' if index == 6 else '정소이', 'race': 'Z',
             'result': 'W' if index % 2 == 0 else 'L', 'map': '투혼',
             'type': '특별 대회' if index % 3 == 0 else '스폰'}
            for index in range(50)
        ],
    }


def journal():
    match = {'id': 'manual-ladder', 'date': TODAY.isoformat(), 'type': '래더', 'opponent': '손수 입력',
             'race': 'T', 'myRace': 'P', 'map': '투혼', 'result': 'W', 'build': '나의 빌드',
             'enemyBuild': '상대 빌드', 'memo': '보존할 복기\n다음 줄', 'tags': '정찰', 'star': True}
    return {'version': 1, 'matches': [match], 'trash': [{**match, 'id': 'deleted-note'}],
            'settings': {'name': '최도랑', 'race': 'P', 'maps': ['투혼'], 'builds': ['더블']}, 'lastBackup': None}


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def prepare(browser, origin, width, harness=False, delay_owner=False, delay_recent=False,
                  directory_fail=False, incomplete=False):
    context = await browser.new_context(viewport={'width': width, 'height': 844}, locale='ko-KR',
                                        timezone_id='Asia/Seoul', service_workers='block')
    source = (APP / 'app.js').read_text()
    key = re.search(r"const KEY='([^']+)'", source).group(1)
    raw = json.dumps(journal(), ensure_ascii=False)
    await context.add_init_script('localStorage.setItem(' + json.dumps(key) + ',' + json.dumps(raw) + ');')
    if directory_fail:
        old = json.dumps({'players': [PLAYERS[0]]}, ensure_ascii=False)
        await context.add_init_script('localStorage.setItem("starlog-player-directory-v1",' + json.dumps(old) + ');')
    state = {'context': context, 'key': key, 'raw': raw, 'requests': [], 'errors': [],
             'fail': False, 'directoryFail': directory_fail, 'directoryCalls': 0,
             'gate': asyncio.Event(), 'started': asyncio.Event()}

    async def route(request):
        url = request.request.url
        if url == origin + '/__elo-harness__':
            html = ('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                    '<link rel="stylesheet" href="' + APP_PATH + '/style.css"><link rel="stylesheet" href="' + APP_PATH + '/elo-public.css">'
                    '<div id="target" style="max-width:1100px;margin:auto;padding:20px"></div>'
                    '<script src="' + APP_PATH + '/elo-public.js"></script><script>'
                    'let current;function showPlayer(name,race){current?.destroy();document.getElementById("target").innerHTML="<div id=journalStatistics></div>";'
                    'current=StarlogElo.mountStatistics(document.getElementById("journalStatistics"),{site:"independent-smoke",name,race,matches:[]});}'
                    'showPlayer(' + ('"정소이","Z"' if directory_fail else '"최도랑","P"') + ');</script></html>')
            await request.fulfill(body=html, content_type='text/html')
            return
        if url.startswith(origin):
            await request.continue_()
            return
        if '/players.json' in url:
            state['directoryCalls'] += 1
            await request.fulfill(status=503 if state['directoryFail'] else 200,
                                  json={'error': 'unavailable'} if state['directoryFail'] else {'players': PLAYERS})
            return
        if '/api/elo/public/' in url:
            state['requests'].append(url)
            parsed, params = urlparse(url), parse_qs(urlparse(url).query)
            player_id, kind = int(params['playerId'][0]), parsed.path.split('/')[-1]
            assert kind in ['summary', 'activity', 'rival', 'recent'], url
            if (delay_owner and player_id == 443 and kind in ['summary', 'activity']) or (delay_recent and kind == 'recent'):
                state['started'].set()
                await state['gate'].wait()
            if state['fail']:
                await request.fulfill(status=503, json={'error': 'unavailable'})
                return
            if kind == 'summary':
                data = summary(player_id)
            elif kind == 'activity':
                data = activity(player_id, incomplete)
            elif kind == 'recent':
                assert player_id == 443
                data = recent()
            else:
                data = rival(player_id, int(params['opponentId'][0]))
            await request.fulfill(json=data)
            return
        await request.abort()

    await context.route('**/*', route)
    page = await context.new_page()
    state['page'] = page
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    await page.goto(origin + ('/__elo-harness__' if harness else APP_PATH + '/index.html'), wait_until='domcontentloaded')
    return state


async def wait_total(page, total=38):
    await page.wait_for_function("value => document.querySelector('[data-elo-metrics]')?.textContent.includes(String(value))", arg=total)


async def assert_journal(state):
    assert await state['page'].evaluate('(key)=>localStorage.getItem(key)', state['key']) == state['raw']


async def check_records(state, width):
    page, requests = state['page'], state['requests']
    assert not any('/recent?' in url for url in requests), 'recent games must wait until the records view opens'
    await page.locator('#nav a[href="#records"]').click()
    await page.wait_for_function("document.querySelectorAll('#recordsTable [data-synced-record]').length===50")
    assert await page.locator('#records #recordsTable').count() == 1
    assert '50경기' in await page.locator('#resultCount').inner_text()
    assert '일부 날짜' in await page.locator('#recordSyncStatus').inner_text()
    assert await page.locator('#recordsTable button').count() == 0
    geometry = await page.evaluate("""() => ({
      search:document.getElementById('search').getBoundingClientRect().bottom,
      filter:document.getElementById('recordsTypeFilter').getBoundingClientRect().bottom,
      table:document.getElementById('recordsTable').getBoundingClientRect().top
    })""")
    assert geometry['search'] <= geometry['table'] and geometry['filter'] <= geometry['table'], geometry
    await page.locator('#recordsTypeFilter').select_option('특별 대회')
    assert await page.locator('#recordsTable [data-synced-record]').count() == 17
    await page.locator('#search').fill('찾을 상대')
    assert await page.locator('#recordsTable [data-synced-record]').count() == 1
    assert '1경기' in await page.locator('#resultCount').inner_text()
    await page.locator('[data-record-source="manual"]').click()
    assert await page.locator('#search').input_value() == ''
    assert await page.locator('#recordsTable tbody tr').count() == 1
    assert '래더' in await page.locator('#recordsTable').inner_text()
    assert '나의 빌드' in await page.locator('#recordsTable').inner_text()
    assert await page.locator('#recordsTable button.danger').count() == 1
    await page.locator('#search').fill('보존할 복기')
    assert await page.locator('#recordsTable tbody tr').count() == 1
    await page.locator('[data-record-source="elo"]').click()
    await page.wait_for_function("document.querySelectorAll('#recordsTable [data-synced-record]').length===50")
    assert len([url for url in requests if '/recent?' in url]) == 1, 'same-day source switching should reuse recent data'
    await assert_journal(state)
    await page.screenshot(path=str(OUTPUT / ('records-' + str(width) + '.png')))
    await page.locator('#nav a[href="#home"]').click()
    await wait_total(page)


async def check_statistics(browser, origin, width):
    state = await prepare(browser, origin, width)
    page = state['page']
    try:
        await wait_total(page)
        assert await page.locator('#journalStatistics').count() == 1
        assert await page.locator('#eloPublic, .elo-public, .hero, .home-recent, .race-summary-card').count() == 0
        assert await page.locator('[data-elo-metrics] > .metric').count() == 4
        assert set(await page.locator('[data-elo-tab]').evaluate_all('els=>els.map(el=>el.dataset.eloTab)')) == {'race', 'opponent', 'map', 'build', 'type', 'month'}
        assert await page.locator('[data-elo-tab]').count() == 6
        assert not await page.locator('[data-elo-form]').is_visible()
        assert not any('/recent?' in url for url in state['requests'])
        await page.locator('[data-elo-tab="opponent"]').click()
        await page.locator('[data-elo-form] input').fill('소이')
        await page.locator('[data-elo-form] button').click()
        await page.wait_for_function("document.querySelector('[data-elo-rival-result]')?.textContent.includes('정소이')")
        await page.locator('[data-elo-form] input').fill('동명이인')
        await page.locator('[data-elo-form] button').click()
        await page.wait_for_function("document.querySelectorAll('[data-elo-choice=opponent]').length===2")
        await page.locator('[data-elo-choice=opponent][data-player-id="513"]').click()
        await page.wait_for_function("document.querySelector('[data-elo-rival-result]')?.textContent.includes('정소이')")
        await page.locator('[data-elo-tab="map"]').click()
        assert not await page.locator('[data-elo-form]').is_visible()
        await page.locator('[data-elo-tab="build"]').click()
        assert '나의 빌드' in await page.locator('[data-elo-table]').inner_text()
        assert '직접' in await page.locator('[data-elo-detail-status]').inner_text()
        await page.locator('[data-elo-source]').select_option('local')
        assert '1' in await page.locator('[data-elo-metrics]').inner_text()
        await page.locator('[data-elo-source]').select_option('elo')
        await wait_total(page)
        assert len([url for url in state['requests'] if '/summary?' in url]) == 1
        assert len([url for url in state['requests'] if '/activity?' in url]) == 1
        if APP != ROOT:
            await check_records(state, width)
        else:
            await page.locator('#nav a[href="#records"]').click()
            await page.locator('#records.active').wait_for(state='visible')
            await page.wait_for_function("document.querySelectorAll('#recordsTable tbody tr').length === 1")
            assert await page.locator('#recordsTable tbody tr').count() == 1
            assert await page.locator('[data-record-source]').count() == 0
            assert not any('/recent?' in url for url in state['requests'])
            await page.locator('#nav a[href="#stats"]').click()
            await wait_total(page)
        assert len([url for url in state['requests'] if '/summary?' in url]) == 1
        assert len([url for url in state['requests'] if '/activity?' in url]) == 1
        state['fail'] = True
        await page.locator('#journalStatistics [data-elo-refresh]').click()
        await page.wait_for_function("document.querySelector('[data-elo-status]')?.textContent.includes('마지막')")
        await wait_total(page)
        await assert_journal(state)
        geometry = await page.evaluate('({doc:document.documentElement.scrollWidth,width:innerWidth})')
        assert geometry['doc'] <= geometry['width'] + 1, geometry
        await page.locator('#journalStatistics').scroll_into_view_if_needed()
        await page.screenshot(path=str(OUTPUT / ('statistics-' + str(width) + '.png')))
        assert not state['errors'], state['errors']
    finally:
        await state['context'].close()


async def check_owner_change(browser, origin):
    state = await prepare(browser, origin, 390, harness=True, delay_owner=True)
    page = state['page']
    try:
        await asyncio.wait_for(state['started'].wait(), timeout=10)
        await page.evaluate('showPlayer("정소이","Z")')
        await wait_total(page, 90)
        state['gate'].set()
        await page.wait_for_timeout(100)
        assert '정소이' in await page.locator('#journalStatistics').inner_text()
        assert '90' in await page.locator('[data-elo-metrics]').inner_text()
        assert not any('/recent?' in url for url in state['requests'])
        await page.evaluate('showPlayer("내닉네임","P")')
        await page.wait_for_function("document.querySelector('[data-elo-status]')?.textContent.includes('찾지 못')")
        assert '90' not in await page.locator('[data-elo-metrics]').inner_text()
        await page.evaluate('showPlayer("동명이인","P")')
        await page.wait_for_function("document.querySelectorAll('[data-elo-choice=owner]').length===2")
        await page.locator('[data-elo-choice=owner][data-player-id="513"]').click()
        await wait_total(page, 90)
        await assert_journal(state)
        assert not state['errors'], state['errors']
    finally:
        state['gate'].set()
        await state['context'].close()


async def check_directory_recovery(browser, origin):
    state = await prepare(browser, origin, 390, harness=True, directory_fail=True)
    page = state['page']
    try:
        await page.wait_for_function("document.querySelector('[data-elo-status]')?.textContent.includes('찾지 못')")
        before = state['directoryCalls']
        state['directoryFail'] = False
        await page.locator('#journalStatistics [data-elo-refresh]').click()
        await wait_total(page, 90)
        assert state['directoryCalls'] > before
        await assert_journal(state)
        assert not state['errors'], state['errors']
    finally:
        await state['context'].close()


async def check_incomplete_periods(browser, origin):
    state = await prepare(browser, origin, 390, incomplete=True)
    page = state['page']
    try:
        await wait_total(page)
        cards = page.locator('[data-elo-metrics] > .metric')
        assert '—' in await cards.nth(0).inner_text(), 'yesterday activity must not become today statistics'
        assert '—' in await cards.nth(1).inner_text(), 'an incomplete month is unknown rather than zero'
        await page.locator('[data-elo-tab="month"]').click()
        assert '—' in await page.locator('[data-elo-table]').inner_text()
        await assert_journal(state)
        assert not state['errors'], state['errors']
    finally:
        await state['context'].close()


async def check_late_recent(browser, origin):
    state = await prepare(browser, origin, 390, delay_recent=True)
    page = state['page']
    try:
        await wait_total(page)
        await page.locator('#nav a[href="#records"]').click()
        await asyncio.wait_for(state['started'].wait(), timeout=10)
        await page.locator('[data-record-source="manual"]').click()
        before = await page.locator('#recordsTable').inner_html()
        state['gate'].set()
        await page.wait_for_timeout(100)
        assert await page.locator('#recordsTable').inner_html() == before
        assert await page.locator('#recordsTable [data-synced-record]').count() == 0
        await assert_journal(state)
        assert not state['errors'], state['errors']
    finally:
        state['gate'].set()
        await state['context'].close()


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:' + str(server.server_address[1])
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                for width in [1440, 390]:
                    await check_statistics(browser, origin, width)
                await check_owner_change(browser, origin)
                await check_directory_recovery(browser, origin)
                await check_incomplete_periods(browser, origin)
                if APP != ROOT:
                    await check_late_recent(browser, origin)
            finally:
                await browser.close()
    finally:
        server.shutdown()
    print('Statistics/records smoke passed: one statistics view, source filters, daily reuse, late results, private journal preservation.')


if __name__ == '__main__':
    asyncio.run(main())
