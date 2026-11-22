import { ReceiptMetadata } from '../types/finance';

export interface CompressedImageResult {
  dataUrl: string;
  meta: ReceiptMetadata;
}

/** 긴 영수증 판정 종횡비(높이 / 너비) 임계값 */
const LONG_RECEIPT_ASPECT_THRESHOLD = 2.2;
/** 일반 영수증 최대 가로 해상도 (px) */
const DEFAULT_MAX_WIDTH_PX = 1200;
/** 긴 영수증 최대 가로 해상도 (px) — A4 2열 300 DPI 가독성 확보 */
const LONG_RECEIPT_MAX_WIDTH_PX = 1000;
/** iOS Safari 16.7MP Canvas 상한 대비 안전 픽셀 면적 한도 */
const MAX_CANVAS_PIXELS = 8_000_000;
/** 초장문 영수증 세로 픽셀 상한 */
const MAX_CANVAS_HEIGHT_PX = 8000;
/** 일반/긴 영수증 Base64 목표 용량 상한 (KB) */
const NORMAL_TARGET_MAX_KB = 350;
const LONG_TARGET_MAX_KB = 650;
/** 기본 JPEG 품질 및 용량 초과 시 단계적 하향 품질 표 */
const DEFAULT_NORMAL_QUALITY = 0.8;
const NORMAL_QUALITY_FALLBACK_STEPS = [0.72, 0.64] as const;
const LONG_QUALITY_STEPS = [0.76, 0.68, 0.6] as const;

function estimateDataUrlSizeKb(dataUrl: string): number {
  const base64Length = dataUrl.split(',')[1]?.length || 0;
  return Math.max(1, Math.round((base64Length * 3) / 4 / 1024));
}

/**
 * 종횡비에 따라 가독성(가로 폭)과 Canvas 메모리·로컬 스토리지 안전 한도를
 * 함께 만족하는 리사이징 크기를 계산합니다.
 */
function computeAdaptiveDimensions(
  naturalWidth: number,
  naturalHeight: number,
  requestedMaxWidth: number
): { width: number; height: number; isLongReceipt: boolean } {
  const safeWidth = Math.max(1, naturalWidth);
  const safeHeight = Math.max(1, naturalHeight);
  const aspect = safeHeight / safeWidth;
  const isLongReceipt = aspect > LONG_RECEIPT_ASPECT_THRESHOLD;

  const widthCap = isLongReceipt
    ? Math.min(requestedMaxWidth, LONG_RECEIPT_MAX_WIDTH_PX)
    : requestedMaxWidth;

  let targetWidth = safeWidth;
  let targetHeight = safeHeight;

  if (targetWidth > widthCap) {
    const ratio = widthCap / targetWidth;
    targetWidth = widthCap;
    targetHeight = targetHeight * ratio;
  }

  if (targetHeight > MAX_CANVAS_HEIGHT_PX) {
    const ratio = MAX_CANVAS_HEIGHT_PX / targetHeight;
    targetHeight = MAX_CANVAS_HEIGHT_PX;
    targetWidth = targetWidth * ratio;
  }

  const totalPixels = targetWidth * targetHeight;
  if (totalPixels > MAX_CANVAS_PIXELS) {
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / totalPixels);
    targetWidth = targetWidth * scale;
    targetHeight = targetHeight * scale;
  }

  return {
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(targetHeight)),
    isLongReceipt,
  };
}

/**
 * 목표 용량(KB) 이내로 들어올 때까지 해상도는 유지한 채 JPEG 품질만 단계적으로 조절합니다.
 */
function encodeAdaptiveJpeg(
  canvas: HTMLCanvasElement,
  isLongReceipt: boolean,
  requestedQuality: number
): { dataUrl: string; sizeKb: number } {
  const targetMaxKb = isLongReceipt ? LONG_TARGET_MAX_KB : NORMAL_TARGET_MAX_KB;
  const candidateSteps = isLongReceipt
    ? LONG_QUALITY_STEPS.map((step) => Math.min(requestedQuality, step))
    : [
        requestedQuality,
        ...NORMAL_QUALITY_FALLBACK_STEPS.filter((step) => step < requestedQuality),
      ];

  const uniqueSteps = Array.from(new Set(candidateSteps));
  let bestDataUrl = '';
  let bestSizeKb = 0;

  for (const q of uniqueSteps) {
    const encoded = canvas.toDataURL('image/jpeg', q);
    const sizeKb = estimateDataUrlSizeKb(encoded);
    bestDataUrl = encoded;
    bestSizeKb = sizeKb;
    if (sizeKb <= targetMaxKb) {
      break;
    }
  }

  return { dataUrl: bestDataUrl, sizeKb: bestSizeKb };
}

