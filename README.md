# 나무레이스 온라인

Windows와 macOS 12 Monterey 이상 사용자가 6자리 방 코드로 함께 플레이하는 데스크톱 링크 레이스입니다. 게임 화면 안에는 복제·가공한 문서가 아니라 `https://namu.wiki/w/...` 원본 페이지를 별도의 안전한 브라우저 영역으로 직접 표시합니다.

## 들어 있는 기능

- 오늘의 레이스: 한국 시간 자정마다 모든 사용자에게 같은 출발·목표 제공
- 랜덤 레이스: 검증된 나무위키 문서 제목 후보군에서 두 문서를 뽑아 시작 순간에 공개
- 직접 지정: 방장이 원하는 출발 문서와 목표 문서를 입력
- 라운드 레이스: 2~10개의 랜덤 경로를 연속 진행하고 클릭 수 70%·완주 시간 30%를 반영한 점수를 누적
- 온라인 멀티플레이: 다른 네트워크의 Windows·Mac 사용자가 방 코드로 참가
- 실시간 대기실, 준비 상태, 동시 출발, 클릭 수, 완주 순위
- 레이스 중 포기하기와 모든 기기에 동기화되는 포기 상태
- 나무위키 원본 문서 링크만 게임 이동으로 인정하고 검색·외부 이동·브라우저 뒤로 가기 차단
- 게임 HUD의 전용 뒤로가기 버튼으로 이전 문서 이동(클릭 수 1회 추가)
- 달리는 동안 상대 경로 비공개, 내 완주 후 남은 참가자 실시간 관전
- 최종 결과에서 참가자별 전체 이동 경로 확인
- 같은 방과 레이스 방식을 유지하는 다시하기
- Windows 설치형 앱 내 업데이트 확인·다운로드·재시작 설치(닉네임과 서버 설정 유지)
- 최대 8명, 방은 6시간 뒤 자동 만료

## 구조

사용자가 실행하는 것은 Electron 데스크톱 앱뿐입니다. Cloudflare Worker와 Durable Object는 화면 없는 온라인 중계 서버로만 동작하며 방 상태와 실시간 WebSocket 연결을 관리합니다. 나무위키 문서 자체는 중계 서버를 거치거나 저장하지 않습니다.

현재 중계 서버는 `https://namu-race-online.namu-race-online.workers.dev`에 배포되어 있고, 이 주소가 배포용 앱에 내장되어 있습니다.

## 로컬 실행

Node.js 24 환경에서 의존성을 설치한 뒤 두 터미널을 사용합니다.

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\dev-server.ps1
npm start
```

자동 검증:

```powershell
npm run check
node .\node_modules\typescript\bin\tsc -p .\server\tsconfig-final.json
node .\test\integration-modes.mjs
node .\test\integration-online.mjs
```

## 온라인 서버 배포와 앱 빌드

Cloudflare 계정으로 한 번 로그인한 뒤 서버를 배포합니다.

```powershell
npx wrangler login
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-server.ps1
```

서버 주소는 프로젝트 루트의 `server-url.txt`에 들어 있습니다. 이 파일이 포함된 최종 앱에서는 사용자가 서버 주소나 IP를 입력할 필요가 없습니다. 서버를 다른 계정이나 이름으로 다시 배포한 경우에만 해당 파일의 주소를 바꿉니다.

```powershell
npm run dist:win
npm run dist:mac
```

Windows 설치 파일은 `release/NamuRace-online-0.4.1-beta.1-setup.exe`입니다. macOS DMG는 포함된 GitHub Actions 워크플로에서 Intel Mac과 Apple Silicon Mac을 모두 지원하는 universal 앱으로 빌드합니다.

### Windows 업데이트

기존 `0.4.0-test.2` 이하의 휴대용 EXE에는 업데이트 기능이 없으므로, 위 설치형 EXE를 최초 한 번 직접 설치해야 합니다. 이후에는 시작 메뉴나 바탕 화면의 나무레이스 온라인을 실행합니다. 예전에 다운로드한 휴대용 EXE 파일은 설치된 앱과 별개의 파일이므로 필요 없으면 직접 삭제할 수 있습니다.

설치형 앱은 실행 후와 6시간마다 새 버전을 확인합니다. 첫 화면의 **프로그램 업데이트**에서 직접 확인할 수도 있습니다. 새 버전 다운로드가 끝나면 **업데이트 후 다시 시작**을 누릅니다. 설치 프로그램이 같은 위치의 기존 앱을 교체하고 다시 실행하며, 앱 데이터 폴더와 닉네임·서버 설정은 유지합니다. 방 참가 중에는 설치를 막고, 앱을 그냥 종료했을 때도 임의로 설치하지 않습니다. 다운로드나 무결성 검사가 실패하면 기존 앱을 그대로 사용할 수 있습니다.

업데이트는 공개 GitHub Releases에서 받으며 사용자의 GitHub 로그인이나 토큰이 필요하지 않습니다. 베타 버전은 같은 베타 채널과 이후 정식 버전을 받을 수 있고, 정식 버전은 정식 릴리스만 받습니다. macOS는 현재 앱 내 자동 설치를 지원하지 않으며 다운로드 페이지로 안내합니다.

새 버전을 배포할 때 `package.json`과 `package-lock.json`의 버전을 함께 올린 뒤 같은 버전의 `v*` Git 태그를 푸시합니다. GitHub Actions가 Windows 설치 파일·블록맵·`latest.yml`과 macOS DMG를 빌드하고 모두 준비되면 릴리스를 공개합니다. 설치 파일만 게시하고 `latest.yml`을 빼면 앱의 업데이트 확인이 실패하므로 반드시 함께 게시합니다. 이미 공개한 같은 버전의 파일은 교체하지 말고 새 버전을 사용합니다.

현재 macOS 앱은 다른 Mac에서의 테스트를 위해 서명과 Hardened Runtime을 적용하지 않았으며 Apple 공증도 받지 않았습니다. 처음 실행할 때 macOS가 차단하면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 사용합니다. 공개 배포 단계에서는 Apple Developer ID 서명과 공증을 반드시 추가해야 합니다.

## 참고

나무위키의 사이트 구조나 보안 정책이 바뀌면 링크 감지 방식도 조정해야 할 수 있습니다. 원본 사이트의 이용 약관과 라이선스 표시는 그대로 존중하며, 이 프로젝트는 나무위키와 관계없는 비공식 게임입니다.

## 라이선스와 권리 고지

이 저장소에서 직접 작성한 프로그램 코드는 [MIT License](LICENSE)로 공개합니다. 단, `shared/random-title-pool.mjs`의 문서 제목 데이터와 나무위키를 비롯한 제3자의 콘텐츠·명칭·로고에는 MIT License가 적용되지 않습니다. 자세한 출처와 적용 조건은 [제3자 권리 및 데이터 고지](THIRD_PARTY_NOTICES.md)를 확인하세요.

나무레이스 온라인은 나무위키 또는 운영사와 제휴하거나 승인받은 제품이 아닙니다. 배포 파일에는 나무위키 문서 본문이나 이미지 사본을 포함하지 않으며, 게임 화면은 사용자의 기기에서 나무위키 원본 페이지를 직접 엽니다.
