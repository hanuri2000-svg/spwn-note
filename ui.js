const STORAGE_KEY = "spawnNote.records.v1";
const PLAYER_KEY = "spawnNote.eloPlayer";
const DASHBOARD_CACHE_KEY = "spawnNote.eloDashboard.v1";
const RIVAL_PLAYER_KEY = "spawnNote.rivalPlayer";
const RIVAL_OPPONENT_KEY = "spawnNote.rivalOpponent";
const TIER_CACHE_KEY = "spawnNote.tierTable.v1";
const LEGACY_STORAGE_KEY = "new" + "catsleSpawnNote.records.v1";
const LEGACY_PLAYER_KEY = "new" + "catsleEloPlayer";
const ELO_API_BASE = String(window.SPAWN_NOTE_ELO_API_BASE || "").replace(/\/$/, "");
const LIVE_API_BASE = "https://dorang-live.hajimayo8130.workers.dev";
const TIER_LIVE_NAME_ALIASES = {
  낭니: ["냥니"],
  빵체리: ["땡세리"],
  럭키위키: ["럭키워키"],
};

let records = [];
let eloPreviewRecords = [];
let eloDashboard = null;
let eloDashboardPlayer = "";
let eloDashboardLoading = false;
let eloDashboardError = "";
let tierPayload = null;
let tierLive = {};
let tierLiveByName = {};
let tierLoading = false;
let tierLiveLoading = false;
let tierError = "";
let tierLiveStatus = "LIVE 확인 준비 중";
let tierRace = "ALL";
let tierLevels = new Set();
let tierSearch = "";
let tierLiveOnly = false;
let tierRefreshTimer = null;

const $ = (selector) => document.querySelector(selector);
const form = document.getElementById("form");
const dlg = document.getElementById("dlg");
const eloDlg = document.getElementById("eloDlg");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

function cleanRecord(record) {
  const clean = { ...(record || {}) };
  clean.feedback = clean.feedback == null ? "" : String(clean.feedback);
  clean.note = clean.note == null ? "" : String(clean.note);
  clean.id = Number(clean.id) || Date.now();
  return clean;
}

function readRecords() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy = current == null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const stored = JSON.parse(current ?? legacy ?? "[]");
    if (current == null && legacy != null && Array.isArray(stored)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
    return Array.isArray(stored) ? stored.map(cleanRecord) : [];
  } catch (error) {
    console.error("저장된 기록을 읽지 못했어.", error);
    return [];
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    alert("브라우저 저장 공간에 기록을 저장하지 못했어. 먼저 JSON 백업을 받아줘.");
    throw error;
  }
}

function getBasePlayer() {
  return String(
    localStorage.getItem(PLAYER_KEY) ||
      localStorage.getItem(RIVAL_PLAYER_KEY) ||
      localStorage.getItem(LEGACY_PLAYER_KEY) ||
      "",
  ).trim();
}

function saveBasePlayerName(player) {
  localStorage.setItem(PLAYER_KEY, player);
  localStorage.setItem(RIVAL_PLAYER_KEY, player);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readDashboardCache(player) {
  try {
    const cached = JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || "null");
    return cached && normalizeName(cached.player) === normalizeName(player) ? cached.data : null;
  } catch {
    return null;
  }
}

function writeDashboardCache(player, data) {
  try {
    localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ player, data }));
  } catch (error) {
    console.warn("ELOBOARD 대시보드 임시 저장에 실패했어.", error);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어.");
  return data;
}

function load() {
  records = readRecords();
  const player = getBasePlayer();
  if (player) {
    saveBasePlayerName(player);
    eloDashboard = readDashboardCache(player);
    eloDashboardPlayer = player;
  }
  loadBasePlayerInputs();
  if (new URLSearchParams(location.search).get("embed") === "1") {
    $("#tierTab")?.classList.add("hidden");
  }
  renderAll();
  loadRivalInputs();
  if (player) refreshEloDashboard();
}

function pct(wins, total) {
  return total ? Math.round((wins / total) * 1000) / 10 : 0;
}

function stat(list) {
  const wins = list.filter((record) => record.result === "승").length;
  const losses = list.filter((record) => record.result === "패").length;
  return { w: wins, l: losses, t: wins + losses, p: pct(wins, wins + losses) };
}

function renderAll() {
  renderDash();
  renderTable();
}

