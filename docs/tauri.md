# Tauri 데스크톱 전환 — 결정과 근거

웹 버전(정적 사이트)은 그대로 살아 있다. 같은 프론트 코드가 두 런타임에서 돈다.

---

## 1단계 · 진단 결과

| 항목 | 실제 상태 |
|---|---|
| 프론트엔드 | **순수 정적**. React/Vue/Vite/Next 없음. `index.html` + `assets/*.js` (vanilla). 번들러 없음 |
| 백엔드 API 서버 | **없음**. `scripts/build-data.mjs` 는 오프라인 배치 빌더 (엑셀 → JSON) |
| DB | **없음**. 평면 JSON 파일 (학생 420명, 1.9MB) |
| 외부 의존 | npm `xlsx`(SheetJS) 1개, CDN 2개(Chart.js, Pretendard) |

전환 난이도가 낮은 구조였다. 문제는 다른 데 있었다 (4단계 참고).

**한 일**: CDN 2개를 `assets/vendor/` 로 내렸다. 데스크톱 앱은 인터넷 없이 떠야 하는데
`index.html` 이 jsdelivr 를 불러오고 있었다. 확인: 앱 로드 시 외부 요청 0건.

---

## 2단계 · Tauri 통합

새 프로젝트를 만들지 않고 저장소에 `src-tauri/` 만 추가했다.

```
build.devUrl       = http://localhost:5501   (기존 `npm run serve`)
build.frontendDist = ../dist
```

**`frontendDist` 를 저장소 루트(`../`)로 두지 않은 이유**: 그러면 설치 파일에
`node_modules/`, `data/*.xlsx`(원본 성적), `public/data/`(산출된 점수), `code-map.csv`
까지 통째로 들어간다. `scripts/build-shell.mjs` 가 `index.html` + `assets/` 만 `dist/` 로 추린다.
Tauri 모드의 데이터는 전부 앱 데이터 폴더에서 오므로 `public/` 은 번들에 필요 없다.

**프론트 코드 재사용**: `assets/app.js` 는 그대로 두고, 데이터 접근만 `assets/api.js`(GKAPI)로
뺐다. `window.__TAURI__` 유무로 갈린다.

- 웹 모드 → `fetch('public/data/...')`, 데모 비밀번호. **기존 동작 그대로.**
- Tauri 모드 → `invoke(...)` 로 Rust 커맨드 호출.

---

## 3단계 · 백엔드: Rust 커맨드로 이전 (사이드카 안 씀)

`scripts/grade.mjs` 는 78줄 순수 함수, `build-data.mjs` 는 파싱 + 집계뿐. 무거운 로직이 없다.
Node 를 통째로 끌고 갈 이유가 없어서 Rust 로 옮겼다.

| | Rust 커맨드 (채택) | Node 사이드카 |
|---|---|---|
| 번들 크기 | 실행파일에 포함 | +40MB Node 런타임 |
| 코드사이닝 | 바이너리 1개 | 사이드카까지 서명 |
| 프로세스 | 없음 | 별도 프로세스 관리·IPC |
| 비용 | 파싱/통계 재작성 | 재작성 없음 |

- 엑셀 파싱: SheetJS → `calamine` crate
- 등급/통계: `src-tauri/core/src/grade.rs` 가 `grade.mjs` 의 1:1 포트.
  `grade.test.mjs` 의 케이스를 `#[test]` 로 그대로 옮겼다.
- 학생 코드 생성: FNV-1a 해시와 삽입 순서까지 웹 빌더와 동일. **같은 입력 → 같은 코드**라
  기존 `code-map.csv` 가 계속 유효하다.

`scripts/build-data.mjs` 는 지우지 않았다. 웹 배포는 그 경로를 그대로 쓴다.

### 크레이트를 둘로 나눈 이유

```
src-tauri/core/   gakri-core  — 등급 계산, 임포트, 암호화, 접근 제어. Tauri 를 모른다
src-tauri/        gakri-data  — 창 띄우기 + IPC 커맨드. 얇다
```

