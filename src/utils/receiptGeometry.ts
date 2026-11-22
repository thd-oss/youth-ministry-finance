import {
  PackedSlotResult,
  ReceiptDensity,
  ReceiptSegment,
  SlotSegmentPlacement,
} from '../types/finance';

export interface ReceiptSlotGeometry {
  /** A4 카드 내부 이미지 가용 폭 (mm) */
  widthMm: number;
  /** A4 카드 내부 이미지 가용 높이 (mm) */
  heightMm: number;
  /** 슬롯 세로/가로 비율 (heightMm / widthMm) */
  aspectHW: number;
  /** 미분할 영수증의 분할 권장 임계 세로/가로 비율 */
  overflowThresholdHW: number;
  /** 300 DPI 인쇄 합성 캔버스 가로 픽셀 */
  canvasWidthPx: number;
  /** 300 DPI 인쇄 합성 캔버스 세로 픽셀 */
  canvasHeightPx: number;
}

/**
 * A4 영수증철(.a4-page-receipt: 210×297mm, @page margin 14mm) 내
 * 단일 카드 이미지 가용 박스의 물리 치수 단일 진실 공급원(SSOT)
 */
export const RECEIPT_SLOT_GEOMETRY: Record<ReceiptDensity, ReceiptSlotGeometry> =
  {
    2: {
      widthMm: 84.4,
      heightMm: 215.6,
      aspectHW: 215.6 / 84.4,
      overflowThresholdHW: 3.2,
      canvasWidthPx: 997,
      canvasHeightPx: 2546,
    },
    4: {
      widthMm: 84.4,
      heightMm: 94.5,
      aspectHW: 94.5 / 84.4,
      overflowThresholdHW: 1.55,
      canvasWidthPx: 997,
      canvasHeightPx: 1116,
    },
  };

/**
 * 영수증 자동 패킹·가독성 판정·자유 배치 물리 임계 상수 (SSOT)
 */
export const RECEIPT_PACKING_METRICS = {
  /** 미분할 영수증 분할 권장 하한 폭 (소형 58mm 감열지 실폭 기준) */
  MIN_SINGLE_READABLE_WIDTH_MM: 58.0,
  /** 1칸 자동 다중 패킹 시 허용되는 최소 인쇄 폭 (미만 시 다음 칸 오버플로우) */
  MIN_PACKED_WIDTH_MM: 36.0,
  /** 자유 2D 배치 모드에서 사용자 수동 축소 허용 최소 폭 (mm) */
  HARD_MIN_FREE_WIDTH_MM: 24.0,
  /** 슬롯 내부 조각 간 기본 여백 (mm) */
  SUB_GAP_MM: 2.0,
  /** 편집점 드래그 시 단일 조각의 최소 세로 비율 (원본 높이 대비 8%) */
  MIN_SEGMENT_RATIO: 0.08,
  /** 자동 등분 수 산출 시 1칸 폭 여유 계수 (약 73mm 이상 유지) */
  AUTO_SPLIT_FILL_SLACK: 1.15,
  /** 자동 패킹 최대 열 수 (3열 26.8mm는 판독 불가이므로 2열 41.2mm까지만 자동 채택) */
  MAX_AUTO_COLUMNS: 2,
  /** 좌표 반올림 정밀도 (소수점 4자리) */
  COORD_PRECISION_SCALE: 10000,
  /** 유효하지 않은 이미지 종횡비 시 안전 최소값 */
  MIN_SAFE_ASPECT_HW: 0.05,
} as const;