/**
 * 클라이언트 단 Canvas API를 사용하여 영수증 이미지를 종횡비 적응형으로 리사이징·압축합니다.
 * - 일반 영수증(세로/가로 <= 2.2): 최대 폭 1200px, 품질 0.80, 목표 350KB
 * - 긴 영수증(세로/가로 > 2.2): 최대 폭 1000px + 8MP/8000px 가드, 목표 650KB (품질 0.76 -> 0.68 -> 0.60)
 */
export function compressReceiptImage(
  file: File,
  maxWidth = DEFAULT_MAX_WIDTH_PX,
  quality = DEFAULT_NORMAL_QUALITY
): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지 파일을 읽는 중 오류가 발생했습니다.'));
    reader.onload = (event) => {
      const srcDataUrl = event.target?.result as string;
      if (!srcDataUrl) {
        reject(new Error('이미지 데이터가 비어 있습니다.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('이미지 디코딩에 실패했습니다.'));
      img.onload = () => {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        const {
          width: targetWidth,
          height: targetHeight,
          isLongReceipt,
        } = computeAdaptiveDimensions(naturalWidth, naturalHeight, maxWidth);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.'));
          return;
        }

        // 투명 PNG 등의 배경이 검게 변하지 않도록 순백색(#FFFFFF) 배경 칠하기
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const { dataUrl: compressedDataUrl, sizeKb } = encodeAdaptiveJpeg(
          canvas,
          isLongReceipt,
          quality
        );

        // 대용량 Canvas GPU 버퍼 즉시 해제
        canvas.width = 0;
        canvas.height = 0;

        resolve({
          dataUrl: compressedDataUrl,
          meta: {
            width: targetWidth,
            height: targetHeight,
            sizeKb,
            fileName: file.name,
          },
        });
      };
      img.src = srcDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export interface MockReceiptItem {
  name: string;
  unitPrice: number;
  qty: number;
  amount: number;
}

export interface MockReceiptParams {
  storeName: string;
  bizNo: string;
  ownerName: string;
  address: string;
  dateTime: string;
  approvalNo: string;
  cardName: string;
  category: string;
  totalAmount: number;
  items: MockReceiptItem[];
  note?: string;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 실제 감열지 영수증 형태의 고해상도 SVG Data URL을 생성합니다.
 */
export function generateMockReceiptSvgDataUrl(params: MockReceiptParams): string {
  const supplyValue = Math.round(params.totalAmount / 1.1);
  const vatValue = params.totalAmount - supplyValue;

  const itemRowsSvg = params.items
    .map((item, idx) => {
      const y = 278 + idx * 28;
      return `
        <text x="36" y="${y}" font-family="'Pretendard Variable', Pretendard, monospace" font-size="13" fill="#191F28">${escapeXml(item.name)}</text>
        <text x="275" y="${y}" font-family="'Pretendard Variable', Pretendard, monospace" font-size="13" fill="#4E5968" text-anchor="end">${item.unitPrice.toLocaleString('ko-KR')}</text>
        <text x="325" y="${y}" font-family="'Pretendard Variable', Pretendard, monospace" font-size="13" fill="#4E5968" text-anchor="end">${item.qty}</text>
        <text x="424" y="${y}" font-family="'Pretendard Variable', Pretendard, monospace" font-size="13" font-weight="600" fill="#191F28" text-anchor="end">${item.amount.toLocaleString('ko-KR')}</text>
      `;
    })
    .join('');

  const itemsEndY = 278 + params.items.length * 28 + 10;
  const totalSectionY = itemsEndY + 24;
  const height = totalSectionY + 210;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="${height}" viewBox="0 0 460 ${height}">
    <rect width="460" height="${height}" fill="#F9FAFB"/>
    <rect x="16" y="14" width="428" height="${height - 28}" rx="8" fill="#FFFFFF" stroke="#D1D6DB" stroke-width="1.2"/>
    
    <!-- 상단 영수증 헤더 -->
    <text x="230" y="52" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="20" font-weight="700" fill="#191F28" text-anchor="middle">[신용카드 매출전표]</text>
    <text x="230" y="74" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12" fill="#4E5968" text-anchor="middle">청년부 회계 지출 증빙용 · ${escapeXml(params.category)}</text>

    <!-- 가맹점 정보 -->
    <line x1="32" y1="90" x2="428" y2="90" stroke="#8B95A1" stroke-dasharray="4 3" stroke-width="1"/>
    <text x="36" y="114" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="15" font-weight="700" fill="#191F28">가맹점명 : ${escapeXml(params.storeName)}</text>
    <text x="36" y="136" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" fill="#4E5968">사업자번호 : ${escapeXml(params.bizNo)}   대표자 : ${escapeXml(params.ownerName)}</text>
    <text x="36" y="156" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" fill="#4E5968">주소 : ${escapeXml(params.address)}</text>
    <text x="36" y="176" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" fill="#191F28" font-weight="600">거래일시 : ${escapeXml(params.dateTime)}</text>
    <line x1="32" y1="192" x2="428" y2="192" stroke="#8B95A1" stroke-dasharray="4 3" stroke-width="1"/>

    <!-- 품목 테이블 헤더 -->
    <text x="36" y="216" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" font-weight="700" fill="#4E5968">품목명</text>
    <text x="275" y="216" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" font-weight="700" fill="#4E5968" text-anchor="end">단가</text>
    <text x="325" y="216" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" font-weight="700" fill="#4E5968" text-anchor="end">수량</text>
    <text x="424" y="216" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" font-weight="700" fill="#4E5968" text-anchor="end">금액</text>
    <line x1="32" y1="228" x2="428" y2="228" stroke="#E5E8EB" stroke-width="1.5"/>

    <!-- 품목 리스트 -->
    ${itemRowsSvg}

    <line x1="32" y1="${itemsEndY}" x2="428" y2="${itemsEndY}" stroke="#8B95A1" stroke-dasharray="4 3" stroke-width="1"/>

    <!-- 공급가액 / 부가세 / 합계 -->
    <text x="36" y="${totalSectionY}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="13" fill="#4E5968">공급가액</text>
    <text x="424" y="${totalSectionY}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="13" fill="#191F28" text-anchor="end">${supplyValue.toLocaleString('ko-KR')}원</text>

    <text x="36" y="${totalSectionY + 24}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="13" fill="#4E5968">부가세(VAT)</text>
    <text x="424" y="${totalSectionY + 24}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="13" fill="#191F28" text-anchor="end">${vatValue.toLocaleString('ko-KR')}원</text>

    <rect x="32" y="${totalSectionY + 38}" width="396" height="40" rx="6" fill="#F2F4F6"/>
    <text x="46" y="${totalSectionY + 64}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="16" font-weight="700" fill="#191F28">합계금액 (결제금액)</text>
    <text x="414" y="${totalSectionY + 64}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="18" font-weight="700" fill="#191F28" text-anchor="end">${params.totalAmount.toLocaleString('ko-KR')}원</text>

    <!-- 승인 정보 -->
    <text x="36" y="${totalSectionY + 102}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" fill="#4E5968">결제수단 : ${escapeXml(params.cardName)} (일시불)</text>
    <text x="36" y="${totalSectionY + 122}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12.5" fill="#4E5968">승인번호 : ${escapeXml(params.approvalNo)}   [정상승인]</text>
    ${params.note ? `<text x="36" y="${totalSectionY + 142}" font-family="'Pretendard Variable', Pretendard, sans-serif" font-size="12" fill="#3182F6" font-weight="600">비고 : ${escapeXml(params.note)}</text>` : ''}

    <!-- 하단 바코드 -->
    <g transform="translate(85, ${totalSectionY + 154})">
      <rect x="0" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="8" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="14" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="24" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="30" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="40" y="0" width="8" height="28" fill="#191F28"/>
      <rect x="52" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="58" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="68" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="78" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="84" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="94" y="0" width="8" height="28" fill="#191F28"/>
      <rect x="106" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="112" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="122" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="132" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="140" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="150" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="158" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="166" y="0" width="8" height="28" fill="#191F28"/>
      <rect x="178" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="184" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="194" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="204" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="210" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="220" y="0" width="8" height="28" fill="#191F28"/>
      <rect x="232" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="238" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="248" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="256" y="0" width="2" height="28" fill="#191F28"/>
      <rect x="262" y="0" width="6" height="28" fill="#191F28"/>
      <rect x="272" y="0" width="4" height="28" fill="#191F28"/>
      <rect x="280" y="0" width="6" height="28" fill="#191F28"/>
    </g>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
