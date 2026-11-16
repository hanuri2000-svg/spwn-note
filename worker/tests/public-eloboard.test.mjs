import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import {
  PublicSourceError, createPublicAdapter, parsePublicSummary, parsePublicRival,
  parsePublicMatches, collectPublicRecent, buildPublicActivity,
} from '../src/public-eloboard.js';

const fixtureRoot = new URL('./fixtures/eloboard/', import.meta.url);
const names = ['summary', 'maps', 'rival-513', 'recent-1', 'recent-2', 'recent-3', 'recent-4'];
const fixtures = Object.fromEntries(await Promise.all(names.map(async name => [name,
  gunzipSync(await readFile(new URL(name + '.html.gz', fixtureRoot))).toString('utf8'),
])));
const provenance = JSON.parse(await readFile(new URL('provenance.json', fixtureRoot), 'utf8'));
const route = path => new URL('https://relay.test/api/elo/public/' + path);
const response = html => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const boundaryPages = new Map([['', 'recent-1'], ['2026-11-07', 'recent-2'], ['2026-11-05', 'recent-3'], ['2026-10-19', 'recent-4']]);

function sourceFetch(calls, { fail = () => false } = {}) {
  return async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(url.origin, 'https://eloboard.com');
    assert.equal(url.pathname, '/players/443');
    assert.equal(init.redirect, 'manual');
    if (fail()) return new Response('Forbidden', { status: 403 });
    const tab = url.searchParams.get('tab');
    if (!tab) return response(fixtures.summary);
    if (tab === 'maps') return response(fixtures.maps);
    if (tab === 'rivals') return response(fixtures['rival-513']);
    if (tab === 'matches') {
      const name = boundaryPages.get(url.searchParams.get('to') || '');
      assert.ok(name, 'Only the public inclusive date boundaries are fetched');
      return response(fixtures[name]);
    }
    assert.fail('Unexpected source query');
  };
}

function rewriteFlight(html, transform) {
  const data = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g)]
    .map(m => JSON.parse(m[1])).join('');
  return '<title>최도랑 · EloBoard</title><script>self.__next_f.push([1,' + JSON.stringify(transform(data)) + '])</script>';
}

function changeMatches(name, mutate, to) {
  const originalTo = { 'recent-1': '', 'recent-2': '2026-11-07', 'recent-3': '2026-11-05', 'recent-4': '2026-10-19' }[name];
  const originalRows = parsePublicMatches(fixtures[name], 443, originalTo).rows;
  const nextRows = mutate(structuredClone(originalRows));
  return rewriteFlight(fixtures[name], data => {
    const needle = '"initial":' + JSON.stringify(originalRows);
    assert.ok(data.includes(needle));
    return data.replace(needle, '"initial":' + JSON.stringify(nextRows))
      .replaceAll('"to":' + JSON.stringify(originalTo), '"to":' + JSON.stringify(to ?? originalTo));
  });
}

function profileTotals(html, wins, losses) {
  const games = wins + losses, rate = games ? Math.round(wins * 1000 / games) / 10 : 0;
  return rewriteFlight(html, data => data.replace('"2,881"', JSON.stringify(String(games)))
    .replace('"1,442"', JSON.stringify(String(wins))).replace('"1,439"', JSON.stringify(String(losses)))
    .replace('"50.1"', JSON.stringify(String(rate))));
}

function memoryEdgeCache(storage = new Map()) {
  return { storage, match: async key => storage.has(key) ? new Response(storage.get(key)) : undefined,
    put: async (key, value) => storage.set(key, await value.text()) };
}

function activitySnapshot(matches, extra = {}) {
  return { playerId: 443, fetchedAt: '2026-11-16T10:00:00.000Z', complete: true, allMatches: false,
    matches, ...extra };
}

test('compressed public fixtures match the downloaded diagnostic SHA-256 values', () => {
  for (const name of names) {
    const record = provenance.files[name + '.html.gz'];
    assert.equal(Buffer.byteLength(fixtures[name]), record.uncompressedBytes);
    assert.equal(createHash('sha256').update(fixtures[name]).digest('hex'), record.uncompressedSha256);
  }
});

