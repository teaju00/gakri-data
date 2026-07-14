import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.window = {};
require('../assets/charts.js');
const GK = global.window.GK;

test('summaryStats: 평균/모집단표준편차/min/max', () => {
  const r = GK.summaryStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.n, 8);
  assert.equal(r.mean, 5);
  assert.ok(Math.abs(r.sd - 2) < 1e-9);
  assert.equal(r.min, 2);
  assert.equal(r.max, 9);
});

test('summaryStats: 사분위(선형보간)', () => {
  const r = GK.summaryStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.q1, 4);
  assert.equal(r.median, 4.5);
});

test('summaryStats: n=1 특수 케이스', () => {
  const r = GK.summaryStats([42]);
  assert.equal(r.n, 1);
  assert.equal(r.mean, 42);
  assert.equal(r.sd, 0);
  assert.equal(r.q1, 42);
  assert.equal(r.median, 42);
  assert.equal(r.q3, 42);
});

test('combineClassNodes: count 합산 + totals 이어붙임 + gradeCounts 요소별 합산', () => {
  const nodeA = { count: 2, subjects: { kor: { name: '국어', totals: [70, 80], gradeCounts: [0, 1, 1, 0, 0, 0] } } };
  const nodeB = { count: 3, subjects: { kor: { name: '국어', totals: [60, 65, 90], gradeCounts: [0, 0, 1, 1, 1, 0] } } };
  const combined = GK.combineClassNodes([nodeA, nodeB]);
  assert.equal(combined.count, 5);
  assert.deepEqual(combined.subjects.kor.totals, [70, 80, 60, 65, 90]);
  assert.deepEqual(combined.subjects.kor.gradeCounts, [0, 1, 2, 1, 1, 0]);
  assert.equal(combined.subjects.kor.stats.n, 5);
  assert.equal(combined.subjects.kor.name, '국어');
});

test('combineClassNodes: 한 반에만 있는 과목도 합집합으로 포함', () => {
  const nodeA = { count: 2, subjects: { kor: { name: '국어', totals: [70, 80], gradeCounts: [0, 1, 1, 0, 0, 0] } } };
  const nodeB = { count: 3, subjects: {} };
  const combined = GK.combineClassNodes([nodeA, nodeB]);
  assert.equal(combined.count, 5);
  assert.deepEqual(combined.subjects.kor.totals, [70, 80]);
});

test('combineClassNodes: undefined 반(노드 없음)은 건너뜀', () => {
  const nodeA = { count: 2, subjects: { kor: { name: '국어', totals: [70, 80], gradeCounts: [0, 1, 1, 0, 0, 0] } } };
  const combined = GK.combineClassNodes([nodeA, undefined]);
  assert.equal(combined.count, 2);
  assert.deepEqual(combined.subjects.kor.totals, [70, 80]);
});

test('combineClassNodes: 빈 배열이면 count 0, subjects 빈 객체', () => {
  const combined = GK.combineClassNodes([]);
  assert.equal(combined.count, 0);
  assert.deepEqual(combined.subjects, {});
});