function roundCoord(value: number): number {
  const scale = RECEIPT_PACKING_METRICS.COORD_PRECISION_SCALE;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 이미지 가로·세로 픽셀로부터 세로/가로 종횡비(H / W)를 계산합니다.
 */
export function getImageAspectHW(width?: number, height?: number): number | null {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return height / width;
}

/**
 * 주어진 세로/가로 비율(aspectHW)의 영수증이 특정 밀도 슬롯 1칸에
 * object-contain으로 출력될 때의 실제 A4 인쇄 폭(mm)을 계산합니다.
 */
export function getRenderedWidthMm(
  aspectHW: number,
  density: ReceiptDensity
): number {
  const slot = RECEIPT_SLOT_GEOMETRY[density];
  const safeAspect = Math.max(
    RECEIPT_PACKING_METRICS.MIN_SAFE_ASPECT_HW,
    Number.isFinite(aspectHW) ? aspectHW : 1
  );
  return Math.min(slot.widthMm, slot.heightMm / safeAspect);
}

/**
 * 주어진 이미지가 현재 밀도(기본 4분할)에서 분할 편집이 권장되는 긴 영수증인지 판정합니다.
 */
export function isLongReceipt(
  width?: number,
  height?: number,
  density: ReceiptDensity = 4
): boolean {
  const aspectHW = getImageAspectHW(width, height);
  if (aspectHW === null) return false;
  return aspectHW > RECEIPT_SLOT_GEOMETRY[density].overflowThresholdHW;
}

/**
 * 긴 영수증을 현재 밀도의 슬롯(1칸 2열 최대 패킹 포함)에 선명하게 담기 위한
 * 1-Tap [자동 N등분] 추천 조각 수를 계산합니다.
 */
export function getRecommendedSplitCount(
  aspectHW: number,
  density: ReceiptDensity
): number {
  if (!Number.isFinite(aspectHW) || aspectHW <= 0) return 1;
  const slot = RECEIPT_SLOT_GEOMETRY[density];
  if (aspectHW <= slot.overflowThresholdHW) return 1;

  // 2열 나란히(41.2mm) 1칸 수용력을 기준으로 가독성 최적 등분 수 산출
  const colWidthMm =
    (slot.widthMm - RECEIPT_PACKING_METRICS.SUB_GAP_MM) /
    RECEIPT_PACKING_METRICS.MAX_AUTO_COLUMNS;
  const singleColMaxAspect =
    (slot.heightMm / colWidthMm) *
    (colWidthMm / RECEIPT_PACKING_METRICS.MIN_PACKED_WIDTH_MM);

  // 2등분으로 1칸 2열에 깔끔히 들어가면 2등분 우선 추천
  const piecesByColHeight = Math.ceil(
    aspectHW /
      Math.max(
        slot.aspectHW * RECEIPT_PACKING_METRICS.AUTO_SPLIT_FILL_SLACK,
        Math.min(singleColMaxAspect, slot.heightMm / colWidthMm)
      )
  );
  return Math.max(2, Math.min(8, piecesByColHeight));
}

/**
 * 지정 개수(count)만큼 균등 분할된 ReceiptSegment 배열을 생성합니다.
 */
export function createAutoSegments(count: number): ReceiptSegment[] {
  const safeCount = Math.max(1, Math.min(12, Math.floor(count)));
  if (safeCount <= 1) {
    return [{ id: 's1', yStart: 0, yEnd: 1 }];
  }
  const segments: ReceiptSegment[] = [];
  for (let i = 0; i < safeCount; i++) {
    const yStart = i === 0 ? 0 : roundCoord(i / safeCount);
    const yEnd = i === safeCount - 1 ? 1 : roundCoord((i + 1) / safeCount);
    segments.push({
      id: `s${i + 1}`,
      yStart,
      yEnd,
    });
  }
  return segments;
}

/**
 * 연속 세그먼트 배열에서 내부 수평 절단선(0 < y < 1) 목록을 추출합니다.
 */
export function segmentsToCutLines(segments: ReceiptSegment[]): number[] {
  if (segments.length <= 1) return [];
  const sorted = [...segments].sort((a, b) => a.yStart - b.yStart);
  const lines: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const line = clamp(
      sorted[i].yEnd,
      RECEIPT_PACKING_METRICS.MIN_SEGMENT_RATIO,
      1 - RECEIPT_PACKING_METRICS.MIN_SEGMENT_RATIO
    );
    lines.push(roundCoord(line));
  }
  return lines;
}