function showTab(tab) {
  $("#dash").classList.toggle("hidden", tab !== "dash");
  $("#log").classList.toggle("hidden", tab !== "log");
  $("#tier").classList.toggle("hidden", tab !== "tier");
  $("#dashTab").classList.toggle("active", tab === "dash");
  $("#logTab").classList.toggle("active", tab === "log");
  $("#tierTab").classList.toggle("active", tab === "tier");
  if (tab === "tier" && !tierPayload && !tierLoading) loadTierTable();
}

function renderDash() {
  const player = getBasePlayer();
  const summary =
    eloDashboard && normalizeName(eloDashboardPlayer) === normalizeName(player)
      ? eloDashboard
      : null;
  const blank = { wins: 0, losses: 0, games: 0, winRate: 0 };
  const allStats = summary?.overall || blank;
  const monthStats = summary?.month || blank;
  const weekStats = summary?.week || blank;
  const last = [...records].sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id),
  )[0];
  const statText = (value) => (summary ? `${value.wins}승 ${value.losses}패` : "-");
  const statSub = (value) =>
    summary ? `총 ${value.games}경기 · 승률 ${value.winRate}%` : player ? "ELOBOARD 조회 중" : "기준 선수 설정 필요";

  $("#cards").innerHTML =
    card("🏆 전체 전적", statText(allStats), statSub(allStats)) +
    card("📅 이번 달", statText(monthStats), statSub(monthStats)) +
    card("📆 이번 주", statText(weekStats), statSub(weekStats)) +
    card("🎮 총 경기", summary ? `${summary.totalGames}경기` : "-", "ELOBOARD 전체 공식전") +
    card("📌 최근 작성", last ? last.date : "-", "내 스폰일지");

  $("#races").innerHTML = [
    { race: "T", raceLabel: "테란" },
    { race: "Z", raceLabel: "저그" },
    { race: "P", raceLabel: "토스" },
  ]
    .map((raceInfo) => {
      const raceStats = summary?.races?.find((item) => item.race === raceInfo.race) || blank;
      const icon = raceInfo.race === "T" ? "👽" : raceInfo.race === "Z" ? "🐜" : "⚔️";
      return `<div class="race"><b>${icon} vs ${raceInfo.raceLabel}</b><div class="big">${
        summary ? `${raceStats.wins}승 ${raceStats.losses}패` : "-"
      }</div><div class="sub">${
        summary ? `총 ${raceStats.games}경기 · 승률 ${raceStats.winRate}%` : "ELOBOARD 기준"
      }</div></div>`;
    })
    .join("");

  const recent = [...records]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
    .slice(0, 10);
  $("#recent").innerHTML = recent.length
    ? recent
        .map(
          (record) =>
            `<div class="${record.result === "승" ? "win" : "lose"}"><b>${esc(
              record.result,
            )}</b> · ${esc(record.date)} · vs ${esc(record.opponent)} (${esc(
              record.race || "-",
            )}) · ${esc(record.map || "-")} ${
              record.source === "eloboard" ? '<span class="elo-badge">ELO</span>' : ""
            }</div>`,
        )
        .join("")
    : '<div class="empty">기록이 없어</div>';

  renderBasePlayerStatus();
}

function card(heading, body, sub) {
  return `<div class="card"><h3>${heading}</h3><div class="big">${body}</div><div class="sub">${sub}</div></div>`;
}

function loadBasePlayerInputs() {
  const player = getBasePlayer();
  const input = $("#basePlayer");
  if (input) input.value = player;
  const eloPlayer = $("#eloPlayer");
  if (eloPlayer) eloPlayer.value = player;
}

function renderBasePlayerStatus() {
  const status = $("#basePlayerStatus");
  if (!status) return;
  const player = getBasePlayer();
  if (!player) {
    status.textContent = "ELOBOARD에 등록된 여자부 선수 이름을 한 번 저장해줘.";
    return;
  }
  if (eloDashboardLoading) {
    status.textContent = `${player} 선수의 ELOBOARD 전체 공식전 통계를 불러오고 있어…`;
    return;
  }
  if (eloDashboardError) {
    status.textContent = eloDashboardError;
    return;
  }
  if (eloDashboard?.player) {
    const info = eloDashboard.player;
    status.textContent = `${info.name} · ${info.raceLabel || "종족 미상"} · ELO ${
      info.elo || "-"
    }${eloDashboard.latestMatchDate ? ` · 최근 경기 ${eloDashboard.latestMatchDate}` : ""}`;
    return;
  }
  status.textContent = `${player} 선수를 기준으로 ELOBOARD 통계를 준비하고 있어.`;
}

