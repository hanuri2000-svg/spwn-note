/* Public EloBoard views. This module never writes journal matches or settings. */
(function (global, factory) {
  const api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.StarlogElo = api;
})(typeof window === 'object' ? window : globalThis, function (global) {
  'use strict';
  const API = 'https://spawn-note-elo-relay.hajimayo8130.workers.dev/api/elo/public';
  const DIRECTORY = 'https://hanuri2000-svg.github.io/star-match-manager/players.json';
  const PREFIX = 'starlog-public-elo:v1:';
  const RACES = { P: '프로토스', T: '테란', Z: '저그', R: '랜덤' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const idOK = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const numberOK = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const statsOK = value => value && ['wins', 'losses', 'games', 'winRate'].every(k => numberOK(value[k])) && value.winRate <= 100 && value.wins + value.losses === value.games;
  const playerOK = (player, id) => player && Number(player.id) === Number(id) && typeof player.name === 'string' && player.name.trim().length > 0;
  const rowsOK = rows => Array.isArray(rows) && rows.every(statsOK);
  const formatNumber = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  const rate = value => value.games ? formatNumber(value.winRate) + '%' : '—';
  function storageOf(options) {
    if ('storage' in options) return options.storage;
    try { return global.localStorage; } catch { return null; }
  }
  function validPayload(kind, data, playerId, opponentId) {
    if (!data || data.schemaVersion !== 1 || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))) return false;
    if (kind === 'recent') return Number(playerId) === 443 && Number(data.playerId) === 443 &&
      typeof data.complete === 'boolean' && Array.isArray(data.matches) && data.matches.length <= 50 &&
      data.matches.every(m => m && idOK(m.id) && /^\d{4}-\d{2}-\d{2}$/.test(m.date) && typeof m.opponent === 'string' &&
        idOK(m.opponentId) && Number(m.opponentId) !== 443 && ['W', 'L'].includes(m.result)) &&
      new Set(data.matches.map(m => String(m.id))).size === data.matches.length;
    if (!playerOK(data.player, playerId)) return false;
    if (kind === 'rival') return playerOK(data.opponent, opponentId) && statsOK(data.headToHead) && rowsOK(data.maps) && rowsOK(data.types);
    return kind === 'summary' && statsOK(data.overall) && ['races', 'types', 'maps', 'opponents'].every(k => rowsOK(data[k]));
  }
  function candidates(players, name) {
    const wanted = normalize(name), unique = new Map();
    if (!wanted) return [];
    for (const player of players || []) {
      if (!player || !idOK(player.eloId) || typeof player.name !== 'string') continue;
      const names = [player.name, ...(Array.isArray(player.aliases) ? player.aliases : [])];
      if (names.some(n => normalize(n) === wanted)) unique.set(Number(player.eloId), player);
    }
    return [...unique.values()];
  }
  function createClient(options = {}) {
    const fetcher = options.fetch || ((...args) => global.fetch(...args));
    const storage = storageOf(options), now = options.now || Date.now;
    const ttl = options.ttl ?? 5 * 60 * 1000;
    // Each route has its own loading region. Give the bounded server fetches
    // time to finish without making a slow recent list block the summary.
    const timeouts = { summary: 100000, rival: 35000, recent: 220000 };
    const site = String(options.site || 'starlog'), base = options.base || API;
    const memory = new Map(), pending = new Map(), failures = new Map();
    function key(kind, playerId, opponentId) {
      return PREFIX + encodeURIComponent(site) + ':' + Number(playerId) + ':' + kind + (opponentId ? ':' + Number(opponentId) : '');
    }
    function peek(kind, playerId, opponentId) {
      const cacheKey = key(kind, playerId, opponentId);
      let entry = memory.get(cacheKey);
      if (!entry) {
        try { entry = JSON.parse(storage?.getItem(cacheKey) || 'null'); } catch {}
      }
      if (!entry || entry.site !== site || entry.kind !== kind || Number(entry.playerId) !== Number(playerId) ||
          Number(entry.opponentId || 0) !== Number(opponentId || 0) || !numberOK(entry.checkedAt) ||
          !validPayload(kind, entry.data, playerId, opponentId)) return null;
      memory.set(cacheKey, entry);
      const age = now() - entry.checkedAt;
      return { ...entry, cached: true, stale: Boolean(entry.data.stale) || age < 0 || age >= ttl };
    }
    function get(kind, playerId, opponentId, force = false) {
      if (!['summary', 'rival', 'recent'].includes(kind) || !idOK(playerId) ||
          (kind === 'rival' && (!idOK(opponentId) || Number(playerId) === Number(opponentId))) ||
          (kind === 'recent' && Number(playerId) !== 443)) return Promise.reject(new Error('조회할 선수를 확인해 주세요.'));
      const cacheKey = key(kind, playerId, opponentId);
      if (pending.has(cacheKey)) return pending.get(cacheKey);
      const previous = peek(kind, playerId, opponentId);
      // A server-provided older snapshot is still useful. Keep its stale label
      // while avoiding another upstream request on every local journal render.
      if (!force && previous && now() >= previous.checkedAt && now() - previous.checkedAt < ttl) return Promise.resolve(previous);
      const failed = failures.get(cacheKey);
      if (!force && failed && now() - failed.at < 30000) {
        return previous ? Promise.resolve({ ...previous, stale: true, error: true }) : Promise.reject(failed.error);
      }
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
            if (!response.ok) throw new Error('ELOBOARD 정보를 잠시 불러오지 못했어요.');
            const body = await response.json();
            if (!validPayload(kind, body, playerId, opponentId)) throw new Error('선수 전적의 응답 형식을 확인하지 못했어요.');
            return body;
          })()]);
          const entry = { site, kind, playerId: Number(playerId), opponentId: Number(opponentId || 0), checkedAt: now(), data };
          memory.set(cacheKey, entry); failures.delete(cacheKey);
          try { storage?.setItem(cacheKey, JSON.stringify(entry)); } catch {}
          return { ...entry, cached: false, stale: Boolean(data.stale) };
        } catch (error) {
          failures.set(cacheKey, { at: now(), error });
          if (previous) return { ...previous, stale: true, error: true };
          throw error;
        } finally { clearTimeout(timer); pending.delete(cacheKey); }
      });
      pending.set(cacheKey, request);
      return request;
    }
    return { get, peek };
  }
  function sourceURL(value, fallback) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && ['eloboard.com', 'eloboard.co.kr'].includes(url.hostname)) return url.href;
    } catch {}
    return fallback;
  }
  function updatedText(result) {
    const when = new Date(result.data.fetchedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return (result.stale ? '새 정보를 확인하지 못해 마지막으로 확인한 전적을 보여드려요. · ' : '마지막 확인 · ') + when;
  }
  function statTable(rows, label) {
    if (!rows.length) return '<p class="elo-public-empty">표시할 ' + escape(label) + ' 기록이 없어요.</p>';
    return '<div class="elo-public-table"><table><thead><tr><th scope="col">' + escape(label) +
      '</th><th scope="col">전적</th><th scope="col">승률</th></tr></thead><tbody>' + rows.map(row =>
      '<tr><td>' + escape(row.label || row.name || row.key || '기타') + '</td><td>' + formatNumber(row.wins) +
      '승 ' + formatNumber(row.losses) + '패</td><td>' + rate(row) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function card(label, value, sub) {
    return '<div class="elo-public-metric"><span>' + escape(label) + '</span><strong>' + value + '</strong><small>' + escape(sub || '') + '</small></div>';
  }
  function summaryHTML(data) {
    const total = data.overall, elo = data.player.elo;
    const eloText = elo !== '' && elo != null && Number.isFinite(Number(elo)) ? formatNumber(elo) : '—';
    const races = data.races.map(row => '<div><span>vs ' + escape(RACES[row.race] || row.label || row.race) +
      '</span><b>' + formatNumber(row.wins) + '승 ' + formatNumber(row.losses) + '패</b><small>' + rate(row) + '</small></div>').join('');
    const opponents = data.opponents.filter(row => idOK(row.id) && Number(row.id) !== Number(data.player.id));
    return '<div class="elo-public-metrics">' + card('ELO', eloText, RACES[data.player.race] || data.player.race) +
      card('전체 경기', formatNumber(total.games), 'ELOBOARD 집계') +
      card('통산 전적', formatNumber(total.wins) + '<small>승</small> ' + formatNumber(total.losses) + '<small>패</small>', '전체 기간') +
      card('승률', rate(total), '전체 경기 기준') + '</div>' +
      (races ? '<div class="elo-public-races">' + races + '</div>' : '') +
      '<details class="elo-public-details"><summary>맵 · 경기 유형 · 상대별 통계</summary><div class="elo-public-breakdowns">' +
      '<section><h4>맵별 전적</h4>' + statTable(data.maps, '맵') + '</section><section><h4>경기 유형별 전적</h4>' +
      statTable(data.types, '경기 유형') + '</section></div>' +
      (opponents.length ? '<h4>자주 만난 상대 <small>선수를 누르면 맞대결을 확인해요</small></h4><div class="elo-public-opponents">' +
        opponents.map(row => '<button type="button" data-elo-opponent="' + Number(row.id) + '"><b>' + escape(row.name) +
          '</b><span>' + formatNumber(row.wins) + '승 ' + formatNumber(row.losses) + '패</span></button>').join('') + '</div>' : '') + '</details>';
  }
  function rivalHTML(data) {
    const h = data.headToHead, dates = [h.from, h.to].filter(Boolean).map(escape).join(' ~ ');
    return '<div class="elo-public-versus"><span>' + escape(data.player.name) + '</span><strong><b>' +
      formatNumber(h.wins) + '</b><i>:</i><b>' + formatNumber(h.losses) + '</b></strong><span>' + escape(data.opponent.name) +
      '</span></div><p class="elo-public-versus-note">' + formatNumber(h.games) + '경기 · ' + escape(data.player.name) +
      ' 기준 승률 ' + rate(h) + (dates ? ' · ' + dates : '') + '</p>' +
      (!h.games ? '<p class="elo-public-empty">ELOBOARD에 등록된 두 선수의 맞대결 기록이 없어요.</p>' : '') +
      ((data.maps.length || data.types.length) ? '<details class="elo-public-details"><summary>맞대결 맵 · 유형별 전적</summary>' +
        '<div class="elo-public-breakdowns"><section><h4>맵별 맞대결</h4>' + statTable(data.maps, '맵') +
        '</section><section><h4>유형별 맞대결</h4>' + statTable(data.types, '경기 유형') + '</section></div></details>' : '');
  }
  function createDirectory(options = {}) {
    const fetcher = options.fetch || ((...args) => global.fetch(...args)), storage = storageOf(options), now = options.now || Date.now;
    let pending = null, snapshot = null, checkedAt = 0;
    function get(force = false) {
      if (pending) return pending;
      if (!force && snapshot && !snapshot.stale && now() >= checkedAt && now() - checkedAt < 5 * 60 * 1000) return Promise.resolve(snapshot);
      pending = Promise.resolve().then(async () => {
        let saved;
        try { saved = JSON.parse(storage?.getItem('starlog-player-directory-v1') || 'null'); } catch {}
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetcher(DIRECTORY, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('directory');
          const data = await response.json();
          if (!Array.isArray(data.players) || !data.players.length) throw new Error('directory');
          snapshot = { players: data.players, stale: false }; checkedAt = now();
          return snapshot;
        } catch {
          const fallback = snapshot || saved;
          if (Array.isArray(fallback?.players) && fallback.players.length) {
            snapshot = { players: fallback.players, stale: true };
            return snapshot;
          }
          throw new Error('선수 목록을 불러오지 못했어요. 잠시 후 새로 확인해 주세요.');
        } finally { clearTimeout(timer); pending = null; }
      });
      return pending;
    }
    return { get };
  }
  const directoryClient = createDirectory();
  const clients = new Map();
  let nextMount = 0;
  let refreshVisibleView = null;
  if (global.document) {
    const refresh = () => {
      if (global.document.visibilityState === 'visible') refreshVisibleView?.();
    };
    global.addEventListener('focus', refresh);
    global.document.addEventListener('visibilitychange', refresh);
    // The open dashboard stays current; hidden tabs do not poll the source.
    global.setInterval(refresh, 5 * 60 * 1000);
  }
  function mount(host, options = {}) {
    if (!host) return;
    const site = String(options.site || 'starlog'), name = String(options.name || '').trim();
    const generation = ++nextMount;
    host.dataset.eloMount = String(generation);
    host.className = 'elo-public';
    host.setAttribute('aria-label', 'ELOBOARD 전적');
    const alive = () => host.isConnected && host.dataset.eloMount === String(generation);
    if (!clients.has(site)) clients.set(site, createClient({ site }));
    const client = clients.get(site);
    let owner = null, directory = null, summary = null, rival = null, rivalTicket = 0, summaryTicket = 0, recentTicket = 0;
    const $ = selector => host.querySelector(selector);
    host.innerHTML = '<div class="elo-public-heading"><div><span class="elo-public-label">ELOBOARD</span><h2>' +
      escape(name || '선수') + ' 전적</h2></div><button type="button" class="btn small" data-elo-refresh>↻ 새로 확인</button></div>' +
      '<p class="elo-public-scope">ELOBOARD에 등록된 경기의 통계예요. 직접 작성한 스폰·래더·연습 기록은 아래에서 따로 볼 수 있어요.</p>' +
      '<p class="elo-public-status" data-elo-status role="status" aria-live="polite">선수 정보를 확인하고 있어요…</p>' +
      '<div data-elo-owner></div><div data-elo-summary></div>' +
      '<section class="elo-public-rival" data-elo-rival hidden><h3>상대전적 검색</h3><form data-elo-form>' +
      '<label>상대 선수 이름<input name="opponent" maxlength="40" autocomplete="off" placeholder="선수 이름 또는 등록된 별명" list="elo-opponents-' +
      generation + '" required></label><button type="submit" class="btn primary">맞대결 확인</button></form>' +
      '<datalist id="elo-opponents-' + generation + '"></datalist><p class="elo-public-status" data-elo-rival-status role="status" aria-live="polite">' +
      '상대 이름을 검색하면 ELOBOARD의 전체 기간 맞대결 전적을 보여드려요.</p><div data-elo-choices></div><div data-elo-rival-result></div></section>' +
      '<div data-elo-recent></div><a class="elo-public-source" data-elo-source target="_blank" rel="noopener noreferrer" hidden>ELOBOARD 원본 보기 ↗</a>';
    function status(text, stale = false) {
      $('[data-elo-status]').textContent = text;
      $('[data-elo-status]').classList.toggle('is-stale', stale);
    }
    function fillDirectory() {
      if (!directory || !alive()) return;
      const names = [...new Set(directory.players.filter(p => idOK(p?.eloId)).map(p => p.name).filter(Boolean))];
      $('datalist').innerHTML = names.map(value => '<option value="' + escape(value) + '"></option>').join('');
    }
    async function directoryReady(force = false) {
      if (force || !directory || directory.stale) directory = await directoryClient.get(force);
      fillDirectory();
      return directory;
    }
    function drawSummary(result) {
      if (!alive() || Number(result.data.player.id) !== owner?.eloId) return;
      summary = result.data;
      $('h2').textContent = result.data.player.name + ' 전적';
      $('[data-elo-summary]').innerHTML = summaryHTML(result.data);
      status(updatedText(result), result.stale);
      const source = $('[data-elo-source]');
      source.href = sourceURL(result.data.sourceUrl, 'https://eloboard.com/players/' + owner.eloId);
      source.hidden = false;
    }
    async function loadSummary(force = false) {
      const ticket = ++summaryTicket, playerId = owner.eloId;
      const cached = client.peek('summary', playerId);
      if (cached) drawSummary(cached);
      else status('ELOBOARD 전적을 불러오고 있어요…');
      $('[data-elo-refresh]').disabled = true;
      try {
        const result = await client.get('summary', playerId, null, force);
        if (alive() && ticket === summaryTicket) drawSummary(result);
      } catch {
        if (alive() && ticket === summaryTicket) status('ELOBOARD 전적을 잠시 불러오지 못했어요. 아래의 내 기록 통계는 계속 볼 수 있어요.');
      } finally { if (alive() && ticket === summaryTicket) $('[data-elo-refresh]').disabled = false; }
    }
    function drawRecent(result) {
      const data = result.data;
      $('[data-elo-recent]').innerHTML = '<details class="elo-public-details elo-public-recent" open><summary>최도랑 최근 경기 · ' +
        data.matches.length + '건</summary><p class="elo-public-status' + (result.stale ? ' is-stale' : '') + '">' +
        escape(updatedText(result)) + '</p>' + ((!data.complete || data.warning) ?
          '<p class="elo-public-warning">' + escape(data.warning || '공개 화면에서 확인된 경기만 표시하고 있어요. 일부 경기가 빠질 수 있어요.') + '</p>' : '') +
        (data.matches.length ? '<div class="elo-public-table"><table><thead><tr><th>날짜</th><th>상대</th><th>맵</th><th>결과</th><th>유형</th></tr></thead><tbody>' +
          data.matches.map(row => '<tr><td>' + escape(row.date) + '</td><td>' + escape(row.opponent) +
            (RACES[row.race] ? ' <small>' + escape(row.race) + '</small>' : '') + '</td><td>' + escape(row.map || '맵 미등록') +
            '</td><td><span class="elo-public-result ' + (row.result === 'W' ? 'is-win' : 'is-loss') + '">' + (row.result === 'W' ? '승' : '패') +
            '</span></td><td>' + escape(row.type || '기타') + '</td></tr>').join('') + '</tbody></table></div>' :
          '<p class="elo-public-empty">현재 확인된 최근 경기가 없어요.</p>') + '</details>';
    }
    async function loadRecent(force = false) {
      if (!options.recent || owner?.eloId !== 443) return;
      const ticket = ++recentTicket, cached = client.peek('recent', 443);
      if (cached) drawRecent(cached);
      else $('[data-elo-recent]').innerHTML = '<p class="elo-public-status">최근 50경기를 확인하고 있어요…</p>';
      try {
        const result = await client.get('recent', 443, null, force);
        if (alive() && ticket === recentTicket) drawRecent(result);
      } catch {
        if (alive() && ticket === recentTicket) $('[data-elo-recent]').innerHTML = '<p class="elo-public-status">최근 경기 목록을 잠시 불러오지 못했어요. 통계와 상대전적은 각각 확인할 수 있어요.</p>';
      }
    }
    async function lookupRival(opponent, force = false) {
      if (!owner || !alive()) return;
      const ticket = ++rivalTicket, playerId = owner.eloId, opponentId = Number(opponent.eloId || opponent.id);
      const state = $('[data-elo-rival-status]'), resultNode = $('[data-elo-rival-result]');
      if (!idOK(opponentId) || opponentId === playerId) { state.textContent = '등록된 선수와 다른 상대를 선택해 주세요.'; return; }
      rival = { ...opponent, eloId: opponentId };
      $('[name="opponent"]').value = opponent.name;
      $('[data-elo-choices]').replaceChildren();
      const cached = client.peek('rival', playerId, opponentId);
      resultNode.innerHTML = cached ? rivalHTML(cached.data) : '';
      state.textContent = cached ? updatedText(cached) : opponent.name + ' 선수와의 맞대결을 확인하고 있어요…';
      state.classList.toggle('is-stale', Boolean(cached?.stale));
      try {
        const result = await client.get('rival', playerId, opponentId, force);
        if (!alive() || ticket !== rivalTicket || owner.eloId !== playerId) return;
        resultNode.innerHTML = rivalHTML(result.data); state.textContent = updatedText(result);
        state.classList.toggle('is-stale', result.stale);
      } catch {
        if (alive() && ticket === rivalTicket) state.textContent = '맞대결 전적을 잠시 불러오지 못했어요. 잠시 후 다시 확인해 주세요.';
      }
    }
    function choicesHTML(list, action) {
      return '<p>같은 이름이나 별명으로 여러 선수가 있어요. 선수를 선택해 주세요.</p><div class="elo-public-choices">' +
        list.map(p => '<button type="button" class="btn small" data-elo-choice="' + action + '" data-player-id="' + Number(p.eloId) + '">' +
          escape(p.name) + ' · ' + escape(RACES[p.race] || p.race || '종족 미등록') + ' · ' + escape(p.tierLabel || p.tier || '티어 미등록') +
          ' <small>#' + Number(p.eloId) + '</small></button>').join('') + '</div>';
    }
    let ownerChoices = [], opponentChoices = [];
    function useOwner(player) {
      owner = { ...player, eloId: Number(player.eloId) };
      $('h2').textContent = owner.name + ' 전적';
      $('[data-elo-owner]').replaceChildren();
      $('[data-elo-rival]').hidden = false;
      loadSummary(); loadRecent();
      directoryReady().catch(() => {});
    }
    async function identify(force = false) {
      if (!name && !options.fixedId) { status('프로필에 선수 이름을 등록하면 ELOBOARD 전적도 확인할 수 있어요.'); return; }
      if (options.fixedId === 443) { useOwner({ eloId: 443, name: '최도랑', race: 'P' }); return; }
      try {
        await directoryReady(force);
        if (!alive()) return;
        ownerChoices = candidates(directory.players, name);
        if (ownerChoices.length === 1) { useOwner(ownerChoices[0]); return; }
        if (ownerChoices.length > 1) {
          status('등록된 이름과 연결할 ELOBOARD 선수를 선택해 주세요.');
          $('[data-elo-owner]').innerHTML = choicesHTML(ownerChoices, 'owner');
        } else status('ELOBOARD 선수 DB에서 ‘' + name + '’ 이름을 찾지 못했어요. 아래의 내 기록 통계는 그대로 볼 수 있어요.');
      } catch (error) { if (alive()) status(error.message); }
    }
    $('[data-elo-form]').addEventListener('submit', async event => {
      event.preventDefault();
      const query = $('[name="opponent"]').value.trim();
      const ticket = ++rivalTicket;
      if (!query || query.length > 40) return;
      rival = null; $('[data-elo-rival-result]').replaceChildren(); $('[data-elo-choices]').replaceChildren();
      $('[data-elo-rival-status]').textContent = '상대 선수를 확인하고 있어요…';
      try {
        await directoryReady();
        if (!alive() || ticket !== rivalTicket) return;
        opponentChoices = candidates(directory.players, query);
        if (opponentChoices.length === 1) { lookupRival(opponentChoices[0]); return; }
        if (opponentChoices.length > 1) {
          $('[data-elo-rival-status]').textContent = '조회할 상대 선수를 선택해 주세요.';
          $('[data-elo-choices]').innerHTML = choicesHTML(opponentChoices, 'opponent');
        } else $('[data-elo-rival-status]').textContent = '선수 DB에서 찾지 못했어요. ELOBOARD에 등록된 이름이나 별명을 입력해 주세요.';
      } catch (error) { if (alive() && ticket === rivalTicket) $('[data-elo-rival-status]').textContent = error.message; }
    });
    host.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !host.contains(button)) return;
      if (button.hasAttribute('data-elo-refresh')) {
        if (!owner) identify(true);
        else {
          directoryReady(true).catch(() => {});
          loadSummary(true); loadRecent(true); if (rival) lookupRival(rival, true);
        }
      }
      if (button.dataset.eloChoice) {
        const list = button.dataset.eloChoice === 'owner' ? ownerChoices : opponentChoices;
        const player = list.find(p => Number(p.eloId) === Number(button.dataset.playerId));
        if (player) button.dataset.eloChoice === 'owner' ? useOwner(player) : lookupRival(player);
      }
      if (button.dataset.eloOpponent) {
        const opponent = summary?.opponents.find(p => Number(p.id) === Number(button.dataset.eloOpponent));
        if (opponent) { lookupRival(opponent); $('[data-elo-rival]').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      }
    });
    refreshVisibleView = () => {
      if (!alive() || !owner || !host.getClientRects().length) return;
      loadSummary(); loadRecent();
      if (rival && normalize($('[name="opponent"]').value) === normalize(rival.name)) lookupRival(rival);
    };
    identify();
  }
  return { mount, createClient, createDirectory, candidates, validPayload, escape };
});
