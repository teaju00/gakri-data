//! 앱이 실제로 도는 경로를 창 없이 끝까지 태운다:
//! 최초 설정 → 로그인 → 임포트 → 역할별 조회.
//!
//! Tauri 커맨드는 이 함수들을 감싸기만 하므로, 여기서 통과하면 IPC 뒤에서 벌어지는 일은
//! 전부 검증된 셈이다. 남는 건 창이 뜨는지 뿐이다.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use gakri_core::error::AppError;
use gakri_core::model::{Assignment, NewTeacher, Role};
use gakri_core::service;
use gakri_core::session::SessionStore;
use gakri_core::store::Paths;

const ADMIN_PW: &str = "schoolpass123";
const HOMEROOM_PW: &str = "homeroompass1";
const SUBJECT_PW: &str = "subjectpass1";

/// 매 테스트가 자기 폴더를 쓴다. 끝나면 지운다.
struct TempRoot(PathBuf);

impl TempRoot {
    fn new(tag: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!("gakri-test-{tag}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        TempRoot(p)
    }
    fn paths(&self) -> Paths {
        Paths::new(self.0.clone()).unwrap()
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2).unwrap().to_path_buf()
}

fn data_dir() -> Option<PathBuf> {
    let d = repo().join("data");
    d.is_dir().then_some(d)
}

fn config() -> gakri_core::model::AppConfig {
    serde_json::from_slice(&fs::read(repo().join("config").join("subjects.json")).unwrap()).unwrap()
}

fn new_teacher(username: &str, password: &str, role: Role) -> NewTeacher {
    serde_json::from_value(serde_json::json!({
        "username": username,
        "displayName": username,
        "password": password,
        "role": serde_json::to_value(role).unwrap(),
    }))
    .unwrap()
}

// ---------------------------------------------------------------- 계정 · 인증

#[test]
fn provision_then_login_then_wrong_password() {
    let root = TempRoot::new("auth");
    let p = root.paths();
    let sessions = SessionStore::default();

    assert!(!service::is_provisioned(&p), "처음엔 계정이 없다");

    // 짧은 비밀번호는 거절.
    assert!(matches!(
        service::provision(&p, "admin", "short"),
        Err(AppError::InvalidInput(_))
    ));

    service::provision(&p, "admin", ADMIN_PW).unwrap();
    assert!(service::is_provisioned(&p));

    // 두 번은 안 된다.
    assert!(matches!(
        service::provision(&p, "admin2", ADMIN_PW),
        Err(AppError::AlreadyProvisioned)
    ));

    assert!(matches!(
        service::login(&p, &sessions, "admin", "wrongpassword"),
        Err(AppError::BadCredentials)
    ));
    assert!(matches!(
        service::login(&p, &sessions, "nobody", ADMIN_PW),
        Err(AppError::BadCredentials)
    ));

    let s = service::login(&p, &sessions, "admin", ADMIN_PW).unwrap();
    assert_eq!(s.role, "admin");
    assert!(!s.token.is_empty());
}

// ---------------------------------------------------------------- 임포트 + 역할별 조회

#[test]
fn import_then_each_role_sees_only_its_own_data() {
    let Some(data) = data_dir() else {
        eprintln!("skip: data/ 없음 (npm run gen-sample)");
        return;
    };
    let root = TempRoot::new("roles");
    let p = root.paths();
    let sessions = SessionStore::default();
    let cfg = config();

    service::provision(&p, "admin", ADMIN_PW).unwrap();
    let admin = service::login(&p, &sessions, "admin", ADMIN_PW).unwrap();

    // 임포트 전에는 메타가 없다.
    assert!(matches!(service::meta(&p), Err(AppError::NotProvisioned)));

    let report = service::import_grades(&p, &sessions, &admin.token, &cfg, &data).unwrap();
    assert_eq!(report.students, 420);
    assert_eq!(report.grades, vec![1, 2, 3]);

    // 학생 조회는 로그인 없이. 이름·반·번호가 없다.
    let meta = service::meta(&p).unwrap();
    let code = &meta.example_codes[0];
    let st = service::student_lookup(&p, code).unwrap();
    assert_eq!(&st.code, code);
    assert!(!st.subjects.is_empty());
    assert!(matches!(service::student_lookup(&p, "9-ZZZ"), Err(AppError::NotFound)));

    // 관리자: 전 학년 + 전 반.
    let admin_view = service::cohort(&p, &sessions, &admin.token).unwrap();
    assert_eq!(admin_view.grades.len(), 3, "관리자는 학년 단위 분포도 본다");
    assert_eq!(admin_view.classes.len(), 3);
    assert_eq!(admin_view.classes["1"].len(), 5, "1학년 5개 반");

    // ---- 담임: 자기 반, 전 과목 ----
    service::add_teacher(
        &p,
        &sessions,
        &admin.token,
        &new_teacher("kim", HOMEROOM_PW, Role::Homeroom { grade: 1, class: 2 }),
    )
    .unwrap();

    let kim = service::login(&p, &sessions, "kim", HOMEROOM_PW).unwrap();
    assert_eq!(kim.role, "homeroom");
    let v = service::cohort(&p, &sessions, &kim.token).unwrap();

    assert!(v.grades.is_empty(), "담임에게 학년 전체 분포를 주면 다른 반이 새어 나간다");
    assert_eq!(v.classes.keys().collect::<Vec<_>>(), vec!["1"]);
    assert_eq!(v.classes["1"].keys().collect::<Vec<_>>(), vec!["2"], "자기 반만");
    assert!(v.classes["1"]["2"].subjects.len() > 1, "자기 반은 전 과목");
    assert!(v.scope.subjects.is_none());

    // 담임은 관리자 커맨드를 못 쓴다.
    assert!(matches!(
        service::import_grades(&p, &sessions, &kim.token, &cfg, &data),
        Err(AppError::Forbidden)
    ));
    assert!(matches!(
        service::list_teachers(&p, &sessions, &kim.token),
        Err(AppError::Forbidden)
    ));
    assert!(matches!(
        service::add_teacher(&p, &sessions, &kim.token, &new_teacher("x", ADMIN_PW, Role::Admin)),
        Err(AppError::Forbidden)
    ));

    // ---- 교과교사: 담당 (학년, 반, 과목) 만 ----
    service::add_teacher(
        &p,
        &sessions,
        &admin.token,
        &new_teacher(
            "lee",
            SUBJECT_PW,
            Role::Subject {
                assignments: vec![
                    Assignment { grade: 1, class: 1, subject: "mat".into() },
                    Assignment { grade: 3, class: 4, subject: "mat".into() },
                ],
            },
        ),
    )
    .unwrap();

    let lee = service::login(&p, &sessions, "lee", SUBJECT_PW).unwrap();
    assert_eq!(lee.role, "subject");
    let v = service::cohort(&p, &sessions, &lee.token).unwrap();

    assert!(v.grades.is_empty());
    assert_eq!(v.classes.keys().collect::<Vec<_>>(), vec!["1", "3"]);
    assert_eq!(v.classes["1"].keys().collect::<Vec<_>>(), vec!["1"]);
    assert_eq!(v.classes["3"].keys().collect::<Vec<_>>(), vec!["4"]);
    for (g, by_class) in &v.classes {
        for (c, node) in by_class {
            assert_eq!(
                node.subjects.keys().collect::<Vec<_>>(),
                vec!["mat"],
                "{g}학년 {c}반: 담당 과목 외에는 응답에 없어야 함"
            );
        }
    }
    assert_eq!(v.scope.subjects.as_deref(), Some(&["mat".to_string()][..]));

    // ---- 로그아웃하면 토큰이 죽는다 ----
    sessions.remove(&kim.token);
    assert!(matches!(
        service::cohort(&p, &sessions, &kim.token),
        Err(AppError::NotAuthenticated)
    ));

    // ---- 관리자만 교사 목록 ----
    let list = service::list_teachers(&p, &sessions, &admin.token).unwrap();
    assert_eq!(list.len(), 3);
}

// ---------------------------------------------------------------- 디스크에 남는 것

#[test]
fn code_map_never_touches_the_disk_in_plaintext() {
    let Some(data) = data_dir() else {
        eprintln!("skip: data/ 없음");
        return;
    };
    let root = TempRoot::new("disk");
    let p = root.paths();
    let sessions = SessionStore::default();

    service::provision(&p, "admin", ADMIN_PW).unwrap();
    let admin = service::login(&p, &sessions, "admin", ADMIN_PW).unwrap();
    service::import_grades(&p, &sessions, &admin.token, &config(), &data).unwrap();

    // vault 는 JSON 으로 읽히면 안 된다.
    let blob = fs::read(root.0.join("vault.enc")).unwrap();
    assert!(serde_json::from_slice::<serde_json::Value>(&blob).is_err(), "vault 가 평문이다");

    // 학년/반/번호 라벨이 암호문 어디에도 나오면 안 된다.
    for needle in [b"codeMap".as_slice(), b"class".as_slice()] {
        assert!(
            !blob.windows(needle.len()).any(|w| w == needle),
            "vault 에서 평문 조각이 보인다: {}",
            String::from_utf8_lossy(needle)
        );
    }

    // 평문 파일들에는 학생을 되짚을 정보가 없어야 한다.
    let teachers = fs::read_to_string(root.0.join("teachers.json")).unwrap();
    assert!(!teachers.contains(ADMIN_PW), "비밀번호가 평문으로 남았다");

    let meta = fs::read_to_string(root.0.join("meta.json")).unwrap();
    assert!(!meta.contains("codeMap"));

    let sample = fs::read_dir(root.0.join("students")).unwrap().next().unwrap().unwrap();
    let student = fs::read_to_string(sample.path()).unwrap();
    for banned in ["\"class\"", "\"num\"", "\"name\""] {
        assert!(!student.contains(banned), "학생 파일에 {banned} 이 있다");
    }
}

/// 계정이 늘어도 데이터는 재암호화되지 않는다 — 같은 DEK 를 각자의 비밀번호로 감쌀 뿐이다.
#[test]
fn every_teacher_unwraps_the_same_vault() {
    let Some(data) = data_dir() else {
        eprintln!("skip: data/ 없음");
        return;
    };
    let root = TempRoot::new("dek");
    let p = root.paths();
    let sessions = SessionStore::default();

    service::provision(&p, "admin", ADMIN_PW).unwrap();
    let admin = service::login(&p, &sessions, "admin", ADMIN_PW).unwrap();
    service::import_grades(&p, &sessions, &admin.token, &config(), &data).unwrap();

    let vault_before = fs::read(root.0.join("vault.enc")).unwrap();

    service::add_teacher(
        &p,
        &sessions,
        &admin.token,
        &new_teacher("park", HOMEROOM_PW, Role::Homeroom { grade: 2, class: 3 }),
    )
    .unwrap();

    assert_eq!(vault_before, fs::read(root.0.join("vault.enc")).unwrap(), "vault 를 다시 쓰지 않았다");

    // 새 교사도 같은 vault 를 연다.
    let park = service::login(&p, &sessions, "park", HOMEROOM_PW).unwrap();
    let v = service::cohort(&p, &sessions, &park.token).unwrap();
    assert_eq!(v.classes["2"].keys().collect::<Vec<_>>(), vec!["3"]);
}