async function refreshEloDashboard() {
  const player = getBasePlayer();
  if (!player || !ELO_API_BASE) {
    eloDashboardError = !ELO_API_BASE ? "ELO 조회 서버가 아직 연결되지 않았어." : "";
    renderDash();
    return;
  }
  eloDashboardLoading = true;
  eloDashboardError = "";
  renderDash();
  const button = $("#basePlayerSaveButton");
  if (button) button.disabled = true;
  try {
    const query = new URLSearchParams({ player, today: localDateKey() });
    const data = await fetchJson(`${ELO_API_BASE}/api/elo/dashboard?${query}`);
    eloDashboard = data;
    eloDashboardPlayer = player;
    writeDashboardCache(player, data);
  } catch (error) {
    eloDashboardError = error.message;
  } finally {
    eloDashboardLoading = false;
    if (button) button.disabled = false;
    renderDash();
  }
}

async function saveBasePlayer() {
  const input = $("#basePlayer");
  const player = String(input?.value || "").trim();
  if (!player || player.length > 30) {
    eloDashboardError = "기준 선수 이름을 1~30자로 입력해줘.";
    renderBasePlayerStatus();
    return;
  }
  const changed = normalizeName(player) !== normalizeName(getBasePlayer());
  saveBasePlayerName(player);
  if (changed) {
    eloDashboard = readDashboardCache(player);
    eloDashboardPlayer = player;
  }
  loadBasePlayerInputs();
  loadRivalInputs();
  $("#rivalResult")?.classList.add("hidden");
  await refreshEloDashboard();
}

function loadRivalInputs() {
  const baseInput = $("#rivalPlayer");
  const opponentInput = $("#rivalOpponent");
  if (!baseInput || !opponentInput) return;
  const player = getBasePlayer();
  baseInput.value = player;
  const baseName = $("#rivalBaseName");
  if (baseName) baseName.textContent = player || "먼저 기준 선수를 저장해줘";
  opponentInput.value = localStorage.getItem(RIVAL_OPPONENT_KEY) || "";
  $("#rivalStatus").textContent = !player
    ? "위에서 기준 선수를 먼저 저장해줘."
    : ELO_API_BASE
      ? `${player} 선수를 기준으로 상대 이름만 입력하면 돼.`
    : "ELO 조회 중계 서버가 아직 연결되지 않았어.";
}

function raceMark(race) {
  return race ? `<span class="rival-race ${esc(race)}">${esc(race)}</span>` : "";
}

function renderRivalResult(data) {
  const base = data.base || {};
  const opponent = data.opponent || {};
  const head = data.headToHead || {};
  const recent = Array.isArray(data.recentMatches) ? data.recentMatches : [];
  $("#rivalStatus").textContent = head.games
    ? `ELOBOARD 전체 기록에서 ${head.games}경기를 찾았어.${
        head.lastPlayedOn ? ` 최근 맞대결은 ${head.lastPlayedOn}이야.` : ""
      }`
    : "ELOBOARD에 두 선수의 맞대결 기록이 없어.";
  $("#rivalResult").innerHTML = `
    <div class="rival-scoreboard">
      <div class="rival-player"><div>${raceMark(base.race)}<b>${esc(base.name)}</b></div><span>ELO ${esc(base.elo || "-")}</span></div>
      <div class="rival-score"><b>${Number(head.wins || 0)}</b><em>:</em><b>${Number(head.losses || 0)}</b><span>${Number(head.winRate || 0)}% · ${Number(head.games || 0)}경기</span></div>
      <div class="rival-player right"><div>${raceMark(opponent.race)}<b>${esc(opponent.name)}</b></div><span>ELO ${esc(opponent.elo || "-")}</span></div>
    </div>
    <div class="rival-overall">
      <span><b>${esc(base.name)}</b> 통산 ${Number(base.wins || 0)}승 ${Number(base.losses || 0)}패 · ${Number(base.winRate || 0)}%</span>
      <span><b>${esc(opponent.name)}</b> 통산 ${Number(opponent.wins || 0)}승 ${Number(opponent.losses || 0)}패 · ${Number(opponent.winRate || 0)}%</span>
    </div>
    <div class="rival-recent">
      <h3>최근 맞대결</h3>
      ${
        recent.length
          ? recent
              .map(
                (match) =>
                  `<div class="${match.result === "승" ? "win" : "lose"}"><b>${esc(
                    match.result,
                  )}</b> · ${esc(match.date)} · ${esc(match.map || "-")} · ${esc(match.type || "-")}</div>`,
              )
              .join("")
          : '<div class="empty rival-empty">최근 경기 정보가 없어</div>'
      }
    </div>`;
  $("#rivalResult").classList.remove("hidden");
}

