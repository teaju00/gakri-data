# 교사 진단 탭 통계 UX 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교사 진단 탭에 (1) 여러 반을 합친 "전체 반" 통계 뷰와 (2) 상자그림의 반별/과목별 비교 토글을 추가한다.

**Architecture:** 순수 통계 함수(`summaryStats`, `combineClassNodes`)를 `assets/charts.js`에 신규 작성하고 Node 테스트로 검증(TDD)한 뒤, `assets/app.js`의 `teacherDash()` 및 관련 헬퍼(`cohortNode`, `normalizeSelection`, 클릭 핸들러)를 확장해 UI에 연결한다. 프론트엔드만 변경 — Rust/`src-tauri` 무변경.

**Tech Stack:** 바닐라 JS(ES5 스타일, 프레임워크 없음), `node:test`+`node:assert/strict`(기존 `scripts/grade.test.mjs`와 동일 컨벤션), Chart.js(막대), 순수 SVG 문자열 빌더.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-14-teacher-diagnostics-stats-ux-design.md` — 모든 태스크는 이 문서의 요구사항을 벗어나지 않는다.
- Rust(`src-tauri/`) 변경 없음. 접근 제어(`access.rs`)는 그대로 — "전체"는 세션에 이미 노출된 반들만 합치므로 새 데이터 노출 없음.
- 기존 코드 스타일 유지: `var` 선언, 함수 표현식, 문자열 연결로 HTML 빌드(템플릿 리터럴 미사용 — 파일 전체가 이 스타일).
- 웹 데모 모드(`classScoped() === false`)에서는 두 기능 모두 UI에 나타나지 않아야 함(회귀 없음).
- 각 태스크 완료 후 `node --check assets/app.js assets/charts.js`로 문법 검증 필수.
- 코드/커밋 메시지는 프로젝트 기존 커밋 스타일(한글, `feat:`/`fix:` 프리픽스) 따름.

---

### Task 1: `summaryStats` / `combineClassNodes` 순수 함수 (TDD)

**Files:**
- Create: `scripts/charts-stats.test.mjs`
- Modify: `assets/charts.js:29` 뒤에 삽입 (현재 `escXml` 함수 정의 직후, `TINT_SLOPE_DOT` 등 상수 선언 앞)
- Modify: `package.json:10` (`test` 스크립트)

**Interfaces:**
- Produces: `GK.summaryStats(values: number[]) -> {n, mean, sd, min, q1, median, q3, max}` — Task 2가 사용.
- Produces: `GK.combineClassNodes(nodes: Array<{count, subjects: Object}|undefined>) -> {count, subjects: Object}` — Task 2가 사용. 반환되는 `subjects[sid]`는 `{name, totals, gradeCounts, stats}` 형태로, 기존 `state.cohort.classes[g][c].subjects[sid]`와 동일한 모양.

**참고:** `assets/charts.js`는 `window.GK`에 붙는 클래식 스크립트라 Node에서 직접 `require`할 수 없어 보이지만, `global.window`를 미리 세팅해두면 `require()`로 로드된다(아래 테스트 코드가 그 방식). 이미 이 방법으로 `require('../assets/charts.js')` 후 `global.window.GK`에 6개 함수가 정상 노출되는 것을 확인함.

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/charts-stats.test.mjs` 파일을 다음 내용으로 생성:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.window = {};
require('../assets/charts.js');
const GK = global.window.GK;

test('summaryStats: 평균/모집단표준편차/min/max', () => {
  const r = GK.summaryStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.n, 8);
  assert.equal(r.mean, 5);
  assert.ok(Math.abs(r.sd - 2) < 1e-9);
  assert.equal(r.min, 2);
  assert.equal(r.max, 9);
});

test('summaryStats: 사분위(선형보간)', () => {
  const r = GK.summaryStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.q1, 4);
  assert.equal(r.median, 4.5);
});

test('summaryStats: n=1 특수 케이스', () => {
  const r = GK.summaryStats([42]);
  assert.equal(r.n, 1);
  assert.equal(r.mean, 42);
  assert.equal(r.sd, 0);
  assert.equal(r.q1, 42);
  assert.equal(r.median, 42);
  assert.equal(r.q3, 42);
});

