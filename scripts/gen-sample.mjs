// 데모용 성적 파일 생성기.
// 실제 교사 파일이 없을 때 data/<과목>.csv 를 시드 RNG로 만들어 파이프라인을 돌려볼 수 있게 함.
// 컬럼: 학년,반,번호,<해당 과목이 쓰는 요소들>. 요소 원점수는 각 요소 만점 이하.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(readFileSync(path.join(root, 'config', 'subjects.json'), 'utf8'));

function mkRng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = mkRng(20240708);
const norm = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// 학년 구성: 5반 × 28명 = 140명/학년
const cohortDef = [{ g: 1, ban: 5, num: 28 }, { g: 2, ban: 5, num: 28 }, { g: 3, ban: 5, num: 28 }];

const students = [];
for (const { g, ban, num } of cohortDef) {
  for (let b = 1; b <= ban; b++) {
    for (let n = 1; n <= num; n++) {
      const a = norm(); // 학생 잠재 능력 (과목 공통)
      const scores = {};
      for (const s of cfg.subjects) {
        if (cfg.grade_subjects && cfg.grade_subjects[g] && !cfg.grade_subjects[g].includes(s.id)) continue;
        scores[s.id] = {};
        for (const [comp, meta] of Object.entries(s.components)) {
          const raw = clamp(Math.round(meta.max * (0.72 + 0.14 * (a + 0.35 * norm()))), 0, meta.max);
          scores[s.id][comp] = raw;
        }
      }
      students.push({ g, b, n, scores });
    }
  }
}

mkdirSync(path.join(root, 'data'), { recursive: true });
for (const s of cfg.subjects) {
  const comps = Object.keys(s.components);
  const header = ['학년', '반', '번호', ...comps];
  const lines = [header.join(',')];
  for (const st of students) {
    if (!st.scores[s.id]) continue;
    lines.push([st.g, st.b, st.n, ...comps.map(c => st.scores[s.id][c])].join(','));
  }
  const csv = '﻿' + lines.join('\r\n') + '\r\n'; // BOM + CRLF (엑셀 호환)
  writeFileSync(path.join(root, 'data', s.name + '.csv'), csv, 'utf8');
}

console.log(`생성: ${students.length}명 × ${cfg.subjects.length}과목 → data/*.csv`);
