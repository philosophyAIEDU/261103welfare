// 도움이 필요한 분야: 보호자가 부모님께 필요한 분야를 체크하면, 그 분야 복지를 먼저 보여줍니다.
// 분류는 복지로 관심주제 태그 + 사업명·설명의 핵심 단어로 합니다. (판정이 아니라 정렬·필터용)

export const NEEDS = [
  {
    key: 'living',
    label: '생계비',
    desc: '생활비, 연금, 수당, 공과금',
    tags: ['생활지원'],
    re: /생계|생활비|생활안정|수당|연금|장수|축하금|효도|위로금|명절|생계급여|긴급복지|공과금|통신비|교통비|택시|통행료|요금 감면|감면|할인|후원금|생활지원금|장려금|장례|바우처|쌀|식료품|푸드/,
  },
  {
    key: 'medical',
    label: '병원비·건강',
    desc: '진료비, 수술, 약값, 틀니, 검진, 치매',
    tags: ['신체건강', '정신건강'],
    re: /의료|병원|진료|치료|수술|약제|약값|틀니|의치|임플란트|보청기|안경|백내장|무릎|관절|검진|건강|치매|예방접종|백신|재활|간병|한방|치과|정신|우울/,
  },
  {
    key: 'care',
    label: '돌봄·식사',
    desc: '방문 돌봄, 도시락, 반찬, 목욕, 요양',
    tags: ['보호·돌봄'],
    re: /돌봄|돌보|요양|방문|도시락|반찬|급식|식사|경로식당|목욕|미용|세탁|빨래|가사|주간보호|단기보호|보호센터|안부|말벗|장기요양/,
  },
  {
    key: 'housing',
    label: '집·난방',
    desc: '집수리, 주거, 난방비, 냉방',
    tags: ['주거', '에너지'],
    re: /주거|주택|집수리|수리|개보수|임대|월세|전세|난방|연탄|등유|가스|에너지|냉방|폭염|한파|전기요금|보일러|도배|장판/,
  },
  {
    key: 'culture',
    label: '문화·여가',
    desc: '공연, 여행, 배움, 경로당, 운동',
    tags: ['문화·여가'],
    re: /문화|여가|공연|관람|영화|여행|나들이|관광|체육|운동|스포츠|강좌|배움|평생학습|노인대학|경로당|동아리|가요제|잔치|축제|노래|독서|도서|문화누리|이용권|여객선|나들이/,
  },
  {
    key: 'work',
    label: '일자리·사회활동',
    desc: '노인 일자리, 봉사, 사회참여',
    tags: ['일자리'],
    re: /일자리|취업|근로|사회활동|사회참여|공익활동|봉사|시니어|창업|재능나눔/,
  },
  {
    key: 'safety',
    label: '안전·외로움',
    desc: '응급안전, 고독사 예방, 상담, 법률',
    tags: ['안전·위기', '법률'],
    re: /안전|응급|고독|고립|외로|자살|학대|법률|소송|사기|화재|낙상|미끄럼|안심|실종|배회|말벗|안부/,
  },
];

export const NEED_LABELS = Object.fromEntries(NEEDS.map((n) => [n.key, n.label]));

const cache = new Map();

/** 복지사업이 어떤 분야에 해당하는지 (여러 개일 수 있음) */
export function needsOf(service) {
  if (cache.has(service.id)) return cache.get(service.id);
  const name = service.name || '';
  const text = [name, service.easy].filter(Boolean).join(' ');
  const tags = new Set(service.tags || []);
  const hit = [];
  for (const n of NEEDS) {
    // 사업명·쉬운 설명에 핵심 단어가 있거나, 복지로 관심주제 태그가 맞으면 해당
    if (n.re.test(text) || n.tags.some((t) => tags.has(t))) hit.push(n.key);
  }
  if (service.id) cache.set(service.id, hit);
  return hit;
}

/** 어르신이 체크한 분야 중 이 복지에 해당하는 것 */
export function matchedNeeds(service, elderNeeds) {
  if (!elderNeeds?.length) return [];
  const own = needsOf(service);
  return elderNeeds.filter((k) => own.includes(k));
}
