const APP_VERSION = "1.8.1";
const STORAGE_KEY = "spawnNote.records.v1";
const LEGACY_STORAGE_KEY = "new" + "catsleSpawnNote.records.v1";
const PLAYER_MASTER_URL = "https://hanuri2000-svg.github.io/star-match-manager/players.json";

let records = [];
let masterPlayerDirectory = {};

const $ = (selector) => document.querySelector(selector);
const form = document.getElementById("form");
const dlg = document.getElementById("dlg");
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

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayKey(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDateKey(monday);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어.");
  return data;
}

async function latestAppVersion() {
  const response = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error("버전 정보를 확인하지 못했어.");
  const data = await response.json();
  const version = String(data.version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("버전 정보가 올바르지 않아.");
  return { ...data, version };
}

function versionNumbers(version) {
  return String(version || "").split(".").map((value) => Number(value) || 0);
}

function isNewerVersion(latest, current) {
  const a = versionNumbers(latest);
  const b = versionNumbers(current);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return true;
    if ((a[index] || 0) < (b[index] || 0)) return false;
  }
  return false;
}

async function checkForAppUpdate(manual = false) {
  const button = $("#updateButton");
  try {
    const latest = await latestAppVersion();
    if (isNewerVersion(latest.version, APP_VERSION)) {
      if (button) {
        button.textContent = "새 버전 v" + latest.version + " 적용";
        button.classList.add("update-available");
        button.title = latest.message || "새 업데이트가 있어";
      }
      if (manual) await applyLatestUpdate(latest.version);
      return latest;
    }
    if (button) {
      button.textContent = "최신 업데이트 적용";
      button.classList.remove("update-available");
      button.title = "현재 v" + APP_VERSION + " · 누르면 최신 파일을 다시 받아";
    }
    if (manual) await applyLatestUpdate(latest.version);
    return latest;
  } catch (error) {
    if (button) {
      button.textContent = "업데이트 재시도";
      button.title = error.message;
    }
    if (manual) alert(error.message);
    return null;
  }
}

async function applyLatestUpdate(knownVersion = "") {
  const button = $("#updateButton");
  if (button) {
    button.disabled = true;
    button.textContent = "업데이트 적용 중…";
  }
  try {
    const latest = knownVersion ? { version: knownVersion } : await latestAppVersion();
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("spawn-note-")).map((key) => caches.delete(key)),
      );
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
    }
    const url = new URL(location.href);
    url.searchParams.set("appVersion", latest.version);
    url.searchParams.set("updated", String(Date.now()));
    location.replace(url.toString());
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "업데이트 재시도";
    }
    alert(error.message || "최신 업데이트를 적용하지 못했어.");
  }
}

function pct(wins, total) {
  return total ? Math.round((wins / total) * 1000) / 10 : 0;
}

function stat(list) {
  const wins = list.filter((record) => record.result === "승").length;
  const losses = list.filter((record) => record.result === "패").length;
  return { w: wins, l: losses, t: wins + losses, p: pct(wins, wins + losses) };
}

function card(heading, body, sub) {
  return `<div class="card"><h3>${heading}</h3><div class="big">${body}</div><div class="sub">${sub}</div></div>`;
}

function statText(value) {
  return `${value.w}승 ${value.l}패`;
}

function statSub(value) {
  return `총 ${value.t}경기 · 승률 ${value.p}%`;
}

function normalizeRace(value) {
  const race = String(value || "").trim().toUpperCase();
  if (["T", "테란", "TERRAN"].includes(race)) return "T";
  if (["Z", "저그", "ZERG"].includes(race)) return "Z";
  if (["P", "토스", "프로토스", "PROTOSS"].includes(race)) return "P";
  return race;
}

function groupedLocalStats(key, emptyLabel, recentOrder = false) {
  const groups = new Map();
  records.forEach((record) => {
    const label = String(record[key] || "").trim() || emptyLabel;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(record);
  });
  const rows = [...groups.entries()].map(([label, list]) => ({
    label,
    ...stat(list),
    lastPlayedOn: list.reduce(
      (latest, record) => (String(record.date || "") > latest ? String(record.date || "") : latest),
      "",
    ),
  }));
  rows.sort((a, b) =>
    recentOrder
      ? b.lastPlayedOn.localeCompare(a.lastPlayedOn) || b.t - a.t || a.label.localeCompare(b.label, "ko")
      : b.t - a.t || b.p - a.p || a.label.localeCompare(b.label, "ko"),
  );
  return recentOrder ? rows.slice(0, 20) : rows;
}

