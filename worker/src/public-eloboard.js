// This adapter reads ordinary public profile pages only. It never executes
// upstream JavaScript or calls EloBoard's unavailable JSON endpoints.
const ORIGIN = "https://eloboard.com";
const REFRESH_INTERVAL = 6 * 60 * 60_000;
const MANUAL_COOLDOWN = 15_000;
const STALE_TTL = 24 * 60 * 60_000;
const KST_OFFSET = 9 * 60 * 60_000;
const MAX_ENTRIES = 100;
const MAX_BYTES = 5_000_000;
const PAGE_SIZE = 15;
const RACE_LABELS = { T: "테란", Z: "저그", P: "프로토스", R: "랜덤" };
const TYPE_LABELS = {
  sponsored: "스폰", pro_league: "프로리그", team_event: "팀리그",
  college_event: "대학리그", college_cup: "대학 컵대회", college_war: "대학대전",
  college_mini: "미니대전", solo_event: "개인리그",
};

export class PublicSourceError extends Error {
  constructor(message, status = 502, code = "PUBLIC_SOURCE_UNAVAILABLE") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message = "ELOBOARD 공개 페이지 형식이 바뀌었거나 내용을 확인하지 못했어.") {
  throw new PublicSourceError(message, 502, "PUBLIC_SOURCE_INVALID");
}

function positiveId(value, label = "선수") {
  if (!/^[1-9]\d*$/.test(String(value ?? "")) || !Number.isSafeInteger(Number(value))) {
    throw new PublicSourceError(`${label} ID가 올바르지 않아.`, 400, "INVALID_ID");
  }
  return Number(value);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

function koreanDate(timestamp) {
  const value = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(value)) invalid();
  return new Date(value + KST_OFFSET).toISOString().slice(0, 10);
}

// Read a JSON value, not a JavaScript expression, from a React Flight frame.
function readJson(source, start) {
  let depth = 0, quoted = false, escaped = false;
  const stringValue = source[start] === '"';
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        quoted = false;
        if (stringValue && depth === 0) return JSON.parse(source.slice(start, i + 1));
      }
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  invalid();
}

function isElement(value) {
  return Array.isArray(value) && value.length === 4 && value[0] === "$" &&
    value[3] && typeof value[3] === "object" && !Array.isArray(value[3]);
}

