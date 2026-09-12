const ELO_API_URL = "https://eloboard.co.kr";

const CATEGORY_LABELS = {
  sponsored: "스폰",
  pro_league: "프로리그",
  team_event: "팀리그",
  college_event: "대학리그",
  college_war: "대학대전",
  college_mini: "미니대전",
  solo_event: "개인리그",
};

const RACE_LABELS = { T: "테란", Z: "저그", P: "토스" };

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function playerLabel(player) {
  return String(player?.display_name || player?.name || "").trim();
}

function selectProfile(players, wantedName) {
  const wanted = normalizeName(wantedName);
  const exact = (Array.isArray(players) ? players : []).filter(
    (player) =>
      player?.division === "women" &&
      (normalizeName(playerLabel(player)) === wanted || normalizeName(player?.name) === wanted),
  );
  return (
    exact.sort(
      (a, b) =>
        Number(Boolean(b.is_main_race)) - Number(Boolean(a.is_main_race)) ||
        Number(b.games || 0) - Number(a.games || 0),
    )[0] || null
  );
}

function profileSummary(profile) {
  return {
    id: Number(profile.id),
    name: playerLabel(profile),
    race: String(profile.main_race || ""),
    raceLabel: RACE_LABELS[profile.main_race] || "",
    elo: profile.elo_raw == null ? "" : String(profile.elo_raw),
    wins: Number(profile.wins || 0),
    losses: Number(profile.losses || 0),
    games: Number(profile.games || 0),
    winRate: Number(profile.win_rate || 0),
    lastPlayedOn: String(profile.last_played_on || ""),
  };
}

function matchToRecord(match, playerId) {
  const participants = Array.isArray(match?.participants) ? match.participants : [];
  const mine = participants.find((participant) => Number(participant.player_id) === Number(playerId));
  const opponent = participants.find((participant) => Number(participant.player_id) !== Number(playerId));
  if (!mine || !opponent || !match?.played_on || !match?.id) return null;
  const result = mine.result === "win" ? "승" : mine.result === "loss" ? "패" : "무";
  if (result === "무") return null;
  const delta = match.elo_delta == null ? Number.NaN : Number(match.elo_delta);
  const eloChange = Number.isFinite(delta)
    ? `${result === "승" ? "+" : "-"}${Math.abs(delta).toFixed(1).replace(/\.0$/, "")}`
    : "";
  return {
    source: "eloboard",
    sourceId: `eloboard-match-${match.id}`,
    eloRecordId: String(match.id),
    date: String(match.played_on),
    opponent: String(opponent.name || "상대 미상"),
    tier: "",
    race: RACE_LABELS[opponent.race] || "",
    result,
    myBuild: "",
    enemyBuild: "",
    map: String(match.map_name || match.map_raw || ""),
    cause: "",
    note: "",
    feedback: "",
    eloChange,
    eloMatchType: [CATEGORY_LABELS[match.category] || "", match.format_raw || ""]
      .filter(Boolean)
      .join(" · "),
    eloMemo: String(match.memo || ""),
    eloInputter: String(match.created_by_nickname || ""),
  };
}

function recentMatchSummary(match, playerId) {
  const record = matchToRecord(match, playerId);
  if (!record) return null;
  return {
    id: record.eloRecordId,
    date: record.date,
    result: record.result,
    map: record.map,
    type: record.eloMatchType,
  };
}

function recordStats(records = []) {
  const wins = records.filter((record) => record.result === "승").length;
  const losses = records.filter((record) => record.result === "패").length;
  const games = wins + losses;
  return {
    wins,
    losses,
    games,
    winRate: games ? Math.round((wins / games) * 1000) / 10 : 0,
  };
}

function mondayOf(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function buildDashboardSummary(profile, raceRows = [], matches = [], today) {
  const player = profileSummary(profile);
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  const monthKey = dateKey.slice(0, 7);
  const weekStart = mondayOf(dateKey);
  const records = matches
    .map((match) => matchToRecord(match, player.id))
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.eloRecordId) - Number(a.eloRecordId));
  const overall = {
    wins: player.wins,
    losses: player.losses,
    games: player.games,
    winRate: player.winRate,
  };

  return {
    player,
    overall,
    month: recordStats(records.filter((record) => record.date.startsWith(monthKey))),
    week: recordStats(records.filter((record) => record.date >= weekStart && record.date <= dateKey)),
    totalGames: overall.games,
    races: ["T", "Z", "P"].map((race) => {
      const row = (Array.isArray(raceRows) ? raceRows : []).find((item) => item.race === race);
      const stats = row
        ? {
            wins: Number(row.wins || 0),
            losses: Number(row.losses || 0),
            games: Number(row.games || 0),
            winRate: Number(row.win_rate || 0),
          }
        : recordStats(records.filter((record) => record.race === RACE_LABELS[race]));
      return { race, raceLabel: RACE_LABELS[race], ...stats };
    }),
    latestMatchDate: String(player.lastPlayedOn || records[0]?.date || ""),
    asOf: dateKey,
  };
}