test('real profile keeps aggregate totals independent of the recent list and missing group classifications', () => {
  const result = parsePublicSummary(fixtures.summary, fixtures.maps, fixtures['rival-513'], 443);
  assert.deepEqual(result.player, { id: 443, name: '최도랑', race: 'P', elo: 1464, wins: 1442, losses: 1439, games: 2881, winRate: 50.1 });
  assert.deepEqual(result.overall, { wins: 1442, losses: 1439, games: 2881, winRate: 50.1 });
  assert.equal(result.races.reduce((sum, row) => sum + row.games, 0), 2879);
  assert.deepEqual(result.races.find(row => row.race === 'Z'), { race: 'Z', label: '저그', wins: 687, losses: 744, games: 1431, winRate: 48 });
  assert.equal(result.types.length, 8);
  assert.equal(result.types.find(row => row.key === 'sponsored').games, 2361);
  assert.equal(result.maps.length, 14);
  assert.deepEqual(result.maps.find(row => row.id === 299), { id: 299, label: '녹아웃', wins: 79, losses: 77, games: 156, winRate: 50.6 });
  assert.equal(result.opponents.length, 40);
  assert.deepEqual(result.opponents.find(row => row.id === 513), { id: 513, name: '정소이', race: 'Z', wins: 22, losses: 16, games: 38, winRate: 57.9 });
});

test('real matchup reads the selected pair, period, maps and category totals', () => {
  const result = parsePublicRival(fixtures['rival-513'], 443, 513);
  assert.deepEqual(result.player, { id: 443, name: '최도랑', race: 'P' });
  assert.deepEqual(result.opponent, { id: 513, name: '정소이', race: 'Z' });
  assert.deepEqual(result.headToHead, { wins: 22, losses: 16, games: 38, winRate: 57.9, from: '2022-07-31', to: '2026-11-14' });
  assert.equal(result.maps.length, 10);
  assert.deepEqual(result.types, [
    { key: 'sponsored', label: '스폰', wins: 21, losses: 14, games: 35, winRate: 60 },
    { key: 'college_mini', label: '미니대전', wins: 1, losses: 2, games: 3, winRate: 33.3 },
  ]);
  const outsideInitialList = rewriteFlight(fixtures['rival-513'], data => data.replace(/"rivals":\[[\s\S]*?\],"currentId":513/, '"rivals":[],"currentId":513'));
  assert.equal(parsePublicRival(outsideInitialList, 443, 513).headToHead.games, 38);
  assert.throws(() => parsePublicRival(fixtures['rival-513'], 443, 441), /상대 선수/);
});

test('four real inclusive pages produce 50 unique records in original source order with signed ELO changes', async () => {
  const paths = [];
  const result = await collectPublicRecent(async path => {
    paths.push(path);
    return fixtures[boundaryPages.get(new URL(path, 'https://eloboard.com').searchParams.get('to') || '')];
  }, 443, 50);
  assert.equal(result.complete, true);
  assert.equal(result.warning, null);
  assert.equal(result.matches.length, 50);
  assert.equal(new Set(result.matches.map(row => row.id)).size, 50);
  assert.ok(result.matches.every((row, i) => !i || row.date <= result.matches[i - 1].date));
  assert.deepEqual(result.matches[0], { id: 2915079, date: '2026-11-14', opponentId: 513, opponent: '정소이', race: 'Z', result: 'W', map: '녹아웃', type: '스폰', eloChange: 4.51 });
  assert.equal(result.matches[3].eloChange, -3.15);
  assert.equal(result.matches.at(-1).id, 2900954);
  assert.equal(result.matches.at(-1).date, '2026-09-28');
  assert.deepEqual(paths, [
    '/players/443?tab=matches', '/players/443?tab=matches&to=2026-11-07',
    '/players/443?tab=matches&to=2026-11-05', '/players/443?tab=matches&to=2026-10-19',
  ]);
});

