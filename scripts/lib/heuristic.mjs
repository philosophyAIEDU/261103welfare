// AI 없이(또는 무료 한도 소진 시) 쓰는 간단한 규칙 추출기.
// 정확도가 낮으므로 confidence를 낮게 두어 앱에서 '확인 필요'로 안내되게 함.

const STATUS_PATTERNS = [
  ['basicLivelihood', /기초\s*생활\s*수급|생계\s*급여|의료\s*급여\s*수급|국민기초생활/],
  ['nearPoor', /차상위/],
  ['basicPension', /기초\s*연금\s*수급/],
  ['ltcGrade', /장기\s*요양\s*(등급|인정)|등급\s*판정/],
  ['disability', /등록\s*장애인|장애인\s*등록|장애\s*정도/],
  ['veteran', /국가\s*유공자|보훈\s*대상|참전\s*유공/],
];

export function heuristicRules(s) {
  const text = `${s.targetText}\n${s.criteriaText}`.replace(/\s+/g, ' ');
  const rules = {
    ageMin: null,
    ageMax: null,
    gender: 'any',
    householdTypes: [],
    residenceMonthsMin: null,
    incomeMaxMedianPct: null,
    statusAllOf: [],
    statusAnyOf: [],
    otherConditions: [],
    evidence: '',
    confidence: 0.5,
  };

  const minAge = text.match(/(?:만\s*)?(\d{2,3})\s*세\s*(?:이상|부터|以上)/);
  if (minAge) rules.ageMin = Number(minAge[1]);
  const maxAge = text.match(/(?:만\s*)?(\d{2,3})\s*세\s*(이하|미만)/);
  if (maxAge) rules.ageMax = Number(maxAge[1]) - (maxAge[2] === '미만' ? 1 : 0);
  if (rules.ageMax !== null && rules.ageMin !== null && rules.ageMax < rules.ageMin) rules.ageMax = null;

  const income = text.match(/중위\s*소득\s*(\d{2,3})\s*%\s*(이하|이내|미만)/);
  if (income) rules.incomeMaxMedianPct = Number(income[1]);

  const residence = text.match(/(\d+)\s*(년|개월)\s*이상\s*(?:계속\s*)?거주/);
  if (residence) rules.residenceMonthsMin = Number(residence[1]) * (residence[2] === '년' ? 12 : 1);

  if (/독거|홀로\s*사는|1인\s*가구/.test(text)) rules.householdTypes = ['single'];

  const statuses = STATUS_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
  if (rules.incomeMaxMedianPct !== null && statuses.length) statuses.push('incomeUnder');
  // 여러 상태가 나오면 '또는'일 가능성이 높아 statusAnyOf로 둠(관대하게 판정 → 확인 필요로 안내)
  if (statuses.length === 1 && rules.incomeMaxMedianPct === null) rules.statusAllOf = statuses;
  else if (statuses.length > 1) rules.statusAnyOf = statuses;

  // 목록의 '가구상황' 태그 중 위 항목으로 표현할 수 없는 대상 → 추가 조건으로
  const TAG_STATUS = { 장애인: 'disability', 보훈대상자: 'veteran' };
  const TAG_CONDITION = {
    '다문화·탈북민': '다문화가족 또는 북한이탈주민',
    '한부모·조손': '한부모 또는 조손가정',
    다자녀: '다자녀 가구',
    저소득: '저소득 가구(소득 기준 확인)',
    농어업인: '농어업인',
    임산부: '임산부',
  };
  for (const tag of s.target || []) {
    const st = TAG_STATUS[tag];
    if (st && !rules.statusAllOf.includes(st) && !rules.statusAnyOf.includes(st) && s.target.length === 1) rules.statusAllOf.push(st);
    if (TAG_CONDITION[tag] && !(tag === '저소득' && statuses.length)) rules.otherConditions.push(TAG_CONDITION[tag]);
  }

  const ev = (s.targetText || '').replace(/\s+/g, ' ').trim();
  rules.evidence = ev.length > 100 ? ev.slice(0, 100) + '…' : ev;

  // 짧고 단순한 문장(나이 조건만 있는 등)은 조금 더 신뢰
  const simple = text.length < 140 && !/단[,\s]|제외|다만|우선|순위/.test(text);
  rules.confidence = simple && (rules.ageMin || rules.householdTypes.length) ? 0.7 : 0.5;
  return rules;
}

export function heuristicEasy(s) {
  const base = (s.summary || s.benefitText || s.name).replace(/\s+/g, ' ').trim();
  return base.length > 60 ? base.slice(0, 58) + '…' : base;
}