function flightDocument(html) {
  const chunks = [];
  try {
    for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g)) {
      chunks.push(JSON.parse(m[1]));
    }
    if (!chunks.length) invalid();
    const data = chunks.join(""), records = new Map();
    for (const m of data.matchAll(/(?:^|\n)([0-9a-f]+):/g)) {
      const start = m.index + m[0].length;
      // Module declarations and binary/text protocol records are not JSON.
      if (/[[{"]/.test(data[start] || " ")) records.set(m[1], readJson(data, start));
    }
    if (!records.size) invalid();
    const roots = [...records.values()];
    const resolve = value => {
      const ref = typeof value === "string" && value.match(/^\$(?:L)?([0-9a-f]+)$/);
      return ref && records.has(ref[1]) ? records.get(ref[1]) : value;
    };
    function select(predicate, root = roots) {
      const found = [], visited = new Set();
      function visit(value, depth = 0) {
        if (depth > 150) invalid();
        value = resolve(value);
        if (!value || typeof value !== "object" || visited.has(value)) return;
        visited.add(value);
        if (isElement(value)) {
          if (predicate(value)) found.push(value);
          visit(value[3].children, depth + 1);
        } else if (Array.isArray(value)) value.forEach(v => visit(v, depth + 1));
        else Object.values(value).forEach(v => visit(v, depth + 1));
      }
      visit(root);
      return found;
    }
    function text(value, depth = 0) {
      if (depth > 150) invalid();
      const resolved = resolve(value);
      if (resolved !== value) return text(resolved, depth + 1);
      if (typeof value === "string") return value.startsWith("$") ? "" : value;
      if (typeof value === "number") return String(value);
      if (isElement(value)) return text(value[3].children, depth + 1);
      if (Array.isArray(value)) return value.map(v => text(v, depth + 1)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      return "";
    }
    function children(value) {
      value = resolve(value);
      const result = [];
      function collect(child) {
        child = resolve(child);
        if (isElement(child)) result.push(child);
        else if (Array.isArray(child)) child.forEach(collect);
      }
      collect(isElement(value) ? value[3].children : value);
      return result;
    }
    const hasClass = (node, name) => String(node[3].className || "").split(/\s+/)
      .some(token => token === name || token.endsWith("__" + name));
    const byClass = (name, root) => select(node => hasClass(node, name), root);
    const one = (name, root) => {
      const matches = byClass(name, root);
      if (matches.length !== 1) invalid();
      return matches[0];
    };
    return { roots, select, text, children, hasClass, byClass, one };
  } catch (error) {
    if (error instanceof PublicSourceError) throw error;
    invalid();
  }
}

function numberText(value) {
  const text = String(value).replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) invalid();
  return Number(text);
}

function stats(wins, losses, games = wins + losses, winRate) {
  if (![wins, losses, games].every(n => Number.isSafeInteger(n) && n >= 0) || games !== wins + losses) invalid();
  const calculated = games ? Math.round(wins * 1000 / games) / 10 : 0;
  if (winRate == null) winRate = calculated;
  if (!Number.isFinite(winRate) || winRate < 0 || winRate > 100 || Math.abs(winRate - calculated) > 0.11) invalid();
  return { wins, losses, games, winRate };
}

function winsLosses(value) {
  const m = value.match(/([\d,]+)\s*승\s*([\d,]+)\s*패/);
  if (!m) invalid();
  return [numberText(m[1]), numberText(m[2])];
}

function percentage(value) {
  const m = value.match(/([\d.]+)\s*%/);
  if (!m) invalid();
  return numberText(m[1]);
}

function raceOf(doc, root) {
  const nodes = doc.byClass("race", root);
  if (nodes.length !== 1) invalid();
  const race = doc.text(nodes[0]);
  return /^[TZPR]$/.test(race) ? race : "";
}

function profileFrom(doc, id) {
  const header = doc.one("pf-name");
  const names = doc.select(n => n[1] === "h1", header);
  const name = names.length === 1 ? doc.text(names[0]) : "";
  if (!name || !doc.select(n => n[3].playerId === id && n[3].name === name).length) invalid("ELOBOARD 선수 ID와 공개 프로필이 일치하지 않아.");
  const values = new Map();
  for (const group of doc.children(doc.one("pf-stats"))) {
    const key = doc.byClass("k", group), val = doc.byClass("v", group);
    if (key.length === 1 && val.length === 1) values.set(doc.text(key[0]), doc.text(val[0]));
  }
  const pair = (values.get("승 · 패") || "").match(/^([\d,]+)\s*·\s*([\d,]+)$/);
  if (!pair) invalid();
  const overall = stats(numberText(pair[1]), numberText(pair[2]), numberText(values.get("경기")), percentage(values.get("승률") || ""));
  const score = values.get("현재 ELO") || "";
  const eloMatch = score.match(/^(-?[\d,]+(?:\.\d+)?)(?:\s*±\s*[\d,.]+)?$/);
  if (!eloMatch && !/^(?:—|-|미산정)$/.test(score)) invalid();
  return { id, name, race: raceOf(doc, header), elo: eloMatch ? Number(eloMatch[1].replace(/,/g, "")) : null, ...overall };
}

function section(doc, title, required = true) {
  const found = doc.select(node => node[1] === "section" &&
    doc.select(child => child[1] === "h2" && doc.text(child) === title, node).length === 1);
  if (found.length !== 1) {
    if (!required && found.length === 0) return null;
    invalid();
  }
  return found[0];
}

function raceStats(doc, games) {
  const root = section(doc, "종족별 전적", games > 0);
  if (!root) return [];
  const rows = doc.byClass("vs", root).map(node => {
    const race = raceOf(doc, node);
    const [wins, losses] = winsLosses(doc.text(doc.one("n", node)));
    return { race, label: RACE_LABELS[race] || "종족 미상", ...stats(wins, losses, undefined, percentage(doc.text(doc.one("pct", node)))) };
  });
  if (games && !rows.length) invalid();
  if (new Set(rows.map(row => row.race)).size !== rows.length) invalid();
  return rows;
}

function typeStats(doc, games) {
  const root = section(doc, "무대별 전적", games > 0);
  if (!root) return [];
  const rows = doc.byClass("crow", root).map(node => {
    const key = new URL(node[3].href, ORIGIN).searchParams.get("category");
    const label = doc.text(doc.one("cname", node));
    const record = doc.text(doc.one("crec", node)), match = record.match(/([\d,]+)\s*경기/);
    if (!key || !/^[a-z_]+$/.test(key) || !label || !match) invalid();
    const [wins, losses] = winsLosses(record);
    return { key, label, ...stats(wins, losses, numberText(match[1]), percentage(doc.text(doc.one("crate", node)))) };
  });
  if (games && !rows.length) invalid();
  return rows;
}

function mapStats(doc, games) {
  const root = section(doc, "맵별 승률", games > 0);
  if (!root) return [];
  const rows = doc.byClass("mcRow", root).map(node => {
    const id = String(node[3].href || "").match(/^\/maps\/([1-9]\d*)$/)?.[1];
    const label = doc.text(doc.one("mcName", node));
    const record = doc.text(doc.one("mtipTop", node));
    if (!id || !label) invalid();
    const [wins, losses] = winsLosses(record);
    return { id: positiveId(id, "맵"), label, ...stats(wins, losses, undefined, percentage(record)) };
  });
  if (games && !rows.length) invalid();
  if (new Set(rows.map(row => row.id)).size !== rows.length) invalid();
  return rows;
}

function rivalPicker(doc, playerId) {
  const nodes = doc.select(n => n[3].playerId === playerId && Array.isArray(n[3].rivals));
  if (nodes.length !== 1) invalid();
  return nodes[0][3];
}

function opponentStats(rows) {
  const result = rows.map(row => {
    const id = positiveId(row.player_id), name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) invalid();
    return { id, name, race: /^[TZPR]$/.test(row.race) ? row.race : "",
      ...stats(row.wins, row.losses, row.games, row.win_rate) };
  });
  if (new Set(result.map(row => row.id)).size !== result.length) invalid();
  return result;
}

function sameProfile(a, b) {
  if (["id", "name", "race", "wins", "losses", "games"].some(key => a[key] !== b[key])) invalid("ELOBOARD 페이지 사이에 기록이 달라졌어. 잠시 후 다시 확인해줘.");
}

export function parsePublicSummary(summaryHtml, mapsHtml, rivalsHtml, playerId) {
  const doc = flightDocument(summaryHtml), mapsDoc = flightDocument(mapsHtml), rivalsDoc = flightDocument(rivalsHtml);
  const player = profileFrom(doc, playerId);
  sameProfile(player, profileFrom(mapsDoc, playerId));
  sameProfile(player, profileFrom(rivalsDoc, playerId));
  const { wins, losses, games, winRate } = player;
  return { player, overall: { wins, losses, games, winRate }, races: raceStats(doc, games),
    types: typeStats(doc, games), maps: mapStats(mapsDoc, games),
    opponents: opponentStats(rivalPicker(rivalsDoc, playerId).rivals) };
}

export function parsePublicRival(html, playerId, opponentId) {
  const doc = flightDocument(html), fullPlayer = profileFrom(doc, playerId);
  const picker = rivalPicker(doc, playerId);
  if (picker.currentId !== opponentId) invalid("ELOBOARD에서 요청한 상대 선수를 확인하지 못했어.");
  const heads = doc.byClass("vshead");
  if (heads.length !== 1) throw new PublicSourceError("선택한 두 선수의 공개 상대전적을 확인하지 못했어.", 404, "RIVAL_NOT_AVAILABLE");
  const header = heads[0], right = doc.one("vsRight", header);
  const names = doc.select(node => node[1] === "b", right);
  const name = names.length === 1 ? doc.text(names[0]) : "";
  const score = doc.text(doc.one("vsbig", header)).match(/^([\d,]+)\s*:\s*([\d,]+)$/);
  const range = doc.text(doc.one("vssub", header)).match(/^(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2})\s*·\s*([\d,]+)\s*경기$/);
  if (!name || !score || !range) invalid();
  const from = range[1].replace(/\./g, "-"), to = range[2].replace(/\./g, "-");
  if (!validDate(from) || !validDate(to) || from > to) invalid();
  const summaryRows = doc.byClass("vsrow").filter(node => doc.byClass("vslabel", node).some(n => doc.text(n) === "맞대결 승률"));
  if (summaryRows.length !== 1) invalid();
  const rates = doc.byClass("vsval", summaryRows[0]);
  if (rates.length !== 2) invalid();
  const headToHead = { ...stats(numberText(score[1]), numberText(score[2]), numberText(range[3]), percentage(doc.text(rates[0]))), from, to };
  const mapNodes = doc.select(node => Array.isArray(node[3].maps) && Object.hasOwn(node[3], "picked"));
  if (mapNodes.length !== 1) invalid();
  const maps = mapNodes[0][3].maps.map(row => {
    if (typeof row.map_name !== "string" || !row.map_name.trim()) invalid();
    return { id: positiveId(row.map_id, "맵"), label: row.map_name,
      ...stats(row.wins, row.losses, row.games, row.win_rate) };
  });
  const types = doc.byClass("vsrow", doc.one("vscatrows")).map(node => {
    const values = doc.byClass("vsval", node), labels = doc.byClass("vslabel", node);
    const key = node[2];
    if (values.length !== 2 || labels.length !== 1 || typeof key !== "string") invalid();
    const counts = values.map(n => doc.text(n).match(/^([\d,]+)\s*승$/)?.[1]);
    if (counts.some(n => n == null)) invalid();
    return { key, label: doc.text(labels[0]), ...stats(numberText(counts[0]), numberText(counts[1])) };
  });
  return { player: { id: fullPlayer.id, name: fullPlayer.name, race: fullPlayer.race },
    opponent: { id: opponentId, name, race: raceOf(doc, right) }, headToHead, maps, types };
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

export function parsePublicMatches(html, playerId, to = "") {
  const doc = flightDocument(html), player = profileFrom(doc, playerId);
  const candidates = doc.select(node => node[3].playerId === playerId && Array.isArray(node[3].initial) &&
    Object.hasOwn(node[3], "from") && Object.hasOwn(node[3], "to") && Object.hasOwn(node[3], "category"));
  if (candidates.length !== 1) invalid();
  const props = candidates[0][3], rows = props.initial;
  if (props.to !== to || (props.from && props.from !== "$undefined") ||
      (props.category && props.category !== "$undefined") || props.q || props.race) invalid("ELOBOARD 경기 목록에 예상하지 못한 필터가 적용됐어.");
  if (rows.length > PAGE_SIZE || (!rows.length && player.games > 0)) invalid();
  const ids = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) || !validDate(row.played_on) ||
      (i && row.played_on > rows[i - 1].played_on) || (to && row.played_on > to) ||
      !Array.isArray(row.participants) || row.participants.length !== 2) invalid();
    ids.add(row.id);
    const mine = row.participants.filter(p => p.player_id === playerId);
    const others = row.participants.filter(p => p.player_id !== playerId);
    if (mine.length !== 1 || others.length !== 1 || !["win", "loss"].includes(mine[0].result) ||
      !Number.isSafeInteger(others[0].player_id) || others[0].player_id <= 0 || !others[0].name ||
      others[0].result !== (mine[0].result === "win" ? "loss" : "win") ||
      (row.elo_delta != null && !Number.isFinite(Number(row.elo_delta)))) invalid();
  }
  return { player, rows };
}

