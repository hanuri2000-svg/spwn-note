import assert from "node:assert/strict";
import test from "node:test";

import { __test } from "../worker/src/index.js";

test("선수 검색 결과에서 정확한 개인 페이지 ID를 찾는다", () => {
  const html = `
    <a href="board.php?bo_table=bj_list&amp;wr_id=100">최도</a>
    <a href="board.php?bo_table=bj_list&amp;wr_id=512">최도랑</a>
  `;
  assert.equal(__test.parseProfileId(html, "최도랑"), "512");
});

test("상세 전적을 스폰일지 형식으로 변환한다", () => {
  const html = `
    <table>
      <tr><th>날짜</th><td>2026-09-10</td></tr>
      <tr><th>승자</th><td><a href="board.php?bo_table=bj_list&amp;wr_id=512">최도랑 (P)</a></td></tr>
      <tr><th>패자</th><td><a href="board.php?bo_table=bj_list&amp;wr_id=777">상대선수 (T)</a></td></tr>
      <tr><th>ELO 변동</th><td>+4.2</td></tr>
      <tr><th>맵</th><td>투혼</td></tr>
      <tr><th>경기방식</th><td>스폰</td></tr>
      <tr><th>메모</th><td>단판</td></tr>
    </table>
  `;
  const record = __test.parseEloDetail(html, "최도랑", "9001");
  assert.equal(record.sourceId, "women-bj_board-9001");
  assert.equal(record.result, "승");
  assert.equal(record.opponent, "상대선수");
  assert.equal(record.race, "테란");
  assert.equal(record.map, "투혼");
  assert.equal(record.feedback, "");
});

test("ELOBOARD 서버 오류 문구를 구분한다", () => {
  assert.match(__test.pageError("mysqli_connect max_user_connections"), /접속자가 많아/);
  assert.match(__test.pageError("접근 불가입니다."), /자동 조회를 제한/);
});

