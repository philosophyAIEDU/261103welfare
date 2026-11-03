// 판정 엔진: AI가 만든 규칙(service.rules)과 어르신 정보(profile)로 대상 여부를 결정합니다.
// 결정은 이 코드(규칙)가 하고, AI는 규칙을 만드는 데만 쓰입니다. → 환각이 판정에 섞이지 않음.

export const STATUS_LABELS = {
  basicLivelihood: '기초생활수급',
  nearPoor: '차상위계층',
  basicPension: '기초연금 수급',
  ltcGrade: '장기요양등급',
  disability: '등록 장애인',
  veteran: '국가유공자·보훈대상',
  incomeUnder: '소득 기준',
};

export const HOUSEHOLD_LABELS = { single: '혼자 사심', couple: '부부 함께', other: '자녀 등과 함께' };

// 규칙 확인에 필요한 어르신 정보 항목 (정보가 없을 때 '무엇을 입력하면 되는지' 안내용)
const FIELD_FOR = {
  age: 'birthDate',
  gender: 'gender',
  household: 'household',
  residence: 'residenceSince',
  basicLivelihood: 'basicLivelihood',
  nearPoor: 'nearPoor',
  basicPension: 'basicPension',
  ltcGrade: 'ltcGrade',
  disability: 'disability',
  veteran: 'veteran',
  incomeUnder: 'incomeMonthly',
};

export const FIELD_LABELS = {
  birthDate: '생년월일',
  gender: '성별',
  household: '가구 형태',
  residenceSince: '전입 시기',
  basicLivelihood: '기초생활수급 여부',
  nearPoor: '차상위 여부',
  basicPension: '기초연금 수급 여부',
  ltcGrade: '장기요양등급',
  disability: '장애 등록 여부',
  veteran: '보훈대상 여부',
  incomeMonthly: '월 소득인정액',
};

const pad = (n) => String(n).padStart(2, '0');
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 만 나이 */
export function ageOn(birthDate, today = todayStr()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '')) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** 'YYYY-MM' 이후 지난 개월 수 */
export function monthsSince(ym, today = todayStr()) {
  if (!/^\d{4}-\d{2}/.test(ym || '')) return null;
  const [y, m] = ym.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  return (ty - y) * 12 + (tm - m);
}

export function householdSize(p) {
  const n = Number(p.householdSize);
  if (n >= 1) return Math.round(n);
  return p.household === 'single' ? 1 : p.household === 'couple' ? 2 : null;
}

/** 월 소득인정액이 기준중위소득의 몇 %인지 */
export function incomePct(p, standards) {
  const income = Number(p.incomeMonthly);
  if (p.incomeMonthly === '' || p.incomeMonthly == null || !Number.isFinite(income)) return null;
  const size = householdSize(p);
  const table = standards?.medianIncome?.bySize || {};
  if (!size) return null;
  const median = table[String(Math.min(size, 6))];
  if (!median) return null;
  return (income / median) * 100;
}

const yn = (v) => (v === 'yes' ? true : v === 'no' ? false : null);

function statusValue(key, p, standards, rules) {
  switch (key) {
    case 'ltcGrade':
      if (!p.ltcGrade || p.ltcGrade === 'unknown') return null;
      return p.ltcGrade !== 'none';
    case 'incomeUnder': {
      const pct = incomePct(p, standards);
      if (pct === null || rules.incomeMaxMedianPct == null) return null;
      return pct <= rules.incomeMaxMedianPct;
    }
    case 'basicLivelihood':
    case 'nearPoor':
    case 'basicPension':
    case 'disability':
    case 'veteran':
      return yn(p[key]);
    default:
      return null;
  }
}

const statusLabel = (key, rules) =>
  key === 'incomeUnder' && rules.incomeMaxMedianPct != null
    ? `소득 기준중위소득 ${rules.incomeMaxMedianPct}% 이하`
    : STATUS_LABELS[key] || key;

/**
 * 판정
 * @returns {{status:'likely'|'check'|'no', checks:Array<{label:string, ok:boolean|null, detail?:string}>, missing:string[], closed?:boolean}}
 *   likely = 받을 가능성 높음, check = 확인 필요, no = 해당 안 됨
 */
