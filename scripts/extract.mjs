// 2단계: 자격요건 → 판정 규칙 (Gemini 2개 모델, 무료 한도 안에서 증분 처리)
//  2번 모델(lite)  : 어르신 관련성 분류 + 보호자용 쉬운 한 줄 요약 (여러 건을 한 번에)
//  1번 모델(primary): 자격요건 구조화 (여러 건을 한 번에)
//  키가 없거나 한도를 다 쓰면 간이 추출기로 채우고, 다음 실행 때 AI로 다시 시도합니다.
import path from 'node:path';
import { config, CACHE_DIR } from './config.mjs';
import { GeminiClient, QuotaExhaustedError } from './lib/gemini.mjs';
import { litePrompt, liteSchema, primaryPrompt, primarySchema, STATUS_ENUM } from './lib/prompts.mjs';
import { heuristicRules, heuristicEasy } from './lib/heuristic.mjs';
import { loadServices } from './lib/services.mjs';
import { readJson, writeJson, today } from './lib/store.mjs';

const RULES_FILE = path.join(CACHE_DIR, 'rules.json');
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function sanitizeRules(r) {
  const intOrNull = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const statuses = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => STATUS_ENUM.includes(x)))] : []);
  return {
    ageMin: intOrNull(r.ageMin),
    ageMax: intOrNull(r.ageMax),
    gender: ['male', 'female'].includes(r.gender) ? r.gender : 'any',
    householdTypes: Array.isArray(r.householdTypes) ? r.householdTypes.filter((x) => ['single', 'couple', 'other'].includes(x)) : [],
    residenceMonthsMin: intOrNull(r.residenceMonthsMin),
    incomeMaxMedianPct: Number.isFinite(r.incomeMaxMedianPct) ? r.incomeMaxMedianPct : null,
    statusAllOf: statuses(r.statusAllOf),
    statusAnyOf: statuses(r.statusAnyOf),
    otherConditions: Array.isArray(r.otherConditions) ? r.otherConditions.map(String).filter(Boolean).slice(0, 6) : [],
    evidence: String(r.evidence || '').slice(0, 160),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
  };
}

async function main() {
  const services = loadServices();
  const store = readJson(RULES_FILE, {});
  const now = today();
  const g = config.gemini;
  const lite = new GeminiClient({ apiKey: g.apiKey, model: g.liteModel, rpm: g.liteRpm, maxCalls: g.liteMaxCallsPerRun, label: '2번 lite' });
  const primary = new GeminiClient({ apiKey: g.apiKey, model: g.primaryModel, rpm: g.primaryRpm, maxCalls: g.primaryMaxCallsPerRun, label: '1번 primary' });
  if (!g.apiKey) console.warn('GEMINI_API_KEY가 없어 간이 추출기만 사용합니다.');

  const stats = { lite: 0, primary: 0, heuristic: 0, errors: 0 };

  // ---- 2번 모델: 관련성 + 쉬운 요약 ----
  const needLite = services.filter((s) => store[s.id]?.lite?.hash !== s.hash);
  for (const batch of chunk(needLite, g.liteBatch)) {
    if (!lite.available) break;
    try {
      const out = await lite.generateJSON(litePrompt(batch), liteSchema);
      for (const r of out || []) {
        const s = batch.find((x) => x.id === r.id);
        if (!s) continue;
        const e = (store[s.id] ??= {});
        e.lite = { hash: s.hash, relevant: r.elderlyRelevant !== false, easy: String(r.easySummary || '').slice(0, 80), model: g.liteModel, at: now };
        stats.lite++;
      }
    } catch (err) {
      stats.errors++;
      console.warn(err.message);
      if (err instanceof QuotaExhaustedError) break;
    }
  }

  // ---- 1번 모델: 자격요건 구조화 ----
  const needPrimary = services.filter((s) => {
    const e = store[s.id];
    if (e?.lite?.hash === s.hash && e.lite.relevant === false) return false; // 어르신과 무관
    return !e?.rules || e.rulesHash !== s.hash || e.by !== 'gemini';
  });
  for (const batch of chunk(needPrimary, g.primaryBatch)) {
    if (!primary.available) break;
    try {
      const out = await primary.generateJSON(primaryPrompt(batch), primarySchema);
      for (const r of out || []) {
        const s = batch.find((x) => x.id === r.id);
        if (!s) continue;
        const e = (store[s.id] ??= {});
        Object.assign(e, { rules: sanitizeRules(r), rulesHash: s.hash, by: 'gemini', model: g.primaryModel, at: now });
        stats.primary++;
      }
    } catch (err) {
      stats.errors++;
      console.warn(err.message);
      if (err instanceof QuotaExhaustedError) break;
    }
  }

  // ---- 남은 것: 간이 추출기 (앱이 바로 동작하도록) ----
  for (const s of services) {
    const e = (store[s.id] ??= {});
    // 간이 추출 결과는 매번 다시 계산(추출기 개선이 바로 반영되도록)
    if (!e.rules || e.rulesHash !== s.hash || e.by !== 'gemini') {
      Object.assign(e, { rules: heuristicRules(s), rulesHash: s.hash, by: 'heuristic', model: null, at: now });
      stats.heuristic++;
    }
    if (!e.lite || e.lite.hash !== s.hash) e.fallbackEasy = heuristicEasy(s);
  }

  writeJson(RULES_FILE, store);
  console.table({ ...stats, liteCalls: lite.calls, primaryCalls: primary.calls, services: services.length });
}

main();
