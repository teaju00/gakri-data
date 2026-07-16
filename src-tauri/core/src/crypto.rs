//! 로컬 저장 암호화. DB 를 쓰지 않으므로 민감 데이터는 파일 하나를 AEAD 로 봉인해 둔다.
//!
//! 키 구조 (envelope):
//!   - DEK (data encryption key, 32B 랜덤): vault.enc 를 실제로 암·복호화한다. 디스크에 평문으로 없다.
//!   - KEK (key encryption key): 교사 비밀번호 + 개인 salt → Argon2id.
//!   - teachers.json 에는 교사마다 `KEK 로 감싼 DEK` 만 저장한다.
//!
//! 따라서
//!   - 비밀번호 해시를 따로 둘 필요가 없다. 잘못된 비밀번호는 AEAD 태그 검증에서 실패한다.
//!   - 교사 추가/삭제가 데이터 재암호화 없이 끝난다 (DEK 를 새 KEK 로 다시 감싸기만).
//!   - 비밀번호가 없으면 vault.enc 는 복구 불가. 백업은 vault.enc + teachers.json 을 함께 떠야 한다.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, Result};

pub const DEK_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

/// OWASP 2024 권장 하한 (19 MiB, 2 iterations, 1 lane).
const ARGON2_M_COST: u32 = 19_456;
const ARGON2_T_COST: u32 = 2;
const ARGON2_P_COST: u32 = 1;

pub type Dek = Zeroizing<[u8; DEK_LEN]>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub salt: String, // hex
    #[serde(default = "default_m")]
    pub m: u32,
    #[serde(default = "default_t")]
    pub t: u32,
    #[serde(default = "default_p")]
    pub p: u32,
}
fn default_m() -> u32 { ARGON2_M_COST }
fn default_t() -> u32 { ARGON2_T_COST }
fn default_p() -> u32 { ARGON2_P_COST }

/// KEK 로 감싼 DEK. nonce 는 감쌀 때마다 새로 뽑는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedDek {
    pub nonce: String, // hex
    pub ct: String,    // hex
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut b = vec![0u8; n];
    OsRng.fill_bytes(&mut b);
    b
}

pub fn new_dek() -> Dek {
    let mut k = [0u8; DEK_LEN];
    OsRng.fill_bytes(&mut k);
    Zeroizing::new(k)
}

pub fn new_kdf_params() -> KdfParams {
    KdfParams {
        salt: hex::encode(random_bytes(SALT_LEN)),
        m: ARGON2_M_COST,
        t: ARGON2_T_COST,
        p: ARGON2_P_COST,
    }
}

fn derive_kek(password: &str, kdf: &KdfParams) -> Result<Zeroizing<[u8; 32]>> {
    let salt = hex::decode(&kdf.salt).map_err(|_| AppError::Internal("bad salt hex".into()))?;
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(32))
        .map_err(|e| AppError::Internal(format!("argon2 params: {e}")))?;
    let a2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut kek = [0u8; 32];
    a2.hash_password_into(password.as_bytes(), &salt, &mut kek)
        .map_err(|e| AppError::Internal(format!("argon2: {e}")))?;
    Ok(Zeroizing::new(kek))
}

fn cipher(key: &[u8; 32]) -> Aes256Gcm {
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key))
}

/// 임의 바이트를 봉인. 반환은 `nonce || ciphertext` 단일 블롭.
pub fn seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>> {
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher(key)
        .encrypt(nonce, plaintext)
        .map_err(|_| AppError::Internal("seal failed".into()))?;
    let mut out = nonce_bytes;
    out.extend_from_slice(&ct);
    Ok(out)
}

/// `nonce || ciphertext` 를 연다. 태그 불일치(변조·잘못된 키)면 Err.
pub fn open(key: &[u8; 32], blob: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if blob.len() < NONCE_LEN + 16 {
        return Err(AppError::Internal("vault too short".into()));
    }
    let (nonce_bytes, ct) = blob.split_at(NONCE_LEN);
    let pt = cipher(key)
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|_| AppError::BadCredentials)?;
    Ok(Zeroizing::new(pt))
}

pub fn wrap_dek(password: &str, kdf: &KdfParams, dek: &Dek) -> Result<WrappedDek> {
    let kek = derive_kek(password, kdf)?;
    let blob = seal(&kek, dek.as_slice())?;
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    Ok(WrappedDek { nonce: hex::encode(nonce), ct: hex::encode(ct) })
}

/// 비밀번호 검증과 DEK 복원이 동시에 일어난다. 실패 = 비밀번호 불일치.
pub fn unwrap_dek(password: &str, kdf: &KdfParams, wrapped: &WrappedDek) -> Result<Dek> {
    let kek = derive_kek(password, kdf)?;
    let mut blob = hex::decode(&wrapped.nonce).map_err(|_| AppError::Internal("bad nonce hex".into()))?;
    blob.extend_from_slice(&hex::decode(&wrapped.ct).map_err(|_| AppError::Internal("bad ct hex".into()))?);

    let pt = open(&kek, &blob)?;
    if pt.len() != DEK_LEN {
        return Err(AppError::Internal("dek length".into()));
    }
    let mut dek = [0u8; DEK_LEN];
    dek.copy_from_slice(pt.as_slice());
    Ok(Zeroizing::new(dek))
}

/// 세션 토큰. 추측 불가능해야 하므로 CSPRNG 32바이트.
pub fn new_session_token() -> String {
    hex::encode(random_bytes(32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_roundtrip() {
        let key = [7u8; 32];
        let blob = seal(&key, b"hello").unwrap();
        assert_eq!(open(&key, &blob).unwrap().as_slice(), b"hello");
    }

    #[test]
    fn open_rejects_wrong_key() {
        let blob = seal(&[7u8; 32], b"hello").unwrap();
        assert!(open(&[8u8; 32], &blob).is_err());
    }

    #[test]
    fn open_rejects_tampered_ciphertext() {
        let key = [7u8; 32];
        let mut blob = seal(&key, b"hello").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(open(&key, &blob).is_err());
    }

    #[test]
    fn wrapped_dek_roundtrips_and_rejects_bad_password() {
        // 테스트 속도를 위해 최소 파라미터 사용 (운영 기본값은 19MiB/2/1).
        let kdf = KdfParams { salt: hex::encode([1u8; 16]), m: 8, t: 1, p: 1 };
        let dek = new_dek();
        let wrapped = wrap_dek("correct horse", &kdf, &dek).unwrap();

        let got = unwrap_dek("correct horse", &kdf, &wrapped).unwrap();
        assert_eq!(got.as_ref(), dek.as_ref());

        match unwrap_dek("wrong", &kdf, &wrapped) {
            Err(AppError::BadCredentials) => {}
            other => panic!("expected BadCredentials, got {other:?}"),
        }
    }

    #[test]
    fn session_tokens_are_unique() {
        assert_ne!(new_session_token(), new_session_token());
    }
}
