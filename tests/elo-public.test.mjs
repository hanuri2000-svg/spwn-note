import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const modulePath = existsSync(new URL('../elo-public.js', import.meta.url)) ? '../elo-public.js' : '../starlog/elo-public.js';
const { createClient, createDirectory, candidates, validPayload, escape } = createRequire(import.meta.url)(modulePath);
const stats = { wins: 22, losses: 16, games: 38, winRate: 57.9 };
const stamp = '2026-11-16T04:00:00.000Z';
const summary = (id = 443, name = '최도랑') => ({
  schemaVersion: 1, source: 'ELOBOARD', fetchedAt: stamp, sourceUrl: 'https://eloboard.com/players/' + id,
  player: { id, name, race: 'P', elo: 1464 }, overall: { ...stats },
  races: [{ race: 'Z', label: '저그', ...stats }], maps: [{ id: 1, label: '투혼', ...stats }],
  types: [{ key: 'sponsored', label: '스폰', ...stats }], opponents: [{ id: 513, name: '정소이', race: 'Z', ...stats }]
});
const rival = (owner = 443, opponent = 513) => ({
  schemaVersion: 1, source: 'ELOBOARD', fetchedAt: stamp,
  player: { id: owner, name: '최도랑' }, opponent: { id: opponent, name: '정소이' },
  headToHead: { ...stats, from: '2023-01-01', to: '2026-11-14' }, maps: [], types: []
});
const store = () => {
  const values = new Map([['my-starlog-v1', '{"matches":[{"memo":"소중한 메모"}],"trash":[{"id":"deleted"}]}']]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const response = data => ({ ok: true, json: async () => data });

test('shares in-flight requests and restores validated per-site, per-player cache', async () => {
  const storage = store();
  let finish, calls = 0;
  const client = createClient({ site: 'spwn-note', storage, now: () => 100000, fetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const one = client.get('summary', 443), two = client.get('summary', 443, null, true);
  assert.equal(one, two);
  await Promise.resolve();
  finish(response(summary()));
  await one;
  const restored = createClient({ site: 'spwn-note', storage, now: () => 100001, fetch: async () => { throw Error('must use cache'); } });
  assert.equal((await restored.get('summary', 443)).data.player.id, 443);
  assert.equal(calls, 1);
  let otherCalls = 0;
  const other = createClient({ site: 'dorang-integrated', storage, now: () => 100001, fetch: async () => { otherCalls++; return response(summary()); } });
  await other.get('summary', 443);
  assert.equal(otherCalls, 1);
  assert.equal(storage.values.get('my-starlog-v1'), '{"matches":[{"memo":"소중한 메모"}],"trash":[{"id":"deleted"}]}');
  assert.ok([...storage.values.keys()].every(key => key === 'my-starlog-v1' || key.startsWith('starlog-public-elo:v1:')));
});

test('preserves the last successful snapshot and its real timestamp on upstream failure', async () => {
  const storage = store();
  let now = 100000, fail = false, calls = 0;
  const client = createClient({ site: 'my-starlog', storage, now: () => now, fetch: async () => {
    calls++; if (fail) return { ok: false, status: 503 }; return response(summary());
  } });
  await client.get('summary', 443);
  const raw = storage.values.get('starlog-public-elo:v1:my-starlog:443:summary');
  fail = true; now += 300001;
  const result = await client.get('summary', 443);
  assert.equal(result.stale, true);
  assert.equal(result.error, true);
  assert.equal(result.data.fetchedAt, stamp);
  assert.deepEqual(result.data.overall, stats);
  assert.equal(storage.values.get('starlog-public-elo:v1:my-starlog:443:summary'), raw);
  await client.get('summary', 443);
  assert.equal(calls, 2, 'short failure cooldown prevents repeated requests');
});

test('shows backend stale data as stale without refetching on every local render', async () => {
  let calls = 0;
  const client = createClient({ site: 'test', storage: store(), now: () => 100000, fetch: async () => {
    calls++; return response({ ...summary(), stale: true });
  } });
  assert.equal((await client.get('summary', 443)).stale, true);
  assert.equal((await client.get('summary', 443)).stale, true);
  assert.equal(calls, 1);
});

test('never replaces an owner or an opponent with another valid-looking response', async () => {
  let value = summary(513, '정소이');
  const client = createClient({ site: 'spwn-note', storage: store(), fetch: async () => response(value) });
  await assert.rejects(client.get('summary', 443));
  assert.equal(client.peek('summary', 443), null);
  value = rival(443, 441);
  await assert.rejects(client.get('rival', 443, 513));
  assert.equal(client.peek('rival', 443, 513), null);
});

test('a failed first request returns an error, never invented zero totals', async () => {
  const client = createClient({ storage: store(), fetch: async () => ({ ok: false, status: 502 }) });
  await assert.rejects(client.get('summary', 443));
  assert.equal(client.peek('summary', 443), null);
  assert.equal(validPayload('summary', { ...summary(), overall: {} }, 443), false);
  assert.equal(validPayload('summary', { ...summary(), overall: { ...stats, games: 100 } }, 443), false);
  assert.equal(validPayload('summary', { ...summary(), fetchedAt: 'not-a-date' }, 443), false);
});

test('an unavailable request deadline aborts without touching journal storage', async () => {
  const storage = store(), before = storage.values.get('my-starlog-v1');
  let signal;
  const client = createClient({ storage, timeout: 5, fetch: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(client.get('summary', 443));
  assert.equal(signal.aborted, true);
  assert.equal(storage.values.get('my-starlog-v1'), before);
});

test('a slow recent list does not block or invalidate the summary route', async () => {
  const client = createClient({ storage: store(), timeout: 10, fetch: url =>
    url.includes('/recent?') ? new Promise(() => {}) : Promise.resolve(response(summary()))
  });
  const pendingRecent = assert.rejects(client.get('recent', 443));
  const result = await client.get('summary', 443);
  assert.equal(result.data.player.id, 443);
  await pendingRecent;
  assert.equal(client.peek('summary', 443).data.overall.games, 38);
  assert.equal(client.peek('recent', 443), null);
});

test('name lookup uses exact canonical names or aliases and preserves ambiguity', () => {
  const players = [
    { name: '최도랑', aliases: ['도랑'], eloId: 443, race: 'P' },
    { name: '다른 선수', aliases: ['도랑'], eloId: 900, race: 'T' },
    { name: '최도랑', aliases: [], eloId: 443, race: 'P' },
    { name: '도랑팬', aliases: [], eloId: 901, race: 'P' },
    { name: '등록 안 된 사람', eloId: null }
  ];
  assert.deepEqual(candidates(players, ' 최 도랑 ').map(p => p.eloId), [443]);
  assert.deepEqual(candidates(players, '도랑').map(p => p.eloId), [443, 900]);
  assert.deepEqual(candidates(players, '도라'), []);
  assert.deepEqual(candidates(players, '등록 안 된 사람'), []);
});

test('an old directory fallback can recover and resolve a newly registered player', async () => {
  const old = { players: [{ name: '최도랑', eloId: 443 }] };
  let available = false, calls = 0;
  const directory = createDirectory({
    storage: { getItem: () => JSON.stringify(old) },
    fetch: async () => { calls++; if (!available) throw Error('offline'); return response({ players: [{ name: '새선수', eloId: 900 }] }); }
  });
  const first = await directory.get();
  assert.equal(first.stale, true);
  assert.deepEqual(candidates(first.players, '새선수'), []);
  available = true;
  const next = await directory.get(true);
  assert.equal(next.stale, false);
  assert.equal(candidates(next.players, '새선수')[0].eloId, 900);
  assert.equal(calls, 2);
});

test('directory requests share work, cache successes briefly, and honor force refresh', async () => {
  let finish, calls = 0, now = 100000;
  const directory = createDirectory({ storage: null, now: () => now, fetch: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const one = directory.get(), two = directory.get(true);
  assert.equal(one, two);
  await Promise.resolve();
  finish(response({ players: [{ name: '최도랑', eloId: 443 }] }));
  await one;
  assert.equal((await directory.get()).players[0].eloId, 443);
  assert.equal(calls, 1);
  const refreshed = directory.get(true);
  await Promise.resolve();
  finish(response({ players: [{ name: '새선수', eloId: 900 }] }));
  assert.equal((await refreshed).players[0].eloId, 900);
  assert.equal(calls, 2);
  now += 300001;
  const expired = directory.get();
  await Promise.resolve();
  finish(response({ players: [{ name: '최도랑', eloId: 443 }] }));
  assert.equal((await expired).players[0].eloId, 443);
  assert.equal(calls, 3);
});

test('recent records are display-only, at most 50 distinct games for fixed player 443', async () => {
  const row = { id: 10, date: '2026-11-14', opponentId: 513, opponent: '정소이', race: 'Z', result: 'W', map: '투혼', type: '스폰' };
  const data = { schemaVersion: 1, fetchedAt: stamp, playerId: 443, complete: true, matches: [row] };
  assert.equal(validPayload('recent', data, 443), true);
  assert.equal(validPayload('recent', data, 513), false);
  assert.equal(validPayload('recent', { ...data, playerId: undefined }, 443), false);
  assert.equal(validPayload('recent', { ...data, matches: [row, row] }, 443), false);
  assert.equal(validPayload('recent', { ...data, matches: [{ ...row, result: '?' }] }, 443), false);
  let calls = 0;
  const client = createClient({ storage: store(), fetch: async () => { calls++; return response(data); } });
  await assert.rejects(client.get('recent', 513));
  assert.equal(calls, 0);
});

test('text destined for public statistics cannot inject markup', () => {
  assert.equal(escape('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
