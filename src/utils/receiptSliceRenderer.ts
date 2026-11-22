import {
  ReceiptDensity,
  ReceiptSegment,
  SlotSegmentPlacement,
} from '../types/finance';
import { extractDriveFileId } from './googleDirectSync';
import { RECEIPT_SLOT_GEOMETRY } from './receiptGeometry';
import {
  getDriveBlobObjectUrl,
  invalidateDriveImageCache,
} from './receiptImageLoader';

/** iOS Safari Canvas 한계(16.7MP) 대비 안전 픽셀 면적·높이 상한 */
const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_CANVAS_HEIGHT_PX = 8000;
const SLICE_JPEG_QUALITY = 0.9;

/** .receipt-scan-filter (grayscale 100% · contrast 145% · brightness 105%) 픽셀 보정 계수 */
const SCAN_LUMA_R = 0.299;
const SCAN_LUMA_G = 0.587;
const SCAN_LUMA_B = 0.114;
const SCAN_CONTRAST_FACTOR = 1.45;
const SCAN_BRIGHTNESS_FACTOR = 1.05;
const SCAN_MIDPOINT = 128;

/** 300 DPI 합성 캔버스 조각 배지·테두리·연속 캡션 스타일 상수 */
const COMPOSITE_PIECE_BORDER_COLOR = '#D1D6DB';
const COMPOSITE_CUT_LINE_COLOR = '#4E5968';
const COMPOSITE_BADGE_BG = '#191F28';
const COMPOSITE_BADGE_FG = '#FFFFFF';
const COMPOSITE_BADGE_RADIUS_PX = 20;
const COMPOSITE_BADGE_MARGIN_PX = 10;
const COMPOSITE_CAPTION_HEIGHT_PX = 26;
const COMPOSITE_CAPTION_COLOR = '#4E5968';

const CIRCLED_NUMBERS = [
  '①',
  '②',
  '③',
  '④',
  '⑤',
  '⑥',
  '⑦',
  '⑧',
  '⑨',
  '⑩',
  '⑪',
  '⑫',
  '⑬',
  '⑭',
  '⑮',
  '⑯',
  '⑰',
  '⑱',
  '⑲',
  '⑳',
] as const;

export interface SegmentSliceRenderArgs {
  txId: string;
  src: string;
  segment: ReceiptSegment;
  scanFilter: boolean;
}

export interface SegmentSliceRenderResult {
  key: string;
  url?: string;
  fallbackSvg?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface SlotCompositeRenderArgs {
  txId: string;
  evidenceNo?: string;
  src: string;
  segments: ReceiptSegment[];
  placements: SlotSegmentPlacement[];
  density: ReceiptDensity;
  scanFilter: boolean;
  slotIndex: number;
  slotTotal: number;
  startPieceNumber: number;
}

export interface SlotCompositeRenderResult {
  key: string;
  url?: string;
  fallbackSvg?: boolean;
}

class CorsTaintError extends Error {
  constructor(message = 'CORS 제약으로 Canvas 인코딩이 차단되었습니다.') {
    super(message);
    this.name = 'CorsTaintError';
  }
}

interface CachedSliceEntry {
  url: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

const blobUrlCache = new Map<string, CachedSliceEntry>();
const inFlightTasks = new Map<string, Promise<unknown>>();

let scratchCanvas: HTMLCanvasElement | null = null;
let canvasQueue: Promise<void> = Promise.resolve();
let activeCanvasJobs = 0;

function formatCoordKey(value: number): string {
  return value.toFixed(4);
}

function getPieceNumberLabel(pieceNumber: number): string {
  if (pieceNumber >= 1 && pieceNumber <= CIRCLED_NUMBERS.length) {
    return CIRCLED_NUMBERS[pieceNumber - 1];
  }
  return `(${pieceNumber})`;
}

/**
 * 이미지 소스 문자열에 대한 경량 지문을 생성합니다 (Base64 전체 복사 방지).
 */
export function getImageSourceSig(src: string): string {
  if (!src) return 'empty';
  return `${src.length}:${src.slice(0, 32)}:${src.slice(-24)}`;
}

/**
 * 편집 화면용 개별 조각 캐시 키를 생성합니다.
 */
export function buildSegmentSliceCacheKey(args: SegmentSliceRenderArgs): string {
  const srcSig = getImageSourceSig(args.src);
  const { yStart, yEnd, xStart = 0, xEnd = 1 } = args.segment;
  return `seg|${args.txId}|${srcSig}|${formatCoordKey(yStart)}-${formatCoordKey(yEnd)}|${formatCoordKey(xStart)}-${formatCoordKey(xEnd)}|${args.scanFilter ? 'scan' : 'raw'}`;
}

/**
 * A4 미리보기·인쇄용 슬롯 합성 캐시 키를 생성합니다.
 */
export function buildSlotCompositeCacheKey(args: SlotCompositeRenderArgs): string {
  const srcSig = getImageSourceSig(args.src);
  const segById = new Map(args.segments.map((s) => [s.id, s]));
  const placementsSig = args.placements
    .map((p) => {
      const seg = segById.get(p.segmentId);
      const segSig = seg
        ? `${formatCoordKey(seg.yStart)}-${formatCoordKey(seg.yEnd)}`
        : 'na';
      return `${p.segmentId}(${segSig}):${formatCoordKey(p.x)},${formatCoordKey(p.y)},${formatCoordKey(p.w)},${formatCoordKey(p.h)},${p.z ?? 0}`;
    })
    .join(';');

  return `slot|${args.txId}|${srcSig}|${args.density}|${args.scanFilter ? 'scan' : 'raw'}|${args.slotIndex}/${args.slotTotal}|${args.startPieceNumber}|${placementsSig}`;
}

function getScratchCanvas(): HTMLCanvasElement {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
  }
  return scratchCanvas;
}

function enqueueCanvasJob<T>(
  job: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<T>
): Promise<T> {
  activeCanvasJobs += 1;
  const run = async (): Promise<T> => {
    const canvas = getScratchCanvas();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.');
    }
    try {
      return await job(canvas, ctx);
    } finally {
      activeCanvasJobs = Math.max(0, activeCanvasJobs - 1);
      if (activeCanvasJobs === 0 && scratchCanvas) {
        // Safari/iOS GPU 백킹 스토어 즉시 해제
        scratchCanvas.width = 0;
        scratchCanvas.height = 0;
      }
    }
  };

