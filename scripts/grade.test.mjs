import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachRate, weightedTotal, assignGrades, gradeCounts, summaryStats } from './grade.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('reachRate: 점수/만점 백분율', () => {
  close(reachRate(40, 40), 100);
  close(reachRate(75, 100), 75);
  close(reachRate(0, 100), 0);
  close(reachRate(45, 60), 75); // 45/60 = 75%
});

test('weightedTotal: Σ(도달률×반영비율), 요소별 만점 반영', () => {
  const cfg = { '수행': { weight: 40, max: 40 }, '중간': { weight: 30, max: 100 }, '기말': { weight: 30, max: 100 } };
  close(weightedTotal({ '수행': 40, '중간': 100, '기말': 100 }, cfg), 100);
  close(weightedTotal({ '수행': 20, '중간': 50, '기말': 50 }, cfg), 50); // 전부 절반
  // 수행만 보는 과목
  const peOnly = { '수행': { weight: 100, max: 100 } };
  close(weightedTotal({ '수행': 80 }, peOnly), 80);
  // 수행+기말, 수행 만점이 60인 과목
  const mus = { '수행': { weight: 60, max: 60 }, '기말': { weight: 40, max: 100 } };
  close(weightedTotal({ '수행': 60, '기말': 100 }, mus), 100);
  close(weightedTotal({ '수행': 30, '기말': 50 }, mus), 50);
});

test('assignGrades: 100명 균등분포 → 누적 10/34/66/90/100% 컷', () => {
  // 100..1 내림차순 (서로 다른 값)
  const totals = Array.from({ length: 100 }, (_, i) => 100 - i);
  const g = assignGrades(totals);
  // 상위 10명(값 100~91) = 1등급
  assert.equal(g[0], 1);   // 100점, rank1
  assert.equal(g[9], 1);   // 91점, rank10 → cum 10 → 1등급
  assert.equal(g[10], 2);  // 90점, rank11 → cum 11 → 2등급
  assert.equal(g[33], 2);  // rank34 → cum 34 → 2등급
  assert.equal(g[34], 3);  // rank35 → 3등급
  assert.equal(g[65], 3);  // rank66 → 3등급
  assert.equal(g[66], 4);  // rank67 → 4등급
  assert.equal(g[89], 4);  // rank90 → 4등급
  assert.equal(g[90], 5);  // rank91 → 5등급
  assert.equal(g[99], 5);  // 꼴찌 → 5등급
});

test('assignGrades: 동점은 평균석차로 같은 등급', () => {
  // 10명 전원 동점 → 평균석차 5.5 → cum 55% → 3등급
  const g = assignGrades([50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
  assert.deepEqual(g, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
});

test('assignGrades: 입력 순서와 무관하게 값 기준으로 부여', () => {
  const g = assignGrades([1, 100, 50]); // n=3
  // 100 → rank1 → cum 33.3 → 2등급, 50 → rank2 → cum 66.7 → 4등급, 1 → rank3 → cum100 → 5등급
  assert.equal(g[1], 2); // 100
  assert.equal(g[2], 4); // 50
  assert.equal(g[0], 5); // 1
});

test('gradeCounts: 등급별 인원 [_,1,2,3,4,5]', () => {
  const c = gradeCounts([1, 1, 2, 3, 5, 5, 5]);
  assert.deepEqual(c, [0, 2, 1, 1, 0, 3]); // index0 미사용
});

test('summaryStats: 평균/표준편차(모집단)/사분위(선형보간)', () => {
  const s = summaryStats([1, 2, 3, 4, 5]);
  close(s.mean, 3);
  close(s.median, 3);
  close(s.min, 1);
  close(s.max, 5);
  close(s.q1, 2);
  close(s.q3, 4);
  close(s.sd, Math.sqrt(2)); // 모집단 분산 2
});
