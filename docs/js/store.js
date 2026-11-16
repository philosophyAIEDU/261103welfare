// 모든 개인정보는 이 기기(브라우저) 안에만 저장됩니다. 서버로 보내지 않습니다.
import { sanitizeState, isValidId } from './profile.js';

const KEY = 'hyodo.v1';

const empty = () => ({
  settings: { role: '', name: '', org: '', fontScale: 'normal', notify: false },
  elders: [],
  actions: {}, // { elderId: { servId: { status, at } } }
  seen: {}, // { elderId: [servId] }  '새 소식' 확인 처리
  notified: {}, // { elderId: [servId] }  알림 보낸 것
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return sanitizeState(JSON.parse(raw), empty);
  } catch {
    return empty();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('이 브라우저에서는 저장할 수 없습니다. (사생활 보호 모드인지 확인해 주세요)');
  }
}

export const getState = () => state;

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
}

export const getElder = (id) => state.elders.find((e) => e.id === id);

export function saveElder(elder) {
  if (!isValidId(elder?.id)) throw new Error('잘못된 어르신 정보입니다.');
  const i = state.elders.findIndex((e) => e.id === elder.id);
  if (i >= 0) state.elders[i] = elder;
  else state.elders.push(elder);
  save();
}

export function deleteElder(id) {
  state.elders = state.elders.filter((e) => e.id !== id);
  delete state.actions[id];
  delete state.seen[id];
  delete state.notified[id];
  save();
}

export function setAction(elderId, servId, status) {
  if (!getElder(elderId)) return;
  const a = (state.actions[elderId] ??= {});
  if (!status) delete a[servId];
  else a[servId] = { status, at: new Date().toISOString() };
  save();
}

export const getActions = (elderId) => state.actions[elderId] || {};

export function markSeen(elderId, ids) {
  if (!getElder(elderId)) return;
  const set = new Set(state.seen[elderId] || []);
  ids.forEach((id) => set.add(id));
  state.seen[elderId] = [...set];
  save();
}

export const getSeen = (elderId) => new Set(state.seen[elderId] || []);

export function markNotified(elderId, ids) {
  if (!getElder(elderId)) return;
  const set = new Set(state.notified[elderId] || []);
  ids.forEach((id) => set.add(id));
  state.notified[elderId] = [...set];
  save();
}

export const getNotified = (elderId) => new Set(state.notified[elderId] || []);

export function exportAll() {
  return JSON.stringify({ app: 'hyodo-alim', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 1);
}

export function importAll(json) {
  let s;
  try {
    s = JSON.parse(json);
  } catch {
    throw new Error('백업 파일을 읽을 수 없습니다.');
  }
  if (s?.app !== 'hyodo-alim') throw new Error('효도알림 백업 파일이 아닙니다.');
  state = sanitizeState(s, empty);
  save();
  return state.elders.length;
}

export function clearAll() {
  state = empty();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 저장소 사용 불가 */
  }
}

export const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