function buildRivalSummary(baseProfile, opponentProfile, rivalRow, matches = []) {
  const base = profileSummary(baseProfile);
  const opponent = profileSummary(opponentProfile);
  const row = rivalRow || {};
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  const games = Number(row.games || wins + losses);
  return {
    base,
    opponent,
    headToHead: {
      wins,
      losses,
      games,
      winRate: games ? Number(row.win_rate ?? Math.round((wins / games) * 1000) / 10) : 0,
      lastPlayedOn: String(row.last_played_on || ""),
    },
    recentMatches: matches
      .map((match) => recentMatchSummary(match, base.id))
      .filter(Boolean)
      .slice(0, 10),
  };
}

function pageError(text) {
  if (/max_user_connections|too many connections|database.*(?:error|unavailable)/i.test(text)) {
    return "ELOBOARD 서버 접속자가 많아 데이터베이스 연결에 실패했어. 잠시 후 다시 조회해줘.";
  }
  if (/captcha|cloudflare|site unavailable|access denied|forbidden/i.test(text)) {
    return "ELOBOARD에서 자동 조회를 제한하고 있어. 잠시 후 다시 조회해줘.";
  }
  return "";
}

async function requestEloJson(path, params = {}, attempts = 2) {
  const url = new URL(path, ELO_API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value != null) url.searchParams.set(key, String(value));
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SpawnNote/1.3; +https://hanuri2000-svg.github.io/spwn-note/)",
          Accept: "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9",
          Referer: `${ELO_API_URL}/`,
        },
        redirect: "follow",
        cf: { cacheEverything: true, cacheTtl: 60 },
      });
      const body = await response.text();
      const knownError = pageError(body);
      if (knownError) throw new Error(knownError);
      if (!response.ok) throw new Error(`ELOBOARD 응답 오류가 발생했어. (${response.status})`);
      return JSON.parse(body);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError || new Error("ELOBOARD 데이터를 불러오지 못했어.");
}

async function resolveProfile(player) {
  const candidates = await requestEloJson("/api/players", {
    q: player,
    limit: 20,
    include_sub: true,
  });
  const profile = selectProfile(candidates, player);
  if (!profile) {
    throw new ResponseError(
      404,
      `ELOBOARD 여자부에서 '${player}' 선수의 주종 계정을 찾지 못했어. 표시된 이름을 그대로 입력해줘.`,
    );
  }
  return profile;
}

function validatePlayerName(value, label = "선수") {
  const name = String(value || "").trim();
  if (name.length < 1 || name.length > 30) {
    throw new ResponseError(400, `${label} 이름을 1~30자로 입력해줘.`);
  }
  return name;
}

async function eloPreview(url) {
  const player = validatePlayerName(url.searchParams.get("player"));
  const fromDate = String(url.searchParams.get("fromDate") || "").trim();
  const requestedMaximum = Number(url.searchParams.get("pages") || 25);
  const maximum = [25, 50, 100].includes(requestedMaximum) ? requestedMaximum : 25;
  if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new ResponseError(400, "조회 시작 날짜가 올바르지 않아.");
  }

  const profile = await resolveProfile(player);
  const matches = await requestEloJson("/api/matches", {
    player_id: profile.id,
    category: "sponsored",
    limit: maximum,
    offset: 0,
  });
  const rows = Array.isArray(matches) ? matches : [];
  const items = rows
    .map((match) => matchToRecord(match, profile.id))
    .filter((item) => item && (!fromDate || item.date >= fromDate))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.eloRecordId) - Number(a.eloRecordId));
  return {
    items,
    scannedPages: 1,
    checkedMatches: rows.length,
    profileId: String(profile.id),
    lookupMode: "eloboard-json-api",
    latestAvailableDate: rows[0]?.played_on || profile.last_played_on || "",
  };
}

