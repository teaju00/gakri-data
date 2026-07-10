//! `scripts/grade.mjs` 의 Rust 포트. 외부 의존성 없는 순수 함수.
//! 웹 버전과 결과가 갈리면 안 되므로 `scripts/grade.test.mjs` 의 케이스를 그대로 옮겨 검증한다.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 과목 요소 맵. **삽입 순서(= JSON 선언 순서)를 지킨다.** `weighted_total` 참고.
pub type Components = IndexMap<String, Component>;

pub fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// 도달률(%) = 점수 / 만점 × 100
pub fn reach_rate(score: f64, max: f64) -> f64 {
    if max == 0.0 {
        return 0.0;
    }
    round1((score / max) * 100.0)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Component {
    pub weight: f64,
    pub max: f64,
}

/// 과목 총점 = Σ (요소점수 / 요소만점 × 반영비율). 비율 합 100 → 0~100.
///
/// 더하는 **순서가 결과를 바꾼다.** f64 덧셈은 결합법칙이 성립하지 않아 마지막 비트가 달라지고,
/// 반올림 경계(x.x5)에서 0.1 이 갈린다. 그래서 `components` 는 순서를 지키는 `Components`(IndexMap)이고,
/// 웹 빌더가 `Object.keys()` 로 도는 순서(= subjects.json 선언 순서)와 같아야 한다.
pub fn weighted_total(scores: &BTreeMap<String, f64>, components: &Components) -> f64 {
    let mut t = 0.0;
    for (name, c) in components {
        let s = scores.get(name).copied().unwrap_or(0.0);
        t += (s / c.max) * c.weight;
    }
    round1(t)
}

/// 상대 석차등급 5등급. 누적비율 컷 1등급 ≤10, 2 ≤34, 3 ≤66, 4 ≤90, 5 나머지.
/// 동점은 평균석차로 같은 등급. 입력 순서를 보존해 반환.
pub fn assign_grades(totals: &[f64]) -> Vec<u8> {
    let n = totals.len();
    let mut out = vec![0u8; n];
    if n == 0 {
        return out;
    }

    // 값 내림차순 정렬 (동점 그룹을 인접시키기 위함).
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| totals[b].partial_cmp(&totals[a]).unwrap_or(std::cmp::Ordering::Equal));

    let mut k = 0usize;
    while k < n {
        let mut j = k;
        while j + 1 < n && totals[order[j + 1]] == totals[order[k]] {
            j += 1;
        }
        // 1-based 석차의 평균 (동점자 전원에게 동일 적용).
        let avg_rank = ((k + 1) + (j + 1)) as f64 / 2.0;
        let cum = (avg_rank / n as f64) * 100.0;
        let g: u8 = if cum <= 10.0 {
            1
        } else if cum <= 34.0 {
            2
        } else if cum <= 66.0 {
            3
        } else if cum <= 90.0 {
            4
        } else {
            5
        };
        for t in k..=j {
            out[order[t]] = g;
        }
        k = j + 1;
    }
    out
}

