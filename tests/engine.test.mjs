// 실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, ageOn, incomePct } from '../docs/js/engine.js';
import { heuristicRules } from '../scripts/lib/heuristic.mjs';
import { parseXml, asArray } from '../scripts/lib/xml.mjs';

const standards = { medianIncome: { bySize: { 1: 2564238, 2: 4199292 } } };
const baseRules = {
  ageMin: null, ageMax: null, gender: 'any', householdTypes: [], residenceMonthsMin: null,
  incomeMaxMedianPct: null, statusAllOf: [], statusAnyOf: [], otherConditions: [], evidence: '', confidence: 0.9,
};
const svc = (rules, extra = {}) => ({ id: 'X', src: 'C', name: '테스트', rules: { ...baseRules, ...rules }, ...extra });
const mom = {
  birthDate: '1950-03-10', gender: 'female', sido: '서울특별시', sigungu: '종로구', household: 'single', householdSize: 1,
  basicPension: 'yes', basicLivelihood: 'no', nearPoor: 'unknown', ltcGrade: 'unknown', disability: 'unknown', veteran: 'no',
  incomeMonthly: 1000000, residenceSince: '2020-01',
};
const T = '2026-11-03';

test('만 나이 계산', () => {
  assert.equal(ageOn('1950-03-10', T), 76);
  assert.equal(ageOn('1950-12-10', T), 75);
  assert.equal(ageOn('', T), null);
});

test('나이·가구·기초연금 모두 충족 → 가능성 높음', () => {
  const r = judge(svc({ ageMin: 65, householdTypes: ['single'], statusAllOf: ['basicPension'] }), mom, standards, T);
  assert.equal(r.status, 'likely');
});

test('나이 미달 → 해당 없음', () => {
  assert.equal(judge(svc({ ageMin: 80 }), mom, standards, T).status, 'no');
});

test('다른 지역 지자체 사업 → 해당 없음, 같은 시도 전체 사업 → 통과', () => {
  assert.equal(judge(svc({}, { src: 'L', ctpv: '서울특별시', sgg: '중구' }), mom, standards, T).status, 'no');
  assert.equal(judge(svc({}, { src: 'L', ctpv: '서울특별시', sgg: '' }), mom, standards, T).status, 'likely');
  assert.equal(judge(svc({}, { src: 'L', ctpv: '서울특별시', sgg: '종로구' }), mom, standards, T).status, 'likely');
});

test('하나만 충족하면 되는 조건: 하나 true면 통과, 모름만 있으면 확인 필요', () => {
  assert.equal(judge(svc({ statusAnyOf: ['basicLivelihood', 'basicPension'] }), mom, standards, T).status, 'likely');
  const r = judge(svc({ statusAnyOf: ['basicLivelihood', 'nearPoor'] }), mom, standards, T);
  assert.equal(r.status, 'check');
  assert.deepEqual(r.missing, ['nearPoor']);
});

test('소득 기준: 100만원 / 1인 중위 256만원 = 39% → 50% 이하 충족, 30% 이하 미충족', () => {
  assert.ok(Math.abs(incomePct(mom, standards) - 39) < 1);
  assert.equal(judge(svc({ incomeMaxMedianPct: 50 }), mom, standards, T).status, 'likely');
  assert.equal(judge(svc({ incomeMaxMedianPct: 30 }), mom, standards, T).status, 'no');
});

test('기계로 판정 못하는 조건이나 낮은 신뢰도 → 확인 필요', () => {
  assert.equal(judge(svc({ otherConditions: ['치매 진단'] }), mom, standards, T).status, 'check');
  assert.equal(judge(svc({ confidence: 0.4 }), mom, standards, T).status, 'check');
});

test('거주 기간 조건', () => {
  assert.equal(judge(svc({ residenceMonthsMin: 12 }), mom, standards, T).status, 'likely');
  assert.equal(judge(svc({ residenceMonthsMin: 12 }), { ...mom, residenceSince: '2026-08' }, standards, T).status, 'no');
});

test('종료된 사업 → 해당 없음', () => {
  assert.equal(judge(svc({}, { end: '20251231' }), mom, standards, T).status, 'no');
  assert.equal(judge(svc({}, { end: '99991231' }), mom, standards, T).status, 'likely');
});

test('간이 추출기', () => {
  const r = heuristicRules({ targetText: '관내 1년 이상 거주하는 만 65세 이상 독거노인 중 기초생활수급자 또는 차상위계층', criteriaText: '', target: [] });
  assert.equal(r.ageMin, 65);
  assert.equal(r.residenceMonthsMin, 12);
  assert.deepEqual(r.householdTypes, ['single']);
  assert.deepEqual(r.statusAnyOf.sort(), ['basicLivelihood', 'nearPoor']);
});

test('XML 파서: 반복 태그 배열, 엔티티 해석', () => {
  const doc = parseXml('<?xml version="1.0"?><r><a>1 &amp; 2&#13;</a><l><n>x</n></l><l><n>y</n></l></r>');
  assert.equal(doc.r.a, '1 & 2');
  assert.deepEqual(asArray(doc.r.l).map((x) => x.n), ['x', 'y']);
});
