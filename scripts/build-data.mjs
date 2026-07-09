// 빌드: data/<과목>.csv + config/subjects.json → public/data/ 산출물.
//  - public/data/meta.json              : 과목 메타 + 예시코드 (공개)
//  - public/data/students/<CODE>.json   : 코드별 본인 데이터만 (공개, 반/번호/이름 없음)
//  - public/data/cohort.json            : 학년·과목별 분포/통계 (교사용, 암호 후 로드)
//  - code-map.csv                       : 학년/반/번호 ↔ 코드 (교사 오프라인 보관, 배포·커밋 금지)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import XLSX from 'xlsx'; // CJS 기본 export = SheetJS 전체 객체 (readFile/utils)
import { reachRate, weightedTotal, assignGrades, gradeCounts, summaryStats } from './grade.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(readFileSync(path.join(root, 'config', 'subjects.json'), 'utf8'));
const subjects = cfg.subjects;
const round1 = (v) => Math.round(v * 10) / 10;

// ---- 입력 읽기 (xlsx/csv) + 유연한 컬럼 인식 ----
// 실제 성적 파일 형태(열 이름)를 몰라도 되도록 별칭·정규화로 매칭. 이름 등 불필요 열은 무시.
function parseCsv(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const header = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(s => s.trim());
    const row = {}; header.forEach((h, i) => { row[h] = cells[i]; }); return row;
  });
}
function readRows(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  return parseCsv(file);
}
// 과목 파일 찾기: <과목>.xlsx 우선, 없으면 .xls, .csv
function findSubjectFile(name) {
  for (const ext of ['.xlsx', '.xls', '.csv']) {
    const f = path.join(root, 'data', name + ext);
    if (existsSync(f)) return f;
  }
  return null;
}
const norm = (h) => String(h).replace(/[\s()[\].\-_]/g, '').toLowerCase();
const ID_ALIASES = {
  grade: ['학년', 'grade'],
  cls: ['반', 'class', '분반'],
  num: ['번호', '번', 'number', 'no', '출석번호', '학생번호'],
};
function findCol(headers, aliases) {
  for (const h of headers) { const nh = norm(h); if (aliases.some(a => nh.includes(norm(a)))) return h; }
  return null;
}

