import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Edit3,
  Eye,
  FileSpreadsheet,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Printer,
  Scissors,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react';
import {
  ACCOUNT_LABELS,
  AccountType,
  AppSettings,
  MOKJANG_SUBTYPE_LABELS,
  MokjangGroup,
  ProcessedTransaction,
  ReceiptBookLayoutEntry,
  ReceiptBookLayoutsMap,
  ReceiptDensity,
  ReceiptEditConfig,
  ReceiptPageLayout,
  ReceiptSegment,
  SegmentGroupSlotRef,
  SlotSegmentPlacement,
  Transaction,
} from '../types/finance';
import { compressReceiptImage } from '../utils/imageCompressor';
import {
  formatNumber,
  formatShortDate,
  formatWon,
  formatYearMonthKorean,
  numberToKoreanCurrency,
} from '../utils/koreanCurrency';
import {
  evaluateSlotFit,
  isLongReceipt,
  RECEIPT_SLOT_GEOMETRY,
} from '../utils/receiptGeometry';
import {
  addEmptyPage,
  applyReceiptSplitToPages,
  buildReceiptLayoutScopeKey,
  buildTxSlotRenderMetaMap,
  compactPages,
  deriveLayoutForDensity,
  getEffectiveTxAspectHW,
  hasActiveReceiptSplit,
  resetPagesOrder,
  resolveReceiptBookPages,
} from '../utils/receiptLayoutEngine';
import {
  buildSlotCompositeCacheKey,
  ensureAllPrintSlicesReady,
  renderSlotCompositeUrl,
  revokeAllSliceUrls,
  revokeUnusedSliceUrls,
  SlotCompositeRenderArgs,
} from '../utils/receiptSliceRenderer';
import { CategoryBudgetAllocation } from '../utils/syncManager';
import { A4ScalePreview } from './A4ScalePreview';
import { ReceiptPlacementBoard } from './ReceiptPlacementBoard';
import { ReceiptSplitEditor } from './ReceiptSplitEditor';

interface PrintCenterViewProps {
  yearMonth: string;
  accountFilter: AccountType;
  onAccountFilterChange: (acc: AccountType) => void;
  processedTransactions: ProcessedTransaction[];
  carryoverAmount: number;
  monthlyIncome: number;
  monthlyExpense: number;
  currentBalance: number;
  mokjangs: MokjangGroup[];
  categoryAllocations: Record<string, CategoryBudgetAllocation>;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onSelectTransaction: (tx: ProcessedTransaction) => void;
  onQuickSaveTransaction?: (tx: Transaction) => void;
  receiptLayouts: ReceiptBookLayoutsMap;
  onUpdateReceiptLayout: (
    scopeKey: string,
    entry: ReceiptBookLayoutEntry
  ) => void;
}

type PrintOutputMode = 'both' | 'ledger_only' | 'receipts_only';
type ReceiptFitMode = 'contain' | 'width';
type PrintScreenMode = 'mobile_inspector' | 'layout_board' | 'a4_preview';
type InspectorFilter = 'all' | 'missing' | 'attached' | 'long';

interface CompositeSlotDescriptor {
  posKey: string;
  cacheKey: string;
  task: SlotCompositeRenderArgs;
  segments: ReceiptSegment[];
  placements: SlotSegmentPlacement[];
}

const SVG_VIEWBOX_SCALE = 10;

