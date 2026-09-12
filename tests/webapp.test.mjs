import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createElement() {
  return {
    checked: false,
    classList: { toggle() {} },
    close() {},
    disabled: false,
    files: [],
    innerHTML: "",
    reset() {},
    showModal() {},
    textContent: "",
    value: "",
  };
}

function createContext() {
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
    "search",
    "eloPlayer",
    "eloFromDate",
    "eloPages",
    "eloStatus",
    "eloPreviewBody",
    "eloImportButton",
    "eloSelectAll",
    "eloLookupButton",
    "formTitle",
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
    fetch,
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
    setTimeout,
    window: {
      SPAWN_NOTE_ELO_API_BASE: "",
      addEventListener() {},
    },
  });
  return { context, storage };
}

const source = fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8");

test("공용 이름과 화면 버전을 표시한다", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const manifest = fs.readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8");
  assert.match(html, />스폰노트 /);
  assert.match(html, />v1\.1\.1</);
  const oldBrand = new RegExp(["NEW", "CATSLE"].join("\\s*") + "|뉴" + "캣슬", "i");
  assert.doesNotMatch(`${html}\n${manifest}`, oldBrand);
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
