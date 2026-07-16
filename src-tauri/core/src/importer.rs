//! `scripts/build-data.mjs` 의 Rust 포트. 엑셀/CSV → 학생 파일 + 봉인된 vault.
//!
//! 웹 버전과 다른 점은 하나뿐이다: **반(班)을 버리지 않는다.**
//! 웹 산출물은 학년 단위 집계만 만들어서 "담임은 자기 반만" 을 표현할 수 없었다.
//! 여기서는 반 단위 집계를 함께 만들고, code-map 과 함께 vault 에 봉인한다.
//!
//! 학생 코드 생성은 웹 버전과 같은 순서·같은 해시를 쓴다 → 같은 입력이면 같은 코드가 나온다.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use calamine::{open_workbook_auto, Data, Reader};

use crate::error::{AppError, Result};
use crate::grade::{assign_grades, grade_counts, reach_rate, round1, summary_stats, weighted_total};
use crate::model::*;

const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32자 — 헷갈리는 I/O/0/1 제외

fn fail(msg: impl Into<String>) -> AppError {
    AppError::ImportFailed(msg.into())
}

// ---------------------------------------------------------------- 표 읽기

type Table = Vec<Vec<String>>; // row 0 = 헤더

fn cell_to_string(d: &Data) -> String {
    match d {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            // 엑셀은 정수도 float 으로 준다. "3.0" 대신 "3" 이 되도록.
            if (f.fract()).abs() < f64::EPSILON { format!("{}", *f as i64) } else { f.to_string() }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        // 날짜·에러·빈 칸은 성적 파일에서 쓰지 않는다.
        _ => String::new(),
    }
}

fn read_spreadsheet(path: &Path) -> Result<Table> {
    let mut wb = open_workbook_auto(path).map_err(|e| fail(format!("{}: {e}", path.display())))?;
    let sheet = wb
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| fail(format!("{}: 시트 없음", path.display())))?;
    let range = wb
        .worksheet_range(&sheet)
        .map_err(|e| fail(format!("{}: {e}", path.display())))?;
    Ok(range.rows().map(|r| r.iter().map(cell_to_string).collect()).collect())
}

fn read_csv(path: &Path) -> Result<Table> {
    let text = std::fs::read_to_string(path)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text); // 엑셀이 붙이는 BOM
    Ok(text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.split(',').map(|s| s.trim().to_string()).collect())
        .collect())
}

fn find_subject_file(dir: &Path, name: &str) -> Option<PathBuf> {
    ["xlsx", "xls", "csv"]
        .iter()
        .map(|ext| dir.join(format!("{name}.{ext}")))
        .find(|p| p.exists())
}

fn read_table(path: &Path) -> Result<Table> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("xlsx") | Some("xls") => read_spreadsheet(path),
        _ => read_csv(path),
    }
}

// ---------------------------------------------------------------- 컬럼 인식
// 실제 성적 파일의 열 이름을 몰라도 되도록 별칭 + 정규화로 매칭한다 (웹 버전과 동일 규칙).

fn norm(h: &str) -> String {
    h.chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '(' | ')' | '[' | ']' | '.' | '-' | '_'))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn find_col(headers: &[String], aliases: &[&str]) -> Option<usize> {
    headers.iter().position(|h| {
        let nh = norm(h);
        aliases.iter().any(|a| nh.contains(&norm(a)))
    })
}

// ---------------------------------------------------------------- 코드 생성 (웹 버전과 동일)

fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in s.encode_utf16() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

fn make_code(g: u8, b: u8, n: u16, used: &mut HashSet<String>) -> String {
    let mut salt: u32 = 0;
    loop {
        let mut hv = fnv1a(&format!("{g}|{b}|{n}|{salt}"));
        let mut s = String::new();
        for _ in 0..3 {
            s.push(ALPHABET[(hv % 32) as usize] as char);
            hv /= 32;
        }
        let code = format!("{g}-{s}");
        if used.insert(code.clone()) {
            return code;
        }
        salt += 1;
    }
}

// ---------------------------------------------------------------- 임포트

struct Student {
    g: u8,
    b: u8,
    n: u16,
    code: String,
    /// 과목 id → (요소별 원점수, 총점, 등급)
    subj: BTreeMap<String, SubjScores>,
}

struct SubjScores {
    scores: BTreeMap<String, f64>,
    total: f64,
    grade: u8,
}