function dashboardBreakdownTable(title, rows, sourceLabel) {
  const body = rows.length
    ? rows
        .map(
          (row, index) =>
            `<tr><td>${index + 1}</td><td><b>${esc(row.label)}</b></td><td>${row.w}승 ${row.l}패</td><td>${row.p}%</td><td><div class="dashboard-stat-bar"><i style="width:${Math.max(0, Math.min(100, row.p))}%"></i></div></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="empty">표시할 기록이 없어</td></tr>';
  return `<div class="dashboard-stat-panel"><h3>${title} <span class="dashboard-source-badge">${sourceLabel}</span></h3><div class="dashboard-stat-tablewrap"><table><thead><tr><th>#</th><th>구분</th><th>전적</th><th>승률</th><th>비율</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function renderDashboardBreakdowns() {
  const root = $("#dashboardBreakdowns");
  if (!root) return;
  root.innerHTML =
    dashboardBreakdownTable("맵별 전적", groupedLocalStats("map", "맵 미입력"), "스폰일지 기준") +
    dashboardBreakdownTable("빌드별 전적", groupedLocalStats("myBuild", "빌드 미입력"), "스폰일지 기준") +
    dashboardBreakdownTable(
      "상대 선수별 전적 · 최근 20명",
      groupedLocalStats("opponent", "상대 미입력", true),
      "스폰일지 기준",
    );
  const note = $("#dashboardBreakdownStatus");
  if (note) note.textContent = "모든 통계는 현재 스폰일지에 저장된 기록을 기준으로 계산돼.";
}

function renderDash() {
  const today = localDateKey();
  const monthKey = today.slice(0, 7);
  const weekStart = mondayKey();
  const allStats = stat(records);
  const monthStats = stat(records.filter((record) => String(record.date || "").startsWith(monthKey)));
  const weekStats = stat(
    records.filter((record) => String(record.date || "") >= weekStart && String(record.date || "") <= today),
  );
  const last = [...records].sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id),
  )[0];

  $("#cards").innerHTML =
    card("🏆 전체 전적", statText(allStats), statSub(allStats)) +
    card("📅 이번 달", statText(monthStats), statSub(monthStats)) +
    card("📆 이번 주", statText(weekStats), statSub(weekStats)) +
    card("🎮 총 경기", `${allStats.t}경기`, "스폰일지 저장 기록") +
    card("📌 최근 작성", last ? last.date : "-", "내 스폰일지");

  $("#races").innerHTML = [
    { race: "T", label: "테란", icon: "👽" },
    { race: "Z", label: "저그", icon: "🐜" },
    { race: "P", label: "토스", icon: "⚔️" },
  ]
    .map((item) => {
      const value = stat(records.filter((record) => normalizeRace(record.race) === item.race));
      return `<div class="race"><b>${item.icon} vs ${item.label}</b><div class="big">${statText(value)}</div><div class="sub">${statSub(value)}</div></div>`;
    })
    .join("");

  const recent = [...records]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
    .slice(0, 10);
  $("#recent").innerHTML = recent.length
    ? recent
        .map(
          (record) =>
            `<div class="${record.result === "승" ? "win" : "lose"}"><b>${esc(record.result)}</b> · ${esc(record.date)} · vs ${esc(record.opponent)} (${esc(record.race || "-")}) · ${esc(record.map || "-")}</div>`,
        )
        .join("")
    : '<div class="empty">기록이 없어</div>';

  renderDashboardBreakdowns();
}

function renderAll() {
  renderDash();
  renderTable();
}

function showTab(tab) {
  $("#dash").classList.toggle("hidden", tab !== "dash");
  $("#log").classList.toggle("hidden", tab !== "log");
  $("#dashTab").classList.toggle("active", tab === "dash");
  $("#logTab").classList.toggle("active", tab === "log");
}

