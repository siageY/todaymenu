// api/menu.js
export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body = {};
  try {
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body || '{}');
    } else if (req.body && typeof req.body === 'object') {
      body = req.body;
    }
  } catch {
    return res.status(400).json({ error: '잘못된 요청 형식(JSON)입니다.' });
  }

  const { mood, mealTime, weather, fortune } = body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  const prompt = `
당신은 재치 있고 센스 넘치는 '운세 기반 메뉴 점술가'입니다.
아래 사용자의 현재 상태를 보고, 오늘 기운을 북돋아 줄 딱 한 가지의 구체적인 메뉴를 추천해 주세요.

[사용자 정보]
- 식사 시간대: ${mealTime || '아무 때나'}
- 현재 기분/상태: ${mood || '보통'}
- 오늘 날씨/분위기: ${weather || '무난함'}
- 참고할 오늘의 운세 키워드: ${fortune || '평온함'}

[응답 규칙]
1. 반드시 아래 JSON 형식으로만 응답하고, 마크다운(\`\`\`json)이나 다른 설명은 절대 붙이지 마세요.
2. 메뉴는 구체적인 음식 이름으로 정해주세요 (예: 한식 대신 '얼큰한 차돌박이 순두부찌개').
3. 추천 이유는 운세/기분과 엮어서 유머러스하고 설득력 있게 2~3문장으로 작성하세요.

{
  "menu": "추천 메뉴 이름",
  "emoji": "음식과 어울리는 이모지 1개",
  "luckyPoint": "행운 포인트 (예: 붉은 국물이 액운을 막아줌)",
  "reason": "운세와 기분을 엮은 센스 있는 추천 이유",
  "sideTip": "함께 곁들이면 좋은 음료나 디저트 한 줄 팁"
}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.8
    }
  });

  try {
    let data = null;
    let lastErrorMessage = 'Gemini API 호출 실패';

    // 일시적 과부하(503/429 등) 시 최대 3회까지 재시도
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });

      const rawText = await response.text();
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
        lastErrorMessage = `Gemini API 응답 파싱 실패 (status ${response.status})`;
      }

      if (response.ok && data) {
        break;
      }

      lastErrorMessage = data?.error?.message || lastErrorMessage;
      const isRetryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!isRetryable || attempt === 2) {
        if (lastErrorMessage.includes('high demand')) {
          throw new Error('현재 AI 서버 요청이 몰려 지연되고 있습니다. 잠시 후 다시 버튼을 눌러주세요.');
        }
        throw new Error(lastErrorMessage);
      }

      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }

    const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      throw new Error('Gemini API로부터 추천 결과를 받지 못했습니다.');
    }

    const cleanedText = resultText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const parsedResult = JSON.parse(cleanedText);

    if (!parsedResult || !parsedResult.menu) {
      throw new Error('추천 메뉴 형식이 올바르지 않습니다.');
    }

    return res.status(200).json(parsedResult);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message || '메뉴를 점지하는 도중 오류가 발생했습니다.' });
  }
}