export const PrintCenterView: React.FC<PrintCenterViewProps> = ({
  yearMonth,
  accountFilter,
  onAccountFilterChange,
  processedTransactions,
  carryoverAmount,
  monthlyIncome,
  monthlyExpense,
  currentBalance,
  mokjangs,
  categoryAllocations,
  settings,
  onUpdateSettings,
  onSelectTransaction,
  onQuickSaveTransaction,
  receiptLayouts,
  onUpdateReceiptLayout,
}) => {
  const [outputMode, setOutputMode] = useState<PrintOutputMode>('both');
  const [localDensity, setLocalDensity] = useState<ReceiptDensity>(4);
  const [fitMode, setFitMode] = useState<ReceiptFitMode>('contain');
  const [scanFilter, setScanFilter] = useState<boolean>(false);
  const [includeMissingSlots, setIncludeMissingSlots] = useState<boolean>(true);
  const [reportDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  // 모바일(< 860px)에서는 영수증 검수 피드 기본, 데스크톱에서는 A4 미리보기 기본
  const [screenMode, setScreenMode] = useState<PrintScreenMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 860
      ? 'mobile_inspector'
      : 'a4_preview'
  );
  const [a4ZoomMode, setA4ZoomMode] = useState<'fit' | 'actual'>('fit');
  const [inspectorFilter, setInspectorFilter] =
    useState<InspectorFilter>('all');
  const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);
  const [uploadingTxId, setUploadingTxId] = useState<string | null>(null);
  const [isPreparingPrint, setIsPreparingPrint] = useState<boolean>(false);

  // receiptMeta가 없는 레거시 영수증 이미지의 런타임 naturalWidth/Height 보강 캐시
  const [runtimeImageDimensions, setRuntimeImageDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});

  // 슬롯 위치(`${pageIdx}:${slotIdx}`)별 300 DPI 합성 Blob URL 상태
  const [slotCompositeByPosition, setSlotCompositeByPosition] = useState<
    Record<string, { url?: string; fallbackSvg?: boolean }>
  >({});

  // 영수증 분할·슬롯 배치 에디터 모달 상태
  const [editorState, setEditorState] = useState<{
    txId: string;
    initialTab: 'cut' | 'place';
  } | null>(null);

  const printAreaRef = useRef<HTMLDivElement | null>(null);

  const scopeKey = useMemo(
    () => buildReceiptLayoutScopeKey(yearMonth, accountFilter),
    [yearMonth, accountFilter]
  );

  const savedEntry = receiptLayouts[scopeKey];
  const density: ReceiptDensity = savedEntry?.activeDensity ?? localDensity;

  const mokjangMap = useMemo(
    () => new Map(mokjangs.map((m) => [m.id, m])),
    [mokjangs]
  );

  const transactionMap = useMemo(
    () => new Map(processedTransactions.map((tx) => [tx.id, tx])),
    [processedTransactions]
  );

  // tx.receiptMeta 우선 + 미존재 레거시 이미지는 onLoad 런타임 치수 폴백
  const effectiveImageDimensions = useMemo(() => {
    const merged: Record<string, { width: number; height: number }> = {
      ...runtimeImageDimensions,
    };
    for (const tx of processedTransactions) {
      if (
        tx.receiptMeta &&
        tx.receiptMeta.width > 0 &&
        tx.receiptMeta.height > 0
      ) {
        merged[tx.id] = {
          width: tx.receiptMeta.width,
          height: tx.receiptMeta.height,
        };
      }
    }
    return merged;
  }, [processedTransactions, runtimeImageDimensions]);

  const allExpenseEvidenceItems = useMemo(
    () => processedTransactions.filter((tx) => Boolean(tx.evidenceNo)),
    [processedTransactions]
  );

  const missingReceiptCount = useMemo(
    () => allExpenseEvidenceItems.filter((tx) => !tx.receiptImage).length,
    [allExpenseEvidenceItems]
  );

  const attachedReceiptCount =
    allExpenseEvidenceItems.length - missingReceiptCount;

  const longReceiptTxIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of allExpenseEvidenceItems) {
      if (!tx.receiptImage) continue;
      const dim = effectiveImageDimensions[tx.id];
      if (isLongReceipt(dim?.width, dim?.height, density)) {
        ids.add(tx.id);
      }
    }
    return ids;
  }, [allExpenseEvidenceItems, effectiveImageDimensions, density]);

  const longReceiptCount = longReceiptTxIds.size;

  // 긴 영수증이 0건이 되면 필터 자동 복귀
  useEffect(() => {
    if (inspectorFilter === 'long' && longReceiptCount === 0) {
      setInspectorFilter('all');
    }
  }, [inspectorFilter, longReceiptCount]);

  const filteredInspectorItems = useMemo(() => {
    if (inspectorFilter === 'missing') {
      return allExpenseEvidenceItems.filter((tx) => !tx.receiptImage);
    }
    if (inspectorFilter === 'attached') {
      return allExpenseEvidenceItems.filter((tx) => Boolean(tx.receiptImage));
    }
    if (inspectorFilter === 'long') {
      return allExpenseEvidenceItems.filter((tx) => longReceiptTxIds.has(tx.id));
    }
    return allExpenseEvidenceItems;
  }, [allExpenseEvidenceItems, inspectorFilter, longReceiptTxIds]);

  const resolvedPages = useMemo(
    () =>
      resolveReceiptBookPages({
        transactions: processedTransactions,
        density,
        includeMissingSlots,
        savedEntry,
        imageDimensions: effectiveImageDimensions,
      }),
    [
      processedTransactions,
      density,
      includeMissingSlots,
      savedEntry,
      effectiveImageDimensions,
    ]
  );

  const slotMetaMap = useMemo(
    () => buildTxSlotRenderMetaMap(resolvedPages),
    [resolvedPages]
  );

  // 모든 segment_group 슬롯에 대한 300 DPI 합성 작업 명세 생성
  const compositeDescriptors = useMemo<CompositeSlotDescriptor[]>(() => {
    const list: CompositeSlotDescriptor[] = [];

    resolvedPages.forEach((page, pageIdx) => {
      page.slots.forEach((slot, slotIdx) => {
        if (slot.kind !== 'segment_group') return;
        const tx = transactionMap.get(slot.txId);
        if (!tx?.receiptImage || !tx.receiptEdit?.segments?.length) return;

        const segMap = new Map(tx.receiptEdit.segments.map((s) => [s.id, s]));
        const groupSegments = slot.segmentIds
          .map((id) => segMap.get(id))
          .filter((s): s is ReceiptSegment => Boolean(s));
        if (groupSegments.length === 0) return;

        const origAspectHW = getEffectiveTxAspectHW(
          tx,
          effectiveImageDimensions
        );
        const placements: SlotSegmentPlacement[] =
          slot.layoutMode === 'custom' &&
          slot.placements &&
          slot.placements.length > 0
            ? slot.placements
            : evaluateSlotFit(groupSegments, origAspectHW, density).placements;

        const posKey = `${pageIdx}:${slotIdx}`;
        const meta = slotMetaMap.get(posKey);
        const task: SlotCompositeRenderArgs = {
          txId: tx.id,
          evidenceNo: tx.evidenceNo,
          src: tx.receiptImage,
          segments: tx.receiptEdit.segments,
          placements,
          density,
          scanFilter,
          slotIndex: meta?.slotIndexOfTx ?? 0,
          slotTotal: meta?.slotTotalOfTx ?? 1,
          startPieceNumber: meta?.startPieceNumber ?? 1,
        };

        list.push({
          posKey,
          cacheKey: buildSlotCompositeCacheKey(task),
          task,
          segments: tx.receiptEdit.segments,
          placements,
        });
      });
    });

    return list;
  }, [
    resolvedPages,
    transactionMap,
    effectiveImageDimensions,
    density,
    scanFilter,
    slotMetaMap,
  ]);

  const compositeDescriptorByPos = useMemo(
    () => new Map(compositeDescriptors.map((d) => [d.posKey, d])),
    [compositeDescriptors]
  );

  // 배치 편집 / A4 미리보기 진입 시 300 DPI 슬롯 합성 Blob URL 온디맨드 생성
  useEffect(() => {
    if (screenMode === 'mobile_inspector') return;

    let cancelled = false;
    const activeKeys = new Set(compositeDescriptors.map((d) => d.cacheKey));

    const run = async () => {
      if (compositeDescriptors.length === 0) {
        setSlotCompositeByPosition({});
        revokeUnusedSliceUrls(activeKeys, 'slot|');
        return;
      }

      const nextMap: Record<string, { url?: string; fallbackSvg?: boolean }> =
        {};
      for (const desc of compositeDescriptors) {
        if (cancelled) return;
        const res = await renderSlotCompositeUrl(desc.task);
        if (cancelled) return;
        nextMap[desc.posKey] = {
          url: res.url,
          fallbackSvg: res.fallbackSvg,
        };
      }

      if (!cancelled) {
        setSlotCompositeByPosition(nextMap);
        revokeUnusedSliceUrls(activeKeys, 'slot|');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [screenMode, compositeDescriptors]);

  // 언마운트 시 모든 슬라이스 Blob URL 결정적 회수
  useEffect(() => {
    return () => {
      revokeAllSliceUrls();
    };
  }, []);

  // 관/항(카테고리)별 지출 소계 + 연간 예산안 연동 월평균 예산 대비 집행률 집계
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    processedTransactions
      .filter((tx) => tx.type === 'expense')
      .forEach((tx) => {
        const prev = map.get(tx.category) || { count: 0, total: 0 };
        map.set(tx.category, {
          count: prev.count + 1,
          total: prev.total + tx.amount,
        });
      });

    return Array.from(map.entries()).map(([cat, info]) => {
      const monthlyBudget = categoryAllocations[cat]?.monthlyBudget || 0;
      const rate =
        monthlyBudget > 0 ? Math.round((info.total / monthlyBudget) * 100) : 0;
      return {
        category: cat,
        count: info.count,
        total: info.total,
        monthlyBudget,
        rate,
      };
    });
  }, [processedTransactions, categoryAllocations]);

  const rowCount = processedTransactions.length;
  const tableRowPaddingClass =
    rowCount > 18
      ? 'py-1 px-1.5 text-[10px]'
      : rowCount > 12
        ? 'py-1.5 px-2 text-[11px]'
        : 'py-2 px-2.5 text-[11.5px]';

  const commitDensityPages = (
    nextPages: ReceiptPageLayout[],
    targetDensity: ReceiptDensity = density
  ) => {
    const now = new Date().toISOString();
    const prevDensityLayout = savedEntry?.byDensity?.[targetDensity];
    const nextEntry: ReceiptBookLayoutEntry = {
      version: 1,
      activeDensity: targetDensity,
      byDensity: {
        ...savedEntry?.byDensity,
        [targetDensity]: {
          density: targetDensity,
          pages: nextPages,
          unplaced: prevDensityLayout?.unplaced,
          updatedAt: now,
        },
      },
      updatedAt: now,
    };
    onUpdateReceiptLayout(scopeKey, nextEntry);
  };

  const handleDensityChange = (nextDensity: ReceiptDensity) => {
    setLocalDensity(nextDensity);
    if (nextDensity === density && savedEntry?.activeDensity === nextDensity) {
      return;
    }

    const now = new Date().toISOString();
    const existingTarget = savedEntry?.byDensity?.[nextDensity];
    const currentSource = savedEntry?.byDensity?.[density];

    const nextByDensity = { ...savedEntry?.byDensity };
    if (!existingTarget && currentSource) {
      nextByDensity[nextDensity] = deriveLayoutForDensity({
        transactions: processedTransactions,
        targetDensity: nextDensity,
        sourceLayout: currentSource,
        includeMissingSlots,
        imageDimensions: effectiveImageDimensions,
      });
    }

    onUpdateReceiptLayout(scopeKey, {
      version: 1,
      activeDensity: nextDensity,
      byDensity: nextByDensity,
      updatedAt: now,
    });
  };

  const handleRecordImageDimensions = (
    txId: string,
    e: React.SyntheticEvent<HTMLImageElement>
  ) => {
    const img = e.currentTarget;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (width <= 0 || height <= 0) return;

    setRuntimeImageDimensions((prev) => {
      const existing = prev[txId];
      if (existing && existing.width === width && existing.height === height) {
        return prev;
      }
      return {
        ...prev,
        [txId]: { width, height },
      };
    });
  };

  const handleOpenSplitEditor = (
    tx: ProcessedTransaction,
    initialTab: 'cut' | 'place' = 'cut'
  ) => {
    if (!tx.receiptImage) return;
    setEditorState({ txId: tx.id, initialTab });
  };

  const editingTransaction = useMemo(() => {
    if (!editorState) return null;
    return transactionMap.get(editorState.txId) ?? null;
  }, [editorState, transactionMap]);

  const editingInitialSlotGroups = useMemo<SegmentGroupSlotRef[]>(() => {
    if (!editingTransaction) return [];
    const groups: SegmentGroupSlotRef[] = [];
    for (const page of resolvedPages) {
      for (const slot of page.slots) {
        if (
          slot.kind === 'segment_group' &&
          slot.txId === editingTransaction.id
        ) {
          groups.push(slot);
        }
      }
    }
    return groups;
  }, [editingTransaction, resolvedPages]);

  const handleApplySplitEditor = (result: {
    txId: string;
    receiptEdit: ReceiptEditConfig | undefined;
    slotGroups: SegmentGroupSlotRef[];
  }) => {
    const targetTx = transactionMap.get(result.txId);
    if (targetTx && onQuickSaveTransaction) {
      const { evidenceNo: _ev, runningBalance: _rb, ...rawTx } = targetTx;
      onQuickSaveTransaction({
        ...rawTx,
        receiptEdit: result.receiptEdit,
      });
    }

    const nextPages = applyReceiptSplitToPages({
      pages: resolvedPages,
      density,
      txId: result.txId,
      nextReceiptEdit: result.receiptEdit,
      nextSlotGroups: result.slotGroups,
    });
    commitDensityPages(nextPages, density);
    setEditorState(null);
  };

  const handleCompactPages = () => {
    commitDensityPages(compactPages(resolvedPages, density), density);
  };

  const handleResetPagesOrder = () => {
    const reset = resetPagesOrder({
      transactions: processedTransactions,
      density,
      includeMissingSlots,
      imageDimensions: effectiveImageDimensions,
    });
    commitDensityPages(reset, density);
  };

  const handleAddEmptyPage = () => {
    commitDensityPages(addEmptyPage(resolvedPages, density), density);
  };

  /**
   * 인쇄 동기화 게이트: 어느 탭(검수/배치/미리보기)에서 클릭해도
   * 모든 300 DPI 슬롯 합성 Blob URL 생성 + React DOM 커밋(2×rAF) + img.decode() 완료 후 인쇄 호출
   */
  const handlePrint = async () => {
    if (isPreparingPrint) return;
    setIsPreparingPrint(true);
    try {
      if (compositeDescriptors.length > 0) {
        const renderedByKey = await ensureAllPrintSlicesReady(
          compositeDescriptors.map((d) => d.task),
          null
        );
        const nextMap: Record<string, { url?: string; fallbackSvg?: boolean }> =
          {};
        for (const desc of compositeDescriptors) {
          const hit = renderedByKey[desc.cacheKey];
          if (hit) {
            nextMap[desc.posKey] = {
              url: hit.url,
              fallbackSvg: hit.fallbackSvg,
            };
          }
        }
        setSlotCompositeByPosition(nextMap);
      }

      await ensureAllPrintSlicesReady([], printAreaRef.current);
      window.print();
    } finally {
      setIsPreparingPrint(false);
    }
  };

  const handleRoleChange = (idx: 0 | 1 | 2 | 3, val: string) => {
    const nextRoles: [string, string, string, string] = [
      ...settings.approvalRoles,
    ] as [string, string, string, string];
    nextRoles[idx] = val;
    onUpdateSettings({
      ...settings,
      approvalRoles: nextRoles,
    });
  };

  const toggleApprovalBox = () => {
    onUpdateSettings({
      ...settings,
      showApprovalBox: !settings.showApprovalBox,
    });
  };

  const handleInlinePhotoUpload = async (
    tx: ProcessedTransaction,
    file?: File
  ) => {
    if (!file || !onQuickSaveTransaction) return;
    setUploadingTxId(tx.id);
    try {
      const compressed = await compressReceiptImage(file, 1200, 0.8);
      const { evidenceNo: _ev, runningBalance: _rb, ...rawTx } = tx;
      onQuickSaveTransaction({
        ...rawTx,
        receiptImage: compressed.dataUrl,
        receiptDriveUrl: undefined,
        receiptMeta: compressed.meta,
        receiptEdit: undefined,
      });
      setRuntimeImageDimensions((prev) => ({
        ...prev,
        [tx.id]: {
          width: compressed.meta.width,
          height: compressed.meta.height,
        },
      }));
    } catch (err) {
      console.error('영수증 즉시 압축 실패:', err);
    } finally {
      setUploadingTxId(null);
    }
  };

  const handleInlineMemoChange = (
    tx: ProcessedTransaction,
    nextMemo: string
  ) => {
    if (!onQuickSaveTransaction) return;
    const { evidenceNo: _ev, runningBalance: _rb, ...rawTx } = tx;
    onQuickSaveTransaction({
      ...rawTx,
      memo: nextMemo,
    });
  };

  const renderFallbackSvgSlot = (
    tx: ProcessedTransaction,
    descriptor: CompositeSlotDescriptor
  ) => {
    if (!tx.receiptImage) return null;
    const geom = RECEIPT_SLOT_GEOMETRY[density];
    const vbW = Math.round(geom.widthMm * SVG_VIEWBOX_SCALE);
    const vbH = Math.round(geom.heightMm * SVG_VIEWBOX_SCALE);
    const dim = effectiveImageDimensions[tx.id];
    const natW = dim?.width || 1000;
    const natH = dim?.height || 1400;
    const segById = new Map(descriptor.segments.map((s) => [s.id, s]));

    const orderedPlacements = descriptor.placements
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => (a.p.z ?? a.idx) - (b.p.z ?? b.idx));

    return (
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        className={`w-full h-full ${scanFilter ? 'receipt-scan-filter' : ''}`}
      >
        <rect x={0} y={0} width={vbW} height={vbH} fill="#FFFFFF" />
        {orderedPlacements.map(({ p }) => {
          const seg = segById.get(p.segmentId);
          if (!seg) return null;
          const xStart = seg.xStart ?? 0;
          const xEnd = seg.xEnd ?? 1;
          const sx = xStart * natW;
          const sy = seg.yStart * natH;
          const sw = Math.max(1, (xEnd - xStart) * natW);
          const sh = Math.max(1, (seg.yEnd - seg.yStart) * natH);
          return (
            <svg
              key={p.segmentId}
              x={p.x * vbW}
              y={p.y * vbH}
              width={p.w * vbW}
              height={p.h * vbH}
              viewBox={`${sx} ${sy} ${sw} ${sh}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <image
                href={tx.receiptImage}
                x={0}
                y={0}
                width={natW}
                height={natH}
              />
            </svg>
          );
        })}
      </svg>
    );
  };

  const yearMonthTitle = formatYearMonthKorean(yearMonth);
  const receiptPageCount = resolvedPages.length;
  const hasAnyReceiptEvidence = allExpenseEvidenceItems.length > 0;

  return (
    <div className="space-y-5 pb-24 sm:pb-12 print-container">
      {/* =====================================================================
          1. 상단 컨트롤 & 3단 모드 전환 바 (@media print 시 완벽 숨김: .no-print)
         ===================================================================== */}
      <section className="no-print max-w-[980px] mx-auto bg-[#FFFFFF] rounded-3xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
          <h2 className="text-[18px] sm:text-[19px] font-bold text-[#191F28]">
            결산서 · 영수증철 인쇄
          </h2>

          <button
            type="button"
            disabled={isPreparingPrint}
            onClick={() => void handlePrint()}
            className="h-11 px-5 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[14px] font-semibold flex items-center justify-center gap-2 shrink-0 whitespace-nowrap active:scale-[0.97] transition-all duration-150 disabled:opacity-60"
          >
            <Printer className="w-4 h-4 shrink-0" />
            {isPreparingPrint ? '인쇄 준비 중...' : '인쇄 / PDF 저장'}
          </button>
        </div>

        {/* 3단 화면 모드 전환 탭 + 상시 노출 1행2열 / 2행2열 토글 */}
        <div className="flex flex-col gap-2.5 bg-[#F9FAFB] p-2 sm:p-2.5 rounded-2xl">
          <div className="bg-[#E5E8EB] p-1 rounded-xl grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => setScreenMode('mobile_inspector')}
              className={`py-2 sm:py-2.5 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-[13px] font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'mobile_inspector'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span className="sm:hidden tabular-nums">
                검수 ({allExpenseEvidenceItems.length})
              </span>
              <span className="hidden sm:inline tabular-nums">
                영수증 검수 ({allExpenseEvidenceItems.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScreenMode('layout_board')}
              className={`py-2 sm:py-2.5 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-[13px] font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'layout_board'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">배치</span>
              <span className="hidden sm:inline">배치 편집</span>
            </button>

            <button
              type="button"
              onClick={() => setScreenMode('a4_preview')}
              className={`py-2 sm:py-2.5 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-[13px] font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'a4_preview'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Eye className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">A4 보기</span>
              <span className="hidden sm:inline">A4 미리보기</span>
            </button>
          </div>

          {/* 상단 승격: 1행2열(2칸) / 2행2열(4칸) 밀도 전환 + A4 줌 토글 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid items-center gap-1 bg-[#FFFFFF] p-1 rounded-xl">
              <button
                type="button"
                onClick={() => handleDensityChange(2)}
                className={`min-h-9 px-3 py-1.5 rounded-lg text-[12px] font-bold whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                  density === 2
                    ? 'bg-[#191F28] text-[#FFFFFF]'
                    : 'text-[#4E5968] hover:text-[#191F28]'
                }`}
              >
                1행2열 (2칸)
              </button>
              <button
                type="button"
                onClick={() => handleDensityChange(4)}
                className={`min-h-9 px-3 py-1.5 rounded-lg text-[12px] font-bold whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                  density === 4
                    ? 'bg-[#191F28] text-[#FFFFFF]'
                    : 'text-[#4E5968] hover:text-[#191F28]'
                }`}
              >
                2행2열 (4칸)
              </button>
            </div>

            {screenMode === 'a4_preview' && (
              <button
                type="button"
                onClick={() =>
                  setA4ZoomMode((prev) => (prev === 'fit' ? 'actual' : 'fit'))
                }
                className="w-full sm:w-auto min-h-9 px-3.5 py-2 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap active:scale-[0.97] transition-all duration-150"
              >
                {a4ZoomMode === 'fit' ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
                    <span>화면 맞춤 · 100% 보기</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
                    <span>100% 크기 · 화면 맞춤</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 출력 문서 구성 선택 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            {
              id: 'both',
              label: '세트 전체 출력',
              sub: `장부 1장 + 영수증철 ${receiptPageCount}장`,
            },
            {
              id: 'ledger_only',
              label: '1. 월별 장부만',
              sub: '결산 보고서 (A4 1장)',
            },
            {
              id: 'receipts_only',
              label: '2. 영수증 증빙철만',
              sub: `증빙 첨부지 (A4 ${receiptPageCount}장)`,
            },
          ].map((opt) => {
            const active = outputMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setOutputMode(opt.id as PrintOutputMode)}
                className={`p-3 rounded-2xl text-left transition-all duration-150 active:scale-[0.97] ${
                  active
                    ? 'bg-[#3182F6] text-[#FFFFFF]'
                    : 'bg-[#F9FAFB] text-[#191F28] hover:bg-[#E5E8EB]'
                }`}
              >
                <div className="text-[13px] font-bold">{opt.label}</div>
                <div
                  className={`text-[11.5px] mt-0.5 tabular-nums ${
                    active ? 'text-[#FFFFFF]/85' : 'text-[#8B95A1]'
                  }`}
                >
                  {opt.sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* 인쇄 옵션 & 결재란 상세 설정 아코디언 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-4 space-y-3">
          <button
            type="button"
            onClick={() => setIsConfigExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <SlidersHorizontal className="w-4 h-4 text-[#3182F6] shrink-0" />
              <span className="text-[13px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                스캔 보정 · 미첨부 · 결재선 설정
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap">
              {isConfigExpanded ? (
                <>
                  <span>접기</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>옵션 열기</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </span>
          </button>

          {isConfigExpanded && (
            <div className="space-y-4 pt-3 border-t border-[#E5E8EB]">
              {/* 이미지 보정 & 공란 옵션 */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#4E5968]">
                  <ImageIcon className="w-4 h-4 text-[#3182F6]" />
                  영수증 이미지 보정 및 출력 옵션
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFitMode((prev) =>
                        prev === 'contain' ? 'width' : 'contain'
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#3182F6]" />
                    일반 피팅:{' '}
                    {fitMode === 'contain'
                      ? '원본 비율 전체보기'
                      : '폭 맞춤 확대보기'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setScanFilter((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150 ${
                      scanFilter
                        ? 'bg-[#3182F6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>스캔 보정 필터 {scanFilter ? 'ON' : 'OFF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIncludeMissingSlots((prev) => !prev)}
                    className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                  >
                    {includeMissingSlots ? (
                      <CheckSquare className="w-3.5 h-3.5 text-[#3182F6]" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-[#8B95A1]" />
                    )}
                    미첨부 지출도 공란 표시
                  </button>
                </div>
              </div>

              {/* 결재란 직분 커스터마이징 */}
              <div className="space-y-2.5 pt-2 border-t border-[#E5E8EB]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-bold text-[#4E5968]">
                    결재선 직분 & 작성자 정보
                  </span>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <select
                      value={accountFilter}
                      onChange={(e) =>
                        onAccountFilterChange(e.target.value as AccountType)
                      }
                      className="h-9 px-3 rounded-xl bg-[#FFFFFF] text-[12px] font-semibold text-[#191F28] focus:outline-none max-w-full"
                    >
                      <option value="all">계정: 전체 통합</option>
                      <option value="general">계정: 일반회계(운영비)</option>
                      <option value="retreat">계정: 수련회·행사비</option>
                      <option value="mission">계정: 목적헌금·선교</option>
                    </select>

                    <button
                      type="button"
                      onClick={toggleApprovalBox}
                      className={`h-9 px-3 rounded-xl text-[12px] font-semibold whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                        settings.showApprovalBox
                          ? 'bg-[#E8F3FF] text-[#1B64DA]'
                          : 'bg-[#E5E8EB] text-[#4E5968]'
                      }`}
                    >
                      결재란 {settings.showApprovalBox ? '표시 중' : '숨김'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#8B95A1] mb-1">
                      소속 부서명
                    </label>
                    <input
                      type="text"
                      value={settings.departmentName}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          departmentName: e.target.value,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-[12.5px] font-medium text-[#191F28] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#8B95A1] mb-1">
                      작성자(회계)
                    </label>
                    <input
                      type="text"
                      value={settings.authorName}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          authorName: e.target.value,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-[12.5px] font-medium text-[#191F28] focus:outline-none"
                    />
                  </div>
                  {([0, 1, 2, 3] as const).map((idx) => (
                    <div key={idx}>
                      <label className="block text-[11px] text-[#8B95A1] mb-1">
                        결재란 {idx + 1}열 직분
                      </label>
                      <input
                        type="text"
                        value={settings.approvalRoles[idx]}
                        onChange={(e) => handleRoleChange(idx, e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-[12.5px] font-medium text-[#191F28] focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
          모드 A: 영수증 검수 카드 피드 (긴 영수증 자동 감지 · 분할 진입)
         ===================================================================== */}
      {screenMode === 'mobile_inspector' && (
        <div className="no-print max-w-[980px] mx-auto space-y-4">
          {/* 1. 월간 결산 요약 & 증빙 첨부율 카드 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-[12px] font-bold text-[#3182F6]">
                  {yearMonthTitle} · {ACCOUNT_LABELS[accountFilter]} 결산 요약
                </span>
                <div className="text-[22px] sm:text-[28px] font-bold text-[#191F28] tabular-nums tracking-tight mt-0.5">
                  잔액 {formatWon(currentBalance)}
                </div>
                <div className="text-[12.5px] font-medium text-[#4E5968] tabular-nums mt-0.5 break-words [word-break:keep-all]">
                  {numberToKoreanCurrency(currentBalance)}
                </div>
              </div>

              <div
                className={`px-3 py-1.5 rounded-2xl text-[12px] font-bold tabular-nums shrink-0 whitespace-nowrap ${
                  missingReceiptCount === 0
                    ? 'bg-[#E8F3FF] text-[#1B64DA]'
                    : 'bg-[#FFEEF0] text-[#F04452]'
                }`}
              >
                {missingReceiptCount === 0
                  ? `증빙 ${allExpenseEvidenceItems.length}건 완료`
                  : `미첨부 ${missingReceiptCount}건`}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <div className="bg-[#F9FAFB] rounded-2xl p-2.5 sm:p-3 min-w-0">
                <div className="text-[11px] text-[#8B95A1]">전월 이월</div>
                <div className="text-[12px] sm:text-[13.5px] font-bold text-[#4E5968] tracking-tight whitespace-nowrap truncate mt-0.5">
                  {formatWon(carryoverAmount)}
                </div>
              </div>
              <div className="bg-[#F9FAFB] rounded-2xl p-2.5 sm:p-3 min-w-0">
                <div className="text-[11px] text-[#8B95A1]">금월 수입</div>
                <div className="text-[12px] sm:text-[13.5px] font-bold text-[#3182F6] tracking-tight whitespace-nowrap truncate mt-0.5">
                  +{formatWon(monthlyIncome)}
                </div>
              </div>
              <div className="bg-[#F9FAFB] rounded-2xl p-2.5 sm:p-3 min-w-0">
                <div className="text-[11px] text-[#8B95A1]">금월 지출</div>
                <div className="text-[12px] sm:text-[13.5px] font-bold text-[#191F28] tracking-tight whitespace-nowrap truncate mt-0.5">
                  -{formatWon(monthlyExpense)}
                </div>
              </div>
            </div>

            {/* 증빙 필터 탭 */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
              {[
                {
                  id: 'all',
                  label: `전체 (${allExpenseEvidenceItems.length})`,
                },
                {
                  id: 'missing',
                  label: `미첨부 (${missingReceiptCount})`,
                },
                {
                  id: 'attached',
                  label: `첨부됨 (${attachedReceiptCount})`,
                },
                ...(longReceiptCount > 0
                  ? [
                      {
                        id: 'long',
                        label: `긴 영수증 (${longReceiptCount})`,
                      },
                    ]
                  : []),
              ].map((tab) => {
                const active = inspectorFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() =>
                      setInspectorFilter(tab.id as InspectorFilter)
                    }
                    className={`px-3.5 py-2 rounded-full text-[12.5px] font-bold shrink-0 transition-all active:scale-[0.97] ${
                      active
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#F2F4F6] text-[#4E5968]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. 영수증 증빙 카드 리스트 (#01 ~ #N) */}
          {filteredInspectorItems.length === 0 ? (
            <div className="bg-[#FFFFFF] rounded-3xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-9 h-9 text-[#3182F6] mx-auto" />
              <div className="text-[15px] font-bold text-[#191F28]">
                {inspectorFilter === 'missing'
                  ? '모든 지출 내역에 영수증이 첨부되어 있습니다'
                  : '표시할 지출 증빙 내역이 없습니다'}
              </div>
              <div className="text-[13px] text-[#8B95A1]">
                상단 [배치 편집] 또는 [A4 미리보기]에서 출력 구성을 확인하세요.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredInspectorItems.map((tx) => {
                const mj = tx.mokjangId
                  ? mokjangMap.get(tx.mokjangId)
                  : undefined;
                const isUploading = uploadingTxId === tx.id;
                const isSplit = hasActiveReceiptSplit(tx);
                const splitPieceCount = tx.receiptEdit?.segments?.length || 0;
                const isLong = longReceiptTxIds.has(tx.id);

                return (
                  <div
                    key={tx.id}
                    className="bg-[#FFFFFF] rounded-3xl p-4 sm:p-5 flex flex-col justify-between space-y-3.5"
                  >
                    {/* 상단 헤더 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2.5 py-0.5 rounded-lg bg-[#191F28] text-[#FFFFFF] text-[12px] font-bold tabular-nums">
                            증빙 {tx.evidenceNo}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-[#F2F4F6] text-[#4E5968] text-[11.5px] font-semibold tabular-nums">
                            {formatShortDate(tx.date)}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold">
                            {tx.category}
                            {tx.subCategory ? ` › ${tx.subCategory}` : ''}
                            {tx.detailCategory ? ` › ${tx.detailCategory}` : ''}
                          </span>
                          {mj && (
                            <span className="px-2 py-0.5 rounded-lg bg-[#F9FAFB] text-[#4E5968] text-[11px] font-semibold">
                              {mj.name.split(' ')[0]}
                            </span>
                          )}
                        </div>
                        <div className="text-[15.5px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                          {tx.title}
                        </div>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-[16px] font-bold text-[#191F28]">
                          {formatWon(tx.amount)}
                        </div>
                        <div className="text-[11px] text-[#8B95A1]">
                          {tx.paymentMethod}
                        </div>
                      </div>
                    </div>

                    {/* 영수증 이미지 프리뷰 또는 즉시 등록 */}
                    <div className="rounded-2xl bg-[#F9FAFB] overflow-hidden flex flex-col items-center justify-center min-h-[210px] p-3 relative">
                      {tx.receiptImage ? (
                        <div className="w-full flex flex-col items-center space-y-2.5">
                          {/* 우상단 분할/긴 영수증 뱃지 */}
                          {isSplit ? (
                            <button
                              type="button"
                              onClick={() => handleOpenSplitEditor(tx, 'place')}
                              className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-xl bg-[#191F28]/90 text-[#FFFFFF] text-[11.5px] font-bold flex items-center gap-1 active:scale-[0.97]"
                            >
                              <Scissors className="w-3 h-3" />
                              <span>{splitPieceCount}조각 분할됨</span>
                            </button>
                          ) : isLong ? (
                            <button
                              type="button"
                              onClick={() => handleOpenSplitEditor(tx, 'cut')}
                              className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold flex items-center gap-1 active:scale-[0.97]"
                            >
                              <Scissors className="w-3 h-3" />
                              <span>긴 영수증 · 분할</span>
                            </button>
                          ) : null}

                          <img
                            src={tx.receiptImage}
                            alt={`증빙 ${tx.evidenceNo}`}
                            onLoad={(e) => handleRecordImageDimensions(tx.id, e)}
                            className={`max-h-[260px] w-full object-contain rounded-xl bg-[#FFFFFF] ${
                              scanFilter ? 'receipt-scan-filter' : ''
                            }`}
                          />

                          <div className="w-full flex flex-wrap items-center justify-between gap-2 pt-1">
                            <label className="flex-1 min-w-[100px] h-9 px-3 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.97]">
                              <Camera className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
                              <span>
                                {isUploading ? '저장 중...' : '사진 교체'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) =>
                                  handleInlinePhotoUpload(
                                    tx,
                                    e.target.files?.[0]
                                  )
                                }
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() =>
                                handleOpenSplitEditor(
                                  tx,
                                  isSplit ? 'place' : 'cut'
                                )
                              }
                              className={`h-9 px-3 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] ${
                                isSplit || isLong
                                  ? 'bg-[#3182F6] text-[#FFFFFF]'
                                  : 'bg-[#FFFFFF] text-[#191F28]'
                              }`}
                            >
                              <Scissors className="w-3.5 h-3.5 shrink-0" />
                              <span>{isSplit ? '분할 수정' : '분할'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onSelectTransaction(tx)}
                              className="h-9 px-3 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold flex items-center justify-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97]"
                            >
                              <Edit3 className="w-3.5 h-3.5 shrink-0" />
                              <span>상세</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full py-6 px-4 text-center space-y-3">
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FFEEF0] text-[#F04452] text-[12px] font-bold">
                            [{tx.evidenceNo}] 영수증 미첨부
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <label className="h-10 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12.5px] font-bold flex items-center gap-1.5 cursor-pointer active:scale-[0.97]">
                              <Camera className="w-4 h-4" />
                              <span>
                                {isUploading ? '저장 중...' : '사진 등록'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) =>
                                  handleInlinePhotoUpload(
                                    tx,
                                    e.target.files?.[0]
                                  )
                                }
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => onSelectTransaction(tx)}
                              className="h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[#191F28] text-[12.5px] font-semibold flex items-center gap-1.5 active:scale-[0.97]"
                            >
                              <Sparkles className="w-4 h-4 text-[#3182F6]" />
                              <span>AI 스캔</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 하단 산출근거 메모 인라인 편집란 */}
                    <div>
                      <label className="block text-[11.5px] font-semibold text-[#8B95A1] mb-1">
                        산출근거 · 메모
                      </label>
                      <input
                        type="text"
                        value={tx.memo}
                        onChange={(e) =>
                          handleInlineMemoChange(tx, e.target.value)
                        }
                        placeholder="예: 삼겹살 4인분 × 15,000원 외"
                        className="w-full h-10 px-3.5 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 모바일 하단 고정 미리보기/인쇄 바 (하단 카드 가림 방지 여백 포함) */}
          <div className="h-4 sm:hidden" aria-hidden="true" />
          <div className="sticky sticky-bottom-safe z-20 bg-[#191F28] text-[#FFFFFF] rounded-2xl p-3.5 flex items-center justify-between gap-2.5 shadow-lg">
            <div className="min-w-0">
              <div className="text-[11px] text-[#8B95A1] truncate">
                장부 1장 + 영수증철 {receiptPageCount}장
              </div>
              <div className="text-[14px] sm:text-[14.5px] font-bold tabular-nums truncate">
                증빙 {attachedReceiptCount}/{allExpenseEvidenceItems.length}건 첨부
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setScreenMode('layout_board')}
                className="h-10 px-3 rounded-xl bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12.5px] font-semibold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97]"
              >
                <LayoutGrid className="w-4 h-4 shrink-0" />
                <span>배치</span>
              </button>
              <button
                type="button"
                disabled={isPreparingPrint}
                onClick={() => void handlePrint()}
                className="h-10 px-3.5 sm:px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97] disabled:opacity-60"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>{isPreparingPrint ? '준비 중' : '인쇄/PDF'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          모드 B: 자유 슬롯 배치 보드 (A4 격자 단위 스왑·빈 칸·배치 수정)
         ===================================================================== */}
      {screenMode === 'layout_board' && (
        <div className="no-print max-w-[980px] mx-auto">
          <ReceiptPlacementBoard
            pages={resolvedPages}
            density={density}
            transactionMap={transactionMap}
            imageDimensions={effectiveImageDimensions}
            slotCompositeByPosition={slotCompositeByPosition}
            scanFilter={scanFilter}
            onChangePages={(nextPages: ReceiptPageLayout[]) =>
              commitDensityPages(nextPages, density)
            }
            onOpenSplitEditor={handleOpenSplitEditor}
            onCompact={handleCompactPages}
            onResetOrder={handleResetPagesOrder}
            onAddPage={handleAddEmptyPage}
          />
        </div>
      )}

      {/* =====================================================================
          모드 C & 실제 인쇄 DOM: 문서 1 (결산 보고서) + 문서 2 (영수증 증빙철)
          - 화면에서는 a4_preview 탭일 때만 노출, @media print 시(.print-force-show) 항상 출력
         ===================================================================== */}
      <div
        ref={printAreaRef}
        role={screenMode === 'a4_preview' ? 'region' : undefined}
        tabIndex={
          screenMode === 'a4_preview' && a4ZoomMode === 'actual' ? 0 : undefined
        }
        aria-label={screenMode === 'a4_preview' ? 'A4 미리보기' : undefined}
        className={`max-w-[980px] mx-auto space-y-6 print-force-show ${
          screenMode === 'a4_preview'
            ? a4ZoomMode === 'actual'
              ? 'block overflow-x-auto max-w-full print:overflow-visible'
              : 'block'
            : 'hidden'
        }`}
      >
        {/* 문서 1: 월별 회계 결산 보고서 (다중 페이지 자연 분할 지원) */}
        {(outputMode === 'both' || outputMode === 'ledger_only') && (
          <A4ScalePreview zoomMode={a4ZoomMode}>
            <article className="a4-page a4-page-flow flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-4 pb-3 border-b-2 border-[#191F28]">
                  <div className="pt-1 min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-[#4E5968] tracking-tight">
                      [{settings.departmentName} 재정 결산 공문서 · 문서 1]
                    </div>
                    <h1 className="text-[22px] font-bold text-[#191F28] mt-0.5 leading-tight break-words [word-break:keep-all]">
                      {yearMonthTitle} 청년부 회계 결산 보고서
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11.5px] text-[#4E5968] tabular-nums">
                      <span>
                        <strong>소속:</strong> {settings.departmentName}
                      </span>
                      <span>
                        <strong>회계구분:</strong>{' '}
                        {ACCOUNT_LABELS[accountFilter]}
                      </span>
                      <span>
                        <strong>작성일:</strong> {formatShortDate(reportDate)}
                      </span>
                      <span>
                        <strong>작성자:</strong> {settings.authorName}
                      </span>
                    </div>
                  </div>

                  {settings.showApprovalBox && (
                    <table className="border-collapse border border-[#191F28] text-center shrink-0">
                      <tbody>
                        <tr className="bg-[#F2F4F6]">
                          <td
                            rowSpan={2}
                            className="border border-[#191F28] px-2 py-1 text-[11px] font-bold text-[#191F28] w-6 leading-tight"
                          >
                            결
                            <br />재
                          </td>
                          {settings.approvalRoles.map((role, i) => (
                            <th
                              key={i}
                              className="border border-[#191F28] px-2.5 py-1 text-[10.5px] font-bold text-[#191F28] min-w-[54px] break-words"
                            >
                              {role}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {settings.approvalRoles.map((_, i) => (
                            <td
                              key={i}
                              className="border border-[#191F28] h-12 text-[10px] text-[#8B95A1] align-bottom pb-1"
                            >
                              (인)
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 요약 테이블 */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11.5px] font-bold text-[#191F28]">
                      1. 월간 수지 결산 요약
                    </span>
                    <span className="text-[10.5px] text-[#4E5968] tabular-nums">
                      금월 잔액 한글표기:{' '}
                      <strong>{numberToKoreanCurrency(currentBalance)}</strong>
                    </span>
                  </div>
                  <table className="w-full border-collapse border border-[#191F28] text-center tabular-nums">
                    <thead>
                      <tr className="bg-[#F2F4F6] text-[11px] font-bold text-[#191F28]">
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4">
                          전월 이월금 (A)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4">
                          금월 총수입 (B)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4">
                          금월 총지출 (C)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4 bg-[#E8F3FF] text-[#1B64DA]">
                          금월 잔액 · 차월 이월금 (A+B-C)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="text-[13px] font-bold">
                        <td className="border border-[#191F28] py-2 px-2 text-[#4E5968]">
                          {formatWon(carryoverAmount)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-2 text-[#3182F6]">
                          +{formatWon(monthlyIncome)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-2 text-[#191F28]">
                          -{formatWon(monthlyExpense)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-2 bg-[#F9FAFB] text-[#191F28] text-[14px]">
                          {formatWon(currentBalance)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 본문 내역 테이블 */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11.5px] font-bold text-[#191F28]">
                      2. 일자별 수입·지출 상세 명세 (증빙번호는 [문서 2: 영수증
                      증빙철]과 1:1 매칭)
                    </span>
                    <span className="text-[10.5px] text-[#8B95A1] tabular-nums">
                      단위: 원 (₩)
                    </span>
                  </div>

                  <table className="w-full border-collapse border border-[#191F28] tabular-nums table-fixed">
                    <thead>
                      <tr className="bg-[#F2F4F6] text-[10.5px] font-bold text-[#191F28] text-center">
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[52px]">
                          일자
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1 w-[36px]">
                          구분
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[94px]">
                          분류 (관·항·목)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 text-left">
                          적요 (내역 및 산출근거)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[72px] text-right">
                          수입금액
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[72px] text-right">
                          지출금액
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[76px] text-right">
                          잔액
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1 w-[50px]">
                          증빙번호
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedTransactions.map((tx) => {
                        const mj = tx.mokjangId
                          ? mokjangMap.get(tx.mokjangId)
                          : undefined;
                        return (
                          <tr key={tx.id} className="text-[#191F28]">
                            <td
                              className={`border border-[#E5E8EB] border-x-[#191F28] text-center text-[#4E5968] align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.date.slice(5).replace('-', '.')}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-center font-semibold align-middle ${tableRowPaddingClass} ${
                                tx.type === 'income'
                                  ? 'text-[#3182F6]'
                                  : 'text-[#191F28]'
                              }`}
                            >
                              {tx.type === 'income' ? '수입' : '지출'}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-center text-[#4E5968] align-middle whitespace-pre-wrap break-words [word-break:keep-all] ${tableRowPaddingClass}`}
                            >
                              <div className="font-semibold text-[#191F28]">
                                {tx.category}
                              </div>
                              {(tx.subCategory || tx.detailCategory) && (
                                <div className="text-[9.5px] text-[#4E5968] leading-tight mt-0.5">
                                  (
                                  {[tx.subCategory, tx.detailCategory]
                                    .filter(Boolean)
                                    .join(' › ')}
                                  )
                                </div>
                              )}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] align-top whitespace-pre-wrap break-words [word-break:keep-all] ${tableRowPaddingClass}`}
                            >
                              <div className="font-semibold text-[#191F28] leading-snug">
                                {tx.title}
                              </div>
                              {(tx.memo || mj) && (
                                <div className="text-[10px] text-[#4E5968] leading-snug mt-0.5">
                                  └{' '}
                                  {mj
                                    ? `[${mj.name.split(' ')[0]} ${
                                        tx.mokjangSubType
                                          ? MOKJANG_SUBTYPE_LABELS[
                                              tx.mokjangSubType
                                            ]
                                          : ''
                                      }] `
                                    : ''}
                                  {tx.memo} ({tx.paymentMethod})
                                </div>
                              )}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-right font-semibold text-[#3182F6] align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.type === 'income'
                                ? formatNumber(tx.amount)
                                : '-'}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-right font-semibold text-[#191F28] align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.type === 'expense'
                                ? formatNumber(tx.amount)
                                : '-'}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-right text-[#4E5968] align-middle ${tableRowPaddingClass}`}
                            >
                              {formatNumber(tx.runningBalance)}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] border-r-[#191F28] text-center font-bold align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.evidenceNo ? (
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                                    tx.receiptImage
                                      ? 'bg-[#E8F3FF] text-[#1B64DA]'
                                      : 'bg-[#FFEEF0] text-[#F04452]'
                                  }`}
                                >
                                  {tx.evidenceNo}
                                </span>
                              ) : (
                                <span className="text-[#8B95A1]">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="bg-[#F2F4F6] font-bold text-[11.5px] border-t-2 border-[#191F28]">
                        <td
                          colSpan={4}
                          className="border border-[#191F28] py-2 px-3 text-center text-[#191F28]"
                        >
                          합 계 (이월금 포함 총수입 vs 총지출)
                        </td>
                        <td className="border border-[#191F28] py-2 px-1.5 text-right text-[#3182F6]">
                          {formatNumber(carryoverAmount + monthlyIncome)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-1.5 text-right text-[#191F28]">
                          {formatNumber(monthlyExpense)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-1.5 text-right bg-[#E8F3FF] text-[#1B64DA]">
                          {formatNumber(currentBalance)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-1 text-center text-[10px] text-[#4E5968]">
                          총 {allExpenseEvidenceItems.length}건
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 관/항별 지출 소계 요약 */}
                {categoryBreakdown.length > 0 && (
                  <div className="mt-3 print-avoid-break">
                    <div className="text-[10.5px] font-bold text-[#4E5968] mb-1">
                      3. 관/항(카테고리)별 지출 집행 내역 요약 (연간 예산안 연동)
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 tabular-nums">
                      {categoryBreakdown.map((item) => (
                        <div
                          key={item.category}
                          className="border border-[#E5E8EB] bg-[#F9FAFB] px-2.5 py-1.5 rounded flex items-start justify-between gap-2 text-[10.5px]"
                        >
                          <span className="text-[#4E5968] font-medium whitespace-pre-wrap break-words [word-break:keep-all]">
                            {item.category} ({item.count}건)
                          </span>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-[#191F28]">
                              {formatWon(item.total)}
                            </div>
                            {item.monthlyBudget > 0 && (
                              <div className="text-[9.5px] text-[#8B95A1]">
                                월예산 대비 {item.rate}%
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 mt-4 border-t border-[#E5E8EB] flex items-center justify-between text-[11px] text-[#4E5968] print-avoid-break">
                <div>
                  위와 같이 {yearMonthTitle} {settings.departmentName} 회계 결산
                  내역 및 별첨 영수증 증빙철을 보고합니다.
                </div>
                <div className="font-semibold text-[#191F28] tabular-nums">
                  문서 1 / 회계 결산 장부 (A4 1매)
                </div>
              </div>
            </article>
          </A4ScalePreview>
        )}

        {/* 문서 2: 월별 지출 증빙 영수증 첨부지 (자유 슬롯 배치 · 1칸 최대 패킹 · 300 DPI 합성 출력) */}
        {(outputMode === 'both' || outputMode === 'receipts_only') &&
          resolvedPages.map((page, pageIdx) => {
            const isEmptyBook =
              !hasAnyReceiptEvidence &&
              page.slots.every((s) => s.kind === 'empty');

            return (
              <A4ScalePreview key={page.pageId} zoomMode={a4ZoomMode}>
                <article className="a4-page a4-page-receipt flex flex-col justify-between">
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between pb-2.5 border-b-2 border-[#191F28] mb-3.5 shrink-0">
                      <div>
                        <div className="text-[10.5px] font-semibold text-[#4E5968]">
                          [{settings.departmentName} 지출 증빙 서류 · 문서 2]
                        </div>
                        <h2 className="text-[18px] font-bold text-[#191F28] tabular-nums">
                          {yearMonthTitle} 청년부 지출 증빙 영수증 철 (Page{' '}
                          {pageIdx + 1} / {receiptPageCount})
                        </h2>
                      </div>

                      <table className="border-collapse border border-[#191F28] text-center text-[10px] shrink-0 tabular-nums">
                        <tbody>
                          <tr className="bg-[#F2F4F6] font-bold">
                            <td className="border border-[#191F28] px-2.5 py-0.5">
                              회계담당
                            </td>
                            <td className="border border-[#191F28] px-2.5 py-0.5">
                              부서장확인
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-[#191F28] px-2.5 py-2 text-[#4E5968]">
                              {settings.authorName} (인)
                            </td>
                            <td className="border border-[#191F28] px-2.5 py-2 text-[#8B95A1]">
                              (서명/인)
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {isEmptyBook ? (
                      <div className="flex-1 border border-dashed border-[#D1D6DB] rounded-2xl flex flex-col items-center justify-center text-center p-8">
                        <FileSpreadsheet className="w-8 h-8 text-[#8B95A1] mb-2" />
                        <div className="text-[14px] font-semibold text-[#4E5968]">
                          해당 월에 등록된 지출 증빙 내역이 없습니다
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`grid grid-cols-2 gap-3.5 flex-1 min-h-0 ${
                          density === 2 ? 'grid-rows-1' : 'grid-rows-2'
                        }`}
                      >
                        {page.slots.map((slot, slotIdx) => {
                          const posKey = `${pageIdx}:${slotIdx}`;

                          // 1. 명시적 빈 칸 (인쇄 시 visibility: hidden으로 그리드 트랙 유지)
                          if (slot.kind === 'empty') {
                            return (
                              <div
                                key={`${page.pageId}-empty-${slotIdx}`}
                                className="receipt-slot-empty h-full min-h-0 border border-dashed border-[#D1D6DB] rounded-xl bg-[#F9FAFB]/60 flex items-center justify-center text-[11.5px] font-semibold text-[#8B95A1]"
                              >
                                빈 칸
                              </div>
                            );
                          }

                          const tx = transactionMap.get(slot.txId);
                          if (!tx) {
                            return (
                              <div
                                key={`${page.pageId}-missing-tx-${slotIdx}`}
                                className="receipt-slot-empty h-full min-h-0 rounded-xl"
                              />
                            );
                          }

                          const meta = slotMetaMap.get(posKey);
                          const isOverflowMultiSlot =
                            (meta?.slotTotalOfTx ?? 1) > 1;
                          const isContinuationSlot =
                            isOverflowMultiSlot &&
                            (meta?.slotIndexOfTx ?? 0) > 0;
                          const evidenceBadgeText = isOverflowMultiSlot
                            ? `[증빙 ${tx.evidenceNo} (${(meta?.slotIndexOfTx ?? 0) + 1}/${meta?.slotTotalOfTx ?? 1})]`
                            : `[증빙 ${tx.evidenceNo}]`;

                          // 2. 분할 슬롯 (segment_group: 1칸 완결 또는 오버플로우)
                          if (slot.kind === 'segment_group') {
                            const composite = slotCompositeByPosition[posKey];
                            const descriptor =
                              compositeDescriptorByPos.get(posKey);

                            return (
                              <div
                                key={`${page.pageId}-seg-${tx.id}-${slotIdx}`}
                                className="receipt-card h-full min-h-0 border border-[#191F28] rounded-xl overflow-hidden flex flex-col justify-between bg-[#FFFFFF]"
                              >
                                {/* 박스 상단 헤더 바 */}
                                <div className="bg-[#F2F4F6] border-b border-[#191F28] px-2.5 py-1.5 flex items-start justify-between gap-2 tabular-nums shrink-0">
                                  <span className="px-1.5 py-0.5 rounded bg-[#191F28] text-[#FFFFFF] text-[10.5px] font-bold shrink-0 mt-0.5">
                                    {evidenceBadgeText}
                                  </span>

                                  <span className="text-[10.5px] font-semibold text-[#191F28] flex-1 text-center whitespace-pre-wrap break-words [word-break:keep-all] leading-snug">
                                    {formatShortDate(tx.date)} | {tx.category}
                                    {tx.subCategory
                                      ? ` › ${tx.subCategory}`
                                      : ''}
                                    {tx.detailCategory
                                      ? ` › ${tx.detailCategory}`
                                      : ''}{' '}
                                    | {tx.title}
                                  </span>

                                  <span
                                    className={`text-[11.5px] font-bold shrink-0 mt-0.5 ${
                                      isContinuationSlot
                                        ? 'text-[#8B95A1] text-[10.5px]'
                                        : 'text-[#191F28]'
                                    }`}
                                  >
                                    {isContinuationSlot
                                      ? '(이어짐)'
                                      : formatWon(tx.amount)}
                                  </span>
                                </div>

                                {/* 박스 본문: 300 DPI 단일 합성 Blob URL (항상 object-contain 강제) */}
                                <div className="w-full flex-1 min-h-0 bg-[#FFFFFF] flex items-center justify-center p-2 overflow-hidden relative">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenSplitEditor(tx, 'place')
                                    }
                                    className="no-print hidden sm:flex absolute top-2 right-2 z-10 px-2 py-1 rounded-lg bg-[#191F28]/80 text-[#FFFFFF] text-[10.5px] font-semibold items-center gap-1 hover:bg-[#191F28] active:scale-[0.97]"
                                  >
                                    <Scissors className="w-3 h-3" />
                                    <span>배치 수정</span>
                                  </button>

                                  {composite?.url ? (
                                    <img
                                      src={composite.url}
                                      alt={`${evidenceBadgeText} - ${tx.title}`}
                                      decoding="sync"
                                      className="w-full h-full max-h-full object-contain"
                                    />
                                  ) : composite?.fallbackSvg && descriptor ? (
                                    renderFallbackSvgSlot(tx, descriptor)
                                  ) : (
                                    <div className="text-[11px] text-[#8B95A1] font-medium">
                                      영수증 조각 준비 중...
                                    </div>
                                  )}
                                </div>

                                {/* 박스 하단 산출근거 */}
                                <div className="bg-[#F9FAFB] border-t border-[#E5E8EB] px-2.5 py-1.5 flex items-start justify-between gap-2 text-[10px] tabular-nums shrink-0">
                                  <span className="text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all] leading-snug flex-1">
                                    <strong>산출근거:</strong>{' '}
                                    {tx.memo || tx.title}
                                  </span>
                                  <span className="text-[#8B95A1] shrink-0">
                                    {tx.paymentMethod}
                                  </span>
                                </div>
                              </div>
                            );
                          }

                          // 3. 일반 영수증 또는 미첨부 공란 카드
                          const isLongUnSplit =
                            Boolean(tx.receiptImage) &&
                            longReceiptTxIds.has(tx.id);

                          return (
                            <div
                              key={`${page.pageId}-tx-${tx.id}-${slotIdx}`}
                              className="receipt-card h-full min-h-0 border border-[#191F28] rounded-xl overflow-hidden flex flex-col justify-between bg-[#FFFFFF]"
                            >
                              {/* 박스 상단 헤더 바 */}
                              <div className="bg-[#F2F4F6] border-b border-[#191F28] px-2.5 py-1.5 flex items-start justify-between gap-2 tabular-nums shrink-0">
                                <span className="px-1.5 py-0.5 rounded bg-[#191F28] text-[#FFFFFF] text-[10.5px] font-bold shrink-0 mt-0.5">
                                  [증빙 {tx.evidenceNo}]
                                </span>

                                <span className="text-[10.5px] font-semibold text-[#191F28] flex-1 text-center whitespace-pre-wrap break-words [word-break:keep-all] leading-snug">
                                  {formatShortDate(tx.date)} | {tx.category}
                                  {tx.subCategory
                                    ? ` › ${tx.subCategory}`
                                    : ''}
                                  {tx.detailCategory
                                    ? ` › ${tx.detailCategory}`
                                    : ''}{' '}
                                  | {tx.title}
                                </span>

                                <span className="text-[11.5px] font-bold text-[#191F28] shrink-0 mt-0.5">
                                  {formatWon(tx.amount)}
                                </span>
                              </div>

                              {/* 박스 본문 */}
                              <div className="w-full flex-1 min-h-0 bg-[#FFFFFF] flex items-center justify-center p-2 overflow-hidden relative">
                                {tx.receiptImage ? (
                                  <>
                                    {isLongUnSplit && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenSplitEditor(tx, 'cut')
                                        }
                                        className="no-print hidden sm:flex absolute top-2 right-2 z-10 px-2 py-1 rounded-lg bg-[#E8F3FF] text-[#1B64DA] text-[10.5px] font-bold items-center gap-1 active:scale-[0.97]"
                                      >
                                        <Scissors className="w-3 h-3" />
                                        <span>긴 영수증 · 분할</span>
                                      </button>
                                    )}
                                    <img
                                      src={tx.receiptImage}
                                      alt={`증빙 ${tx.evidenceNo} - ${tx.title}`}
                                      onLoad={(e) =>
                                        handleRecordImageDimensions(tx.id, e)
                                      }
                                      className={`max-h-full ${
                                        fitMode === 'contain'
                                          ? 'w-full h-full object-contain'
                                          : 'w-full h-full object-cover object-top'
                                      } ${scanFilter ? 'receipt-scan-filter' : ''}`}
                                    />
                                  </>
                                ) : (
                                  <div className="w-full h-full border border-dashed border-[#D1D6DB] rounded-lg flex flex-col items-center justify-center text-center p-4 bg-[#F9FAFB]">
                                    <div className="text-[12px] font-bold text-[#F04452] mb-1">
                                      [증빙 {tx.evidenceNo}] 디지털 영수증 미첨부
                                    </div>
                                    <div className="text-[11px] text-[#8B95A1] max-w-[200px] break-words [word-break:keep-all]">
                                      인쇄 후 이 자리에 실물 종이 영수증을 풀로
                                      부착하거나, 아래 버튼으로 사진을
                                      업로드하세요.
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => onSelectTransaction(tx)}
                                      className="no-print mt-3 px-3 py-1.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[11.5px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                                    >
                                      <Upload className="w-3.5 h-3.5" />
                                      영수증 사진 지금 등록
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* 박스 하단: 상세 메모/산출근거 표시 */}
                              <div className="bg-[#F9FAFB] border-t border-[#E5E8EB] px-2.5 py-1.5 flex items-start justify-between gap-2 text-[10px] tabular-nums shrink-0">
                                <span className="text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all] leading-snug flex-1">
                                  <strong>산출근거:</strong>{' '}
                                  {tx.memo || tx.title}
                                </span>
                                <span className="text-[#8B95A1] shrink-0">
                                  {tx.paymentMethod}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 mt-2 border-t border-[#E5E8EB] flex items-center justify-between text-[10.5px] text-[#8B95A1] tabular-nums shrink-0">
                    <span>
                      ※ 본 증빙철의 [증빙 #번호]는 {yearMonthTitle} 회계 결산
                      보고서(문서 1) 우측 끝 열의 번호와 일치합니다.
                    </span>
                    <span className="font-semibold text-[#4E5968]">
                      Page {pageIdx + 1} of {receiptPageCount}
                    </span>
                  </div>
                </article>
              </A4ScalePreview>
            );
          })}
      </div>

      {/* =====================================================================
          영수증 다중 분할 & 슬롯 내 자유 배치 에디터 모달
         ===================================================================== */}
      <ReceiptSplitEditor
        open={Boolean(editorState && editingTransaction)}
        onClose={() => setEditorState(null)}
        transaction={editingTransaction}
        density={density}
        initialSlotGroups={editingInitialSlotGroups}
        initialTab={editorState?.initialTab ?? 'cut'}
        imageDimension={
          editingTransaction
            ? effectiveImageDimensions[editingTransaction.id]
            : undefined
        }
        onApply={handleApplySplitEditor}
      />
    </div>
  );
};
