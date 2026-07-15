/* GKAPI — 데이터 접근 계층. 웹(정적)과 Tauri(데스크톱) 두 런타임을 같은 표면으로 감쌈.
 *
 * 왜 필요한가: 웹 버전은 public/data/*.json 을 fetch 로 직접 읽는다. Tauri 버전은
 * 그러면 안 된다 — 접근 제어를 프론트에서 하면 devtools 로 그냥 우회된다.
 * Tauri 모드에서는 모든 코호트 조회가 Rust 커맨드를 거치고, Rust 가 세션의 역할을
 * 보고 허용된 (학년, 반, 과목) 슬라이스만 돌려준다. 프론트는 못 본 데이터는 받지도 못한다.
 *
 * 웹 버전은 기존 동작 그대로 유지한다(단일 데모 비밀번호, 학년 단위 집계).
 *
 * 공통 표면:
 *   GKAPI.mode                      -> 'tauri' | 'web'
 *   GKAPI.caps()                    -> { classScope, accounts }
 *   GKAPI.meta()                    -> Promise<Meta>
 *   GKAPI.studentLookup(code)       -> Promise<StudentPayload>   (인증 불필요)
 *   GKAPI.login(password)           -> Promise<Session>
 *   GKAPI.logout()                  -> Promise<void>
 *   GKAPI.cohort()                  -> Promise<CohortView>       (로그인 후에만)
 *
 * Session = { token, displayName, role, scope }
 *   role  : 'admin' | 'homeroom' | 'subject'
 *   scope : { grades: [1,2,3], classes: { '1': [2] }, subjects: ['kor'] | null }
 *           subjects === null 이면 전 과목 허용.
 *
 * CohortView = { subjects, componentOrder, grades, classes? , scope }
 *   grades  : 학년 단위 집계 (웹 모드 / admin)
 *   classes : { '<학년>': { '<반>': { count, subjects: {...} } } }  — Tauri 모드 전용
 */
(function () {
  'use strict';

  var isTauri = typeof window !== 'undefined' && !!window.__TAURI__ && !!window.__TAURI__.core;

  // ------------------------------------------------------------------ 웹 구현
  // 기존 정적 사이트 동작 보존. 비밀번호는 우발적 노출 차단용이지 보안 경계가 아니다.
  var WEB_DEMO_PW = '1234';

  var webCohortCache = null;
  var webSession = null;

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  var webImpl = {
    mode: 'web',
    caps: function () { return { classScope: false, accounts: false }; },
    meta: function () { return getJson('public/data/meta.json'); },
    studentLookup: function (code) {
      return getJson('public/data/students/' + encodeURIComponent(code) + '.json');
    },
    login: function (password) {
      if (password !== WEB_DEMO_PW) return Promise.reject(new Error('BAD_CREDENTIALS'));
      webSession = {
        token: 'web',
        displayName: '교사',
        role: 'admin',
        scope: { grades: null, classes: null, subjects: null }
      };
      return Promise.resolve(webSession);
    },
    logout: function () { webSession = null; webCohortCache = null; return Promise.resolve(); },
    cohort: function () {
      if (!webSession) return Promise.reject(new Error('NOT_AUTHENTICATED'));
      if (webCohortCache) return Promise.resolve(webCohortCache);
      return getJson('public/data/cohort.json').then(function (c) {
        c.scope = webSession.scope;
        webCohortCache = c;
        return c;
      });
    },
    demoPassword: WEB_DEMO_PW
  };

  // ---------------------------------------------------------------- Tauri 구현
  var tauriSession = null;

  function invoke(cmd, args) { return window.__TAURI__.core.invoke(cmd, args || {}); }

  var tauriImpl = {
    mode: 'tauri',
    caps: function () { return { classScope: true, accounts: true }; },
    meta: function () { return invoke('meta'); },
    studentLookup: function (code) { return invoke('student_lookup', { code: code }); },
    login: function (password) {
      return invoke('login', { password: password }).then(function (s) {
        tauriSession = s;
        return s;
      });
    },
    logout: function () {
      if (!tauriSession) return Promise.resolve();
      var t = tauriSession.token;
      tauriSession = null;
      return invoke('logout', { token: t });
    },
    cohort: function () {
      if (!tauriSession) return Promise.reject(new Error('NOT_AUTHENTICATED'));
      return invoke('cohort', { token: tauriSession.token });
    },
    // 앱 최초 실행 / 관리자 전용 — 웹 모드에는 대응물이 없다.
    isProvisioned: function () { return invoke('is_provisioned'); },
    provision: function (username, password) { return invoke('provision', { username: username, password: password }); },
    addTeacher: function (teacher) { return invoke('add_teacher', { token: tauriSession.token, teacher: teacher }); },
    listTeachers: function () { return invoke('list_teachers', { token: tauriSession.token }); },
    importGrades: function (dir) { return invoke('import_grades', { token: tauriSession.token, dir: dir }); },
    demoPassword: null
  };

  window.GKAPI = isTauri ? tauriImpl : webImpl;
})();
