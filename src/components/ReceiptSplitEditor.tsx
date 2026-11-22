import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  GripHorizontal,
  Layers,
  Loader2,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useResolvedReceiptSrc } from '../hooks/useResolvedReceiptSrc';
import {
  ProcessedTransaction,
  ReceiptDensity,
  ReceiptEditConfig,
  ReceiptSegment,
  SegmentGroupSlotRef,
  SlotSegmentPlacement,
} from '../types/finance';
import { formatWon } from '../utils/koreanCurrency';
import {
  clampPlacementAspectLocked,
  createAutoSegments,
  cutLinesToSegments,
  evaluateSlotFit,
  getImageAspectHW,
  getPlacementRenderedWidthMm,
  getRecommendedSplitCount,
  getSegmentAspectHW,
  packSegmentsIntoSlots,
  RECEIPT_PACKING_METRICS,
  RECEIPT_SLOT_GEOMETRY,
  segmentsToCutLines,
} from '../utils/receiptGeometry';
import { moveSegmentBetweenSlotGroups } from '../utils/receiptLayoutEngine';
import {
  renderSegmentSliceUrl,
  revokeUnusedSliceUrls,
} from '../utils/receiptSliceRenderer';
import { TdsDialog } from './TdsDialog';

export interface ReceiptSplitEditorProps {
  open: boolean;
  onClose: () => void;
  transaction: ProcessedTransaction | null;
  density: ReceiptDensity;
  initialSlotGroups: SegmentGroupSlotRef[];
  initialTab?: 'cut' | 'place';
  imageDimension?: { width: number; height: number };
  onApply: (result: {
    txId: string;
    receiptEdit: ReceiptEditConfig | undefined;
    slotGroups: SegmentGroupSlotRef[];
  }) => void;
}

const DEFAULT_EDITOR_ASPECT_HW = 1.6;
const SLICE_DEBOUNCE_MS = 120;
const SNAP_THRESHOLD_RATIO = 0.03;
const SCALE_STEP_UP = 1.1;
const SCALE_STEP_DOWN = 0.9;
const SVG_BASE_WIDTH = 1000;

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
] as const;

function getCircledNumber(indexZeroBased: number): string {
  if (indexZeroBased >= 0 && indexZeroBased < CIRCLED_NUMBERS.length) {
    return CIRCLED_NUMBERS[indexZeroBased];
  }
  return `(${indexZeroBased + 1})`;
}

function isWholeSingleSegment(segments: ReceiptSegment[]): boolean {
  if (segments.length === 0) return true;
  if (segments.length > 1) return false;
  const only = segments[0];
  return (
    only.yStart <= 0.001 &&
    only.yEnd >= 0.999 &&
    (only.xStart ?? 0) <= 0.001 &&
    (only.xEnd ?? 1) >= 0.999
  );
}

interface SelectedPieceState {
  slotIdx: number;
  segId: string;
}

interface PieceDragSession {
  mode: 'move' | 'resize';
  slotIdx: number;
  segId: string;
  startClientX: number;
  startClientY: number;
  boxWidth: number;
  boxHeight: number;
  startPlacement: SlotSegmentPlacement;
  siblingPlacements: SlotSegmentPlacement[];
  segAspectHW: number;
}

interface CutLineDragSession {
  lineIdx: number;
  canvasTop: number;
  canvasHeight: number;
  minY: number;
  maxY: number;
}