async function searchRival() {
  const player = getBasePlayer();
  const opponent = $("#rivalOpponent").value.trim();
  if (!player || !opponent) {
    $("#rivalStatus").textContent = player
      ? "상대 선수 이름을 입력해줘."
      : "위에서 기준 선수를 먼저 저장해줘.";
    return;
  }
  if (normalizeName(player) === normalizeName(opponent)) {
    $("#rivalStatus").textContent = "서로 다른 선수 이름을 입력해줘.";
    return;
  }
  if (!ELO_API_BASE) {
    $("#rivalStatus").textContent = "ELO 조회 서버가 아직 연결되지 않았어.";
    return;
  }

  localStorage.setItem(RIVAL_OPPONENT_KEY, opponent);
  $("#rivalSearchButton").disabled = true;
  $("#rivalStatus").textContent = "ELOBOARD에서 상대전적을 확인하고 있어…";
  $("#rivalResult").classList.add("hidden");
  try {
    const query = new URLSearchParams({ player, opponent });
    renderRivalResult(await fetchJson(`${ELO_API_BASE}/api/elo/rival?${query}`));
  } catch (error) {
    $("#rivalStatus").textContent = error.message;
    $("#rivalResult").innerHTML = "";
  } finally {
    $("#rivalSearchButton").disabled = false;
  }
}

function readTierCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(TIER_CACHE_KEY) || "null");
    return Array.isArray(cached?.tiers) ? cached : null;
  } catch {
    return null;
  }
}

