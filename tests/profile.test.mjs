// 실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeElder, sanitizeState, safeUrl, dropUnconsentedSensitive, isValidId } from '../docs/js/profile.js';

const empty = () => ({ settings: { role: '', name: '', org: '', fontScale: 'normal', notify: false }, elders: [], actions: {}, seen: {}, notified: {} });

test('본인 등록(subject=self) 정보 유지', () => {
  const e = sanitizeElder({ id: 'eabc123', subject: 'self', nickname: '홍길동', birthDate: '1950-01-02', consent: { method: 'self', at: '2026-11-01T00:00:00Z' } });
  assert.equal(e.subject, 'self');
  assert.equal(e.consent.method, 'self');
  assert.equal(e.consent.sensitive, false);
});

test('모르는 subject는 보호자 등록으로', () => {
  assert.equal(sanitizeElder({ nickname: '어머니', subject: 'admin' }).subject, 'guardian');
});

test('HTML·잘못된 값 제거', () => {
  const e = sanitizeElder({ id: '"><img src=x onerror=alert(1)>', nickname: '<b>엄마</b>', household: '<x>', ltcGrade: 9, householdSize: -1, incomeMonthly: 'abc', basicPension: 'maybe' });
  assert.equal(e.id, undefined);
  assert.ok(!/[<>]/.test(e.nickname));
  assert.equal(e.household, '');
  assert.equal(e.ltcGrade, 'unknown');
  assert.equal(e.householdSize, '');
  assert.equal(e.incomeMonthly, '');
  assert.equal(e.basicPension, 'unknown');
});

test('이름이 없으면 거부', () => {
  assert.equal(sanitizeElder({ nickname: '   ' }), null);
  assert.equal(sanitizeElder(null), null);
});

test('민감정보 동의 없으면 장애·보훈 값 버림', () => {
  const e = dropUnconsentedSensitive(sanitizeElder({ nickname: 'a', disability: 'yes', veteran: 'no', consent: { sensitive: false } }));
  assert.equal(e.disability, 'unknown');
  assert.equal(e.veteran, 'unknown');
});

test('http(s) 링크만 허용', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl('/relative'), '');
  assert.equal(safeUrl('https://www.bokjiro.go.kr/a?b=1'), 'https://www.bokjiro.go.kr/a?b=1');
});

test('백업 복원: 잘못된 항목 정리, __proto__ 무시', () => {
  const raw = JSON.parse(`{"settings":{"role":"self","fontScale":"huge"},"elders":[{"id":"eabc123","nickname":"나","subject":"self"},{"id":"eabc123","nickname":"중복"},{"nickname":"id없음"}],
    "actions":{"eabc123":{"WLF1":{"status":"applied"},"<x>":{"status":"applied"},"WLF2":{"status":"hack"}},"__proto__":{"x":1},"eother":{}},
    "seen":{"eabc123":["WLF1","<x>",3]}}`);
  const s = sanitizeState(raw, empty);
  assert.equal(s.settings.role, 'self');
  assert.equal(s.settings.fontScale, 'normal');
  assert.equal(s.elders.length, 1);
  assert.deepEqual(Object.keys(s.actions), ['eabc123']);
  assert.deepEqual(Object.keys(s.actions.eabc123), ['WLF1']);
  assert.deepEqual(s.seen.eabc123, ['WLF1']);
  assert.equal({}.x, undefined);
});

test('id 형식', () => {
  assert.ok(isValidId('e' + Date.now().toString(36) + 'ab12'));
  assert.ok(!isValidId('../x'));
});
