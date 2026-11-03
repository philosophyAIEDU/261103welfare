// 수집 캐시 → 공통 형식 서비스 목록
import path from 'node:path';
import { CACHE_DIR } from '../config.mjs';
import { readJson, hashText } from './store.mjs';
import { normalizeLocal, normalizeCentral } from './datago.mjs';

export function loadServices() {
  const out = [];
  for (const [kind, norm] of [
    ['local', normalizeLocal],
    ['central', normalizeCentral],
  ]) {
    const cache = readJson(path.join(CACHE_DIR, `${kind}.json`), {});
    for (const e of Object.values(cache)) {
      if (!e.active || !e.detail) continue; // 상세가 아직 없으면 판정 불가 → 다음 실행에서
      const s = norm(e.item, e.detail);
      s.firstSeen = e.firstSeen;
      s.hash = hashText(s.name, s.targetText, s.criteriaText, s.benefitText);
      out.push(s);
    }
  }
  return out;
}

/** 아직 상세를 받지 못한 사업 수 (진행 상황 표시용) */
export function pendingCount() {
  let n = 0;
  for (const kind of ['local', 'central']) {
    const cache = readJson(path.join(CACHE_DIR, `${kind}.json`), {});
    for (const e of Object.values(cache)) if (e.active && !e.detail) n++;
  }
  return n;
}
