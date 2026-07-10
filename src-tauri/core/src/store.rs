//! 디스크 레이아웃과 입출력. DB 없이 파일만 쓴다.
//!
//! <appDataDir>/
//!   meta.json              평문 — 과목 메타. 개인정보 없음.
//!   students/<CODE>.json   평문 — 코드 하나의 점수. 이름·반·번호 없음(재식별 불가).
//!   teachers.json          평문 — 계정 + salt + 감싼 DEK. 비밀 자체는 없음.
//!   vault.enc              AES-256-GCM — code-map(재식별 연결고리) + 반 단위 집계.
//!
//! 왜 학생 파일은 평문인가: 학생 탭은 로그인 없이 자기 코드로 조회한다(웹 버전과 동일).
//! 그 파일에는 코드와 점수뿐이라 code-map 없이는 누구인지 알 수 없다. 그래서 code-map 만 봉인한다.

use std::fs;
use std::path::{Path, PathBuf};

use crate::crypto::{self, Dek};
use crate::error::{AppError, Result};
use crate::model::{Meta, StudentPayload, TeacherFile, Vault};

pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    /// `root` 는 앱 데이터 폴더. 어디인지는 호출자(Tauri 레이어)가 정한다 —
    /// 이 크레이트가 Tauri 를 알 필요가 없도록.
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("students"))?;
        Ok(Self { root })
    }

    pub fn meta(&self) -> PathBuf { self.root.join("meta.json") }
    pub fn students_dir(&self) -> PathBuf { self.root.join("students") }
    pub fn teachers(&self) -> PathBuf { self.root.join("teachers.json") }
    pub fn vault(&self) -> PathBuf { self.root.join("vault.enc") }
}

/// 부분 쓰기로 파일이 깨지지 않도록 임시 파일에 쓰고 교체한다.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------- 학생 코드

/// 코드는 파일 이름이 된다. 경로 조작(`../`)과 임의 파일 읽기를 막기 위해
/// 빌더가 만드는 형식(`<학년>-<3자 코드>`)만 통과시킨다.
pub fn validate_code(code: &str) -> Result<()> {
    let bad = |why: &str| Err(AppError::InvalidInput(format!("코드 형식: {why}")));
    if code.is_empty() || code.len() > 12 {
        return bad("길이");
    }
    let Some((grade, suffix)) = code.split_once('-') else {
        return bad("구분자 없음");
    };
    if grade.is_empty() || !grade.chars().all(|c| c.is_ascii_digit()) {
        return bad("학년");
    }
    if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return bad("코드 문자");
    }
    Ok(())
}

// ---------------------------------------------------------------- 평문 파일

pub fn read_meta(p: &Paths) -> Result<Meta> {
    let raw = fs::read(p.meta()).map_err(|_| AppError::NotProvisioned)?;
    Ok(serde_json::from_slice(&raw)?)
}

pub fn write_meta(p: &Paths, meta: &Meta) -> Result<()> {
    write_atomic(&p.meta(), &serde_json::to_vec(meta)?)
}

pub fn read_student(p: &Paths, code: &str) -> Result<StudentPayload> {
    validate_code(code)?;
    let raw = fs::read(p.students_dir().join(format!("{code}.json"))).map_err(|_| AppError::NotFound)?;
    Ok(serde_json::from_slice(&raw)?)
}

pub fn write_student(p: &Paths, s: &StudentPayload) -> Result<()> {
    validate_code(&s.code)?;
    write_atomic(&p.students_dir().join(format!("{}.json", s.code)), &serde_json::to_vec(s)?)
}

pub fn clear_students(p: &Paths) -> Result<()> {
    let dir = p.students_dir();
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    fs::create_dir_all(&dir)?;
    Ok(())
}

pub fn read_teachers(p: &Paths) -> Result<TeacherFile> {
    match fs::read(p.teachers()) {
        Ok(raw) => Ok(serde_json::from_slice(&raw)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(TeacherFile::default()),
        Err(e) => Err(e.into()),
    }
}

pub fn write_teachers(p: &Paths, t: &TeacherFile) -> Result<()> {
    write_atomic(&p.teachers(), &serde_json::to_vec_pretty(t)?)
}

pub fn is_provisioned(p: &Paths) -> bool {
    read_teachers(p).map(|t| !t.teachers.is_empty()).unwrap_or(false)
}

// ---------------------------------------------------------------- 봉인된 vault

pub fn read_vault(p: &Paths, dek: &Dek) -> Result<Vault> {
    let blob = match fs::read(p.vault()) {
        Ok(b) => b,
        // 계정은 있으나 아직 성적을 임포트하지 않은 상태.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vault::default()),
        Err(e) => return Err(e.into()),
    };
    let plain = crypto::open(dek, &blob)?;
    Ok(serde_json::from_slice(plain.as_slice())?)
}

pub fn write_vault(p: &Paths, dek: &Dek, v: &Vault) -> Result<()> {
    let plain = serde_json::to_vec(v)?;
    let blob = crypto::seal(dek, &plain)?;
    write_atomic(&p.vault(), &blob)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_codes_pass() {
        assert!(validate_code("1-22B").is_ok());
        assert!(validate_code("3-K7Q").is_ok());
    }

    #[test]
    fn path_traversal_is_rejected() {
        assert!(validate_code("../../etc/passwd").is_err());
        assert!(validate_code("1-../x").is_err());
        assert!(validate_code("1-a/b").is_err());
    }

    #[test]
    fn malformed_codes_are_rejected() {
        assert!(validate_code("").is_err());
        assert!(validate_code("abc").is_err(), "구분자 없음");
        assert!(validate_code("-ABC").is_err(), "학년 없음");
        assert!(validate_code("1-").is_err(), "코드 없음");
        assert!(validate_code("1-abc").is_err(), "소문자");
        assert!(validate_code("1-AAAAAAAAAAAAAA").is_err(), "길이 초과");
    }
}