function writeTierCache(data) {
  try {
    localStorage.setItem(TIER_CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("티어표 임시 저장에 실패했어.", error);
  }
}

function tierProfileUrl(player) {
  return player.playerId ? `https://eloboard.co.kr/players/${encodeURIComponent(player.playerId)}` : "#";
}

function normalizeTierLiveName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function tierPlayerLiveUrl(player) {
  const soopId = String(player.soopId || "").toLowerCase();
  if (soopId && tierLive[soopId]) return tierLive[soopId];

  const names = [player.name, ...(TIER_LIVE_NAME_ALIASES[player.name] || [])]
    .map(normalizeTierLiveName)
    .filter(Boolean);
  for (const name of names) {
    if (tierLiveByName[name]) return tierLiveByName[name];
  }

  const matches = Object.entries(tierLiveByName).filter(([nickname]) =>
    names.some((name) => nickname.startsWith(name)),
  );
  return matches.length === 1 ? matches[0][1] : "";
}

function tierPlayerCard(player) {
  const liveUrl = tierPlayerLiveUrl(player);
  const channelUrl = player.soopId ? `https://ch.sooplive.co.kr/${encodeURIComponent(player.soopId)}` : "";
  const imageUrl = player.thumbUrl ? `https://eloboard.co.kr/static/${player.thumbUrl}` : "";
  const avatarUrl = liveUrl || channelUrl || tierProfileUrl(player);
  return `<div class="tier-player race-${esc(player.race)}">
    <a class="tier-avatar-link" href="${esc(avatarUrl)}" target="_blank" rel="noopener noreferrer" title="${
      liveUrl ? "현재 SOOP 방송 보기" : "선수 정보 보기"
    }">
      ${
        imageUrl
          ? `<img class="tier-avatar" src="${esc(imageUrl)}" alt="${esc(
              player.name,
            )} 프로필" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`
          : ""
      }
      <span class="tier-avatar-fallback" style="${imageUrl ? "display:none" : ""}">${esc(
        String(player.name || "?").slice(0, 1),
      )}</span>
    </a>
    <b class="tier-race">${esc(player.race)}</b>
    <a class="tier-player-name" href="${esc(tierProfileUrl(player))}" target="_blank" rel="noopener noreferrer">${esc(
      player.name,
    )}</a>
    ${
      liveUrl
        ? `<a class="tier-live" href="${esc(
            liveUrl,
          )}" target="_blank" rel="noopener noreferrer">● LIVE</a>`
        : ""
    }
  </div>`;
}

function renderTierTable() {
  const status = $("#tierStatus");
  const filterBox = $("#tierLevelFilters");
  const groupBox = $("#tierGroups");
  if (!status || !filterBox || !groupBox) return;

  const tiers = Array.isArray(tierPayload?.tiers) ? tierPayload.tiers : [];
  status.textContent = tierLoading
    ? "ELOBOARD 최신 티어표를 불러오고 있어…"
    : tierError ||
      (tierPayload
        ? `v${tierPayload.version || "-"} · ${tierPayload.updatedOn || "기준일 미상"} 기준 · ${tierLiveStatus}`
        : "티어표를 열면 ELOBOARD 최신 자료를 확인해.");

  filterBox.innerHTML = tiers.length
    ? `<button class="${tierLevels.size ? "" : "active"}" onclick="toggleTierLevel('ALL')">전체</button>${tiers
        .map(
          (tier) =>
            `<button class="${tierLevels.has(tier.label) ? "active" : ""}" onclick="toggleTierLevel('${esc(
              tier.label,
            )}')">${tierLevels.has(tier.label) ? "✓ " : ""}${esc(tier.label)}</button>`,
        )
        .join("")}`
    : "";

  document.querySelectorAll("[data-tier-race]").forEach((button) =>
    button.classList.toggle("active", button.dataset.tierRace === tierRace),
  );
  $("#tierLiveOnly")?.classList.toggle("active", tierLiveOnly);
  if ($("#tierLiveOnly")) {
    $("#tierLiveOnly").textContent = tierLiveOnly ? "✓ LIVE만" : "○ LIVE만";
    $("#tierLiveOnly").setAttribute?.("aria-pressed", String(tierLiveOnly));
  }

  const query = tierSearch.trim().toLowerCase();
  const groups = tiers
    .filter((tier) => !tierLevels.size || tierLevels.has(tier.label))
    .map((tier) => {
      const players = (tier.players || []).filter((player) => {
        const live = tierPlayerLiveUrl(player);
        return (
          (tierRace === "ALL" || player.race === tierRace) &&
          (!query || String(player.name || "").toLowerCase().includes(query)) &&
          (!tierLiveOnly || live)
        );
      });
      if (!players.length) return "";
      return `<section class="tier-group"><header><h3>${esc(tier.label)}</h3><span>${
        players.length
      }명</span></header><div class="tier-players">${players.map(tierPlayerCard).join("")}</div></section>`;
    })
    .join("");

  groupBox.innerHTML = groups || '<div class="empty tier-empty">조건에 맞는 선수가 없어</div>';
  const refreshButton = $("#tierRefreshButton");
  if (refreshButton) refreshButton.disabled = tierLoading || tierLiveLoading;
}

async function fetchTierLive() {
  tierLiveLoading = true;
  try {
    const data = await fetchJson(`${LIVE_API_BASE}/?t=${Date.now()}`, { cache: "no-store" });
    const broadcasts = Array.isArray(data.live) ? data.live : [];
    tierLive = Object.fromEntries(
      broadcasts
        .filter((broadcast) => broadcast.soop_id)
        .map((broadcast) => [
          String(broadcast.soop_id).toLowerCase(),
          broadcast.url || `https://ch.sooplive.co.kr/${broadcast.soop_id}`,
        ]),
    );
    tierLiveByName = Object.fromEntries(
      broadcasts
        .map((broadcast) => [
          normalizeTierLiveName(broadcast.nick || broadcast.nickname),
          broadcast.url ||
            (broadcast.soop_id ? `https://ch.sooplive.co.kr/${broadcast.soop_id}` : ""),
        ])
        .filter(([nickname, url]) => nickname && url),
    );
    const checked = new Date(data.updatedAt || Date.now());
    tierLiveStatus = `LIVE ${checked.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })} 확인 · 60초 자동 갱신`;
  } catch {
    tierLiveStatus = "LIVE 연결 실패 · 티어표는 정상 표시 중";
  } finally {
    tierLiveLoading = false;
  }
}

async function loadTierTable(force = false) {
  if (tierLoading) return;
  if (!tierPayload) tierPayload = readTierCache();
  if (!ELO_API_BASE) {
    tierError = "ELO 조회 서버가 아직 연결되지 않았어.";
    renderTierTable();
    return;
  }
  tierLoading = true;
  tierError = "";
  renderTierTable();
  try {
    const requests = [fetchJson(`${ELO_API_BASE}/api/elo/tiers${force ? `?t=${Date.now()}` : ""}`), fetchTierLive()];
    const [tierResult] = await Promise.allSettled(requests);
    if (tierResult.status === "rejected") throw tierResult.reason;
    tierPayload = tierResult.value;
    writeTierCache(tierPayload);
    if (!tierRefreshTimer) {
      tierRefreshTimer = setInterval(() => {
        if (!$("#tier")?.classList.contains("hidden")) fetchTierLive().then(renderTierTable);
      }, 60000);
    }
  } catch (error) {
    tierError = tierPayload
      ? `${error.message} 저장된 티어표를 대신 표시하고 있어.`
      : error.message;
  } finally {
    tierLoading = false;
    renderTierTable();
  }
}

