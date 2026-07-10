//! 앱이 실제로 하는 일. Tauri 커맨드는 이 함수들을 감싸기만 한다.
//!
//! 여기 있으면 임시 폴더 하나만 주면 전 흐름(계정 생성 → 로그인 → 임포트 → 조회)을
//! 창 없이 돌려볼 수 있다. 접근 제어가 실제로 데이터를 막는지도 여기서 확인된다.

use std::path::Path;

use crate::access;
use crate::crypto;
use crate::error::{AppError, Result};
use crate::importer;
use crate::model::*;
use crate::session::SessionStore;
use crate::store::{self, Paths};

pub const MIN_PASSWORD_LEN: usize = 8;

pub fn check_password(pw: &str) -> Result<()> {
    if pw.chars().count() < MIN_PASSWORD_LEN {
        return Err(AppError::InvalidInput(format!(
            "비밀번호는 {MIN_PASSWORD_LEN}자 이상이어야 합니다"
        )));
    }
    Ok(())
}

pub fn check_username(u: &str) -> Result<String> {
    let u = u.trim();
    if u.is_empty() || u.chars().count() > 32 {
        return Err(AppError::InvalidInput("아이디 길이".into()));
    }
    Ok(u.to_string())
}

pub fn is_provisioned(p: &Paths) -> bool {
    store::is_provisioned(p)
}

/// 최초 실행. 관리자 계정을 만들면서 DEK 를 생성한다.
/// 모든 계정의 비밀번호를 잃으면 vault.enc 는 복구할 수 없다.
pub fn provision(p: &Paths, username: &str, password: &str) -> Result<()> {
    if store::is_provisioned(p) {
        return Err(AppError::AlreadyProvisioned);
    }
    check_password(password)?;
    let username = check_username(username)?;

    let dek = crypto::new_dek();
    let kdf = crypto::new_kdf_params();
    let wrapped_dek = crypto::wrap_dek(password, &kdf, &dek)?;

    store::write_teachers(
        p,
        &TeacherFile {
            teachers: vec![TeacherRecord {
                username: username.clone(),
                display_name: username,
                role: Role::Admin,
                kdf,
                wrapped_dek,
            }],
        },
    )
}

pub fn login(p: &Paths, sessions: &SessionStore, username: &str, password: &str) -> Result<SessionDto> {
    let file = store::read_teachers(p)?;
    if file.teachers.is_empty() {
        return Err(AppError::NotProvisioned);
    }
    let rec = file
        .teachers
        .iter()
        .find(|t| t.username == username.trim())
        .ok_or(AppError::BadCredentials)?;

    // 비밀번호가 맞아야만 DEK 가 풀린다. 별도의 비밀번호 해시 비교가 없다.
    let dek = crypto::unwrap_dek(password, &rec.kdf, &rec.wrapped_dek)?;

    let vault = store::read_vault(p, &dek)?;
    let scope = access::scope_for(&rec.role, &vault);
    let token = sessions.insert(rec.role.clone(), dek);
    Ok(SessionDto { token, display_name: rec.display_name.clone(), role: rec.role.tag(), scope })
}

pub fn meta(p: &Paths) -> Result<Meta> {
    store::read_meta(p)
}

/// 인증 없이 조회 가능. 코드와 점수뿐이라 code-map 없이는 누구인지 알 수 없다.
pub fn student_lookup(p: &Paths, code: &str) -> Result<StudentPayload> {
    store::read_student(p, &code.trim().to_uppercase())
}

pub fn cohort(p: &Paths, sessions: &SessionStore, token: &str) -> Result<CohortView> {
    let meta = store::read_meta(p)?;
    sessions.with(token, |s| {
        let vault = store::read_vault(p, &s.dek)?;
        Ok(CohortView {
            subjects: meta.subjects.clone(),
            component_order: meta.component_order.clone(),
            grades: access::visible_grades(&s.role, &vault),
            classes: access::visible_classes(&s.role, &vault),
            scope: access::scope_for(&s.role, &vault),
        })
    })
}

/// 성적 파일 폴더를 읽어 산출물을 다시 만든다. 관리자만.
pub fn import_grades(
    p: &Paths,
    sessions: &SessionStore,
    token: &str,
    cfg: &AppConfig,
    dir: &Path,
) -> Result<ImportReport> {
    sessions.with_admin(token, |s| {
        let out = importer::import(cfg, dir)?;
        store::clear_students(p)?;
        for st in &out.students {
            store::write_student(p, st)?;
        }
        store::write_meta(p, &out.meta)?;
        store::write_vault(p, &s.dek, &out.vault)?;
        Ok(out.report)
    })
}

/// 관리자 세션의 DEK 를 새 교사의 KEK 로 다시 감싼다 —
/// 데이터를 재암호화하지 않고도 계정을 늘릴 수 있다.
pub fn add_teacher(p: &Paths, sessions: &SessionStore, token: &str, t: &NewTeacher) -> Result<()> {
    check_password(&t.password)?;
    let username = check_username(&t.username)?;
    sessions.with_admin(token, |s| {
        let mut file = store::read_teachers(p)?;
        if file.teachers.iter().any(|x| x.username == username) {
            return Err(AppError::InvalidInput("이미 있는 아이디입니다".into()));
        }
        let kdf = crypto::new_kdf_params();
        let wrapped_dek = crypto::wrap_dek(&t.password, &kdf, &s.dek)?;
        file.teachers.push(TeacherRecord {
            username,
            display_name: t.display_name.clone(),
            role: t.role.clone(),
            kdf,
            wrapped_dek,
        });
        store::write_teachers(p, &file)
    })
}

pub fn list_teachers(p: &Paths, sessions: &SessionStore, token: &str) -> Result<Vec<TeacherSummary>> {
    sessions.with_admin(token, |_| {
        Ok(store::read_teachers(p)?
            .teachers
            .iter()
            .map(|t| TeacherSummary {
                username: t.username.clone(),
                display_name: t.display_name.clone(),
                role: t.role.tag(),
            })
            .collect())
    })
}
