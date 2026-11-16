// 어르신 정보 검증·정리 (브라우저·테스트 공용)
// 백업 파일·초대 링크처럼 밖에서 들어온 값은 반드시 이 함수를 거쳐 저장합니다.
// → 화면에 그대로 끼워 넣어도 안전한 값만 남기고, 모르는 항목은 버립니다.

const YNU = ['yes', 'no', 'unknown'];
const LTC = ['unknown', 'none', '1', '2', '3', '4', '5', 'cognitive'];
const CONSENT_METHODS = ['self', 'phone', 'sms', 'inPerson', 'guardian'];
export const SUBJECTS = ['self', 'guardian']; // self = 어르신 본인이 직접 등록, guardian = 보호자가 등록

const ID_RE = /^[a-z0-9]{6,32}$/;
const pick = (v, list, d) => (list.includes(v) ? v : d);
const text = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
const dateOr = (v, re) => (typeof v === 'string' && re.test(v) ? v : '');
const isoOr = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');

export const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

/** 외부에서 들어온 어르신 정보 → 안전한 형태. 필수값이 없으면 null */
export function sanitizeElder(raw, { keepId = true } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const nickname = text(raw.nickname, 20);
  const birthDate = dateOr(raw.birthDate, /^(19|20)\d{2}-\d{2}-\d{2}$/);
  if (!nickname) return null;
  const size = Number(raw.householdSize);
  const income = Number(raw.incomeMonthly);
  const c = raw.consent && typeof raw.consent === 'object' ? raw.consent : null;
  const subject = pick(raw.subject, SUBJECTS, 'guardian');
  return {
    ...(keepId && isValidId(raw.id) ? { id: raw.id } : {}),
    subject,
    nickname,
    birthDate,
    gender: pick(raw.gender, ['female', 'male'], ''),
    sido: text(raw.sido, 20),
    sigungu: text(raw.sigungu, 20),
    residenceSince: dateOr(raw.residenceSince, /^(19|20)\d{2}-\d{2}$/),
    household: pick(raw.household, ['single', 'couple', 'other'], ''),
    householdSize: Number.isInteger(size) && size >= 1 && size <= 12 ? size : '',
    basicPension: pick(raw.basicPension, YNU, 'unknown'),
    basicLivelihood: pick(raw.basicLivelihood, YNU, 'unknown'),
    nearPoor: pick(raw.nearPoor, YNU, 'unknown'),
    ltcGrade: pick(String(raw.ltcGrade ?? ''), LTC, 'unknown'),
    incomeMonthly: raw.incomeMonthly !== '' && raw.incomeMonthly != null && Number.isFinite(income) && income >= 0 && income <= 1e9 ? Math.round(income) : '',
    disability: pick(raw.disability, YNU, 'unknown'),
    veteran: pick(raw.veteran, YNU, 'unknown'),
    consent: c
      ? {
          at: isoOr(c.at) || new Date().toISOString(),
          method: pick(c.method, CONSENT_METHODS, subject === 'self' ? 'self' : 'phone'),
          sensitive: c.sensitive === true,
        }
      : null,
    createdAt: isoOr(raw.createdAt) || new Date().toISOString(),
    updatedAt: isoOr(raw.updatedAt) || '',
    ...(raw.importedAt ? { importedAt: isoOr(raw.importedAt) } : {}),
  };
}

/** 민감정보 별도 동의가 없으면 장애·보훈 값을 '모름'으로 되돌림 */
export function dropUnconsentedSensitive(e) {
  if (e.consent?.sensitive) return e;
  return { ...e, disability: 'unknown', veteran: 'unknown' };
}

/** http(s) 링크만 허용 (javascript: 등 차단) */
export function safeUrl(u) {
  try {
    const url = new URL(String(u || ''), 'https://invalid.invalid');
    if (url.hostname === 'invalid.invalid') return '';
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const STATUS_OK = ['applied', 'notEligible', 'rejected', 'visit', 'told'];
const SERV_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** 백업 파일 전체 → 안전한 상태. 잘못된 항목은 버림 */
export function sanitizeState(raw, emptyState) {
  const out = emptyState();
  if (!raw || typeof raw !== 'object') return out;
  const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  out.settings = {
    ...out.settings,
    role: pick(st.role, ['self', 'family', 'supporter', 'caregiver'], ''),
    name: text(st.name, 20),
    org: text(st.org, 40),
    fontScale: pick(st.fontScale, ['normal', 'large', 'xlarge'], 'normal'),
    notify: st.notify === true,
  };
  const ids = new Set();
  for (const e of Array.isArray(raw.elders) ? raw.elders.slice(0, 100) : []) {
    const s = sanitizeElder(e);
    if (!s || !s.id || ids.has(s.id)) continue;
    ids.add(s.id);
    out.elders.push(dropUnconsentedSensitive(s));
  }
  const perElder = (obj, fn) => {
    const res = Object.create(null);
    if (!obj || typeof obj !== 'object') return res;
    for (const id of Object.keys(obj)) if (ids.has(id)) res[id] = fn(obj[id]);
    return res;
  };
  out.actions = perElder(raw.actions, (m) => {
    const r = {};
    if (m && typeof m === 'object')
      for (const [k, v] of Object.entries(m)) if (SERV_ID_RE.test(k) && STATUS_OK.includes(v?.status)) r[k] = { status: v.status, at: isoOr(v.at) };
    return r;
  });
  const idList = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && SERV_ID_RE.test(x)) : []);
  out.seen = perElder(raw.seen, idList);
  out.notified = perElder(raw.notified, idList);
  return { ...out, actions: { ...out.actions }, seen: { ...out.seen }, notified: { ...out.notified } };
}