test('activity uses verified complete months and never labels the truncated boundary month as complete', async () => {
  const calls = [];
  const adapter = createPublicAdapter({ fetchImpl: sourceFetch(calls), now: () => Date.parse('2026-11-16T10:00:00Z'), edgeCache: () => undefined });
  const result = await adapter.handle(route('activity?playerId=443'));
  assert.equal(result.playerId, 443);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.source, 'eloboard');
  assert.equal(result.asOfDate, '2026-11-16');
  assert.equal(result.matches, undefined);
  assert.deepEqual(result.coverage, { from: '2026-09-28', to: '2026-11-14', complete: true, allMatches: false });
  assert.deepEqual(result.today, { date: '2026-11-16', complete: true, wins: 0, losses: 0, games: 0, winRate: 0 });
  assert.deepEqual(result.currentMonth, { month: '2026-11', complete: true, wins: 10, losses: 22, games: 32, winRate: 31.3 });
  assert.deepEqual(result.months, [result.currentMonth,
    { month: '2026-10', complete: true, wins: 7, losses: 6, games: 13, winRate: 53.8 },
    { month: '2026-09', complete: false, wins: null, losses: null, games: null, winRate: null },
  ]);
  assert.deepEqual(result.streak, { result: 'W', count: 3, complete: true });
  assert.equal(calls.length, 4);
});

test('activity and the fixed-player recent list share the same collection and daily cache', async () => {
  const calls = [];
  let time = Date.parse('2026-11-16T10:00:00Z');
  const adapter = createPublicAdapter({ fetchImpl: sourceFetch(calls), now: () => time, edgeCache: () => undefined });
  const [activity, recent] = await Promise.all([
    adapter.handle(route('activity?playerId=443')), adapter.handle(route('recent?playerId=443&limit=50')),
  ]);
  assert.equal(calls.length, 4);
  assert.equal(activity.fetchedAt, recent.fetchedAt);
  assert.equal(recent.matches.length, 50);
  assert.equal(recent.allMatches, undefined, 'The existing recent contract keeps its original fields');
  time += 60 * 60_000;
  assert.deepEqual(await adapter.handle(route('activity?playerId=443')), activity);
  const short = await adapter.handle(route('recent?playerId=443&limit=10'));
  assert.equal(short.matches.length, 10);
  assert.equal(short.requested, 10);
  assert.equal(short.complete, true);
  assert.equal(calls.length, 4);
});

test('activity permits another validated player without exposing that player through recent', async () => {
  const calls = [];
  const adapter = createPublicAdapter({ now: () => Date.parse('2026-11-16T10:00:00Z'), edgeCache: () => undefined,
    fetchImpl: async input => {
      const url = new URL(input); calls.push(url);
      assert.equal(url.pathname, '/players/9000');
      const name = boundaryPages.get(url.searchParams.get('to') || '');
      return response(rewriteFlight(fixtures[name], data => data.replaceAll('"playerId":443', '"playerId":9000')
        .replaceAll('"player_id":443', '"player_id":9000').replaceAll('최도랑', '등록 선수')));
    } });
  const activity = await adapter.handle(route('activity?playerId=9000'));
  assert.equal(activity.playerId, 9000);
  assert.equal(activity.currentMonth.games, 32);
  assert.equal(activity.matches, undefined);
  await assert.rejects(adapter.handle(route('recent?playerId=9000&limit=50')), error => error.status === 400);
  assert.equal(calls.length, 4);
});

test('today and month require a strictly earlier boundary unless all source matches are known', () => {
  const rows = [{ id: 1, date: '2026-11-16', result: 'W' }, { id: 2, date: '2026-11-01', result: 'L' }];
  const result = buildPublicActivity(activitySnapshot(rows));
  assert.equal(result.today.complete, true);
  assert.equal(result.today.games, 1);
  assert.equal(result.currentMonth.complete, false);
  assert.equal(result.currentMonth.games, null);
  const sameDay = buildPublicActivity(activitySnapshot(rows.slice(0, 1)));
  assert.equal(sameDay.today.complete, false);
  assert.equal(sameDay.today.wins, null);
  const full = buildPublicActivity(activitySnapshot(rows.slice(0, 1), { allMatches: true }));
  assert.equal(full.today.complete, true);
  assert.equal(full.today.wins, 1);
  assert.equal(full.currentMonth.complete, true);
  const partial = buildPublicActivity(activitySnapshot(rows, { complete: false }));
  assert.equal(partial.today.games, null);
  assert.equal(partial.currentMonth.winRate, null);
});

