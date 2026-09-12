import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createElement() {
  return {
    checked: false,
    classList: { add() {}, remove() {}, toggle() {} },
    close() {},
    disabled: false,
    files: [],
    innerHTML: "",
    reset() {},
    showModal() {},
    textContent: "",
    value: "",
    dataset: {},
  };
}

function createContext({ apiBase = "", fetchImpl = fetch } = {}) {
  const storage = new Map();
  const elements = new Map();
  for (const id of [
    "cards",
    "races",
    "recent",
    "tbody",
    "dash",
    "log",
    "dashTab",
    "logTab",
    "tier",
    "tierTab",
    "search",
    "basePlayer",
    "basePlayerSaveButton",
    "basePlayerStatus",
    "eloPlayer",
    "eloFromDate",
    "eloPages",
    "eloStatus",
    "eloPreviewBody",
    "eloImportButton",
    "eloSelectAll",
    "eloLookupButton",
    "rivalPlayer",
    "rivalBaseName",
    "rivalOpponent",
    "rivalStatus",
    "rivalResult",
    "rivalSearchButton",
    "formTitle",
    "tierStatus",
    "tierLevelFilters",
    "tierGroups",
    "tierSearch",
    "tierLiveOnly",
    "tierRefreshButton",
  ]) {
    elements.set(id, createElement());
  }
  const form = createElement();
  form.id = createElement();
  form.date = createElement();
  form.elements = {};
  const dlg = createElement();
  const eloDlg = createElement();
  elements.set("form", form);
  elements.set("dlg", dlg);
  elements.set("eloDlg", eloDlg);

  const context = vm.createContext({
    Blob,
    Date,
    FormData: class {
      constructor() {
        return new Map([
          ["id", ""],
          ["date", "2026-09-12"],
          ["opponent", "테스트상대"],
          ["tier", "5티어"],
          ["race", "테란"],
          ["result", "승"],
          ["myBuild", "원게이트"],
          ["enemyBuild", "투팩"],
          ["map", "투혼"],
          ["cause", ""],
          ["note", "운영이 좋았음"],
          ["feedback", "정찰 타이밍 보완"],
        ]);
      }
    },
    URL,
    URLSearchParams,
    alert() {},
    confirm: () => true,
    console,
    document: {
      body: createElement(),
      createElement,
      getElementById(id) {
        return elements.get(id) || createElement();
      },
      querySelector(selector) {
        return elements.get(selector.replace(/^#/, "")) || createElement();
      },
      querySelectorAll() {
        return [];
      },
    },
    fetch: fetchImpl,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      removeItem(key) {
        storage.delete(key);
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    navigator: {},
    location: { search: "" },
    setInterval: () => 1,
    setTimeout,
    window: {
      SPAWN_NOTE_ELO_API_BASE: apiBase,
      addEventListener() {},
    },
  });
  return { context, elements, storage };
}

const source = fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8");

test("공용 이름과 화면 버전을 표시한다", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const manifest = fs.readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8");
  assert.match(html, />스폰노트 /);
  assert.match(html, />v1\.4\.3</);
  assert.match(html, /id="basePlayer"/);
  assert.match(html, /id="tierTab"/);
  assert.match(html, /id="tierGroups"/);
  assert.match(html, /ELOBOARD 상대전적 검색/);
  assert.match(html, /id="rivalPlayer"/);
  assert.match(html, /id="rivalOpponent"/);
  const oldBrand = new RegExp(["NEW", "CATSLE"].join("\\s*") + "|뉴" + "캣슬", "i");
  assert.doesNotMatch(`${html}\n${manifest}`, oldBrand);
});

test("NEW CATSLE 배경은 독립 화면에만 표시한다", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(html, /html:not\(\.embed-mode\) body::before/);
  assert.match(html, /html\.embed-mode body::before/);
  assert.match(html, /documentElement\.classList\.add\("embed-mode"\)/);
  assert.match(html, /\.\/assets\/brand-watermark\.png/);
  assert.match(html, /opacity: 0\.12/);
  assert.match(serviceWorker, /spawn-note-v1\.4\.3/);
  assert.match(serviceWorker, /\.\/assets\/brand-watermark\.png/);
});

test("제작자 표기는 독립 화면 하단에만 표시한다", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<footer class="site-credit"[^>]*>[\s\S]*made by <span>라비c<\/span>/);
  assert.match(html, /html\.embed-mode \.site-credit\s*{[\s\S]*?display: none/);
});

