// 한국사회보장정보원 복지서비스 API 클라이언트 (중앙부처 / 지자체)
import { parseXml, asArray } from './xml.mjs';

const LOCAL_BASE = 'https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations';
const CENTRAL_BASE = 'https://apis.data.go.kr/B554287/NationalWelfareInformationsV001';

function encodeKey(key) {
  // 이미 URL 인코딩된 키(Encoding 키)면 그대로, 아니면(Decoding 키) 인코딩
  return /%[0-9A-F]{2}/i.test(key) ? key : encodeURIComponent(key);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DataGoClient {
  constructor(key) {
    if (!key) throw new Error('DATA_GO_KR_KEY가 없습니다.');
    this.key = encodeKey(key);
    this.calls = { local: 0, central: 0 };
  }

  async get(url, kind) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.calls[kind]++;
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const doc = parseXml(text);
        const root = Object.values(doc)[0] ?? {};
        // 포털 공통 오류 응답
        if (doc.OpenAPI_ServiceResponse) {
          const h = doc.OpenAPI_ServiceResponse.cmmMsgHeader ?? {};
          const err = new Error(`포털 오류 ${h.returnReasonCode}: ${h.returnAuthMsg || h.errMsg}`);
          err.fatal = true;
          throw err;
        }
        if (root.resultCode && root.resultCode !== '0') {
          const err = new Error(`API 오류 ${root.resultCode}: ${root.resultMessage}`);
          err.fatal = true;
          throw err;
        }
        return root;
      } catch (e) {
        if (e.fatal || attempt === 3) throw e;
        await sleep(1500 * attempt);
      }
    }
  }

  async *listPages(kind, lifeArray, pageSize) {
    let pageNo = 1;
    let fetched = 0;
    while (true) {
      const p = new URLSearchParams({ pageNo: String(pageNo), numOfRows: String(pageSize) });
      if (lifeArray) p.set('lifeArray', lifeArray);
      let url;
      if (kind === 'local') {
        url = `${LOCAL_BASE}/LcgvWelfarelist?serviceKey=${this.key}&${p}`;
      } else {
        p.set('callTp', 'L');
        p.set('srchKeyCode', '003');
        url = `${CENTRAL_BASE}/NationalWelfarelistV001?serviceKey=${this.key}&${p}`;
      }
      const root = await this.get(url, kind);
      const items = asArray(root.servList);
      const total = Number(root.totalCount || 0);
      yield { items, total };
      fetched += items.length;
      if (items.length === 0 || fetched >= total) break;
      pageNo++;
    }
  }

  async detail(kind, servId) {
    const id = encodeURIComponent(servId);
    const url =
      kind === 'local'
        ? `${LOCAL_BASE}/LcgvWelfaredetailed?serviceKey=${this.key}&servId=${id}`
        : `${CENTRAL_BASE}/NationalWelfaredetailedV001?serviceKey=${this.key}&callTp=D&servId=${id}`;
    return this.get(url, kind);
  }
}

const splitTags = (s) => (s ? String(s).split(',').map((t) => t.trim()).filter(Boolean) : []);

const relatedList = (v, nameKey, valueKey) =>
  asArray(v)
    .map((x) => ({ name: (x?.[nameKey] || '').trim(), value: (x?.[valueKey] || '').trim() }))
    .filter((x) => x.name || x.value);

/** 지자체 목록+상세 → 공통 형식 */
export function normalizeLocal(item, d = {}) {
  return {
    id: item.servId,
    src: 'L',
    name: d.servNm || item.servNm,
    org: d.bizChrDeptNm || item.bizChrDeptNm || '',
    ctpv: d.ctpvNm || item.ctpvNm || '',
    sgg: d.sggNm || item.sggNm || '',
    summary: (d.servDgst || item.servDgst || '').trim(),
    life: splitTags(item.lifeNmArray),
    target: splitTags(d.trgterIndvdlNmArray || item.trgterIndvdlNmArray),
    theme: splitTags(item.intrsThemaNmArray),
    cycle: d.sprtCycNm || item.sprtCycNm || '',
    provide: d.srvPvsnNm || item.srvPvsnNm || '',
    targetText: d.sprtTrgtCn || '',
    criteriaText: d.slctCritCn || '',
    benefitText: d.alwServCn || '',
    applyText: d.aplyMtdCn || item.aplyMtdNm || '',
    contacts: relatedList(d.inqplCtadrList, 'wlfareInfoReldNm', 'wlfareInfoReldCn'),
    laws: relatedList(d.baslawList, 'wlfareInfoReldNm', 'wlfareInfoReldCn').map((x) => x.name),
    forms: relatedList(d.basfrmList, 'wlfareInfoReldNm', 'wlfareInfoReldCn').map((x) => ({ name: x.name, url: x.value })),
    link: item.servDtlLink || '',
    start: d.enfcBgngYmd || '',
    end: d.enfcEndYmd || '',
    lastMod: item.lastModYmd || d.lastModYmd || '',
  };
}

/** 중앙부처 목록+상세 → 공통 형식 */
export function normalizeCentral(item, d = {}) {
  const apply = relatedList(d.applmetList, 'servSeDetailNm', 'servSeDetailLink')
    .filter((x) => /신청/.test(x.name))
    .map((x) => x.value);
  return {
    id: item.servId,
    src: 'C',
    name: d.servNm || item.servNm,
    org: d.jurMnofNm || [item.jurMnofNm, item.jurOrgNm].filter(Boolean).join(' '),
    ctpv: '',
    sgg: '',
    summary: (d.wlfareInfoOutlCn || item.servDgst || '').trim(),
    life: splitTags(d.lifeArray || item.lifeArray),
    target: splitTags(d.trgterIndvdlArray || item.trgterIndvdlArray),
    theme: splitTags(d.intrsThemaArray || item.intrsThemaArray),
    cycle: d.sprtCycNm || item.sprtCycNm || '',
    provide: d.srvPvsnNm || item.srvPvsnNm || '',
    targetText: d.tgtrDtlCn || '',
    criteriaText: d.slctCritCn || '',
    benefitText: d.alwServCn || '',
    applyText: [...new Set(apply)].join('\n'),
    contacts: [
      ...relatedList(d.inqplCtadrList, 'servSeDetailNm', 'servSeDetailLink').map((x) => ({ name: x.name, value: x.value })),
      ...(item.rprsCtadr ? [{ name: '대표 문의', value: item.rprsCtadr }] : []),
    ],
    laws: relatedList(d.baslawList, 'servSeDetailNm', 'servSeDetailLink').map((x) => x.name),
    forms: relatedList(d.basfrmList, 'servSeDetailNm', 'servSeDetailLink').map((x) => ({ name: x.name, url: x.value })),
    link: item.servDtlLink || '',
    start: '',
    end: '',
    lastMod: item.svcfrstRegTs || '',
  };
}