/**
 * 수평 절단선(0..1) 배열을 최소 조각 높이(MIN_SEGMENT_RATIO)를 보장하는
 * 비파괴 ReceiptSegment 배열로 변환하며 기존 segment.id를 최대한 보존합니다.
 */
export function cutLinesToSegments(
  cutLines: number[],
  prevSegments?: ReceiptSegment[]
): ReceiptSegment[] {
  const minRatio = RECEIPT_PACKING_METRICS.MIN_SEGMENT_RATIO;
  const maxLines = Math.max(0, Math.floor(1 / minRatio) - 1);

  const sortedRaw = cutLines
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .map((v) => clamp(v, minRatio, 1 - minRatio))
    .sort((a, b) => a - b)
    .slice(0, maxLines);

  if (sortedRaw.length === 0) {
    const firstId = prevSegments?.[0]?.id || 's1';
    return [{ id: firstId, yStart: 0, yEnd: 1 }];
  }

  // Forward pass: 인접 절단선 간 최소 간격 보장
  const clamped = [...sortedRaw];
  for (let i = 0; i < clamped.length; i++) {
    const lowerBound = i === 0 ? minRatio : clamped[i - 1] + minRatio;
    if (clamped[i] < lowerBound) {
      clamped[i] = lowerBound;
    }
  }

  // Backward pass: 마지막 조각 최소 높이 보장
  for (let i = clamped.length - 1; i >= 0; i--) {
    const upperBound =
      i === clamped.length - 1 ? 1 - minRatio : clamped[i + 1] - minRatio;
    if (clamped[i] > upperBound) {
      clamped[i] = upperBound;
    }
  }

  // 간격 충돌로 유효하지 않은 라인 제거
  const validLines: number[] = [];
  for (const line of clamped) {
    const prevBoundary =
      validLines.length === 0 ? 0 : validLines[validLines.length - 1];
    if (line - prevBoundary >= minRatio - 1e-6 && 1 - line >= minRatio - 1e-6) {
      validLines.push(roundCoord(line));
    }
  }

  const boundaries = [0, ...validLines, 1];
  const prevList = prevSegments ? [...prevSegments] : [];
  const usedIds = new Set<string>();
  let nextIdCounter = 1;

  const allocId = (): string => {
    while (usedIds.has(`s${nextIdCounter}`)) {
      nextIdCounter += 1;
    }
    const id = `s${nextIdCounter}`;
    usedIds.add(id);
    nextIdCounter += 1;
    return id;
  };

  // 기존 세그먼트 ID를 구간 중점 근접도 순으로 최대한 보존
  const rawIntervals = boundaries.slice(0, -1).map((yStart, idx) => ({
    yStart,
    yEnd: boundaries[idx + 1],
    mid: (yStart + boundaries[idx + 1]) / 2,
  }));

  const assignedIds: Array<string | null> = rawIntervals.map(() => null);
  const usedPrevIdx = new Set<number>();

  // 1차: 같은 인덱스에서 구간이 크게 겹치는 기존 ID 우선 유지
  rawIntervals.forEach((interval, idx) => {
    const prev = prevList[idx];
    if (!prev || usedPrevIdx.has(idx) || usedIds.has(prev.id)) return;
    const overlap =
      Math.min(interval.yEnd, prev.yEnd) - Math.max(interval.yStart, prev.yStart);
    if (overlap > 0) {
      assignedIds[idx] = prev.id;
      usedIds.add(prev.id);
      usedPrevIdx.add(idx);
    }
  });

  // 2차: 남은 구간은 가장 가까운 미사용 기존 ID 매칭
  rawIntervals.forEach((interval, idx) => {
    if (assignedIds[idx]) return;
    let bestPrevIdx = -1;
    let bestDist = Infinity;
    prevList.forEach((prev, pIdx) => {
      if (usedPrevIdx.has(pIdx) || usedIds.has(prev.id)) return;
      const overlap =
        Math.min(interval.yEnd, prev.yEnd) -
        Math.max(interval.yStart, prev.yStart);
      if (overlap <= 0) return;
      const prevMid = (prev.yStart + prev.yEnd) / 2;
      const dist = Math.abs(interval.mid - prevMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestPrevIdx = pIdx;
      }
    });
    if (bestPrevIdx >= 0) {
      const prev = prevList[bestPrevIdx];
      assignedIds[idx] = prev.id;
      usedIds.add(prev.id);
      usedPrevIdx.add(bestPrevIdx);
    }
  });

  return rawIntervals.map((interval, idx) => ({
    id: assignedIds[idx] || allocId(),
    yStart: interval.yStart,
    yEnd: interval.yEnd,
  }));
}

