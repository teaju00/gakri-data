# 교사 로그인: 비밀번호만 입력 + 관리자 계정 씨딩 — 설계 문서

날짜: 2026-07-15
범위: `src-tauri/core`(Rust) + `assets/api.js`/`assets/app.js`(프론트). Tauri 데스크톱 모드 전용 — 웹 데모 모드는 이미 비밀번호만 쓰므로 무변경.

## 배경

Tauri 앱 로컬 볼트(`teachers.json` + `vault.enc`)는 비밀번호로 DEK(데이터 암호화 키)를 감싸는 구조(`src-tauri/core/src/crypto.rs`)라, 비밀번호를 잃으면 복구 불가능. 이전 세션에서 관리자 계정(아이디 `tea`)을 만들고 학생 420명을 임포트했는데, 비밀번호를 분실해 로그인 불가 상태가 됨. 유저가 `%APPDATA%\kr.school.gakri-data\` 폴더를 직접 삭제(볼트 초기화)하기로 함 — 이 삭제는 Claude Code가 대신 할 수 없는 영구 삭제 액션이라 유저 본인이 수행.

유저 요청 3가지:
1. 교사진단 탭 상자그림 UX 점검 → **완료**(별도 세션에서 처리됨, 커밋 `9220bf4`: 반별 상자그림에 현재 선택 반 하이라이트 추가, 반 1개뿐인 세션엔 반별 비교 대신 과목별 비교를 기본값으로 강제).
2. "교사 계정 추가" UI로 만들지 말고 Claude Code가 파일로 미리 만들어두기 → 이 스펙에서 다룸.
3. 아이디+비밀번호 대신 비밀번호만 입력하는 로그인, **영구 적용**(여러 교사가 써도 계속 이 방식) → 이 스펙에서 다룸.

## 설계

### 1. 관리자 계정 씨딩 유틸리티

`src-tauri/core/examples/seed_admin.rs` 신규 생성. `service::provision()`을 그대로 호출(암호화 로직 재구현 없음 — 실제 앱이 쓰는 동일한 검증된 경로).

```
cargo run --example seed_admin --manifest-path src-tauri/core/Cargo.toml -- "<앱데이터경로>" admin gakri2026admin
```

- 인자: `<app_data_dir> <username> <password>` (경로는 플랫폼 종속이라 하드코딩하지 않고 인자로 받음 — Windows 기본값은 `%APPDATA%\kr.school.gakri-data`).
- 이미 provision된 상태(`is_provisioned() == true`)면 `AlreadyProvisioned` 에러를 그대로 노출하고, 먼저 해당 폴더를 지우라는 안내 메시지를 stderr에 출력.
- 성공 시 사용한 아이디/비밀번호를 stdout에 그대로 출력(터미널에서 바로 확인 가능하도록).
- 이번엔 관리자 계정 1개만(`Role::Admin`, 아이디 `admin`, 비밀번호 `gakri2026admin`).

### 2. 로그인: 비밀번호만 (Rust, 영구 변경)

`src-tauri/core/src/service.rs`의 `login()` 시그니처를 `(p, sessions, username, password)` → `(p, sessions, password)`로 변경. 저장된 모든 `TeacherRecord`에 대해 입력 비밀번호로 `crypto::unwrap_dek()`를 시도해 **처음 성공하는 계정**으로 로그인한다:

```rust
pub fn login(p: &Paths, sessions: &SessionStore, password: &str) -> Result<SessionDto> {
    let file = store::read_teachers(p)?;
    if file.teachers.is_empty() {
        return Err(AppError::NotProvisioned);
    }
    let (rec, dek) = file.teachers.iter()
        .find_map(|t| crypto::unwrap_dek(password, &t.kdf, &t.wrapped_dek).ok().map(|d| (t, d)))
        .ok_or(AppError::BadCredentials)?;
    let vault = store::read_vault(p, &dek)?;
    let scope = access::scope_for(&rec.role, &vault);
    let token = sessions.insert(rec.role.clone(), dek);
    Ok(SessionDto { token, display_name: rec.display_name.clone(), role: rec.role.tag(), scope })
}
```

AEAD 태그 검증이 사실상의 비밀번호 검증이므로(`crypto.rs` 기존 주석: "잘못된 비밀번호는 AEAD 태그 검증에서 실패한다"), 이 방식 자체는 안전하다. 계정이 1개면 지금과 동일하게 동작하고, 여러 개여도 그대로 확장된다.

`src-tauri/src/commands.rs`의 `login` Tauri 커맨드에서 `username` 파라미터 제거.

### 3. 비밀번호 중복 방지 (Rust, 계정 생성 시점)

여러 교사 계정이 같은 비밀번호를 갖게 되면 로그인이 어느 계정으로 풀릴지 모호해진다. `provision()`과 `add_teacher()` 양쪽에 계정 생성 시 다음 검사를 추가한다: 새 비밀번호로 **기존에 저장된 모든 계정**의 `wrapped_dek`를 풀어보려 시도해서, 하나라도 성공하면(=이미 다른 계정이 쓰는 비밀번호) 생성을 거부한다.

```rust
fn check_password_unique(password: &str, existing: &[TeacherRecord]) -> Result<()> {
    let collides = existing.iter()
        .any(|t| crypto::unwrap_dek(password, &t.kdf, &t.wrapped_dek).is_ok());
    if collides {
        return Err(AppError::InvalidInput("이미 사용 중인 비밀번호입니다. 다른 비밀번호를 쓰세요.".into()));
    }
    Ok(())
}
```

`add_teacher()`에서는 `store::read_teachers(p)?`로 읽은 기존 목록에 대해 새 비밀번호 확정 직전 호출. `provision()`은 최초 실행이라 기존 계정이 없어 사실상 항상 통과하지만, 일관성을 위해 동일 헬퍼를 (빈 목록으로) 통과시킨다. 계정 생성은 드문 동작이라 성능 영향 없음(로그인 경로와 달리 딱 한 번만 도는 검사).

### 4. 프론트엔드 반영

- `assets/api.js`: `tauriImpl.login`을 `function (password) { return invoke('login', { password: password }).then(...) }`로 단순화. `webImpl.login`도 동일 시그니처로 맞춤(이미 username을 무시하고 있었으므로 실질적 동작 변화 없음).
- `assets/app.js`의 `entryGate()`: `caps.accounts`일 때만 보이던 아이디 입력칸(`userField`)을 제거 — 웹 모드와 동일하게 비밀번호 칸만 남는다. 부제 문구("배정된 교사 계정으로 로그인해 주세요" 등 캡스별 안내 텍스트)는 그대로 유지.
- `doEnter()`: `#user` 필드 읽는 로직 제거, `api.login(state.pw)` 한 형태로 통일.

