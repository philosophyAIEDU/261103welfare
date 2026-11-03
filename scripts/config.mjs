// 모든 설정은 환경변수(GitHub Actions의 Secrets / Variables)로 바꿀 수 있습니다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = path.join(ROOT, 'data-cache');
export const PUBLIC_DATA_DIR = path.join(ROOT, 'docs', 'data');

export const config = {
  // 공공데이터포털 인증키 (Encoding/Decoding 어느 쪽이든 가능)
  dataGoKrKey: env.DATA_GO_KR_KEY || '',
  // 생애주기 필터: 006 = 노년(기본). 전체를 받으려면 ALL
  lifeArray: !env.LIFE_ARRAY ? '006' : env.LIFE_ARRAY === 'ALL' ? '' : env.LIFE_ARRAY,
  pageSize: num(env.PAGE_SIZE, 100),
  // 개발계정 일일 트래픽(지자체 1,000 / 중앙 100) 안에서 한 번 실행에 받을 상세 건수
  localDetailCap: num(env.LOCAL_DETAIL_CAP, 900),
  centralDetailCap: num(env.CENTRAL_DETAIL_CAP, 85),
  // 중앙부처 사업은 수정일이 없어 이 기간마다 상세를 다시 받음
  centralRefreshDays: num(env.CENTRAL_REFRESH_DAYS, 30),

  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    // 1번 모델: 자격요건 구조화(어려운 작업)
    primaryModel: env.GEMINI_MODEL_PRIMARY || 'gemini-3.8-flash',
    // 2번 모델: 노인 관련성 분류 + 쉬운 말 요약(가벼운 작업)
    liteModel: env.GEMINI_MODEL_LITE || 'gemini-3.5-flash-lite',
    // 무료 티어 보호용 상한. 무료 한도보다 낮게 잡아 두었습니다.
    primaryRpm: num(env.GEMINI_PRIMARY_RPM, 4),
    liteRpm: num(env.GEMINI_LITE_RPM, 8),
    primaryMaxCallsPerRun: num(env.GEMINI_PRIMARY_MAX_CALLS, 60),
    liteMaxCallsPerRun: num(env.GEMINI_LITE_MAX_CALLS, 120),
    // 한 번 호출에 묶어 보내는 사업 수 (요청 수를 줄여 무료 한도를 아낌)
    primaryBatch: num(env.GEMINI_PRIMARY_BATCH, 4),
    liteBatch: num(env.GEMINI_LITE_BATCH, 10),
  },
};