test('combineClassNodes: count 합산 + totals 이어붙임 + gradeCounts 요소별 합산', () => {
  const nodeA = { count: 2, subjects: { kor: { name: '국어', totals: [70, 80], gradeCounts: [0, 1, 1, 0, 0, 0] } } };
  const nodeB = { count: 3, subjects: { kor: { name: '국어', totals: [60, 65, 90], gradeCounts: [0, 0, 1, 1, 1, 0] } } };
  const combined = GK.combineClassNodes([nodeA, nodeB]);
  assert.equal(combined.count, 5);
  assert.deepEqual(combined.subjects.kor.totals, [70, 80, 60, 65, 90]);
  assert.deepEqual(combined.subjects.kor.gradeCounts, [0, 1, 2, 1, 1, 0]);
  assert.equal(combined.subjects.kor.stats.n, 5);
  assert.equal(combined.subjects.kor.name, '국어');
});

test('combineClassNodes: 한 반에만 있는 과목도 합집합으로 포함', () => {
  const nodeA = { count: 2, subjects: { kor: { name: '국어', totals: [70, 80], gradeCounts: [0, 1, 1, 0, 0, 0] } } };
  const nodeB = { count: 3, subjects: {} };
  const combined = GK.combineClassNodes([nodeA, nodeB]);
  assert.equal(combined.count, 5);
  assert.deepEqual(combined.subjects.kor.totals, [70, 80]);
});

test('combineClassNodes: undefined 반(노드 없음)은 건너뜀', () => {
  const nodeA = { count: 2, subjects: { kor: { name: '국어', totals: [70, 80], gradeCounts: [0, 1, 1, 0, 0, 0] } } };
  const combined = GK.combineClassNodes([nodeA, undefined]);
  assert.equal(combined.count, 2);
  assert.deepEqual(combined.subjects.kor.totals, [70, 80]);
});

test('combineClassNodes: 빈 배열이면 count 0, subjects 빈 객체', () => {
  const combined = GK.combineClassNodes([]);
  assert.equal(combined.count, 0);
  assert.deepEqual(combined.subjects, {});
});
```

- [ ] **Step 2: 테스트 실패 확인**

실행: `node --test scripts/charts-stats.test.mjs`
예상: `GK.summaryStats is not a function` 류의 에러로 전부 FAIL.

- [ ] **Step 3: `assets/charts.js`에 최소 구현 작성**

`assets/charts.js:29`(현재 `escXml` 함수의 닫는 `}` 다음 줄, `TINT_SLOPE_DOT` 상수 선언 앞)에 아래 블록을 삽입:

```js

  // 기술통계: 평균, 모집단 표준편차, min/q1/median/q3/max (사분위=선형보간 type7).
  // src-tauri/core/src/grade.rs · scripts/grade.mjs 와 동일 알고리즘의 브라우저 포팅.
  function percentile(sorted, p) {
    var n = sorted.length;
    if (n === 1) return sorted[0];
    var idx = p * (n - 1), lo = Math.floor(idx), hi = Math.ceil(idx), frac = idx - lo;
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
  }
  GK.summaryStats = function (values) {
    var n = values.length;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mean = sorted.reduce(function (a, b) { return a + b; }, 0) / n;
    var variance = sorted.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / n;
    return {
      n: n, mean: mean, sd: Math.sqrt(variance), min: sorted[0],
      q1: percentile(sorted, 0.25), median: percentile(sorted, 0.5), q3: percentile(sorted, 0.75),
      max: sorted[n - 1]
    };
  };

  // 세션에 보이는 여러 반의 GroupNode를 하나로 합친다 — "전체 반" 통계용.
  // nodes: [{count, subjects:{sid:{name,totals,gradeCounts}}}, ...] (반 하나가 undefined 여도 무시)
  GK.combineClassNodes = function (nodes) {
    var count = 0;
    var bySubject = {};
    nodes.forEach(function (node) {
      if (!node) return;
      count += node.count || 0;
      Object.keys(node.subjects || {}).forEach(function (sid) {
        var d = node.subjects[sid];
        if (!d) return;
        if (!bySubject[sid]) bySubject[sid] = { name: d.name, totals: [], gradeCounts: [0, 0, 0, 0, 0, 0] };
        var acc = bySubject[sid];
        acc.totals = acc.totals.concat(d.totals);
        for (var i = 0; i < 6; i++) acc.gradeCounts[i] += (d.gradeCounts[i] || 0);
      });
    });
    var subjects = {};
    Object.keys(bySubject).forEach(function (sid) {
      var acc = bySubject[sid];
      if (!acc.totals.length) return;
      subjects[sid] = { name: acc.name, totals: acc.totals, gradeCounts: acc.gradeCounts, stats: GK.summaryStats(acc.totals) };
    });
    return { count: count, subjects: subjects };
  };