/**
 * 원본 이미지의 세로/가로비(origAspectHW)를 기준으로 개별 세그먼트의 세로/가로비를 산출합니다.
 */
export function getSegmentAspectHW(
  seg: ReceiptSegment,
  origAspectHW: number
): number {
  const safeOrig = Math.max(
    RECEIPT_PACKING_METRICS.MIN_SAFE_ASPECT_HW,
    Number.isFinite(origAspectHW) ? origAspectHW : 1
  );
  const segH = Math.max(0.01, seg.yEnd - seg.yStart);
  const segW = Math.max(0.01, (seg.xEnd ?? 1) - (seg.xStart ?? 0));
  return safeOrig * (segH / segW);
}

/**
 * 단일 슬롯 내부에서 주어진 세그먼트 집합을 1열 세로 적층 vs 2열 읽기순서 균형 분할 중
 * 물리 인쇄 폭(renderedWidthMm)이 최대가 되는 배치로 계산합니다.
 */
export function evaluateSlotFit(
  segments: ReceiptSegment[],
  origAspectHW: number,
  density: ReceiptDensity
): PackedSlotResult {
  const slot = RECEIPT_SLOT_GEOMETRY[density];
  const gapMm = RECEIPT_PACKING_METRICS.SUB_GAP_MM;

  if (segments.length === 0) {
    return {
      segmentIds: [],
      placements: [],
      renderedWidthMm: slot.widthMm,
      isUnderReadableWidth: false,
    };
  }

  const segAspects = segments.map((seg) =>
    getSegmentAspectHW(seg, origAspectHW)
  );

  // 후보 A: 1열 세로 적층 (폭 = slot.widthMm)
  const sumRatiosAll = segAspects.reduce((acc, r) => acc + r, 0);
  const totalGap1Col = Math.max(0, segments.length - 1) * gapMm;
  const availH1Col = Math.max(1, slot.heightMm - totalGap1Col);
  const width1ColMm = Math.min(slot.widthMm, availH1Col / sumRatiosAll);

  const build1ColPlacements = (): SlotSegmentPlacement[] => {
    const pieceHeights = segAspects.map((r) => width1ColMm * r);
    const blockHeight =
      pieceHeights.reduce((acc, h) => acc + h, 0) + totalGap1Col;
    const xMm = (slot.widthMm - width1ColMm) / 2;
    let cursorY = Math.max(0, (slot.heightMm - blockHeight) / 2);

    return segments.map((seg, idx) => {
      const hMm = pieceHeights[idx];
      const placement: SlotSegmentPlacement = {
        segmentId: seg.id,
        x: roundCoord(clamp(xMm / slot.widthMm, 0, 1)),
        y: roundCoord(clamp(cursorY / slot.heightMm, 0, 1)),
        w: roundCoord(clamp(width1ColMm / slot.widthMm, 0.01, 1)),
        h: roundCoord(clamp(hMm / slot.heightMm, 0.01, 1)),
      };
      cursorY += hMm + gapMm;
      return placement;
    });
  };

  // 후보 B: 2열 읽기순서 균형 분할 (좌열 0..m-1, 우열 m..k-1)
  let best2ColWidthMm = -1;
  let best2ColSplit = 1;
  let best2ColDiff = Infinity;

  if (segments.length >= 2) {
    const colWidthMm =
      (slot.widthMm - gapMm) / RECEIPT_PACKING_METRICS.MAX_AUTO_COLUMNS;

    for (let m = 1; m < segments.length; m++) {
      const sumL = segAspects.slice(0, m).reduce((acc, r) => acc + r, 0);
      const sumR = segAspects.slice(m).reduce((acc, r) => acc + r, 0);
      const gapL = Math.max(0, m - 1) * gapMm;
      const gapR = Math.max(0, segments.length - m - 1) * gapMm;

      const availHL = Math.max(1, slot.heightMm - gapL);
      const availHR = Math.max(1, slot.heightMm - gapR);

      const wL = Math.min(colWidthMm, availHL / sumL);
      const wR = Math.min(colWidthMm, availHR / sumR);
      const uniformW = Math.min(wL, wR);

      const heightL = uniformW * sumL + gapL;
      const heightR = uniformW * sumR + gapR;
      const diff = Math.abs(heightL - heightR);

      if (
        uniformW > best2ColWidthMm + 1e-4 ||
        (Math.abs(uniformW - best2ColWidthMm) <= 1e-4 && diff < best2ColDiff)
      ) {
        best2ColWidthMm = uniformW;
        best2ColSplit = m;
        best2ColDiff = diff;
      }
    }
  }

  const build2ColPlacements = (): SlotSegmentPlacement[] => {
    const m = best2ColSplit;
    const wMm = best2ColWidthMm;

    // 2열 전체를 슬롯 중앙에 정렬해 좌우 조각이 자연스럽게 나란히 보이도록 배치
    const totalColsW = wMm * 2 + gapMm;
    const leftX = Math.max(0, (slot.widthMm - totalColsW) / 2);
    const rightX = leftX + wMm + gapMm;

    const leftHeights = segAspects.slice(0, m).map((r) => wMm * r);
    const rightHeights = segAspects.slice(m).map((r) => wMm * r);

    const leftTotalH =
      leftHeights.reduce((acc, h) => acc + h, 0) + Math.max(0, m - 1) * gapMm;
    const rightTotalH =
      rightHeights.reduce((acc, h) => acc + h, 0) +
      Math.max(0, segments.length - m - 1) * gapMm;

    let cursorLeftY = Math.max(0, (slot.heightMm - leftTotalH) / 2);
    let cursorRightY = Math.max(0, (slot.heightMm - rightTotalH) / 2);

    const placements: SlotSegmentPlacement[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeft = i < m;
      const xMm = isLeft ? leftX : rightX;
      const hMm = isLeft ? leftHeights[i] : rightHeights[i - m];
      const yMm = isLeft ? cursorLeftY : cursorRightY;

      placements.push({
        segmentId: seg.id,
        x: roundCoord(clamp(xMm / slot.widthMm, 0, 1)),
        y: roundCoord(clamp(yMm / slot.heightMm, 0, 1)),
        w: roundCoord(clamp(wMm / slot.widthMm, 0.01, 1)),
        h: roundCoord(clamp(hMm / slot.heightMm, 0.01, 1)),
      });

      if (isLeft) {
        cursorLeftY += hMm + gapMm;
      } else {
        cursorRightY += hMm + gapMm;
      }
    }
    return placements;
  };

  const use2Col = segments.length >= 2 && best2ColWidthMm > width1ColMm;
  const renderedWidthMm = roundCoord(use2Col ? best2ColWidthMm : width1ColMm);
  const placements = use2Col ? build2ColPlacements() : build1ColPlacements();

  return {
    segmentIds: segments.map((s) => s.id),
    placements,
    renderedWidthMm,
    isUnderReadableWidth:
      renderedWidthMm < RECEIPT_PACKING_METRICS.MIN_PACKED_WIDTH_MM,
  };
}