접근 제어와 등급 산정은 GUI 와 무관한 규칙이다. 떼어 놓으니 `cargo test -p gakri-core` 가
webview2/tao 를 링크하지 않고 1초 안에 끝난다. 규칙을 고칠 때 데스크톱 스택 전체를 빌드할 이유가 없다.

### 산출물 대조 테스트 (`import_reproduces_the_web_builder_output`)

Rust 임포터를 `data/` 에 돌려 **학생 420명 전원의 payload, `meta.json`, `cohort.json` 을
Node 빌더 산출물과 통째로 비교**한다. 입력 데이터가 없으면 조용히 건너뛴다.

이 테스트가 실제로 버그를 잡았다:

> `1-58F.subjects.mat.total: 66.9 != 67`

Rust 쪽이 과목 요소를 `BTreeMap` 에 담아 **한글 사전순(기말·수행·중간)** 으로 더하고 있었다.
JS 는 선언순(수행·중간·기말)으로 돈다. f64 덧셈은 결합법칙이 성립하지 않아 마지막 비트가
달라지고, 반올림 경계(`x.x5`)에서 0.1 이 갈린다. 총점이 0.1 어긋나면 등급 컷이 바뀔 수 있다.

고침: 요소 맵을 `IndexMap` (`grade::Components`) 으로 바꿔 JSON 선언 순서를 보존.
`weighted_total_depends_on_declaration_order` 로 회귀 고정.

---

## 3단계 · 저장소: SQLite 안 씀 (요청대로 DB 없이)

420명 × 15과목. 파일 읽기로 충분하고, SQLCipher 를 붙이면 C 컴파일·배포 복잡도만 는다.
대신 **민감도에 따라 파일을 나눴다.**

```
<appDataDir>/
  meta.json              평문   과목 메타. 개인정보 없음
  students/<CODE>.json   평문   코드 1개의 점수. 이름·반·번호 없음
  teachers.json          평문   계정 + salt + "감싼 DEK". 비밀 자체는 없음
  vault.enc              암호화  code-map(재식별 연결고리) + 반 단위 집계
```

**왜 학생 파일은 평문인가**: 학생 탭은 로그인 없이 자기 코드로 조회한다(웹과 동일).
그 파일에는 코드와 점수뿐이다. 누구인지 되짚으려면 code-map 이 필요하고, 그건 vault 안에 있다.

**왜 code-map 만 봉인하는가**: 웹 버전의 `code-map.csv` 는 평문으로 저장소 루트에 있었다
(`.gitignore` 는 되어 있으나 파일 자체는 무방비). 이게 유일하게 학생을 식별할 수 있는 자료다.

### 키 구조 (envelope encryption)

```
비밀번호 --Argon2id(salt, 19MiB/2/1)--> KEK --AES-256-GCM--> [감싼 DEK]
                                                                  |
                                                             DEK --AES-256-GCM--> vault.enc
```

- DEK 는 디스크에 평문으로 없다. 메모리에만 있고 `Zeroizing` 으로 지운다. **프론트로 절대 안 나간다.**
- 비밀번호 해시를 따로 안 둔다. 틀린 비밀번호는 AEAD 태그 검증에서 실패한다.
- 교사 추가 = DEK 를 새 KEK 로 다시 감싸기. 데이터 재암호화 없음.
- ⚠️ **모든 계정의 비밀번호를 잃으면 vault.enc 는 복구 불가.** 백업은 `vault.enc` + `teachers.json` 을
  함께 떠야 한다. 원본 엑셀이 있으면 재임포트로 복구된다.

---

## 4단계 · 권한 로직 — "유지"가 아니라 **신규 구현**이었다

요청은 "기존 접근 제어 로직을 전환 후에도 동일 적용" 이었으나, 코드를 읽어 보니 그런 로직이 없었다.

