import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  Minimize2,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  SquareDashed,
  X,
} from 'lucide-react';
import {
  ProcessedTransaction,
  ReceiptDensity,
  ReceiptPageLayout,
  ReceiptSegment,
  ReceiptSlotRef,
  SegmentGroupSlotRef,
} from '../types/finance';
import { formatWon } from '../utils/koreanCurrency';
import {
  evaluateSlotFit,
  isLongReceipt,
} from '../utils/receiptGeometry';
import {
  buildTxSlotRenderMetaMap,
  getEffectiveTxAspectHW,
  insertEmptySlotAt,
  SlotCoord,
  swapSlots,
} from '../utils/receiptLayoutEngine';
import { ReceiptImg, ResolvedSvgImage } from './ReceiptImg';

export interface ReceiptPlacementBoardProps {
  pages: ReceiptPageLayout[];
  density: ReceiptDensity;
  transactionMap: Map<string, ProcessedTransaction>;
  imageDimensions: Record<string, { width: number; height: number }>;
  slotCompositeByPosition: Record<
    string,
    { url?: string; fallbackSvg?: boolean }
  >;
  scanFilter: boolean;
  onChangePages: (nextPages: ReceiptPageLayout[]) => void;
  onOpenSplitEditor: (
    tx: ProcessedTransaction,
    initialTab?: 'cut' | 'place'
  ) => void;
  onCompact: () => void;
  onResetOrder: () => void;
  onAddPage: () => void;
}

const SVG_FALLBACK_WIDTH = 1000;