test("ELOBOARD 티어표를 불러와 복수 티어와 LIVE 상태를 표시한다", async () => {
  const fetchImpl = async (url) => {
    const data = String(url).includes("dorang-live")
      ? {
          updatedAt: "2026-09-12T07:14:57.530Z",
          live: [{ soop_id: "danso" , url: "https://play.sooplive.com/danso/1" }],
        }
      : {
          version: "3.61",
          updatedOn: "2026-08-29",
          tiers: [
            {
              key: "tier8",
              label: "8티어",
              players: [
                { playerId: 833, name: "단솔", race: "P", soopId: "danso", thumbUrl: "players/833.jpg" },
              ],
            },
            {
              key: "tier7",
              label: "7티어",
              players: [{ playerId: 844, name: "퀸주", race: "Z", soopId: "queenzu", thumbUrl: "" }],
            },
          ],
        };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { context, elements } = createContext({ apiBase: "https://relay.example", fetchImpl });
  vm.runInContext(source, context);
  await vm.runInContext("loadTierTable()", context);
  assert.match(elements.get("tierStatus").textContent, /v3\.61/);
  assert.match(elements.get("tierGroups").innerHTML, /단솔/);
  assert.match(elements.get("tierGroups").innerHTML, /퀸주/);
  assert.match(elements.get("tierGroups").innerHTML, /● LIVE/);
  vm.runInContext("toggleTierLevel('8티어'); toggleTierLevel('7티어')", context);
  assert.match(elements.get("tierLevelFilters").innerHTML, /✓ 8티어/);
  assert.match(elements.get("tierLevelFilters").innerHTML, /✓ 7티어/);
});

test("기록과 피드백이 브라우저 저장소에 유지된다", () => {
  const { context, storage } = createContext();
  vm.runInContext(source, context);
  vm.runInContext("submitForm({ preventDefault() {} })", context);
  const saved = JSON.parse(storage.get("spawnNote.records.v1"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].opponent, "테스트상대");
  assert.equal(saved[0].note, "운영이 좋았음");
  assert.equal(saved[0].feedback, "정찰 타이밍 보완");
});

test("기존 EXE 백업 형식에서 피드백 없는 기록도 읽는다", () => {
  const { context, storage } = createContext();
  storage.set(
    ["new", "catsleSpawnNote.records.v1"].join(""),
    JSON.stringify([{ id: 7, date: "2026-08-01", opponent: "상대", result: "패", note: "메모" }]),
  );
  vm.runInContext(source, context);
  const record = vm.runInContext("records[0]", context);
  assert.equal(record.id, 7);
  assert.equal(record.note, "메모");
  assert.equal(record.feedback, "");
});

test("날짜·상대·승패·맵이 같은 ELO 기록은 중복 처리한다", () => {
  const { context, storage } = createContext();
  storage.set(
    ["new", "catsleSpawnNote.records.v1"].join(""),
    JSON.stringify([
      { id: 1, date: "2026-09-01", opponent: "최도랑", result: "승", map: "투혼", feedback: "" },
    ]),
  );
  vm.runInContext(source, context);
  const duplicate = vm.runInContext(
    `markDuplicates([{source:"eloboard",sourceId:"women-bj_board-99",date:"2026-09-01",opponent:"최도랑",result:"승",map:"투혼"}])[0].duplicate`,
    context,
  );
  assert.equal(duplicate, true);
});

test("대시보드에서 두 선수의 ELO 상대전적을 조회해 표시한다", async () => {
  const fetchImpl = async (url) => {
    const data = String(url).includes("/api/elo/dashboard")
      ? {
          player: { name: "단솔", race: "P", raceLabel: "토스", elo: "928.7" },
          overall: { wins: 204, losses: 185, games: 389, winRate: 52.4 },
          month: { wins: 8, losses: 7, games: 15, winRate: 53.3 },
          week: { wins: 3, losses: 2, games: 5, winRate: 60 },
          totalGames: 389,
          races: [],
          latestMatchDate: "2026-09-10",
        }
      : {
        base: { name: "단솔", race: "P", elo: "928.7", wins: 204, losses: 185, winRate: 52.4 },
        opponent: { name: "이응씨", race: "T", elo: "844.8", wins: 134, losses: 209, winRate: 39.1 },
        headToHead: { wins: 47, losses: 23, games: 70, winRate: 67.1, lastPlayedOn: "2026-09-10" },
        recentMatches: [{ id: "1", date: "2026-09-10", result: "승", map: "라데온", type: "스폰 · 단판" }],
      };
    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const { context, elements } = createContext({ apiBase: "https://relay.example", fetchImpl });
  vm.runInContext(source, context);
  elements.get("basePlayer").value = "단솔";
  await vm.runInContext("saveBasePlayer()", context);
  elements.get("rivalOpponent").value = "이응씨";
  await vm.runInContext("searchRival()", context);
  assert.match(elements.get("rivalStatus").textContent, /70경기/);
  assert.match(elements.get("rivalResult").innerHTML, /47/);
  assert.match(elements.get("rivalResult").innerHTML, /이응씨/);
  assert.match(elements.get("rivalResult").innerHTML, /라데온/);
});

test("저장한 기준 선수의 ELOBOARD 전체 공식전 통계를 대시보드에 표시한다", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        player: { name: "단솔", race: "P", raceLabel: "토스", elo: "928.7" },
        overall: { wins: 204, losses: 185, games: 389, winRate: 52.4 },
        month: { wins: 8, losses: 7, games: 15, winRate: 53.3 },
        week: { wins: 3, losses: 2, games: 5, winRate: 60 },
        totalGames: 389,
        races: [
          { race: "T", wins: 93, losses: 76, games: 169, winRate: 55 },
          { race: "Z", wins: 109, losses: 105, games: 214, winRate: 50.9 },
          { race: "P", wins: 2, losses: 4, games: 6, winRate: 33.3 },
        ],
        latestMatchDate: "2026-09-10",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const { context, elements, storage } = createContext({
    apiBase: "https://relay.example",
    fetchImpl,
  });
  vm.runInContext(source, context);
  elements.get("basePlayer").value = "단솔";
  await vm.runInContext("saveBasePlayer()", context);
  assert.equal(storage.get("spawnNote.eloPlayer"), "단솔");
  assert.match(elements.get("cards").innerHTML, /204승 185패/);
  assert.match(elements.get("cards").innerHTML, /389경기/);
  assert.match(elements.get("cards").innerHTML, /8승 7패/);
  assert.match(elements.get("races").innerHTML, /93승 76패/);
  assert.equal(elements.get("rivalBaseName").textContent, "단솔");
  assert.equal(elements.get("eloPlayer").value, "단솔");
});
