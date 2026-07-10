//! 로그인 세션. DEK 는 여기(메모리)에만 있고 프론트로 절대 나가지 않는다.
//! 프론트는 불투명한 토큰만 받는다.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::crypto::{self, Dek};
use crate::error::{AppError, Result};
use crate::model::Role;

/// 자리를 비운 사이 타인이 조회하는 상황을 줄이기 위한 상한. 잠금 버튼이 우선이지만
/// 눌러 두지 않아도 이 시간이 지나면 토큰이 죽는다.
const SESSION_TTL: Duration = Duration::from_secs(60 * 60 * 4);

pub struct Session {
    pub role: Role,
    pub dek: Dek,
    created: Instant,
}

impl Session {
    fn expired(&self) -> bool {
        self.created.elapsed() > SESSION_TTL
    }
}

#[derive(Default)]
pub struct SessionStore(Mutex<HashMap<String, Session>>);

impl SessionStore {
    pub fn insert(&self, role: Role, dek: Dek) -> String {
        let token = crypto::new_session_token();
        let mut g = self.0.lock().expect("session mutex");
        g.retain(|_, s| !s.expired());
        g.insert(token.clone(), Session { role, dek, created: Instant::now() });
        token
    }

    pub fn remove(&self, token: &str) {
        self.0.lock().expect("session mutex").remove(token);
    }

    /// 토큰을 검증하고 세션에 대해 `f` 를 실행한다. 만료된 토큰은 즉시 제거한다.
    /// 클로저로 감싼 이유: DEK 를 `SessionStore` 밖으로 복사해 내보내지 않기 위해서다.
    pub fn with<T>(&self, token: &str, f: impl FnOnce(&Session) -> Result<T>) -> Result<T> {
        let mut g = self.0.lock().expect("session mutex");
        match g.get(token) {
            None => return Err(AppError::NotAuthenticated),
            Some(s) if s.expired() => {
                g.remove(token);
                return Err(AppError::NotAuthenticated);
            }
            Some(_) => {}
        }
        f(g.get(token).expect("checked above"))
    }

    /// 관리자 전용 커맨드용.
    pub fn with_admin<T>(&self, token: &str, f: impl FnOnce(&Session) -> Result<T>) -> Result<T> {
        self.with(token, |s| match s.role {
            Role::Admin => f(s),
            _ => Err(AppError::Forbidden),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::new_dek;

    #[test]
    fn unknown_token_is_not_authenticated() {
        let store = SessionStore::default();
        let r = store.with("nope", |_| Ok(()));
        assert!(matches!(r, Err(AppError::NotAuthenticated)));
    }

    #[test]
    fn logout_invalidates_token() {
        let store = SessionStore::default();
        let t = store.insert(Role::Admin, new_dek());
        assert!(store.with(&t, |_| Ok(())).is_ok());
        store.remove(&t);
        assert!(matches!(store.with(&t, |_| Ok(())), Err(AppError::NotAuthenticated)));
    }

    #[test]
    fn non_admin_is_forbidden_from_admin_commands() {
        let store = SessionStore::default();
        let t = store.insert(Role::Homeroom { grade: 1, class: 1 }, new_dek());
        assert!(matches!(store.with_admin(&t, |_| Ok(())), Err(AppError::Forbidden)));
        assert!(store.with(&t, |_| Ok(())).is_ok(), "일반 커맨드는 통과");
    }
}
