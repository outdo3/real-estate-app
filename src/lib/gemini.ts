// Gemini REST API 직접 호출 헬퍼. 이 프로젝트는 외부 API를 전부 SDK 없이 fetch로
// 직접 호출하는 방식을 써왔다(MOLIT/Naver/K-APT 등) — Gemini도 같은 관례를 따른다.
// flash-lite는 이 앱이 필요로 하는 분류/요약 수준의 작업에 충분하고, 확장 사고
// (thinking) 토큰을 쓰지 않아 같은 요청 기준 flash-latest 대비 토큰 사용량이 10배 이상
// 적다(실측: flash-latest 425토큰 vs flash-lite-latest 38토큰) — 비용 최소화 요구사항과
// 직결되는 선택.
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function getApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

// JSON 스키마를 강제해서 자유 텍스트 파싱(정규식 등)의 불안정함을 피한다 — Gemini가
// responseSchema에 맞는 JSON만 반환하도록 요청한다.
// temperature: 0 — 분류 작업은 결정적이어야 한다. 실측 결과 0.2에서는 동일 질문도
// 5회 중 1회꼴로 다르게 분류되는 문제가 있었다(예: 명백한 조건검색 질문이 지역통계로
// 오분류됨). 0으로 낮춰도 Gemini는 완전한 결정성을 보장하지 않지만 관측 편차를 줄인다.
export async function callGeminiJSON<T>(prompt: string, schema: Record<string, unknown>): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${GEMINI_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('Gemini API error', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (e) {
    console.error('Gemini call failed', e);
    return null;
  }
}

// 자유 텍스트 응답(브리핑 문장용) — JSON 스키마가 필요 없는 경우.
export async function callGeminiText(prompt: string): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${GEMINI_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('Gemini API error', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' ? text.trim() : null;
  } catch (e) {
    console.error('Gemini call failed', e);
    return null;
  }
}