  const resultPromise = canvasQueue.then(run, run);
  canvasQueue = resultPromise.then(
    () => undefined,
    () => undefined
  );
  return resultPromise;
}

function loadHtmlImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) {
      img.crossOrigin = crossOrigin;
    }
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 디코딩에 실패했습니다.'));
    img.src = src;
  });
}

/**
 * 로컬 Data URL, Blob URL, 또는 Google Drive URL을 Canvas에서 안전하게 읽을 수 있는
 * 디코딩된 HTMLImageElement로 로드합니다. CORS 차단 시 CorsTaintError를 던집니다.
 */
async function loadCanvasSafeImage(src: string): Promise<HTMLImageElement> {
  if (!src) {
    throw new Error('이미지 소스가 비어 있습니다.');
  }

  if (src.startsWith('data:image/') || src.startsWith('blob:')) {
    return loadHtmlImage(src);
  }

  // Google Drive URL인 경우 공용 Drive Blob 캐시(OAuth alt=media)로 무손실 로드 (CORS 0%)
  const driveFileId = extractDriveFileId(src);
  if (driveFileId) {
    const blobUrl = await getDriveBlobObjectUrl(driveFileId);
    if (blobUrl) {
      try {
        return await loadHtmlImage(blobUrl);
      } catch {
        invalidateDriveImageCache(driveFileId);
        const refreshedUrl = await getDriveBlobObjectUrl(driveFileId, true);
        if (refreshedUrl) {
          try {
            return await loadHtmlImage(refreshedUrl);
          } catch {
            // 아래 anonymous CORS 폴백으로 진행
          }
        }
      }
    }
  }

  // 일반 외부 URL 또는 비로그인 Drive URL: anonymous CORS 시도 후 실패 시 SVG 폴백 유도
  try {
    return await loadHtmlImage(src, 'anonymous');
  } catch {
    throw new CorsTaintError();
  }
}

function clampCanvasDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  let targetW = Math.max(1, Math.round(width));
  let targetH = Math.max(1, Math.round(height));

  if (targetH > MAX_CANVAS_HEIGHT_PX) {
    const scale = MAX_CANVAS_HEIGHT_PX / targetH;
    targetW = Math.max(1, Math.round(targetW * scale));
    targetH = MAX_CANVAS_HEIGHT_PX;
  }

  const area = targetW * targetH;
  if (area > MAX_CANVAS_PIXELS) {
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / area);
    targetW = Math.max(1, Math.round(targetW * scale));
    targetH = Math.max(1, Math.round(targetH * scale));
  }

  return { width: targetW, height: targetH };
}

