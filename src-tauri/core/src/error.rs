use serde::{Serialize, Serializer};

/// 프론트로 나가는 오류. 내부 경로·원인 문자열이 그대로 새지 않도록
/// `Serialize` 는 안정적인 코드 문자열만 내보낸다. 상세는 stderr 로만 남긴다.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("BAD_CREDENTIALS")]
    BadCredentials,

    #[error("NOT_AUTHENTICATED")]
    NotAuthenticated,

    #[error("FORBIDDEN")]
    Forbidden,

    #[error("NOT_PROVISIONED")]
    NotProvisioned,

    #[error("ALREADY_PROVISIONED")]
    AlreadyProvisioned,

    #[error("NOT_FOUND")]
    NotFound,

    #[error("INVALID_INPUT: {0}")]
    InvalidInput(String),

    #[error("IMPORT_FAILED: {0}")]
    ImportFailed(String),

    #[error("INTERNAL")]
    Internal(String),
}

impl AppError {
    /// 프론트가 분기에 쓸 수 있는 안정적 코드.
    fn code(&self) -> &'static str {
        match self {
            AppError::BadCredentials => "BAD_CREDENTIALS",
            AppError::NotAuthenticated => "NOT_AUTHENTICATED",
            AppError::Forbidden => "FORBIDDEN",
            AppError::NotProvisioned => "NOT_PROVISIONED",
            AppError::AlreadyProvisioned => "ALREADY_PROVISIONED",
            AppError::NotFound => "NOT_FOUND",
            AppError::InvalidInput(_) => "INVALID_INPUT",
            AppError::ImportFailed(_) => "IMPORT_FAILED",
            AppError::Internal(_) => "INTERNAL",
        }
    }

    /// 사용자에게 보여도 되는 상세만 통과시킨다. 인증 실패는 어떤 단서도 주지 않는다.
    fn detail(&self) -> Option<&str> {
        match self {
            AppError::InvalidInput(d) | AppError::ImportFailed(d) => Some(d),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    // 이 파일의 `Result` 별칭이 std 를 가리므로 여기서는 완전 경로를 쓴다.
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        if let AppError::Internal(detail) = self {
            eprintln!("[gakri] internal error: {detail}");
        }
        let mut out = String::from(self.code());
        if let Some(d) = self.detail() {
            out.push_str(": ");
            out.push_str(d);
        }
        s.serialize_str(&out)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Internal(e.to_string())
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