/**
 * Greedy 1칸 최대 패킹 + 공간 부족 시 자동 다음 칸 오버플로우(Spillover) 알고리즘.
 * - 각 슬롯은 최소 1개 조각을 수용(무한 루프 방지).
 * - 조각 추가 시 인쇄 폭이 MIN_PACKED_WIDTH_MM(36.0mm) 이상이면 같은 칸에 채우고,
 *   미만이면 직전까지를 1칸으로 확정하고 다음 칸으로 넘깁니다.
 */
export function packSegmentsIntoSlots(
  segments: ReceiptSegment[],
  origAspectHW: number,
  density: ReceiptDensity
): PackedSlotResult[] {
  if (segments.length === 0) return [];

  const results: PackedSlotResult[] = [];
  let bucket: ReceiptSegment[] = [segments[0]];
  let currentFit = evaluateSlotFit(bucket, origAspectHW, density);

  for (let i = 1; i < segments.length; i++) {
    const candidateBucket = [...bucket, segments[i]];
    const candidateFit = evaluateSlotFit(candidateBucket, origAspectHW, density);

    if (
      candidateFit.renderedWidthMm >=
      RECEIPT_PACKING_METRICS.MIN_PACKED_WIDTH_MM
    ) {
      bucket = candidateBucket;
      currentFit = candidateFit;
    } else {
      results.push(currentFit);
      bucket = [segments[i]];
      currentFit = evaluateSlotFit(bucket, origAspectHW, density);
    }
  }

  results.push(currentFit);
  return results;
}