/**
 * Safari/iOS에서도 100% 동일하게 출력되도록 픽셀 루프로 스캔 보정 필터를 직접 베이킹합니다.
 */
function applyScanFilterRegion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const rx = Math.max(0, Math.floor(x));
  const ry = Math.max(0, Math.floor(y));
  const rw = Math.max(1, Math.floor(width));
  const rh = Math.max(1, Math.floor(height));

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(rx, ry, rw, rh);
  } catch {
    throw new CorsTaintError();
  }

  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray =
      SCAN_LUMA_R * data[i] +
      SCAN_LUMA_G * data[i + 1] +
      SCAN_LUMA_B * data[i + 2];
    const contrasted = (gray - SCAN_MIDPOINT) * SCAN_CONTRAST_FACTOR + SCAN_MIDPOINT;
    const adjusted = Math.max(
      0,
      Math.min(255, Math.round(contrasted * SCAN_BRIGHTNESS_FACTOR))
    );
    data[i] = adjusted;
    data[i + 1] = adjusted;
    data[i + 2] = adjusted;
  }
  ctx.putImageData(imageData, rx, ry);
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = SLICE_JPEG_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas Blob 인코딩에 실패했습니다.'));
          }
        },
        'image/jpeg',
        quality
      );
    } catch {
      reject(new CorsTaintError());
    }
  });
}

function drawPieceNumberBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pieceNumber: number
): void {
  const cx = x + COMPOSITE_BADGE_MARGIN_PX + COMPOSITE_BADGE_RADIUS_PX;
  const cy = y + COMPOSITE_BADGE_MARGIN_PX + COMPOSITE_BADGE_RADIUS_PX;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, COMPOSITE_BADGE_RADIUS_PX, 0, Math.PI * 2);
  ctx.fillStyle = COMPOSITE_BADGE_BG;
  ctx.globalAlpha = 0.9;
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = COMPOSITE_BADGE_FG;
  ctx.font =
    '700 22px "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(pieceNumber), cx, cy + 1);
  ctx.restore();
}

/**
 * 편집 화면(ReceiptSplitEditor · 배치 편집)용 개별 세그먼트 Blob URL을 생성합니다.
 */
export async function renderSegmentSliceUrl(
  args: SegmentSliceRenderArgs
): Promise<SegmentSliceRenderResult> {
  const key = buildSegmentSliceCacheKey(args);
  const cached = blobUrlCache.get(key);
  if (cached) {
    return {
      key,
      url: cached.url,
      naturalWidth: cached.naturalWidth,
      naturalHeight: cached.naturalHeight,
    };
  }

  const existingTask = inFlightTasks.get(key) as
    | Promise<SegmentSliceRenderResult>
    | undefined;
  if (existingTask) return existingTask;

  const task = (async (): Promise<SegmentSliceRenderResult> => {
    try {
      const img = await loadCanvasSafeImage(args.src);
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      if (natW <= 0 || natH <= 0) {
        return { key, fallbackSvg: true };
      }

      const xStart = args.segment.xStart ?? 0;
      const xEnd = args.segment.xEnd ?? 1;
      const sx = Math.max(0, Math.round(xStart * natW));
      const sy = Math.max(0, Math.round(args.segment.yStart * natH));
      const sw = Math.max(1, Math.min(natW - sx, Math.round((xEnd - xStart) * natW)));
      const sh = Math.max(
        1,
        Math.min(natH - sy, Math.round((args.segment.yEnd - args.segment.yStart) * natH))
      );

      const { width: outW, height: outH } = clampCanvasDimensions(sw, sh);

      const blob = await enqueueCanvasJob(async (canvas, ctx) => {
        canvas.width = outW;
        canvas.height = outH;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

        if (args.scanFilter) {
          applyScanFilterRegion(ctx, 0, 0, outW, outH);
        }

        return canvasToJpegBlob(canvas);
      });

      const url = URL.createObjectURL(blob);
      blobUrlCache.set(key, { url, naturalWidth: natW, naturalHeight: natH });
      return {
        key,
        url,
        naturalWidth: natW,
        naturalHeight: natH,
      };
    } catch (err) {
      if (err instanceof CorsTaintError) {
        return { key, fallbackSvg: true };
      }
      return { key, fallbackSvg: true };
    } finally {
      inFlightTasks.delete(key);
    }
  })();

  inFlightTasks.set(key, task);
  return task;
}

/**
 * A4 미리보기 및 @media print용 슬롯 단위 300 DPI 단일 합성 Blob URL을 생성합니다.
 * - 다중 조각의 자유/자동 좌표를 1장의 비트맵으로 합성해 Safari 인쇄 레이아웃 버그를 원천 차단합니다.
 */
