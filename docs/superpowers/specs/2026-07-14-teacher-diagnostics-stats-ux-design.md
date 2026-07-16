# 교사 진단 탭 통계 UX 확장 — 설계 문서

날짜: 2026-07-14
범위: 프론트엔드만 (`assets/app.js`, `assets/charts.js`). Rust/`src-tauri` 무변경.

## 배경

교사 진단 탭(`teacherDash()`)은 현재:
- 학년/반/과목을 선택하면 그 반 하나의 통계(학생수·평균·표준편차·중앙값·히스토그램·5등급분포)를 보여줌.
- 상자그림은 이번 세션(2026-07-14 앞선 작업)에서 "선택한 과목의 반별 산포"로 바뀜 — 반 데이터가 있는 Tauri 모드에서는 과목별 비교 뷰에 더는 접근할 수 없음.

이번 스펙은 두 가지를 추가한다:
1. 여러 반을 볼 수 있는 세션(관리자, 또는 여러 반을 담당하는 교과교사)이 반들을 합친 "전체" 통계를 볼 수 있게.
2. 상자그림에서 반별 비교와 과목별 비교를 토글로 오갈 수 있게(현재는 반별만 가능).

## 1. 전체 반 통계

### 데이터 모델
`state.tClass`에 실제 반 번호 외에 `'all'`이라는 예약값을 허용한다.

`allowedClasses(g)`가 반환하는 반이 2개 이상일 때만 반 선택 버튼 줄에 "전체" 버튼을 추가로 렌더링한다(1개뿐이면 의미 없으므로 숨김). 기본 선택값은 그대로 첫 번째 개별 반 — "전체"는 명시적으로 눌러야 활성화된다.

### 합산 로직
`cohortNode()`가 `state.tClass === 'all'`일 때는 `allowedClasses(g)`의 모든 반의 `state.cohort.classes[g][c]`를 합쳐 만든 가상 `GroupNode`를 반환하도록 확장한다:

- `count`: 각 반 `count`의 합.
- 과목별로(`subjects[sid]`):
  - `totals`: 각 반의 `totals` 배열을 이어붙임.
  - `gradeCounts`: 요소별 합산(6칸 배열, 인덱스 0은 미사용).
  - `stats`: 합쳐진 `totals` 배열로 새로 계산(아래 `summaryStats` 참고).
  - `name`: 그대로(반마다 동일 과목명이므로 첫 반 것 사용).
- 과목 목록은 반마다 다를 수 있으므로(교과교사가 일부 반은 배정 안 된 과목이 있을 수 있음) **교집합이 아니라 합집합**으로 잡되, 한 과목이라도 데이터가 있는 반이 하나도 없으면 그 과목은 결과에서 제외.

이 결과는 매 렌더마다 다시 계산한다(네트워크 호출 없이 이미 받아온 `state.cohort` 배열 연산만 하므로 비용 작음 — 별도 캐싱 불필요).

### `summaryStats` JS 포팅
`src-tauri/core/src/grade.rs`(그리고 `scripts/grade.mjs`)에 이미 있는 평균/모집단표준편차/사분위(선형보간) 로직을 `assets/charts.js`(또는 `assets/app.js`)에 순수 함수로 포팅한다. 시그니처: `summaryStats(totals) -> {n, mean, sd, min, q1, median, q3, max}`. `scripts/grade.mjs`의 기존 구현을 그대로 참고해 동일한 보간 방식을 쓴다(다른 알고리즘을 새로 발명하지 않는다).

### 화면 반영 범위
"전체" 선택 시 통계카드(학생수·평균·표준편차·중앙값) + 히스토그램 + 5등급분포 모두 이 합산 노드를 기준으로 다시 그린다. 제목/라벨의 "N반" 표기는 "전체"로 바뀐다(`groupLabel` 분기 추가).

상자그림(반별 비교)은 이 기능과 무관 — 여전히 `classes.reduce(...)`로 개별 반들을 나열하며, `'all'`은 반 목록에 섞이지 않는다.

## 2. 상자그림 반별/과목별 토글

### 상태
`state.boxView`를 추가: `'class' | 'subject'`. `classScoped()`가 true인 세션 초기값은 `'class'`(현재 동작 유지). `classScoped()`가 false(웹 데모)면 토글 자체를 렌더링하지 않고 항상 과목별 비교로 고정(반 데이터가 없으므로 선택지가 없음).

### UI
상자그림 카드 헤더에 작은 2단 토글(기존 `.clay-tab-active`/`.clay-soft-btn` 필 스타일 재사용) — "반별" / "과목별". 클릭 시 `state.boxView` 갱신 후 `render()`.

### 계산
현재 `boxItems`/`boxTitle`/`boxHint`를 결정하던 조건 `boxByClass = classScoped()`를 `boxByClass = classScoped() && state.boxView === 'class'`로 바꾼다. 선택되지 않은 쪽의 `boxItems`는 계산하지 않는다(불필요한 SVG 문자열 생성 방지 — 지난 코드리뷰에서 지적된 효율성 원칙 유지).

레이아웃(전체 폭 vs 2열 그리드)도 `boxByClass` 값을 그대로 따라가므로 추가 분기 불필요 — 기존 `distSection` 로직 그대로 재사용.

## 에러/경계 처리

- `allowedClasses(g)`가 빈 배열이면(이론상 `normalizeSelection()`이 이미 걸러내므로 도달 불가) "전체" 버튼 자체가 안 뜬다 — 기존 가드에 편승.
- 합산 대상 반 중 특정 과목 데이터가 없는 반이 섞여 있어도(교과교사가 일부 반에 배정 안 된 과목) `subjects[sid]`가 `undefined`인 반은 합산에서 건너뛴다.
- `totals` 배열이 1~2개 값만 있는 극단적으로 작은 반이 섞여도 `summaryStats`는 `scripts/grade.mjs`와 동일한 n=1 특수 처리를 그대로 포팅하므로 별도 가드 불필요.

## 테스트 계획

- `node --check assets/app.js assets/charts.js` 문법 검증.
- 브라우저에서 실제 조작 검증(웹 데모 모드 한계 인지하고 진행):
  - 웹 모드: "전체" 버튼·토글 둘 다 안 보여야 함(회귀 없음 확인).
  - `state.cohort.classes` 모양을 흉내 낸 합성 데이터로 `cohortNode()`의 합산 분기와 `summaryStats`를 콘솔에서 직접 호출해 검증(실제 Tauri 런타임 없이도 가능).
- `npm test`(기존 `scripts/grade.test.mjs`)는 무관하지만 회귀 없는지 재실행.

## 범위 밖

- 로그인 화면/교사 계정 추가 폼 UX(별도 스펙 A에서 다룸).
- Rust 백엔드 변경 없음 — `access.rs`의 반 단위 접근 제어(`visible_classes`)는 그대로. "전체"는 이미 세션에 노출된 반들만 합치므로 새로운 데이터 노출이 없다.
