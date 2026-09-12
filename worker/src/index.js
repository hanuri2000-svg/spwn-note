const ELO_BOARD_URL = "https://eloboard.com/women/bbs/board.php";
const ELO_HOME_URL = "https://eloboard.com/women/";
const ELO_RANK_URL = `${ELO_BOARD_URL}?bo_table=rank_list&device=pc`;

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function stripHtml(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function allAnchors(htmlText) {
  return [...String(htmlText || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(
    (match) => ({ href: decodeHtml(match[1]), html: match[2], text: stripHtml(match[2]) }),
  );
}

function extractProfileAnchor(cell) {
  const anchors = [
    ...String(cell || "").matchAll(
      /<a\b[^>]*href=["'][^"']*bo_table=bj_list[^"']*wr_id=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];
  if (!anchors.length) return { text: stripHtml(cell), profileId: "" };
  return { text: stripHtml(anchors[0][2]), profileId: anchors[0][1] };
}

function parsePlayer(cell) {
  const anchor = extractProfileAnchor(cell);
  const text = anchor.text;
  let race = "";
  if (/(?:^|[\s:(])(?:protoss|프로토스|p)(?:$|[\s)])/i.test(text)) race = "토스";
  else if (/(?:^|[\s:(])(?:terran|테란|t)(?:$|[\s)])/i.test(text)) race = "테란";
  else if (/(?:^|[\s:(])(?:zerg|저그|z)(?:$|[\s)])/i.test(text)) race = "저그";
  const name = text
    .replace(/\s*[:(]?\s*(?:protoss|프로토스|terran|테란|zerg|저그|[ptz])\s*\)?\s*$/i, "")
    .trim();
  return { name, race, profileId: anchor.profileId };
}

function parseProfileId(htmlText, player) {
  const wanted = normalizeName(player);
  const candidates = allAnchors(htmlText)
    .map((anchor) => {
      const normalizedHref = anchor.href.replaceAll("&amp;", "&");
      const id = /(?:[?&])wr_id=(\d+)/i.exec(normalizedHref)?.[1] || "";
      if (!id || !/bo_table=bj_list(?:&|$)/i.test(normalizedHref)) return null;
      const normalizedText = normalizeName(anchor.text);
      return {
        id,
        exact: normalizedText === wanted,
        contains: normalizedText.includes(wanted) || wanted.includes(normalizedText),
      };
    })
    .filter(Boolean);
  return candidates.find((candidate) => candidate.exact)?.id || candidates.find((candidate) => candidate.contains)?.id || "";
}

function parseDate(value) {
  const match = String(value || "").match(/(20\d{2})[-.](\d{2})[-.](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function matchReferences(profileHtml, fromDate, maximum) {
  const references = new Map();
  const rows = [...String(profileHtml || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of rows) {
    const row = rowMatch[1];
    const date = parseDate(stripHtml(row));
    for (const anchor of allAnchors(row)) {
      const href = anchor.href.replaceAll("&amp;", "&");
      if (!/bo_table=bj_board(?:&|$)/i.test(href)) continue;
      const id = /(?:[?&])wr_id=(\d+)/i.exec(href)?.[1];
      if (!id || (fromDate && date && date < fromDate)) continue;
      if (!references.has(id)) references.set(id, { id, date });
      if (references.size >= maximum) return [...references.values()];
    }
  }
  if (!references.size) {
    for (const anchor of allAnchors(profileHtml)) {
      const href = anchor.href.replaceAll("&amp;", "&");
      if (!/bo_table=bj_board(?:&|$)/i.test(href)) continue;
      const id = /(?:[?&])wr_id=(\d+)/i.exec(href)?.[1];
      const date = parseDate(anchor.text);
      if (!id || (fromDate && date && date < fromDate)) continue;
      if (!references.has(id)) references.set(id, { id, date });
      if (references.size >= maximum) break;
    }
  }
  return [...references.values()];
}

function labeledCells(htmlText) {
  const values = new Map();
  const rows = [...String(htmlText || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
      (match) => match[1],
    );
    if (cells.length < 2) continue;
    const label = stripHtml(cells[0]).replace(/\s+/g, "");
    if (label) values.set(label, cells.slice(1).join(" "));
  }
  for (const pair of String(htmlText || "").matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const label = stripHtml(pair[1]).replace(/\s+/g, "");
    if (label && !values.has(label)) values.set(label, pair[2]);
  }
  return values;
}

function findLabeledCell(values, labels) {
  for (const label of labels) {
    for (const [key, value] of values) {
      if (key === label || key.includes(label)) return value;
    }
  }
  return "";
}

function plainField(text, startPattern, endPattern) {
  const match = new RegExp(`(?:${startPattern})\\s*([\\s\\S]*?)\\s*(?=(?:${endPattern}))`, "i").exec(text);
  return match?.[1]?.trim() || "";
}

function parseEloDetail(htmlText, player, recordId) {
  const wanted = normalizeName(player);
  const values = labeledCells(htmlText);
  const plain = stripHtml(htmlText);
  const dateCell = findLabeledCell(values, ["날짜", "경기일"]) || plainField(plain, "날짜", "승자");
  const winnerCell = findLabeledCell(values, ["승자"]) || plainField(plain, "승자", "패자");
  const loserCell = findLabeledCell(values, ["패자"]) || plainField(plain, "패자", "ELO\\s*변동|엘로\\s*변동");
  const winner = parsePlayer(winnerCell);
  const loser = parsePlayer(loserCell);
  const winnerMatches = normalizeName(winner.name) === wanted;
  const loserMatches = normalizeName(loser.name) === wanted;
  if (!winnerMatches && !loserMatches) return null;
  const date = parseDate(dateCell || plain);
  if (!date) return null;
  const opponent = winnerMatches ? loser : winner;
  const eloChange = stripHtml(
    findLabeledCell(values, ["ELO변동", "ELO 변동", "엘로변동"]) ||
      plainField(plain, "ELO\\s*변동|엘로\\s*변동", "맵"),
  );
  const matchType = stripHtml(
    findLabeledCell(values, ["경기방식"]) || plainField(plain, "경기방식", "프로리그\\s*방식|메모|비고|프린트"),
  );
  const proleagueType = stripHtml(
    findLabeledCell(values, ["프로리그방식", "프로리그 방식"]) ||
      plainField(plain, "프로리그\\s*방식", "메모|비고|프린트|Comments"),
  );
  const memo = stripHtml(
    findLabeledCell(values, ["메모", "비고"]) || plainField(plain, "메모|비고", "프린트|Comments"),
  );
  return {
    source: "eloboard",
    sourceId: `women-bj_board-${recordId}`,
    eloRecordId: String(recordId),
    date,
    opponent: opponent.name,
    tier: "",
    race: opponent.race,
    result: winnerMatches ? "승" : "패",
    myBuild: "",
    enemyBuild: "",
    map: stripHtml(findLabeledCell(values, ["맵", "Map"]) || plainField(plain, "맵", "경기방식")),
    cause: "",
    note: "",
    feedback: "",
    eloChange,
    eloMatchType: [matchType, proleagueType].filter(Boolean).join(" · "),
    eloMemo: memo,
    eloInputter: "",
  };
}

function parseProfileRows(profileHtml, player, profileId) {
  const wanted = normalizeName(player);
  const items = [];
  const rows = [...String(profileHtml || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of rows) {
    const row = rowMatch[1];
    const date = parseDate(stripHtml(row));
    if (!date) continue;
    const id = /bo_table=bj_board(?:&amp;|&)wr_id=(\d+)/i.exec(row)?.[1];
    if (!id) continue;
    const players = allAnchors(row)
      .filter((anchor) => /bo_table=bj_list/i.test(anchor.href))
      .map((anchor) => parsePlayer(`<a href="${anchor.href}">${anchor.html}</a>`));
    const opponent =
      players.find((candidate) => candidate.profileId !== String(profileId)) ||
      players.find((candidate) => normalizeName(candidate.name) !== wanted);
    if (!opponent?.name) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const texts = cells.map(stripHtml);
    const eloChange = texts.find((text) => /^[+-]\d+(?:\.\d+)?(?:p)?$/i.test(text)) || "";
    let result = "";
    if (/\b승\b|win/i.test(stripHtml(row)) || /^\+/.test(eloChange)) result = "승";
    if (/\b패\b|lose/i.test(stripHtml(row)) || /^-/.test(eloChange)) result = "패";
    if (!result) continue;
    const opponentIndex = cells.findIndex(
      (cell) => normalizeName(parsePlayer(cell).name) === normalizeName(opponent.name),
    );
    const map =
      texts
        .slice(Math.max(0, opponentIndex + 1))
        .find((text) => /폴리|라데온|녹아웃|실피드|버미어|레트로|이클립스|투혼|시타델|라 캄파넬라|데자/i.test(text)) || "";
    items.push({
      source: "eloboard",
      sourceId: `women-bj_board-${id}`,
      eloRecordId: id,
      date,
      opponent: opponent.name,
      tier: "",
      race: opponent.race,
      result,
      myBuild: "",
      enemyBuild: "",
      map,
      cause: "",
      note: "",
      feedback: "",
      eloChange,
      eloMatchType: "",
      eloMemo: "",
      eloInputter: "",
    });
  }
  return items;
}

function pageError(htmlText) {
  if (/max_user_connections|mysqli_connect|Connect Error|Too many connections/i.test(htmlText)) {
    return "ELOBOARD 서버 접속자가 많아 데이터베이스 연결에 실패했어. 잠시 후 다시 조회해줘.";
  }
  if (/접근\s*불가|captcha|cloudflare|site unavailable|unable to access this site/i.test(htmlText)) {
    return "ELOBOARD에서 자동 조회를 제한하고 있어. 잠시 후 다시 조회해줘.";
  }
  return "";
}

function decodeResponse(buffer, contentType) {
  const bytes = Buffer.from(buffer);
  const latin = bytes.subarray(0, 4096).toString("latin1");
  const headerCharset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType || "")?.[1];
  const metaCharset =
    /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(latin)?.[1] ||
    /charset\s*=\s*([^"'\s;>]+)/i.exec(latin)?.[1];
  const label = String(headerCharset || metaCharset || "utf-8").toLowerCase();
  const charset = /euc-?kr|ks_c_5601|cp949/.test(label) ? "euc-kr" : "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

async function requestEloPage(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "Accept-Encoding": "identity",
          "Cache-Control": "no-cache",
          Referer: ELO_HOME_URL,
        },
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`ELOBOARD 응답 오류가 발생했어. (${response.status})`);
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > 5_000_000) throw new Error("ELOBOARD 응답이 너무 커서 중단했어.");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 5_000_000) throw new Error("ELOBOARD 응답이 너무 커서 중단했어.");
      const htmlText = decodeResponse(buffer, response.headers.get("content-type"));
      const error = pageError(htmlText);
      if (!error) return htmlText;
      lastError = new Error(error);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  throw lastError || new Error("ELOBOARD 페이지를 불러오지 못했어.");
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await iteratee(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function resolveProfile(player) {
  const searchUrl = `${ELO_BOARD_URL}?bo_table=bj_list&device=pc&sfl=wr_subject&stx=${encodeURIComponent(player)}`;
  const searchHtml = await requestEloPage(searchUrl);
  let profileId = parseProfileId(searchHtml, player);
  if (!profileId) profileId = parseProfileId(await requestEloPage(ELO_RANK_URL), player);
  if (!profileId) {
    throw new Error(`ELOBOARD에서 '${player}' 선수의 개인 페이지를 찾지 못했어. ELOBOARD에 표시된 이름을 그대로 입력해줘.`);
  }
  return { id: profileId, player };
}

async function eloPreview(url) {
  const player = String(url.searchParams.get("player") || "").trim();
  const fromDate = String(url.searchParams.get("fromDate") || "").trim();
  const requestedMaximum = Number(url.searchParams.get("pages") || 25);
  const maximum = Math.min(100, Math.max(10, Number.isFinite(requestedMaximum) ? requestedMaximum : 25));
  if (player.length < 2 || player.length > 30) throw new ResponseError(400, "선수 이름을 2~30자로 입력해줘.");
  if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new ResponseError(400, "조회 시작 날짜가 올바르지 않아.");
  }

  const profile = await resolveProfile(player);
  const profileUrl = `${ELO_BOARD_URL}?bo_table=bj_list&device=pc&wr_id=${profile.id}`;
  const profileHtml = await requestEloPage(profileUrl);
  const allProfileDates = [...profileHtml.matchAll(/20\d{2}[-.]\d{2}[-.]\d{2}/g)]
    .map((match) => parseDate(match[0]))
    .filter(Boolean)
    .sort()
    .reverse();
  const latestAvailableDate = allProfileDates[0] || "";
  const references = matchReferences(profileHtml, fromDate, maximum);
  const directItems = parseProfileRows(profileHtml, player, profile.id).filter(
    (item) => !fromDate || item.date >= fromDate,
  );
  const detailItems = (
    await mapLimit(references, 3, async (reference) => {
      try {
        const detailUrl = `${ELO_BOARD_URL}?bo_table=bj_board&device=pc&wr_id=${reference.id}`;
        const detailHtml = await requestEloPage(detailUrl, 2);
        const item = parseEloDetail(detailHtml, player, reference.id);
        return !item || (fromDate && item.date < fromDate) ? null : item;
      } catch {
        return null;
      }
    })
  ).filter(Boolean);
  const found = new Map();
  for (const item of [...detailItems, ...directItems]) {
    if (!found.has(item.sourceId)) found.set(item.sourceId, item);
  }
  if (!found.size && references.length) {
    throw new Error("선수 개인 페이지는 찾았지만 전적 내용을 읽지 못했어. ELOBOARD 화면 구성이 바뀌었을 수 있어.");
  }
  return {
    items: [...found.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || b.sourceId.localeCompare(a.sourceId),
    ),
    scannedPages: 1,
    checkedMatches: references.length,
    profileId: profile.id,
    lookupMode: "player-profile",
    latestAvailableDate,
  };
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
    if (url.pathname === "/health") return json({ ok: true }, 200, origin);
    if (url.pathname !== "/api/elo/preview") return json({ error: "not found" }, 404, origin);
    try {
      return json(await eloPreview(url), 200, origin);
    } catch (error) {
      return json(
        { error: error?.message || "ELOBOARD 전적을 가져오지 못했어. 잠시 후 다시 시도해줘." },
        error?.status || 502,
        origin,
      );
    }
  },
};

export const __test = {
  normalizeName,
  pageError,
  parseEloDetail,
  parseProfileId,
  parseProfileRows,
};
