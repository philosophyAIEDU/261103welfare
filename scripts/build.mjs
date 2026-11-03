// 3단계: 앱이 읽는 정적 데이터 생성 → docs/data/services.json, meta.json
import path from 'node:path';
import { config, CACHE_DIR, PUBLIC_DATA_DIR } from './config.mjs';
import { loadServices, pendingCount } from './lib/services.mjs';
import { readJson, writeJson } from './lib/store.mjs';

const clip = (s, n) => {
  const t = (s || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const isSidoWide = (sgg) => !sgg || sgg === '-' || /교육청/.test(sgg);

function main() {
  const rules = readJson(path.join(CACHE_DIR, 'rules.json'), {});
  const services = loadServices();
  const out = [];
  let ai = 0;

  for (const s of services) {
    const r = rules[s.id];
    if (!r?.rules) continue;
    if (r.lite?.hash === s.hash && r.lite.relevant === false) continue; // 어르신과 무관
    if (r.by === 'gemini') ai++;
    out.push({
      id: s.id,
      src: s.src,
      name: s.name,
      org: s.org,
      ctpv: s.ctpv,
      sgg: isSidoWide(s.sgg) ? '' : s.sgg,
      easy: (r.lite?.hash === s.hash && r.lite.easy) || r.fallbackEasy || clip(s.summary, 60),
      summary: clip(s.summary, 200),
      tags: [...new Set([...s.target, ...s.theme])].slice(0, 6),
      cycle: s.cycle,
      provide: s.provide,
      targetText: clip(s.targetText, 500),
      benefit: clip(s.benefitText, 300),
      apply: clip(s.applyText, 300),
      contacts: s.contacts.slice(0, 4),
      forms: s.forms.slice(0, 3),
      laws: s.laws.slice(0, 2),
      link: s.link,
      start: s.start,
      end: s.end,
      firstSeen: s.firstSeen,
      rules: r.rules,
      by: r.by,
    });
  }
  out.sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || a.name.localeCompare(b.name, 'ko'));

  // 지역 목록: 데이터에 나온 시도·시군구 + 기본 목록(데이터에 아직 없는 곳 보충)
  const regions = readJson(path.join(PUBLIC_DATA_DIR, 'regions-base.json'), {});
  for (const kind of ['local']) {
    const cache = readJson(path.join(CACHE_DIR, `${kind}.json`), {});
    for (const e of Object.values(cache)) {
      const sido = e.item?.ctpvNm;
      if (!sido) continue;
      const list = (regions[sido] ??= []);
      const sgg = e.item.sggNm;
      if (!isSidoWide(sgg) && !list.includes(sgg)) list.push(sgg);
    }
  }
  for (const k of Object.keys(regions)) regions[k].sort((a, b) => a.localeCompare(b, 'ko'));

  const meta = {
    updatedAt: new Date().toISOString(),
    count: out.length,
    aiCount: ai,
    pending: pendingCount(),
    models: { primary: config.gemini.primaryModel, lite: config.gemini.liteModel },
    regions: Object.fromEntries(Object.entries(regions).sort(([a], [b]) => a.localeCompare(b, 'ko'))),
  };
  writeJson(path.join(PUBLIC_DATA_DIR, 'services.json'), out, false);
  writeJson(path.join(PUBLIC_DATA_DIR, 'meta.json'), meta, false);
  console.log(`services.json ${out.length}건 (AI 규칙 ${ai}건, 상세 대기 ${meta.pending}건)`);
}

main();
