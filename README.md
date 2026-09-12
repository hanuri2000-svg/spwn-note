# 스폰노트 웹 버전

Windows 실행파일의 스폰일지 기능을 모바일과 PC 브라우저에서 사용할 수 있도록 옮긴 버전입니다.

현재 버전: **v1.1.2**

## 제공 기능

- 전체·월간·주간 전적과 종족별 승률
- 날짜, 상대, 티어, 종족, 승패, 빌드, 맵, 패인 기록
- 느낀점과 피드백 저장·검색·전체 보기
- 기록 수정과 삭제
- CSV 내보내기
- JSON 백업·복원과 전체 리셋
- ELOBOARD 개인 전적 조회·선택 등록
- `날짜 + 상대 + 승패 + 맵` 및 ELO 경기번호 기준 중복 방지
- 모바일 홈 화면 설치와 오프라인 실행

## 기존 실행파일 기록 옮기기

1. 기존 실행파일에서 `백업 저장`을 눌러 JSON 파일을 받습니다.
2. 웹 버전의 `스폰일지`에서 `백업 불러오기`를 누릅니다.
3. 기존 JSON 파일을 선택하고 경기 수와 최근 기록을 확인합니다.

기록은 각 사용자의 현재 브라우저에만 저장됩니다. 다른 PC나 휴대폰으로 옮기거나 브라우저 데이터를 지우기 전에는 JSON 백업을 받아야 합니다.

## GitHub Pages 배포

이 저장소의 `main` 브랜치에 변경 사항을 올리면 `.github/workflows/pages.yml`이 사이트를 배포합니다. 저장소 설정의 **Pages → Build and deployment → Source**는 `GitHub Actions`로 지정합니다.

## ELOBOARD 자동 조회

GitHub Pages는 정적 사이트라 ELOBOARD를 직접 중계할 수 없습니다. `worker` 폴더의 Cloudflare Worker를 배포한 뒤 생성된 주소를 `config.js`에 넣어야 합니다.

```js
window.SPAWN_NOTE_ELO_API_BASE = "https://spawn-note-elo-relay.example.workers.dev";
```

Worker 배포 명령:

```bash
cd worker
npm install
npm run deploy
```

ELOBOARD가 접속 초과 또는 자동 접근 제한 상태이면 웹앱에서도 해당 오류를 안내합니다.
