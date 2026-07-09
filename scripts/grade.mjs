// 성적 계산 순수함수 모듈 (단위 테스트 대상: grade.test.mjs)
// 브라우저/Node 공용 — 외부 의존성 없음.

const round1 = (v) => Math.round(v * 10) / 10;

/** 도달률(%) = 점수 / 만점 × 100 */
export function reachRate(score, max) {
  if (!max) return 0;
  return round1((score / max) * 100);
}

/**
 * 과목 총점(반영) = Σ (요소점수 / 요소만점 × 반영비율).
 * components: { 요소명: { weight, max } }, 비율 합 100 → 결과 0~100.
 */
export function weightedTotal(scores, components) {
  let t = 0;
  for (const k of Object.keys(components)) {
    const { weight, max } = components[k];
    t += (scores[k] / max) * weight;
  }
  return round1(t);
}

/**
 * 상대 석차등급 5등급.
 * 누적비율 컷 1등급 ≤10, 2 ≤34, 3 ≤66, 4 ≤90, 5 나머지.
 * 동점은 평균석차로 같은 등급 부여. 입력 순서 보존해 배열 반환.
 */
export function assignGrades(totals) {
  const n = totals.length;
  const order = totals.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v);
  const out = new Array(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && order[j + 1].v === order[k].v) j++;
    const avgRank = ((k + 1) + (j + 1)) / 2;
    const cum = (avgRank / n) * 100;
    const g = cum <= 10 ? 1 : cum <= 34 ? 2 : cum <= 66 ? 3 : cum <= 90 ? 4 : 5;
    for (let t = k; t <= j; t++) out[order[t].i] = g;
    k = j + 1;
  }
  return out;
}

/** 등급별 인원 카운트. 반환 배열 index 1~5 사용(0 미사용). */
export function gradeCounts(grades) {
  const c = [0, 0, 0, 0, 0, 0];
  for (const g of grades) c[g]++;
  return c;
}

const percentile = (sorted, p) => {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx), frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
};

/** 기술통계: 평균, 모집단 표준편차, min/q1/median/q3/max (사분위=선형보간 type7) */
export function summaryStats(values) {
  const n = values.length;
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    min: sorted[0],
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q3: percentile(sorted, 0.75),
    max: sorted[n - 1],
  };
}