// ---- 학생 코드 (학년/반/번호로부터 안정적 생성) ----
const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const used = new Set();
function fnv1a(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function makeCode(g, b, n) {
  let salt = 0, code;
  do {
    let hv = fnv1a(`${g}|${b}|${n}|${salt}`);
    let s = '';
    for (let i = 0; i < 3; i++) { s += AL[hv % 32]; hv = Math.floor(hv / 32); }
    code = `${g}-${s}`;
    salt++;
  } while (used.has(code));
  used.add(code);
  return code;
}

// ---- 학생 수집 (과목 파일들을 학년/반/번호로 병합) ----
const map = new Map();
for (const s of subjects) {
  const file = findSubjectFile(s.name);
  if (!file) throw new Error(`입력 파일 없음: data/${s.name}.(xlsx|csv) — npm run gen-sample 로 데모 생성 가능`);
  const base = path.basename(file);
  const rows = readRows(file);
  if (!rows.length) throw new Error(`${base}: 빈 파일`);
  const headers = Object.keys(rows[0]);
  const gCol = findCol(headers, ID_ALIASES.grade);
  const bCol = findCol(headers, ID_ALIASES.cls);
  const nCol = findCol(headers, ID_ALIASES.num);
  if (!gCol || !nCol) throw new Error(`${base}: '학년'/'번호' 열을 못 찾음 (헤더: ${headers.join(', ')})`);
  const comps = Object.keys(s.components);
  const compCol = {};
  for (const c of comps) {
    compCol[c] = findCol(headers, [c, c + '평가', c + '고사']);
    if (!compCol[c]) throw new Error(`${base}: 요소 '${c}' 열을 못 찾음 (헤더: ${headers.join(', ')})`);
  }
  for (const row of rows) {
    const g = +row[gCol], b = bCol ? +row[bCol] : 0, n = +row[nCol];
    if (Number.isNaN(g) || Number.isNaN(n)) continue; // 헤더 외 합계/빈 행 skip
    const key = `${g}|${b}|${n}`;
    if (!map.has(key)) map.set(key, { g, b, n, subj: {} });
    const scores = {};
    for (const c of comps) {
      const v = +row[compCol[c]];
      if (Number.isNaN(v)) throw new Error(`${base} ${key}: 요소 '${c}' 값 없음/오류`);
      if (v > s.components[c].max) throw new Error(`${base} ${key}: '${c}' ${v} > 만점 ${s.components[c].max}`);
      scores[c] = v;
    }
    map.get(key).subj[s.id] = { scores };
  }
}
const all = [...map.values()];
all.forEach(st => { st.code = makeCode(st.g, st.b, st.n); });

// ---- 학년별 과목 총점·등급·분포 ----
const grades = [...new Set(all.map(st => st.g))].sort((a, b) => a - b);
const byGrade = {};
grades.forEach(g => { byGrade[g] = all.filter(st => st.g === g); });

const cohort = {};
for (const g of grades) {
  cohort[g] = { count: byGrade[g].length, subjects: {} };
  for (const s of subjects) {
    const totals = byGrade[g].map(st => weightedTotal(st.subj[s.id].scores, s.components));
    const gr = assignGrades(totals);
    byGrade[g].forEach((st, i) => { st.subj[s.id].total = totals[i]; st.subj[s.id].grade = gr[i]; });
    cohort[g].subjects[s.id] = { name: s.name, totals: totals.map(round1), gradeCounts: gradeCounts(gr), stats: summaryStats(totals) };
  }
}

// ---- 산출물 쓰기 ----
const outDir = path.join(root, 'public', 'data');
const stuDir = path.join(outDir, 'students');
rmSync(stuDir, { recursive: true, force: true });
mkdirSync(stuDir, { recursive: true });

for (const st of all) {
  const subjOut = {};
  let gsum = 0;
  for (const s of subjects) {
    const d = st.subj[s.id];
    const reach = {}, comps = {};
    for (const [c, meta] of Object.entries(s.components)) {
      reach[c] = reachRate(d.scores[c], meta.max);
      comps[c] = { score: d.scores[c], weight: meta.weight, max: meta.max };
    }
    subjOut[s.id] = { total: d.total, grade: d.grade, reach, comps };
    gsum += d.grade;
  }
  const payload = { code: st.code, grade: st.g, avg: round1(gsum / subjects.length), subjects: subjOut };
  writeFileSync(path.join(stuDir, st.code + '.json'), JSON.stringify(payload));
}

const subjMeta = subjects.map(s => ({ id: s.id, name: s.name, icon: s.icon, components: s.components }));
const pick = (g, i) => (byGrade[g][i] || byGrade[g][0]).code;
const meta = {
  subjects: subjMeta,
  componentOrder: cfg.componentOrder,
  grades,
  exampleCodes: [pick(grades[grades.length - 1], 10), pick(grades[1] ?? grades[0], 70), pick(grades[0], 130)],
};
writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 0));
writeFileSync(path.join(outDir, 'cohort.json'), JSON.stringify({ subjects: subjMeta.map(s => ({ id: s.id, name: s.name, icon: s.icon })), componentOrder: cfg.componentOrder, grades: cohort }));

// 교사 오프라인용 코드맵 (배포/커밋 금지 — .gitignore 처리됨)
const mapLines = ['학년,반,번호,코드', ...all.slice().sort((a, b) => a.g - b.g || a.b - b.b || a.n - b.n).map(st => `${st.g},${st.b},${st.n},${st.code}`)];
writeFileSync(path.join(root, 'code-map.csv'), '﻿' + mapLines.join('\r\n') + '\r\n', 'utf8');

console.log(`빌드 완료: ${all.length}명, 학년 ${grades.join('/')}, 과목 ${subjects.length}`);
console.log(`  → public/data/students/*.json (${all.length}), meta.json, cohort.json`);
console.log(`  → code-map.csv (교사 보관용, 비공개)`);
console.log(`  예시코드: ${meta.exampleCodes.join(', ')}`);
