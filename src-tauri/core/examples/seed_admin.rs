//! 관리자 계정을 파일로 미리 만드는 CLI 유틸리티. `service::provision()`을 그대로
//! 호출한다 — 암호화 로직을 여기서 재구현하지 않는다.
//!
//! 사용법:
//!   cargo run --example seed_admin --manifest-path src-tauri/core/Cargo.toml -- <app_data_dir> <username> <password>

use std::path::PathBuf;
use std::process::ExitCode;

use gakri_core::error::AppError;
use gakri_core::service;
use gakri_core::store::Paths;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [app_data_dir, username, password] = args.as_slice() else {
        eprintln!("사용법: seed_admin <app_data_dir> <username> <password>");
        return ExitCode::FAILURE;
    };

    let paths = match Paths::new(PathBuf::from(app_data_dir)) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("앱 데이터 폴더를 열 수 없습니다: {e}");
            return ExitCode::FAILURE;
        }
    };

    match service::provision(&paths, username, password) {
        Ok(()) => {
            println!("관리자 계정 생성 완료");
            println!("아이디: {username}");
            println!("비밀번호: {password}");
            ExitCode::SUCCESS
        }
        Err(AppError::AlreadyProvisioned) => {
            eprintln!("이미 계정이 있습니다. 새로 만들려면 먼저 '{app_data_dir}' 폴더를 지우세요.");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("계정 생성 실패: {e}");
            ExitCode::FAILURE
        }
    }
}
