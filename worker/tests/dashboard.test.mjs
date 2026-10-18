import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __test } from '../src/index.js';

const profile = { id: 1, name: '기준', division: 'women', is_main_race: true, main_race: 'P', wins: 15, losses: 8, games: 23, win_rate: 65.2 };
const game = (id, date, opponent, race = 'T', result = 'win', category = 'sponsored', map = '맵A') => ({
  id, played_on: date, category, map_name: map, format_raw: '단판',
  participants: [{ player_id: 1, name: '기준', race: 'P', result }, { player_id: opponent + 1, name: `상대${opponent}`, race, result: result === 'win' ? 'loss' : 'win' }],
});
const rows = [
  game(1, '2025-01-01', 1), game(2, '2026-10-12', 1, 'Z', 'loss', 'team_event', '맵B'),
  game(3, '2026-10-18', 2, 'P', 'win', 'solo_event', ''),
];

test('all official categories, maps, race fallback, periods and overall totals share one complete match set', () => {
  const result = __test.buildDashboardSummary(profile, [{ race: 'T', wins: 10, losses: 5, games: 15, win_rate: 66.7 }], rows, '2026-10-18');
  assert.deepEqual(result.overall, { wins: 2, losses: 1, games: 3, winRate: 66.7 });
  assert.equal(result.player.games, 23); // preserve existing profile fields
  assert.equal(result.totalGames, 3);
  assert.equal(result.detailGames, 3);
  assert.deepEqual(result.month, { wins: 1, losses: 1, games: 2, winRate: 50 });
  assert.deepEqual(result.week, result.month);
  assert.deepEqual(result.maps.map(x => [x.label, x.wins, x.losses]), [['맵 미상', 1, 0], ['맵A', 1, 0], ['맵B', 0, 1]]);
  assert.deepEqual(new Map(result.matchTypes.map(x => [x.label, x.games])), new Map([['스폰', 1], ['팀리그', 1], ['개인리그', 1]]));
  assert.deepEqual(result.races.map(x => [x.race, x.wins, x.losses, x.winRate]), [['T', 10, 5, 66.7], ['Z', 0, 1, 0], ['P', 1, 0, 100]]);
  assert.deepEqual(result.opponents.map(x => [x.label, x.games, x.winRate]), [['상대2', 1, 100], ['상대1', 2, 50]]);
});

test('most recent 20 opponents retain lifetime head-to-head, independent of input order', () => {
  const matches = Array.from({ length: 22 }, (_, i) => game(i + 1, `2026-09-${String(i + 1).padStart(2, '0')}`, i + 1));
  matches.push(game(100, '2025-01-01', 22, 'T', 'loss'));
  const result = __test.buildDashboardSummary(profile, [], matches.reverse(), '2026-10-18');
  assert.equal(result.opponents.length, 20);
  assert.deepEqual(result.opponents.map(x => x.label), Array.from({ length: 20 }, (_, i) => `상대${22 - i}`));
  assert.deepEqual(result.opponents[0], { label: '상대22', wins: 1, losses: 1, games: 2, winRate: 50, lastPlayedOn: '2026-09-22' });
});

test('empty and invalid matches produce no invented games or NaN', () => {
  const result = __test.buildDashboardSummary({ id: 1 }, [], [{}, game(1, '2026-10-18', 2, 'T', 'draw')], '2026-10-18');
  assert.equal(result.detailGames, 0);
  for (const key of ['maps', 'matchTypes', 'opponents']) assert.deepEqual(result[key], []);
  assert.ok(result.races.every(x => x.games === 0 && x.winRate === 0));
});

test('HTTP API paginates all categories and preserves preview, CORS, errors and routes', async (t) => {
  const calls = [];
  const matches = Array.from({ length: 201 }, (_, i) => game(i + 1, i ? '2026-10-18' : '2025-01-01', 2, 'T', 'win', i % 2 ? 'team_event' : 'solo_event'));
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname === '/api/players') return Response.json([profile]);
    if (url.pathname.endsWith('/stats/races')) return Response.json([]);
    assert.equal(url.pathname, '/api/matches');
    return Response.json(url.searchParams.has('category') ? matches.slice(0, 25) : matches.slice(Number(url.searchParams.get('offset')), Number(url.searchParams.get('offset')) + 200));
  });
  const env = { ALLOWED_ORIGIN: 'https://hanuri2000-svg.github.io' };
  const request = path => worker.fetch(new Request(`https://relay.test${path}`), env);
  const response = await request('/api/elo/dashboard?player=기준&today=2026-10-18');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  const body = await response.json();
  assert.equal(body.detailGames, 201);
  assert.equal(body.maps[0].games, 201);
  assert.equal(body.matchTypes.length, 2);
  assert.deepEqual(calls.filter(x => x.pathname === '/api/matches').map(x => [x.searchParams.get('offset'), x.searchParams.get('category'), x.searchParams.get('date_from')]), [['0', null, null], ['200', null, null]]);
  const preview = await (await request('/api/elo/preview?player=기준')).json();
  assert.equal(preview.items.length, 25);
  assert.equal(calls.at(-1).searchParams.get('category'), 'sponsored');
  assert.equal((await request('/api/elo/dashboard')).status, 400);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await worker.fetch(new Request('https://relay.test/', { method: 'OPTIONS' }), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://relay.test/', { method: 'POST' }), env)).status, 405);
});

test('exactly 5000 matches succeeds; overflow and malformed upstream fail explicitly', async (t) => {
  let mode = 'exact';
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname === '/api/players') return Response.json([profile]);
    if (url.pathname.endsWith('/stats/races')) return Response.json([]);
    if (mode === 'malformed') return Response.json({ error: 'bad payload' });
    const offset = Number(url.searchParams.get('offset'));
    return Response.json(offset < 5000 ? Array.from({ length: 200 }, (_, i) => game(offset + i + 1, '2026-10-18', 2)) : mode === 'overflow' ? [game(5001, '2026-10-18', 2)] : []);
  });
  const run = () => worker.fetch(new Request('https://relay.test/api/elo/dashboard?player=기준'), {});
  assert.equal((await (await run()).json()).detailGames, 5000);
  mode = 'overflow'; assert.equal((await run()).status, 422);
  mode = 'malformed'; assert.equal((await run()).status, 502);
});

 test('duplicate match IDs cannot inflate overall or grouped statistics', () => {
  const result = __test.buildDashboardSummary(profile, [], [...rows, rows[0]], '2026-10-18');
  assert.equal(result.detailGames, 3);
  assert.equal(result.totalGames, 3);
  assert.equal(result.maps.reduce((sum, row) => sum + row.games, 0), 3);
  assert.equal(result.matchTypes.reduce((sum, row) => sum + row.games, 0), 3);
});
