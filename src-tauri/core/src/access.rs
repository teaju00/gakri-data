//! 접근 제어. **여기를 통과한 데이터만 프론트로 나간다.**
//!
//! 웹 버전은 cohort.json 전체를 브라우저에 내려주고 UI 에서 가렸다 — 네트워크 탭을 열면 다 보였다.
//! 여기서는 걸러낸 뒤에 직렬화한다. 프론트는 볼 수 없는 데이터를 애초에 받지 못한다.

use std::collections::BTreeMap;

use crate::model::{GroupNode, Role, Scope, SubjectDist, Vault};

/// 역할이 실제로 볼 수 있는 학년·반·과목. vault 에 존재하는 것만 남긴다.
pub fn scope_for(role: &Role, vault: &Vault) -> Scope {
    let mut scope = Scope::default();
    for (g_key, classes) in &vault.classes {
        let Ok(g) = g_key.parse::<u8>() else { continue };
        let mut visible: Vec<u8> = Vec::new();
        for (c_key, node) in classes {
            let Ok(c) = c_key.parse::<u8>() else { continue };
            if node.subjects.keys().any(|sid| role.can_view(g, c, sid)) {
                visible.push(c);
            }
        }
        if !visible.is_empty() {
            visible.sort_unstable();
            scope.grades.push(g);
            scope.classes.insert(g_key.clone(), visible);
        }
    }
    scope.grades.sort_unstable();
    scope.subjects = match role {
        Role::Admin | Role::Homeroom { .. } => None, // 전 과목
        Role::Subject { assignments } => {
            let mut v: Vec<String> = assignments.iter().map(|a| a.subject.clone()).collect();
            v.sort();
            v.dedup();
            Some(v)
        }
    };
    scope
}

/// 반 단위 집계에서 허용된 (학년, 반, 과목) 만 남긴 사본.
pub fn visible_classes(role: &Role, vault: &Vault) -> BTreeMap<String, BTreeMap<String, GroupNode>> {
    let mut out: BTreeMap<String, BTreeMap<String, GroupNode>> = BTreeMap::new();
    for (g_key, by_class) in &vault.classes {
        let Ok(g) = g_key.parse::<u8>() else { continue };
        for (c_key, node) in by_class {
            let Ok(c) = c_key.parse::<u8>() else { continue };
            let subjects: BTreeMap<String, SubjectDist> = node
                .subjects
                .iter()
                .filter(|(sid, _)| role.can_view(g, c, sid))
                .map(|(sid, d)| (sid.clone(), d.clone()))
                .collect();
            if subjects.is_empty() {
                continue;
            }
            out.entry(g_key.clone())
                .or_default()
                .insert(c_key.clone(), GroupNode { count: node.count, subjects });
        }
    }
    out
}

/// 학년 단위 집계는 다른 반 학생이 섞인 분포다. 담임에게 주면 "자기 반만" 이 무너지므로
/// 관리자에게만 준다.
pub fn visible_grades(role: &Role, vault: &Vault) -> BTreeMap<String, GroupNode> {
    match role {
        Role::Admin => vault.grades.clone(),
        _ => BTreeMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grade::SummaryStats;
    use crate::model::Assignment;

    fn dist() -> SubjectDist {
        SubjectDist {
            name: "수학".into(),
            totals: vec![50.0, 60.0],
            grade_counts: [0, 0, 1, 1, 0, 0],
            stats: SummaryStats { n: 2, mean: 55.0, sd: 5.0, min: 50.0, q1: 52.5, median: 55.0, q3: 57.5, max: 60.0 },
        }
    }

    fn vault() -> Vault {
        let node = |sids: &[&str]| GroupNode {
            count: 2,
            subjects: sids.iter().map(|s| (s.to_string(), dist())).collect(),
        };
        let mut g1 = BTreeMap::new();
        g1.insert("1".to_string(), node(&["kor", "mat"]));
        g1.insert("2".to_string(), node(&["kor", "mat"]));
        let mut g2 = BTreeMap::new();
        g2.insert("1".to_string(), node(&["kor", "mat"]));

        let mut classes = BTreeMap::new();
        classes.insert("1".to_string(), g1);
        classes.insert("2".to_string(), g2);

        let mut grades = BTreeMap::new();
        grades.insert("1".to_string(), node(&["kor", "mat"]));
        grades.insert("2".to_string(), node(&["kor", "mat"]));

        Vault { code_map: vec![], grades, classes }
    }

    #[test]
    fn homeroom_scope_covers_own_class_all_subjects() {
        let s = scope_for(&Role::Homeroom { grade: 1, class: 2 }, &vault());
        assert_eq!(s.grades, vec![1]);
        assert_eq!(s.classes.get("1").unwrap(), &vec![2]);
        assert!(s.classes.get("2").is_none(), "다른 학년은 범위 밖");
        assert!(s.subjects.is_none(), "담임은 전 과목");
    }

    #[test]
    fn homeroom_payload_contains_only_own_class() {
        let v = visible_classes(&Role::Homeroom { grade: 1, class: 2 }, &vault());
        assert_eq!(v.len(), 1);
        let g1 = &v["1"];
        assert_eq!(g1.keys().collect::<Vec<_>>(), vec!["2"], "1반 데이터가 응답에 없어야 함");
        assert_eq!(g1["2"].subjects.len(), 2, "자기 반은 전 과목");
    }

    #[test]
    fn subject_teacher_payload_contains_only_assigned_subject() {
        let role = Role::Subject {
            assignments: vec![Assignment { grade: 1, class: 1, subject: "mat".into() }],
        };
        let v = visible_classes(&role, &vault());
        assert_eq!(v.len(), 1);
        assert_eq!(v["1"].keys().collect::<Vec<_>>(), vec!["1"], "2반 차단");
        assert_eq!(v["1"]["1"].subjects.keys().collect::<Vec<_>>(), vec!["mat"], "국어 차단");

        let s = scope_for(&role, &vault());
        assert_eq!(s.subjects.as_deref(), Some(&["mat".to_string()][..]));
    }

    #[test]
    fn unassigned_teacher_sees_nothing() {
        let role = Role::Subject {
            assignments: vec![Assignment { grade: 9, class: 9, subject: "mat".into() }],
        };
        assert!(scope_for(&role, &vault()).grades.is_empty());
        assert!(visible_classes(&role, &vault()).is_empty());
    }

    #[test]
    fn grade_wide_distribution_is_admin_only() {
        let v = vault();
        assert!(visible_grades(&Role::Admin, &v).len() == 2);
        assert!(visible_grades(&Role::Homeroom { grade: 1, class: 2 }, &v).is_empty());
        assert!(
            visible_grades(&Role::Subject { assignments: vec![] }, &v).is_empty(),
            "학년 전체 분포는 다른 반이 섞여 있다"
        );
    }

    #[test]
    fn admin_sees_every_class_and_subject() {
        let v = visible_classes(&Role::Admin, &vault());
        assert_eq!(v["1"].len(), 2);
        assert_eq!(v["2"].len(), 1);
    }
}