export function judge(service, p, standards, today = todayStr()) {
  const checks = [];
  const missing = new Set();
  const add = (label, ok, detail, field) => {
    checks.push({ label, ok, detail });
    if (ok === null && field) missing.add(field);
  };

  // 지역 (지자체 사업)
  if (service.src === 'L') {
    const where = [service.ctpv, service.sgg].filter(Boolean).join(' ');
    const ok = service.ctpv === p.sido && (!service.sgg || service.sgg === p.sigungu);
    if (!ok) return { status: 'no', checks: [{ label: '지역', ok: false, detail: `${where} 주민 대상` }], missing: [] };
    add('지역', true, `${where} 주민 대상`);
  }

  // 사업 기간
  const t8 = today.replaceAll('-', '');
  if (service.end && service.end !== '99991231' && service.end < t8) {
    return { status: 'no', closed: true, checks: [{ label: '사업 기간', ok: false, detail: '종료된 사업' }], missing: [] };
  }
  if (service.start && service.start > t8) add('사업 기간', null, `${service.start.slice(0, 4)}.${service.start.slice(4, 6)}.${service.start.slice(6)} 시작 예정`);

  const r = service.rules;
  if (!r) return { status: 'check', checks: [...checks, { label: '자격 조건', ok: null, detail: '아직 분석되지 않음' }], missing: [] };

  // 나이
  if (r.ageMin != null || r.ageMax != null) {
    const age = ageOn(p.birthDate, today);
    const range = [r.ageMin != null ? `만 ${r.ageMin}세 이상` : '', r.ageMax != null ? `만 ${r.ageMax}세 이하` : ''].filter(Boolean).join(', ');
    const ok = age === null ? null : (r.ageMin == null || age >= r.ageMin) && (r.ageMax == null || age <= r.ageMax);
    add('나이', ok, age === null ? range : `${range} (현재 만 ${age}세)`, FIELD_FOR.age);
  }

  // 성별
  if (r.gender && r.gender !== 'any') {
    const ok = !p.gender ? null : p.gender === r.gender;
    add('성별', ok, r.gender === 'female' ? '여성 대상' : '남성 대상', FIELD_FOR.gender);
  }

  // 가구 형태
  if (r.householdTypes?.length) {
    const ok = !p.household ? null : r.householdTypes.includes(p.household);
    add('가구 형태', ok, r.householdTypes.map((h) => HOUSEHOLD_LABELS[h]).join(' 또는 '), FIELD_FOR.household);
  }

  // 거주 기간
  if (r.residenceMonthsMin != null) {
    const m = monthsSince(p.residenceSince, today);
    const need = r.residenceMonthsMin >= 12 && r.residenceMonthsMin % 12 === 0 ? `${r.residenceMonthsMin / 12}년` : `${r.residenceMonthsMin}개월`;
    add('거주 기간', m === null ? null : m >= r.residenceMonthsMin, `${need} 이상 거주`, FIELD_FOR.residence);
  }

  const allOf = r.statusAllOf || [];
  const anyOf = r.statusAnyOf || [];

  // 소득 기준이 단독 조건인 경우
  if (r.incomeMaxMedianPct != null && !allOf.includes('incomeUnder') && !anyOf.includes('incomeUnder')) {
    add(statusLabel('incomeUnder', r), statusValue('incomeUnder', p, standards, r), '월 소득인정액 기준', FIELD_FOR.incomeUnder);
  }

  // 모두 해당해야 하는 상태
  for (const key of allOf) {
    add(statusLabel(key, r), statusValue(key, p, standards, r), '필수', FIELD_FOR[key]);
  }

  // 하나만 해당하면 되는 상태
  if (anyOf.length) {
    const vals = anyOf.map((k) => statusValue(k, p, standards, r));
    const ok = vals.some((v) => v === true) ? true : vals.every((v) => v === false) ? false : null;
    add('다음 중 하나', ok, anyOf.map((k) => statusLabel(k, r)).join(' / '));
    if (ok === null) anyOf.forEach((k, i) => vals[i] === null && missing.add(FIELD_FOR[k]));
  }

  // 기계로 판정할 수 없는 조건
  for (const c of r.otherConditions || []) add('추가 조건', null, c);

  const hasFail = checks.some((c) => c.ok === false);
  const hasUnknown = checks.some((c) => c.ok === null);
  const status = hasFail ? 'no' : hasUnknown || (r.confidence ?? 0) < 0.6 ? 'check' : 'likely';
  return { status, checks, missing: hasFail ? [] : [...missing].filter(Boolean) };
}

/** 어르신 한 분에 대한 전체 판정 (해당 안 됨 제외) */
export function judgeAll(services, p, standards, today = todayStr()) {
  const out = [];
  for (const s of services) {
    const j = judge(s, p, standards, today);
    if (j.status !== 'no') out.push({ service: s, ...j });
  }
  const rank = { likely: 0, check: 1 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || (b.service.firstSeen || '').localeCompare(a.service.firstSeen || ''));
  return out;
}
