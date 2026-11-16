/* Public statistics are views only; journal records and settings are never written. */
(function (global, factory) {
  const api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.StarlogElo = api;
})(typeof window === 'object' ? window : globalThis, function (global) {
  'use strict';
  const API = 'https://spawn-note-elo-relay.hajimayo8130.workers.dev/api/elo/public';
  const DIRECTORY = 'https://hanuri2000-svg.github.io/star-match-manager/players.json';
  const PREFIX = 'starlog-public-elo:v1:';
  const REFRESH_INTERVAL = 12 * 60 * 60 * 1000;
  const recentEnough = (at, now, ttl = REFRESH_INTERVAL) => numberOK(at) && now >= at && now - at < ttl;
  const RACES = { P: '프로토스', T: '테란', Z: '저그', R: '랜덤 / 모름' };
  const TABS = [['opponent', '상대별'], ['map', '맵별'], ['race', '종족별'], ['build', '빌드별'], ['type', '유형별'], ['month', '월별']];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const idOK = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const numberOK = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const statsOK = value => value && ['wins', 'losses', 'games', 'winRate'].every(k => numberOK(value[k])) && value.winRate <= 100 && value.wins + value.losses === value.games;
  const playerOK = (player, id) => player && Number(player.id) === Number(id) && typeof player.name === 'string' && player.name.trim().length > 0;
  const rowsOK = rows => Array.isArray(rows) && rows.every(statsOK);
  const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const monthOK = value => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
  const formatNumber = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  const rate = value => value.games ? formatNumber(value.winRate) + '%' : '—';
  const kstDay = (timestamp = Date.now()) => new Date(Number(timestamp) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  function storageOf(options) {
    if ('storage' in options) return options.storage;
    try { return global.localStorage; } catch { return null; }
  }
  function readJSON(storage, key) {
    try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
  }
  function writeJSON(storage, key, value) {
    try { storage?.setItem(key, JSON.stringify(value)); } catch {}
  }
  function periodOK(period) {
    return period && typeof period.complete === 'boolean' && (period.complete ? statsOK(period) :
      ['wins', 'losses', 'games', 'winRate'].every(key => period[key] === null));
  }
  function validPayload(kind, data, playerId, opponentId) {
    if (!data || data.schemaVersion !== 1 || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))) return false;
    if (kind === 'recent') return Number(playerId) === 443 && Number(data.playerId) === 443 &&
      typeof data.complete === 'boolean' && Array.isArray(data.matches) && data.matches.length <= 50 &&
      data.matches.every(m => m && idOK(m.id) && dateOK(m.date) && typeof m.opponent === 'string' &&
        idOK(m.opponentId) && Number(m.opponentId) !== 443 && ['W', 'L'].includes(m.result)) &&
      new Set(data.matches.map(m => String(m.id))).size === data.matches.length;
    if (kind === 'activity') return Number(data.playerId) === Number(playerId) && dateOK(data.asOfDate) &&
      data.asOfDate === kstDay(Date.parse(data.fetchedAt)) &&
      (data.recentResults == null || sequenceOK(data.recentResults, data.asOfDate)) &&
      data.coverage && typeof data.coverage.complete === 'boolean' && typeof data.coverage.allMatches === 'boolean' &&
      periodOK(data.today) && data.today.date === data.asOfDate &&
      periodOK(data.currentMonth) && data.currentMonth.month === data.asOfDate.slice(0, 7) &&
      data.streak && ['W', 'L', null].includes(data.streak.result) && Number.isSafeInteger(data.streak.count) && data.streak.count >= 0 &&
      typeof data.streak.complete === 'boolean' && (data.streak.result !== null || data.streak.count === 0) &&
      Array.isArray(data.months) && data.months.every(row => periodOK(row) && monthOK(row.month)) &&
      new Set(data.months.map(row => row.month)).size === data.months.length;
    if (!playerOK(data.player, playerId)) return false;
    if (kind === 'rival') return playerOK(data.opponent, opponentId) && statsOK(data.headToHead) && rowsOK(data.maps) && rowsOK(data.types);
    return kind === 'summary' && statsOK(data.overall) && ['races', 'types', 'maps', 'opponents'].every(k => rowsOK(data[k]));
  }
  function candidates(players, name) {
    const wanted = normalize(name), unique = new Map();
    if (!wanted) return [];
    for (const player of players || []) {
      if (!player || !idOK(player.eloId) || typeof player.name !== 'string') continue;
      if ([player.name, ...(Array.isArray(player.aliases) ? player.aliases : [])].some(n => normalize(n) === wanted)) unique.set(Number(player.eloId), player);
    }
    return [...unique.values()];
  }
  function createClient(options = {}) {
    const fetcher = options.fetch || ((...args) => global.fetch(...args));
    const storage = storageOf(options), now = options.now || Date.now;
    const ttl = options.ttl ?? REFRESH_INTERVAL;
    const timeouts = { summary: 100000, activity: 220000, rival: 35000, recent: 220000 };
    const site = String(options.site || 'starlog'), base = options.base || API;
    const memory = new Map(), pending = new Map(), failures = new Map(), attempts = new Map();
    const fresh = at => recentEnough(at, now(), ttl);
    function key(kind, playerId, opponentId) {
      return PREFIX + encodeURIComponent(site) + ':' + Number(playerId) + ':' + kind + (opponentId ? ':' + Number(opponentId) : '');
    }
    function attemptFor(cacheKey) {
      const memoryAttempt = attempts.get(cacheKey), storedAttempt = readJSON(storage, cacheKey + ':attempt');
      const valid = attempt => attempt && numberOK(attempt.at) && dateOK(attempt.day) && ['loading', 'success', 'failed'].includes(attempt.status);
      const latest = valid(storedAttempt) && (!valid(memoryAttempt) || storedAttempt.at >= memoryAttempt.at) ? storedAttempt : memoryAttempt;
      if (valid(latest)) { attempts.set(cacheKey, latest); return latest; }
      return null;
    }
    function recordAttempt(cacheKey, status) {
      const value = { day: kstDay(now()), at: now(), status };
      attempts.set(cacheKey, value); writeJSON(storage, cacheKey + ':attempt', value);
    }
    function peek(kind, playerId, opponentId) {
      const cacheKey = key(kind, playerId, opponentId);
      const memoryEntry = memory.get(cacheKey), storedEntry = readJSON(storage, cacheKey);
      const valid = entry => entry && entry.site === site && entry.kind === kind && Number(entry.playerId) === Number(playerId) &&
        Number(entry.opponentId || 0) === Number(opponentId || 0) && numberOK(entry.checkedAt) &&
        validPayload(kind, entry.data, playerId, opponentId);
      const entry = valid(storedEntry) && (!valid(memoryEntry) || storedEntry.checkedAt >= memoryEntry.checkedAt) ? storedEntry : memoryEntry;
      if (!valid(entry)) return null;
      memory.set(cacheKey, entry);
      const attempt = attemptFor(cacheKey), failedToday = fresh(attempt?.at) && attempt.status === 'failed';
      return { ...entry, cached: true, stale: Boolean(entry.data.stale) || !fresh(entry.checkedAt) || failedToday, error: failedToday };
    }
    function get(kind, playerId, opponentId, force = false) {
      if (!Object.hasOwn(timeouts, kind) || !idOK(playerId) ||
          (kind === 'rival' && (!idOK(opponentId) || Number(playerId) === Number(opponentId))) ||
          (kind === 'recent' && Number(playerId) !== 443)) return Promise.reject(new Error('조회할 선수를 확인해 주세요.'));
      const cacheKey = key(kind, playerId, opponentId);
      if (pending.has(cacheKey)) return pending.get(cacheKey);
      const previous = peek(kind, playerId, opponentId);
      if (!force && previous && fresh(previous.checkedAt)) return Promise.resolve(previous);
      const attempt = attemptFor(cacheKey), failed = failures.get(cacheKey);
      if (!force && attempt && attempt.status !== 'success' && fresh(attempt.at)) {
        return previous ? Promise.resolve({ ...previous, stale: true, error: true }) :
          Promise.reject(failed?.error || new Error('최근 12시간 이내 자동 확인을 시도했어요. 필요하면 다시 확인을 눌러 주세요.'));
      }
      recordAttempt(cacheKey, 'loading');
      const request = Promise.resolve().then(async () => {
        const controller = new AbortController();
        let timer;
        try {
          const params = new URLSearchParams({ playerId: String(Number(playerId)) });
          if (kind === 'rival') params.set('opponentId', String(Number(opponentId)));
          if (kind === 'recent') params.set('limit', '50');
          const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('조회 시간이 길어지고 있어요.')); }, options.timeout ?? timeouts[kind]);
          });
          const data = await Promise.race([deadline, (async () => {
            const response = await fetcher(base + '/' + kind + '?' + params, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) throw new Error('연동 전적을 잠시 확인하지 못했어요.');
            const body = await response.json();
            if (!validPayload(kind, body, playerId, opponentId)) throw new Error('선수 전적의 응답 형식을 확인하지 못했어요.');
            return body;
          })()]);
          const entry = { site, kind, playerId: Number(playerId), opponentId: Number(opponentId || 0), checkedAt: Math.min(now(), Date.parse(data.fetchedAt)), data };
          memory.set(cacheKey, entry); failures.delete(cacheKey); recordAttempt(cacheKey, data.stale ? 'failed' : 'success');
          writeJSON(storage, cacheKey, entry);
          return { ...entry, cached: false, stale: Boolean(data.stale) };
        } catch (error) {
          failures.set(cacheKey, { at: now(), error }); recordAttempt(cacheKey, 'failed');
          if (previous) return { ...previous, stale: true, error: true };
          throw error;
        } finally { clearTimeout(timer); pending.delete(cacheKey); }
      });
      pending.set(cacheKey, request);
      return request;
    }
    return { get, peek };
  }
  function createDirectory(options = {}) {
    const fetcher = options.fetch || ((...args) => global.fetch(...args)), storage = storageOf(options), now = options.now || Date.now;
    const cacheKey = PREFIX + 'directory', attemptKey = cacheKey + ':attempt', ttl = options.ttl ?? REFRESH_INTERVAL;
    let pending = null, snapshot = null, checkedAt = 0, attempted = null;
    function get(force = false) {
      if (pending) return pending;
      const savedSnapshot = readJSON(storage, cacheKey);
      if (savedSnapshot && Array.isArray(savedSnapshot.players) && savedSnapshot.players.length &&
          numberOK(savedSnapshot.checkedAt) && (!snapshot || savedSnapshot.checkedAt >= checkedAt)) {
        snapshot = { players: savedSnapshot.players, stale: Boolean(savedSnapshot.stale) }; checkedAt = savedSnapshot.checkedAt;
      }
      const savedAttempt = readJSON(storage, attemptKey);
      if (savedAttempt && numberOK(savedAttempt.at) && dateOK(savedAttempt.day) &&
          (!attempted || savedAttempt.at >= attempted.at)) attempted = savedAttempt;
      const fresh = recentEnough(checkedAt, now(), ttl);
      if (!force && snapshot && fresh) return Promise.resolve({ ...snapshot,
        stale: snapshot.stale || (recentEnough(attempted?.at, now(), ttl) && attempted.status === 'failed') });
      if (!force && attempted?.status !== 'success' && recentEnough(attempted?.at, now(), ttl)) {
        const fallback = snapshot || readJSON(storage, 'starlog-player-directory-v1');
        if (Array.isArray(fallback?.players) && fallback.players.length) return Promise.resolve({ players: fallback.players, stale: true });
        return Promise.reject(new Error('최근 선수 목록을 확인하지 못했어요. 다시 확인을 눌러 주세요.'));
      }
      attempted = { day: kstDay(now()), at: now(), status: 'loading' }; writeJSON(storage, attemptKey, attempted);
      pending = Promise.resolve().then(async () => {
        const saved = readJSON(storage, 'starlog-player-directory-v1');
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeout ?? 12000);
        try {
          const response = await fetcher(DIRECTORY, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('directory');
          const data = await response.json();
          if (!Array.isArray(data.players) || !data.players.length) throw new Error('directory');
          snapshot = { players: data.players, stale: false }; checkedAt = now();
          attempted = { day: kstDay(now()), at: now(), status: 'success' }; writeJSON(storage, attemptKey, attempted);
          writeJSON(storage, cacheKey, { ...snapshot, checkedAt });
          return snapshot;
        } catch {
          attempted = { day: kstDay(now()), at: now(), status: 'failed' }; writeJSON(storage, attemptKey, attempted);
          const fallback = snapshot || saved;
          if (Array.isArray(fallback?.players) && fallback.players.length) {
            snapshot = { players: fallback.players, stale: true };
            return snapshot;
          }
          throw new Error('선수 목록을 불러오지 못했어요. 필요하면 다시 확인을 눌러 주세요.');
        } finally { clearTimeout(timer); pending = null; }
      });
      return pending;
    }
    return { get };
  }
  function sourceURL(value, fallback) {
    try { const url = new URL(value); if (url.protocol === 'https:' && ['eloboard.com', 'eloboard.co.kr'].includes(url.hostname)) return url.href; } catch {}
    return fallback;
  }
  function checkedText(result) {
    if (!result?.data?.fetchedAt) return '';
    return new Date(result.data.fetchedAt).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) + ' 확인' + (result.stale ? ' · 마지막 확인 자료' : '');
  }
  function localStats(rows) {
    const wins = rows.filter(row => row.result === 'W').length, games = rows.length;
    return { wins, losses: games - wins, games, winRate: games ? Math.round(wins / games * 1000) / 10 : 0 };
  }
  function localGroups(matches, key) {
    const groups = new Map();
    for (const match of matches) {
      const value = key === 'month' ? String(match.date).slice(0, 7) : String(match[key] || '미입력');
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(match);
    }
    if (key === 'race') for (const race of ['T', 'Z', 'P', 'R']) if (!groups.has(race)) groups.set(race, []);
    return [...groups].map(([value, rows]) => ({ key: value, label: key === 'race' ? RACES[value] || value : value, ...localStats(rows) }))
      .sort((a, b) => key === 'month' ? b.key.localeCompare(a.key) : b.games - a.games);
  }

  // Only manually entered ladder games are additive to EloBoard aggregates.
  // Manual sponsored/CK records can already exist upstream and are not added twice.
  function ladderOnly(matches) {
    return matches.filter(row => row.type === '래더' && row.source !== 'eloboard' && !row.eloRecordId && !row.eloMatchId);
  }
  function addStats(base, addition) {
    if (!statsOK(base) || base.complete === false) return null;
    const wins = base.wins + addition.wins, losses = base.losses + addition.losses, games = wins + losses;
    return { ...base, wins, losses, games, winRate: games ? Math.round(wins * 1000 / games) / 10 : 0, ladder: addition };
  }
  function opponentMatch(row, opponent, directory = []) {
    const found = candidates(directory, row.opponent);
    if (found.length) return found.length === 1 && Number(found[0].eloId) === Number(opponent.eloId || opponent.id);
    return normalize(row.opponent) === normalize(opponent.name);
  }
  function combineGroups(remoteRows, ladder, key, directory = [], available = true) {
    const remote = remoteRows.map(row => ({ ...row, label: key === 'race' ? RACES[row.race] || row.label : row.label || row.name || row.month || row.key }));
    const groupKey = row => key === 'opponent' && idOK(row.id) ? 'id:' + Number(row.id) : normalize(row.label);
    const groups = new Map(remote.map(row => [groupKey(row), row]));
    for (const local of localGroups(ladder, key).filter(row => row.games)) {
      let id = null;
      if (key === 'opponent') {
        const found = candidates(directory, local.label);
        if (found.length === 1) id = Number(found[0].eloId);
        else if (!found.length) {
          const exact = remote.filter(row => normalize(row.label) === normalize(local.label));
          if (exact.length === 1 && idOK(exact[0].id)) id = Number(exact[0].id);
        }
      }
      const target = id ? 'id:' + id : normalize(local.label), prior = groups.get(target);
      const extra = localStats([]);
      for (const field of ['wins', 'losses', 'games']) extra[field] = (prior?.ladder?.[field] || 0) + local[field];
      extra.winRate = extra.games ? Math.round(extra.wins * 1000 / extra.games) / 10 : 0;
      if (prior && statsOK(prior) && prior.complete !== false) {
        const combined = addStats(prior, local);
        groups.set(target, { ...combined, ladder: extra });
      } else if (prior) groups.set(target, { ...prior, ladder: extra });
      else if (!available || key === 'opponent' || key === 'month') {
        // Rival lists are bounded, and a missing month is not proof of no games.
        groups.set(target, { ...local, ...(id ? { id } : {}), complete: false,
          wins: null, losses: null, games: null, winRate: null, ladder: extra });
      } else groups.set(target, { ...local, ladder: extra });
    }
    return [...groups.values()].sort((a, b) => key === 'month' ? b.label.localeCompare(a.label) :
      (b.games ?? b.ladder?.games ?? 0) - (a.games ?? a.ladder?.games ?? 0));
  }
  function sequenceOK(rows, asOfDate) {
    return Array.isArray(rows) && rows.length <= 50 && rows.every((row, i) => row && idOK(row.id) &&
      dateOK(row.date) && row.date <= asOfDate && ['W', 'L'].includes(row.result) && (!i || row.date <= rows[i - 1].date)) &&
      new Set(rows.map(row => Number(row.id))).size === rows.length;
  }
  function combinedStreak(activity, ladder) {
    if (!ladder.length) return activity?.streak || { result: null, count: 0, complete: false };
    if (!activity || !sequenceOK(activity.recentResults, activity.asOfDate)) return { result: null, count: 0, complete: false, ambiguous: true };
    const official = activity.recentResults;
    const full = activity.coverage?.allMatches === true;
    const boundary = official.at(-1)?.date;
    if (!full && !boundary) return { result: null, count: 0, complete: false };
    const locals = ladder.filter(row => full || row.date >= boundary).slice()
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.created || 0) - Number(a.created || 0));
    const days = [...new Set([...official, ...locals].map(row => row.date))].sort().reverse();
    let result = null, count = 0;
    for (const day of days) {
      const a = official.filter(row => row.date === day), b = locals.filter(row => row.date === day);
      // The source exposes dates, not times. Do not guess an interleaving on a mixed day.
      if (a.length && b.length && new Set([...a, ...b].map(row => row.result)).size > 1)
        return { result, count, complete: false, ambiguous: true };
      for (const row of [...a, ...b]) {
        if (!result) result = row.result;
        if (row.result !== result) return { result, count, complete: true };
        count++;
      }
    }
    return { result, count, complete: full };
  }

  function metric(key, title, value, sub, icon) {
    return '<div class="metric" data-elo-metric="' + key + '"><span class="metric-icon">' + icon +
      '</span><div class="metric-title">' + title + '</div><strong>' + value + '</strong><small>' + escape(sub) + '</small></div>';
  }
  function recordText(value) {
    return formatNumber(value.wins) + '<small>승</small> ' + formatNumber(value.losses) + '<small>패</small>';
  }
  function rowTable(rows, { search = false, empty = '표시할 전적이 없어요.' } = {}) {
    if (!rows.length) return '<p class="stat-note elo-empty">' + escape(empty) + '</p>';
    return '<div class="table-wrap"><table><thead><tr><th>구분</th><th>경기 수</th><th>승</th><th>패</th><th>승률</th><th>승률 그래프</th></tr></thead><tbody>' +
      rows.map(row => {
        const known = row.complete !== false && statsOK(row);
        const label = escape(row.label || row.name || row.month || row.key || '미입력');
        const ladderHint = row.ladder?.games ? '<small style="display:block;font-size:12px;opacity:.85">래더 ' + formatNumber(row.ladder.games) + '판 · ' + row.ladder.wins + '승 ' + row.ladder.losses + '패' + (known ? ' 포함' : ' 확인 · 연동 합계 미확인') + '</small>' : '';
        return '<tr><td>' + (search && idOK(row.id) ? '<button type="button" class="icon-btn" data-elo-opponent="' + Number(row.id) + '">' + label + '</button>' : label) + ladderHint +
          '</td><td>' + (known ? formatNumber(row.games) + '판' : '—') + '</td><td>' + (known ? formatNumber(row.wins) : '—') +
          '</td><td>' + (known ? formatNumber(row.losses) : '—') + '</td><td>' + (known ? rate(row) : '확인 범위 부족') +
          '</td><td>' + (known ? '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(0, Math.min(100, row.winRate)) + '%"></div></div>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function choicesHTML(rows, action) {
    return '<p class="stat-note">같은 이름이나 별명으로 여러 선수가 있어요. 선수를 선택해 주세요.</p><div class="elo-choices">' +
      rows.map(row => '<button type="button" class="btn small" data-elo-choice="' + action + '" data-player-id="' + Number(row.eloId) + '">' +
        escape(row.name) + ' · ' + escape(RACES[row.race] || row.race || '종족 미등록') + ' · ' + escape(row.tierLabel || row.tier || '티어 미등록') +
        ' <small>#' + Number(row.eloId) + '</small></button>').join('') + '</div>';
  }
  const directoryClient = createDirectory(), clients = new Map(), preferences = new Map(), views = new Set();
  let nextMount = 0;
  function clientFor(site) {
    if (!clients.has(site)) clients.set(site, createClient({ site }));
    return clients.get(site);
  }
  function attachView(host, autoRefresh) {
    const generation = ++nextMount;
    host.dataset.eloMount = String(generation);
    let destroyed = false;
    const alive = () => !destroyed && host.isConnected && host.dataset.eloMount === String(generation);
    const view = { alive, refresh: autoRefresh, visible: () => host.getClientRects().length > 0 };
    for (const old of views) if (!old.alive()) views.delete(old);
    views.add(view);
    return { alive, destroy() { destroyed = true; views.delete(view); } };
  }
  if (global.document) {
    const refreshVisible = () => {
      if (global.document.visibilityState !== 'visible') return;
      for (const view of views) {
        if (!view.alive()) views.delete(view);
        else if (view.visible()) view.refresh();
      }
    };
    global.addEventListener('focus', refreshVisible);
    global.document.addEventListener('visibilitychange', refreshVisible);
    const clock = global.setInterval?.(refreshVisible, 60_000);
    clock?.unref?.();
  }
  function mountStatistics(host, options = {}) {
    if (!host) return { refresh() {}, destroy() {} };
    host.__eloController?.destroy();
    const site = String(options.site || 'starlog'), name = String(options.name || '').trim(), client = clientFor(site);
    const matches = (Array.isArray(options.matches) ? options.matches : []).filter(row => row && ['W', 'L'].includes(row.result) && dateOK(row.date));
    const ladder = ladderOnly(matches);
    const preferenceKey = site + '|' + normalize(name) + '|' + String(options.race || '');
    const preference = preferences.get(preferenceKey) || { tab: 'race' };
    preferences.set(preferenceKey, preference);
    let owner = null, directory = null, ownerChoices = [], opponentChoices = [], unavailable = false, identityMessage = '';
    const states = { summary: { result: null, loading: false, error: '' }, activity: { result: null, loading: false, error: '' } };
    const tickets = { summary: 0, activity: 0, owner: 0, rival: 0 };
    let rival = null, rivalState = null, rivalMessage = '', query = '', localQuery = '';
    const binding = attachView(host, () => refresh(false)), alive = binding.alive;
    const $ = selector => host.querySelector(selector);
    const activeSource = () => (name || options.fixedId) && !unavailable ? 'elo' : 'local';
    host.classList.add('elo-statistics');
    host.innerHTML = '<div class="section-top"><h2>나의 통계 ✧</h2><span class="date-label">' + kstDay().replaceAll('-', '.') + ' 기준</span></div><div class="elo-stat-source"><span data-elo-combined-label>연동 전적 + 직접 기록한 래더</span>' +
      '<button type="button" class="btn small" data-elo-refresh title="저장된 전적을 다시 확인해요. 원본 갱신은 12시간 간격이에요">↻ 다시 확인</button>' +
      '<span class="date-label">12시간 간격 자동 확인</span></div><p class="stat-note elo-sync-status" data-elo-status role="status" aria-live="polite"></p>' +
      '<div data-elo-owner></div><div class="metrics" data-elo-metrics></div>' +
      '<div class="section-top"><h2>상세 전적</h2><span class="date-label" data-elo-detail-status></span></div>' +
      '<div class="segmented" role="group" aria-label="상세 전적 구분">' + TABS.map(([key, label]) =>
        '<button type="button" data-elo-tab="' + key + '">' + label + '</button>').join('') +
      '</div><div class="panel elo-stat-panel" data-elo-detail><div data-elo-search></div><div data-elo-table></div></div>' +
      '<p class="stat-note" data-elo-footnote></p>';
    function renderStatus() {
      if (!alive()) return;
      const remote = activeSource() === 'elo';
      $('[data-elo-combined-label]').textContent = remote ? '연동 전적 + 직접 기록한 래더 ' + ladder.length + '판' : '직접 기록 전체 · 래더 포함';
      let text = identityMessage;
      if (!text && remote) {
        const parts = [['summary', '통산'], ['activity', '기간']].map(([key, label]) => {
          const state = states[key];
          return state.result ? label + ' ' + checkedText(state.result) : state.loading ? label + ' 전적 확인 중' : state.error ? label + ' 전적 확인 실패' : '';
        }).filter(Boolean);
        text = (owner ? owner.name + ' · ' : '') + parts.join(' · ');
      }
      if (!text && !remote) text = '직접 작성한 스폰·래더·연습 기록만 집계해요.';
      if (remote && (states.summary.error || states.activity.error)) text += ' · 필요하면 다시 확인을 눌러 주세요.';
      $('[data-elo-status]').textContent = text;
      $('[data-elo-status]').classList.toggle('is-stale', remote && Object.values(states).some(state => state.error || state.result?.stale));
      $('[data-elo-refresh]').disabled = states.summary.loading || states.activity.loading;
    }
    function renderMetrics() {
      if (!alive()) return;
      const date = kstDay(), month = date.slice(0, 7);
      let todayStats, monthStats, total, streak = { result: null, count: 0, complete: false }, todayNote, monthNote, totalNote;
      if (activeSource() === 'local') {
        todayStats = localStats(matches.filter(row => row.date === date)); monthStats = localStats(matches.filter(row => row.date.startsWith(month))); total = localStats(matches);
        const sorted = matches.slice().sort((a, b) => b.date.localeCompare(a.date) || Number(b.created || 0) - Number(a.created || 0));
        streak = { result: sorted[0]?.result || null, count: 0, complete: true };
        for (const row of sorted) { if (row.result !== streak.result) break; streak.count++; }
        todayNote = '직접 기록 · ' + date; monthNote = formatNumber(monthStats.games) + '경기 · ' + monthStats.wins + '승 ' + monthStats.losses + '패';
        totalNote = total.wins + '승 ' + total.losses + '패 · 직접 기록';
      } else {
        const activity = states.activity.result?.data;
        if (activity?.today.complete && activity.today.date === date) todayStats = addStats(activity.today, localStats(ladder.filter(row => row.date === date)));
        if (activity?.currentMonth.complete && activity.currentMonth.month === month) monthStats = addStats(activity.currentMonth, localStats(ladder.filter(row => row.date.startsWith(month))));
        total = addStats(states.summary.result?.data.overall, localStats(ladder));
        streak = combinedStreak(activity, ladder);
        todayNote = todayStats ? date + ' · 래더 포함' : states.activity.loading ? '전적 확인 중' : '오늘 전체 범위 확인 불가';
        monthNote = monthStats ? formatNumber(monthStats.games) + '경기 · ' + monthStats.wins + '승 ' + monthStats.losses + '패' :
          states.activity.loading ? '전적 확인 중' : '이번 달 전체 범위 확인 불가';
        totalNote = total ? total.wins + '승 ' + total.losses + '패 · 래더 ' + ladder.length + '판 포함' : states.summary.loading ? '전적 확인 중' : '통산 전적 확인 불가';
      }
      if (activeSource() === 'elo') {
        if (!todayStats) todayNote += ' · 래더 ' + localStats(ladder.filter(row => row.date === date)).games + '판 확인';
        if (!monthStats) monthNote += ' · 래더 ' + localStats(ladder.filter(row => row.date.startsWith(month))).games + '판 확인';
        if (!total) totalNote += ' · 래더 ' + ladder.length + '판 확인';
      }
      const streakValue = streak.count && streak.result ? (streak.complete ? '' : '<small>최소 </small>') + formatNumber(streak.count) +
        '<small>' + (streak.result === 'W' ? '연승' : '연패') + '</small>' : streak.complete ? '0<small>경기</small>' : '—';
      $('[data-elo-metrics]').innerHTML =
        metric('today', '오늘의 전적', todayStats ? recordText(todayStats) : '—', todayNote, '🎮') +
        metric('month', '이번 달 승률', monthStats ? rate(monthStats) : '—', monthNote, '🌷') +
        metric('streak', '현재 연속 기록', streakValue, streak.ambiguous ? '같은 날 경기 순서 미확인 · 래더 포함' : streak.complete ? '최근 확인된 경기부터 집계 · 래더 포함' : '확인된 경기 범위 기준 · 래더 포함', '✨') +
        metric('overall', '전체 경기', total ? formatNumber(total.games) + '<small>판</small>' : '—', totalNote, '📖');
    }
    function fillNames() {
      const list = $('datalist');
      if (!list || !directory) return;
      list.innerHTML = [...new Set(directory.players.filter(row => idOK(row?.eloId)).map(row => row.name).filter(Boolean))]
        .map(value => '<option value="' + escape(value) + '"></option>').join('');
    }
    async function getDirectory(force = false) {
      directory = await directoryClient.get(force);
      if (alive()) fillNames();
      return directory;
    }
    function renderRival() {
      const resultNode = $('[data-elo-rival-result]'), status = $('[data-elo-rival-status]');
      if (!resultNode || !status) return;
      if (activeSource() !== 'elo') { resultNode.innerHTML = ''; status.textContent = localQuery ? '직접 기록에서 검색한 상대 전적이에요.' : '직접 기록에 저장된 상대 이름을 검색해요.'; return; }
      status.textContent = rivalState ? checkedText(rivalState) : rivalMessage || '상대 이름을 검색하면 전체 기간 맞대결을 확인해요.';
      status.classList.toggle('is-stale', Boolean(rivalState?.stale));
      if (!rivalState) {
        const localRows = ladder.filter(row => rival ? opponentMatch(row, rival, directory?.players) : normalize(row.opponent) === normalize(query));
        const local = localStats(localRows);
        resultNode.innerHTML = local.games ? '<div class="elo-rival-summary">직접 래더 ' + local.games + '경기 · ' + local.wins + '승 ' + local.losses + '패 · 연동 맞대결 합계 미확인</div>' : '';
        return;
      }
      const data = rivalState.data, opponentLadder = ladder.filter(row => opponentMatch(row, data.opponent, directory?.players));
      const h = addStats(data.headToHead, localStats(opponentLadder));
      resultNode.innerHTML = '<div class="elo-rival-summary"><b>' + escape(data.player.name) + ' vs ' + escape(data.opponent.name) +
        '</b><span>' + formatNumber(h.games) + '경기 · ' + formatNumber(h.wins) + '승 ' + formatNumber(h.losses) + '패 · ' + rate(h) +
        '</span><small>' + escape('연동 ' + [h.from, h.to].filter(Boolean).join(' ~ ') + ' · 직접 래더 ' + opponentLadder.length + '판 포함') + '</small></div>' +
        ((data.maps.length || data.types.length || opponentLadder.length) ? '<details class="elo-rival-details"><summary>맞대결 맵·유형별 전적</summary>' +
          rowTable(combineGroups(data.maps, opponentLadder, 'map', directory?.players)) +
          rowTable(combineGroups(data.types, opponentLadder, 'type', directory?.players)) + '</details>' : '');
    }
    function ensureSearch() {
      const target = $('[data-elo-search]');
      if (preference.tab !== 'opponent') { target.innerHTML = ''; return; }
      if (!$('[data-elo-form]')) {
        target.innerHTML = '<form class="elo-rival-form" data-elo-form><label>상대 선수 이름<input name="opponent" maxlength="40" required autocomplete="off" ' +
          'placeholder="상대 이름 또는 등록된 별명" list="elo-names-' + host.dataset.eloMount + '" value="' + escape(query) + '"></label>' +
          '<button class="btn small" type="submit">상대 검색</button></form><datalist id="elo-names-' + host.dataset.eloMount + '"></datalist>' +
          '<p class="stat-note elo-sync-status" data-elo-rival-status role="status" aria-live="polite"></p><div data-elo-choices></div><div data-elo-rival-result></div>';
        $('[data-elo-form]').addEventListener('submit', searchRival);
        $('[name="opponent"]').addEventListener('input', event => { query = event.target.value; });
      }
      fillNames(); renderRival();
    }
    function renderDetail() {
      if (!alive()) return;
      const key = preference.tab, local = activeSource() === 'local' || key === 'build';
      host.querySelectorAll('[data-elo-tab]').forEach(button => {
        const active = button.dataset.eloTab === key;
        button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
      });
      ensureSearch();
      let rows = [], message = '', caption = '', note = '';
      if (local) {
        rows = localGroups(matches, key);
        if (key === 'opponent' && localQuery) rows = rows.filter(row => normalize(row.label).includes(localQuery));
        caption = '직접 기록 · 래더 포함';
        note = key === 'build' ? '빌드별 전적은 직접 작성한 기록의 빌드를 기준으로 집계해요.' :
          '승률은 직접 기록의 승리 ÷ 전체 경기로 계산해요. 연동 전적과 중복 합산하지 않아요.';
        message = '직접 기록한 경기가 없어요.';
      } else if (key === 'month') {
        rows = combineGroups((states.activity.result?.data.months || []).map(row => ({ ...row, label: row.month })), ladder, 'month', directory?.players, Boolean(states.activity.result));
        caption = '연동 전적 + 래더 · 확인된 월별 범위';
        message = states.activity.loading ? '월별 전적을 확인하고 있어요…' : '월별 전적을 확인하지 못했어요.';
        note = '해당 달 전체를 확인한 경우에만 월 전체 전적을 표시해요. 확인 범위가 부족한 달은 —로 표시해요.';
      } else {
        const summary = states.summary.result?.data;
        rows = summary?.[{ opponent: 'opponents', map: 'maps', race: 'races', type: 'types' }[key]] || [];
        rows = combineGroups(rows, ladder, key, directory?.players, Boolean(summary));
        caption = '연동 전적 + 직접 기록한 래더';
        message = states.summary.loading ? '전적을 확인하고 있어요…' : '연동 전적을 확인하지 못했어요.';
        note = key === 'opponent' ? '현재 조회된 상대 목록이에요. 목록에 없는 선수도 위에서 이름으로 검색할 수 있어요.' :
          '원본에서 분류된 경기의 전적이에요. 분류별 합계가 통산 경기 수와 다를 수 있어요.';
      }
      $('[data-elo-detail-status]').textContent = caption;
      $('[data-elo-table]').innerHTML = rowTable(rows, { search: !local && key === 'opponent', empty: message });
      $('[data-elo-footnote]').textContent = note + (activeSource() === 'elo' && key !== 'build' ? ' 직접 기록한 래더는 함께 합산하며, 수동 스폰·CK 등은 중복 방지를 위해 다시 더하지 않아요.' : '');
    }
    function renderAll() { renderStatus(); renderMetrics(); renderDetail(); }
    async function load(kind, force = false) {
      if (!owner || !alive()) return;
      const id = owner.eloId, ticket = ++tickets[kind], state = states[kind];
      state.result = client.peek(kind, id) || state.result; state.loading = true; state.error = ''; renderAll();
      try {
        const result = await client.get(kind, id, null, force);
        if (!alive() || ticket !== tickets[kind] || owner.eloId !== id) return;
        state.result = result; state.error = result.error ? '조회 지연' : '';
      } catch (error) {
        if (!alive() || ticket !== tickets[kind]) return;
        state.error = error.message;
      } finally {
        if (alive() && ticket === tickets[kind]) { state.loading = false; renderAll(); }
      }
    }
    async function lookupRival(opponent, force = false) {
      if (!owner || !alive()) return;
      const id = Number(opponent.eloId || opponent.id), ownerId = owner.eloId, ticket = ++tickets.rival;
      if (!idOK(id) || id === ownerId) { rivalMessage = '기준 선수와 다른 상대를 선택해 주세요.'; rivalState = null; renderRival(); return; }
      rival = { ...opponent, eloId: id }; query = opponent.name;
      if ($('[name="opponent"]')) $('[name="opponent"]').value = query;
      $('[data-elo-choices]')?.replaceChildren();
      rivalState = client.peek('rival', ownerId, id); rivalMessage = '상대 전적을 확인하고 있어요…'; renderRival();
      try {
        const result = await client.get('rival', ownerId, id, force);
        if (!alive() || ticket !== tickets.rival || owner.eloId !== ownerId) return;
        rivalState = result; rivalMessage = '';
      } catch (error) {
        if (!alive() || ticket !== tickets.rival) return;
        rivalMessage = error.message;
      } finally { if (alive() && ticket === tickets.rival) renderRival(); }
    }
    async function searchRival(event) {
      event.preventDefault();
      query = String($('[name="opponent"]')?.value || '').trim();
      if (!query || query.length > 40) return;
      const ticket = ++tickets.rival;
      rival = null; rivalState = null; $('[data-elo-choices]')?.replaceChildren();
      if (activeSource() === 'local') { localQuery = normalize(query); renderDetail(); return; }
      localQuery = ''; rivalMessage = '상대 선수를 확인하고 있어요…'; renderRival();
      try {
        await getDirectory();
        if (!alive() || ticket !== tickets.rival) return;
        opponentChoices = candidates(directory.players, query);
        if (opponentChoices.length === 1) { lookupRival(opponentChoices[0]); return; }
        rivalMessage = opponentChoices.length ? '조회할 상대 선수를 선택해 주세요.' : '등록된 선수 이름이나 별명을 찾지 못했어요.';
        if (opponentChoices.length && $('[data-elo-choices]')) $('[data-elo-choices]').innerHTML = choicesHTML(opponentChoices, 'opponent');
      } catch (error) { if (alive() && ticket === tickets.rival) rivalMessage = error.message; }
      renderRival();
    }
    function useOwner(player, force = false) {
      owner = { ...player, eloId: Number(player.eloId) }; unavailable = false; identityMessage = '';
      $('[data-elo-owner]').replaceChildren();
      load('summary', force); load('activity', force);
      if (!directory) getDirectory(force).then(() => { if (alive()) renderAll(); }).catch(() => {});
    }
    async function identify(force = false) {
      const ticket = ++tickets.owner;
      if (Number(options.fixedId) === 443) { useOwner({ eloId: 443, name: '최도랑', race: 'P' }, force); return; }
      if (!name) { unavailable = true; identityMessage = '프로필에 선수 이름을 등록하면 연동 전적도 확인할 수 있어요. 지금은 직접 기록을 표시해요.'; renderAll(); return; }
      identityMessage = '등록한 선수 정보를 확인하고 있어요…'; renderStatus();
      try {
        await getDirectory(force);
        if (!alive() || ticket !== tickets.owner) return;
        ownerChoices = candidates(directory.players, name);
        if (ownerChoices.length === 1) { useOwner(ownerChoices[0], force); return; }
        unavailable = !ownerChoices.length;
        identityMessage = ownerChoices.length ? '전적을 확인할 선수를 선택해 주세요.' :
          '등록된 이름을 찾지 못해 직접 기록을 표시해요. 선수 이름을 확인하거나 다시 확인을 눌러 주세요.';
        $('[data-elo-owner]').innerHTML = ownerChoices.length ? choicesHTML(ownerChoices, 'owner') : '';
      } catch (error) {
        if (!alive() || ticket !== tickets.owner) return;
        unavailable = true; identityMessage = error.message + ' 직접 기록은 계속 볼 수 있어요.';
      }
      renderAll();
    }
    function refresh(force = true) {
      if (!alive()) return;
      if (!owner) { identify(force); return; }
      if (force) getDirectory(true).catch(() => {});
      load('summary', force); load('activity', force);
      if (rival && activeSource() === 'elo' && normalize(query) === normalize(rival.name)) lookupRival(rival, force);
    }
    const onClick = event => {
      const button = event.target.closest('button');
      if (!button || !host.contains(button)) return;
      if (button.hasAttribute('data-elo-refresh')) refresh(true);
      if (button.dataset.eloTab) { preference.tab = button.dataset.eloTab; renderDetail(); }
      if (button.dataset.eloChoice) {
        const list = button.dataset.eloChoice === 'owner' ? ownerChoices : opponentChoices;
        const player = list.find(row => Number(row.eloId) === Number(button.dataset.playerId));
        if (player) button.dataset.eloChoice === 'owner' ? useOwner(player) : lookupRival(player);
      }
      if (button.dataset.eloOpponent) {
        const row = states.summary.result?.data.opponents.find(item => Number(item.id) === Number(button.dataset.eloOpponent));
        if (row) lookupRival(row);
      }
    };
    host.addEventListener('click', onClick);
    const controller = { refresh, destroy() { binding.destroy(); host.removeEventListener('click', onClick); for (const key of Object.keys(tickets)) tickets[key]++; } };
    host.__eloController = controller;
    renderAll(); identify();
    return controller;
  }
  function mountRecent(host, options = {}) {
    if (!host) return { refresh() {}, destroy() {} };
    host.__eloController?.destroy();
    const client = clientFor(String(options.site || 'starlog'));
    let result = null, loading = false, error = '', ticket = 0;
    const binding = attachView(host, () => refresh(false)), alive = binding.alive;
    host.classList.add('elo-recent-control');
    host.innerHTML = '<p class="stat-note elo-sync-status" data-elo-recent-status role="status" aria-live="polite"></p>' +
      '<button type="button" class="btn small" data-elo-refresh title="저장된 전적을 다시 확인해요. 원본 갱신은 12시간 간격이에요">↻ 다시 확인</button>';
    const status = host.querySelector('[data-elo-recent-status]'), button = host.querySelector('[data-elo-refresh]');
    function emit() {
      if (!alive()) return;
      const data = result?.data;
      status.textContent = (data ? '최도랑 연동 최근 ' + data.matches.length + '경기 · ' + checkedText(result) :
        loading ? '최도랑 최근 50경기를 확인하고 있어요…' : error || '최근 경기 정보가 없어요.') +
        (data?.warning ? ' · ' + data.warning : '') + ' · 12시간 간격 자동 확인';
      status.classList.toggle('is-stale', Boolean(error || result?.stale));
      button.disabled = loading;
      const snapshot = { matches: data?.matches || [], fetchedAt: data?.fetchedAt || '', complete: data?.complete ?? null,
        warning: data?.warning || '', stale: Boolean(result?.stale), loading, error };
      Promise.resolve().then(() => { if (alive()) options.onData?.(snapshot); });
    }
    async function refresh(force = true) {
      if (!alive()) return;
      if (Number(options.fixedId) !== 443) { error = '최근 경기 목록은 최도랑 기준으로만 확인해요.'; emit(); return; }
      const current = ++ticket;
      result = client.peek('recent', 443) || result; loading = true; error = ''; emit();
      try {
        const next = await client.get('recent', 443, null, force);
        if (!alive() || current !== ticket) return;
        result = next; error = next.error ? '최근 경기 갱신을 확인하지 못했어요.' : '';
      } catch (failure) { if (alive() && current === ticket) error = failure.message; }
      finally { if (alive() && current === ticket) { loading = false; emit(); } }
    }
    const click = () => refresh(true);
    button.addEventListener('click', click);
    const controller = { refresh, destroy() { binding.destroy(); ticket++; button.removeEventListener('click', click); } };
    host.__eloController = controller; refresh(false);
    return controller;
  }
  return { mountStatistics, mountRecent, createClient, createDirectory, candidates, validPayload, escape, kstDay, REFRESH_INTERVAL, addStats, combineGroups, ladderOnly, combinedStreak, opponentMatch };
});