pub struct ImportOutput {
    pub meta: Meta,
    pub students: Vec<StudentPayload>,
    pub vault: Vault,
    pub report: ImportReport,
}

/// `dir` 는 `<과목명>.xlsx|xls|csv` 들이 있는 폴더 (웹 버전의 `data/`).
pub fn import(cfg: &AppConfig, dir: &Path) -> Result<ImportOutput> {
    if !dir.is_dir() {
        return Err(fail(format!("폴더가 아님: {}", dir.display())));
    }

    // 삽입 순서를 보존해야 웹 버전과 코드가 같아진다 (충돌 시 salt 증가가 순서에 의존).
    let mut index: HashMap<(u8, u8, u16), usize> = HashMap::new();
    let mut rows_in_order: Vec<(u8, u8, u16, BTreeMap<String, SubjScores>)> = Vec::new();

    for s in &cfg.subjects {
        let Some(file) = find_subject_file(dir, &s.name) else {
            return Err(fail(format!("입력 파일 없음: {}.(xlsx|csv)", s.name)));
        };
        let base = file.file_name().unwrap_or_default().to_string_lossy().to_string();
        let table = read_table(&file)?;
        let Some(headers) = table.first().cloned() else {
            return Err(fail(format!("{base}: 빈 파일")));
        };

        let g_col = find_col(&headers, &["학년", "grade"]).ok_or_else(|| fail(format!("{base}: '학년' 열 없음")))?;
        let b_col = find_col(&headers, &["반", "class", "분반"]);
        let n_col = find_col(&headers, &["번호", "번", "number", "no", "출석번호", "학생번호"])
            .ok_or_else(|| fail(format!("{base}: '번호' 열 없음")))?;

        // 반 정보는 접근 제어의 근간이다. 없으면 담임/교과 구분을 만들 수 없으므로 중단한다.
        let b_col = b_col.ok_or_else(|| {
            fail(format!("{base}: '반' 열 없음 — 담임·교과 권한 구분에 반드시 필요합니다"))
        })?;

        let mut comp_col: BTreeMap<String, usize> = BTreeMap::new();
        for c in s.components.keys() {
            let aliases = [c.clone(), format!("{c}평가"), format!("{c}고사")];
            let refs: Vec<&str> = aliases.iter().map(String::as_str).collect();
            let idx = find_col(&headers, &refs)
                .ok_or_else(|| fail(format!("{base}: 요소 '{c}' 열 없음 (헤더: {})", headers.join(", "))))?;
            comp_col.insert(c.clone(), idx);
        }

        for row in table.iter().skip(1) {
            let cell = |i: usize| row.get(i).map(String::as_str).unwrap_or("");
            let (Ok(g), Ok(n)) = (cell(g_col).parse::<u8>(), cell(n_col).parse::<u16>()) else {
                continue; // 합계 행·빈 행 건너뜀
            };
            let b: u8 = cell(b_col).parse().unwrap_or(0);

            let mut scores = BTreeMap::new();
            for (c, &ci) in &comp_col {
                let v: f64 = cell(ci)
                    .parse()
                    .map_err(|_| fail(format!("{base} {g}-{b}-{n}: 요소 '{c}' 값 없음/오류")))?;
                let max = s.components[c].max;
                if v > max {
                    return Err(fail(format!("{base} {g}-{b}-{n}: '{c}' {v} > 만점 {max}")));
                }
                scores.insert(c.clone(), v);
            }

            let key = (g, b, n);
            let slot = match index.get(&key) {
                Some(&i) => i,
                None => {
                    rows_in_order.push((g, b, n, BTreeMap::new()));
                    let i = rows_in_order.len() - 1;
                    index.insert(key, i);
                    i
                }
            };
            rows_in_order[slot]
                .3
                .insert(s.id.clone(), SubjScores { scores, total: 0.0, grade: 0 });
        }
    }

    if rows_in_order.is_empty() {
        return Err(fail("학생 행이 하나도 없습니다"));
    }

    let mut used = HashSet::new();
    let mut all: Vec<Student> = rows_in_order // 등급 산정 결과를 되써야 해서 mut
        .into_iter()
        .map(|(g, b, n, subj)| Student { g, b, n, code: make_code(g, b, n, &mut used), subj })
        .collect();

    // ---- 학년별 과목 총점·등급 (등급은 언제나 학년 전체 기준으로 매긴다) ----
    let mut grades: Vec<u8> = all.iter().map(|s| s.g).collect();
    grades.sort_unstable();
    grades.dedup();

    let mut cohort_by_grade: BTreeMap<String, GroupNode> = BTreeMap::new();
    let mut cohort_by_class: BTreeMap<String, BTreeMap<String, GroupNode>> = BTreeMap::new();
    let mut grade_cuts: BTreeMap<String, BTreeMap<String, BTreeMap<String, Option<f64>>>> = BTreeMap::new();

    for &g in &grades {
        let members: Vec<usize> = all.iter().enumerate().filter(|(_, s)| s.g == g).map(|(i, _)| i).collect();
        let count = members.len();
        let mut node = GroupNode { count, subjects: BTreeMap::new() };
        let mut cuts_for_grade: BTreeMap<String, BTreeMap<String, Option<f64>>> = BTreeMap::new();

        // 학년 내 반 목록
        let mut class_ids: Vec<u8> = members.iter().map(|&i| all[i].b).collect();
        class_ids.sort_unstable();
        class_ids.dedup();
        let class_node = cohort_by_class.entry(g.to_string()).or_default();
        for &c in &class_ids {
            let cnt = members.iter().filter(|&&i| all[i].b == c).count();
            class_node.insert(c.to_string(), GroupNode { count: cnt, subjects: BTreeMap::new() });
        }

        for s in &cfg.subjects {
            let takers: Vec<usize> = members.iter().copied().filter(|&i| all[i].subj.contains_key(&s.id)).collect();
            if takers.is_empty() {
                continue;
            }

            let totals: Vec<f64> = takers
                .iter()
                .map(|&i| weighted_total(&all[i].subj[&s.id].scores, &s.components))
                .collect();
            let gr = assign_grades(&totals);

            for (k, &i) in takers.iter().enumerate() {
                let e = all[i].subj.get_mut(&s.id).unwrap();
                e.total = totals[k];
                e.grade = gr[k];
            }

            node.subjects.insert(
                s.id.clone(),
                SubjectDist {
                    name: s.name.clone(),
                    totals: totals.iter().copied().map(round1).collect(),
                    grade_counts: grade_counts(&gr),
                    stats: summary_stats(&totals),
                },
            );

            // 등급별 최저점 (학생 탭의 "다음 등급까지 +N점")
            let mut cuts = BTreeMap::new();
            for want in 1u8..=5 {
                let lo = totals
                    .iter()
                    .zip(&gr)
                    .filter(|(_, &g2)| g2 == want)
                    .map(|(&t, _)| t)
                    .fold(f64::INFINITY, f64::min);
                cuts.insert(want.to_string(), if lo.is_finite() { Some(round1(lo)) } else { None });
            }
            cuts_for_grade.insert(s.id.clone(), cuts);

            // 반 단위 집계: 총점은 그 반 학생들 것만, 등급은 학년 기준 그대로 센다.
            for &c in &class_ids {
                let idxs: Vec<usize> = (0..takers.len()).filter(|&k| all[takers[k]].b == c).collect();
                if idxs.is_empty() {
                    continue;
                }
                let c_totals: Vec<f64> = idxs.iter().map(|&k| totals[k]).collect();
                let c_grades: Vec<u8> = idxs.iter().map(|&k| gr[k]).collect();
                cohort_by_class
                    .get_mut(&g.to_string())
                    .unwrap()
                    .get_mut(&c.to_string())
                    .unwrap()
                    .subjects
                    .insert(
                        s.id.clone(),
                        SubjectDist {
                            name: s.name.clone(),
                            totals: c_totals.iter().copied().map(round1).collect(),
                            grade_counts: grade_counts(&c_grades),
                            stats: summary_stats(&c_totals),
                        },
                    );
            }
        }

        cohort_by_grade.insert(g.to_string(), node);
        grade_cuts.insert(g.to_string(), cuts_for_grade);
    }

    // ---- 학생 산출물 (이름·반·번호 없음) ----
    let mut students = Vec::with_capacity(all.len());
    for st in &all {
        let mut subj_out = BTreeMap::new();
        let mut gsum = 0u32;
        let mut n_subj = 0u32;
        for s in &cfg.subjects {
            let Some(d) = st.subj.get(&s.id) else { continue };
            let mut reach = BTreeMap::new();
            let mut comps = BTreeMap::new();
            for (c, meta) in &s.components {
                let score = d.scores[c];
                reach.insert(c.clone(), reach_rate(score, meta.max));
                comps.insert(c.clone(), CompScore { score, weight: meta.weight, max: meta.max });
            }
            subj_out.insert(s.id.clone(), StudentSubject { total: d.total, grade: d.grade, reach, comps });
            gsum += d.grade as u32;
            n_subj += 1;
        }
        students.push(StudentPayload {
            code: st.code.clone(),
            grade: st.g,
            avg: round1(gsum as f64 / n_subj.max(1) as f64),
            subjects: subj_out,
        });
    }

    // ---- 예시 코드 (웹 버전과 같은 규칙: 각 학년에서 고정 인덱스) ----
    let pick = |g: u8, i: usize| -> String {
        let in_grade: Vec<&Student> = all.iter().filter(|s| s.g == g).collect();
        in_grade.get(i).or_else(|| in_grade.first()).map(|s| s.code.clone()).unwrap_or_default()
    };
    let last = *grades.last().unwrap();
    let mid = *grades.get(1).unwrap_or(&grades[0]);
    let first = grades[0];
    let example_codes: Vec<String> = vec![pick(last, 10), pick(mid, 70), pick(first, 130)]
        .into_iter()
        .filter(|c| !c.is_empty())
        .collect();

    let subject_meta: Vec<SubjectMeta> = cfg
        .subjects
        .iter()
        .map(|s| SubjectMeta {
            id: s.id.clone(),
            name: s.name.clone(),
            icon: s.icon.clone(),
            components: s.components.clone(),
        })
        .collect();

    let meta = Meta {
        subjects: subject_meta,
        component_order: cfg.component_order.clone(),
        grades: grades.clone(),
        grade_cuts,
        example_codes: example_codes.clone(),
    };

    let code_map: Vec<CodeMapEntry> = {
        let mut v: Vec<CodeMapEntry> = all
            .iter()
            .map(|s| CodeMapEntry { grade: s.g, class: s.b, num: s.n, code: s.code.clone() })
            .collect();
        v.sort_by_key(|e| (e.grade, e.class, e.num));
        v
    };

    let report = ImportReport {
        students: all.len(),
        grades: grades.clone(),
        subjects: cfg.subjects.len(),
        example_codes,
    };

    Ok(ImportOutput {
        meta,
        students,
        vault: Vault { code_map, grades: cohort_by_grade, classes: cohort_by_class },
        report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_matches_the_js_implementation() {
        // scripts/build-data.mjs 의 fnv1a 와 같은 값이어야 코드가 일치한다.
        assert_eq!(fnv1a(""), 2166136261);
        assert_eq!(fnv1a("a"), 0xe40c292c);
        assert_eq!(fnv1a("foobar"), 0xbf9cf968);
    }

    #[test]
    fn make_code_matches_the_js_builder() {
        // 기대값은 scripts/build-data.mjs 의 makeCode 를 그대로 돌려 얻은 것.
        // 같은 입력이 같은 코드를 내야 웹 빌드로 뽑아 둔 code-map.csv 가 그대로 유효하다.
        let mut used = HashSet::new();
        assert_eq!(make_code(1, 2, 3, &mut used), "1-VEX");
        // 이미 쓰인 코드면 salt 를 올려 다음 후보로 넘어간다.
        assert_eq!(make_code(1, 2, 3, &mut used), "1-A2W");
        assert_eq!(make_code(3, 5, 28, &mut used), "3-FRV");
    }

    #[test]
    fn norm_strips_punctuation_and_case() {
        assert_eq!(norm(" Grade_(1) "), "grade1");
        assert_eq!(norm("중간 고사"), "중간고사");
    }

    #[test]
    fn find_col_matches_by_alias_substring() {
        let headers: Vec<String> = ["학년", "반", "번호", "수행평가", "중간고사"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(find_col(&headers, &["학년", "grade"]), Some(0));
        assert_eq!(find_col(&headers, &["수행", "수행평가"]), Some(3));
        assert_eq!(find_col(&headers, &["중간", "중간평가", "중간고사"]), Some(4));
        assert_eq!(find_col(&headers, &["기말"]), None);
    }

    // ------------------------------------------------------------ 웹 빌더와의 산출물 대조
    //
    // `npm run build` 가 만든 public/data/* 와 이 임포터의 결과가 같은지 본다.
    // 두 구현이 갈리면 (등급 컷, 반올림, 코드 생성 어느 쪽이든) 여기서 잡힌다.
    // 입력 데이터가 없으면(성적 파일은 커밋 안 함) 조용히 건너뛴다.

    /// serde_json 은 정수 58 과 실수 58.0 을 다른 값으로 본다.
    /// 웹 빌더(JS)는 58 로, Rust 는 58.0 으로 쓰므로 숫자는 f64 로 비교한다.
    fn json_eq(a: &serde_json::Value, b: &serde_json::Value, path: &str) {
        use serde_json::Value;
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => {
                let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
                assert!((x - y).abs() < 1e-9, "{path}: {x} != {y}");
            }
            (Value::Object(x), Value::Object(y)) => {
                let xk: Vec<&String> = x.keys().collect();
                let yk: Vec<&String> = y.keys().collect();
                assert_eq!(xk, yk, "{path}: 키 집합 불일치");
                for (k, xv) in x {
                    json_eq(xv, &y[k], &format!("{path}.{k}"));
                }
            }
            (Value::Array(x), Value::Array(y)) => {
                assert_eq!(x.len(), y.len(), "{path}: 길이 불일치");
                for (i, (xv, yv)) in x.iter().zip(y).enumerate() {
                    json_eq(xv, yv, &format!("{path}[{i}]"));
                }
            }
            _ => assert_eq!(a, b, "{path}"),
        }
    }

    #[test]
    fn import_reproduces_the_web_builder_output() {
        // core/ → src-tauri/ → 저장소 루트
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .expect("repo root")
            .to_path_buf();
        let data_dir = repo.join("data");
        let web_students = repo.join("public").join("data").join("students");
        if !data_dir.is_dir() || !web_students.is_dir() {
            eprintln!("skip: data/ 또는 public/data/ 없음 (npm run gen-sample && npm run build)");
            return;
        }

        let cfg: AppConfig =
            serde_json::from_slice(&std::fs::read(repo.join("config").join("subjects.json")).unwrap()).unwrap();
        let out = import(&cfg, &data_dir).unwrap();

        // 학생 수와 코드 집합이 같아야 한다 (코드 생성 로직 일치의 증거).
        let web_codes: HashSet<String> = std::fs::read_dir(&web_students)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".json")).map(String::from))
            .collect();
        let rust_codes: HashSet<String> = out.students.iter().map(|s| s.code.clone()).collect();
        assert_eq!(rust_codes.len(), web_codes.len(), "학생 수 불일치");
        assert_eq!(rust_codes, web_codes, "코드 집합 불일치");

        // 학생별 payload 전체 비교 (총점·등급·도달률·요소 점수).
        for st in &out.students {
            let web: serde_json::Value =
                serde_json::from_slice(&std::fs::read(web_students.join(format!("{}.json", st.code))).unwrap()).unwrap();
            let mine = serde_json::to_value(st).unwrap();
            json_eq(&mine, &web, &st.code);
        }

        // meta.json (등급 컷 포함) 도 비교.
        let web_meta: serde_json::Value =
            serde_json::from_slice(&std::fs::read(repo.join("public").join("data").join("meta.json")).unwrap()).unwrap();
        json_eq(&serde_json::to_value(&out.meta).unwrap(), &web_meta, "meta");

        // 웹 cohort.json 은 학년 단위. vault 의 학년 노드와 같아야 한다.
        let web_cohort: serde_json::Value =
            serde_json::from_slice(&std::fs::read(repo.join("public").join("data").join("cohort.json")).unwrap()).unwrap();
        json_eq(
            &serde_json::to_value(&out.vault.grades).unwrap(),
            &web_cohort["grades"],
            "cohort.grades",
        );

        // 반 단위 집계는 웹에 없던 것 — 존재하고, 반별 인원 합이 학년 인원과 맞는지 본다.
        for (g, by_class) in &out.vault.classes {
            let sum: usize = by_class.values().map(|n| n.count).sum();
            assert_eq!(sum, out.vault.grades[g].count, "{g}학년: 반 인원 합 != 학년 인원");
            assert!(by_class.len() > 1, "{g}학년: 반이 하나뿐이면 권한 분리 검증이 안 됨");
        }
    }
}