test('empty verified profiles return genuine zero activity; a 50-game uniform prefix is only a minimum streak', async () => {
  const empty = profileTotals(changeMatches('recent-1', () => []), 0, 0);
  const adapter = createPublicAdapter({ now: () => Date.parse('2026-11-16T10:00:00Z'), edgeCache: () => undefined,
    fetchImpl: async () => response(empty) });
  const result = await adapter.handle(route('activity?playerId=443'));
  assert.deepEqual(result.coverage, { from: null, to: null, complete: true, allMatches: true });
  assert.equal(result.today.games, 0);
  assert.equal(result.today.complete, true);
  assert.equal(result.currentMonth.games, 0);
  assert.deepEqual(result.streak, { result: null, count: 0, complete: true });
  const wins = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, date: '2026-11-15', result: 'W' }));
  assert.deepEqual(buildPublicActivity(activitySnapshot(wins)).streak, { result: 'W', count: 50, complete: false });
  assert.deepEqual(buildPublicActivity(activitySnapshot(wins, { allMatches: true })).streak, { result: 'W', count: 50, complete: true });
});

test('activity dates follow the KST snapshot date, reject future rows, and do not advance stale snapshots', () => {
  const rows = [{ id: 1, date: '2026-11-16', result: 'W' }];
  const before = buildPublicActivity(activitySnapshot(rows, { fetchedAt: '2026-11-16T14:59:59.999Z' }));
  const after = buildPublicActivity(activitySnapshot(rows, { fetchedAt: '2026-11-16T15:00:00.000Z' }));
  assert.equal(before.asOfDate, '2026-11-16');
  assert.equal(after.asOfDate, '2026-11-17');
  assert.equal(after.today.complete, true);
  assert.equal(after.today.games, 0);
  const stale = buildPublicActivity(activitySnapshot(rows, { fetchedAt: '2026-11-16T14:59:59.999Z', stale: true }));
  assert.equal(stale.today.date, '2026-11-16');
  assert.throws(() => buildPublicActivity(activitySnapshot(rows, { fetchedAt: '2026-11-15T14:00:00.000Z' })), PublicSourceError);
});

test('the upgrade reuses legacy v1 recent snapshots and treats absent allMatches conservatively', async () => {
  let page = 0;
  const recent = await collectPublicRecent(() => Promise.resolve(fixtures['recent-' + (++page)]), 443, 50);
  const legacy = { schemaVersion: 1, source: 'eloboard', fetchedAt: '2026-11-16T10:00:00.000Z', stale: false,
    sourceUrl: 'https://eloboard.com/players/443?tab=matches', ...recent };
  const cache = memoryEdgeCache(new Map([['https://eloboard-public-cache.invalid/v1/recent/443/50', JSON.stringify(legacy)]]));
  const adapter = createPublicAdapter({ now: () => Date.parse('2026-11-16T13:00:00Z'), edgeCache: () => cache,
    fetchImpl: () => assert.fail('A valid same-day legacy collection must not be fetched again') });
  const activity = await adapter.handle(route('activity?playerId=443'));
  assert.equal(activity.coverage.allMatches, false);
  assert.equal(activity.currentMonth.games, 32);
  assert.equal(activity.fetchedAt, legacy.fetchedAt);
  assert.equal((await adapter.handle(route('recent?playerId=443&limit=50'))).matches.length, 50);
});

test('failed attempts persist across adapter instances for one KST day and allow the next day', async () => {
  let calls = 0, time = Date.parse('2026-11-16T10:00:00Z');
  const cache = memoryEdgeCache();
  const options = { now: () => time, edgeCache: () => cache,
    fetchImpl: async () => { calls++; return new Response('Forbidden', { status: 403 }); } };
  await assert.rejects(createPublicAdapter(options).handle(route('activity?playerId=443')), PublicSourceError);
  time = Date.parse('2026-11-16T14:59:59.999Z');
  await assert.rejects(createPublicAdapter(options).handle(route('activity?playerId=443')), PublicSourceError);
  assert.equal(calls, 1);
  time += 1;
  await assert.rejects(createPublicAdapter(options).handle(route('activity?playerId=443')), PublicSourceError);
  assert.equal(calls, 2);
});

