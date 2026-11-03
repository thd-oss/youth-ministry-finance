import {
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
  paymentMethod: PaymentMethod;
  account: LedgerAccount;
  mokjangId?: string;
  mokjangSubType?: MokjangExpenseSubType;
  summaryComment: string;
}

/**
 * 사용자의 Gemini API Key를 이용해 영수증 이미지를 멀티모달로 분석하고
 * 장부 입력에 필요한 모든 필드(금액, 거래일자, 가맹점/적요, 품목별 단가×수량 산출근거, 추천 관/항 카테고리)를
 * JSON Schema(Structured Output)로 정확히 추출합니다.
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
    model = 'gemini-2.5-flash',
    expenseCategories,
    mokjangs,
    defaultYearMonth,
  } = params;

  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const commaIndex = imageDataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('올바른 이미지 데이터 형식이 아닙니다.');
  }

  const header = imageDataUrl.slice(0, commaIndex);
  const base64Data = imageDataUrl.slice(commaIndex + 1);
  const mimeMatch = header.match(/data:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  // SVG Data URL인 경우 Canvas를 통해 PNG로 래스터화하거나 텍스트 디코딩으로 전달
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
6. category: 반드시 다음 활성 관/항 카테고리 목록 중에서 가장 적합한 하나를 골라 정확히 동일한 문자열로 반환하세요: [${categoryListStr}].
7. paymentMethod: 영수증 결제수단을 판별하여 ['체크카드', '계좌이체', '현금', '개인선결제(청구)'] 중 하나로 반환하세요. 카드 전표면 '체크카드'를 기본으로 선택하세요.
8. account: 일반 운영/간식/심방/예배/비품이면 'general', 수련회/캠프/행사 관련이면 'retreat', 선교/목적헌금 관련이면 'mission'으로 반환하세요.
9. mokjangId: 영수증 메모나 품목에 특정 목장(${mokjangListStr})이 명시되어 있을 때만 해당 목장 id(예: 'mj-1')를 반환하고, 없으면 빈 문자열("")로 반환하세요.
10. mokjangSubType: 심방/선물/병문안/축하 성격이면 'visitation', 식사/다과/카페/모임 성격이면 'fellowship'으로 반환하세요.
11. summaryComment: 사용자에게 보여줄 1줄 완료 브리핑 (예: "김밥천국 70,000원 · 품목 산출근거 추출 완료").`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
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
    throw new Error(`Gemini API 호출 실패 (${errDetail})`);
  }

  const data = await response.json();
  const rawText =
    data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!rawText) {
    throw new Error('Gemini로부터 분석 결과를 받지 못했습니다.');
  }

  const parsed = JSON.parse(rawText) as ReceiptAiAnalysisResult;

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
    paymentMethod: parsed.paymentMethod || '체크카드',
    account: parsed.account || 'general',
    mokjangId: parsed.mokjangId || undefined,
    mokjangSubType: parsed.mokjangSubType || undefined,
    summaryComment:
      parsed.summaryComment ||
      `${parsed.storeName || '영수증'} ${(Number(parsed.amount) || 0).toLocaleString('ko-KR')}원 자동 판독 완료`,
  };
}

/**
 * Gemini API 키가 정상 작동하는지 빠르게 연결 테스트합니다.
 */
export async function testGeminiConnection(
  apiKey: string,
  model = 'gemini-2.5-flash'
): Promise<{ ok: boolean; message: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, message: 'API 키를 입력해 주세요.' };
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(cleanKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: '연결 확인: OK만 답하세요.' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return {
        ok: false,
        message:
          errJson?.error?.message || `인증 실패 (HTTP ${res.status})`,
      };
    }

    return {
      ok: true,
      message: `✅ Gemini (${model}) 연결 성공! 이제 영수증 사진을 올리면 자동으로 내용을 채워줍니다.`,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : '네트워크 오류로 연결을 확인할 수 없습니다.',
    };
  }
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
