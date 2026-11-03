// Gemini API 클라이언트 — 무료 티어 보호 장치 포함
//  - 분당 요청 수(RPM)를 설정값 이하로 간격 조절
//  - 한 번 실행당 최대 호출 수 제한
//  - 429(한도 초과) 시 짧게 한 번만 재시도, 일일 한도면 즉시 중단 (재시도 폭주 없음)
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class QuotaExhaustedError extends Error {}

export class GeminiClient {
  constructor({ apiKey, model, rpm, maxCalls, label }) {
    this.apiKey = apiKey;
    this.model = model;
    this.minGapMs = Math.ceil(60000 / Math.max(1, rpm));
    this.maxCalls = maxCalls;
    this.label = label || model;
    this.calls = 0;
    this.lastCallAt = 0;
    this.exhausted = false;
  }

  get available() {
    return !!this.apiKey && !this.exhausted && this.calls < this.maxCalls;
  }

  async generateJSON(prompt, schema) {
    if (!this.available) throw new QuotaExhaustedError(`${this.label}: 이번 실행의 호출 한도에 도달`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const wait = this.lastCallAt + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      this.calls++;

      const res = await fetch(`${BASE}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
        }),
        signal: AbortSignal.timeout(120000),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 429) {
        const msg = JSON.stringify(body.error || {});
        const retry = (body.error?.details || []).find((d) => d['@type']?.includes('RetryInfo'))?.retryDelay;
        const retrySec = retry ? parseFloat(retry) : 60;
        // 일일 한도 초과면 오늘은 더 부르지 않음
        if (/PerDay|per day|daily/i.test(msg) || attempt === 2 || retrySec > 90) {
          this.exhausted = true;
          throw new QuotaExhaustedError(`${this.label}: 무료 한도 초과로 이번 실행 중단 (${body.error?.message || 429})`);
        }
        console.warn(`[${this.label}] 분당 한도 초과, ${Math.ceil(retrySec)}초 후 1회 재시도`);
        await sleep(retrySec * 1000 + 1000);
        continue;
      }
      if (!res.ok) {
        const err = new Error(`[${this.label}] HTTP ${res.status}: ${body.error?.message || ''}`);
        // 결제 필요·권한 문제 등은 진행 불가
        if ([400, 401, 403, 404].includes(res.status)) this.exhausted = true;
        throw err;
      }
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`[${this.label}] JSON 파싱 실패: ${text.slice(0, 200)}`);
      }
    }
  }
}