test('failed activity refresh preserves the snapshot day and does not extend the stale retention window', async () => {
  const calls = [];
  let failed = false, time = Date.parse('2026-11-16T10:00:00Z');
  const adapter = createPublicAdapter({ fetchImpl: sourceFetch(calls, { fail: () => failed }), now: () => time, edgeCache: () => undefined });
  const first = await adapter.handle(route('activity?playerId=443'));
  time = Date.parse('2026-11-16T15:00:00Z'); failed = true;
  const stale = await adapter.handle(route('activity?playerId=443'));
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.asOfDate, '2026-11-16');
  assert.equal(stale.today.date, '2026-11-16');
  assert.equal(calls.length, 5);
  const cache = memoryEdgeCache();
  cache.storage.set('https://eloboard-public-cache.invalid/v1/recent/443/50', JSON.stringify({
    schemaVersion: 1, fetchedAt: first.fetchedAt, playerId: 443, complete: true, matches: [], allMatches: true,
  }));
  time = Date.parse(first.fetchedAt) + 86_399_999;
  const expiring = createPublicAdapter({ now: () => time, edgeCache: () => cache, fetchImpl: async () => {
    time += 30_000;
    return new Response('unavailable', { status: 503 });
  } });
  await assert.rejects(expiring.handle(route('activity?playerId=443')), PublicSourceError);
});

test('missing boundary prefix and changed duplicate objects fail instead of claiming recent completeness', async () => {
  for (const changed of [
    changeMatches('recent-2', rows => rows.slice(1)),
    changeMatches('recent-2', rows => { rows[0].memo += ' 수정'; return rows; }),
  ]) {
    let calls = 0;
    await assert.rejects(collectPublicRecent(async () => ++calls === 1 ? fixtures['recent-1'] : changed, 443), PublicSourceError);
    assert.equal(calls, 2);
  }
});

test('invalid filters, order, identities and calendar dates cannot become match rows', () => {
  const cases = [
    changeMatches('recent-1', rows => { rows[0].played_on = '2026-02-30'; return rows; }),
    changeMatches('recent-1', rows => { rows[1].played_on = '2026-11-15'; return rows; }),
    changeMatches('recent-1', rows => { rows[0].participants[0].player_id = 1; return rows; }),
    changeMatches('recent-1', rows => [rows[0], ...rows.slice(0, 14)]),
  ];
  for (const html of cases) assert.throws(() => parsePublicMatches(html, 443), PublicSourceError);
  assert.throws(() => parsePublicMatches(fixtures['recent-1'], 443, '2026-11-07'), PublicSourceError);
  const empty = changeMatches('recent-1', () => []);
  assert.throws(() => parsePublicMatches(empty, 443), PublicSourceError);
});

test('a saturated day stays explicitly partial and a fetch failure never becomes a partial success', async () => {
  let calls = 0;
  const rowsForDay = rows => rows.map(row => ({ ...row, played_on: '2026-11-14' }));
  const first = changeMatches('recent-1', rowsForDay);
  const next = changeMatches('recent-1', rowsForDay, '2026-11-14');
  const result = await collectPublicRecent(async () => ++calls === 1 ? first : next, 443);
  assert.equal(calls, 2);
  assert.equal(result.complete, false);
  assert.equal(result.matches.length, 15);
  assert.match(result.warning, /같은 날짜/);
  calls = 0;
  await assert.rejects(collectPublicRecent(async () => {
    if (++calls === 1) return fixtures['recent-1'];
    throw new PublicSourceError('source unavailable');
  }, 443), /source unavailable/);
});