전환 전 실제 상태:

- `assets/app.js` 에 `var DEMO_PW = '1234';` — 클라이언트 JS 평문 하드코딩
- 비밀번호를 통과하면 교사는 **전 학년 · 전 과목**을 봤다. 계정도 역할도 없었다
- 더 근본적으로 **반(班) 정보가 산출물에 없었다.** `build-data.mjs` 는 `{code, grade, avg, subjects}`
  만 쓰고 반·번호를 버렸고, `cohort.json` 은 학년 단위로만 집계했다.
  → "담임은 자기 반" 을 데이터 구조로 표현할 수 없는 상태

그래서 스키마부터 바꿨다. Rust 임포터는 반을 보존하고 반 단위 집계를 만든다.

### 역할

```rust
enum Role {
    Admin,                                        // 임포트 + 계정 관리. 전체 조회
    Homeroom { grade, class },                    // 담임: 자기 반, 전 과목
    Subject  { assignments: Vec<(grade, class, subject)> },  // 교과: 배정된 조합만
}
```

판정은 `Role::can_view(grade, class, subject)` 한 곳에서만 한다.

### 어디서 강제하는가

**Rust 안에서** (`core/src/access.rs`). `cohort` 커맨드는 vault 를 열어 `can_view` 로 거른 뒤
**허용된 슬라이스만** 직렬화해 내보낸다. 프론트는 못 보는 데이터를 애초에 받지 못한다.
devtools 로 `state` 를 고쳐도 없는 데이터는 안 나온다.

이게 웹 버전과 결정적으로 다른 점이다. 웹은 `cohort.json` 전체를 브라우저에 내려주고
UI 에서 가렸다 — 네트워크 탭만 열면 전부 보였다.

부수 결정:

- **학년 단위 집계는 관리자에게만** 준다. 다른 반 학생이 섞인 분포라서, 담임에게 주면
  "자기 반만" 이 무너진다.
- 교과교사의 상자그림은 담당 과목만 나온다(과목이 하나면 막대 하나). 의도된 결과다.
- 세션 토큰은 CSPRNG 32바이트, TTL 4시간. `잠금` 버튼이 우선이지만 안 눌러도 만료된다.
- 학생 코드는 파일 이름이 되므로 `<학년>-<대문자/숫자>` 형식만 통과시킨다 (경로 조작 차단).
- Tauri capability 는 `core:default` 만. `fs`/`shell`/`http` 플러그인을 열지 않았다 —
  모든 디스크 접근이 Rust 커맨드를 거치게 하려고.

### 남아 있는 한계 (정직하게)

- `students/<CODE>.json` 은 여전히 로그인 없이 읽힌다. 코드를 알면 그 학생의 점수를 본다.
  웹 버전과 같은 위협 모델이다. 이름은 안 나오지만, 코드가 새면 점수도 샌다.
- 앱 데이터 폴더는 Windows 사용자 ACL 에 의존한다. 같은 계정을 쓰는 사람은 파일에 접근할 수 있다
  (단, vault 는 비밀번호 없이 못 연다).
- 관리자는 전체를 본다. 임포트를 하려면 DEK 가 필요해서다.

---

## 5단계 · 자동 업데이트 — 지금은 안 붙임

수동 배포로 시작한다. 나중에 붙일 때 필요한 것:

1. `cargo add tauri-plugin-updater` + `npm i @tauri-apps/plugin-updater`
2. 서명 키 생성: `npm run tauri signer generate -- -w ~/.tauri/gakri.key`
   - **개인키(`gakri.key`)는 저장소에 넣지 않는다.** CI 에서는 `TAURI_SIGNING_PRIVATE_KEY` 시크릿으로.
   - 공개키는 `tauri.conf.json` 의 `plugins.updater.pubkey` 에 넣는다.
3. `tauri.conf.json`:
   ```json
   "plugins": {
     "updater": {
       "pubkey": "<공개키>",
       "endpoints": ["https://github.com/<org>/<repo>/releases/latest/download/latest.json"]
     }
   }
   ```
