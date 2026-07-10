//! 성적 분석의 순수 로직. Tauri/웹뷰에 의존하지 않는다.
//!
//! 이렇게 갈라 둔 이유가 두 가지다.
//!  - 접근 제어와 등급 계산은 GUI 와 무관한 규칙이다. 여기서 단위 테스트로 못 박는다.
//!  - 테스트가 webview2/tao 를 링크하지 않아 빠르고, 데스크톱 툴체인 없이도 돌릴 수 있다.

pub mod access;
pub mod crypto;
pub mod error;
pub mod grade;
pub mod importer;
pub mod model;
pub mod service;
pub mod session;
pub mod store;

pub use error::{AppError, Result};
