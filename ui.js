const STORAGE_KEY = "spawnNote.records.v1";
const PLAYER_KEY = "spawnNote.eloPlayer";
const LEGACY_STORAGE_KEY = "new" + "catsleSpawnNote.records.v1";
const LEGACY_PLAYER_KEY = "new" + "catsleEloPlayer";
const ELO_API_BASE = String(window.SPAWN_NOTE_ELO_API_BASE || "").replace(/\/$/, "");

let records = [];
let eloPreviewRecords = [];

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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어.");
  return data;
}

function load() {
  records = readRecords();
  renderAll();
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
  $("#dashTab").classList.toggle("active", tab === "dash");
  $("#logTab").classList.toggle("active", tab === "log");
}

function renderDash() {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));

  const month = records.filter((record) => {
    const date = new Date(`${record.date}T00:00:00`);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const week = records.filter((record) => new Date(`${record.date}T00:00:00`) >= monday);
  const allStats = stat(records);
  const monthStats = stat(month);
  const weekStats = stat(week);
  const last = [...records].sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id),
  )[0];

  $("#cards").innerHTML =
    card("🏆 전체 전적", `${allStats.w}승 ${allStats.l}패`, `${allStats.p}%`) +
    card("📅 이번 달", `${monthStats.w}승 ${monthStats.l}패`, `${monthStats.p}%`) +
    card("📆 이번 주", `${weekStats.w}승 ${weekStats.l}패`, `${weekStats.p}%`) +
    card("🎮 총 스폰", `${allStats.t}경기`, "SEASON 2026") +
    card("📌 최근 기록", last ? last.date : "-", "자동 저장");

  $("#races").innerHTML = ["테란", "저그", "토스"]
    .map((race) => {
      const raceStats = stat(records.filter((record) => record.race === race));
      const icon = race === "테란" ? "👽" : race === "저그" ? "🐜" : "⚔️";
      return `<div class="race"><b>${icon} vs ${race}</b><div class="big">${raceStats.w}승 ${raceStats.l}패</div><div class="sub">승률 ${raceStats.p}%</div></div>`;
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
}

function card(heading, body, sub) {
  return `<div class="card"><h3>${heading}</h3><div class="big">${body}</div><div class="sub">${sub}</div></div>`;
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
  const savedPlayer = localStorage.getItem(PLAYER_KEY) || localStorage.getItem(LEGACY_PLAYER_KEY) || "";
  $("#eloPlayer").value = savedPlayer;
  if (savedPlayer && !localStorage.getItem(PLAYER_KEY)) localStorage.setItem(PLAYER_KEY, savedPlayer);
  const latestDate = [...records]
    .map((record) => record.date)
    .filter(Boolean)
    .sort()
    .at(-1);
  $("#eloFromDate").value =
    latestDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  $("#eloStatus").textContent = ELO_API_BASE
    ? "선수 이름과 조회 시작 날짜를 확인한 뒤 전적 조회를 눌러줘."
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
  if (player.length < 2) {
    alert("선수 이름을 두 글자 이상 입력해줘.");
    return;
  }
  if (!ELO_API_BASE) {
    $("#eloStatus").textContent =
      "ELO 조회 서버 주소가 설정되지 않았어. 저장소의 config.js에 중계 서버 주소를 입력해줘.";
    return;
  }
  localStorage.setItem(PLAYER_KEY, player);
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
    ? `선수 개인 페이지에서 ${checkedMatches}경기를 확인해 ${eloPreviewRecords.length}경기를 찾았어. 새 기록 ${newCount}개, 기존 기록과 겹치는 항목 ${duplicateCount}개야.`
    : data.latestAvailableDate && fromDate > data.latestAvailableDate
      ? `개인 페이지의 최신 전적은 ${data.latestAvailableDate}이야. 조회 시작 날짜를 그 날짜 이전으로 바꿔줘.`
      : "선수 개인 페이지를 확인했지만 조건에 맞는 전적이 없어. 조회 시작 날짜를 더 이전으로 조정해봐.";

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