async function eloRival(url) {
  const player = validatePlayerName(url.searchParams.get("player"), "기준 선수");
  const opponent = validatePlayerName(url.searchParams.get("opponent"), "상대 선수");
  if (normalizeName(player) === normalizeName(opponent)) {
    throw new ResponseError(400, "기준 선수와 상대 선수는 다르게 입력해줘.");
  }

  const [baseProfile, opponentProfile] = await Promise.all([
    resolveProfile(player),
    resolveProfile(opponent),
  ]);
  const [rivals, recent] = await Promise.all([
    requestEloJson(`/api/players/${baseProfile.id}/stats/rivals`, {
      q: playerLabel(opponentProfile),
      limit: 20,
    }),
    requestEloJson("/api/matches", {
      player_id: baseProfile.id,
      q: playerLabel(opponentProfile),
      limit: 10,
      offset: 0,
    }),
  ]);
  const rivalRow = (Array.isArray(rivals) ? rivals : []).find(
    (row) =>
      Number(row.player_id) === Number(opponentProfile.id) ||
      normalizeName(row.name) === normalizeName(playerLabel(opponentProfile)),
  );
  const filteredRecent = (Array.isArray(recent) ? recent : []).filter((match) =>
    (match.participants || []).some(
      (participant) => Number(participant.player_id) === Number(opponentProfile.id),
    ),
  );
  return buildRivalSummary(baseProfile, opponentProfile, rivalRow, filteredRecent);
}

async function recentMatchesForDashboard(playerId, fromDate) {
  const matches = [];
  for (let page = 0; page < 10; page += 1) {
    const rows = await requestEloJson("/api/matches", {
      player_id: playerId,
      date_from: fromDate,
      limit: 200,
      offset: page * 200,
    });
    const pageRows = Array.isArray(rows) ? rows : [];
    matches.push(...pageRows);
    if (pageRows.length < 200) return matches;
  }
  throw new ResponseError(422, "최근 기간의 전적 수가 너무 많아 대시보드 통계를 계산하지 못했어.");
}

async function eloDashboard(url) {
  const player = validatePlayerName(url.searchParams.get("player"), "기준 선수");
  const today = String(url.searchParams.get("today") || "").trim();
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new ResponseError(400, "기준 날짜가 올바르지 않아.");
  }

  const profile = await resolveProfile(player);
  const dateKey = today || new Date().toISOString().slice(0, 10);
  const monthStart = `${dateKey.slice(0, 7)}-01`;
  const periodStart = [monthStart, mondayOf(dateKey)].sort()[0];
  const [raceRows, matches] = await Promise.all([
    requestEloJson(`/api/players/${profile.id}/stats/races`),
    recentMatchesForDashboard(profile.id, periodStart),
  ]);
  return buildDashboardSummary(profile, raceRows, matches, dateKey);
}

function buildTierPayload(data) {
  if (!Array.isArray(data?.tiers)) {
    throw new ResponseError(502, "ELOBOARD 티어표 형식을 확인하지 못했어.");
  }
  return {
    version: String(data.version || ""),
    updatedOn: String(data.updated_on || ""),
    tiers: data.tiers.map((tier) => ({
      key: String(tier.key || ""),
      label: String(tier.label || ""),
      players: (Array.isArray(tier.players) ? tier.players : []).map((player) => ({
        playerId: Number(player.player_id || 0),
        name: String(player.name || ""),
        race: String(player.race || ""),
        division: String(player.division || ""),
        soopId: String(player.soop_id || ""),
        thumbUrl: String(player.thumb_url || ""),
      })),
    })),
  };
}

async function eloTiers() {
  return buildTierPayload(await requestEloJson("/api/tiers"));
}

class ResponseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";
    if (request.method === "OPTIONS") return json({ ok: true }, 200, origin);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, origin);
    if (url.pathname === "/health") return json({ ok: true, version: "1.4.0" }, 200, origin);
    try {
      if (url.pathname === "/api/elo/preview") return json(await eloPreview(url), 200, origin);
      if (url.pathname === "/api/elo/rival") return json(await eloRival(url), 200, origin);
      if (url.pathname === "/api/elo/dashboard") return json(await eloDashboard(url), 200, origin);
      if (url.pathname === "/api/elo/tiers") return json(await eloTiers(), 200, origin);
      return json({ error: "not found" }, 404, origin);
    } catch (error) {
      return json(
        { error: error?.message || "ELOBOARD 데이터를 가져오지 못했어. 잠시 후 다시 시도해줘." },
        error?.status || 502,
        origin,
      );
    }
  },
};

export const __test = {
  buildDashboardSummary,
  buildRivalSummary,
  buildTierPayload,
  matchToRecord,
  normalizeName,
  pageError,
  selectProfile,
};