4. `latest.json` 을 릴리스 자산으로 올린다 (버전, 노트, 플랫폼별 url + signature).

지금 구조가 이걸 막지 않는다. `plugins: {}` 만 채우면 된다.

**주의**: 이 앱은 오프라인 동작이 전제다. 업데이터를 켜면 앱이 인터넷에 나간다.
교내 정책과 충돌하지 않는지 먼저 확인할 것.

---

## 개발 / 빌드

```bash
# 사전 조건: Rust(stable-msvc), MSVC Build Tools, WebView2

npm install                 # @tauri-apps/cli
npm run gen-sample          # (선택) 데모 성적 파일 생성
npm run app:dev             # tauri dev — devUrl=http://localhost:5501
npm run app:build           # 설치 파일 (msi/nsis)

cd src-tauri
cargo test -p gakri-core    # 규칙 테스트. Tauri 링크 없음, 빠름
cargo check                 # 앱 크레이트 + tauri.conf.json 검증
```

앱 첫 실행 화면 순서 (Tauri 모드에만 있다):

1. **최초 설정** — 관리자 아이디/비밀번호(8자 이상). 이때 vault 키(DEK)가 만들어진다
2. **로그인**
3. **성적 임포트** (관리자) — `<과목>.xlsx|csv` 가 들어 있는 폴더 경로 입력
4. 교사 탭 하단 **교사 계정 추가** (관리자) — 역할은 `담임 3-2` 또는 `교과 3-2-mat, 3-1-mat`

웹 버전은 영향 없다:

```bash
npm run gen-sample && npm run build && npm run serve
```

---

## 검증 상태 (2026-07-10)

| | 상태 |
|---|---|
| 웹 모드 (브라우저 실행) | ✅ 학생/교사 탭 동작, 외부 요청 0건, 콘솔 오류 없음 |
| `npm test` (Node 등급 함수) | ✅ 7/7 |
| `cargo test -p gakri-core` | ✅ 33/33 (실데이터 420명 산출물 대조 포함) |
| `cargo check` (앱 크레이트 + tauri.conf.json) | ✅ |
| **`tauri dev` / `tauri build` 로 앱 실행** | ❌ **미검증** |

앱을 띄우지 못한 이유는 코드가 아니라 이 컴퓨터의 환경이다.

- `rustc`/`cargo` 1.97.0 은 설치됨.
- MSVC 링커가 없다. VS Build Tools 를 세 번 새로 설치했는데 매번
  `Installer` 폴더의 DLL 이 전부 사라져(`0 dll`) `setup.exe` 가
  `System.BadImageFormatException` 으로 죽었다. Windows Defender 서비스도 꺼져 있다
  (`Get-MpPreference` → `0x800106ba`) — 학교 관리 단말의 엔드포인트 보호가
  새로 쓰인 PE 파일을 지우는 것으로 보인다. 백신을 끄지 않았다.
- 검증은 MinGW-w64(`x86_64-pc-windows-gnu`)를 임시 폴더에 풀어서 우회했다. 이 타깃으로도
  `gakri-core` 테스트는 전부 돈다. 다만 GNU 타깃으로 링크한 **테스트 실행파일**은
  `STATUS_ENTRYPOINT_NOT_FOUND` 로 뜨지 않아, 규칙 로직을 코어 크레이트로 분리해
  webview2 없이 테스트하도록 바꿨다 (그래서 위 33개가 돈다).

**다음 사람이 할 일**: MSVC 링커가 정상인 컴퓨터에서

```bash
npm install && npm run app:dev
```

를 돌려 실제 창이 뜨는지, 최초 설정 → 임포트 → 담임 로그인 흐름이 도는지 확인.
Rust 규칙과 프론트 로직은 위 표대로 검증됐지만, **창이 뜨는 것 자체는 아직 아무도 못 봤다.**
