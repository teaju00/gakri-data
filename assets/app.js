/* 성적 분석 — 탭 분리 앱 (학생 자기점검 / 교사 진단).
 * 데이터 접근은 전부 GKAPI(assets/api.js) 경유. 웹 모드는 fetch, Tauri 모드는 Rust 커맨드.
 * 학생 탭: 자기 대비 진전 + 등급 뱃지 (전체 분포·서열 비노출).
 * 교사 탭: 인증 후 히스토그램·상자그림·5등급 분포 (진단용).
 *   - 웹 모드: 단일 데모 비밀번호, 학년 단위 집계.
 *   - Tauri 모드: 교사 계정 로그인, Rust 가 역할에 따라 반·과목 단위로 잘라서 내려줌. */
(function () {
  'use strict';

  var api = window.GKAPI;
  var caps = api.caps();

  var gradeColors = ['', 'var(--green-800)', 'var(--green-700)', 'var(--green-500)', 'var(--green-300)', 'var(--green-200)'];
  var gradeText   = ['', 'var(--white)', 'var(--white)', 'var(--white)', 'var(--text)', 'var(--text)'];

  var meta = null;
  var state = {
    tab: 'student',
    // provisioned: 관리자 계정이 있는가. 웹 모드는 계정 개념이 없어 항상 true.
    provisioned: !caps.accounts, needsImport: false, adminMsg: '',
    entered: false, user: '', pw: '', pwErr: '', session: null,
    code: '', codeErr: false, student: null, selSubject: null,
    cohort: null, tGrade: null, tClass: null, tSubject: null, _cohortLoading: false
  };
  var root;
  var chartRegistry = [];

  // ------- 스타일 조각 -------
  // ------- 스타일 조각 -------
  var CARD_PAD = 'padding:22px 26px;';
  var CHART = ''; // 차트 감싸는 컨테이너 여백(사용 안함)
  var BRANDBTN_PAD = 'padding:14px 18px;font-size:15px;';

  var fmt = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var subjMeta = function (id) { return meta.subjects.find(function (s) { return s.id === id; }); };
  var svg = function (id, sz) { return '<svg width="' + sz + '" height="' + sz + '" aria-hidden="true" focusable="false"><use href="' + id + '"></use></svg>'; };

  // ================================================================ 탭 바
  function tabbar() {
    var tab = function (key, icon, label) {
      var on = state.tab === key;
      var btnClass = on ? 'clay-tab-active' : 'clay-soft-btn';
      return '<button data-act="tab" data-tab="' + key + '" class="' + btnClass + '" aria-pressed="' + on + '" style="flex:1;padding:13px;display:flex;align-items:center;justify-content:center;gap:9px;">' + svg(icon, 20) + label + '</button>';
    };
    return '<nav class="clay-inset" aria-label="화면 전환" style="max-width:1080px;margin:0 auto 22px;display:flex;gap:12px;padding:8px;">' +
      tab('student', '#ic-student', '학생 조회') + tab('teacher', '#ic-teacher', '교사 진단') + '</nav>';
  }

  // ================================================================ 학생 탭
  function studentInput() {
    var shake = state.codeErr ? 'clayshake 0.42s ease' : 'none';
    var err = state.codeErr ? '<div id="codeErr" style="font-size:13px;color:var(--text-soft);font-weight:600;margin-top:-8px;">해당 코드의 학생을 찾을 수 없습니다.</div>' : '';
    
    var chips = (meta.exampleCodes || []).map(function (c) {
      return '<button data-act="example" data-code="' + esc(c) + '" class="clay-soft-btn" style="padding:9px 16px;font-size:14px;color:var(--brand);letter-spacing:0.08em;">' + esc(c) + '</button>';
    }).join('');

    return '<div style="display:flex;justify-content:center;padding:20px;">' +
      '<div class="clay-raised" style="width:100%;max-width:480px;display:flex;flex-direction:column;gap:22px;padding:40px;">' +
      '<div style="display:flex;align-items:center;gap:14px;"><div class="clay-icon" style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:18px;">' + svg('#ic-search', 28) + '</div>' +
      '<div><div style="font-size:21px;font-weight:800;letter-spacing:-0.02em;color:var(--heading);">학생 코드 조회</div>' +
      '<div style="font-size:13px;color:var(--text-soft);margin-top:3px;">본인 코드를 입력하면 내 성적 변화가 표시됩니다.</div></div></div>' +
      '<input id="code" class="clay-inset-field" value="' + esc(state.code) + '" placeholder="예: 3-K7Q" style="width:100%;border:none;padding:18px 22px;font-size:20px;font-family:inherit;color:var(--text-input);letter-spacing:0.14em;text-transform:uppercase;animation:' + shake + ';">' +
      err +
      '<button data-act="lookup" class="clay-brand-btn" style="padding:17px;font-size:16px;">' + svg('#ic-search', 20) + '조회하기</button>' +
      '<div style="border-top:1px solid rgba(3,98,66,0.1);padding-top:18px;"><div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:10px;">예시 코드 (눌러서 바로 조회)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + chips + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text-hint);line-height:1.5;">' + svg('#ic-shield', 16) + '<span>이름 · 석차 · 백분위 · 반/번호는 표시하지 않습니다.</span></div>' +
      '</div></div>';
  }

  function changeBadge(reach) {
    if (reach['중간'] == null || reach['기말'] == null) return '';
    var d = Math.round((reach['기말'] - reach['중간']) * 10) / 10;
    var up = d >= 0;
    var color = up ? 'var(--green-600)' : 'var(--green-400)'; // 하강도 경고색(빨강) 아님 — 중립 그린
    var icon = up ? '#ic-up' : '#ic-down';
    var txt = (up ? '+' : '') + d + '%p';
    return '<span class="clay-badge" style="display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:800;color:#fff;background:' + color + ';border-radius:9px;padding:3px 8px;">' + svg(icon, 13) + txt + '</span>';
  }

  // 등급별 설명 (백분율·수준 텍스트 표시 안 함 — 시각 바만)
  var GRADE_INFO = [
    '',
    { name: '1등급', seg: 1 },
    { name: '2등급', seg: 2 },
    { name: '3등급', seg: 3 },
    { name: '4등급', seg: 4 },
    { name: '5등급', seg: 5 }
  ];

  function gradeInfoModal(grade, sid) {
    var g = GRADE_INFO[grade];
    if (!g) return '';

    var nextDiffHtml = '';
    if (grade > 1 && sid && state.student && meta && meta.gradeCuts) {
      var cuts = meta.gradeCuts[state.student.grade] && meta.gradeCuts[state.student.grade][sid];
      var myTotal = state.student.subjects[sid] && state.student.subjects[sid].total;
      if (cuts && myTotal != null) {
        var nextCut = cuts[grade - 1];
        if (nextCut != null) {
          var diff = Math.round((nextCut - myTotal) * 10) / 10;
          if (diff > 0) {
            nextDiffHtml = '<div style="margin-top:4px;font-size:14px;color:var(--green-600);font-weight:700;">' + (grade - 1) + '등급 최소점까지 <span style="font-size:17px;color:var(--brand);">+' + diff.toFixed(1) + '점</span> 남았습니다.</div>';
          } else {
            nextDiffHtml = '<div style="margin-top:4px;font-size:14px;color:var(--green-600);font-weight:700;">다음 등급 최저점에 도달했습니다! (동점자 처리에 따라 변동 가능)</div>';
          }
        }
      }
    }

    // 5단계 시각 바 (색상 그래디언트, 현재 등급 위치에 마커)
    var bar = '<div style="display:flex;gap:3px;width:100%;height:18px;border-radius:9px;overflow:hidden;">';
    for (var i = 1; i <= 5; i++) {
      bar += '<div style="flex:1;background:' + gradeColors[i] + ';position:relative;">';
      if (i === grade) bar += '<div style="position:absolute;inset:-3px -2px;border:3px solid var(--text);border-radius:6px;"></div>';
      bar += '</div>';
    }
    bar += '</div>';
    return '<div class="grade-modal-overlay" data-act="closeModal">' +
      '<div class="grade-modal" data-act="none">' +
      '<div class="clay-icon" style="width:72px;height:72px;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:' + gradeText[grade] + ';background:' + gradeColors[grade] + ';">' + grade + '</div>' +
      '<div style="font-size:22px;font-weight:800;color:var(--text);">' + g.name + '</div>' +
      nextDiffHtml +
      bar +
      '<button data-act="closeModal" class="clay-brand-btn" style="padding:12px 28px;font-size:14px;margin-top:4px;">' + svg('#ic-back', 16) + '닫기</button>' +
      '</div></div>';
  }

  function studentDash() {
    var st = state.student, sel = state.selSubject;
    var order = meta.componentOrder;
    var avgG = Math.min(5, Math.max(1, Math.round(st.avg)));

    // 과목 카드
    var cards = meta.subjects.map(function (s) {
      var d = st.subjects[s.id]; if (!d) return '';
      var labels = order.filter(function (c) { return d.reach[c] != null; });
      var data = labels.map(function (c) { return d.reach[c]; });
      var ring = sel === s.id ? '2.5px solid var(--brand)' : '2.5px solid transparent';
      var chips = order.filter(function (c) { return d.comps[c]; }).map(function (c) {
        return '<div class="clay-badge" style="font-size:11.5px;color:var(--text-soft);background:var(--green-100);border-radius:9px;padding:4px 9px;"><span style="font-weight:700;">' + c + '</span> ' + d.comps[c].score + ' <span style="opacity:0.6;">·' + d.comps[c].weight + '%</span></div>';
      }).join('');
      
      return '<div data-act="selectS" data-sid="' + s.id + '" class="clay-raised card-hover" style="cursor:pointer;padding:20px;display:flex;flex-direction:column;gap:12px;outline:' + ring + ';outline-offset:-2px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;gap:11px;"><div class="clay-icon" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;">' + svg(s.icon, 24) + '</div><span style="font-size:17px;font-weight:800;color:var(--heading);">' + s.name + '</span></div>' +
        '<div data-act="gradeInfo" data-sid="' + s.id + '" data-grade="' + d.grade + '" class="clay-badge" style="cursor:pointer;width:42px;height:42px;flex:none;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:' + gradeText[d.grade] + ';background:' + gradeColors[d.grade] + ';">' + d.grade + '</div></div>' +
        '<div style="display:flex;align-items:baseline;gap:6px;"><span style="font-size:30px;font-weight:800;color:var(--brand);line-height:1;">' + fmt(d.total) + '</span><span style="font-size:13px;color:var(--text-muted);font-weight:600;">점 / 100</span>' + (changeBadge(d.reach) ? '<span style="margin-left:auto;">' + changeBadge(d.reach) + '</span>' : '') + '</div>' +
        '<div style="padding:6px 2px;">' + GK.miniProgress(labels, data) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid rgba(3,98,66,0.09);padding-top:10px;">' + chips + '</div></div>';
    }).join('');

    // 등급표
    var rows = meta.subjects.map(function (s) {
      var d = st.subjects[s.id]; if (!d) return '';
      var compsStr = order.filter(function (c) { return d.comps[c]; }).map(function (c) { return c + ' ' + d.comps[c].weight + '%'; }).join(' · ');
      return '<div class="clay-table-row" style="display:grid;grid-template-columns:1.4fr 1fr 0.8fr 2.2fr;gap:12px;align-items:center;padding:11px 14px;">' +
        '<span style="font-size:14.5px;font-weight:700;color:var(--heading);">' + s.name + '</span><span style="font-size:14px;font-weight:700;color:var(--brand);">' + fmt(d.total) + '</span>' +
        '<span><span data-act="gradeInfo" data-sid="' + s.id + '" data-grade="' + d.grade + '" class="clay-badge" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9px;font-size:14px;font-weight:800;color:' + gradeText[d.grade] + ';background:' + gradeColors[d.grade] + ';">' + d.grade + '</span></span>' +
        '<span style="font-size:12.5px;color:var(--text-soft);">' + compsStr + '</span></div>';
    }).join('');

    return '<div style="max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:22px;">' +
      // header
      '<div class="clay-raised" style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;">' +
      '<div style="display:flex;align-items:center;gap:16px;"><button data-act="back" title="코드 조회로" class="clay-soft-btn" style="width:46px;height:46px;padding:0;display:flex;align-items:center;justify-content:center;">' + svg('#ic-back', 22) + '</button>' +
      '<div><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:12px;font-weight:700;letter-spacing:0.16em;color:var(--text-muted);">CODE</span><span style="font-size:24px;font-weight:800;letter-spacing:0.04em;color:var(--heading);">' + esc(st.code) + '</span><span style="font-size:14px;font-weight:700;color:var(--brand);background:var(--chip-bg-brand);border-radius:9px;padding:4px 11px;" class="clay-badge">' + st.grade + '학년</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">내 학습 점검 · 다른 학생과 비교하지 않습니다</div></div></div>' +
      '<div style="text-align:right;"><div style="font-size:12px;color:var(--text-muted);font-weight:600;">평균 등급</div><div style="display:flex;align-items:baseline;gap:5px;justify-content:flex-end;"><span style="font-size:30px;font-weight:800;color:' + gradeColors[avgG] + ';">' + fmt(st.avg) + '</span><span style="font-size:13px;color:var(--text-muted);font-weight:600;">등급</span></div></div>' +
      '</div>' +
      // big progress
      progressCard() +
      // subject cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px;">' + cards + '</div>' +
      // table
      '<div class="clay-raised" style="' + CARD_PAD + '"><div style="font-size:16px;font-weight:800;color:var(--heading);margin-bottom:14px;">과목별 등급표</div><div style="display:flex;flex-direction:column;gap:8px;">' +
      '<div style="display:grid;grid-template-columns:1.4fr 1fr 0.8fr 2.2fr;gap:12px;padding:0 14px 8px;font-size:12px;font-weight:700;color:var(--text-muted);border-bottom:1px solid rgba(3,98,66,0.1);"><span>과목</span><span>총점</span><span>등급</span><span>반영 요소</span></div>' + rows + '</div></div>' +
      '</div>';
  }

  function progressCard() {
    var st = state.student, s = subjMeta(state.selSubject), d = st.subjects[state.selSubject];
    var order = meta.componentOrder.filter(function (c) { return d.reach[c] != null; });
    var multi = order.length > 1;
    var slopeData = order.map(function (c) { return d.reach[c]; });

    var body = multi
      ? '<div style="max-width:600px;margin:0 auto;padding:16px;">' + GK.slopeChart(order, slopeData) + '</div>'
      : '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:34px;"><span style="font-size:46px;font-weight:800;color:var(--brand);">' + d.reach[order[0]] + '%</span><span style="font-size:13px;color:var(--text-muted);">이 과목은 ' + order[0] + '평가만 반영합니다</span></div>';
    return '<div class="clay-raised" style="' + CARD_PAD + '">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;color:var(--brand);">' + svg('#ic-trend', 22) + '<span style="font-size:17px;font-weight:800;color:var(--heading);">' + s.name + ' · 자기 대비 진전</span>' + (changeBadge(d.reach) ? '<span style="margin-left:6px;">' + changeBadge(d.reach) + '</span>' : '') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">평가 시점별 도달률(내 점수 ÷ 만점). 과목 카드를 눌러 전환.</div>' + body + '</div>';
  }

  // ================================================================ 교사 탭
  function entryGate() {
    var shake = state.pwErr ? 'clayshake 0.42s ease' : 'none';
    var err = state.pwErr ? '<div id="pwErr" style="font-size:13px;color:var(--text-soft);font-weight:600;margin-top:-12px;">' + esc(state.pwErr) + '</div>' : '';

    var subtitle = caps.accounts
      ? '교내 열람용 도구입니다.<br>배정된 교사 계정으로 로그인해 주세요.'
      : '교내 열람용 도구입니다.<br>비밀번호를 입력해 주세요.';
    var hint = api.demoPassword
      ? '<div style="font-size:12px;color:var(--text-hint);">데모 비밀번호: ' + esc(api.demoPassword) + '</div>'
      : '<div style="font-size:12px;color:var(--text-hint);">담임은 자기 반, 교과교사는 담당 반·과목만 조회됩니다.</div>';

    return '<div style="display:flex;justify-content:center;padding:40px 20px;">' +
      '<div class="clay-raised" style="width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;gap:24px;padding:48px 40px;">' +
      '<div class="clay-icon" style="width:88px;height:88px;display:flex;align-items:center;justify-content:center;border-radius:26px;">' + svg('#ic-lock', 40) + '</div>' +
      '<div style="text-align:center;"><div style="font-size:23px;font-weight:800;color:var(--heading);">성적 분석 · 접속 인증</div><div style="margin-top:8px;font-size:14px;color:var(--text-soft);line-height:1.5;">' + subtitle + '</div></div>' +
      '<input id="pw" type="password" class="clay-inset-field" value="' + esc(state.pw) + '" placeholder="비밀번호" style="width:100%;border:none;padding:16px 20px;font-size:17px;font-family:inherit;color:var(--text-input);text-align:center;letter-spacing:0.15em;animation:' + shake + ';">' +
      err +
      '<button data-act="enter" class="clay-brand-btn" style="width:100%;padding:16px;font-size:16px;">입장</button>' +
      hint +
      '</div></div>';
  }

  // 세션이 볼 수 있는 집계 단위를 고른다.
  //  - Tauri 모드: cohort.classes[학년][반]  (Rust 가 이미 역할대로 잘라서 내려줌)
  //  - 웹 모드   : cohort.grades[학년]
  function classScoped() { return caps.classScope && !!state.cohort.classes; }
  function scopeRoot() { return classScoped() ? state.cohort.classes : state.cohort.grades; }
  function numKeys(o) { return Object.keys(o || {}).map(Number).sort(function (a, b) { return a - b; }); }
  function allowedGrades() { return numKeys(scopeRoot()); }
  function allowedClasses(g) { return classScoped() ? numKeys(state.cohort.classes[g]) : []; }
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

  // 선택 상태가 허용 범위를 벗어나면(로그인 직후, 학년 전환 등) 첫 유효값으로 되돌린다.
  function normalizeSelection() {
    var gs = allowedGrades();
    if (gs.indexOf(state.tGrade) < 0) state.tGrade = gs[0];
    if (classScoped()) {
      var cs = allowedClasses(state.tGrade);
      var classValid = state.tClass === 'all' ? cs.length > 1 : cs.indexOf(state.tClass) >= 0;
      if (!classValid) state.tClass = cs[0];
    }
    var node = cohortNode();
    if (!node) return false;
    if (!node.subjects[state.tSubject]) state.tSubject = Object.keys(node.subjects)[0];
    return !!state.tSubject;
  }

  function scopeBanner() {
    var s = state.session;
    if (!s || !caps.accounts) return '진단용 화면 — 다음 수업 결정에 활용, 학생에게 직접 보여주지 않습니다';
    var who = s.role === 'homeroom' ? '담임' : s.role === 'subject' ? '교과' : '관리자';
    return esc(s.displayName) + ' · ' + who + ' — 허용된 반·과목만 표시됩니다';
  }

  function teacherDash() {
    if (!normalizeSelection()) {
      return '<div style="max-width:1080px;margin:0 auto;"><div class="clay-raised" style="' + CARD_PAD + 'text-align:center;color:var(--text-soft);">조회 가능한 데이터가 없습니다. 관리자에게 담당 반·과목 배정을 요청하세요.</div></div>';
    }

    var g = state.tGrade, sid = state.tSubject;
    var node = cohortNode();
    var gsub = node.subjects[sid];
    var stats = gsub.stats;

    var gradeBtns = allowedGrades().map(function (gg) {
      var btnCls = (gg === g) ? 'clay-tab-active' : 'clay-soft-btn';
      return '<button data-act="gGrade" data-grade="' + gg + '" class="' + btnCls + '" style="padding:9px 16px;font-size:14px;">' + gg + '학년</button>';
    }).join('');

    var classes = allowedClasses(g);
    var classBtns = classes.map(function (cc) {
      var btnCls = (cc === state.tClass) ? 'clay-tab-active' : 'clay-soft-btn';
      return '<button data-act="tClass" data-class="' + cc + '" class="' + btnCls + '" style="padding:9px 16px;font-size:14px;">' + cc + '반</button>';
    }).join('') + (classes.length > 1
      ? '<button data-act="tClass" data-class="all" class="' + (state.tClass === 'all' ? 'clay-tab-active' : 'clay-soft-btn') + '" style="padding:9px 16px;font-size:14px;">전체</button>'
      : '');
    var classRow = classBtns
      ? '<div style="width:1px;height:24px;background:rgba(3,98,66,0.12);"></div><div style="display:flex;gap:8px;">' + classBtns + '</div>'
      : '';

    var visibleSubjects = meta.subjects.filter(function (s) { return !!node.subjects[s.id]; });
    var subjBtns = visibleSubjects.map(function (s) {
      var btnCls = (s.id === sid) ? 'clay-tab-active' : 'clay-soft-btn';
      return '<button data-act="tSubject" data-sid="' + s.id + '" class="' + btnCls + '" style="padding:8px 14px;font-size:13px;display:flex;align-items:center;gap:6px;">' + svg(s.icon, 16) + s.name + '</button>';
    }).join('');
    var statTile = function (label, val) { return '<div class="clay-inset" style="flex:1;text-align:center;padding:14px 10px;border-radius:16px;"><div style="font-size:22px;font-weight:800;color:var(--brand);">' + val + '</div><div style="font-size:11.5px;color:var(--text-soft);font-weight:600;margin-top:2px;">' + label + '</div></div>'; };
    var groupLabel = classScoped() ? (g + '학년 ' + (state.tClass === 'all' ? '전체' : state.tClass + '반')) : (g + '학년');

    // 상자그림: 반 단위 데이터가 있으면(Tauri) 상단 반 선택기와 비교 축을 하나로 묶는다 —
    // "전체" 선택 시 반별 비교(다른 반과), 특정 반 선택 시 과목별 비교(그 반 안에서).
    // 예전엔 별도 토글(반별/과목별)이 있었는데 상단 반 선택기와 같은 축을 건드려 헷갈렸고,
    // 토글 전환마다 레이아웃이 바뀌어 상자그림 크기가 널뛰는 문제도 있어 상단 선택기로 흡수했다.
    // 반이 하나뿐이면(담임) "전체" 탭 자체가 없어 늘 과목별.
    var boxByClass = classScoped() && classes.length > 1 && state.tClass === 'all';
    var boxItems = boxByClass
      ? classes.reduce(function (acc, cc) {
          var byC = state.cohort.classes[g] && state.cohort.classes[g][cc];
          var d = byC && byC.subjects[sid];
          if (d) acc.push({ name: cc + '반', totals: d.totals, stats: d.stats, active: cc === state.tClass });
          return acc;
        }, [])
      : visibleSubjects.map(function (s) { var d = node.subjects[s.id]; return { name: s.name, totals: d.totals, stats: d.stats }; });
    var boxTitle = boxByClass ? (esc(gsub.name) + ' 반별 산포') : '과목별 산포';
    var boxHint = boxByClass
      ? '반마다 산포 크거나 이상치 많으면 이질 학급 → 소집단·차별화.'
      : '산포 크거나 이상치 많으면 이질 학급 → 소집단·차별화.';

    // 카드 두 개(5등급 분포·상자그림)는 반별/과목별 모드 둘 다 그대로 쓰고, 감싸는 레이아웃만 다르다
    // (반별은 박스가 많을 수 있어 전체 폭, 과목별은 기존 2열). 레이아웃은 "상단에 반 선택기가
    // 여러 개 있는가"로만 갈라 — 전체/특정반 전환에 따라 흔들리지 않고 고정된다.
    var gradeDistCard = '<div class="clay-raised" style="' + CARD_PAD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;color:var(--brand);">' + svg('#ic-radar', 20) + '<span style="font-size:16px;font-weight:800;color:var(--heading);">5등급 분포</span></div>' +
      '<div style="position:relative;height:230px;padding:16px;' + CHART + '"><canvas id="gradeCanvas"></canvas></div></div>';
    var boxPlotCard = '<div class="clay-raised" style="' + CARD_PAD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;color:var(--brand);">' + svg('#ic-box', 20) + '<span style="font-size:16px;font-weight:800;color:var(--heading);">' + boxTitle + ' (상자그림)</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">' + boxHint + '</div>' +
      '<div style="padding:14px;' + CHART + '">' + GK.boxPlotSVG(boxItems) + '</div></div>';
    var distSection = (classScoped() && classes.length > 1)
      ? gradeDistCard + boxPlotCard
      : '<div style="display:grid;grid-template-columns:1fr 1.3fr;gap:22px;" class="teacher-grid">' + gradeDistCard + boxPlotCard + '</div>';

    return '<div style="max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:22px;">' +
      // banner + controls
      '<div class="clay-raised" style="' + CARD_PAD + 'display:flex;flex-direction:column;gap:16px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
      '<div style="display:flex;align-items:center;gap:10px;color:var(--brand);">' + svg('#ic-shield', 20) + '<span style="font-size:14px;font-weight:700;color:var(--heading);">' + scopeBanner() + '</span></div>' +
      '<button data-act="lock" class="clay-soft-btn" style="padding:10px 15px;display:flex;align-items:center;gap:6px;font-size:13.5px;">' + svg('#ic-logout', 18) + '잠금</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;">' +
      '<div style="display:flex;gap:8px;">' + gradeBtns + '</div>' +
      classRow +
      '<div style="width:1px;height:24px;background:rgba(3,98,66,0.12);"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + subjBtns + '</div></div>' +
      '<div style="display:flex;gap:12px;">' + statTile('학생 수', node.count + '명') + statTile('평균', fmt(stats.mean)) + statTile('표준편차', fmt(stats.sd)) + statTile('중앙값', fmt(stats.median)) + '</div>' +
      '</div>' +
      // histogram
      '<div class="clay-raised" style="' + CARD_PAD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;color:var(--brand);">' + svg('#ic-bars', 22) + '<span style="font-size:17px;font-weight:800;color:var(--heading);">' + esc(gsub.name) + ' ' + groupLabel + ' 점수 분포</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">봉우리가 둘로 갈리면(이봉) 전체수업보다 두 트랙 차별화를 고려.</div>' +
      '<div style="position:relative;height:250px;padding:16px;' + CHART + '"><canvas id="histCanvas"></canvas></div></div>' +
      // grade dist + box — 반별 비교는 박스 개수가 많을 수 있어 전체 폭으로, 과목별 비교(웹 모드)는 기존 2열 유지.
      distSection +
      '</div>';
  }

  // ================================================================ 관리자 화면 (Tauri 전용)
  // 웹 모드에는 계정도 임포트도 없다. caps.accounts 로만 나타난다.

  function panel(icon, title, subtitle, body) {
    return '<div style="display:flex;justify-content:center;padding:40px 20px;">' +
      '<div class="clay-raised" style="width:100%;max-width:480px;display:flex;flex-direction:column;gap:20px;padding:40px;">' +
      '<div style="display:flex;align-items:center;gap:14px;"><div class="clay-icon" style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:18px;">' + svg(icon, 28) + '</div>' +
      '<div><div style="font-size:21px;font-weight:800;color:var(--heading);">' + title + '</div>' +
      '<div style="font-size:13px;color:var(--text-soft);margin-top:3px;line-height:1.5;">' + subtitle + '</div></div></div>' +
      body + '</div></div>';
  }

  function field(id, placeholder, type) {
    return '<input id="' + id + '" ' + (type ? 'type="' + type + '" ' : '') + 'class="clay-inset-field" placeholder="' + placeholder + '" style="width:100%;border:none;padding:15px 18px;font-size:15px;font-family:inherit;color:var(--text-input);">';
  }

  function adminMsg() {
    if (!state.adminMsg) return '';
    return '<div style="font-size:13px;color:var(--text-soft);font-weight:600;">' + esc(state.adminMsg) + '</div>';
  }

  /// 최초 실행. 관리자 계정을 만들면서 vault 를 여는 키가 생성된다.
  function setupScreen() {
    return '<main style="min-height:100vh;min-height:100dvh;padding:26px 20px 64px;">' + panel('#ic-shield', '최초 설정',
      '이 컴퓨터에서 처음 실행합니다.<br>관리자 계정을 만들어 주세요.',
      field('suUser', '관리자 아이디') +
      field('suPw', '비밀번호 (8자 이상)', 'password') +
      field('suPw2', '비밀번호 확인', 'password') +
      adminMsg() +
      '<button data-act="provision" class="clay-brand-btn" style="padding:16px;font-size:16px;">계정 만들기</button>' +
      '<div style="display:flex;align-items:flex-start;gap:8px;font-size:11.5px;color:var(--text-hint);line-height:1.6;">' + svg('#ic-lock', 16) +
      '<span>이 비밀번호로 성적 데이터가 암호화됩니다. <b>모든 계정의 비밀번호를 잃으면 복구할 수 없습니다.</b></span></div>'
    ) + '</main>';
  }

  /// 계정은 있으나 성적을 아직 넣지 않은 상태.
  function importScreen() {
    if (!state.session || state.session.role !== 'admin') {
      return '<main style="min-height:100vh;min-height:100dvh;padding:26px 20px 64px;">' + panel('#ic-shield', '데이터 없음',
        '성적이 아직 등록되지 않았습니다.<br>관리자에게 임포트를 요청하세요.',
        '<button data-act="lock" class="clay-soft-btn" style="padding:14px;font-size:15px;">로그아웃</button>') + '</main>';
    }
    return '<main style="min-height:100vh;min-height:100dvh;padding:26px 20px 64px;">' + panel('#ic-bars', '성적 임포트',
      '과목별 파일(<code>&lt;과목&gt;.xlsx</code> 또는 <code>.csv</code>)이<br>들어 있는 폴더 경로를 입력하세요.',
      field('impDir', 'C:\\성적\\2026-1학기\\data') +
      adminMsg() +
      '<button data-act="import" class="clay-brand-btn" style="padding:16px;font-size:16px;">불러오기</button>' +
      '<button data-act="lock" class="clay-soft-btn" style="padding:12px;font-size:14px;">로그아웃</button>'
    ) + '</main>';
  }

  // ================================================================ 렌더 + 차트 마운트
  function destroyCharts() { chartRegistry.forEach(function (c) { if (c) c.destroy(); }); chartRegistry = []; }

  function render() {
    destroyCharts();
    // Tauri 모드는 계정 생성 → 로그인 → (필요하면) 임포트 순으로 관문이 하나 더 있다.
    if (!state.provisioned) { root.innerHTML = setupScreen(); return; }
    if (!state.entered) {
      // 웹 모드는 메타가 도착한 뒤에 게이트를 그린다. 먼저 그리면 메타 도착 시 다시 그려지면서
      // 입력 중이던 비밀번호가 지워진다. (Tauri 는 로그인 전에 메타를 못 읽으므로 해당 없음.)
      if (!meta && !caps.accounts) { root.innerHTML = '<div role="status" aria-live="polite" style="padding:60px;text-align:center;color:var(--text-soft);">데이터 로딩 중…</div>'; return; }
      root.innerHTML = '<main style="min-height:100vh;min-height:100dvh;padding:26px 20px 64px;">' + entryGate() + '</main>';
      return;
    }
    if (!meta) {
      if (state.needsImport) { root.innerHTML = importScreen(); return; }
      root.innerHTML = '<div role="status" aria-live="polite" style="padding:60px;text-align:center;color:var(--text-soft);">데이터 로딩 중…</div>';
      return;
    }
    var body;
    if (state.tab === 'student') body = state.student ? studentDash() : studentInput();
    else body = teacherBody();
    root.innerHTML = '<main style="min-height:100vh;min-height:100dvh;padding:26px 20px 64px;">' + tabbar() + body + '</main>';
    mountCharts();
  }

  function teacherBody() {
    if (!state.cohort) { ensureCohort(); return '<div style="max-width:1080px;margin:0 auto;"><div class="clay-raised" style="' + CARD_PAD + 'text-align:center;color:var(--text-soft);">진단 데이터 로딩 중…</div></div>'; }
    return teacherDash();
  }

  function mountCharts() {
    if (state.tab === 'teacher' && state.cohort) {
      var node = cohortNode();
      if (!node) return;
      var sub = node.subjects[state.tSubject];
      if (!sub) return;
      chartRegistry.push(GK.histogram(document.getElementById('histCanvas'), sub.totals));
      chartRegistry.push(GK.gradeDist(document.getElementById('gradeCanvas'), sub.gradeCounts, gradeColors));
    }
  }

  // ================================================================ 액션
  function lookup(codeRaw) {
    var code = String(codeRaw == null ? '' : codeRaw).trim().toUpperCase();
    if (!code) return;
    api.studentLookup(code)
      .then(function (d) { state.student = d; state.selSubject = meta.subjects[0].id; state.code = code; state.codeErr = false; render(); })
      .catch(function () { state.code = code; state.codeErr = true; render(); focusEl('code'); });
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  // Rust 커맨드는 안정적인 코드 문자열로 거절한다 (error.rs 참고).
  function errText(e) {
    var s = (e && e.message) ? e.message : String(e);
    if (s.indexOf('BAD_CREDENTIALS') >= 0) return '비밀번호가 올바르지 않습니다.';
    if (s.indexOf('FORBIDDEN') >= 0) return '권한이 없습니다.';
    if (s.indexOf('ALREADY_PROVISIONED') >= 0) return '이미 설정이 끝난 상태입니다.';
    if (s.indexOf('NOT_PROVISIONED') >= 0) return '아직 데이터가 없습니다.';
    return s.replace(/^[A-Z_]+:\s*/, '');
  }

  function loadMeta() {
    return api.meta().then(function (d) { meta = d; state.needsImport = false; render(); });
  }

  function doEnter() {
    var el = document.getElementById('pw'); state.pw = el ? el.value : state.pw;
    api.login(state.pw)
      .then(function (s) {
        state.session = s; state.entered = true; state.pwErr = ''; state.pw = ''; state.adminMsg = '';
        state.cohort = null; state.tGrade = null; state.tClass = null; state.tSubject = null;
        // Tauri 모드는 로그인 뒤에야 메타를 읽는다. 없으면 아직 임포트 전.
        if (caps.accounts && !meta) {
          loadMeta().catch(function () { state.needsImport = true; render(); });
        }
        render();
      })
      .catch(function () {
        state.pwErr = '비밀번호가 올바르지 않습니다.';
        render(); focusEl('pw');
      });
  }

  function doLock() {
    api.logout().catch(function () {});
    state.entered = false; state.session = null; state.pw = ''; state.user = ''; state.adminMsg = '';
    state.student = null; state.code = '';
    state.cohort = null; state.tGrade = null; state.tClass = null; state.tSubject = null;
    render();
  }

  // ------- 관리자 동작 (Tauri 전용) -------

  function doProvision() {
    var u = val('suUser'), p = val('suPw'), p2 = val('suPw2');
    if (p !== p2) { state.adminMsg = '비밀번호가 서로 다릅니다.'; render(); return; }
    api.provision(u, p)
      .then(function () { state.provisioned = true; state.adminMsg = ''; state.user = u; render(); focusEl('pw'); })
      .catch(function (e) { state.adminMsg = errText(e); render(); });
  }

  function doImport() {
    var dir = val('impDir');
    if (!dir) { state.adminMsg = '폴더 경로를 입력하세요.'; render(); return; }
    state.adminMsg = '불러오는 중…'; render();
    api.importGrades(dir)
      .then(function () { state.adminMsg = ''; return loadMeta(); })
      .catch(function (e) { state.adminMsg = errText(e); render(); });
  }

  // 교사 탭 첫 진입 시 코호트 데이터 지연 로드.
  // Tauri 모드에서는 이 응답이 이미 역할대로 필터링되어 있다 (Rust 가 거름).
  function ensureCohort() {
    if (state.cohort || state._cohortLoading) return;
    state._cohortLoading = true;
    api.cohort().then(function (d) {
      state.cohort = d; state._cohortLoading = false; render();
    }).catch(function () { state._cohortLoading = false; });
  }

  function focusEl(id) { setTimeout(function () { var el = document.getElementById(id); if (el) el.focus(); }, 30); }

  // ================================================================ 이벤트 (위임, 최초 1회 바인딩)
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-act]'); if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'tab') { state.tab = t.getAttribute('data-tab'); render(); }
    else if (act === 'lookup') { var c = document.getElementById('code'); lookup(c ? c.value : ''); }
    else if (act === 'example') { lookup(t.getAttribute('data-code')); }
    else if (act === 'back') { state.student = null; state.code = ''; state.codeErr = false; render(); }
    else if (act === 'selectS') { state.selSubject = t.getAttribute('data-sid'); render(); }
    else if (act === 'gradeInfo') { var gi = +t.getAttribute('data-grade'); var sid = t.getAttribute('data-sid'); if (gi >= 1 && gi <= 5) { var modal = document.createElement('div'); modal.innerHTML = gradeInfoModal(gi, sid); root.appendChild(modal.firstChild); } }
    else if (act === 'closeModal') { var ov = document.querySelector('.grade-modal-overlay'); if (ov) ov.remove(); }
    else if (act === 'enter') { doEnter(); }
    else if (act === 'lock') { doLock(); }
    else if (act === 'provision') { doProvision(); }
    else if (act === 'import') { doImport(); }
    else if (act === 'gGrade') { state.tGrade = +t.getAttribute('data-grade'); state.tClass = null; render(); }
    else if (act === 'tClass') { var cv = t.getAttribute('data-class'); state.tClass = cv === 'all' ? 'all' : +cv; render(); }
    else if (act === 'tSubject') { state.tSubject = t.getAttribute('data-sid'); render(); }
  }
  function onKeydown(e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') lookup(e.target.value);
    else if (e.target.id === 'pw') doEnter();
    else if (e.target.id === 'suPw2') doProvision();
    else if (e.target.id === 'impDir') doImport();
  }
  function onInput(e) {
    if (e.target.id === 'code' && state.codeErr) { state.codeErr = false; strip('codeErr', 'code'); }
    if (e.target.id === 'pw' && state.pwErr) { state.pwErr = ''; strip('pwErr', 'pw'); }
  }
  function strip(errId, inputId) { var er = document.getElementById(errId); if (er) er.remove(); var inp = document.getElementById(inputId); if (inp) inp.style.animation = 'none'; }

  // ================================================================ 시작
  function start() {
    root = document.getElementById('root');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('input', onInput);

    if (caps.accounts) {
      // Tauri: 관리자 계정 유무를 먼저 묻는다. 메타는 로그인 뒤에 읽는다.
      render();
      api.isProvisioned()
        .then(function (p) { state.provisioned = p; render(); })
        .catch(function () { state.provisioned = false; render(); });
      return;
    }

    // 웹: 예전 그대로. 메타는 정적 파일이라 바로 읽는다.
    render();
    loadMeta().catch(function () {
      root.innerHTML = '<div role="alert" style="padding:60px;text-align:center;color:var(--danger);">메타 로드 실패 — 빌드 필요: <code>npm run gen-sample &amp;&amp; npm run build</code></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