/**
 * 자유 2D 배치 모드에서 조각의 원본 종횡비를 고정(Aspect-Ratio Lock)한 채
 * 슬롯 경계(0..1) 및 물리 최소 폭(HARD_MIN_FREE_WIDTH_MM)으로 클램핑합니다.
 */
export function clampPlacementAspectLocked(
  placement: SlotSegmentPlacement,
  segAspectHW: number,
  density: ReceiptDensity
): SlotSegmentPlacement {
  const slot = RECEIPT_SLOT_GEOMETRY[density];
  const safeSegAspect = Math.max(
    RECEIPT_PACKING_METRICS.MIN_SAFE_ASPECT_HW,
    Number.isFinite(segAspectHW) ? segAspectHW : 1
  );

  const heightPerWidth = safeSegAspect / slot.aspectHW;
  const wMax = Math.min(1, slot.aspectHW / safeSegAspect);
  const wMin = Math.min(
    wMax,
    RECEIPT_PACKING_METRICS.HARD_MIN_FREE_WIDTH_MM / slot.widthMm
  );

  const rawW = Number.isFinite(placement.w) ? placement.w : wMax;
  const w = clamp(rawW, wMin, wMax);
  const h = Math.min(1, w * heightPerWidth);

  const rawX = Number.isFinite(placement.x) ? placement.x : 0;
  const rawY = Number.isFinite(placement.y) ? placement.y : 0;
  const x = clamp(rawX, 0, Math.max(0, 1 - w));
  const y = clamp(rawY, 0, Math.max(0, 1 - h));

  const next: SlotSegmentPlacement = {
    segmentId: placement.segmentId,
    x: roundCoord(x),
    y: roundCoord(y),
    w: roundCoord(w),
    h: roundCoord(h),
  };

  if (typeof placement.z === 'number' && Number.isFinite(placement.z)) {
    next.z = placement.z;
  }

  return next;
}

/**
 * 자유 배치된 개별 조각의 실제 A4 인쇄 폭(mm)을 계산합니다.
 */
export function getPlacementRenderedWidthMm(
  placement: SlotSegmentPlacement,
  density: ReceiptDensity
): number {
  return roundCoord(placement.w * RECEIPT_SLOT_GEOMETRY[density].widthMm);
}