function publicMatch(row, playerId) {
  const mine = row.participants.find(p => p.player_id === playerId);
  const opponent = row.participants.find(p => p.player_id !== playerId);
  return { id: row.id, date: row.played_on, opponentId: opponent.player_id, opponent: opponent.name,
    race: /^[TZPR]$/.test(opponent.race) ? opponent.race : "", result: mine.result === "win" ? "W" : "L",
    map: String(row.map_name || row.map_raw || ""), type: TYPE_LABELS[row.category] || String(row.category || ""),
    eloChange: row.elo_delta == null ? null : (mine.result === "win" ? 1 : -1) * Math.abs(Number(row.elo_delta)) };
}

async function collectPublicSnapshot(fetchPage, playerId, limit = 50) {
  const seen = new Map();
  let previous = null, boundary = "", profile = null, complete = false, allMatches = false, warning = null;
  for (let page = 0; page < 7; page++) {
    const { player, rows } = parsePublicMatches(await fetchPage(`/players/${playerId}?tab=matches${boundary ? "&to=" + boundary : ""}`), playerId, boundary);
    if (profile) sameProfile(profile, player);
    else profile = player;
    if (previous) {
      const suffix = previous.filter(row => row.played_on === boundary).map(row => row.id);
      if (canonical(suffix) !== canonical(rows.slice(0, suffix.length).map(row => row.id))) invalid("ELOBOARD 경기 페이지의 날짜 경계가 이어지지 않아.");
    }
    for (const row of rows) {
      if (seen.has(row.id) && canonical(seen.get(row.id)) !== canonical(row)) invalid("ELOBOARD 경기 내용이 조회 중 변경됐어. 잠시 후 다시 확인해줘.");
      if (!seen.has(row.id)) seen.set(row.id, row);
    }
    if (seen.size > profile.games) invalid("ELOBOARD 경기 목록과 통산 경기 수가 일치하지 않아.");
    if (seen.size >= limit || seen.size === profile.games) {
      complete = true;
      allMatches = seen.size === profile.games && seen.size <= limit;
      break;
    }
    const oldest = rows.at(-1)?.played_on;
    if (rows.length < PAGE_SIZE) { warning = "공개 페이지에서 확인한 최근 경기만 표시하고 있어."; break; }
    if (boundary && oldest >= boundary) { warning = "같은 날짜의 경기 수가 공개 페이지 범위를 넘어 최근 경기 일부만 확인했어."; break; }
    previous = rows;
    boundary = oldest;
  }
  if (!complete && !warning) warning = "공개 페이지 조회 범위 안에서 확인한 최근 경기만 표시하고 있어.";
  return { playerId, requested: limit, complete, allMatches, warning, matches: [...seen.values()].slice(0, limit).map(row => publicMatch(row, playerId)) };
}