export async function renderSlotCompositeUrl(
  args: SlotCompositeRenderArgs
): Promise<SlotCompositeRenderResult> {
  const key = buildSlotCompositeCacheKey(args);
  const cached = blobUrlCache.get(key);
  if (cached) {
    return { key, url: cached.url };
  }

  const existingTask = inFlightTasks.get(key) as
    | Promise<SlotCompositeRenderResult>
    | undefined;
  if (existingTask) return existingTask;

  const task = (async (): Promise<SlotCompositeRenderResult> => {
    try {
      const img = await loadCanvasSafeImage(args.src);
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      if (natW <= 0 || natH <= 0) {
        return { key, fallbackSvg: true };
      }

      const geom = RECEIPT_SLOT_GEOMETRY[args.density];
      const { width: canvasW, height: canvasH } = clampCanvasDimensions(
        geom.canvasWidthPx,
        geom.canvasHeightPx
      );

      const hasTopCaption = args.slotTotal > 1 && args.slotIndex > 0;
      const hasBottomCaption =
        args.slotTotal > 1 && args.slotIndex < args.slotTotal - 1;

      const topOffset = hasTopCaption ? COMPOSITE_CAPTION_HEIGHT_PX : 0;
      const bottomOffset = hasBottomCaption ? COMPOSITE_CAPTION_HEIGHT_PX : 0;
      const drawAreaH = Math.max(100, canvasH - topOffset - bottomOffset);

      const segById = new Map(args.segments.map((s) => [s.id, s]));
      const pieceOrderMap = new Map(
        args.placements.map((p, idx) => [p.segmentId, args.startPieceNumber + idx])
      );

      // z-index 오름차순 정렬 (동률 시 선언 순서 유지)
      const orderedPlacements = args.placements
        .map((p, idx) => ({ p, idx }))
        .sort((a, b) => (a.p.z ?? a.idx) - (b.p.z ?? b.idx));

      const showBadges = args.placements.length > 1 || args.slotTotal > 1;
      const evidenceLabel = args.evidenceNo || '';

      const blob = await enqueueCanvasJob(async (canvas, ctx) => {
        canvas.width = canvasW;
        canvas.height = canvasH;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const drawnBoxes: Array<{
          x: number;
          y: number;
          w: number;
          h: number;
          seg: ReceiptSegment;
          pieceNo: number;
        }> = [];

        // 1단계: 모든 조각 이미지 드로잉
        for (const { p } of orderedPlacements) {
          const seg = segById.get(p.segmentId);
          if (!seg) continue;

          const xStart = seg.xStart ?? 0;
          const xEnd = seg.xEnd ?? 1;
          const sx = Math.max(0, Math.round(xStart * natW));
          const sy = Math.max(0, Math.round(seg.yStart * natH));
          const sw = Math.max(
            1,
            Math.min(natW - sx, Math.round((xEnd - xStart) * natW))
          );
          const sh = Math.max(
            1,
            Math.min(natH - sy, Math.round((seg.yEnd - seg.yStart) * natH))
          );

          const boxX = p.x * canvasW;
          const boxY = topOffset + p.y * drawAreaH;
          const boxW = Math.max(1, p.w * canvasW);
          const boxH = Math.max(1, p.h * drawAreaH);

          // 배치 박스 내부에서 조각 원본 비율 고정(contain) 중앙 정렬
          const scale = Math.min(boxW / sw, boxH / sh);
          const fitW = sw * scale;
          const fitH = sh * scale;
          const fitX = boxX + (boxW - fitW) / 2;
          const fitY = boxY + (boxH - fitH) / 2;

          ctx.drawImage(img, sx, sy, sw, sh, fitX, fitY, fitW, fitH);
          drawnBoxes.push({
            x: fitX,
            y: fitY,
            w: fitW,
            h: fitH,
            seg,
            pieceNo: pieceOrderMap.get(seg.id) || args.startPieceNumber,
          });
        }

        // 2단계: 스캔 보정 필터를 배지·테두리 그리기 전에 픽셀 베이킹
        if (args.scanFilter) {
          applyScanFilterRegion(ctx, 0, topOffset, canvasW, drawAreaH);
        }

        // 3단계: 조각 테두리·절단 점선·원형 순번 배지(①②③) 오버레이
        for (const box of drawnBoxes) {
          ctx.save();
          ctx.strokeStyle = COMPOSITE_PIECE_BORDER_COLOR;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.strokeRect(box.x + 0.75, box.y + 0.75, box.w - 1.5, box.h - 1.5);

          // 절단면 점선 (흑백 레이저에서도 선명한 #4E5968)
          ctx.strokeStyle = COMPOSITE_CUT_LINE_COLOR;
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 7]);
          if (box.seg.yStart > 0.005) {
            ctx.beginPath();
            ctx.moveTo(box.x, box.y + 1);
            ctx.lineTo(box.x + box.w, box.y + 1);
            ctx.stroke();
          }
          if (box.seg.yEnd < 0.995) {
            ctx.beginPath();
            ctx.moveTo(box.x, box.y + box.h - 1);
            ctx.lineTo(box.x + box.w, box.y + box.h - 1);
            ctx.stroke();
          }
          ctx.restore();

          if (showBadges) {
            drawPieceNumberBadge(ctx, box.x, box.y, box.pieceNo);
          }
        }

        // 4단계: 오버플로우 연속 캡션 (2칸 이상일 때 최상단/최하단 26px 초슬림 표시)
        ctx.save();
        ctx.fillStyle = COMPOSITE_CAPTION_COLOR;
        ctx.font =
          '600 17px "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (hasTopCaption) {
          ctx.fillText(
            `▲ ${evidenceLabel ? `${evidenceLabel} ` : ''}(${args.slotIndex}/${args.slotTotal}) 이어짐 · ${getPieceNumberLabel(args.startPieceNumber)}부터`,
            canvasW / 2,
            topOffset / 2
          );
        }
        if (hasBottomCaption) {
          ctx.fillText(
            `▼ ${evidenceLabel ? `${evidenceLabel} ` : ''}(${args.slotIndex + 2}/${args.slotTotal}) 다음 칸 계속`,
            canvasW / 2,
            canvasH - bottomOffset / 2
          );
        }
        ctx.restore();

        return canvasToJpegBlob(canvas);
      });

      const url = URL.createObjectURL(blob);
      blobUrlCache.set(key, { url });
      return { key, url };
    } catch (err) {
      if (err instanceof CorsTaintError) {
        return { key, fallbackSvg: true };
      }
      return { key, fallbackSvg: true };
    } finally {
      inFlightTasks.delete(key);
    }
  })();

  inFlightTasks.set(key, task);
  return task;
}