function toggleTierLevel(level) {
  if (level === "ALL") tierLevels.clear();
  else if (tierLevels.has(level)) tierLevels.delete(level);
  else tierLevels.add(level);
  renderTierTable();
}

function setTierRace(race) {
  tierRace = race;
  renderTierTable();
}

function setTierSearch(value) {
  tierSearch = value;
  renderTierTable();
}

function toggleTierLiveOnly() {
  tierLiveOnly = !tierLiveOnly;
  renderTierTable();
}

function eloDetails(record) {
  if (record.source !== "eloboard") return "";
  const parts = ["ELOBOARD에서 가져온 기록"];
  if (record.eloChange) parts.push(`ELO 변동 ${record.eloChange}`);
  if (record.eloMatchType) parts.push(record.eloMatchType);
  if (record.eloMemo) parts.push(record.eloMemo);
  return `<div class="elo-detail">${parts.map(esc).join(" · ")}</div>`;
}

function renderTable() {
  const query = ($("#search")?.value || "").toLowerCase();
  const list = [...records]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
    .filter(
      (record) =>
        !query ||
        Object.values(record).some((value) => String(value).toLowerCase().includes(query)),
    );

  $("#tbody").innerHTML =
    list
      .map((record) => {
        let notePreview = (record.note || "내용 없음").replace(/\s+/g, " ").trim();
        if (notePreview.length > 28) notePreview = `${notePreview.slice(0, 28)}…`;
        let feedbackPreview = (record.feedback || "내용 없음").replace(/\s+/g, " ").trim();
        if (feedbackPreview.length > 28) feedbackPreview = `${feedbackPreview.slice(0, 28)}…`;
        const sourceBadge =
          record.source === "eloboard" ? ' <span class="elo-badge">ELO</span>' : "";
        return `<tr class="game-row ${
          record.result === "승" ? "win" : "lose"
        }" onclick="toggleNote(${Number(record.id)})" title="클릭하면 느낀점과 피드백 전체 내용을 볼 수 있어"><td>${esc(
          record.date,
        )}</td><td>${esc(record.opponent)}${sourceBadge}</td><td>${esc(
          record.tier,
        )}</td><td>${esc(record.race)}</td><td><b>${esc(
          record.result,
        )}</b></td><td>${esc(record.myBuild)}</td><td>${esc(
          record.enemyBuild,
        )}</td><td>${esc(record.map)}</td><td>${esc(
          record.cause,
        )}</td><td class="note-preview">${esc(notePreview)}</td><td class="note-preview">${esc(
          feedbackPreview,
        )}</td><td><button class="btn secondary" onclick="event.stopPropagation();editRec(${Number(
          record.id,
        )})">수정</button> <button class="btn danger" onclick="event.stopPropagation();delRec(${Number(
          record.id,
        )})">삭제</button></td></tr><tr id="note-${Number(record.id)}" class="note-row hidden ${
          record.result === "승" ? "win" : "lose"
        }"><td colspan="12">${eloDetails(
          record,
        )}<div class="note-label">느낀점 전체 내용</div><div class="note-text">${esc(
          record.note || "내용 없음",
        )}</div><div class="note-label feedback-label">피드백 전체 내용</div><div class="note-text">${esc(
          record.feedback || "내용 없음",
        )}</div></td></tr>`;
      })
      .join("") || '<tr><td colspan="12" class="empty">검색 결과가 없어</td></tr>';
}

function toggleNote(id) {
  document.getElementById(`note-${id}`)?.classList.toggle("hidden");
}

function openForm() {
  form.reset();
  form.id.value = "";
  form.date.value = new Date().toISOString().slice(0, 10);
  $("#formTitle").textContent = "기록 추가";
  dlg.showModal();
}

function editRec(id) {
  const record = records.find((item) => Number(item.id) === Number(id));
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
  $("#formTitle").textContent = "기록 수정";
  dlg.showModal();
}

function submitForm(event) {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const id = fields.id ? Number(fields.id) : Date.now();
  const index = records.findIndex((record) => Number(record.id) === id);
  const record = cleanRecord({ ...(index >= 0 ? records[index] : {}), ...fields, id });
  if (index >= 0) records[index] = record;
  else records.push(record);
  saveRecords();
  dlg.close();
  renderAll();
}

function delRec(id) {
  if (!confirm("이 기록을 삭제할까?")) return;
  records = records.filter((record) => Number(record.id) !== Number(id));
  saveRecords();
  renderAll();
}

