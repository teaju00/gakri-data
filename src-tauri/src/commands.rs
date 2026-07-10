//! IPC 표면. 앱 데이터 폴더 위치를 알려 주고 `gakri_core::service` 를 부르는 게 전부다.
//! 규칙(권한·암호화·등급)은 core 안에 있고 거기서 창 없이 테스트된다.

use std::path::PathBuf;

use tauri::{path::BaseDirectory, AppHandle, Manager, State};

use gakri_core::error::{AppError, Result};
use gakri_core::model::*;
use gakri_core::service;
use gakri_core::session::SessionStore;
use gakri_core::store::Paths;

fn paths(app: &AppHandle) -> Result<Paths> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app_data_dir: {e}")))?;
    Paths::new(root)
}

#[tauri::command]
pub fn is_provisioned(app: AppHandle) -> Result<bool> {
    Ok(service::is_provisioned(&paths(&app)?))
}

#[tauri::command]
pub fn provision(app: AppHandle, username: String, password: String) -> Result<()> {
    service::provision(&paths(&app)?, &username, &password)
}

#[tauri::command]
pub fn login(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    username: String,
    password: String,
) -> Result<SessionDto> {
    service::login(&paths(&app)?, &sessions, &username, &password)
}

#[tauri::command]
pub fn logout(sessions: State<'_, SessionStore>, token: String) {
    sessions.remove(&token);
}

#[tauri::command]
pub fn meta(app: AppHandle) -> Result<Meta> {
    service::meta(&paths(&app)?)
}

#[tauri::command]
pub fn student_lookup(app: AppHandle, code: String) -> Result<StudentPayload> {
    service::student_lookup(&paths(&app)?, &code)
}

#[tauri::command]
pub fn cohort(app: AppHandle, sessions: State<'_, SessionStore>, token: String) -> Result<CohortView> {
    service::cohort(&paths(&app)?, &sessions, &token)
}

/// `config/subjects.json`. 번들 리소스를 먼저 보고, 없으면 앱 데이터 폴더,
/// 마지막으로 성적 폴더 옆의 저장소 레이아웃(`../config/`)을 본다(개발 편의).
fn locate_config(app: &AppHandle, data_dir: &std::path::Path) -> Result<PathBuf> {
    if let Ok(p) = app.path().resolve("subjects.json", BaseDirectory::Resource) {
        if p.exists() {
            return Ok(p);
        }
    }
    let in_app_data = paths(app)?.root.join("subjects.json");
    if in_app_data.exists() {
        return Ok(in_app_data);
    }
    if let Some(parent) = data_dir.parent() {
        let repo = parent.join("config").join("subjects.json");
        if repo.exists() {
            return Ok(repo);
        }
    }
    Err(AppError::ImportFailed("subjects.json 을 찾을 수 없습니다".into()))
}

#[tauri::command]
pub fn import_grades(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    token: String,
    dir: String,
) -> Result<ImportReport> {
    let data_dir = PathBuf::from(dir);
    let cfg_path = locate_config(&app, &data_dir)?;
    let cfg: AppConfig = serde_json::from_slice(&std::fs::read(&cfg_path)?)?;
    service::import_grades(&paths(&app)?, &sessions, &token, &cfg, &data_dir)
}

#[tauri::command]
pub fn add_teacher(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    token: String,
    teacher: NewTeacher,
) -> Result<()> {
    service::add_teacher(&paths(&app)?, &sessions, &token, &teacher)
}

#[tauri::command]
pub fn list_teachers(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    token: String,
) -> Result<Vec<TeacherSummary>> {
    service::list_teachers(&paths(&app)?, &sessions, &token)
}