/// 등급별 인원. index 1~5 사용, 0 은 미사용(웹 버전과 배열 모양 동일).
pub fn grade_counts(grades: &[u8]) -> [u32; 6] {
    let mut c = [0u32; 6];
    for &g in grades {
        if (1..=5).contains(&g) {
            c[g as usize] += 1;
        }
    }
    c
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    let n = sorted.len();
    if n == 1 {
        return sorted[0];
    }
    let idx = p * (n - 1) as f64;
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    let frac = idx - lo as f64;
    sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryStats {
    pub n: usize,
    pub mean: f64,
    pub sd: f64,
    pub min: f64,
    pub q1: f64,
    pub median: f64,
    pub q3: f64,
    pub max: f64,
}

/// 기술통계. 표준편차는 **모집단** 기준(웹 버전과 동일). 사분위는 선형보간(type 7).
pub fn summary_stats(values: &[f64]) -> SummaryStats {
    let n = values.len();
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mean = sorted.iter().sum::<f64>() / n as f64;
    let variance = sorted.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n as f64;
    SummaryStats {
        n,
        mean,
        sd: variance.sqrt(),
        min: sorted[0],
        q1: percentile(&sorted, 0.25),
        median: percentile(&sorted, 0.5),
        q3: percentile(&sorted, 0.75),
        max: sorted[n - 1],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }

    fn comps(pairs: &[(&str, f64, f64)]) -> Components {
        pairs
            .iter()
            .map(|(k, weight, max)| ((*k).to_string(), Component { weight: *weight, max: *max }))
            .collect()
    }
    fn scores(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), *v)).collect()
    }

    #[test]
    fn reach_rate_is_percent_of_max() {
        close(reach_rate(40.0, 40.0), 100.0);
        close(reach_rate(75.0, 100.0), 75.0);
        close(reach_rate(0.0, 100.0), 0.0);
        close(reach_rate(45.0, 60.0), 75.0);
    }

    #[test]
    fn weighted_total_respects_per_component_max() {
        let cfg = comps(&[("수행", 40.0, 40.0), ("중간", 30.0, 100.0), ("기말", 30.0, 100.0)]);
        close(weighted_total(&scores(&[("수행", 40.0), ("중간", 100.0), ("기말", 100.0)]), &cfg), 100.0);
        close(weighted_total(&scores(&[("수행", 20.0), ("중간", 50.0), ("기말", 50.0)]), &cfg), 50.0);

        let pe_only = comps(&[("수행", 100.0, 100.0)]);
        close(weighted_total(&scores(&[("수행", 80.0)]), &pe_only), 80.0);

        let mus = comps(&[("수행", 60.0, 60.0), ("기말", 40.0, 100.0)]);
        close(weighted_total(&scores(&[("수행", 60.0), ("기말", 100.0)]), &mus), 100.0);
        close(weighted_total(&scores(&[("수행", 30.0), ("기말", 50.0)]), &mus), 50.0);
    }

    /// 실데이터(학생 1-58F, 수학)에서 잡힌 회귀.
    /// 선언순(수행·중간·기말)으로 더하면 67.0, 사전순(기말·수행·중간)이면 66.9.
    /// 웹 빌더는 `Object.keys()` 순서 = 선언순으로 돈다.
    #[test]
    fn weighted_total_depends_on_declaration_order() {
        let sc = scores(&[("수행", 19.0), ("중간", 69.0), ("기말", 68.0)]);

        let declared = comps(&[("수행", 30.0, 30.0), ("중간", 35.0, 100.0), ("기말", 35.0, 100.0)]);
        assert_eq!(weighted_total(&sc, &declared), 67.0);

        let alphabetical = comps(&[("기말", 35.0, 100.0), ("수행", 30.0, 30.0), ("중간", 35.0, 100.0)]);
        assert_eq!(weighted_total(&sc, &alphabetical), 66.9, "순서가 바뀌면 결과가 갈린다");
    }

    #[test]
    fn assign_grades_cuts_at_10_34_66_90() {
        let totals: Vec<f64> = (0..100).map(|i| (100 - i) as f64).collect();
        let g = assign_grades(&totals);
        assert_eq!(g[0], 1);
        assert_eq!(g[9], 1);
        assert_eq!(g[10], 2);
        assert_eq!(g[33], 2);
        assert_eq!(g[34], 3);
        assert_eq!(g[65], 3);
        assert_eq!(g[66], 4);
        assert_eq!(g[89], 4);
        assert_eq!(g[90], 5);
        assert_eq!(g[99], 5);
    }

    #[test]
    fn assign_grades_ties_share_average_rank() {
        let g = assign_grades(&[50.0; 10]);
        assert_eq!(g, vec![3; 10]);
    }

    #[test]
    fn assign_grades_ignores_input_order() {
        let g = assign_grades(&[1.0, 100.0, 50.0]);
        assert_eq!(g[1], 2);
        assert_eq!(g[2], 4);
        assert_eq!(g[0], 5);
    }

    #[test]
    fn grade_counts_indexes_one_through_five() {
        assert_eq!(grade_counts(&[1, 1, 2, 3, 5, 5, 5]), [0, 2, 1, 1, 0, 3]);
    }

    #[test]
    fn summary_stats_uses_population_sd_and_linear_quartiles() {
        let s = summary_stats(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        close(s.mean, 3.0);
        close(s.median, 3.0);
        close(s.min, 1.0);
        close(s.max, 5.0);
        close(s.q1, 2.0);
        close(s.q3, 4.0);
        close(s.sd, 2f64.sqrt());
    }
}
