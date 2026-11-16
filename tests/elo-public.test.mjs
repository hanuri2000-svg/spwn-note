import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const modulePath = existsSync(new URL('../elo-public.js', import.meta.url)) ? '../elo-public.js' : '../starlog/elo-public.js';
const { createClient, createDirectory, candidates, validPayload, escape, kstDay, REFRESH_INTERVAL, addStats, combineGroups, ladderOnly, combinedStreak, opponentMatch } = createRequire(import.meta.url)(modulePath);
const stats = { wins: 22, losses: 16, games: 38, winRate: 57.9 };
const stamp = '2026-11-16T04:00:00.000Z';
const NOW = Date.parse(stamp);
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
const activity = (playerId = 443) => ({
  schemaVersion: 1, source: 'eloboard', fetchedAt: stamp, playerId, asOfDate: '2026-11-16',
  coverage: { from: '2026-09-28', to: '2026-11-16', complete: true, allMatches: false },
  today: { date: '2026-11-16', complete: true, wins: 2, losses: 1, games: 3, winRate: 66.7 },
  currentMonth: { month: '2026-11', complete: true, ...stats },
  streak: { result: 'W', count: 2, complete: true },
  months: [
    { month: '2026-11', complete: true, ...stats },
    { month: '2026-09', complete: false, wins: null, losses: null, games: null, winRate: null }
  ]
});
const store = () => {
  const values = new Map([['my-starlog-v1', '{"matches":[{"memo":"소중한 메모"}],"trash":[{"id":"deleted"}]}']]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const response = data => ({ ok: true, json: async () => data });

test('shares in-flight requests and restores validated per-site, per-player cache', async () => {
  const storage = store();
  let finish, calls = 0;
  const client = createClient({ site: 'spwn-note', storage, now: () => NOW, fetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const one = client.get('summary', 443), two = client.get('summary', 443, null, true);
  assert.equal(one, two);
  await Promise.resolve();
  finish(response(summary()));
  await one;
  const restored = createClient({ site: 'spwn-note', storage, now: () => NOW + 1, fetch: async () => { throw Error('must use cache'); } });
  assert.equal((await restored.get('summary', 443)).data.player.id, 443);
  assert.equal(calls, 1);
  let otherCalls = 0;
  const other = createClient({ site: 'dorang-integrated', storage, now: () => NOW + 1, fetch: async () => { otherCalls++; return response(summary()); } });
  await other.get('summary', 443);
  assert.equal(otherCalls, 1);
  assert.equal(storage.values.get('my-starlog-v1'), '{"matches":[{"memo":"소중한 메모"}],"trash":[{"id":"deleted"}]}');
  assert.ok([...storage.values.keys()].every(key => key === 'my-starlog-v1' || key.startsWith('starlog-public-elo:v1:')));
});

test('preserves the last successful snapshot and its real timestamp on upstream failure', async () => {
  const storage = store();
  let now = NOW, fail = false, calls = 0;
  const client = createClient({ site: 'my-starlog', storage, now: () => now, fetch: async () => {
    calls++; if (fail) return { ok: false, status: 503 }; return response(summary());
  } });
  await client.get('summary', 443);
  fail = true; now += 86400000;
  const result = await client.get('summary', 443);
  assert.equal(result.stale, true);
  assert.equal(result.error, true);
  assert.equal(result.data.fetchedAt, stamp);
  assert.deepEqual(result.data.overall, stats);
  const saved = JSON.parse(storage.values.get('starlog-public-elo:v1:my-starlog:443:summary'));
  assert.equal(saved.data.fetchedAt, stamp);
  assert.deepEqual(saved.data.overall, stats);
  await client.get('summary', 443);
  assert.equal(calls, 2, 'a failed 6-hour refresh does not repeat automatically');
});

test('shows backend stale data as stale without refetching on every local render', async () => {
  let calls = 0;
  const client = createClient({ site: 'test', storage: store(), now: () => NOW, fetch: async () => {
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

test('directory requests share work, reuse the 6-hour cache, and honor force refresh', async () => {
  let finish, calls = 0, now = NOW;
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
  now += 86400000;
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

test('automatic refresh uses 6 elapsed hours across midnight and reloads', async () => {
  assert.equal(REFRESH_INTERVAL, 6 * 60 * 60 * 1000);
  assert.equal(kstDay(Date.parse('2026-11-16T15:00:00Z')), '2026-11-17');
  const storage = store();
  let now = Date.parse('2026-11-16T14:30:00Z'), calls = 0;
  const start = now;
  const options = { site: '12h-test', storage, now: () => now, fetch: async () => {
    calls++; return response({ ...summary(), fetchedAt: new Date(now).toISOString() });
  } };
  await createClient(options).get('summary', 443);
  now += 60 * 60 * 1000; // crosses Korean midnight, but does not refresh
  await createClient(options).get('summary', 443);
  now = start + REFRESH_INTERVAL - 1;
  await createClient(options).get('summary', 443);
  assert.equal(calls, 1);
  now++;
  await createClient(options).get('summary', 443);
  await createClient(options).get('summary', 443);
  assert.equal(calls, 2);
  now += REFRESH_INTERVAL;
  await createClient(options).get('summary', 443);
  assert.equal(calls, 3);
});

test('a failed first 6-hour attempt stays failed across reloads until an explicit refresh', async () => {
  const storage = store(), original = storage.values.get('my-starlog-v1');
  let now = NOW, calls = 0, available = false;
  const options = { site: 'failed-day', storage, now: () => now, fetch: async () => {
    calls++; if (!available) return { ok: false, status: 503 };
    return response({ ...summary(), fetchedAt: new Date(now).toISOString() });
  } };
  await assert.rejects(createClient(options).get('summary', 443));
  now += 60 * 60 * 1000;
  const reloaded = createClient(options);
  await assert.rejects(reloaded.get('summary', 443));
  assert.equal(calls, 1);
  assert.equal(reloaded.peek('summary', 443), null, 'no failure becomes zero-filled statistics');
  available = true;
  assert.equal((await reloaded.get('summary', 443, null, true)).data.overall.games, 38);
  assert.equal(calls, 2);
  assert.equal(storage.values.get('my-starlog-v1'), original);
});

test('a failed next-day refresh retains the last snapshot across another app start', async () => {
  const storage = store();
  let now = NOW, calls = 0, available = true;
  const options = { site: 'last-valid-day', storage, now: () => now, fetch: async () => {
    calls++; return available ? response(summary()) : { ok: false, status: 503 };
  } };
  await createClient(options).get('summary', 443);
  available = false; now += 86400000;
  const failed = await createClient(options).get('summary', 443);
  assert.equal(failed.error, true);
  now += 60 * 60 * 1000;
  const reloaded = await createClient(options).get('summary', 443);
  assert.equal(reloaded.stale, true);
  assert.equal(reloaded.data.fetchedAt, stamp);
  assert.deepEqual(reloaded.data.overall, stats);
  assert.equal(calls, 2, 'same failed interval remains cached after reload');
});

test('activity validates player identity and preserves incomplete periods as unknown', async () => {
  const value = activity();
  assert.equal(validPayload('activity', value, 443), true);
  assert.equal(validPayload('activity', value, 513), false);
  assert.equal(validPayload('activity', { ...value, playerId: undefined }, 443), false);
  assert.equal(validPayload('activity', { ...value, today: { ...value.today, games: 20 } }, 443), false);
  assert.equal(validPayload('activity', { ...value, currentMonth: { month: '2026-11', complete: false, ...stats } }, 443), false);
  assert.equal(validPayload('activity', { ...value, asOfDate: '2026-11-15' }, 443), false);
  assert.equal(validPayload('activity', { ...value, today: { ...value.today, date: '2026-11-15' } }, 443), false);
  assert.equal(validPayload('activity', { ...value, currentMonth: { ...value.currentMonth, month: '2026-10' } }, 443), false);
  const client = createClient({ storage: store(), now: () => NOW, fetch: async () => response(value) });
  const result = await client.get('activity', 443);
  assert.equal(result.data.months[1].complete, false);
  assert.equal(result.data.months[1].games, null);
  assert.equal(Object.hasOwn(result.data, 'matches'), false);
});

test('summary and activity requests can finish independently without fetching recent matches', async () => {
  const seen = [];
  const client = createClient({ storage: store(), now: () => NOW, timeout: 10, fetch: url => {
    seen.push(url);
    return url.includes('/activity?') ? new Promise(() => {}) : Promise.resolve(response(summary()));
  } });
  const pending = assert.rejects(client.get('activity', 443));
  assert.equal((await client.get('summary', 443)).data.overall.games, 38);
  await pending;
  assert.equal(client.peek('summary', 443).data.overall.games, 38);
  assert.equal(client.peek('activity', 443), null);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(url => !url.includes('/recent?')));
});

test('an existing client reads another tab 6-hour success and failure before fetching', async () => {
  for (const failure of [false, true]) {
    const storage = store();
    let now = NOW, calls = 0, nextDay = false;
    const options = { site: 'shared-tab-' + failure, storage, now: () => now, fetch: async () => {
      calls++;
      if (nextDay && failure) return { ok: false, status: 503 };
      return response({ ...summary(), fetchedAt: new Date(now).toISOString(), overall: nextDay ?
        { wins: 23, losses: 16, games: 39, winRate: 59 } : stats });
    } };
    const first = createClient(options), second = createClient(options);
    await first.get('summary', 443);
    await second.get('summary', 443);
    now += 86400000; nextDay = true;
    await second.get('summary', 443);
    const observed = await first.get('summary', 443);
    assert.equal(calls, 2, 'an already-open tab reuses the other tab 6-hour attempt');
    assert.equal(observed.data.overall.games, failure ? 38 : 39);
    assert.equal(Boolean(observed.error), failure);
    assert.equal(Boolean(observed.stale), failure);
  }
});

test('an existing directory reads another tab 6-hour result without repeating the request', async () => {
  for (const failure of [false, true]) {
    const storage = store();
    let now = NOW, calls = 0, nextDay = false;
    const options = { storage, now: () => now, fetch: async () => {
      calls++;
      if (nextDay && failure) throw Error('offline');
      return response({ players: [{ name: nextDay ? '새선수' : '최도랑', eloId: nextDay ? 900 : 443 }] });
    } };
    const first = createDirectory(options), second = createDirectory(options);
    await first.get();
    await second.get();
    now += 86400000; nextDay = true;
    await second.get();
    const observed = await first.get();
    assert.equal(calls, 2);
    assert.equal(observed.players[0].eloId, failure ? 443 : 900);
    assert.equal(observed.stale, failure);
  }
});


test('6-hour cache expiry uses the server fetch timestamp, not a delayed client read', async () => {
  let now = NOW + 6 * 60 * 60 * 1000, calls = 0;
  const client = createClient({ site: 'source-age', storage: store(), now: () => now, fetch: async () => {
    calls++; return response({ ...summary(), fetchedAt: calls === 1 ? stamp : new Date(now).toISOString() });
  } });
  await client.get('summary', 443);
  now = NOW + REFRESH_INTERVAL - 1;
  await client.get('summary', 443);
  assert.equal(calls, 1);
  now++;
  await client.get('summary', 443);
  assert.equal(calls, 2);
});

test('failed attempts can automatically recover after 6 hours, including after reload', async () => {
  let now = NOW, calls = 0;
  const storage = store();
  const options = { site: 'recover-12h', storage, now: () => now, fetch: async () => {
    calls++; return calls === 1 ? { ok: false } : response({ ...summary(), fetchedAt: new Date(now).toISOString() });
  } };
  await assert.rejects(createClient(options).get('summary', 443));
  now += REFRESH_INTERVAL - 1;
  await assert.rejects(createClient(options).get('summary', 443));
  assert.equal(calls, 1);
  now++;
  assert.equal((await createClient(options).get('summary', 443)).data.overall.games, 38);
  assert.equal(calls, 2);
});

const ladderGames = [
  { id:'ladder1', type:'래더', date:'2026-11-16', opponent:'소이', map:'투혼', race:'Z', result:'W' },
  { id:'ladder2', type:'래더', date:'2026-11-16', opponent:'정소이', map:'투혼', race:'Z', result:'L' }
];
const playerDirectory = [{ name:'정소이', aliases:['소이'], eloId:513 }];

test('one statistics view adds only independent ladder games, not duplicate manual official records', () => {
  const input = [...ladderGames, { ...ladderGames[0], type:'스폰' }, { ...ladderGames[0], type:'CK' },
    { ...ladderGames[0], source:'eloboard' }, { ...ladderGames[0], eloRecordId:'1000' }];
  const before = JSON.stringify(input);
  const selected = ladderOnly(input);
  assert.equal(selected.length, 2);
  assert.deepEqual(addStats(stats, { wins:1, losses:1, games:2, winRate:50 }),
    { wins:23, losses:17, games:40, winRate:57.5, ladder:{wins:1,losses:1,games:2,winRate:50} });
  assert.equal(addStats(null, stats), null);
  assert.equal(JSON.stringify(input), before);
});

test('ladder is included in the same race, map, type, month and opponent tables', () => {
  const source = summary();
  for (const [key, rows] of [['race', source.races], ['map', source.maps], ['opponent', source.opponents]]) {
    const result = combineGroups(rows, ladderGames, key, playerDirectory);
    assert.equal(result.length, 1, key);
    assert.equal(result[0].games, 40, key);
    assert.equal(result[0].wins, 23, key);
    assert.equal(result[0].losses, 17, key);
    assert.equal(result[0].ladder.games, 2, key);
  }
  const types = combineGroups(source.types, ladderGames, 'type');
  assert.equal(types.find(row=>row.label==='래더').games, 2);
  assert.equal(types.find(row=>row.label==='스폰').games, 38);
  const month = combineGroups([{month:'2026-11',label:'2026-11',complete:true,...stats}], ladderGames, 'month');
  assert.equal(month[0].games,40);
});

test('missing source months and bounded rival lists do not turn ladder counts into lifetime totals', () => {
  for (const key of ['month','opponent']) {
    const rows = combineGroups([], ladderGames, key, playerDirectory);
    assert.equal(rows[0].complete,false);
    assert.equal(rows[0].games,null);
    assert.equal(rows[0].ladder.games,2);
  }
  const unknown = combineGroups([{label:'2026-11',month:'2026-11',complete:false,wins:null,losses:null,games:null,winRate:null}], ladderGames,'month');
  assert.equal(unknown[0].games,null);
  assert.equal(unknown[0].ladder.games,2);
  assert.equal(opponentMatch(ladderGames[0],{id:513,name:'정소이'},playerDirectory),true);
  assert.equal(opponentMatch(ladderGames[0],{id:513,name:'정소이'},[...playerDirectory,{name:'다른 선수',aliases:['소이'],eloId:900}]),false);
});

test('combined streak never invents the order of mixed official and ladder games on one date', () => {
  const a = {...activity(), recentResults:[{id:1,date:'2026-11-15',result:'W'},{id:2,date:'2026-11-14',result:'L'}]};
  assert.deepEqual(combinedStreak(a,[ladderGames[0]]),{result:'W',count:2,complete:true});
  const mixed = {...a,recentResults:[{id:1,date:'2026-11-16',result:'L'}]};
  assert.equal(combinedStreak(mixed,[ladderGames[0]]).ambiguous,true);
  assert.equal(combinedStreak(mixed,[ladderGames[0]]).complete,false);
  assert.equal(validPayload('activity',{...a,recentResults:[{id:1,date:'2026-11-17',result:'W'}]},443),false);
});


test('an old stale server snapshot is not repeatedly re-requested within the 6-hour window', async () => {
  let now=NOW+REFRESH_INTERVAL+1,calls=0;
  const client=createClient({storage:store(),now:()=>now,fetch:async()=>{calls++;return response({...summary(),stale:true})}});
  await client.get('summary',443);now+=60000;await client.get('summary',443);
  assert.equal(calls,1);
});


test('manual and browser reload bypass a fresh snapshot only when requested', async () => {
  const storage = store(), before = storage.values.get('my-starlog-v1');
  const calls = []; let now = NOW;
  const options = { site: 'six-hour-refresh', storage, now: () => now, fetch: async url => {
    calls.push(new URL(url)); return response({ ...summary(), fetchedAt: new Date(now).toISOString() });
  } };
  const client = createClient(options);
  await client.get('summary', 443);
  now += 60_000;
  await client.get('summary', 443);
  assert.equal(calls.length, 1);
  await client.get('summary', 443, null, true);
  assert.equal(calls[1].searchParams.get('refresh'), '1');
  const reload = createClient({ ...options, reloadToken: 'navigation-2' });
  await reload.get('summary', 443);
  assert.equal(calls[2].searchParams.get('refresh'), '1');
  await reload.get('summary', 443);
  await createClient({ ...options, reloadToken: 'navigation-2' }).get('summary', 443);
  assert.equal(calls.length, 3);
  await createClient({ ...options, reloadToken: 'navigation-3' }).get('summary', 443);
  assert.equal(calls.length, 4);
  assert.equal(storage.values.get('my-starlog-v1'), before);
});

test('failed browser reload retains the previous snapshot and personal notes', async () => {
  const storage = store(), before = storage.values.get('my-starlog-v1'); let calls = 0;
  const options = { site: 'reload-failure', storage, now: () => NOW, fetch: async () => {
    calls++; return calls === 1 ? response(summary()) : { ok: false, status: 503 };
  } };
  await createClient(options).get('summary', 443);
  const client = createClient({ ...options, reloadToken: 'reload-1' });
  const value = await client.get('summary', 443);
  assert.equal(value.stale, true); assert.equal(value.error, true);
  assert.deepEqual(value.data.overall, stats); assert.equal(value.data.fetchedAt, stamp);
  await client.get('summary', 443);
  assert.equal(calls, 2);
  assert.equal(storage.values.get('my-starlog-v1'), before);
});