## 에러 처리

- 로그인 실패(모든 계정에 대해 비밀번호 불일치): 기존과 동일하게 `BadCredentials` → 프론트에 "비밀번호가 올바르지 않습니다" 표시(이미 있는 문구, 아이디 언급 부분만 제거).
- 계정이 하나도 없는 상태에서 로그인 시도: 기존과 동일하게 `NotProvisioned`.
- 비밀번호 중복으로 계정 생성 거부: 새 에러 메시지 "이미 사용 중인 비밀번호입니다" → `add_teacher` 관리자 패널의 기존 에러 표시 영역(`state.adminMsg`)에 그대로 뜬다(새 UI 불필요, `errText()` 헬퍼가 이미 서버 에러 메시지를 그대로 통과시킴).

## 테스트 계획

`src-tauri/core` 기존 테스트 컨벤션(`crypto.rs`의 인라인 `#[cfg(test)]`, `tests/end_to_end.rs`의 통합 테스트) 따름:

- `service.rs` 또는 `end_to_end.rs`에 추가:
  - 계정 여러 개 중 비밀번호로 올바른 계정을 찾는지 (`login`이 관리자/담임 등 서로 다른 비밀번호로 각각 맞는 role을 반환하는지).
  - 틀린 비밀번호는 `BadCredentials`.
  - `add_teacher`에 기존 계정과 같은 비밀번호를 주면 거부되는지.
  - `provision` + `login` 왕복(비밀번호만).
- `cargo test`로 전체 스위트 통과 확인(Rust 쪽은 이 세션에서 실행 불가 — MSVC 링커 문제로 `stable-x86_64-pc-windows-gnu` 툴체인 오버라이드 중이었음, 다음 세션에서 `cargo test` 실행 전 `rustup show`로 활성 툴체인 확인 필요. 상세는 아래 "다음 세션 참고" 참고).
- 프론트: `node --check assets/app.js assets/api.js` 문법 검증. 웹 데모 모드 브라우저 회귀 확인(로그인 화면에 원래도 아이디 칸이 없었으므로 시각적 변화 없어야 함).

## 범위 밖

- "교사 계정 추가" 관리자 패널 UI(`adminPanel()`/`doAddTeacher()`)는 변경하지 않음 — 아이디 입력칸은 내부 식별자/표시이름 용도로 계속 존재. 앞으로 계정 추가는 이 UI 대신 Claude Code에 요청해 씨드 스크립트를 돌리는 방식으로 진행하기로 함(이번 세션 대화에서 확정).
- 이미 존재하는 `provision()`/`add_teacher()` 자체의 아이디 요구사항은 변경 없음 — 로그인만 비밀번호 단독으로 바뀐다.