export async function collectPublicRecent(fetchPage, playerId, limit = 50) {
  const { allMatches, ...recent } = await collectPublicSnapshot(fetchPage, playerId, limit);
  return recent;
}

// A bounded latest-match list proves a period only when it extends strictly
// before that period's first day, or when the whole profile history is known.
export function buildPublicActivity(snapshot) {
  const asOfDate = koreanDate(snapshot.fetchedAt), current = asOfDate.slice(0, 7);
  const rows = snapshot.matches;
  if (!Array.isArray(rows) || rows.length > 50 || typeof snapshot.complete !== "boolean" ||
      (snapshot.allMatches != null && typeof snapshot.allMatches !== "boolean") || !rows.every((row, index) =>
        validDate(row.date) && row.date <= asOfDate && ["W", "L"].includes(row.result) &&
        (!index || row.date <= rows[index - 1].date))) invalid();
  const oldest = rows.at(-1)?.date || null, newest = rows[0]?.date || null;
  // Pre-1.7 cached recent responses did not report full-history coverage.
  const allMatches = snapshot.complete && snapshot.allMatches === true;
  function period(from, to) {
    const complete = snapshot.complete && (allMatches || (oldest !== null && oldest < from));
    if (!complete) return { complete: false, wins: null, losses: null, games: null, winRate: null };
    const matches = rows.filter(row => row.date >= from && row.date <= to);
    const wins = matches.filter(row => row.result === "W").length;
    return { complete: true, ...stats(wins, matches.length - wins) };
  }
  const months = [...new Set([current, ...rows.map(row => row.date.slice(0, 7))])].sort().reverse()
    .map(month => ({ month, ...period(month + "-01", month === current ? asOfDate : month + "-31") }));
  const result = rows[0]?.result || null;
  let count = 0;
  while (count < rows.length && rows[count].result === result) count++;
  return {
    playerId: snapshot.playerId, asOfDate,
    recentResults: rows.map(row => ({ id: row.id, date: row.date, result: row.result })),
    coverage: { from: oldest, to: newest, complete: snapshot.complete, allMatches },
    today: { date: asOfDate, ...period(asOfDate, asOfDate) },
    currentMonth: { month: current, ...period(current + "-01", asOfDate) },
    streak: { result, count, complete: count < rows.length || allMatches },
    months,
  };
}