function renderTable() {
  const query = ($("#search")?.value || "").toLowerCase();
  const list = [...records]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
    .filter(
      (record) =>
        !query || Object.values(record).some((value) => String(value).toLowerCase().includes(query)),
    );
  $("#tbody").innerHTML =
    list
      .map((record) => {
        let notePreview = (record.note || "내용 없음").replace(/\s+/g, " ").trim();
        if (notePreview.length > 28) notePreview = `${notePreview.slice(0, 28)}…`;
        let feedbackPreview = (record.feedback || "내용 없음").replace(/\s+/g, " ").trim();
        if (feedbackPreview.length > 28) feedbackPreview = `${feedbackPreview.slice(0, 28)}…`;
        const id = Number(record.id);
        return `<tr class="game-row ${record.result === "승" ? "win" : "lose"}" onclick="toggleNote(${id})" title="클릭하면 느낀점과 피드백 전체 내용을 볼 수 있어"><td>${esc(record.date)}</td><td>${esc(record.opponent)}</td><td>${esc(record.tier)}</td><td>${esc(record.race)}</td><td><b>${esc(record.result)}</b></td><td>${esc(record.myBuild)}</td><td>${esc(record.enemyBuild)}</td><td>${esc(record.map)}</td><td>${esc(record.cause)}</td><td class="note-preview">${esc(notePreview)}</td><td class="note-preview">${esc(feedbackPreview)}</td><td><button class="btn secondary" onclick="event.stopPropagation();editRec(${id})">수정</button> <button class="btn danger" onclick="event.stopPropagation();delRec(${id})">삭제</button></td></tr><tr id="note-${id}" class="note-row hidden ${record.result === "승" ? "win" : "lose"}"><td colspan="12"><div class="note-label">느낀점 전체 내용</div><div class="note-text">${esc(record.note || "내용 없음")}</div><div class="note-label feedback-label">피드백 전체 내용</div><div class="note-text">${esc(record.feedback || "내용 없음")}</div></td></tr>`;
      })
      .join("") || '<tr><td colspan="12" class="empty">검색 결과가 없어</td></tr>';
}

function toggleNote(id) {
  document.getElementById(`note-${id}`)?.classList.toggle("hidden");
}

function masterNameKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function sharedPlayerDirectory() {
  let parentDirectory = {};
  try {
    parentDirectory = window.parent?.HARINA_PLAYER_DIRECTORY || window.HARINA_PLAYER_DIRECTORY || {};
  } catch {}
  return Object.assign({}, parentDirectory, masterPlayerDirectory);
}

function findPlayerMeta(name) {
  return sharedPlayerDirectory()[masterNameKey(name)] || null;
}

function formTierValue(value) {
  return ({ 갓: "God", 킹: "King", 잭: "Jack", 조커: "Joker", 스페이드: "Spade", 베이비: "유스" })[value] || value || "";
}

function formRaceValue(value) {
  return ({ P: "토스", T: "테란", Z: "저그", R: "랜덤" })[String(value || "").toUpperCase()] || value || "";
}

function autoFillRecordPlayer(input) {
  if (!input || input !== form?.elements?.opponent) return;
  const meta = findPlayerMeta(input.value);
  if (!meta) return;
  if (form.elements.tier) form.elements.tier.value = formTierValue(meta.tier);
  if (form.elements.race) form.elements.race.value = formRaceValue(meta.race);
}

function openForm() {
  form.reset();
  form.id.value = "";
  form.date.value = localDateKey();
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
  const keys = ["date", "opponent", "tier", "race", "result", "myBuild", "enemyBuild", "map", "cause", "note", "feedback"];
  const heads = ["날짜", "상대", "티어", "종족", "승패", "사용 빌드", "상대 빌드", "맵", "패인", "느낀점", "피드백"];
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

async function loadSharedPlayerMaster(force = false) {
  const response = await fetch(`${PLAYER_MASTER_URL}${force ? `?t=${Date.now()}` : ""}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("승인된 선수 DB를 불러오지 못했어.");
  const payload = await response.json();
  const players = Array.isArray(payload.players)
    ? payload.players.filter((player) => player && player.active !== false && player.name)
    : [];
  const directory = {};
  players.forEach((player) => {
    const meta = { name: player.name, tier: player.tier || "", race: player.race || "" };
    directory[masterNameKey(player.name)] = meta;
    (player.aliases || []).forEach((alias) => {
      if (alias) directory[masterNameKey(alias)] = meta;
    });
  });
  masterPlayerDirectory = directory;
  let list = document.getElementById("masterPlayerNames");
  if (!list) {
    list = document.createElement("datalist");
    list.id = "masterPlayerNames";
    document.body.appendChild(list);
  }
  list.innerHTML = players
    .map((player) => `<option value="${esc(player.name)}">${esc(player.tier || "")} · ${esc(player.race || "")}</option>`)
    .join("");
  const opponent = form?.elements?.opponent;
  if (opponent) opponent.setAttribute("list", "masterPlayerNames");
  return payload;
}

function load() {
  records = readRecords();
  renderAll();
  loadSharedPlayerMaster(false)
    .then(() => autoFillRecordPlayer(form?.elements?.opponent))
    .catch((error) => console.warn("공용 선수 DB 연결 실패", error));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

load();
checkForAppUpdate(false);
