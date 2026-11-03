// AI 프롬프트와 응답 스키마 (규칙 형식은 docs/js/engine.js 와 같아야 함)
export const STATUS_ENUM = ['basicLivelihood', 'nearPoor', 'basicPension', 'ltcGrade', 'disability', 'veteran', 'incomeUnder'];

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

/* ---------- 2번 모델(lite): 노인 관련성 + 쉬운 말 요약 ---------- */
export const liteSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      elderlyRelevant: { type: 'BOOLEAN' },
      easySummary: { type: 'STRING' },
    },
    required: ['id', 'elderlyRelevant', 'easySummary'],
  },
};

export function litePrompt(services) {
  const items = services.map((s) => ({
    id: s.id,
    name: s.name,
    region: [s.ctpv, s.sgg].filter(Boolean).join(' ') || '전국',
    summary: clip(s.summary, 200),
    target: clip(s.targetText, 400),
    benefit: clip(s.benefitText, 300),
  }));
  return `당신은 한국 복지제도 안내 도우미입니다. 아래 복지사업 각각에 대해 판단하세요.
1) elderlyRelevant: 만 65세 이상 어르신(또는 어르신 가구)이 이 사업의 대상이 될 수 있으면 true. 청년·아동 전용 등 어르신이 대상이 될 수 없으면 false.
2) easySummary: 부모님 복지를 챙기는 자녀에게 보낼 한 줄 설명. 존댓말, 45자 이내, "무엇을 얼마나 지원하는지" 중심. 원문에 없는 금액·조건을 지어내지 마세요.
입력의 id를 그대로 돌려주세요.

입력:
${JSON.stringify(items, null, 1)}`;
}

/* ---------- 1번 모델(primary): 자격요건 → 판정 규칙 ---------- */
const nInt = { type: 'INTEGER', nullable: true };
export const primarySchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      ageMin: nInt,
      ageMax: nInt,
      gender: { type: 'STRING', enum: ['any', 'male', 'female'] },
      householdTypes: { type: 'ARRAY', items: { type: 'STRING', enum: ['single', 'couple', 'other'] } },
      residenceMonthsMin: nInt,
      incomeMaxMedianPct: { type: 'NUMBER', nullable: true },
      statusAllOf: { type: 'ARRAY', items: { type: 'STRING', enum: STATUS_ENUM } },
      statusAnyOf: { type: 'ARRAY', items: { type: 'STRING', enum: STATUS_ENUM } },
      otherConditions: { type: 'ARRAY', items: { type: 'STRING' } },
      evidence: { type: 'STRING' },
      confidence: { type: 'NUMBER' },
    },
    required: ['id', 'gender', 'householdTypes', 'statusAllOf', 'statusAnyOf', 'otherConditions', 'evidence', 'confidence'],
  },
};

export function primaryPrompt(services) {
  const items = services.map((s) => ({
    id: s.id,
    name: s.name,
    region: [s.ctpv, s.sgg].filter(Boolean).join(' ') || '전국',
    targetTags: s.target.join(', '),
    target: clip(s.targetText, 1500),
    criteria: clip(s.criteriaText, 1000),
  }));
  return `당신은 한국 복지사업의 자격요건을 기계가 판정할 수 있는 규칙으로 바꾸는 전문가입니다.
각 사업의 target(지원대상)과 criteria(선정기준) 원문만 근거로 아래 필드를 채우세요. 원문에 없는 조건은 만들지 마세요.

- ageMin / ageMax: 만 나이 조건. "65세 이상" → ageMin 65, "80세 미만" → ageMax 79. 없으면 null.
- gender: 성별 제한이 명시되면 male/female, 아니면 any.
- householdTypes: 가구 형태 제한. 독거·홀로 사는 → ["single"], 노인부부 → ["couple"]. 제한 없으면 [].
- residenceMonthsMin: "관내 1년 이상 거주" → 12. 단순 "관내 거주"는 null (지역은 별도로 판정함).
- incomeMaxMedianPct: "기준중위소득 50% 이하" → 50. 명시된 경우만.
- 상태 코드: basicLivelihood(국민기초생활보장 수급자, 생계·의료·주거·교육급여), nearPoor(차상위계층), basicPension(기초연금 수급자),
  ltcGrade(노인장기요양 등급 판정자), disability(등록 장애인), veteran(국가유공자·보훈대상자), incomeUnder(incomeMaxMedianPct 소득 기준 충족).
  - statusAllOf: 반드시 모두 해당해야 하는 상태. 예: "기초연금 수급자" 단독 → ["basicPension"].
  - statusAnyOf: 하나만 해당하면 되는 상태. 예: "기초생활수급자 또는 차상위계층" → ["basicLivelihood","nearPoor"].
    "수급자, 차상위 또는 중위소득 50% 이하" → statusAnyOf ["basicLivelihood","nearPoor","incomeUnder"] + incomeMaxMedianPct 50.
- otherConditions: 위 필드로 표현할 수 없지만 자격에 영향을 주는 조건을 짧은 한국어 구절로. (예: "치매 진단", "주택 소유자", "타 사업 중복 수혜 불가")
  신청 절차·제출 서류·지원 내용은 넣지 마세요.
- evidence: 판정의 핵심 근거가 된 원문 구절(100자 이내, 원문 그대로).
- confidence: 0~1. 원문이 명확하면 0.9 이상, 해석이 애매하면 0.6 이하.
입력의 id를 그대로 돌려주세요.

입력:
${JSON.stringify(items, null, 1)}`;
}
