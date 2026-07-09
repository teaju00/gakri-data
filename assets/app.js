/* 성적 분석 — 탭 분리 앱 (학생 자기점검 / 교사 진단).
 * 데이터는 빌드 산출물(public/data/*)에서 fetch. 차트는 assets/charts.js(GK).
 * 학생 탭: 자기 대비 진전 + 등급 뱃지 (전체 분포·서열 비노출).
 * 교사 탭: 비밀번호 후 히스토그램·상자그림·5등급 분포 (진단용). */
(function () {
  'use strict';

  var DEMO_PW = '1234';
  var gradeColors = ['', '#036242', '#0A7A54', '#3FA37E', '#A9D9C4', '#D6EFE4'];
  var gradeText   = ['', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#0B2F23', '#0B2F23'];

  var meta = null;
  var state = {
    tab: 'student',
    code: '', codeErr: false, student: null, selSubject: null,
    tpw: '', tpwErr: false, unlocked: false, cohort: null, tGrade: null, tSubject: null
  };
  var root;
  var chartRegistry = [];

  // ------- 스타일 조각 -------
  var CARD = 'background:#EAF4EF;border-radius:28px;padding:22px 26px;box-shadow:16px 16px 32px rgba(3,98,66,0.13),-10px -10px 24px rgba(255,255,255,0.9),inset 0 10px 18px rgba(255,255,255,0.5),inset 0 -8px 14px rgba(3,98,66,0.05);';
  var INSET = 'border-radius:22px;background:#EAF4EF;box-shadow:inset 7px 7px 15px rgba(3,60,42,0.13),inset -7px -7px 15px rgba(255,255,255,0.92);';
  var ICONBOX = 'width:44px;height:44px;flex:none;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#036242;background:#E6F1EC;box-shadow:5px 5px 10px rgba(3,98,66,0.12),-4px -4px 9px rgba(255,255,255,0.95),inset 2px 2px 5px rgba(255,255,255,0.7);';
  var BRANDBTN = 'border:none;border-radius:16px;padding:14px 18px;font-size:15px;font-weight:700;font-family:inherit;color:#fff;background:#036242;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:8px 8px 16px rgba(3,98,66,0.3),-4px -4px 10px rgba(255,255,255,0.5),inset 2px 2px 6px rgba(90,180,140,0.4),inset -3px -3px 8px rgba(1,50,33,0.5);';
  var SOFTBTN = 'border:none;border-radius:14px;padding:10px 15px;font-size:13.5px;font-weight:700;font-family:inherit;color:#4E7D68;background:#E6F1EC;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:6px 6px 12px rgba(3,98,66,0.13),-5px -5px 10px rgba(255,255,255,0.95),inset 2px 2px 5px rgba(255,255,255,0.7);';

  var fmt = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var subjMeta = function (id) { return meta.subjects.find(function (s) { return s.id === id; }); };
  var svg = function (id, sz) { return '<svg width="' + sz + '" height="' + sz + '"><use href="' + id + '"></use></svg>'; };

  // ================================================================ 탭 바
  function tabbar() {
    var tab = function (key, icon, label) {
      var on = state.tab === key;
      return '<button data-act="tab" data-tab="' + key + '" class="btn-soft" style="flex:1;border:none;border-radius:16px;padding:13px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;' +
        (on
          ? 'color:#fff;background:#036242;box-shadow:6px 6px 14px rgba(3,98,66,0.28),inset 2px 2px 6px rgba(90,180,140,0.4),inset -3px -3px 8px rgba(1,50,33,0.5);'
          : 'color:#4E7D68;background:#E6F1EC;box-shadow:inset 4px 4px 9px rgba(3,98,66,0.1),inset -4px -4px 9px rgba(255,255,255,0.9);') +
        '">' + svg(icon, 20) + label + '</button>';
    };
    return '<div style="max-width:1080px;margin:0 auto 22px;display:flex;gap:12px;padding:8px;border-radius:22px;' + INSET + '">' +
      tab('student', '#ic-student', '학생 조회') + tab('teacher', '#ic-teacher', '교사 진단') + '</div>';
  }

  // ================================================================ 학생 탭
  function studentInput() {
    var shake = state.codeErr ? 'clayshake 0.42s ease' : 'none';
    var err = state.codeErr ? '<div id="codeErr" style="font-size:13px;color:#3C5C4F;font-weight:600;margin-top:-8px;">해당 코드의 학생을 찾을 수 없습니다.</div>' : '';
    var chips = (meta.exampleCodes || []).map(function (c) {
      return '<button data-act="example" data-code="' + esc(c) + '" class="btn-soft" style="border:none;border-radius:13px;padding:9px 16px;font-size:14px;font-weight:700;font-family:inherit;letter-spacing:0.08em;color:#036242;background:#E6F1EC;cursor:pointer;box-shadow:5px 5px 11px rgba(3,98,66,0.13),-4px -4px 9px rgba(255,255,255,0.95),inset 2px 2px 5px rgba(255,255,255,0.7);">' + esc(c) + '</button>';
    }).join('');
    return '<div style="display:flex;justify-content:center;padding:20px;">' +
      '<div style="width:100%;max-width:480px;display:flex;flex-direction:column;gap:22px;' + CARD + 'border-radius:34px;padding:40px;">' +
      '<div style="display:flex;align-items:center;gap:14px;"><div style="' + ICONBOX + 'width:56px;height:56px;border-radius:18px;">' + svg('#ic-search', 28) + '</div>' +
      '<div><div style="font-size:21px;font-weight:800;letter-spacing:-0.02em;color:#0A3D2A;">학생 코드 조회</div>' +
      '<div style="font-size:13px;color:#4E7D68;margin-top:3px;">본인 코드를 입력하면 내 성적 변화가 표시됩니다.</div></div></div>' +
      '<input id="code" value="' + esc(state.code) + '" placeholder="예: 3-K7Q" style="width:100%;border:none;border-radius:18px;padding:18px 22px;font-size:20px;font-family:inherit;color:#0C4A34;background:#E6F1EC;letter-spacing:0.14em;text-transform:uppercase;box-shadow:inset 6px 6px 12px rgba(3,98,66,0.14),inset -6px -6px 12px rgba(255,255,255,0.95);animation:' + shake + ';">' +
      err +
      '<button data-act="lookup" class="btn-primary" style="' + BRANDBTN + 'padding:17px;font-size:16px;">' + svg('#ic-search', 20) + '조회하기</button>' +
      '<div style="border-top:1px solid rgba(3,98,66,0.1);padding-top:18px;"><div style="font-size:12px;color:#7FA895;font-weight:600;margin-bottom:10px;">예시 코드 (눌러서 바로 조회)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + chips + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#8AAE9E;line-height:1.5;">' + svg('#ic-shield', 16) + '<span>이름 · 석차 · 백분위 · 반/번호는 표시하지 않습니다.</span></div>' +
      '</div></div>';
  }

  function changeBadge(reach) {
    if (reach['중간'] == null || reach['기말'] == null) return '';
    var d = Math.round((reach['기말'] - reach['중간']) * 10) / 10;
    var up = d >= 0;
    var color = up ? '#12936A' : '#6FBE9E'; // 하강도 경고색(빨강) 아님 — 중립 그린
    var icon = up ? '#ic-up' : '#ic-down';
    var txt = (up ? '+' : '') + d + '%p';
    return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:800;color:#fff;background:' + color + ';border-radius:9px;padding:3px 8px;">' + svg(icon, 13) + txt + '</span>';
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
      var ring = sel === s.id ? '2.5px solid #036242' : '2.5px solid transparent';
      var chips = order.filter(function (c) { return d.comps[c]; }).map(function (c) {
        return '<div style="font-size:11.5px;color:#4E7D68;background:#E6F1EC;border-radius:9px;padding:4px 9px;box-shadow:inset 2px 2px 4px rgba(3,98,66,0.08),inset -2px -2px 4px rgba(255,255,255,0.85);"><span style="font-weight:700;">' + c + '</span> ' + d.comps[c].score + ' <span style="opacity:0.6;">·' + d.comps[c].weight + '%</span></div>';
      }).join('');
      return '<div data-act="selectS" data-sid="' + s.id + '" class="card-hover" style="cursor:pointer;background:#EAF4EF;border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:12px;outline:' + ring + ';outline-offset:-2px;box-shadow:12px 12px 26px rgba(3,98,66,0.12),-8px -8px 18px rgba(255,255,255,0.9),inset 0 8px 14px rgba(255,255,255,0.5),inset 0 -6px 12px rgba(3,98,66,0.05);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;gap:11px;"><div style="' + ICONBOX + '">' + svg(s.icon, 24) + '</div><span style="font-size:17px;font-weight:800;color:#0A3D2A;">' + s.name + '</span></div>' +
        '<div style="width:42px;height:42px;flex:none;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:' + gradeText[d.grade] + ';background:' + gradeColors[d.grade] + ';box-shadow:4px 4px 9px rgba(3,60,42,0.18),inset 2px 2px 5px rgba(255,255,255,0.4),inset -2px -2px 6px rgba(3,60,42,0.14);">' + d.grade + '</div></div>' +
        '<div style="display:flex;align-items:baseline;gap:6px;"><span style="font-size:30px;font-weight:800;color:#036242;line-height:1;">' + fmt(d.total) + '</span><span style="font-size:13px;color:#7FA895;font-weight:600;">점 / 100</span>' + (changeBadge(d.reach) ? '<span style="margin-left:auto;">' + changeBadge(d.reach) + '</span>' : '') + '</div>' +
        '<div style="padding:6px 8px;border-radius:12px;background:#EAF4EF;box-shadow:inset 4px 4px 8px rgba(3,60,42,0.1),inset -4px -4px 8px rgba(255,255,255,0.9);">' + GK.miniProgress(labels, data) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid rgba(3,98,66,0.09);padding-top:10px;">' + chips + '</div></div>';
    }).join('');

    // 등급표
    var rows = meta.subjects.map(function (s) {
      var d = st.subjects[s.id]; if (!d) return '';
      var compsStr = order.filter(function (c) { return d.comps[c]; }).map(function (c) { return c + ' ' + d.comps[c].weight + '%'; }).join(' · ');
      return '<div style="display:grid;grid-template-columns:1.4fr 1fr 0.8fr 2.2fr;gap:12px;align-items:center;padding:11px 14px;border-radius:14px;background:#E9F3EE;box-shadow:inset 2px 2px 5px rgba(3,98,66,0.05),inset -2px -2px 5px rgba(255,255,255,0.8);">' +
        '<span style="font-size:14.5px;font-weight:700;color:#0A3D2A;">' + s.name + '</span><span style="font-size:14px;font-weight:700;color:#036242;">' + fmt(d.total) + '</span>' +
        '<span><span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9px;font-size:14px;font-weight:800;color:' + gradeText[d.grade] + ';background:' + gradeColors[d.grade] + ';">' + d.grade + '</span></span>' +
        '<span style="font-size:12.5px;color:#4E7D68;">' + compsStr + '</span></div>';
    }).join('');

    return '<div style="max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:22px;">' +
      // header
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;' + CARD + 'border-radius:26px;padding:18px 22px;">' +
      '<div style="display:flex;align-items:center;gap:16px;"><button data-act="back" title="코드 조회로" class="btn-soft" style="' + SOFTBTN + 'width:46px;height:46px;padding:0;justify-content:center;">' + svg('#ic-back', 22) + '</button>' +
      '<div><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:12px;font-weight:700;letter-spacing:0.16em;color:#7FA895;">CODE</span><span style="font-size:24px;font-weight:800;letter-spacing:0.04em;color:#0A3D2A;">' + esc(st.code) + '</span><span style="font-size:14px;font-weight:700;color:#036242;background:#DCEEE5;border-radius:9px;padding:4px 11px;">' + st.grade + '학년</span></div>' +
      '<div style="font-size:12px;color:#7FA895;margin-top:4px;">내 학습 점검 · 다른 학생과 비교하지 않습니다</div></div></div>' +
      '<div style="text-align:right;"><div style="font-size:12px;color:#7FA895;font-weight:600;">평균 등급</div><div style="display:flex;align-items:baseline;gap:5px;justify-content:flex-end;"><span style="font-size:30px;font-weight:800;color:' + gradeColors[avgG] + ';">' + fmt(st.avg) + '</span><span style="font-size:13px;color:#7FA895;font-weight:600;">등급</span></div></div>' +
      '</div>' +
      // big progress
      progressCard() +
      // subject cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px;">' + cards + '</div>' +
      // table
      '<div style="' + CARD + '"><div style="font-size:16px;font-weight:800;color:#0A3D2A;margin-bottom:14px;">과목별 등급표</div><div style="display:flex;flex-direction:column;gap:8px;">' +
      '<div style="display:grid;grid-template-columns:1.4fr 1fr 0.8fr 2.2fr;gap:12px;padding:0 14px 8px;font-size:12px;font-weight:700;color:#7FA895;border-bottom:1px solid rgba(3,98,66,0.1);"><span>과목</span><span>총점</span><span>등급</span><span>반영 요소</span></div>' + rows + '</div></div>' +
      '</div>';
  }

  function progressCard() {
    var st = state.student, s = subjMeta(state.selSubject), d = st.subjects[state.selSubject];
    var order = meta.componentOrder.filter(function (c) { return d.reach[c] != null; });
    var multi = order.length > 1;
    var body = multi
      ? '<div style="position:relative;height:280px;padding:12px;' + INSET + '"><canvas id="progCanvas"></canvas></div>'
      : '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:34px;' + INSET + '"><span style="font-size:46px;font-weight:800;color:#036242;">' + d.reach[order[0]] + '%</span><span style="font-size:13px;color:#7FA895;">이 과목은 ' + order[0] + '평가만 반영합니다</span></div>';
    return '<div style="' + CARD + '">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;color:#036242;">' + svg('#ic-trend', 22) + '<span style="font-size:17px;font-weight:800;color:#0A3D2A;">' + s.name + ' · 자기 대비 진전</span>' + (changeBadge(d.reach) ? '<span style="margin-left:6px;">' + changeBadge(d.reach) + '</span>' : '') + '</div>' +
      '<div style="font-size:12px;color:#7FA895;margin-bottom:10px;">평가 시점별 도달률(내 점수 ÷ 만점). 과목 카드를 눌러 전환.</div>' + body + '</div>';
  }

  // ================================================================ 교사 탭
  function teacherGate() {
    var shake = state.tpwErr ? 'clayshake 0.42s ease' : 'none';
    var err = state.tpwErr ? '<div id="tpwErr" style="font-size:13px;color:#3C5C4F;font-weight:600;margin-top:-12px;">비밀번호가 올바르지 않습니다.</div>' : '';
    return '<div style="display:flex;justify-content:center;padding:20px;">' +
      '<div style="width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;gap:24px;' + CARD + 'border-radius:34px;padding:48px 40px;">' +
      '<div style="' + ICONBOX + 'width:88px;height:88px;border-radius:26px;">' + svg('#ic-lock', 40) + '</div>' +
      '<div style="text-align:center;"><div style="font-size:23px;font-weight:800;color:#0A3D2A;">교사 진단 · 인증</div><div style="margin-top:8px;font-size:14px;color:#4E7D68;line-height:1.5;">학급 분포·산포 진단 화면입니다.<br>비밀번호를 입력해 주세요.</div></div>' +
      '<input id="tpw" type="password" value="' + esc(state.tpw) + '" placeholder="비밀번호" style="width:100%;border:none;border-radius:18px;padding:16px 20px;font-size:17px;font-family:inherit;color:#0C4A34;background:#E6F1EC;text-align:center;letter-spacing:0.15em;box-shadow:inset 6px 6px 12px rgba(3,98,66,0.14),inset -6px -6px 12px rgba(255,255,255,0.95);animation:' + shake + ';">' +
      err +
      '<button data-act="unlock" class="btn-primary" style="' + BRANDBTN + 'width:100%;padding:16px;font-size:16px;">잠금 해제</button>' +
      '<div style="font-size:12px;color:#8AAE9E;">데모 비밀번호: ' + esc(DEMO_PW) + '</div>' +
      '</div></div>';
  }

  function teacherDash() {
    var g = state.tGrade, sid = state.tSubject;
    var gsub = state.cohort.grades[g].subjects[sid];
    var stats = gsub.stats;
    var gradeBtns = meta.grades.map(function (gg) {
      var on = gg === g;
      return '<button data-act="gGrade" data-grade="' + gg + '" class="btn-soft" style="border:none;border-radius:12px;padding:9px 16px;font-size:14px;font-weight:800;font-family:inherit;cursor:pointer;' + (on ? 'color:#fff;background:#036242;' : 'color:#4E7D68;background:#E6F1EC;box-shadow:inset 3px 3px 7px rgba(3,98,66,0.1),inset -3px -3px 7px rgba(255,255,255,0.9);') + '">' + gg + '학년</button>';
    }).join('');
    var subjBtns = meta.subjects.map(function (s) {
      var on = s.id === sid;
      return '<button data-act="tSubject" data-sid="' + s.id + '" class="btn-soft" style="border:none;border-radius:12px;padding:8px 14px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;gap:6px;' + (on ? 'color:#fff;background:#036242;' : 'color:#4E7D68;background:#E6F1EC;box-shadow:inset 3px 3px 7px rgba(3,98,66,0.1),inset -3px -3px 7px rgba(255,255,255,0.9);') + '">' + svg(s.icon, 16) + s.name + '</button>';
    }).join('');
    var boxItems = meta.subjects.map(function (s) { var d = state.cohort.grades[g].subjects[s.id]; return { name: s.name, totals: d.totals, stats: d.stats }; });
    var statTile = function (label, val) { return '<div style="flex:1;text-align:center;padding:14px 10px;border-radius:16px;background:#EAF4EF;box-shadow:inset 3px 3px 7px rgba(3,98,66,0.08),inset -3px -3px 7px rgba(255,255,255,0.85);"><div style="font-size:22px;font-weight:800;color:#036242;">' + val + '</div><div style="font-size:11.5px;color:#4E7D68;font-weight:600;margin-top:2px;">' + label + '</div></div>'; };

    return '<div style="max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:22px;">' +
      // banner + controls
      '<div style="' + CARD + 'border-radius:26px;display:flex;flex-direction:column;gap:16px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
      '<div style="display:flex;align-items:center;gap:10px;color:#036242;">' + svg('#ic-shield', 20) + '<span style="font-size:14px;font-weight:700;color:#0A3D2A;">진단용 화면 — 다음 수업 결정에 활용, 학생에게 직접 보여주지 않습니다</span></div>' +
      '<button data-act="logoutT" class="btn-soft" style="' + SOFTBTN + '">' + svg('#ic-logout', 18) + '종료</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;">' +
      '<div style="display:flex;gap:8px;">' + gradeBtns + '</div>' +
      '<div style="width:1px;height:24px;background:rgba(3,98,66,0.12);"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + subjBtns + '</div></div>' +
      '<div style="display:flex;gap:12px;">' + statTile('학생 수', state.cohort.grades[g].count + '명') + statTile('평균', fmt(stats.mean)) + statTile('표준편차', fmt(stats.sd)) + statTile('중앙값', fmt(stats.median)) + '</div>' +
      '</div>' +
      // histogram
      '<div style="' + CARD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;color:#036242;">' + svg('#ic-bars', 22) + '<span style="font-size:17px;font-weight:800;color:#0A3D2A;">' + gsub.name + ' ' + g + '학년 점수 분포</span></div>' +
      '<div style="font-size:12px;color:#7FA895;margin-bottom:8px;">봉우리가 둘로 갈리면(이봉) 전체수업보다 두 트랙 차별화를 고려.</div>' +
      '<div style="position:relative;height:250px;padding:12px;' + INSET + '"><canvas id="histCanvas"></canvas></div></div>' +
      // grade dist + box
      '<div style="display:grid;grid-template-columns:1fr 1.3fr;gap:22px;" class="teacher-grid">' +
      '<div style="' + CARD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#036242;">' + svg('#ic-radar', 20) + '<span style="font-size:16px;font-weight:800;color:#0A3D2A;">5등급 분포</span></div>' +
      '<div style="position:relative;height:230px;padding:12px;' + INSET + '"><canvas id="gradeCanvas"></canvas></div></div>' +
      '<div style="' + CARD + '"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#036242;">' + svg('#ic-box', 20) + '<span style="font-size:16px;font-weight:800;color:#0A3D2A;">과목별 산포 (상자그림)</span></div>' +
      '<div style="font-size:12px;color:#7FA895;margin-bottom:8px;">산포 크거나 이상치 많으면 이질 학급 → 소집단·차별화.</div>' +
      '<div style="padding:8px;' + INSET + '">' + GK.boxPlotSVG(boxItems) + '</div></div>' +
      '</div></div>';
  }

  // ================================================================ 렌더 + 차트 마운트
  function destroyCharts() { chartRegistry.forEach(function (c) { if (c) c.destroy(); }); chartRegistry = []; }

  function render() {
    destroyCharts();
    if (!meta) { root.innerHTML = '<div style="padding:60px;text-align:center;color:#4E7D68;">데이터 로딩 중…</div>'; return; }
    var body;
    if (state.tab === 'student') body = state.student ? studentDash() : studentInput();
    else body = state.unlocked ? teacherDash() : teacherGate();
    root.innerHTML = '<div style="min-height:100vh;padding:26px 20px 64px;">' + tabbar() + body + '</div>';
    mountCharts();
  }

  function mountCharts() {
    if (state.tab === 'student' && state.student) {
      var d = state.student.subjects[state.selSubject];
      var order = meta.componentOrder.filter(function (c) { return d.reach[c] != null; });
      if (order.length > 1) chartRegistry.push(GK.progressLine(document.getElementById('progCanvas'), order, order.map(function (c) { return d.reach[c]; })));
    } else if (state.tab === 'teacher' && state.unlocked) {
      var g = state.tGrade, sub = state.cohort.grades[g].subjects[state.tSubject];
      chartRegistry.push(GK.histogram(document.getElementById('histCanvas'), sub.totals));
      chartRegistry.push(GK.gradeDist(document.getElementById('gradeCanvas'), sub.gradeCounts, gradeColors));
    }
  }

  // ================================================================ 액션
  function lookup(codeRaw) {
    var code = String(codeRaw == null ? '' : codeRaw).trim().toUpperCase();
    if (!code) return;
    fetch('public/data/students/' + encodeURIComponent(code) + '.json')
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { state.student = d; state.selSubject = meta.subjects[0].id; state.code = code; state.codeErr = false; render(); })
      .catch(function () { state.code = code; state.codeErr = true; render(); focusEl('code'); });
  }

  function teacherUnlock() {
    var el = document.getElementById('tpw'); state.tpw = el ? el.value : state.tpw;
    if (state.tpw !== DEMO_PW) { state.tpwErr = true; render(); focusEl('tpw'); return; }
    if (state.cohort) { state.unlocked = true; state.tpwErr = false; render(); return; }
    fetch('public/data/cohort.json').then(function (r) { return r.json(); }).then(function (d) {
      state.cohort = d; state.unlocked = true; state.tpwErr = false;
      state.tGrade = meta.grades[0]; state.tSubject = meta.subjects[0].id; render();
    }).catch(function () { state.tpwErr = true; render(); });
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
    else if (act === 'unlock') { teacherUnlock(); }
    else if (act === 'logoutT') { state.unlocked = false; state.tpw = ''; render(); }
    else if (act === 'gGrade') { state.tGrade = +t.getAttribute('data-grade'); render(); }
    else if (act === 'tSubject') { state.tSubject = t.getAttribute('data-sid'); render(); }
  }
  function onKeydown(e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') lookup(e.target.value);
    else if (e.target.id === 'tpw') teacherUnlock();
  }
  function onInput(e) {
    if (e.target.id === 'code' && state.codeErr) { state.codeErr = false; strip('codeErr', 'code'); }
    if (e.target.id === 'tpw' && state.tpwErr) { state.tpwErr = false; strip('tpwErr', 'tpw'); }
  }
  function strip(errId, inputId) { var er = document.getElementById(errId); if (er) er.remove(); var inp = document.getElementById(inputId); if (inp) inp.style.animation = 'none'; }

  // ================================================================ 시작
  function start() {
    root = document.getElementById('root');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('input', onInput);
    render();
    fetch('public/data/meta.json').then(function (r) { return r.json(); }).then(function (d) { meta = d; render(); })
      .catch(function () { root.innerHTML = '<div style="padding:60px;text-align:center;color:#B54B3A;">메타 로드 실패 — 빌드 필요: <code>npm run gen-sample &amp;&amp; npm run build</code></div>'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
