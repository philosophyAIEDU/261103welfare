// 1단계: 복지서비스 목록·상세 수집 (증분)
// 실행: DATA_GO_KR_KEY=... node scripts/fetch.mjs
import path from 'node:path';
import { config, CACHE_DIR } from './config.mjs';
import { DataGoClient } from './lib/datago.mjs';
import { readJson, writeJson, today } from './lib/store.mjs';

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function syncKind(client, kind, cap) {
  const file = path.join(CACHE_DIR, `${kind}.json`);
  const cache = readJson(file, {});
  const now = today();
  const seen = new Set();

  for await (const { items, total } of client.listPages(kind, config.lifeArray, config.pageSize)) {
    for (const item of items) {
      if (!item?.servId) continue;
      seen.add(item.servId);
      const e = (cache[item.servId] ??= { firstSeen: now });
      e.item = item;
      e.lastSeen = now;
      e.active = true;
    }
    process.stdout.write(`\r[${kind}] 목록 ${seen.size}/${total}`);
  }
  console.log();
  for (const [id, e] of Object.entries(cache)) if (!seen.has(id)) e.active = false;

  // 상세가 없거나 바뀐 사업만 다시 받음
  const queue = Object.entries(cache)
    .filter(([, e]) => e.active)
    .filter(([, e]) =>
      kind === 'local'
        ? !e.detail || e.detailFor !== (e.item.lastModYmd || '')
        : !e.detail || !e.detailAt || daysBetween(e.detailAt, now) >= config.centralRefreshDays,
    )
    .sort(([, a], [, b]) => Number(!!a.detail) - Number(!!b.detail)); // 처음 받는 것 우선

  let done = 0;
  for (const [id, e] of queue.slice(0, cap)) {
    try {
      e.detail = await client.detail(kind, id);
      e.detailFor = e.item.lastModYmd || '';
      e.detailAt = now;
      done++;
      process.stdout.write(`\r[${kind}] 상세 ${done}/${Math.min(cap, queue.length)} (대기 ${queue.length})`);
    } catch (err) {
      console.error(`\n[${kind}] ${id} 상세 실패: ${err.message}`);
      if (err.fatal) break; // 인증 오류·트래픽 초과 등은 즉시 중단
    }
  }
  console.log();
  writeJson(file, cache);
  return { kind, active: seen.size, detailFetched: done, remaining: Math.max(0, queue.length - done) };
}

async function main() {
  if (!config.dataGoKrKey) {
    console.warn('DATA_GO_KR_KEY가 설정되지 않아 수집을 건너뜁니다. (기존 캐시로 계속 진행)');
    return;
  }
  const client = new DataGoClient(config.dataGoKrKey);
  const results = [];
  for (const [kind, cap] of [
    ['local', config.localDetailCap],
    ['central', config.centralDetailCap],
  ]) {
    try {
      results.push(await syncKind(client, kind, cap));
    } catch (err) {
      console.error(`[${kind}] 수집 실패: ${err.message}`);
    }
  }
  console.table(results);
  console.log('API 호출 수', client.calls);
}

main();