function download(name, text, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`\ufeff${text}`], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportJson() {
  download("스폰노트_백업.json", JSON.stringify(records, null, 2), "application/json");
}

function exportCsv() {
  const keys = [
    "date",
    "opponent",
    "tier",
    "race",
    "result",
    "myBuild",
    "enemyBuild",
    "map",
    "cause",
    "note",
    "feedback",
  ];
  const heads = [
    "날짜",
    "상대",
    "티어",
    "종족",
    "승패",
    "사용 빌드",
    "상대 빌드",
    "맵",
    "패인",
    "느낀점",
    "피드백",
  ];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  download(
    "스폰노트.csv",
    [heads.map(quote).join(","), ...records.map((record) => keys.map((key) => quote(record[key])).join(","))].join("\r\n"),
    "text/csv",
  );
}

async function importJson(element) {
  const file = element.files[0];
  if (!file) return;
  try {
    const text = (await file.text()).replace(/^\ufeff/, "");
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("백업 형식 오류");
    if (!confirm("현재 기록을 백업 파일 내용으로 교체할까?")) return;
    records = data.map(cleanRecord);
    saveRecords();
    renderAll();
    alert("불러오기 완료");
  } catch {
    alert("올바른 백업 파일이 아니야");
  } finally {
    element.value = "";
  }
}