async function fetchPublicHtml(path, fetchImpl) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || !/^\/players\/[1-9]\d*$/.test(url.pathname)) invalid();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Workers supports only follow/manual. Refuse redirects explicitly instead
    // of using redirect:error, which throws before sending a Worker request.
    const response = await fetchImpl(url.href, { signal: controller.signal, redirect: "manual",
      headers: { "User-Agent": "spawn-note-elo-relay/1.7.2 (public profile statistics)", Accept: "text/html" } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new PublicSourceError("ELOBOARD 공개 페이지가 다른 주소로 이동해 지금 확인하지 못했어.", 502, "PUBLIC_SOURCE_REDIRECT");
    }
    if (!response.ok) throw new PublicSourceError(`ELOBOARD 공개 페이지를 지금 가져오지 못했어. (${response.status})`, response.status === 404 ? 404 : 502);
    if (!/text\/html/i.test(response.headers.get("content-type") || "") || !response.body) invalid();
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let size = 0, body = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if ((size += value.byteLength) > MAX_BYTES) { await reader.cancel(); invalid(); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    if (/site unavailable|access denied|just a moment|verify you are human|cf-chl-|captcha/i.test(body) || !/<title[^>]*>[^<]*EloBoard/i.test(body)) {
      throw new PublicSourceError("ELOBOARD 공개 페이지를 지금 확인하지 못했어. 잠시 후 다시 확인해줘.");
    }
    return body;
  } catch (error) {
    if (error instanceof PublicSourceError) throw error;
    throw new PublicSourceError(controller.signal.aborted ? "ELOBOARD 응답이 지연되고 있어. 잠시 후 다시 확인해줘." : "ELOBOARD 공개 페이지 연결에 실패했어.", controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); }
}

