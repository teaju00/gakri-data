//! 디스크/IPC 를 오가는 자료형. 웹 버전(`scripts/build-data.mjs`) 이 만드는 JSON 모양을
//! 그대로 따른다 — 프론트 코드를 두 벌 유지하지 않기 위해서다.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::crypto::{KdfParams, WrappedDek};
use crate::grade::{Components, SummaryStats};

// ---------------------------------------------------------------- config/subjects.json

#[derive(Debug, Clone, Deserialize)]
pub struct SubjectConfig {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub components: Components,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    #[serde(rename = "componentOrder")]
    pub component_order: Vec<String>,
    pub subjects: Vec<SubjectConfig>,
}

// ---------------------------------------------------------------- meta.json (공개)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubjectMeta {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub components: Components,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub subjects: Vec<SubjectMeta>,
    #[serde(rename = "componentOrder")]
    pub component_order: Vec<String>,
    pub grades: Vec<u8>,
    /// 학년 → 과목 → 등급(1..5) → 해당 등급 최저점. 학생 탭의 "다음 등급까지 +N점" 계산용.
    #[serde(rename = "gradeCuts")]
    pub grade_cuts: BTreeMap<String, BTreeMap<String, BTreeMap<String, Option<f64>>>>,
    #[serde(rename = "exampleCodes")]
    pub example_codes: Vec<String>,
}

// ---------------------------------------------------------------- students/<CODE>.json (공개)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentSubject {
    pub total: f64,
    pub grade: u8,
    pub reach: BTreeMap<String, f64>,
    pub comps: BTreeMap<String, CompScore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompScore {
    pub score: f64,
    pub weight: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentPayload {
    pub code: String,
    pub grade: u8,
    pub avg: f64,
    pub subjects: BTreeMap<String, StudentSubject>,
}

// ---------------------------------------------------------------- vault.enc (암호화)

/// 학년/반/번호 ↔ 코드. **이 앱에서 가장 민감한 자료** — 유일하게 학생을 재식별할 수 있는 연결고리.
/// 평문으로 디스크에 두지 않는다. (웹 버전의 code-map.csv 에 해당.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeMapEntry {
    pub grade: u8,
    pub class: u8,
    pub num: u16,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubjectDist {
    pub name: String,
    pub totals: Vec<f64>,
    #[serde(rename = "gradeCounts")]
    pub grade_counts: [u32; 6],
    pub stats: SummaryStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupNode {
    pub count: usize,
    pub subjects: BTreeMap<String, SubjectDist>,
}

/// 반 단위 집계까지 담는다. 웹 버전 cohort.json 은 학년 단위만 있었다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Vault {
    #[serde(rename = "codeMap")]
    pub code_map: Vec<CodeMapEntry>,
    pub grades: BTreeMap<String, GroupNode>,
    pub classes: BTreeMap<String, BTreeMap<String, GroupNode>>,
}

// ---------------------------------------------------------------- teachers.json (평문, 비밀 없음)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assignment {
    pub grade: u8,
    pub class: u8,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Role {
    /// 데이터 임포트와 교사 계정 관리 담당. 전체 조회 가능.
    Admin,
    /// 담임: 자기 반의 전 과목.
    Homeroom { grade: u8, class: u8 },
    /// 교과교사: 배정된 (학년, 반, 과목) 조합만.
    Subject { assignments: Vec<Assignment> },
}

impl Role {
    pub fn tag(&self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Homeroom { .. } => "homeroom",
            Role::Subject { .. } => "subject",
        }
    }

    /// 접근 제어의 단일 판정 지점. 커맨드는 반드시 이 함수를 통과한 데이터만 내보낸다.
    pub fn can_view(&self, grade: u8, class: u8, subject: &str) -> bool {
        match self {
            Role::Admin => true,
            Role::Homeroom { grade: g, class: c } => *g == grade && *c == class,
            Role::Subject { assignments } => assignments
                .iter()
                .any(|a| a.grade == grade && a.class == class && a.subject == subject),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherRecord {
    pub username: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub role: Role,
    pub kdf: KdfParams,
    #[serde(rename = "wrappedDek")]
    pub wrapped_dek: WrappedDek,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TeacherFile {
    pub teachers: Vec<TeacherRecord>,
}

// ---------------------------------------------------------------- IPC DTO

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Scope {
    pub grades: Vec<u8>,
    /// 학년(문자열 키) → 볼 수 있는 반 목록.
    pub classes: BTreeMap<String, Vec<u8>>,
    /// None = 전 과목.
    pub subjects: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDto {
    pub token: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub role: &'static str,
    pub scope: Scope,
}

/// 프론트가 받는 코호트. Rust 가 이미 역할대로 잘라낸 결과만 들어 있다.
#[derive(Debug, Clone, Serialize)]
pub struct CohortView {
    pub subjects: Vec<SubjectMeta>,
    #[serde(rename = "componentOrder")]
    pub component_order: Vec<String>,
    pub grades: BTreeMap<String, GroupNode>,
    pub classes: BTreeMap<String, BTreeMap<String, GroupNode>>,
    pub scope: Scope,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportReport {
    pub students: usize,
    pub grades: Vec<u8>,
    pub subjects: usize,
    #[serde(rename = "exampleCodes")]
    pub example_codes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewTeacher {
    pub username: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub password: String,
    pub role: Role,
}

#[derive(Debug, Clone, Serialize)]
pub struct TeacherSummary {
    pub username: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub role: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_sees_everything() {
        assert!(Role::Admin.can_view(1, 1, "kor"));
        assert!(Role::Admin.can_view(3, 5, "mat"));
    }

    #[test]
    fn homeroom_is_limited_to_own_class_across_all_subjects() {
        let r = Role::Homeroom { grade: 3, class: 2 };
        assert!(r.can_view(3, 2, "kor"));
        assert!(r.can_view(3, 2, "mat"));
        assert!(!r.can_view(3, 1, "kor"), "다른 반 차단");
        assert!(!r.can_view(2, 2, "kor"), "다른 학년 차단");
    }

    #[test]
    fn subject_teacher_is_limited_to_assigned_class_and_subject() {
        let r = Role::Subject {
            assignments: vec![
                Assignment { grade: 1, class: 3, subject: "mat".into() },
                Assignment { grade: 2, class: 1, subject: "mat".into() },
            ],
        };
        assert!(r.can_view(1, 3, "mat"));
        assert!(r.can_view(2, 1, "mat"));
        assert!(!r.can_view(1, 3, "kor"), "담당 아닌 과목 차단");
        assert!(!r.can_view(1, 2, "mat"), "담당 아닌 반 차단");
        assert!(!r.can_view(3, 1, "mat"), "담당 아닌 학년 차단");
    }
}