function resetAllRecords() {
  if (!confirm("스폰일지의 모든 기록을 삭제할까?\n삭제한 기록은 되돌릴 수 없어.")) return;
  if (!confirm("정말 전체 기록을 리셋할까?\n필요하면 먼저 백업 저장을 눌러줘.")) return;
  records = [];
  saveRecords();
  renderAll();
  alert("스폰일지 기록을 모두 리셋했어");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function recordKey(record) {
  return [record.date, normalizeName(record.opponent), record.result, normalizeName(record.map)].join("|");
}

function markDuplicates(items) {
  const sourceIds = new Set(records.map((record) => record.sourceId).filter(Boolean));
  const existingCounts = new Map();
  for (const record of records) {
    const key = recordKey(record);
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
  }
  const seenCounts = new Map();
  return items.map((item) => {
    const key = recordKey(item);
    const occurrence = (seenCounts.get(key) || 0) + 1;
    seenCounts.set(key, occurrence);
    return {
      ...item,
      duplicate: sourceIds.has(item.sourceId) || occurrence <= (existingCounts.get(key) || 0),
    };
  });
}

function openEloDialog() {
  eloPreviewRecords = [];
  const savedPlayer = getBasePlayer();
  $("#eloPlayer").value = savedPlayer;
  const latestDate = [...records]
    .map((record) => record.date)
    .filter(Boolean)
    .sort()
    .at(-1);
  $("#eloFromDate").value =
    latestDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  $("#eloStatus").textContent = ELO_API_BASE
    ? savedPlayer
      ? "기준 선수와 조회 시작 날짜를 확인한 뒤 전적 조회를 눌러줘."
      : "대시보드에서 기준 선수를 먼저 저장해줘."
    : "ELO 자동 조회 중계 서버가 아직 연결되지 않았어.";
  $("#eloPreviewBody").innerHTML =
    '<tr><td colspan="8" class="empty">아직 조회하지 않았어</td></tr>';
  $("#eloImportButton").disabled = true;
  $("#eloSelectAll").checked = false;
  eloDlg.showModal();
}

async function previewElo() {
  const player = $("#eloPlayer").value.trim();
  const fromDate = $("#eloFromDate").value;
  const pages = $("#eloPages").value;
  if (!player) {
    alert("대시보드에서 기준 선수를 먼저 저장해줘.");
    return;
  }
  if (!ELO_API_BASE) {
    $("#eloStatus").textContent =
      "ELO 조회 서버 주소가 설정되지 않았어. 저장소의 config.js에 중계 서버 주소를 입력해줘.";
    return;
  }
  $("#eloLookupButton").disabled = true;
  $("#eloImportButton").disabled = true;
  $("#eloStatus").textContent = "ELOBOARD에서 전적을 확인하고 있어…";
  $("#eloPreviewBody").innerHTML = '<tr><td colspan="8" class="empty">조회 중이야…</td></tr>';

  try {
    const query = new URLSearchParams({ player, fromDate, pages });
    const data = await fetchJson(`${ELO_API_BASE}/api/elo/preview?${query}`);
    eloPreviewRecords = markDuplicates(data.items || []);
    renderEloPreview({ ...data, items: eloPreviewRecords });
  } catch (error) {
    eloPreviewRecords = [];
    $("#eloStatus").textContent = error.message;
    $("#eloPreviewBody").innerHTML =
      '<tr><td colspan="8" class="empty">전적을 불러오지 못했어</td></tr>';
  } finally {
    $("#eloLookupButton").disabled = false;
  }
}

function renderEloPreview(data = {}) {
  const newCount = eloPreviewRecords.filter((record) => !record.duplicate).length;
  const duplicateCount = eloPreviewRecords.length - newCount;
  const checkedMatches = Number(data.checkedMatches || eloPreviewRecords.length);
  const fromDate = $("#eloFromDate").value;
  $("#eloStatus").textContent = eloPreviewRecords.length
    ? `ELOBOARD 스폰 전적 ${checkedMatches}경기를 확인해 ${eloPreviewRecords.length}경기를 찾았어. 새 기록 ${newCount}개, 기존 기록과 겹치는 항목 ${duplicateCount}개야.`
    : data.latestAvailableDate && fromDate > data.latestAvailableDate
      ? `개인 페이지의 최신 전적은 ${data.latestAvailableDate}이야. 조회 시작 날짜를 그 날짜 이전으로 바꿔줘.`
      : "선수의 스폰 전적을 확인했지만 조건에 맞는 기록이 없어. 조회 시작 날짜를 더 이전으로 조정해봐.";

  $("#eloPreviewBody").innerHTML =
    eloPreviewRecords
      .map(
        (record, index) =>
          `<tr class="${record.duplicate ? "elo-duplicate" : ""}"><td><input class="elo-check" type="checkbox" data-index="${index}" ${
            record.duplicate ? "disabled" : "checked"
          }></td><td>${esc(record.date)}</td><td>${esc(record.opponent)}</td><td>${esc(
            record.race || "-",
          )}</td><td><b>${esc(record.result)}</b></td><td>${esc(
            record.map || "-",
          )}</td><td>${esc(record.eloChange || "-")}</td><td>${
            record.duplicate ? "기존 기록" : esc(record.eloMatchType || "-")
          }</td></tr>`,
      )
      .join("") || '<tr><td colspan="8" class="empty">조건에 맞는 전적이 없어</td></tr>';
  $("#eloImportButton").disabled = newCount === 0;
  $("#eloSelectAll").checked = newCount > 0;
}

function toggleEloAll(checked) {
  document
    .querySelectorAll(".elo-check:not(:disabled)")
    .forEach((input) => (input.checked = checked));
}

function importSelectedElo() {
  const selected = [...document.querySelectorAll(".elo-check:checked")].map(
    (input) => eloPreviewRecords[Number(input.dataset.index)],
  );
  if (!selected.length) {
    alert("가져올 전적을 선택해줘.");
    return;
  }
  if (!confirm(`선택한 ELO 전적 ${selected.length}개를 스폰일지에 추가할까?`)) return;

  const sourceIds = new Set(records.map((record) => record.sourceId).filter(Boolean));
  const existingCounts = new Map();
  for (const record of records) {
    const key = recordKey(record);
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
  }
  const incomingCounts = new Map();
  let nextId = Math.max(0, ...records.map((record) => Number(record.id) || 0)) + 1;
  let added = 0;
  let skipped = 0;

  for (const raw of selected) {
    if (
      raw?.source !== "eloboard" ||
      !raw.sourceId ||
      !raw.date ||
      !raw.opponent ||
      !["승", "패"].includes(raw.result) ||
      sourceIds.has(raw.sourceId)
    ) {
      skipped += 1;
      continue;
    }
    const key = recordKey(raw);
    const occurrence = (incomingCounts.get(key) || 0) + 1;
    incomingCounts.set(key, occurrence);
    if (occurrence <= (existingCounts.get(key) || 0)) {
      skipped += 1;
      continue;
    }
    const record = cleanRecord({
      ...raw,
      id: nextId,
      source: "eloboard",
      tier: raw.tier || "",
      myBuild: raw.myBuild || "",
      enemyBuild: raw.enemyBuild || "",
      cause: raw.cause || "",
      note: raw.note || "",
      feedback: raw.feedback || "",
    });
    delete record.duplicate;
    records.push(record);
    sourceIds.add(record.sourceId);
    nextId += 1;
    added += 1;
  }

  saveRecords();
  renderAll();
  eloDlg.close();
  showTab("log");
  alert(`ELO 전적 ${added}개를 추가했어.${skipped ? ` 중복·오류 ${skipped}개는 제외했어.` : ""}`);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

load();
