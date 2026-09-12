import assert from "node:assert/strict";
import test from "node:test";

import { __test } from "../worker/src/index.js";

const mainProfile = {
  id: 833,
  division: "women",
  name: "단솔",
  display_name: "단솔",
  is_main_race: true,
  main_race: "P",
  elo_raw: "928.7",
  wins: 204,
  losses: 185,
  games: 389,
  win_rate: 52.4,
  last_played_on: "2026-09-10",
};

const subProfile = {
  ...mainProfile,
  id: 5986,
  name: "단솔.",
  is_main_race: false,
  main_race: "Z",
  games: 96,
};

const opponentProfile = {
  id: 823,
  division: "women",
  name: "이응씨",
  display_name: "이응씨",
  is_main_race: true,
  main_race: "T",
  elo_raw: "844.8",
  wins: 134,
  losses: 209,
  games: 343,
  win_rate: 39.1,
};

const match = {
  id: 2868506,
  division: "women",
  played_on: "2026-09-10",
  map_name: "라데온",
  category: "sponsored",
  format_raw: "단판",
  elo_delta: 13.8,
  memo: "테스트 메모",
  created_by_nickname: "입력자",
  participants: [
    { player_id: 833, name: "단솔", race: "P", result: "win" },
    { player_id: 823, name: "이응씨", race: "T", result: "loss" },
  ],
};

test("여자부 동명이인·부종 중 주종 선수를 고른다", () => {
  const selected = __test.selectProfile([subProfile, { ...mainProfile, division: "men", id: 1 }, mainProfile], "단솔");
  assert.equal(selected.id, 833);
});

test("공식 경기 JSON을 스폰일지 형식으로 변환한다", () => {
  const record = __test.matchToRecord(match, 833);
  assert.equal(record.sourceId, "eloboard-match-2868506");
  assert.equal(record.result, "승");
  assert.equal(record.opponent, "이응씨");
  assert.equal(record.race, "테란");
  assert.equal(record.map, "라데온");
  assert.equal(record.eloChange, "+13.8");
  assert.equal(record.eloMatchType, "스폰 · 단판");
  assert.equal(record.feedback, "");
});

test("ELO 변동값이 없으면 0으로 만들지 않는다", () => {
  const record = __test.matchToRecord({ ...match, elo_delta: null }, 833);
  assert.equal(record.eloChange, "");
});

test("상대전적 요약은 기준 선수 관점의 승패와 최근 경기를 반환한다", () => {
  const result = __test.buildRivalSummary(
    mainProfile,
    opponentProfile,
    { player_id: 823, wins: 47, losses: 23, games: 70, win_rate: 67.1, last_played_on: "2026-09-10" },
    [match],
  );
  assert.deepEqual(result.headToHead, {
    wins: 47,
    losses: 23,
    games: 70,
    winRate: 67.1,
    lastPlayedOn: "2026-09-10",
  });
  assert.equal(result.base.raceLabel, "토스");
  assert.equal(result.opponent.raceLabel, "테란");
  assert.equal(result.recentMatches[0].result, "승");
});

test("ELOBOARD 서버 오류 문구를 구분한다", () => {
  assert.match(__test.pageError("database unavailable"), /접속자가 많아/);
  assert.match(__test.pageError("Site Unavailable"), /자동 조회를 제한/);
});
