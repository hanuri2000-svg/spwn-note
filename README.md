# 스폰노트 웹 버전

Windows 실행파일의 스폰일지 기능을 모바일과 PC 브라우저에서 사용할 수 있도록 옮긴 버전입니다.

현재 버전: **v1.7.10**

## 제공 기능

- 이름 한 번 등록 후 모든 ELOBOARD 기능에 공통 적용
- ELOBOARD 전체 공식전 기준 전체·월간·주간 전적과 종족별 승률
- 날짜, 상대, 티어, 종족, 승패, 빌드, 맵, 패인 기록
- 느낀점과 피드백 저장·검색·전체 보기
- 기록 수정과 삭제
- CSV 내보내기
- JSON 백업·복원과 전체 리셋
- 앱 안에서 최신 버전 확인 및 캐시 초기화 후 업데이트 적용
- ELOBOARD 개인 전적 조회·선택 등록
- 대시보드에서 저장된 등록된 이름와 상대 선수의 ELOBOARD 상대전적·최근 맞대결 검색
- 대시보드에서 등록된 이름의 ELOBOARD 전체 공식전 기준 맵별 전적과 최근 맞대결 순서의 상대 선수별 전적(최대 20명)
- 대시보드에서 스폰일지에 작성한 사용 빌드 기준 빌드별 전적
- ELOBOARD 최신 스타 티어표, 복수 티어·종족·이름 필터와 SOOP LIVE 표시
- 티어표 72px 프로필·종족/이름/LIVE 두 줄 표시, PC 호버 및 모바일 터치 방송 미리보기
- ELOBOARD 변경사항 선수의 SOOP 아이디가 비어 있어도 닉네임·변경 활동명으로 LIVE 연결
- 티어표를 열면 선수 데이터의 사전 로딩과 관계없이 LIVE 상태를 자동 확인하고 60초마다 갱신
- 독립판은 한국 시간 기준 월별 계절 테마가 자동 적용(상단·배경·버튼·티어표, 10월 단풍/12월 크리스마스), 임베드 모드는 제외
- `날짜 + 상대 + 승패 + 맵` 및 ELO 경기번호 기준 중복 방지
- 모바일 홈 화면 설치와 오프라인 실행
- 독립 스폰노트에만 표시되는 NEW CATSLE 배경 워터마크 (`?embed=1`에서는 숨김)
- 독립 화면 하단 제작자 표기 (`made by 라비c`)

## 기존 실행파일 기록 옮기기

1. 기존 실행파일에서 `백업 저장`을 눌러 JSON 파일을 받습니다.
2. 웹 버전의 `스폰일지`에서 `백업 불러오기`를 누릅니다.
3. 기존 JSON 파일을 선택하고 경기 수와 최근 기록을 확인합니다.

기록은 각 사용자의 현재 브라우저에만 저장됩니다. 다른 PC나 휴대폰으로 옮기거나 브라우저 데이터를 지우기 전에는 JSON 백업을 받아야 합니다.

## GitHub Pages 배포

이 저장소의 `main` 브랜치에 변경 사항을 올리면 `.github/workflows/pages.yml`이 사이트를 배포합니다. 저장소 설정의 **Pages → Build and deployment → Source**는 `GitHub Actions`로 지정합니다.

## ELOBOARD 자동 조회

중계 Worker의 **기준 소스는 [spawn-note-elo-relay](https://github.com/hanuri2000-svg/spawn-note-elo-relay)** 입니다. 이 저장소의 `worker/src/index.js`, `worker/tests/dashboard.test.mjs`, `worker/wrangler.jsonc`는 동기화 사본이므로 직접 수정하지 않습니다. 기존 `config.js`의 운영 주소는 유지합니다.

기준 저장소에서 기능 수정·검사·커밋 후 이 저장소에서 실행합니다:

```bash
cd worker
npm run sync:upstream
npm test
# 변경된 Worker, 검사, upstream-lock.json을 함께 커밋
```

배포는 기준 저장소의 `npm run deploy`를 권장합니다. 이 저장소에서 배포해야 하면:

```bash
cd worker
npm install
npm run deploy
```

배포 전 기준 저장소 최신 소스·회귀검사·설정과의 일치 여부를 검사하며, 네트워크 오류나 불일치가 있으면 배포를 중단합니다. `npx wrangler deploy`로 검사를 우회하지 마세요. Cloudflare 자동 빌드는 기준 저장소 한 곳만 연결하고 테스트가 포함된 `npm run deploy`를 사용합니다. `upstream-lock.json`은 가져온 커밋과 파일 해시를 기록합니다. 일일 CI는 기준 소스와의 차이를 검사합니다.

중계 서버는 현재 ELOBOARD의 공개 JSON 조회 주소를 사용하며 여자부 주종 계정을 우선합니다. 전적 가져오기는 스폰 경기만 조회하고, 대시보드 요약과 상대전적은 팀리그·개인리그를 포함한 ELOBOARD 전체 공식전을 표시합니다. ELOBOARD가 접속 초과 또는 자동 접근 제한 상태이면 웹앱에서도 해당 오류를 안내합니다.