export function createPublicAdapter({ fetchImpl = (...args) => fetch(...args), now = () => Date.now(), edgeCache = () => globalThis.caches?.default } = {}) {
  const memory = new Map(), pending = new Map(), failures = new Map(), manualAttempts = new Map();
  function retain(map, key, value) {
    map.delete(key); map.set(key, value);
    while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
  }
  async function cached(key, load, force = false) {
    if (pending.has(key)) return pending.get(key);
    const cacheUrl = "https://eloboard-public-cache.invalid/v1/" + key;
    const failureUrl = "https://eloboard-public-cache.invalid/v1/failure/" + key;
    const manualUrl = "https://eloboard-public-cache.invalid/v1/manual/" + key;
    let stored = memory.get(key);
    const cache = edgeCache();
    if (!stored && cache) {
      try {
        const response = await cache.match(cacheUrl);
        const candidate = response && await response.json();
        if (candidate?.schemaVersion === 1 && Number.isFinite(Date.parse(candidate.fetchedAt))) stored = candidate;
      } catch { /* Cache availability must not prevent a normal public fetch. */ }
    }
    const age = stored ? now() - Date.parse(stored.fetchedAt) : Infinity;
    if (age < 0 || age > STALE_TTL) stored = undefined;
    if (stored) retain(memory, key, stored);
    const usableStored = () => stored && now() >= Date.parse(stored.fetchedAt) &&
      now() - Date.parse(stored.fetchedAt) <= STALE_TTL;
    const stale = () => ({ ...stored, stale: true,
      warning: "최신 조회에 실패해서 마지막으로 확인한 ELOBOARD 기록을 표시하고 있어." });
    let failed = failures.get(key);
    if (!failed && cache) {
      try {
        const response = await cache.match(failureUrl), entry = response && await response.json();
        if (entry && Number.isFinite(entry.at) && typeof entry.message === "string" &&
            Number.isInteger(entry.status) && entry.status >= 400 && entry.status <= 599) {
          failed = { at: entry.at, error: new PublicSourceError(entry.message, entry.status, entry.code) };
          retain(failures, key, failed);
        }
      } catch { /* A cache read failure must not manufacture an upstream failure. */ }
    }
    const failedAfterSnapshot = failed && (!stored || failed.at >= Date.parse(stored.fetchedAt));
    if (!force && failedAfterSnapshot && failed.at <= now() && now() - failed.at < REFRESH_INTERVAL) {
      if (usableStored()) return stale();
      throw failed.error;
    }
    if (!force && stored && now() - Date.parse(stored.fetchedAt) < REFRESH_INTERVAL) return stored;
    // A manual request bypasses the six-hour cache, not upstream access controls.
    // Coalesce requests and briefly reuse the last explicit attempt to prevent click storms.
    if (force) {
      let attempt = manualAttempts.get(key);
      if (!attempt && cache) {
        try {
          const response = await cache.match(manualUrl), candidate = response && await response.json();
          if (Number.isFinite(candidate?.at)) attempt = candidate;
        } catch { /* An unavailable cache must not block explicit refresh. */ }
      }
      if (attempt && attempt.at <= now() && now() - attempt.at < MANUAL_COOLDOWN) {
        if (pending.has(key)) return pending.get(key);
        if (failedAfterSnapshot) { if (usableStored()) return stale(); throw failed.error; }
        if (usableStored()) return stored;
        throw new PublicSourceError("전적을 확인하고 있어. 잠시 후 다시 확인해줘.", 429, "REFRESH_IN_PROGRESS");
      }
    }
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(async () => {
      try {
        if (force) {
          const attempt = { at: now() }; retain(manualAttempts, key, attempt);
          if (cache) {
            try { await cache.put(manualUrl, new Response(JSON.stringify(attempt), {
              headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" }
            })); } catch { /* In-memory coalescing remains available. */ }
          }
        }
        const loaded = await load();
        const data = { schemaVersion: 1, source: "eloboard", fetchedAt: new Date(now()).toISOString(), stale: false, ...loaded };
        if (stored?.complete === true && data.complete === false) throw new PublicSourceError(data.warning);
        retain(memory, key, data); failures.delete(key);
        if (force) {
          const completed = { at: now() }; retain(manualAttempts, key, completed);
          if (cache) { try { await cache.put(manualUrl, new Response(JSON.stringify(completed), {
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" }
          })); } catch {} }
        }
        if (cache) {
          try { await cache.put(cacheUrl, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } })); } catch { /* Memory cache remains usable. */ }
        }
        if (cache) {
          // Remove an earlier failed-attempt marker even after manual recovery.
          try {
            if (typeof cache.delete === 'function') await cache.delete(failureUrl);
            else await cache.put(failureUrl, new Response('{}'));
          } catch { /* The successful snapshot remains authoritative in this instance. */ }
        }
        return data;
      } catch (error) {
        const failure = { at: now(), error };
        retain(failures, key, failure);
        if (cache) {
          try {
            await cache.put(failureUrl, new Response(JSON.stringify({ at: failure.at,
              status: error.status || 502, message: error.message || "ELOBOARD 공개 페이지를 확인하지 못했어.",
              code: error.code || "PUBLIC_SOURCE_UNAVAILABLE" }),
            { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } }));
          } catch { /* The bounded memory failure record is still available. */ }
        }
        if (usableStored()) return stale();
        throw error;
      } finally { pending.delete(key); }
    });
    pending.set(key, task);
    return task;
  }
  const fetchPage = path => fetchPublicHtml(path, fetchImpl);
  const recentSnapshot = (playerId, force) => cached(`recent/${playerId}/50`, async () => ({
    sourceUrl: `${ORIGIN}/players/${playerId}?tab=matches`,
    ...await collectPublicSnapshot(fetchPage, playerId, 50),
  }), force);
  return {
    async handle(url) {
      const playerId = positiveId(url.searchParams.get("playerId"));
      const route = url.pathname.split("/").at(-1);
      const refresh = url.searchParams.get("refresh");
      if (refresh !== null && refresh !== "1") throw new PublicSourceError("갱신 요청이 올바르지 않아.", 400, "INVALID_REFRESH");
      const force = refresh === "1";
      if (route === "summary") return cached(`summary/${playerId}`, async () => {
        // Sequential calls stop immediately if a public page is unavailable.
        const summary = await fetchPage(`/players/${playerId}`);
        const maps = await fetchPage(`/players/${playerId}?tab=maps`);
        const rivals = await fetchPage(`/players/${playerId}?tab=rivals`);
        return { sourceUrl: `${ORIGIN}/players/${playerId}`, ...parsePublicSummary(summary, maps, rivals, playerId) };
      }, force);
      if (route === "rival") {
        const opponentId = positiveId(url.searchParams.get("opponentId"), "상대 선수");
        if (opponentId === playerId) throw new PublicSourceError("등록 선수와 상대 선수는 달라야 해.", 400, "INVALID_OPPONENT");
        const path = `/players/${playerId}?tab=rivals&vs=${opponentId}`;
        return cached(`rival/${playerId}/${opponentId}`, async () => ({ sourceUrl: ORIGIN + path,
          ...parsePublicRival(await fetchPage(path), playerId, opponentId) }), force);
      }
      if (route === "recent") {
        const raw = url.searchParams.get("limit") ?? "50";
        const limit = positiveId(raw, "경기 수");
        if (playerId !== 443 || limit > 50) throw new PublicSourceError("최근 경기 조회는 최도랑의 최대 50경기를 지원해.", 400, "RECENT_SCOPE_UNSUPPORTED");
        const { allMatches, ...snapshot } = await recentSnapshot(playerId, force);
        const complete = snapshot.matches.length >= limit || snapshot.complete === true;
        return { ...snapshot, requested: limit, complete,
          warning: snapshot.stale ? snapshot.warning : complete ? null : snapshot.warning,
          matches: snapshot.matches.slice(0, limit) };
      }
      if (route === "activity") {
        const snapshot = await recentSnapshot(playerId, force);
        const { schemaVersion, source, sourceUrl, fetchedAt, stale, warning } = snapshot;
        return { schemaVersion, source, sourceUrl, fetchedAt, stale, warning, ...buildPublicActivity(snapshot) };
      }
      throw new PublicSourceError("not found", 404, "NOT_FOUND");
    },
  };
}
