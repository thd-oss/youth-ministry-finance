import {
  COMMON_EXPENSE_SUBCATEGORIES,
  GeminiModelOption,
  LedgerAccount,
  MokjangExpenseSubType,
  MokjangGroup,
  PaymentMethod,
} from '../types/finance';

export interface ReceiptAiAnalysisResult {
  amount: number;
  date: string; // YYYY-MM-DD
  storeName: string;
  title: string;
  memo: string;
  category: string;
  subCategory: string;
  paymentMethod: PaymentMethod;
  account: LedgerAccount;
  mokjangId?: string;
  mokjangSubType?: MokjangExpenseSubType;
  summaryComment: string;
}

export const FALLBACK_GEMINI_MODELS: GeminiModelOption[] = [
  {
    id: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash Preview (최신 고속 비전 · 권장)',
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    displayName: 'Gemini 3.1 Flash-Lite Preview (초경량 고속)',
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview (고정밀 다품목 판독)',
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash (안정형 비전 모델)',
  },
  {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash (호환용 경량 모델)',
  },
];

export function sanitizeGeminiApiKey(rawKey: string): string {
  return (rawKey || '').replace(/[\s"'`]/g, '').trim();
}

/**
 * 모델 정렬 우선순위 점수 계산:
 * 최신 세대(Gemini 3.x > 2.5 > 2.0) 및 영수증 판독에 최적화된 Flash 모델을 상단에 배치합니다.
 */
function scoreModelPriority(modelId: string): number {
  let score = 0;

  if (modelId.startsWith('gemini-3')) score += 300;
  else if (modelId.startsWith('gemini-2.5')) score += 200;
  else if (modelId.startsWith('gemini-2.0')) score += 100;

  if (modelId.includes('flash') && !modelId.includes('lite')) score += 40;
  else if (modelId.includes('flash-lite')) score += 30;
  else if (modelId.includes('pro')) score += 20;

  // 날짜 스냅샷(-001, -05-20 등)보다 대표 별칭(alias) 모델 우선
  if (!/\d{3,4}|-\d{2}-\d{2}/.test(modelId)) score += 10;
  if (modelId.includes('latest')) score -= 5;

  return score;
}

/**
 * 사용자의 Gemini API Key로 Google 서버(GET /v1beta/models)에 질의하여
 * 현재 계정에서 실제 호출 가능한(generateContent 지원) Gemini 모델 목록을 읽어옵니다.
 */
export async function fetchAvailableGeminiModels(apiKey: string): Promise<{
  ok: boolean;
  models: GeminiModelOption[];
  recommendedModelId?: string;
  message: string;
}> {
  const cleanKey = sanitizeGeminiApiKey(apiKey);
  if (!cleanKey) {
    return {
      ok: false,
      models: [],
      message: '먼저 Gemini API 키를 입력해 주세요.',
    };
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(
      cleanKey
    )}`;
    const res = await fetch(endpoint, { method: 'GET' });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const errMsg =
        errJson?.error?.message || `API 키 인증 실패 (HTTP ${res.status})`;
      return {
        ok: false,
        models: [],
        message: `❌ 모델 목록 조회 실패: ${errMsg}`,
      };
    }

    const data = await res.json();
    const rawModels: Array<{
      name?: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }> = Array.isArray(data?.models) ? data.models : [];

    // 영수증 이미지/텍스트 분석(generateContent)에 사용할 수 없는 특수 전용 모델 제외 키워드
    const excludedKeywords = [
      'tts',
      'embedding',
      'imagen',
      'veo',
      'aqa',
      'audio',
      'robotics',
      'computer-use',
      'learnlm',
      'gemma',
      'nano',
      'image-generation',
      '-image',
      'bisheng',
    ];

    const filtered: GeminiModelOption[] = rawModels
      .filter((m) => {
        const name = m.name || '';
        const id = name.replace(/^models\//, '');
        if (!id.startsWith('gemini-')) return false;
        const methods = m.supportedGenerationMethods || [];
        if (!methods.includes('generateContent')) return false;
        const lowerId = id.toLowerCase();
        if (excludedKeywords.some((kw) => lowerId.includes(kw))) return false;
        return true;
      })
      .map((m) => {
        const id = (m.name || '').replace(/^models\//, '');
        return {
          id,
          displayName: m.displayName ? `${m.displayName} (${id})` : id,
          description: m.description,
        };
      })
      .sort((a, b) => scoreModelPriority(b.id) - scoreModelPriority(a.id));

    if (filtered.length === 0) {
      return {
        ok: false,
        models: [],
        message:
          '❌ 해당 API 키에서 generateContent를 지원하는 Gemini 모델을 찾지 못했습니다.',
      };
    }

    const recommendedModelId = filtered[0].id;

    return {
      ok: true,
      models: filtered,
      recommendedModelId,
      message: `✅ 사용 가능한 모델 ${filtered.length}개를 불러왔습니다. 아래에서 고정할 모델을 선택하세요.`,
    };
  } catch (e) {
    return {
      ok: false,
      models: [],
      message: `❌ 네트워크 오류로 모델 목록을 불러오지 못했습니다 (${
        e instanceof Error ? e.message : '연결 실패'
      }).`,
    };
  }
}

/**
 * 사용자가 선택한 특정 Gemini 모델이 실제 generateContent 요청에 정상 응답하는지 검증합니다.
 */
export async function testGeminiConnection(
  apiKey: string,
  model: string
): Promise<{ ok: boolean; message: string; verifiedModel: string }> {
  const cleanKey = sanitizeGeminiApiKey(apiKey);
  const targetModel = (model || 'gemini-3-flash-preview')
    .replace(/^models\//, '')
    .trim();

  if (!cleanKey) {
    return {
      ok: false,
      verifiedModel: targetModel,
      message: 'API 키를 입력해 주세요.',
    };
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      targetModel
    )}:generateContent?key=${encodeURIComponent(cleanKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: '연결 확인 테스트입니다. OK 라고만 답하세요.' }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const rawErrMsg = errJson?.error?.message || `HTTP ${res.status}`;
      return {
        ok: false,
        verifiedModel: targetModel,
        message: `❌ [${targetModel}] 모델 호출 실패: ${rawErrMsg} (목록에서 다른 Flash 모델을 선택해 보세요)`,
      };
    }

    const data = await res.json();
    const hasCandidate =
      Array.isArray(data?.candidates) && data.candidates.length > 0;
    if (!hasCandidate) {
      return {
        ok: false,
        verifiedModel: targetModel,
        message: `❌ [${targetModel}] 응답이 비어 있습니다. 다른 모델을 선택해 주세요.`,
      };
    }

    return {
      ok: true,
      verifiedModel: targetModel,
      message: `✅ [${targetModel}] 모델 검증 및 고정 완료! 이제 영수증 사진을 올리면 이 모델로 자동 추출합니다.`,
    };
  } catch (e) {
    return {
      ok: false,
      verifiedModel: targetModel,
      message: `❌ 네트워크 오류로 연결을 확인할 수 없습니다 (${
        e instanceof Error ? e.message : '오류'
      }).`,
    };
  }
}

/**
 * 사용자의 Gemini API Key와 고정된 모델을 이용해 영수증 이미지를 멀티모달로 분석하고
 * 장부 입력에 필요한 모든 필드를 JSON Schema(Structured Output)로 추출합니다.
 */
export async function analyzeReceiptWithGemini(params: {
  imageDataUrl: string;
  apiKey: string;
  model?: string;
  expenseCategories: string[];
  mokjangs: MokjangGroup[];
  defaultYearMonth: string;
}): Promise<ReceiptAiAnalysisResult> {
  const {
    imageDataUrl,
    apiKey,
    model = 'gemini-3-flash-preview',
    expenseCategories,
    mokjangs,
    defaultYearMonth,
  } = params;

  const cleanKey = sanitizeGeminiApiKey(apiKey);
  if (!cleanKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const targetModel = model.replace(/^models\//, '').trim();

  const commaIndex = imageDataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('올바른 이미지 데이터 형식이 아닙니다.');
  }

  const header = imageDataUrl.slice(0, commaIndex);
  const base64Data = imageDataUrl.slice(commaIndex + 1);
  const mimeMatch = header.match(/data:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  let finalMimeType = mimeType;
  let finalBase64 = base64Data;

  if (mimeType.includes('svg')) {
    const rasterized = await rasterizeDataUrlToJpeg(imageDataUrl);
    finalMimeType = 'image/jpeg';
    finalBase64 = rasterized.split(',')[1];
  }

  const categoryListStr =
    expenseCategories.length > 0
      ? expenseCategories.join(', ')
      : '간식/다과비, 예배/양육비, 수련회/행사비, 심방/축하/조의, 주보/인쇄/비품, 기타운영비';

  const mokjangListStr =
    mokjangs.length > 0
      ? mokjangs.map((m) => `${m.id}:${m.name}(${m.leaderName})`).join(', ')
      : '없음';

  const systemPrompt = `당신은 한국 교회 청년부 회계 장부 자동 기장 AI 어시스턴트입니다.
첨부된 영수증(매출전표, 현금영수증, 모바일 영수증, 이체내역 등) 이미지를 정밀하게 읽고 다음 규칙에 따라 JSON을 반환하세요:

1. amount: 최종 결제 합계 금액(숫자만, 원화 기준 정수).
2. date: 영수증에 찍힌 거래일자(YYYY-MM-DD 형식). 만약 연도나 일자가 흐릿하면 '${defaultYearMonth}-15'와 같이 '${defaultYearMonth}' 기준 날짜로 보정하세요.
3. storeName: 영수증 상의 가맹점명(상호명).
4. title: 회계 장부 '적요' 칸에 들어갈 깔끔한 제목. 형식: "가맹점명 (핵심 구매목적/품목 요약)" (예: "김밥천국 역삼본점 (주일 소그룹 간식)", "교보문고 강남점 (리더 양육 도서)").
5. memo: 회계 감사 및 결산 보고서용 '상세 산출근거 메모'. 영수증에 적힌 품목명, 단가, 수량을 파악하여 "품목명 단가원×수량개" 형태로 한눈에 보이게 작성하세요 (예: "야채김밥 3,500원×20줄", "아메리카노 4,500원×6잔"). 세부 품목이 안 보이면 총액 기준으로 작성하세요.
6. category: 반드시 다음 1차 관/항(사역 목적) 목록 중에서 가장 적합한 하나를 골라 정확히 동일한 문자열로 반환하세요: [${categoryListStr}].
7. subCategory: 지출 성질/품목(2차 세목)을 다음 목록 중에서 가장 알맞은 하나로 반환하세요: [${COMMON_EXPENSE_SUBCATEGORIES.join(', ')}]. (예: 식당·카페·간식이면 '식비·간식/다과', 서점이면 '교재·도서·양육물품', 인쇄소면 '주보·인쇄·홍보물').
8. paymentMethod: 영수증 결제수단을 판별하여 ['체크카드', '계좌이체', '현금', '개인선결제(청구)'] 중 하나로 반환하세요. 카드 전표면 '체크카드'를 기본으로 선택하세요.
9. account: 일반 운영/간식/심방/예배/비품이면 'general', 수련회/캠프/행사 관련이면 'retreat', 선교/목적헌금 관련이면 'mission'으로 반환하세요.
10. mokjangId: 영수증 메모나 품목에 특정 목장(${mokjangListStr})이 명시되어 있을 때만 해당 목장 id(예: 'mj-1')를 반환하고, 없으면 빈 문자열("")로 반환하세요.
11. mokjangSubType: 심방/선물/병문안/축하 성격이면 'visitation', 식사/다과/카페/모임 성격이면 'fellowship'으로 반환하세요.
12. summaryComment: 사용자에게 보여줄 1줄 완료 브리핑 (예: "김밥천국 70,000원 · 품목 산출근거 추출 완료").`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    targetModel
  )}:generateContent?key=${encodeURIComponent(cleanKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: finalMimeType,
                data: finalBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            amount: { type: 'INTEGER' },
            date: { type: 'STRING' },
            storeName: { type: 'STRING' },
            title: { type: 'STRING' },
            memo: { type: 'STRING' },
            category: { type: 'STRING' },
            subCategory: { type: 'STRING' },
            paymentMethod: {
              type: 'STRING',
              enum: ['체크카드', '계좌이체', '현금', '개인선결제(청구)'],
            },
            account: {
              type: 'STRING',
              enum: ['general', 'retreat', 'mission'],
            },
            mokjangId: { type: 'STRING' },
            mokjangSubType: {
              type: 'STRING',
              enum: ['visitation', 'fellowship'],
            },
            summaryComment: { type: 'STRING' },
          },
          required: [
            'amount',
            'date',
            'storeName',
            'title',
            'memo',
            'category',
            'paymentMethod',
            'account',
            'summaryComment',
          ],
        },
      },
    }),
  });

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errDetail = errJson?.error?.message || errDetail;
    } catch {
      // ignore
    }
    throw new Error(`[${targetModel}] API 호출 실패 (${errDetail})`);
  }

  const data = await response.json();
  const parts: Array<{ text?: string; thought?: boolean }> =
    data?.candidates?.[0]?.content?.parts || [];

  // Thinking 모델(Gemini 2.5 / 3)의 경우 thought 파트 뒤에 실제 JSON 텍스트 파트가 위치하므로 비-thought 파트를 우선 추출
  const nonThoughtPart = [...parts]
    .reverse()
    .find((p) => !p.thought && typeof p.text === 'string' && p.text.trim());
  const rawText = (nonThoughtPart?.text || parts?.[0]?.text || '').trim();

  if (!rawText) {
    throw new Error('Gemini로부터 분석 결과를 받지 못했습니다.');
  }

  const cleanedJsonText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleanedJsonText) as ReceiptAiAnalysisResult;

  // 카테고리 유효성 보정
  const matchedCategory =
    expenseCategories.find((c) => c === parsed.category) ||
    expenseCategories.find(
      (c) =>
        c.includes(parsed.category) || parsed.category.includes(c.split('/')[0])
    ) ||
    expenseCategories[0] ||
    '간식/다과비';

  // 날짜 형식(YYYY-MM-DD) 보정
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = dateRegex.test(parsed.date)
    ? parsed.date
    : `${defaultYearMonth}-15`;

  return {
    amount: Math.max(0, Number(parsed.amount) || 0),
    date: validDate,
    storeName: parsed.storeName || '영수증 가맹점',
    title: parsed.title || parsed.storeName || '지출 내역',
    memo: parsed.memo || '',
    category: matchedCategory,
    subCategory: parsed.subCategory || '식비·간식/다과',
    paymentMethod: parsed.paymentMethod || '체크카드',
    account: parsed.account || 'general',
    mokjangId: parsed.mokjangId || undefined,
    mokjangSubType: parsed.mokjangSubType || undefined,
    summaryComment:
      parsed.summaryComment ||
      `${parsed.storeName || '영수증'} ${(Number(parsed.amount) || 0).toLocaleString('ko-KR')}원 자동 판독 완료`,
  };
}

function rasterizeDataUrlToJpeg(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('SVG 이미지 변환 실패'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 460;
      canvas.height = img.naturalHeight || 550;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 컨텍스트 오류'));
        return;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}