/**
 * 현재 화면·인쇄에서 더 이상 사용하지 않는 Blob URL 캐시를 결정적으로 해제합니다.
 * keyPrefix('seg|' | 'slot|') 지정 시 해당 네임스페이스만 격리 정리해 편집기↔인쇄 캐시 충돌을 방지합니다.
 */
export function revokeUnusedSliceUrls(
  activeKeys: Set<string>,
  keyPrefix?: 'seg|' | 'slot|'
): void {
  for (const [key, entry] of blobUrlCache.entries()) {
    if (keyPrefix && !key.startsWith(keyPrefix)) continue;
    if (!activeKeys.has(key)) {
      URL.revokeObjectURL(entry.url);
      blobUrlCache.delete(key);
    }
  }
}

/**
 * 캐시된 모든 슬라이스 Blob URL을 일괄 해제합니다 (언마운트 정리용).
 * 공용 Drive 원본 Blob 캐시는 탭 전환 시 재다운로드를 막기 위해 세션 동안 유지됩니다.
 */
export function revokeAllSliceUrls(): void {
  for (const entry of blobUrlCache.values()) {
    URL.revokeObjectURL(entry.url);
  }
  blobUrlCache.clear();
}

function waitAnimationFrames(count: number): Promise<void> {
  if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let remaining = count;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}

/**
 * 인쇄(window.print) 직전 모든 슬롯 합성 Blob URL 생성 + React DOM 반영(2×rAF) +
 * 대상 컨테이너 내 모든 <img>의 decode() 완료를 보장합니다.
 */
export async function ensureAllPrintSlicesReady(
  tasks: SlotCompositeRenderArgs[],
  containerEl?: HTMLElement | null
): Promise<Record<string, SlotCompositeRenderResult>> {
  const results: Record<string, SlotCompositeRenderResult> = {};

  for (const task of tasks) {
    const res = await renderSlotCompositeUrl(task);
    results[res.key] = res;
  }

  // React 상태 반영 및 브라우저 레이아웃 커밋 대기
  await waitAnimationFrames(2);

  if (containerEl) {
    const imgs = Array.from(containerEl.querySelectorAll('img'));
    await Promise.allSettled(
      imgs.map(async (img) => {
        if (!img.complete) {
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          });
        }
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => undefined);
        }
      })
    );
  }

  return results;
}