function renderSegmentGroupFallbackPreview(args: {
  tx: ProcessedTransaction;
  slot: SegmentGroupSlotRef;
  density: ReceiptDensity;
  imageDimensions: Record<string, { width: number; height: number }>;
  scanFilter: boolean;
}) {
  const { tx, slot, density, imageDimensions, scanFilter } = args;
  if (!tx.receiptImage || !tx.receiptEdit?.segments?.length) return null;

  const segById = new Map(tx.receiptEdit.segments.map((s) => [s.id, s]));
  const groupSegs = slot.segmentIds
    .map((id) => segById.get(id))
    .filter((s): s is ReceiptSegment => Boolean(s));
  if (groupSegs.length === 0) return null;

  const origAspectHW = getEffectiveTxAspectHW(tx, imageDimensions);
  const placements =
    slot.layoutMode === 'custom' &&
    slot.placements &&
    slot.placements.length === groupSegs.length
      ? slot.placements
      : evaluateSlotFit(groupSegs, origAspectHW, density).placements;

  const svgTotalH = SVG_FALLBACK_WIDTH * origAspectHW;

  return (
    <div
      className={`relative w-full h-full bg-[#FFFFFF] overflow-hidden ${
        scanFilter ? 'receipt-scan-filter' : ''
      }`}
    >
      {placements.map((p, idx) => {
        const seg = segById.get(p.segmentId);
        if (!seg) return null;
        const vx = (seg.xStart ?? 0) * SVG_FALLBACK_WIDTH;
        const vy = seg.yStart * svgTotalH;
        const vw = ((seg.xEnd ?? 1) - (seg.xStart ?? 0)) * SVG_FALLBACK_WIDTH;
        const vh = (seg.yEnd - seg.yStart) * svgTotalH;
        return (
          <div
            key={seg.id}
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              width: `${p.w * 100}%`,
              height: `${p.h * 100}%`,
              zIndex: p.z ?? idx + 1,
            }}
            className="absolute border border-[#E5E8EB] bg-[#FFFFFF] overflow-hidden"
          >
            <svg
              viewBox={`${vx} ${vy} ${Math.max(1, vw)} ${Math.max(1, vh)}`}
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-full block"
            >
              <ResolvedSvgImage
                href={tx.receiptImage}
                x={0}
                y={0}
                width={SVG_FALLBACK_WIDTH}
                height={svgTotalH}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export const ReceiptPlacementBoard: React.FC<ReceiptPlacementBoardProps> = ({
  pages,
  density,
  transactionMap,
  imageDimensions,
  slotCompositeByPosition,
  scanFilter,
  onChangePages,
  onOpenSplitEditor,
  onCompact,
  onResetOrder,
  onAddPage,
}) => {
  const [selectedCoord, setSelectedCoord] = useState<SlotCoord | null>(null);
  const [dragSourceCoord, setDragSourceCoord] = useState<SlotCoord | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // 밀도 변경 시 선택 해제
  useEffect(() => {
    setSelectedCoord(null);
    setDragSourceCoord(null);
    setDragOverKey(null);
  }, [density]);

  const slotMetaMap = useMemo(() => buildTxSlotRenderMetaMap(pages), [pages]);

  const totalFilledSlots = useMemo(
    () =>
      pages.reduce(
        (sum, page) => sum + page.slots.filter((s) => s.kind !== 'empty').length,
        0
      ),
    [pages]
  );

  // 선택된 슬롯의 유효성 확인
  const validSelectedCoord = useMemo<SlotCoord | null>(() => {
    if (!selectedCoord) return null;
    const page = pages[selectedCoord.pageIdx];
    if (!page || selectedCoord.slotIdx >= page.slots.length) return null;
    return selectedCoord;
  }, [selectedCoord, pages]);

  const selectedSlot: ReceiptSlotRef | null = validSelectedCoord
    ? pages[validSelectedCoord.pageIdx].slots[validSelectedCoord.slotIdx]
    : null;

  const selectedTx: ProcessedTransaction | undefined =
    selectedSlot && selectedSlot.kind !== 'empty'
      ? transactionMap.get(selectedSlot.txId)
      : undefined;

  const selectedMeta = validSelectedCoord
    ? slotMetaMap.get(
        `${validSelectedCoord.pageIdx}:${validSelectedCoord.slotIdx}`
      )
    : undefined;

  const selectedLabel = useMemo(() => {
    if (!selectedSlot) return '';
    if (selectedSlot.kind === 'empty') return '빈 칸';
    const ev = selectedTx?.evidenceNo || '증빙';
    if (selectedMeta && selectedMeta.slotTotalOfTx > 1) {
      return `${ev} (${selectedMeta.slotIndexOfTx + 1}/${selectedMeta.slotTotalOfTx})`;
    }
    return ev;
  }, [selectedSlot, selectedTx, selectedMeta]);

  const totalSlotsCount = pages.length * density;
  const selectedLinearIdx = validSelectedCoord
    ? validSelectedCoord.pageIdx * density + validSelectedCoord.slotIdx
    : -1;

  const canStepPrev = validSelectedCoord !== null && selectedLinearIdx > 0;
  const canStepNext =
    validSelectedCoord !== null && selectedLinearIdx < totalSlotsCount - 1;

  const handleSlotTap = (pageIdx: number, slotIdx: number) => {
    const target: SlotCoord = { pageIdx, slotIdx };
    const slot = pages[pageIdx]?.slots[slotIdx];
    if (!slot) return;

    if (!validSelectedCoord) {
      if (slot.kind === 'empty') return;
      setSelectedCoord(target);
      return;
    }

    if (
      validSelectedCoord.pageIdx === pageIdx &&
      validSelectedCoord.slotIdx === slotIdx
    ) {
      setSelectedCoord(null);
      return;
    }

    onChangePages(swapSlots(pages, validSelectedCoord, target));
    setSelectedCoord(null);
  };

  const handleStepSelected = (delta: -1 | 1) => {
    if (!validSelectedCoord) return;
    const targetLinear = selectedLinearIdx + delta;
    if (targetLinear < 0 || targetLinear >= totalSlotsCount) return;
    const targetCoord: SlotCoord = {
      pageIdx: Math.floor(targetLinear / density),
      slotIdx: targetLinear % density,
    };
    onChangePages(swapSlots(pages, validSelectedCoord, targetCoord));
    setSelectedCoord(targetCoord);
  };

  const handleInsertEmptyAtSelected = () => {
    if (!validSelectedCoord) return;
    onChangePages(insertEmptySlotAt(pages, validSelectedCoord, density));
    setSelectedCoord(null);
  };

  // 데스크톱 네이티브 HTML5 DnD
  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    pageIdx: number,
    slotIdx: number
  ) => {
    setDragSourceCoord({ pageIdx, slotIdx });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${pageIdx}:${slotIdx}`);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    posKey: string
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverKey !== posKey) {
      setDragOverKey(posKey);
    }
  };

  const handleDragLeave = (posKey: string) => {
    if (dragOverKey === posKey) {
      setDragOverKey(null);
    }
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    pageIdx: number,
    slotIdx: number
  ) => {
    e.preventDefault();
    let source = dragSourceCoord;
    if (!source) {
      const raw = e.dataTransfer.getData('text/plain');
      const [pStr, sStr] = raw.split(':');
      const pIdx = Number(pStr);
      const sIdx = Number(sStr);
      if (Number.isInteger(pIdx) && Number.isInteger(sIdx)) {
        source = { pageIdx: pIdx, slotIdx: sIdx };
      }
    }

    if (source) {
      onChangePages(swapSlots(pages, source, { pageIdx, slotIdx }));
    }
    setDragSourceCoord(null);
    setDragOverKey(null);
    setSelectedCoord(null);
  };

  const handleDragEnd = () => {
    setDragSourceCoord(null);
    setDragOverKey(null);
  };

  const previewAspectClass =
    density === 2
      ? 'aspect-[844/1480] max-h-[300px]'
      : 'aspect-[844/945] max-h-[210px]';

  return (
    <div className="no-print max-w-[980px] mx-auto space-y-4 pb-24 sm:pb-10">
      {/* 상단 툴바 */}
      <section className="bg-[#FFFFFF] rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center shrink-0">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[14.5px] font-bold text-[#191F28] tabular-nums">
              영수증철 {pages.length}장 · 배치 {totalFilledSlots}칸
            </div>
            <div className="text-[12px] text-[#8B95A1]">
              카드를 탭하거나 끌어 위치를 바꿀 수 있어요
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => {
              setSelectedCoord(null);
              onCompact();
            }}
            className="flex-1 sm:flex-none h-9 px-3.5 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.97] transition-all"
          >
            <Minimize2 className="w-3.5 h-3.5 shrink-0" />
            <span>자동 채우기</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedCoord(null);
              onResetOrder();
            }}
            className="flex-1 sm:flex-none h-9 px-3.5 rounded-xl bg-[#F2F4F6] text-[#4E5968] text-[12.5px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.97] transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>기본 순서로</span>
          </button>
        </div>
      </section>

      {/* A4 페이지별 슬롯 격자 카드 */}
      <div className="space-y-4">
        {pages.map((page, pageIdx) => {
          const filledInPage = page.slots.filter((s) => s.kind !== 'empty').length;

          return (
            <section
              key={page.pageId}
              className="bg-[#FFFFFF] rounded-3xl p-3.5 sm:p-5 space-y-3"
            >
              {/* 페이지 헤더 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 tabular-nums">
                  <span className="px-2.5 py-1 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[12px] font-bold">
                    Page {pageIdx + 1}
                  </span>
                  <span className="text-[12.5px] font-semibold text-[#4E5968]">
                    {density === 2 ? '1행2열' : '2행2열'} · {filledInPage}/{density}칸
                  </span>
                </div>
              </div>

              {/* 1×2 또는 2×2 슬롯 격자 */}
              <div className="grid grid-cols-2 gap-3">
                {page.slots.map((slot, slotIdx) => {
                  const posKey = `${pageIdx}:${slotIdx}`;
                  const isSelected =
                    validSelectedCoord?.pageIdx === pageIdx &&
                    validSelectedCoord?.slotIdx === slotIdx;
                  const isDragOver = dragOverKey === posKey;
                  const isSwapTargetHint =
                    validSelectedCoord !== null && !isSelected;

                  // 4) 빈 칸 슬롯
                  if (slot.kind === 'empty') {
                    return (
                      <div
                        key={posKey}
                        onClick={() => handleSlotTap(pageIdx, slotIdx)}
                        onDragOver={(e) => handleDragOver(e, posKey)}
                        onDragLeave={() => handleDragLeave(posKey)}
                        onDrop={(e) => handleDrop(e, pageIdx, slotIdx)}
                        className={`rounded-2xl border-2 border-dashed p-3 flex flex-col items-center justify-center text-center transition-all min-h-[160px] ${
                          isDragOver || isSwapTargetHint
                            ? 'border-[#3182F6] bg-[#E8F3FF]/45 cursor-pointer'
                            : 'border-[#D1D6DB] bg-[#F9FAFB]'
                        }`}
                      >
                        <SquareDashed
                          className={`w-5 h-5 mb-1.5 ${
                            isDragOver || isSwapTargetHint
                              ? 'text-[#3182F6]'
                              : 'text-[#8B95A1]'
                          }`}
                        />
                        <span
                          className={`text-[12.5px] font-bold ${
                            isDragOver || isSwapTargetHint
                              ? 'text-[#1B64DA]'
                              : 'text-[#8B95A1]'
                          }`}
                        >
                          {isDragOver
                            ? '여기에 놓기'
                            : isSwapTargetHint
                              ? '여기로 옮기기'
                              : '빈 칸'}
                        </span>
                      </div>
                    );
                  }

                  const tx = transactionMap.get(slot.txId);
                  if (!tx) {
                    return (
                      <div
                        key={posKey}
                        className="rounded-2xl border border-dashed border-[#D1D6DB] bg-[#F9FAFB] p-3 flex items-center justify-center text-[12px] text-[#8B95A1] min-h-[160px]"
                      >
                        빈 칸
                      </div>
                    );
                  }

                  const meta = slotMetaMap.get(posKey);
                  const isSegmentGroup = slot.kind === 'segment_group';
                  const isOverflowSlot = Boolean(meta && meta.slotTotalOfTx > 1);
                  const pieceCount = isSegmentGroup ? slot.segmentIds.length : 1;

                  const dim = imageDimensions[tx.id] || tx.receiptMeta;
                  const longFlag =
                    !isSegmentGroup &&
                    Boolean(tx.receiptImage) &&
                    isLongReceipt(dim?.width, dim?.height, density);

                  const compositeEntry = slotCompositeByPosition[posKey];

                  return (
                    <div
                      key={posKey}
                      draggable
                      onDragStart={(e) => handleDragStart(e, pageIdx, slotIdx)}
                      onDragOver={(e) => handleDragOver(e, posKey)}
                      onDragLeave={() => handleDragLeave(posKey)}
                      onDrop={(e) => handleDrop(e, pageIdx, slotIdx)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleSlotTap(pageIdx, slotIdx)}
                      className={`relative rounded-2xl border bg-[#FFFFFF] p-2.5 sm:p-3 flex flex-col justify-between gap-2 overflow-hidden min-w-0 cursor-pointer select-none transition-all ${
                        isOverflowSlot ? 'border-l-4 border-l-[#3182F6]' : ''
                      } ${
                        isSelected
                          ? 'border-[#3182F6] ring-2 ring-[#3182F6] bg-[#E8F3FF]/25'
                          : isDragOver
                            ? 'border-[#3182F6] ring-2 ring-[#3182F6] bg-[#E8F3FF]/35'
                            : isSwapTargetHint
                              ? 'border-[#3182F6]/45 hover:border-[#3182F6]'
                              : 'border-[#E5E8EB] hover:border-[#D1D6DB]'
                      }`}
                    >
                      {/* 드롭 오버레이 칩 */}
                      {isDragOver && (
                        <div className="absolute inset-x-2 top-2 z-20 flex justify-center pointer-events-none">
                          <span className="px-2.5 py-1 rounded-full bg-[#3182F6] text-[#FFFFFF] text-[11px] font-bold">
                            위치 바꾸기
                          </span>
                        </div>
                      )}

                      {/* 슬롯 상단 헤더 (< sm 2단 분리로 137px 셀 오버플로우 원천 차단) */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1 min-w-0">
                          <GripVertical className="w-3.5 h-3.5 text-[#8B95A1] shrink-0 hidden sm:block cursor-grab" />
                          <span className="px-1.5 py-0.5 rounded-md bg-[#191F28] text-[#FFFFFF] text-[10.5px] sm:text-[11px] font-bold tabular-nums shrink-0 whitespace-nowrap">
                            {tx.evidenceNo || '#'}
                            {isOverflowSlot && meta
                              ? ` (${meta.slotIndexOfTx + 1}/${meta.slotTotalOfTx})`
                              : ''}
                          </span>
                          {isSegmentGroup && (
                            <span className="px-1.5 py-0.5 rounded-md bg-[#E8F3FF] text-[#1B64DA] text-[10px] sm:text-[10.5px] font-bold tabular-nums shrink-0 whitespace-nowrap">
                              {pieceCount}조각
                            </span>
                          )}
                        </div>

                        <span className="text-[11px] font-bold text-[#4E5968] tabular-nums truncate sm:shrink-0">
                          {isOverflowSlot && meta && meta.slotIndexOfTx > 0
                            ? '(이어짐)'
                            : formatWon(tx.amount)}
                        </span>
                      </div>

                      {/* 슬롯 이미지 프리뷰 영역 */}
                      <div
                        className={`relative w-full mx-auto rounded-xl bg-[#F9FAFB] overflow-hidden flex items-center justify-center p-1.5 ${previewAspectClass}`}
                      >
                        {isSegmentGroup ? (
                          compositeEntry?.url && !compositeEntry.fallbackSvg ? (
                            <img
                              src={compositeEntry.url}
                              alt={`증빙 ${tx.evidenceNo} 분할 미리보기`}
                              draggable={false}
                              className="w-full h-full object-contain block pointer-events-none"
                            />
                          ) : (
                            renderSegmentGroupFallbackPreview({
                              tx,
                              slot,
                              density,
                              imageDimensions,
                              scanFilter,
                            })
                          )
                        ) : tx.receiptImage ? (
                          <ReceiptImg
                            src={tx.receiptImage}
                            alt={`증빙 ${tx.evidenceNo}`}
                            compactFallback
                            fallbackHeightClass="h-full min-h-[110px]"
                            draggable={false}
                            className={`w-full h-full object-contain block pointer-events-none ${
                              scanFilter ? 'receipt-scan-filter' : ''
                            }`}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center text-[#8B95A1] gap-1 py-4">
                            <ImageIcon className="w-5 h-5" />
                            <span className="text-[11px] font-semibold text-[#F04452]">
                              미첨부
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 슬롯 하단 적요 + 단일화된 분할/배치 수정 버튼 (< sm 풀폭 h-8) */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 min-w-0 pt-0.5">
                        <span className="text-[12px] font-semibold text-[#191F28] truncate w-full sm:w-auto sm:flex-1">
                          {tx.title}
                        </span>

                        {tx.receiptImage && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenSplitEditor(
                                tx,
                                isSegmentGroup ? 'place' : 'cut'
                              );
                            }}
                            className={`w-full sm:w-auto h-8 sm:h-7 px-2.5 sm:px-2 rounded-lg text-[11.5px] sm:text-[11px] font-bold shrink-0 flex items-center justify-center gap-1 whitespace-nowrap active:scale-[0.96] transition-all ${
                              isSegmentGroup || longFlag
                                ? 'bg-[#E8F3FF] text-[#1B64DA]'
                                : 'bg-[#F2F4F6] text-[#4E5968]'
                            }`}
                          >
                            {isSegmentGroup ? (
                              <>
                                <SlidersHorizontal className="w-3 h-3 shrink-0" />
                                <span>배치 수정</span>
                              </>
                            ) : longFlag ? (
                              <>
                                <Scissors className="w-3 h-3 shrink-0" />
                                <span>긴 영수증 분할</span>
                              </>
                            ) : (
                              <>
                                <Scissors className="w-3 h-3 shrink-0" />
                                <span>분할</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* 하단 페이지 추가 버튼 */}
      <button
        type="button"
        onClick={onAddPage}
        className="w-full h-12 rounded-2xl border-2 border-dashed border-[#D1D6DB] bg-[#FFFFFF] hover:border-[#3182F6] text-[#4E5968] hover:text-[#3182F6] text-[13.5px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.99] transition-all"
      >
        <Plus className="w-4 h-4" />
        <span>페이지 추가</span>
      </button>

      {/* 슬롯 선택 시 하단 고정 액션바 (모바일·데스크톱 공용 탭-투-스왑/이동) */}
      {validSelectedCoord && selectedSlot && (
        <div className="sticky sticky-bottom-safe z-20 bg-[#191F28] text-[#FFFFFF] rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-lg">
          <div className="text-[12.5px] font-bold tabular-nums min-w-0 truncate">
            {selectedLabel} 선택됨 · 옮길 칸을 누르세요
          </div>

          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!canStepPrev}
              onClick={() => handleStepSelected(-1)}
              aria-label="이전 칸으로 이동"
              className="h-9 px-2.5 rounded-xl bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12px] font-semibold flex items-center gap-1 disabled:opacity-35 active:scale-[0.97]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              disabled={!canStepNext}
              onClick={() => handleStepSelected(1)}
              aria-label="다음 칸으로 이동"
              className="h-9 px-2.5 rounded-xl bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12px] font-semibold flex items-center gap-1 disabled:opacity-35 active:scale-[0.97]"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {selectedTx?.receiptImage && (
              <button
                type="button"
                onClick={() =>
                  onOpenSplitEditor(
                    selectedTx,
                    selectedSlot.kind === 'segment_group' ? 'place' : 'cut'
                  )
                }
                className="h-9 px-3 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12px] font-bold flex items-center gap-1 active:scale-[0.97]"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>
                  {selectedSlot.kind === 'segment_group' ? '배치 수정' : '분할'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleInsertEmptyAtSelected}
              className="h-9 px-3 rounded-xl bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12px] font-semibold active:scale-[0.97]"
            >
              빈 칸 삽입
            </button>

            <button
              type="button"
              onClick={() => setSelectedCoord(null)}
              aria-label="선택 해제"
              className="h-9 px-2.5 rounded-xl bg-[#FFFFFF]/10 text-[#FFFFFF] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97]"
            >
              <X className="w-3.5 h-3.5" />
              <span>해제</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