test('missing source structures, inconsistent aggregates and mismatched player IDs never create zero-filled statistics', () => {
  assert.throws(() => parsePublicSummary('<title>Site Unavailable</title>', fixtures.maps, fixtures['rival-513'], 443), PublicSourceError);
  assert.throws(() => parsePublicSummary(fixtures.summary, fixtures.maps, fixtures['rival-513'], 441), PublicSourceError);
  const wrong = rewriteFlight(fixtures.summary, text => text.replace('"1,442"', '"1,440"'));
  assert.throws(() => parsePublicSummary(wrong, fixtures.maps, fixtures['rival-513'], 443), PublicSourceError);
  const missing = rewriteFlight(fixtures.summary, text => text.replaceAll('__pf-stats', '__missing-stats'));
  assert.throws(() => parsePublicSummary(missing, fixtures.maps, fixtures['rival-513'], 443), PublicSourceError);
});

test('KST calendar-day server cache coalesces requests and refreshes on the next day', async () => {
  const calls = [];
  let time = Date.parse('2026-11-16T10:00:00Z');
  const adapter = createPublicAdapter({ fetchImpl: sourceFetch(calls), now: () => time, edgeCache: () => undefined });
  const [one, two] = await Promise.all([adapter.handle(route('summary?playerId=443')), adapter.handle(route('summary?playerId=443'))]);
  assert.deepEqual(one, two);
  assert.equal(calls.length, 3);
  assert.equal(one.schemaVersion, 1);
  assert.equal(one.source, 'eloboard');
  assert.equal(one.stale, false);
  assert.equal(one.fetchedAt, '2026-11-16T10:00:00.000Z');
  time = Date.parse('2026-11-16T14:59:59.999Z');
  await adapter.handle(route('summary?playerId=443'));
  assert.equal(calls.length, 3);
  time += 1;
  const refreshed = await adapter.handle(route('summary?playerId=443'));
  assert.equal(calls.length, 6);
  assert.notEqual(refreshed.fetchedAt, one.fetchedAt);
  assert.ok(calls.every(url => !url.pathname.startsWith('/api/')));
});

test('failed refresh keeps validated values and does not repeat the same request until the next KST day', async () => {
  const calls = [];
  let time = Date.parse('2026-11-16T10:00:00Z'), failed = false;
  const adapter = createPublicAdapter({ fetchImpl: sourceFetch(calls, { fail: () => failed }), now: () => time, edgeCache: () => undefined });
  const initial = await adapter.handle(route('summary?playerId=443'));
  time = Date.parse('2026-11-16T15:00:00.000Z'); failed = true;
  const stale = await adapter.handle(route('summary?playerId=443'));
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, initial.fetchedAt);
  assert.deepEqual(stale.overall, initial.overall);
  assert.match(stale.warning, /마지막/);
  assert.equal(calls.length, 4, 'No retries or subsequent pages after a rejected public page');
  await adapter.handle(route('summary?playerId=443'));
  assert.equal(calls.length, 4);
  time += 60 * 60_000; failed = false;
  assert.equal((await adapter.handle(route('summary?playerId=443'))).stale, true);
  assert.equal(calls.length, 4);
  time = Date.parse('2026-11-17T15:00:00.000Z');
  assert.equal((await adapter.handle(route('summary?playerId=443'))).stale, false);
  assert.equal(calls.length, 7);
});

test('edge cache shares successful public data across adapter instances and expires stale data after a day', async () => {
  const calls = [], storage = new Map();
  let time = Date.parse('2026-11-16T10:00:00Z'), failed = false;
  const cache = { match: async key => storage.has(key) ? new Response(storage.get(key)) : undefined,
    put: async (key, value) => storage.set(key, await value.text()) };
  const options = { fetchImpl: sourceFetch(calls, { fail: () => failed }), now: () => time, edgeCache: () => cache };
  const initial = await createPublicAdapter(options).handle(route('rival?playerId=443&opponentId=513'));
  assert.equal(calls.length, 1);
  assert.deepEqual(await createPublicAdapter(options).handle(route('rival?playerId=443&opponentId=513')), initial);
  assert.equal(calls.length, 1);
  time += 86_400_001; failed = true;
  await assert.rejects(createPublicAdapter(options).handle(route('rival?playerId=443&opponentId=513')), PublicSourceError);
});