function snapValue(val: number, candidates: number[]): number {
  let best = val;
  let bestDist = SNAP_THRESHOLD_RATIO;
  for (const c of candidates) {
    const dist = Math.abs(val - c);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

export const ReceiptSplitEditor: React.FC<ReceiptSplitEditorProps> = ({
  open,
  onClose,
  transaction,
  density,
  initialSlotGroups,
  initialTab = 'cut',
  imageDimension,
  onApply,
}) => {
  const cutCanvasRef = useRef<HTMLDivElement | null>(null);
  const slotBoxRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cutDragRef = useRef<CutLineDragSession | null>(null);
  const pieceDragRef = useRef<PieceDragSession | null>(null);
  const lastCanvasTapRef = useRef<{ time: number; y: number } | null>(null);

  const [mobileTab, setMobileTab] = useState<'cut' | 'place'>(initialTab);
  const {
    resolvedSrc: resolvedReceiptSrc,
    isLoading: isReceiptImgLoading,
    hasError: hasReceiptImgError,
    handleImgError: handleReceiptImgError,
    retry: retryReceiptImg,
  } = useResolvedReceiptSrc(transaction?.receiptImage);
  const [loadedDim, setLoadedDim] = useState<{ width: number; height: number } | null>(null);
  const [segments, setSegments] = useState<ReceiptSegment[]>([
    { id: 's1', yStart: 0, yEnd: 1 },
  ]);
  const [slotGroups, setSlotGroups] = useState<SegmentGroupSlotRef[]>([]);
  const [selectedPiece, setSelectedPiece] = useState<SelectedPieceState | null>(null);
  const [activeCutLineIdx, setActiveCutLineIdx] = useState<number | null>(null);
  const [sliceUrlsBySegId, setSliceUrlsBySegId] = useState<
    Record<string, { key: string; url?: string; fallbackSvg?: boolean }>
  >({});

  const origAspectHW = useMemo(() => {
    const fromLoaded = getImageAspectHW(loadedDim?.width, loadedDim?.height);
    if (fromLoaded !== null) return fromLoaded;
    const fromProp = getImageAspectHW(
      imageDimension?.width,
      imageDimension?.height
    );
    if (fromProp !== null) return fromProp;
    const fromMeta = getImageAspectHW(
      transaction?.receiptMeta?.width,
      transaction?.receiptMeta?.height
    );
    if (fromMeta !== null) return fromMeta;
    return DEFAULT_EDITOR_ASPECT_HW;
  }, [loadedDim, imageDimension, transaction]);

  // 모달 열릴 때 초기 상태 복원
  useEffect(() => {
    if (!open || !transaction) return;

    setMobileTab(initialTab);
    setLoadedDim(null);
    setSelectedPiece(null);
    setActiveCutLineIdx(null);
    setSliceUrlsBySegId({});

    const initAspect =
      getImageAspectHW(imageDimension?.width, imageDimension?.height) ??
      getImageAspectHW(
        transaction.receiptMeta?.width,
        transaction.receiptMeta?.height
      ) ??
      DEFAULT_EDITOR_ASPECT_HW;

    const existingSegs = transaction.receiptEdit?.segments;
    const nextSegs: ReceiptSegment[] =
      existingSegs && existingSegs.length > 0
        ? existingSegs.map((s) => ({ ...s }))
        : [{ id: 's1', yStart: 0, yEnd: 1 }];

    setSegments(nextSegs);

    const validSegIds = new Set(nextSegs.map((s) => s.id));
    const filteredInitialGroups = initialSlotGroups
      .map<SegmentGroupSlotRef>((g) => ({
        kind: 'segment_group',
        txId: transaction.id,
        segmentIds: g.segmentIds.filter((id) => validSegIds.has(id)),
        layoutMode: g.layoutMode === 'custom' ? 'custom' : 'auto',
        placements:
          g.layoutMode === 'custom' && g.placements
            ? g.placements
                .filter((p) => validSegIds.has(p.segmentId))
                .map((p) => ({ ...p }))
            : undefined,
      }))
      .filter((g) => g.segmentIds.length > 0);

    const coveredCount = filteredInitialGroups.reduce(
      (sum, g) => sum + g.segmentIds.length,
      0
    );

    if (
      filteredInitialGroups.length > 0 &&
      coveredCount === nextSegs.length &&
      nextSegs.length >= 2
    ) {
      setSlotGroups(filteredInitialGroups);
    } else {
      const packed = packSegmentsIntoSlots(nextSegs, initAspect, density);
      setSlotGroups(
        packed.map((p) => ({
          kind: 'segment_group',
          txId: transaction.id,
          segmentIds: p.segmentIds,
          layoutMode: 'auto',
        }))
      );
    }
  }, [open, transaction?.id, density, initialTab]);

  const segmentsById = useMemo(
    () => new Map(segments.map((s) => [s.id, s])),
    [segments]
  );

  const segmentOrderMap = useMemo(
    () => new Map(segments.map((s, idx) => [s.id, idx])),
    [segments]
  );

  const cutLines = useMemo(() => segmentsToCutLines(segments), [segments]);

  const recommendedCount = useMemo(() => {
    const raw = getRecommendedSplitCount(origAspectHW, density);
    return Math.max(2, raw);
  }, [origAspectHW, density]);

  const recommendedSlotsPreview = useMemo(() => {
    const autoSegs = createAutoSegments(recommendedCount);
    return packSegmentsIntoSlots(autoSegs, origAspectHW, density).length;
  }, [recommendedCount, origAspectHW, density]);

  // 편집용 개별 조각 Blob URL 디바운스 생성 (드래그 중엔 SVG 크롭으로 60fps 즉시 표시)
  useEffect(() => {
    if (!open || !transaction?.receiptImage || activeCutLineIdx !== null) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const nextMap: Record<
        string,
        { key: string; url?: string; fallbackSvg?: boolean }
      > = {};
      const activeSegKeys = new Set<string>();

      for (const seg of segments) {
        if (cancelled) return;
        const res = await renderSegmentSliceUrl({
          txId: transaction.id,
          src: transaction.receiptImage!,
          segment: seg,
          scanFilter: false,
        });
        nextMap[seg.id] = {
          key: res.key,
          url: res.url,
          fallbackSvg: res.fallbackSvg,
        };
        activeSegKeys.add(res.key);
      }

      if (!cancelled) {
        setSliceUrlsBySegId(nextMap);
        revokeUnusedSliceUrls(activeSegKeys, 'seg|');
      }
    }, SLICE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, transaction?.id, transaction?.receiptImage, segments, activeCutLineIdx]);

  // 모달 닫힘 시 편집기 전용 seg| Blob URL 즉시 해제 (slot| 인쇄/보드 캐시 무영향)
  useEffect(() => {
    if (!open) {
      setSliceUrlsBySegId({});
      revokeUnusedSliceUrls(new Set(), 'seg|');
    }
  }, [open]);

  // 컴포넌트 언마운트 시 seg| Blob URL 정리
  useEffect(() => {
    return () => {
      revokeUnusedSliceUrls(new Set(), 'seg|');
    };
  }, []);

  // 세그먼트 변경 시 슬롯 그룹 정합성 갱신
  const syncSlotGroupsWithSegments = (
    nextSegments: ReceiptSegment[],
    forceAutoRepack: boolean,
    aspectOverride?: number
  ) => {
    if (!transaction) return;
    const aspect = aspectOverride ?? origAspectHW;

    setSlotGroups((prevGroups) => {
      const hasCustom = prevGroups.some((g) => g.layoutMode === 'custom');
      const prevIds = prevGroups.flatMap((g) => g.segmentIds);
      const nextIds = nextSegments.map((s) => s.id);
      const sameIdSet =
        prevIds.length === nextIds.length &&
        nextIds.every((id) => prevIds.includes(id));

      if (forceAutoRepack || !sameIdSet || !hasCustom) {
        const packed = packSegmentsIntoSlots(nextSegments, aspect, density);
        return packed.map((p) => ({
          kind: 'segment_group',
          txId: transaction.id,
          segmentIds: p.segmentIds,
          layoutMode: 'auto',
        }));
      }

      // 동일 ID 집합 + 일부 custom 슬롯 존재: custom 좌표는 새 세그먼트 비율로 재클램핑해 보존
      const nextSegMap = new Map(nextSegments.map((s) => [s.id, s]));
      return prevGroups.map((g) => {
        if (g.layoutMode !== 'custom' || !g.placements) {
          return g;
        }
        return {
          ...g,
          placements: g.placements.map((p) => {
            const seg = nextSegMap.get(p.segmentId);
            if (!seg) return p;
            return clampPlacementAspectLocked(
              p,
              getSegmentAspectHW(seg, aspect),
              density
            );
          }),
        };
      });
    });
  };

  // 원본 이미지 실제 치수 로드 시(메타 누락 레거시 이미지) 자동 패킹 보정
  // 단, 이미 저장된 슬롯 분배(initialSlotGroups)가 있으면 사용자 수동 칸 넘김을 보존
  const handleOriginImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const natW = e.currentTarget.naturalWidth;
    const natH = e.currentTarget.naturalHeight;
    if (natW > 0 && natH > 0) {
      const prevAspect = origAspectHW;
      setLoadedDim({ width: natW, height: natH });
      const nextAspect = natH / natW;
      if (
        initialSlotGroups.length === 0 &&
        Math.abs(nextAspect - prevAspect) > 0.05
      ) {
        const allAuto = slotGroups.every((g) => g.layoutMode !== 'custom');
        if (allAuto) {
          syncSlotGroupsWithSegments(segments, true, nextAspect);
        }
      }
    }
  };

  // --- 1-Tap 퀵 액션 ---
  const handleAutoSplit = () => {
    const nextSegs = createAutoSegments(recommendedCount);
    setSegments(nextSegs);
    setSelectedPiece(null);
    syncSlotGroupsWithSegments(nextSegs, true);
  };

  const handleAddCutLine = () => {
    // 가장 긴 세그먼트의 정중앙에 편집점 삽입
    let tallestIdx = 0;
    let maxSpan = -1;
    segments.forEach((seg, idx) => {
      const span = seg.yEnd - seg.yStart;
      if (span > maxSpan) {
        maxSpan = span;
        tallestIdx = idx;
      }
    });
    const target = segments[tallestIdx];
    if (!target) return;
    if (target.yEnd - target.yStart < RECEIPT_PACKING_METRICS.MIN_SEGMENT_RATIO * 2) {
      return;
    }
    const mid = (target.yStart + target.yEnd) / 2;
    const nextSegs = cutLinesToSegments([...cutLines, mid], segments);
    setSegments(nextSegs);
    setSelectedPiece(null);
    syncSlotGroupsWithSegments(nextSegs, true);
  };

  const handleResetSplits = () => {
    const single: ReceiptSegment[] = [{ id: 's1', yStart: 0, yEnd: 1 }];
    setSegments(single);
    setSelectedPiece(null);
    syncSlotGroupsWithSegments(single, true);
  };

  const handleRemoveCutLine = (lineIdx: number) => {
    const nextLines = cutLines.filter((_, idx) => idx !== lineIdx);
    const nextSegs = cutLinesToSegments(nextLines, segments);
    setSegments(nextSegs);
    setSelectedPiece(null);
    syncSlotGroupsWithSegments(nextSegs, true);
  };

  // --- 편집선 포인터 드래그 ---
  const handleCutLinePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    lineIdx: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = cutCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.height <= 0) return;

    const minRatio = RECEIPT_PACKING_METRICS.MIN_SEGMENT_RATIO;
    const minY = lineIdx === 0 ? minRatio : cutLines[lineIdx - 1] + minRatio;
    const maxY =
      lineIdx === cutLines.length - 1
        ? 1 - minRatio
        : cutLines[lineIdx + 1] - minRatio;

    cutDragRef.current = {
      lineIdx,
      canvasTop: rect.top,
      canvasHeight: rect.height,
      minY,
      maxY,
    };
    setActiveCutLineIdx(lineIdx);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCutLinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = cutDragRef.current;
    if (!session) return;
    const rawY = (e.clientY - session.canvasTop) / session.canvasHeight;
    const clampedY = Math.min(session.maxY, Math.max(session.minY, rawY));

    const nextLines = [...cutLines];
    nextLines[session.lineIdx] = clampedY;
    const nextSegs = cutLinesToSegments(nextLines, segments);
    setSegments(nextSegs);
    syncSlotGroupsWithSegments(nextSegs, false);
  };

  const handleCutLinePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cutDragRef.current) return;
    cutDragRef.current = null;
    setActiveCutLineIdx(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // 이미지 빈 곳 더블클릭 / 더블탭으로 해당 위치에 편집점 삽입
  const insertCutLineAtClientY = (clientY: number) => {
    const canvas = cutCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = (clientY - rect.top) / rect.height;
    const nextSegs = cutLinesToSegments([...cutLines, ratio], segments);
    if (nextSegs.length !== segments.length) {
      setSegments(nextSegs);
      setSelectedPiece(null);
      syncSlotGroupsWithSegments(nextSegs, true);
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cutDragRef.current) return;
    const now = Date.now();
    const prev = lastCanvasTapRef.current;
    if (prev && now - prev.time < 300 && Math.abs(prev.y - e.clientY) < 24) {
      lastCanvasTapRef.current = null;
      insertCutLineAtClientY(e.clientY);
    } else {
      lastCanvasTapRef.current = { time: now, y: e.clientY };
    }
  };

  // --- 슬롯별 현재 배치(자동/자유 통합) 계산 ---
  const slotViewModels = useMemo(() => {
    return slotGroups.map((group) => {
      const groupSegs = group.segmentIds
        .map((id) => segmentsById.get(id))
        .filter((s): s is ReceiptSegment => Boolean(s));
      const autoFit = evaluateSlotFit(groupSegs, origAspectHW, density);
      const isCustom =
        group.layoutMode === 'custom' &&
        Array.isArray(group.placements) &&
        group.placements.length === groupSegs.length;
      const placements = isCustom ? group.placements! : autoFit.placements;
      const minRenderedWidthMm =
        placements.length > 0
          ? Math.min(
              ...placements.map((p) => getPlacementRenderedWidthMm(p, density))
            )
          : RECEIPT_SLOT_GEOMETRY[density].widthMm;

      return {
        group,
        groupSegs,
        isCustom,
        placements,
        minRenderedWidthMm,
        hasUnderReadable:
          minRenderedWidthMm < RECEIPT_PACKING_METRICS.MIN_PACKED_WIDTH_MM,
      };
    });
  }, [slotGroups, segmentsById, origAspectHW, density]);

  // --- 슬롯 모드 전환 (자동 맞춤 ↔ 자유 배치) ---
  const handleSetSlotMode = (slotIdx: number, nextMode: 'auto' | 'custom') => {
    const vm = slotViewModels[slotIdx];
    if (!vm) return;
    setSlotGroups((prev) =>
      prev.map((g, idx) => {
        if (idx !== slotIdx) return g;
        if (nextMode === 'auto') {
          return {
            kind: 'segment_group',
            txId: g.txId,
            segmentIds: g.segmentIds,
            layoutMode: 'auto',
          };
        }
        // 직전 자동 패킹 좌표를 시드로 승격 (0px 점프)
        return {
          kind: 'segment_group',
          txId: g.txId,
          segmentIds: g.segmentIds,
          layoutMode: 'custom',
          placements: vm.placements.map((p, pIdx) => ({
            ...p,
            z: p.z ?? pIdx + 1,
          })),
        };
      })
    );
  };

  // --- 자동 모드: 조각 탭 선택 / 같은 칸 내 다른 조각 탭 시 순서 스왑 ---
  const handleAutoPieceClick = (slotIdx: number, segId: string) => {
    if (
      selectedPiece &&
      selectedPiece.slotIdx === slotIdx &&
      selectedPiece.segId !== segId
    ) {
      setSlotGroups((prev) =>
        prev.map((g, idx) => {
          if (idx !== slotIdx) return g;
          const nextIds = [...g.segmentIds];
          const a = nextIds.indexOf(selectedPiece.segId);
          const b = nextIds.indexOf(segId);
          if (a < 0 || b < 0) return g;
          [nextIds[a], nextIds[b]] = [nextIds[b], nextIds[a]];
          return {
            ...g,
            segmentIds: nextIds,
            layoutMode: 'auto',
            placements: undefined,
          };
        })
      );
      setSelectedPiece(null);
      return;
    }

    if (
      selectedPiece &&
      selectedPiece.slotIdx === slotIdx &&
      selectedPiece.segId === segId
    ) {
      setSelectedPiece(null);
      return;
    }

    setSelectedPiece({ slotIdx, segId });
  };

  // --- 자유 배치 모드: 포인터 이동 & 종횡비 고정 리사이즈 ---
  const bumpPieceZIndex = (slotIdx: number, segId: string) => {
    setSlotGroups((prev) =>
      prev.map((g, idx) => {
        if (idx !== slotIdx || g.layoutMode !== 'custom' || !g.placements) {
          return g;
        }
        const maxZ = g.placements.reduce(
          (acc, p, i) => Math.max(acc, p.z ?? i + 1),
          0
        );
        return {
          ...g,
          placements: g.placements.map((p) =>
            p.segmentId === segId ? { ...p, z: maxZ + 1 } : p
          ),
        };
      })
    );
  };

  const startCustomPieceDrag = (
    e: React.PointerEvent<HTMLElement>,
    mode: 'move' | 'resize',
    slotIdx: number,
    placement: SlotSegmentPlacement
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const boxEl = slotBoxRefs.current[slotIdx];
    const seg = segmentsById.get(placement.segmentId);
    const vm = slotViewModels[slotIdx];
    if (!boxEl || !seg || !vm) return;

    const rect = boxEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    setSelectedPiece({ slotIdx, segId: placement.segmentId });
    bumpPieceZIndex(slotIdx, placement.segmentId);

    pieceDragRef.current = {
      mode,
      slotIdx,
      segId: placement.segmentId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      boxWidth: rect.width,
      boxHeight: rect.height,
      startPlacement: { ...placement },
      siblingPlacements: vm.placements.filter(
        (p) => p.segmentId !== placement.segmentId
      ),
      segAspectHW: getSegmentAspectHW(seg, origAspectHW),
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCustomPiecePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const session = pieceDragRef.current;
    if (!session) return;

    const dxRatio = (e.clientX - session.startClientX) / session.boxWidth;
    const dyRatio = (e.clientY - session.startClientY) / session.boxHeight;

    let nextPlacement: SlotSegmentPlacement;
    if (session.mode === 'move') {
      let nextX = session.startPlacement.x + dxRatio;
      let nextY = session.startPlacement.y + dyRatio;
      const w = session.startPlacement.w;
      const h = session.startPlacement.h;

      // 가장자리 및 인접 조각 경계 자석 스냅
      const xCandidates = [0, Math.max(0, 1 - w)];
      const yCandidates = [0, Math.max(0, 1 - h)];
      for (const sib of session.siblingPlacements) {
        xCandidates.push(sib.x, sib.x + sib.w, Math.max(0, sib.x - w));
        yCandidates.push(sib.y, sib.y + sib.h, Math.max(0, sib.y - h));
      }
      nextX = snapValue(nextX, xCandidates);
      nextY = snapValue(nextY, yCandidates);

      nextPlacement = clampPlacementAspectLocked(
        { ...session.startPlacement, x: nextX, y: nextY },
        session.segAspectHW,
        density
      );
    } else {
      const targetW = session.startPlacement.w + dxRatio;
      nextPlacement = clampPlacementAspectLocked(
        { ...session.startPlacement, w: targetW },
        session.segAspectHW,
        density
      );
    }

    setSlotGroups((prev) =>
      prev.map((g, idx) => {
        if (idx !== session.slotIdx || g.layoutMode !== 'custom' || !g.placements) {
          return g;
        }
        return {
          ...g,
          placements: g.placements.map((p) =>
            p.segmentId === session.segId
              ? { ...nextPlacement, z: p.z }
              : p
          ),
        };
      })
    );
  };

  const handleCustomPiecePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!pieceDragRef.current) return;
    pieceDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // --- 하단 보조 툴바 액션 (크기 +/- , 이전/다음 칸 이동) ---
  const handleScaleSelectedPiece = (factor: number) => {
    if (!selectedPiece) return;
    const { slotIdx, segId } = selectedPiece;
    const vm = slotViewModels[slotIdx];
    const seg = segmentsById.get(segId);
    if (!vm || !seg) return;

    const currentPlacement = vm.placements.find((p) => p.segmentId === segId);
    if (!currentPlacement) return;

    const segAspectHW = getSegmentAspectHW(seg, origAspectHW);
    const updated = clampPlacementAspectLocked(
      { ...currentPlacement, w: currentPlacement.w * factor },
      segAspectHW,
      density
    );

    setSlotGroups((prev) =>
      prev.map((g, idx) => {
        if (idx !== slotIdx) return g;
        const basePlacements =
          g.layoutMode === 'custom' && g.placements
            ? g.placements
            : vm.placements;
        return {
          ...g,
          layoutMode: 'custom',
          placements: basePlacements.map((p) =>
            p.segmentId === segId ? { ...updated, z: p.z } : p
          ),
        };
      })
    );
  };

  const handleMoveSelectedBetweenSlots = (direction: -1 | 1) => {
    if (!selectedPiece) return;
    const nextGroups = moveSegmentBetweenSlotGroups(
      slotGroups,
      selectedPiece.slotIdx,
      selectedPiece.segId,
      direction,
      segments,
      origAspectHW,
      density
    );
    setSlotGroups(nextGroups);
    const nextSlotIdx = nextGroups.findIndex((g) =>
      g.segmentIds.includes(selectedPiece.segId)
    );
    setSelectedPiece(
      nextSlotIdx >= 0 ? { slotIdx: nextSlotIdx, segId: selectedPiece.segId } : null
    );
  };

  // --- 최종 적용 ---
  const handleConfirmApply = () => {
    if (!transaction) return;
    if (isWholeSingleSegment(segments)) {
      onApply({
        txId: transaction.id,
        receiptEdit: undefined,
        slotGroups: [],
      });
    } else {
      onApply({
        txId: transaction.id,
        receiptEdit: {
          version: 1,
          segments,
          updatedAt: new Date().toISOString(),
        },
        slotGroups,
      });
    }
    onClose();
  };

  const selectedSlotVm =
    selectedPiece !== null ? slotViewModels[selectedPiece.slotIdx] : null;
  const canMovePrevSlot = Boolean(selectedPiece && selectedPiece.slotIdx > 0);
  const canMoveNextSlot = Boolean(
    selectedPiece &&
      selectedSlotVm &&
      (selectedPiece.slotIdx < slotGroups.length - 1 ||
        selectedSlotVm.group.segmentIds.length > 1)
  );

  const summaryPillText =
    slotGroups.length <= 1
      ? `1칸 사용 · ${segments.length}조각`
      : `${slotGroups.length}칸 사용 · ${slotGroups
          .map((g, idx) => `${idx + 1}칸(${g.segmentIds.length})`)
          .join(' + ')}`;

  const slotAspectClass =
    density === 2
      ? 'aspect-[844/2156] max-w-[180px] md:max-w-[230px]'
      : 'aspect-[844/945] max-w-[340px] sm:max-w-[360px]';

  const subtitle = transaction
    ? `${transaction.evidenceNo || ''} · ${transaction.title} (${formatWon(transaction.amount)})`
    : undefined;

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title="영수증 분할 · 칸 배치"
      subtitle={subtitle}
      size="wide"
      bodyClassName="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      {!transaction || !transaction.receiptImage ? (
        <div className="p-8 text-center text-[13.5px] text-[#8B95A1]">
          영수증 이미지를 불러올 수 없습니다.
        </div>
      ) : (
        <>
          {/* 상단 바: 기준 밀도 뱃지 + 모바일 2스텝 전환 */}
          <div className="px-4 sm:px-6 pb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E8EB] shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2.5 py-1 rounded-xl bg-[#F2F4F6] text-[#4E5968] text-[12px] font-bold">
                {density === 2 ? '1행2열 기준' : '2행2열 기준'}
              </span>
              <span
                className={`px-2.5 py-1 rounded-xl text-[12px] font-bold tabular-nums ${
                  slotGroups.length <= 1
                    ? 'bg-[#E8F3FF] text-[#1B64DA]'
                    : 'bg-[#191F28] text-[#FFFFFF]'
                }`}
              >
                {summaryPillText}
              </span>
            </div>

            {/* 모바일(< md) 2스텝 전환 탭 */}
            <div className="w-full md:hidden bg-[#F2F4F6] p-1 rounded-xl grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setMobileTab('cut')}
                className={`py-2 rounded-lg text-[13px] font-bold transition-all active:scale-[0.97] ${
                  mobileTab === 'cut'
                    ? 'bg-[#FFFFFF] text-[#3182F6]'
                    : 'text-[#4E5968]'
                }`}
              >
                1. 자르기 ({segments.length}조각)
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('place')}
                className={`py-2 rounded-lg text-[13px] font-bold transition-all active:scale-[0.97] ${
                  mobileTab === 'place'
                    ? 'bg-[#FFFFFF] text-[#3182F6]'
                    : 'text-[#4E5968]'
                }`}
              >
                2. 칸 배치 ({slotGroups.length}칸)
              </button>
            </div>
          </div>

          {/* 본문 2단 그리드 (데스크톱 좌/우 동시, 모바일 탭 전환) */}
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
            {/* 좌측(5/12): 원본 영수증 & 편집선 캔버스 */}
            <div
              className={`md:col-span-5 flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-[#E5E8EB] bg-[#F9FAFB] ${
                mobileTab === 'cut' ? 'flex' : 'hidden md:flex'
              }`}
            >
              {/* 1-Tap 자르기 퀵바 */}
              <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-[#FFFFFF] border-b border-[#E5E8EB] flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleAutoSplit}
                  className="h-9 px-3 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] sm:text-[12.5px] font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97] transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="sm:hidden">자동 {recommendedCount}등분</span>
                  <span className="hidden sm:inline">
                    자동 {recommendedCount}등분 ({recommendedSlotsPreview}칸)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleAddCutLine}
                  className="h-9 px-3 rounded-xl bg-[#F2F4F6] text-[#191F28] text-[12px] sm:text-[12.5px] font-semibold flex items-center gap-1 whitespace-nowrap active:scale-[0.97] transition-all"
                >
                  <Plus className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
                  <span>편집점 추가</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetSplits}
                  disabled={segments.length <= 1}
                  className="h-9 px-2.5 rounded-xl bg-[#F2F4F6] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-40 active:scale-[0.97] transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>초기화</span>
                </button>
              </div>

              {/* 스크롤 원본 이미지 캔버스 */}
              <div className="flex-1 overflow-y-auto p-4">
                <div
                  ref={cutCanvasRef}
                  onPointerUp={handleCanvasPointerUp}
                  className="relative w-full max-w-[360px] mx-auto select-none rounded-2xl overflow-hidden bg-[#FFFFFF] border border-[#E5E8EB]"
                >
                  {isReceiptImgLoading && !resolvedReceiptSrc ? (
                    <div className="w-full min-h-[260px] flex flex-col items-center justify-center gap-2 text-[#8B95A1]">
                      <Loader2 className="w-6 h-6 animate-spin text-[#3182F6]" />
                      <span className="text-[12.5px] font-medium">
                        영수증 원본 불러오는 중...
                      </span>
                    </div>
                  ) : hasReceiptImgError || !resolvedReceiptSrc ? (
                    <div className="w-full min-h-[260px] flex flex-col items-center justify-center gap-2.5 p-4 text-center">
                      <span className="text-[13px] font-semibold text-[#4E5968]">
                        영수증 원본을 불러오지 못했습니다
                      </span>
                      <button
                        type="button"
                        onClick={retryReceiptImg}
                        className="h-9 px-3.5 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold inline-flex items-center gap-1.5 active:scale-[0.97]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>다시 불러오기</span>
                      </button>
                    </div>
                  ) : (
                    <img
                      src={resolvedReceiptSrc}
                      alt="분할 대상 영수증"
                      referrerPolicy="no-referrer"
                      draggable={false}
                      onLoad={handleOriginImageLoad}
                      onError={handleReceiptImgError}
                      className="w-full h-auto block pointer-events-none"
                    />
                  )}

                  {/* 각 조각 구간 번호 배지(① ② ③) */}
                  {segments.map((seg, idx) => (
                    <div
                      key={seg.id}
                      style={{
                        top: `${seg.yStart * 100}%`,
                        height: `${(seg.yEnd - seg.yStart) * 100}%`,
                      }}
                      className={`absolute inset-x-0 pointer-events-none transition-colors ${
                        idx % 2 === 1 ? 'bg-[#3182F6]/[0.04]' : ''
                      }`}
                    >
                      <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-[#191F28]/90 text-[#FFFFFF] text-[12px] font-bold flex items-center justify-center tabular-nums">
                        {getCircledNumber(idx)}
                      </span>
                    </div>
                  ))}

                  {/* 수평 편집선 (44px 터치 히트영역) */}
                  {cutLines.map((cutY, lineIdx) => {
                    const isDragging = activeCutLineIdx === lineIdx;
                    const pct = Math.round(cutY * 100);
                    return (
                      <div
                        key={`cut-${lineIdx}`}
                        style={{ top: `${cutY * 100}%` }}
                        onPointerDown={(e) => handleCutLinePointerDown(e, lineIdx)}
                        onPointerMove={handleCutLinePointerMove}
                        onPointerUp={handleCutLinePointerUp}
                        onPointerCancel={handleCutLinePointerUp}
                        className="absolute inset-x-0 -translate-y-1/2 h-[44px] flex items-center cursor-ns-resize touch-none z-20"
                      >
                        {/* 드래그 중 손가락 가림 방지 상단 플로팅 수치 */}
                        {isDragging && (
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#191F28] text-[#FFFFFF] text-[11px] font-bold tabular-nums pointer-events-none">
                            {pct}%
                          </div>
                        )}

                        {/* 2px 파란 점선 */}
                        <div className="w-full border-t-2 border-dashed border-[#3182F6] relative flex items-center justify-between px-1.5">
                          <span className="w-6 h-6 -mt-[1px] rounded-full bg-[#3182F6] text-[#FFFFFF] flex items-center justify-center shrink-0">
                            <Scissors className="w-3.5 h-3.5" />
                          </span>

                          <span
                            className={`px-2 py-0.5 -mt-[1px] rounded-full text-[11px] font-bold tabular-nums flex items-center gap-1 transition-transform ${
                              isDragging
                                ? 'bg-[#191F28] text-[#FFFFFF] scale-105'
                                : 'bg-[#3182F6] text-[#FFFFFF]'
                            }`}
                          >
                            <GripHorizontal className="w-3 h-3" />
                            <span>{pct}%</span>
                          </span>

                          <button
                            type="button"
                            aria-label="편집점 삭제"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveCutLine(lineIdx);
                            }}
                            className="w-9 h-9 -mr-1.5 flex items-center justify-center shrink-0 active:scale-[0.92]"
                          >
                            <span className="w-6 h-6 rounded-full bg-[#FFEEF0] text-[#F04452] flex items-center justify-center">
                              <X className="w-3.5 h-3.5" />
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 모바일 하단 빠른 칸 배치 전환 버튼 */}
                <button
                  type="button"
                  onClick={() => setMobileTab('place')}
                  className="md:hidden mt-4 w-full h-11 rounded-2xl bg-[#FFFFFF] border border-[#E5E8EB] text-[#191F28] text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <Layers className="w-4 h-4 text-[#3182F6]" />
                  <span>칸 배치 보기 ({summaryPillText})</span>
                  <ArrowRight className="w-4 h-4 text-[#8B95A1]" />
                </button>
              </div>
            </div>

            {/* 우측(7/12): 실시간 A4 슬롯 배치 캔버스 */}
            <div
              className={`md:col-span-7 flex flex-col min-h-0 bg-[#F2F4F6]/60 ${
                mobileTab === 'place' ? 'flex' : 'hidden md:flex'
              }`}
            >
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {slotViewModels.map((vm, slotIdx) => {
                  const isFirst = slotIdx === 0;
                  return (
                    <React.Fragment key={`slot-group-${slotIdx}`}>
                      {/* 오버플로우 연결 칩 */}
                      {!isFirst && (
                        <div className="flex items-center justify-center">
                          <span className="px-3 py-1 rounded-full bg-[#FFFFFF] border border-[#E5E8EB] text-[#4E5968] text-[11.5px] font-semibold flex items-center gap-1">
                            <ArrowDown className="w-3.5 h-3.5 text-[#3182F6]" />
                            <span>다음 칸으로 이어짐</span>
                          </span>
                        </div>
                      )}

                      <div className="bg-[#FFFFFF] rounded-2xl p-3.5 border border-[#E5E8EB] space-y-3">
                        {/* 슬롯 카드 헤더 */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-lg bg-[#191F28] text-[#FFFFFF] text-[11.5px] font-bold tabular-nums">
                              {slotViewModels.length > 1
                                ? `칸 ${slotIdx + 1} / ${slotViewModels.length}`
                                : 'A4 1칸'}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold tabular-nums">
                              {vm.group.segmentIds.length}조각
                            </span>
                            {vm.hasUnderReadable && (
                              <span className="px-2 py-0.5 rounded-lg bg-[#FFEEF0] text-[#F04452] text-[11px] font-bold">
                                글씨 작음
                              </span>
                            )}
                          </div>

                          {/* 슬롯 내부 모드 토글 */}
                          <div className="bg-[#F2F4F6] p-0.5 rounded-xl inline-flex items-center">
                            <button
                              type="button"
                              onClick={() => handleSetSlotMode(slotIdx, 'auto')}
                              className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold transition-all ${
                                !vm.isCustom
                                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                                  : 'text-[#4E5968]'
                              }`}
                            >
                              자동 맞춤
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetSlotMode(slotIdx, 'custom')}
                              className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold transition-all flex items-center gap-1 ${
                                vm.isCustom
                                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                                  : 'text-[#4E5968]'
                              }`}
                            >
                              <Move className="w-3 h-3" />
                              <span>자유 배치</span>
                            </button>
                          </div>
                        </div>

                        {/* 실제 A4 슬롯 비율 박스 */}
                        <div
                          ref={(el) => {
                            slotBoxRefs.current[slotIdx] = el;
                          }}
                          onClick={() => setSelectedPiece(null)}
                          className={`relative w-full mx-auto rounded-xl border border-[#191F28]/25 bg-[#F9FAFB] overflow-hidden select-none ${slotAspectClass}`}
                        >
                          {vm.placements.map((placement, pIdx) => {
                            const seg = segmentsById.get(placement.segmentId);
                            if (!seg) return null;
                            const orderIdx = segmentOrderMap.get(seg.id) ?? pIdx;
                            const isSelected =
                              selectedPiece?.slotIdx === slotIdx &&
                              selectedPiece?.segId === seg.id;
                            const sliceEntry = sliceUrlsBySegId[seg.id];
                            const renderedWidthMm = getPlacementRenderedWidthMm(
                              placement,
                              density
                            );
                            const isSmallPrint =
                              renderedWidthMm <
                              RECEIPT_PACKING_METRICS.MIN_PACKED_WIDTH_MM;

                            const svgTotalH = SVG_BASE_WIDTH * origAspectHW;
                            const vx = (seg.xStart ?? 0) * SVG_BASE_WIDTH;
                            const vy = seg.yStart * svgTotalH;
                            const vw =
                              ((seg.xEnd ?? 1) - (seg.xStart ?? 0)) *
                              SVG_BASE_WIDTH;
                            const vh = (seg.yEnd - seg.yStart) * svgTotalH;

                            return (
                              <div
                                key={seg.id}
                                style={{
                                  left: `${placement.x * 100}%`,
                                  top: `${placement.y * 100}%`,
                                  width: `${placement.w * 100}%`,
                                  height: `${placement.h * 100}%`,
                                  zIndex: (placement.z ?? pIdx + 1) + (isSelected ? 20 : 1),
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!vm.isCustom) {
                                    handleAutoPieceClick(slotIdx, seg.id);
                                  } else {
                                    setSelectedPiece({ slotIdx, segId: seg.id });
                                    bumpPieceZIndex(slotIdx, seg.id);
                                  }
                                }}
                                onPointerDown={
                                  vm.isCustom
                                    ? (e) =>
                                        startCustomPieceDrag(
                                          e,
                                          'move',
                                          slotIdx,
                                          placement
                                        )
                                    : undefined
                                }
                                onPointerMove={
                                  vm.isCustom
                                    ? handleCustomPiecePointerMove
                                    : undefined
                                }
                                onPointerUp={
                                  vm.isCustom
                                    ? handleCustomPiecePointerUp
                                    : undefined
                                }
                                onPointerCancel={
                                  vm.isCustom
                                    ? handleCustomPiecePointerUp
                                    : undefined
                                }
                                className={`absolute rounded-lg bg-[#FFFFFF] border transition-shadow ${
                                  vm.isCustom
                                    ? 'cursor-grab active:cursor-grabbing touch-none'
                                    : 'cursor-pointer'
                                } ${
                                  isSelected
                                    ? 'border-[#3182F6] ring-2 ring-[#3182F6]'
                                    : 'border-[#D1D6DB]'
                                }`}
                              >
                                {/* 조각 이미지 (Blob URL 우선, 생성 전/CORS 실패 시 SVG viewBox 즉시 표시) */}
                                <div className="w-full h-full overflow-hidden rounded-[7px] pointer-events-none">
                                  {sliceEntry?.url &&
                                  !sliceEntry.fallbackSvg &&
                                  activeCutLineIdx === null ? (
                                    <img
                                      src={sliceEntry.url}
                                      alt={`조각 ${orderIdx + 1}`}
                                      draggable={false}
                                      className="w-full h-full object-contain block"
                                    />
                                  ) : (
                                    <svg
                                      viewBox={`${vx} ${vy} ${Math.max(1, vw)} ${Math.max(1, vh)}`}
                                      preserveAspectRatio="xMidYMid meet"
                                      className="w-full h-full block"
                                    >
                                      <image
                                        href={
                                          resolvedReceiptSrc ||
                                          transaction.receiptImage
                                        }
                                        x={0}
                                        y={0}
                                        width={SVG_BASE_WIDTH}
                                        height={svgTotalH}
                                      />
                                    </svg>
                                  )}
                                </div>

                                {/* 좌상단 순번 배지 */}
                                <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-[#191F28]/90 text-[#FFFFFF] text-[11px] font-bold flex items-center justify-center pointer-events-none tabular-nums">
                                  {getCircledNumber(orderIdx)}
                                </span>

                                {/* 비차단 가독성 경고 칩 */}
                                {isSmallPrint && (
                                  <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-[#FFEEF0]/95 text-[#F04452] text-[10px] font-bold pointer-events-none">
                                    글씨 작음
                                  </span>
                                )}

                                {/* 자유 배치 우하단 종횡비 고정 리사이즈 핸들 (조각 내부 배치로 overflow-hidden 클리핑 100% 방지) */}
                                {vm.isCustom && (
                                  <div
                                    onPointerDown={(e) =>
                                      startCustomPieceDrag(
                                        e,
                                        'resize',
                                        slotIdx,
                                        placement
                                      )
                                    }
                                    onPointerMove={handleCustomPiecePointerMove}
                                    onPointerUp={handleCustomPiecePointerUp}
                                    onPointerCancel={handleCustomPiecePointerUp}
                                    aria-label="크기 조절"
                                    className="absolute right-0 bottom-0 w-9 h-9 flex items-end justify-end p-1 cursor-nwse-resize touch-none z-30"
                                  >
                                    <span className="w-4 h-4 rounded-full bg-[#3182F6] border-2 border-[#FFFFFF] shadow-sm" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* 조각 선택 보조 액션바 (모바일 2행 고정 정리) */}
              {selectedPiece && selectedSlotVm && (
                <div className="px-4 py-2.5 bg-[#191F28] text-[#FFFFFF] space-y-2 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold tabular-nums min-w-0 truncate">
                      {getCircledNumber(
                        segmentOrderMap.get(selectedPiece.segId) ?? 0
                      )}{' '}
                      선택됨
                      {!selectedSlotVm.isCustom &&
                        selectedSlotVm.group.segmentIds.length > 1 &&
                        ' · 바꿀 조각 탭'}
                    </span>

                    {segments.length >= 2 && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={!canMovePrevSlot}
                          onClick={() => handleMoveSelectedBetweenSlots(-1)}
                          className="h-9 px-2.5 rounded-lg bg-[#FFFFFF]/15 text-[#FFFFFF] text-[11.5px] font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-35 active:scale-[0.97]"
                        >
                          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                          <span>이전 칸</span>
                        </button>
                        <button
                          type="button"
                          disabled={!canMoveNextSlot}
                          onClick={() => handleMoveSelectedBetweenSlots(1)}
                          className="h-9 px-2.5 rounded-lg bg-[#FFFFFF]/15 text-[#FFFFFF] text-[11.5px] font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-35 active:scale-[0.97]"
                        >
                          <span>다음 칸</span>
                          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedSlotVm.isCustom && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleScaleSelectedPiece(SCALE_STEP_DOWN)}
                        className="h-9 px-2.5 rounded-lg bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap active:scale-[0.97]"
                      >
                        <ZoomOut className="w-3.5 h-3.5 shrink-0" />
                        <span>작게</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScaleSelectedPiece(SCALE_STEP_UP)}
                        className="h-9 px-2.5 rounded-lg bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap active:scale-[0.97]"
                      >
                        <ZoomIn className="w-3.5 h-3.5 shrink-0" />
                        <span>크게</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSetSlotMode(selectedPiece.slotIdx, 'auto')
                        }
                        className="h-9 px-2.5 rounded-lg bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12px] font-semibold flex items-center justify-center whitespace-nowrap active:scale-[0.97]"
                      >
                        자동 정렬
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 하단 고정 액션바 (iOS safe-area-bottom 적용) */}
          <div className="px-4 sm:px-6 pt-3 safe-area-bottom sm:pb-3.5 bg-[#FFFFFF] border-t border-[#E5E8EB] flex items-center justify-between gap-2.5 shrink-0">
            <div className="text-[12.5px] sm:text-[13px] font-bold text-[#191F28] tabular-nums min-w-0 truncate">
              {isWholeSingleSegment(segments)
                ? '원본 1장 · A4 1칸'
                : `총 ${segments.length}조각 · A4 ${slotGroups.length}칸`}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-4 rounded-2xl bg-[#F2F4F6] text-[#4E5968] text-[13.5px] font-semibold whitespace-nowrap active:scale-[0.97] transition-all"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                className="h-11 px-5 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[13.5px] font-bold whitespace-nowrap active:scale-[0.97] transition-all"
              >
                분할 적용
              </button>
            </div>
          </div>
        </>
      )}
    </TdsDialog>
  );
};
