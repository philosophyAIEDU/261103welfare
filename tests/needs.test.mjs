import test from 'node:test';
import assert from 'node:assert/strict';
import { needsOf, matchedNeeds } from '../docs/js/needs.js';

const svc = (id, name, easy = '', tags = []) => ({ id, name, easy, tags });

test('사업명·설명으로 분야를 나눈다', () => {
  assert.ok(needsOf(svc('a', '노인 무릎인공관절 수술비 지원')).includes('medical'));
  assert.ok(needsOf(svc('b', '저소득 재가노인 식사배달사업', '도시락을 배달해 드립니다')).includes('care'));
  assert.ok(needsOf(svc('c', '장수수당 지급')).includes('living'));
  assert.ok(needsOf(svc('d', '저소득층 난방비 지원')).includes('housing'));
  assert.ok(needsOf(svc('e', '실버가요제')).includes('culture'));
  assert.ok(needsOf(svc('f', '노인일자리 및 사회활동 지원')).includes('work'));
  assert.ok(needsOf(svc('g', '독거노인 응급안전안심서비스')).includes('safety'));
});

test('복지로 관심주제 태그도 쓴다', () => {
  assert.deepEqual(needsOf(svc('h', '○○사업', '', ['문화·여가'])), ['culture']);
});

test('체크한 분야 중 해당하는 것만 돌려준다', () => {
  const s = svc('i', '어르신 틀니 시술비 및 안부 확인');
  assert.deepEqual(matchedNeeds(s, ['medical', 'culture']), ['medical']);
  assert.deepEqual(matchedNeeds(s, []), []);
  assert.deepEqual(matchedNeeds(s, undefined), []);
});