test('IDs and recent scope are bounded before any source request', async () => {
  const adapter = createPublicAdapter({ fetchImpl: () => assert.fail('Invalid input must not fetch'), edgeCache: () => undefined });
  for (const path of [
    'summary', 'summary?playerId=0', 'summary?playerId=-1', 'summary?playerId=1e3',
    'summary?playerId=9007199254740992', 'summary?playerId=https://evil.test', 'activity?playerId=0',
    'rival?playerId=443&opponentId=443', 'rival?playerId=443&opponentId=0',
    'recent?playerId=513&limit=50', 'recent?playerId=443&limit=51', 'recent?playerId=443&limit=0',
  ]) await assert.rejects(adapter.handle(route(path)), error => error.status === 400);
});

test('upstream errors and challenge HTML fail once, without API fallback or fabricated zeros', async () => {
  for (const source of [new Response('Forbidden', { status: 403 }), response('<title>최도랑 · EloBoard</title>Site Unavailable'),
    Response.json({ games: 0 }), response('<title>최도랑 · EloBoard</title>missing data')]) {
    let calls = 0;
    const adapter = createPublicAdapter({ fetchImpl: async () => { calls++; return source.clone(); }, edgeCache: () => undefined });
    await assert.rejects(adapter.handle(route('rival?playerId=443&opponentId=513')), PublicSourceError);
    assert.equal(calls, 1);
  }
});

test('public upstream timeout has one bounded attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [];
  const adapter = createPublicAdapter({ edgeCache: () => undefined, fetchImpl: (_url, { signal }) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  const pending = adapter.handle(route('rival?playerId=443&opponentId=513'));
  t.mock.timers.tick(29_999);
  assert.equal(signals[0].aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, error => error.status === 504);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
});

test('public fetch works in the Workers runtime that rejects redirect:error before network access', async () => {
  let requests = 0;
  const adapter = createPublicAdapter({ edgeCache: () => undefined, fetchImpl: async (_url, init) => {
    if (init.redirect === 'error') throw new TypeError('Invalid redirect mode: error');
    assert.equal(init.redirect, 'manual');
    assert.match(init.headers['User-Agent'], /1\.7\.0/);
    requests++;
    return response(fixtures['rival-513']);
  } });
  const result = await adapter.handle(route('rival?playerId=443&opponentId=513'));
  assert.equal(result.headToHead.games, 38);
  assert.equal(requests, 1);
});

test('public redirects are refused without following Location or retrying', async () => {
  for (const status of [300, 301, 302, 303, 304, 307, 308]) {
    const requested = [];
    const adapter = createPublicAdapter({ edgeCache: () => undefined, fetchImpl: async (url, init) => {
      requested.push(url);
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status, headers: { Location: 'https://unrelated.invalid/player-data' } });
    } });
    await assert.rejects(adapter.handle(route('rival?playerId=443&opponentId=513')),
      error => error.status === 502 && error.code === 'PUBLIC_SOURCE_REDIRECT');
    assert.deepEqual(requested, ['https://eloboard.com/players/443?tab=rivals&vs=513']);
  }
});

test('Worker exposes the additive contracts and allows both existing sites and My Starlog without reflecting unknown origins', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', sourceFetch(calls));
  const env = { ALLOWED_ORIGIN: 'https://hanuri2000-svg.github.io' };
  for (const [path, key] of [
    ['summary?playerId=443', 'overall'], ['rival?playerId=443&opponentId=513', 'headToHead'],
    ['recent?playerId=443&limit=50', 'matches'], ['activity?playerId=443', 'currentMonth'],
  ]) {
    const result = await worker.fetch(new Request(route(path), { headers: { Origin: 'https://my-starlog.pages.dev' } }), env);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), 'https://my-starlog.pages.dev');
    const data = await result.json();
    assert.equal(data.schemaVersion, 1);
    assert.ok(data[key]);
    assert.ok(Number.isFinite(Date.parse(data.fetchedAt)));
  }
  assert.equal(calls.length, 8);
  const preflight = await worker.fetch(new Request('https://relay.test/', { method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  const denied = await worker.fetch(new Request('https://relay.test/health', { headers: { Origin: 'https://unknown.test' } }), env);
  assert.notEqual(denied.headers.get('Access-Control-Allow-Origin'), 'https://unknown.test');
  const bad = await worker.fetch(new Request(route('summary?playerId=0')), env);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'INVALID_ID');
});