```

- [ ] **Step 4: 테스트 통과 확인**

실행: `node --test scripts/charts-stats.test.mjs`
예상: 7개 테스트 전부 PASS.

- [ ] **Step 5: `package.json`의 `test` 스크립트가 새 테스트 파일도 돌리도록 수정**

`package.json:10`을 다음으로 변경:

```json
    "test": "node --test",
```

(인자 없이 `node --test`를 실행하면 cwd 기준으로 `**/*.test.mjs` 패턴을 재귀적으로 찾아 `grade.test.mjs`와 `charts-stats.test.mjs` 둘 다 자동 실행한다 — `node --test scripts/`처럼 경로를 직접 넘기면 Node가 이를 디렉터리 글롭이 아니라 `require('scripts')` 모듈 이름으로 해석해 `MODULE_NOT_FOUND`로 실패하므로 인자 없이 호출해야 한다. `node --test` 단독 실행으로 기존 `grade.test.mjs` 7개가 정상 자동 발견되는 것을 확인함.)

- [ ] **Step 6: 전체 테스트 스위트 재확인**

실행: `npm test`
예상: `grade.test.mjs` 7개 + `charts-stats.test.mjs` 7개, 총 14개 PASS, 0 fail.

- [ ] **Step 7: 문법 검증 + 커밋**

실행: `node --check assets/charts.js && echo OK`
예상: `OK`

```bash
git add assets/charts.js scripts/charts-stats.test.mjs package.json
git commit -m "$(cat <<'EOF'
feat: add summaryStats/combineClassNodes pure functions for whole-class stats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: "전체 반" 통계 뷰 (app.js)

**의존:** Task 1 완료 필요(`GK.combineClassNodes` 사용).

**Files:**
- Modify: `assets/app.js:232-236` (`cohortNode`)
- Modify: `assets/app.js:239-250` (`normalizeSelection`)
- Modify: `assets/app.js:274-281` (`classBtns` — teacherDash 내부)
- Modify: `assets/app.js:289` (`groupLabel` — teacherDash 내부)
- Modify: `assets/app.js:576` (`onClick`의 `tClass` 액션)

**Interfaces:**
- Consumes: `GK.combineClassNodes(nodes)` (Task 1).
- 이 태스크가 끝나면 `state.tClass`는 숫자(실제 반) 또는 문자열 `'all'`(전체) 두 가지를 가질 수 있다 — Task 3는 이 값을 직접 다루지 않으므로 영향 없음.

- [ ] **Step 1: `cohortNode()`에 `'all'` 분기 추가**

`assets/app.js:232-236`의 현재 코드:

```js
  function cohortNode() {
    if (!classScoped()) return state.cohort.grades[state.tGrade];
    var byClass = state.cohort.classes[state.tGrade];
    return byClass && byClass[state.tClass];
  }
```

다음으로 교체:

```js
  function cohortNode() {
    if (!classScoped()) return state.cohort.grades[state.tGrade];
    if (state.tClass === 'all') {
      var byClassAll = state.cohort.classes[state.tGrade] || {};
      var nodes = allowedClasses(state.tGrade).map(function (c) { return byClassAll[c]; });
      return GK.combineClassNodes(nodes);
    }
    var byClass = state.cohort.classes[state.tGrade];
    return byClass && byClass[state.tClass];
  }
```

- [ ] **Step 2: `normalizeSelection()`이 `'all'`을 유효한 선택으로 인정하도록 수정**

`assets/app.js:239-250`의 현재 코드:

```js
  function normalizeSelection() {
    var gs = allowedGrades();
    if (gs.indexOf(state.tGrade) < 0) state.tGrade = gs[0];
    if (classScoped()) {
      var cs = allowedClasses(state.tGrade);
      if (cs.indexOf(state.tClass) < 0) state.tClass = cs[0];
    }
    var node = cohortNode();
    if (!node) return false;
    if (!node.subjects[state.tSubject]) state.tSubject = Object.keys(node.subjects)[0];
    return !!state.tSubject;
  }
```

`if (cs.indexOf(state.tClass) < 0) state.tClass = cs[0];` 줄만 다음으로 교체(나머지는 그대로):

```js
      var classValid = state.tClass === 'all' ? cs.length > 1 : cs.indexOf(state.tClass) >= 0;
      if (!classValid) state.tClass = cs[0];
```

(이 가드가 없으면 `state.tClass === 'all'`일 때 `cs.indexOf('all')`가 항상 -1이라 매 렌더마다 강제로 `cs[0]`로 되돌아가 "전체" 선택이 즉시 풀려버린다.)

- [ ] **Step 3: onClick의 `tClass` 액션이 `'all'`을 숫자로 잘못 변환하지 않도록 수정**

`assets/app.js:576`의 현재 코드:

```js
    else if (act === 'tClass') { state.tClass = +t.getAttribute('data-class'); render(); }
```

다음으로 교체:

```js
    else if (act === 'tClass') { var cv = t.getAttribute('data-class'); state.tClass = cv === 'all' ? 'all' : +cv; render(); }
```

(`+`(단항 플러스)로 문자열 `'all'`을 숫자로 바꾸면 `NaN`이 되어 버튼이 깨진다.)

- [ ] **Step 4: `classBtns`에 "전체" 버튼 추가(반이 2개 이상일 때만)**

`assets/app.js:274-278`의 현재 코드:

```js
    var classes = allowedClasses(g);
    var classBtns = classes.map(function (cc) {
      var btnCls = (cc === state.tClass) ? 'clay-tab-active' : 'clay-soft-btn';
      return '<button data-act="tClass" data-class="' + cc + '" class="' + btnCls + '" style="padding:9px 16px;font-size:14px;">' + cc + '반</button>';
    }).join('');
```

다음으로 교체:

```js
    var classes = allowedClasses(g);
    var classBtns = classes.map(function (cc) {
      var btnCls = (cc === state.tClass) ? 'clay-tab-active' : 'clay-soft-btn';
      return '<button data-act="tClass" data-class="' + cc + '" class="' + btnCls + '" style="padding:9px 16px;font-size:14px;">' + cc + '반</button>';
    }).join('') + (classes.length > 1
      ? '<button data-act="tClass" data-class="all" class="' + (state.tClass === 'all' ? 'clay-tab-active' : 'clay-soft-btn') + '" style="padding:9px 16px;font-size:14px;">전체</button>'
      : '');
```

- [ ] **Step 5: `groupLabel`에 "전체" 분기 추가**

`assets/app.js:289`의 현재 코드:

```js
    var groupLabel = classScoped() ? (g + '학년 ' + state.tClass + '반') : (g + '학년');
```

다음으로 교체:

```js
    var groupLabel = classScoped() ? (g + '학년 ' + (state.tClass === 'all' ? '전체' : state.tClass + '반')) : (g + '학년');
```

- [ ] **Step 6: 문법 검증**

실행: `node --check assets/app.js && echo OK`
예상: `OK`

- [ ] **Step 7: `cohortNode`/`combineClassNodes` 연결을 콘솔에서 직접 검증**

브라우저(또는 `node`에 `global.window`/`document` 스텁 후 `require`)에서 아래를 실행해 결합 로직이 실제 데이터 모양과 맞는지 확인(Tauri 런타임 없이도 `state.cohort.classes` 모양만 흉내 내면 됨):

```js
var fakeNodes = [
  { count: 30, subjects: { kor: { name: '국어', totals: [70, 75, 80], gradeCounts: [0,1,1,1,0,0] } } },
  { count: 28, subjects: { kor: { name: '국어', totals: [60, 65], gradeCounts: [0,0,0,1,1,0] } } }
];
var combined = GK.combineClassNodes(fakeNodes);
console.log(combined.count, combined.subjects.kor.totals, combined.subjects.kor.stats);
```

예상: `count === 58`, `totals`가 5개 값 이어붙임, `stats.n === 5`.

- [ ] **Step 8: 브라우저에서 웹 데모 모드 회귀 확인**

`npm run serve` 후 `http://localhost:5501` 접속, 데모 비밀번호(`1234`)로 로그인, 교사 진단 탭 진입. 반 선택 버튼 줄에 "전체" 버튼이 **나타나지 않아야 함**(웹 데모는 `classScoped() === false`이므로 `classBtns` 자체가 비어 `classes.length > 1` 조건에 도달하지 않음). 콘솔 에러 없어야 함.

- [ ] **Step 9: 커밋**

```bash
git add assets/app.js
git commit -m "$(cat <<'EOF'
feat: add "전체 반" aggregate view to teacher diagnostics

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 상자그림 반별/과목별 토글 (app.js)

**의존:** Task 2 완료 후 진행(같은 파일 `teacherDash()` 내부를 연속 수정 — 순서 뒤바뀌면 줄 번호가 어긋남).

**Files:**
- Modify: `assets/app.js` — `state` 초기값 (파일 상단, 현재 17-24행)
- Modify: `assets/app.js` — `teacherDash()`의 `boxByClass`/`boxPlotCard` 부분 (Task 2 적용 후 기준 259행대)
- Modify: `assets/app.js` — `onClick` 핸들러 (현재 tClass 핸들러 근처, 576행대)

**Interfaces:**
- 이 태스크는 신규 함수를 만들지 않고 기존 `boxByClass`/`boxTitle`/`boxHint`/`boxItems`/`boxPlotCard` 지역 변수 로직만 조건을 바꾼다. `GK.boxPlotSVG(items)`는 기존 시그니처 그대로 재사용.

- [ ] **Step 1: `state`에 `boxView` 초기값 추가**

`assets/app.js:17-24`의 현재 코드:

```js
  var state = {
    tab: 'student',
    // provisioned: 관리자 계정이 있는가. 웹 모드는 계정 개념이 없어 항상 true.
    provisioned: !caps.accounts, needsImport: false, adminMsg: '',
    entered: false, user: '', pw: '', pwErr: '', session: null,
    code: '', codeErr: false, student: null, selSubject: null,
    cohort: null, tGrade: null, tClass: null, tSubject: null, _cohortLoading: false
  };
```

`cohort: null, tGrade: null, tClass: null, tSubject: null, _cohortLoading: false` 줄만 다음으로 교체:

```js
    cohort: null, tGrade: null, tClass: null, tSubject: null, _cohortLoading: false,
    // boxView: 상자그림 비교 축. null(기본, classScoped 세션이면 반별) | 'class' | 'subject'.
    boxView: null
```

- [ ] **Step 2: `boxByClass` 판정에 `state.boxView` 반영**

`teacherDash()` 안의 현재 코드(Task 2 적용 후에도 이 세 줄 자체는 그대로 존재):

```js
    var boxByClass = classScoped();
```

다음으로 교체:

```js
    var boxByClass = classScoped() && state.boxView !== 'subject';
```

(기본값 `null`이면 `!== 'subject'`가 참이라 기존과 동일하게 반별이 기본. `state.boxView === 'subject'`일 때만 과목별로 전환.)

- [ ] **Step 3: 상자그림 헤더에 토글 버튼 추가**

현재 `boxPlotCard` 정의(Task 2 적용 후에도 이 블록 자체는 그대로):

```js
    var boxPlotCard = '<div class="clay-raised" style="' + CARD_PAD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#036242;">' + svg('#ic-box', 20) + '<span style="font-size:16px;font-weight:800;color:#0A3D2A;">' + boxTitle + ' (상자그림)</span></div>' +
      '<div style="font-size:12px;color:#7FA895;margin-bottom:8px;">' + boxHint + '</div>' +
      '<div style="padding:14px;' + CHART + '">' + GK.boxPlotSVG(boxItems) + '</div></div>';
```

바로 앞줄에 토글 변수를 추가하고, `boxPlotCard`의 헤더 `<div>`를 `justify-content:space-between`으로 바꿔 토글을 오른쪽에 넣는다. 전체를 다음으로 교체:

```js
    var boxToggle = classScoped()
      ? '<div class="clay-inset" style="display:inline-flex;gap:4px;padding:4px;border-radius:12px;flex:none;">' +
          '<button data-act="boxView" data-view="class" class="' + (boxByClass ? 'clay-tab-active' : 'clay-soft-btn') + '" style="padding:6px 12px;font-size:12px;">반별</button>' +
          '<button data-act="boxView" data-view="subject" class="' + (!boxByClass ? 'clay-tab-active' : 'clay-soft-btn') + '" style="padding:6px 12px;font-size:12px;">과목별</button>' +
        '</div>'
      : '';
    var boxPlotCard = '<div class="clay-raised" style="' + CARD_PAD + '"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap;">' +
      '<div style="display:flex;align-items:center;gap:10px;color:#036242;">' + svg('#ic-box', 20) + '<span style="font-size:16px;font-weight:800;color:#0A3D2A;">' + boxTitle + ' (상자그림)</span></div>' +
      boxToggle + '</div>' +
      '<div style="font-size:12px;color:#7FA895;margin-bottom:8px;">' + boxHint + '</div>' +
      '<div style="padding:14px;' + CHART + '">' + GK.boxPlotSVG(boxItems) + '</div></div>';
```

- [ ] **Step 4: onClick에 `boxView` 액션 추가**

`assets/app.js`의 `onClick` 함수에서 `tClass` 액션 처리 줄(Task 2 이후 기준) 바로 다음 줄에 추가:

```js
    else if (act === 'boxView') { state.boxView = t.getAttribute('data-view'); render(); }
```

- [ ] **Step 5: 문법 검증**

실행: `node --check assets/app.js && echo OK`
예상: `OK`

- [ ] **Step 6: 브라우저에서 토글 동작 확인 (웹 데모 모드)**

`npm run serve` 후 로그인, 교사 진단 탭 진입.
- 상자그림 카드에 토글 버튼이 **나타나지 않아야 함**(`classScoped() === false`이므로 `boxToggle`이 빈 문자열).
- 상자그림은 기존처럼 "과목별 산포"로 표시되어야 함(회귀 없음).
- 콘솔 에러 없어야 함.

Tauri 런타임이 준비되면(별도 진행 중) 추가로 확인:
- 반이 2개 이상인 학년에서 "반별"/"과목별" 버튼이 보이고, 클릭하면 상자그림·제목·힌트 텍스트가 즉시 전환되는지.
- "전체" 반 선택 상태에서 "과목별"로 전환해도 에러 없이(전체는 상자그림의 반 목록에 안 섞이므로) 동작하는지.

- [ ] **Step 7: 커밋**

```bash
git add assets/app.js
git commit -m "$(cat <<'EOF'
feat: add 반별/과목별 toggle to teacher diagnostics box plot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **스펙 커버리지:** 전체 반 통계(Task 2) — 커버. 상자그림 토글(Task 3) — 커버. `summaryStats` 포팅(Task 1) — 커버. Rust 무변경 — 어떤 태스크도 `src-tauri/` 건드리지 않음.
- **플레이스홀더 스캔:** 없음 — 모든 스텝에 실제 코드/명령 포함.
- **타입/시그니처 일관성:** `GK.summaryStats`/`GK.combineClassNodes`(Task 1에서 정의) 시그니처가 Task 2의 사용처와 일치. `state.tClass`가 숫자|`'all'` 두 타입을 가질 수 있다는 사실이 Task 2의 모든 관련 스텝(cohortNode/normalizeSelection/classBtns/onClick/groupLabel)에서 일관되게 처리됨. `state.boxView`(Task 3에서 정의)는 다른 태스크와 이름 충돌 없음.
