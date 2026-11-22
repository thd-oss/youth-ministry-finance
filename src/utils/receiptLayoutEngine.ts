import {
  AccountType,
  ProcessedTransaction,
  ReceiptBookLayoutEntry,
  ReceiptDensity,
  ReceiptDensityLayout,
  ReceiptEditConfig,
  ReceiptPageLayout,
  ReceiptSegment,
  ReceiptSlotRef,
  SegmentGroupSlotRef,
  SlotSegmentPlacement,
} from '../types/finance';
import {
  clampPlacementAspectLocked,
  evaluateSlotFit,
  getImageAspectHW,
  getSegmentAspectHW,
  packSegmentsIntoSlots,
} from './receiptGeometry';

export interface SlotCoord {
  pageIdx: number;
  slotIdx: number;
}

export interface TxSlotRenderMeta {
  txId: string;
  /** 이 거래가 차지한 전체 슬롯 중 0-based 순번 */
  slotIndexOfTx: number;
  /** 이 거래가 차지한 전체 슬롯 수 (1이면 1칸 완결, 2+이면 오버플로우) */
  slotTotalOfTx: number;
  /** 전체 영수증 기준 이 슬롯 첫 조각의 1-based 순번 (①, ②, ③...) */
  startPieceNumber: number;
}

const DEFAULT_FALLBACK_ASPECT_HW = 1.4;

function createPageId(index: number): string {
  return `p_${index + 1}_${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptySlot(): ReceiptSlotRef {
  return { kind: 'empty' };
}

function createEmptyPage(density: ReceiptDensity, pageIndex: number): ReceiptPageLayout {
  return {
    pageId: createPageId(pageIndex),
    slots: Array.from({ length: density }, () => createEmptySlot()),
  };
}

function isPageAllEmpty(page: ReceiptPageLayout): boolean {
  return page.slots.every((s) => s.kind === 'empty');
}

function normalizePageLength(
  page: ReceiptPageLayout,
  density: ReceiptDensity
): ReceiptPageLayout {
  const slots = page.slots.slice(0, density);
  while (slots.length < density) {
    slots.push(createEmptySlot());
  }
  return {
    pageId: page.pageId,
    slots,
  };
}

function chunkSlotsToPages(
  linearSlots: ReceiptSlotRef[],
  density: ReceiptDensity,
  existingPageIds?: string[]
): ReceiptPageLayout[] {
  if (linearSlots.length === 0) {
    return [createEmptyPage(density, 0)];
  }
  const pages: ReceiptPageLayout[] = [];
  for (let i = 0; i < linearSlots.length; i += density) {
    const pageIdx = pages.length;
    const slice = linearSlots.slice(i, i + density);
    while (slice.length < density) {
      slice.push(createEmptySlot());
    }
    pages.push({
      pageId: existingPageIds?.[pageIdx] || createPageId(pageIdx),
      slots: slice,
    });
  }
  return pages;
}

function trimTrailingEmptyPages(
  pages: ReceiptPageLayout[],
  density: ReceiptDensity
): ReceiptPageLayout[] {
  const next = [...pages];
  while (next.length > 1 && isPageAllEmpty(next[next.length - 1])) {
    next.pop();
  }
  if (next.length === 0) {
    return [createEmptyPage(density, 0)];
  }
  return next;
}

/**
 * 거래의 실효 이미지 종횡비(H/W)를 조회합니다 (런타임 onLoad 치수 우선, 미존재 시 receiptMeta 사용).
 */
export function getEffectiveTxAspectHW(
  tx: ProcessedTransaction,
  imageDimensions: Record<string, { width: number; height: number }>
): number {
  const runtimeDim = imageDimensions[tx.id];
  const fromRuntime = getImageAspectHW(runtimeDim?.width, runtimeDim?.height);
  if (fromRuntime !== null) return fromRuntime;

  const fromMeta = getImageAspectHW(
    tx.receiptMeta?.width,
    tx.receiptMeta?.height
  );
  if (fromMeta !== null) return fromMeta;

  return DEFAULT_FALLBACK_ASPECT_HW;
}

/**
 * 거래에 활성화된 영수증 분할 세그먼트가 있는지 판단합니다.
 */
export function hasActiveReceiptSplit(tx: ProcessedTransaction): boolean {
  if (!tx.receiptImage) return false;
  const segs = tx.receiptEdit?.segments;
  if (!segs || segs.length === 0) return false;
  if (segs.length >= 2) return true;
  const only = segs[0];
  return (
    only.yStart > 0.001 ||
    only.yEnd < 0.999 ||
    (only.xStart ?? 0) > 0.001 ||
    (only.xEnd ?? 1) < 0.999
  );
}

/**
 * 단일 거래에 대한 기본 A4 슬롯 배열을 생성합니다 (분할 거래는 1칸 최대 패킹 + 자동 오버플로우).
 */
export function buildDefaultSlotsForTx(
  tx: ProcessedTransaction,
  density: ReceiptDensity,
  imageDimensions: Record<string, { width: number; height: number }>
): ReceiptSlotRef[] {
  if (!hasActiveReceiptSplit(tx) || !tx.receiptEdit) {
    return [{ kind: 'tx', txId: tx.id }];
  }

  const origAspectHW = getEffectiveTxAspectHW(tx, imageDimensions);
  const packed = packSegmentsIntoSlots(
    tx.receiptEdit.segments,
    origAspectHW,
    density
  );

  if (packed.length === 0) {
    return [{ kind: 'tx', txId: tx.id }];
  }

  return packed.map<SegmentGroupSlotRef>((slotRes) => ({
    kind: 'segment_group',
    txId: tx.id,
    segmentIds: slotRes.segmentIds,
    layoutMode: 'auto',
  }));
}

/**
 * 월·계정 스코프 키를 생성합니다. (예: '2026-11:all')
 */
export function buildReceiptLayoutScopeKey(
  yearMonth: string,
  accountFilter: AccountType
): string {
  return `${yearMonth}:${accountFilter}`;
}

function getEligibleTransactions(
  transactions: ProcessedTransaction[],
  includeMissingSlots: boolean
): ProcessedTransaction[] {
  return transactions.filter((tx) => {
    if (!tx.evidenceNo) return false;
    if (!includeMissingSlots && !tx.receiptImage) return false;
    return true;
  });
}

function sanitizeCustomPlacements(
  slot: SegmentGroupSlotRef,
  segmentsById: Map<string, ReceiptSegment>,
  origAspectHW: number,
  density: ReceiptDensity
): SegmentGroupSlotRef {
  if (
    slot.layoutMode !== 'custom' ||
    !Array.isArray(slot.placements) ||
    slot.placements.length === 0
  ) {
    return {
      kind: 'segment_group',
      txId: slot.txId,
      segmentIds: slot.segmentIds,
      layoutMode: 'auto',
    };
  }

  const placementBySegId = new Map<string, SlotSegmentPlacement>();
  slot.placements.forEach((p) => {
    if (segmentsById.has(p.segmentId) && !placementBySegId.has(p.segmentId)) {
      placementBySegId.set(p.segmentId, p);
    }
  });

  // 슬롯 내 모든 segmentId에 대응하는 좌표가 있어야 custom 유지, 누락 시 안전하게 auto 복귀
  if (slot.segmentIds.some((id) => !placementBySegId.has(id))) {
    return {
      kind: 'segment_group',
      txId: slot.txId,
      segmentIds: slot.segmentIds,
      layoutMode: 'auto',
    };
  }

  const clampedPlacements = slot.segmentIds.map((id) => {
    const seg = segmentsById.get(id)!;
    const rawPlacement = placementBySegId.get(id)!;
    const segAspectHW = getSegmentAspectHW(seg, origAspectHW);
    return clampPlacementAspectLocked(rawPlacement, segAspectHW, density);
  });

  return {
    kind: 'segment_group',
    txId: slot.txId,
    segmentIds: slot.segmentIds,
    layoutMode: 'custom',
    placements: clampedPlacements,
  };
}

/**
 * 반대 밀도의 저장 배치에서 사용자 순서를 계승해 목표 밀도(2-up 또는 4-up)의
 * 배치를 파생합니다. 각 분할 거래는 목표 밀도 기하에 맞춰 1칸 최대 패킹을 재적용합니다.
 */
export function deriveLayoutForDensity(args: {
  transactions: ProcessedTransaction[];
  targetDensity: ReceiptDensity;
  sourceLayout?: ReceiptDensityLayout;
  includeMissingSlots: boolean;
  imageDimensions: Record<string, { width: number; height: number }>;
}): ReceiptDensityLayout {
  const {
    transactions,
    targetDensity,
    sourceLayout,
    includeMissingSlots,
    imageDimensions,
  } = args;

  const eligible = getEligibleTransactions(transactions, includeMissingSlots);
  const txById = new Map(eligible.map((tx) => [tx.id, tx]));

  const orderedTxIds: string[] = [];
  const seenTxIds = new Set<string>();

  if (sourceLayout?.pages) {
    for (const page of sourceLayout.pages) {
      for (const slot of page.slots) {
        if (slot.kind === 'empty') continue;
        if (txById.has(slot.txId) && !seenTxIds.has(slot.txId)) {
          seenTxIds.add(slot.txId);
          orderedTxIds.push(slot.txId);
        }
      }
    }
  }

  for (const tx of eligible) {
    if (!seenTxIds.has(tx.id)) {
      seenTxIds.add(tx.id);
      orderedTxIds.push(tx.id);
    }
  }

  const linearSlots: ReceiptSlotRef[] = [];
  for (const txId of orderedTxIds) {
    const tx = txById.get(txId);
    if (!tx) continue;
    linearSlots.push(...buildDefaultSlotsForTx(tx, targetDensity, imageDimensions));
  }

  const pages = chunkSlotsToPages(linearSlots, targetDensity);

  return {
    density: targetDensity,
    pages,
    unplaced: sourceLayout?.unplaced ? [...sourceLayout.unplaced] : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 현재 거래 목록·분할 정보·저장된 배치 설정을 정합성 보정(Reconcile)하여
 * 최종 A4 영수증철 페이지 배열을 산출합니다.
 */
export function resolveReceiptBookPages(args: {
  transactions: ProcessedTransaction[];
  density: ReceiptDensity;
  includeMissingSlots: boolean;
  savedEntry?: ReceiptBookLayoutEntry;
  imageDimensions: Record<string, { width: number; height: number }>;
}): ReceiptPageLayout[] {
  const {
    transactions,
    density,
    includeMissingSlots,
    savedEntry,
    imageDimensions,
  } = args;

  const eligible = getEligibleTransactions(transactions, includeMissingSlots);
  if (eligible.length === 0) {
    return [createEmptyPage(density, 0)];
  }

  const txById = new Map(eligible.map((tx) => [tx.id, tx]));
  const directSaved = savedEntry?.byDensity?.[density];
  const otherDensity: ReceiptDensity = density === 2 ? 4 : 2;
  const fallbackSaved = savedEntry?.byDensity?.[otherDensity];

  // 1) 직접 저장된 배치가 없고 반대 밀도 배치가 있으면 순서 계승 파생
  if (!directSaved && fallbackSaved) {
    return deriveLayoutForDensity({
      transactions,
      targetDensity: density,
      sourceLayout: fallbackSaved,
      includeMissingSlots,
      imageDimensions,
    }).pages;
  }

  // 2) 저장된 배치가 전혀 없으면 기본 순차 배치(0-오버헤드)
  if (!directSaved) {
    const linearSlots: ReceiptSlotRef[] = [];
    for (const tx of eligible) {
      linearSlots.push(...buildDefaultSlotsForTx(tx, density, imageDimensions));
    }
    return chunkSlotsToPages(linearSlots, density);
  }

  // 3) 저장 배치 정합성 보정
  const seenSingleTxIds = new Set<string>();
  const seenSegIdsByTx = new Map<string, Set<string>>();
  const extraSlotsToAppend: ReceiptSlotRef[] = [];
  let removedInvalidSlot = false;

  const normalizedPages = directSaved.pages.map((page) =>
    normalizePageLength(page, density)
  );

  const reconciledPages: ReceiptPageLayout[] = normalizedPages.map((page) => {
    const nextSlots = page.slots.map<ReceiptSlotRef>((slot) => {
      if (slot.kind === 'empty') return createEmptySlot();

      const tx = txById.get(slot.txId);
      if (!tx) {
        removedInvalidSlot = true;
        return createEmptySlot();
      }

      const txIsSplit = hasActiveReceiptSplit(tx) && Boolean(tx.receiptEdit);

      if (slot.kind === 'tx') {
        if (seenSingleTxIds.has(tx.id)) {
          removedInvalidSlot = true;
          return createEmptySlot();
        }
        if (txIsSplit && tx.receiptEdit) {
          // 기존 단일 슬롯 거래가 분할된 경우 첫 슬롯은 제자리, 나머지는 뒤로 추가
          const packedSlots = buildDefaultSlotsForTx(
            tx,
            density,
            imageDimensions
          );
          const segSet = new Set<string>();
          packedSlots.forEach((ps) => {
            if (ps.kind === 'segment_group') {
              ps.segmentIds.forEach((id) => segSet.add(id));
            }
          });
          seenSegIdsByTx.set(tx.id, segSet);
          seenSingleTxIds.add(tx.id);
          if (packedSlots.length > 1) {
            extraSlotsToAppend.push(...packedSlots.slice(1));
          }
          return packedSlots[0] || createEmptySlot();
        }

        seenSingleTxIds.add(tx.id);
        return { kind: 'tx', txId: tx.id };
      }

      // slot.kind === 'segment_group'
      if (!txIsSplit || !tx.receiptEdit) {
        // 분할이 해제된 경우 첫 등장만 일반 tx 슬롯으로 승격
        if (!seenSingleTxIds.has(tx.id)) {
          seenSingleTxIds.add(tx.id);
          return { kind: 'tx', txId: tx.id };
        }
        removedInvalidSlot = true;
        return createEmptySlot();
      }

      const validSegMap = new Map(
        tx.receiptEdit.segments.map((s) => [s.id, s])
      );
      const seenSet = seenSegIdsByTx.get(tx.id) || new Set<string>();
      const keptSegIds = slot.segmentIds.filter(
        (id) => validSegMap.has(id) && !seenSet.has(id)
      );

      if (keptSegIds.length === 0) {
        removedInvalidSlot = true;
        return createEmptySlot();
      }

      keptSegIds.forEach((id) => seenSet.add(id));
      seenSegIdsByTx.set(tx.id, seenSet);
      seenSingleTxIds.add(tx.id);

      const origAspectHW = getEffectiveTxAspectHW(tx, imageDimensions);
      return sanitizeCustomPlacements(
        {
          ...slot,
          segmentIds: keptSegIds,
        },
        validSegMap,
        origAspectHW,
        density
      );
    });

    return {
      pageId: page.pageId,
      slots: nextSlots,
    };
  });

  // 4) 분할 거래 중 배치표에 누락된 세그먼트 보충
  for (const tx of eligible) {
    if (!hasActiveReceiptSplit(tx) || !tx.receiptEdit) continue;
    const seenSet = seenSegIdsByTx.get(tx.id);
    if (!seenSet) continue;

    const missingSegments = tx.receiptEdit.segments.filter(
      (seg) => !seenSet.has(seg.id)
    );
    if (missingSegments.length > 0) {
      const origAspectHW = getEffectiveTxAspectHW(tx, imageDimensions);
      const packed = packSegmentsIntoSlots(missingSegments, origAspectHW, density);
      packed.forEach((p) => {
        extraSlotsToAppend.push({
          kind: 'segment_group',
          txId: tx.id,
          segmentIds: p.segmentIds,
          layoutMode: 'auto',
        });
      });
    }
  }

  // 5) 새로 추가된 지출 거래(배치표 미등록) 자동 추가
  const unplacedTxIds = new Set(
    (directSaved.unplaced || []).map((item) => item.txId)
  );
  for (const tx of eligible) {
    if (seenSingleTxIds.has(tx.id) || unplacedTxIds.has(tx.id)) continue;
    extraSlotsToAppend.push(...buildDefaultSlotsForTx(tx, density, imageDimensions));
  }

  // 6) 보충/신규 슬롯을 마지막 페이지의 후행 빈 칸 또는 새 페이지에 배치
  const workingPages = reconciledPages.map((p) => ({
    pageId: p.pageId,
    slots: [...p.slots],
  }));

  for (const extraSlot of extraSlotsToAppend) {
    let placed = false;
    const lastPage = workingPages[workingPages.length - 1];
    if (lastPage) {
      // 마지막 페이지의 끝쪽 연속 빈 칸 중 첫 위치에 채움
      let lastOccupiedIdx = -1;
      for (let i = lastPage.slots.length - 1; i >= 0; i--) {
        if (lastPage.slots[i].kind !== 'empty') {
          lastOccupiedIdx = i;
          break;
        }
      }
      if (lastOccupiedIdx + 1 < density) {
        lastPage.slots[lastOccupiedIdx + 1] = extraSlot;
        placed = true;
      }
    }
    if (!placed) {
      const newPage = createEmptyPage(density, workingPages.length);
      newPage.slots[0] = extraSlot;
      workingPages.push(newPage);
    }
  }

  // 삭제/숨김으로 인해 후행 페이지가 전부 빈 경우에만 정리 (사용자가 명시적으로 추가한 마지막 빈 페이지 1장은 보존)
  if (removedInvalidSlot) {
    return trimTrailingEmptyPages(workingPages, density);
  }

  return workingPages.length > 0 ? workingPages : [createEmptyPage(density, 0)];
}

/**
 * 거래의 분할 편집 결과(`nextReceiptEdit` + 슬롯 내 배치 `nextSlotGroups`)를
 * 현재 페이지 배열에 원자적으로 반영합니다.
 */
export function applyReceiptSplitToPages(args: {
  pages: ReceiptPageLayout[];
  density: ReceiptDensity;
  txId: string;
  nextReceiptEdit?: ReceiptEditConfig;
  nextSlotGroups: SegmentGroupSlotRef[];
}): ReceiptPageLayout[] {
  const { pages, density, txId, nextReceiptEdit, nextSlotGroups } = args;

  const existingPageIds = pages.map((p) => p.pageId);
  const linear: ReceiptSlotRef[] = [];
  for (const page of pages) {
    const normalized = normalizePageLength(page, density);
    linear.push(...normalized.slots);
  }

  // 해당 txId의 기존 위치 수집
  const existingIndices: number[] = [];
  linear.forEach((slot, idx) => {
    if (slot.kind !== 'empty' && slot.txId === txId) {
      existingIndices.push(idx);
    }
  });

  // 유효한 교체 슬롯 목록 구성
  const segs = nextReceiptEdit?.segments || [];
  const isRevertedToSingle =
    segs.length === 0 ||
    (segs.length === 1 &&
      segs[0].yStart <= 0.001 &&
      segs[0].yEnd >= 0.999 &&
      (segs[0].xStart ?? 0) <= 0.001 &&
      (segs[0].xEnd ?? 1) >= 0.999);

  const validGroups = nextSlotGroups.filter((g) => g.segmentIds.length > 0);
  const replacements: ReceiptSlotRef[] =
    isRevertedToSingle || validGroups.length === 0
      ? [{ kind: 'tx', txId }]
      : validGroups.map((g) => ({
          kind: 'segment_group',
          txId,
          segmentIds: [...g.segmentIds],
          layoutMode: g.layoutMode === 'custom' ? 'custom' : 'auto',
          placements:
            g.layoutMode === 'custom' && g.placements
              ? g.placements.map((p) => ({ ...p }))
              : undefined,
        }));

  if (existingIndices.length === 0) {
    // 기존에 없던 거래면 끝에 추가
    const nextLinear = [...linear, ...replacements];
    return trimTrailingEmptyPages(
      chunkSlotsToPages(nextLinear, density, existingPageIds),
      density
    );
  }

  const firstIdx = existingIndices[0];
  const nextLinear = [...linear];

  // 기존 슬롯들을 먼저 모두 비움
  for (const idx of existingIndices) {
    nextLinear[idx] = createEmptySlot();
  }

  // 1) 기존에 점유했던 자리들에 우선 재배치
  let repCursor = 0;
  for (const idx of existingIndices) {
    if (repCursor < replacements.length) {
      nextLinear[idx] = replacements[repCursor];
      repCursor += 1;
    }
  }

  // 2) 기존보다 슬롯 수가 늘어난 경우: 마지막 점유 자리 바로 뒤의 빈 칸을 먼저 채우고,
  //    모자라면 해당 지점에 스플라이스해 뒤 슬롯을 최소한만 밀어냄
  let insertAnchor = existingIndices[existingIndices.length - 1] + 1;
  while (repCursor < replacements.length) {
    if (
      insertAnchor < nextLinear.length &&
      nextLinear[insertAnchor].kind === 'empty'
    ) {
      nextLinear[insertAnchor] = replacements[repCursor];
    } else {
      nextLinear.splice(insertAnchor, 0, replacements[repCursor]);
    }
    insertAnchor += 1;
    repCursor += 1;
  }

  // 3) 기존보다 슬롯 수가 줄어든 경우: 앞선 자리들은 채워졌고 남은 기존 자리는 empty.
  //    단, 거래가 2칸→1칸으로 줄었을 때 바로 뒤가 빈 칸이면 자연스럽게 유지하되 후행 빈 페이지만 정리.
  void firstIdx;
  return trimTrailingEmptyPages(
    chunkSlotsToPages(nextLinear, density, existingPageIds),
    density
  );
}

/**
 * 거래의 `nextReceiptEdit`만 변경되었을 때(예: 외부 편집/동기화) 해당 거래의 슬롯을
 * 자동 1칸 최대 패킹으로 재계산해 페이지에 반영합니다.
 */
export function reconcileTxSegmentsInPages(args: {
  pages: ReceiptPageLayout[];
  density: ReceiptDensity;
  txId: string;
  nextReceiptEdit?: ReceiptEditConfig;
  origAspectHW: number;
}): ReceiptPageLayout[] {
  const { pages, density, txId, nextReceiptEdit, origAspectHW } = args;
  const segs = nextReceiptEdit?.segments || [];
  const packed = packSegmentsIntoSlots(segs, origAspectHW, density);
  const nextSlotGroups: SegmentGroupSlotRef[] = packed.map((p) => ({
    kind: 'segment_group',
    txId,
    segmentIds: p.segmentIds,
    layoutMode: 'auto',
  }));

  return applyReceiptSplitToPages({
    pages,
    density,
    txId,
    nextReceiptEdit,
    nextSlotGroups,
  });
}

/**
 * 분할 에디터에서 특정 조각을 이전 칸(-1) 또는 다음 칸(+1)으로 1탭 이동합니다.
 * 이동 후 빈 슬롯 그룹은 자동 정리되며, 영향받은 슬롯은 자동 패킹으로 재정렬됩니다.
 */
export function moveSegmentBetweenSlotGroups(
  slotGroups: SegmentGroupSlotRef[],
  fromSlotIdx: number,
  segId: string,
  direction: -1 | 1,
  segments: ReceiptSegment[],
  origAspectHW: number,
  density: ReceiptDensity
): SegmentGroupSlotRef[] {
  if (fromSlotIdx < 0 || fromSlotIdx >= slotGroups.length) {
    return slotGroups;
  }
  const sourceGroup = slotGroups[fromSlotIdx];
  if (!sourceGroup.segmentIds.includes(segId)) {
    return slotGroups;
  }

  const segOrderMap = new Map(segments.map((s, idx) => [s.id, idx]));
  const segById = new Map(segments.map((s) => [s.id, s]));
  const sortSegIds = (ids: string[]) =>
    [...ids].sort(
      (a, b) => (segOrderMap.get(a) ?? 999) - (segOrderMap.get(b) ?? 999)
    );

  const nextGroups: SegmentGroupSlotRef[] = slotGroups.map((g) => ({
    ...g,
    segmentIds: [...g.segmentIds],
    placements: g.placements ? g.placements.map((p) => ({ ...p })) : undefined,
  }));

  const targetIdx = fromSlotIdx + direction;

  // 경계 밖 이동: 현재 칸에 2개 이상 조각이 있을 때만 새 오버플로우 칸을 생성
  if (targetIdx < 0 || targetIdx >= nextGroups.length) {
    if (sourceGroup.segmentIds.length <= 1) {
      return slotGroups;
    }
    nextGroups[fromSlotIdx] = {
      kind: 'segment_group',
      txId: sourceGroup.txId,
      segmentIds: sourceGroup.segmentIds.filter((id) => id !== segId),
      layoutMode: 'auto',
    };
    const newGroup: SegmentGroupSlotRef = {
      kind: 'segment_group',
      txId: sourceGroup.txId,
      segmentIds: [segId],
      layoutMode: 'auto',
    };
    if (targetIdx < 0) {
      nextGroups.unshift(newGroup);
    } else {
      nextGroups.push(newGroup);
    }
  } else {
    nextGroups[fromSlotIdx] = {
      kind: 'segment_group',
      txId: sourceGroup.txId,
      segmentIds: sourceGroup.segmentIds.filter((id) => id !== segId),
      layoutMode: 'auto',
    };
    nextGroups[targetIdx] = {
      kind: 'segment_group',
      txId: nextGroups[targetIdx].txId,
      segmentIds: sortSegIds([...nextGroups[targetIdx].segmentIds, segId]),
      layoutMode: 'auto',
    };
  }

  // 빈 슬롯 그룹 제거 후 각 슬롯의 auto 패킹 유효성 검증
  return nextGroups
    .filter((g) => g.segmentIds.length > 0)
    .map((g) => {
      const groupSegs = g.segmentIds
        .map((id) => segById.get(id))
        .filter((s): s is ReceiptSegment => Boolean(s));
      if (g.layoutMode !== 'custom') {
        // evaluateSlotFit으로 자동 패킹 정합성 보장
        evaluateSlotFit(groupSegs, origAspectHW, density);
        return {
          kind: 'segment_group',
          txId: g.txId,
          segmentIds: groupSegs.map((s) => s.id),
          layoutMode: 'auto',
        };
      }
      return g;
    });
}

/**
 * 두 슬롯의 위치를 교환합니다 (같은 페이지 및 다른 페이지 간 모두 지원).
 */
export function swapSlots(
  pages: ReceiptPageLayout[],
  a: SlotCoord,
  b: SlotCoord
): ReceiptPageLayout[] {
  if (
    a.pageIdx === b.pageIdx &&
    a.slotIdx === b.slotIdx
  ) {
    return pages;
  }
  if (
    !pages[a.pageIdx] ||
    !pages[b.pageIdx] ||
    a.slotIdx < 0 ||
    b.slotIdx < 0 ||
    a.slotIdx >= pages[a.pageIdx].slots.length ||
    b.slotIdx >= pages[b.pageIdx].slots.length
  ) {
    return pages;
  }

  const next = pages.map((p) => ({
    pageId: p.pageId,
    slots: [...p.slots],
  }));

  const temp = next[a.pageIdx].slots[a.slotIdx];
  next[a.pageIdx].slots[a.slotIdx] = next[b.pageIdx].slots[b.slotIdx];
  next[b.pageIdx].slots[b.slotIdx] = temp;
  return next;
}

/**
 * 지정한 슬롯을 빈 칸으로 비웁니다.
 * 주의: 영수증 유실을 방지하려면 일반 편집에서는 `insertEmptySlotAt` 또는 `swapSlots`를 권장합니다.
 */
export function clearSlotToEmpty(
  pages: ReceiptPageLayout[],
  target: SlotCoord
): ReceiptPageLayout[] {
  if (
    !pages[target.pageIdx] ||
    target.slotIdx < 0 ||
    target.slotIdx >= pages[target.pageIdx].slots.length
  ) {
    return pages;
  }
  const next = pages.map((p) => ({
    pageId: p.pageId,
    slots: [...p.slots],
  }));
  next[target.pageIdx].slots[target.slotIdx] = createEmptySlot();
  return next;
}

/**
 * 지정 위치에 빈 칸을 삽입하고 뒤 슬롯들을 한 칸씩 안전하게 밀어냅니다 (데이터 유실 0건).
 */
export function insertEmptySlotAt(
  pages: ReceiptPageLayout[],
  target: SlotCoord,
  density: ReceiptDensity
): ReceiptPageLayout[] {
  const existingPageIds = pages.map((p) => p.pageId);
  const linear: ReceiptSlotRef[] = [];
  for (const page of pages) {
    linear.push(...normalizePageLength(page, density).slots);
  }

  const insertIndex = Math.max(
    0,
    Math.min(linear.length, target.pageIdx * density + target.slotIdx)
  );
  linear.splice(insertIndex, 0, createEmptySlot());

  // 끝쪽 여분의 연속 빈 슬롯으로 인해 불필요한 전빈 페이지가 생기지 않도록 정리
  return trimTrailingEmptyPages(
    chunkSlotsToPages(linear, density, existingPageIds),
    density
  );
}

/**
 * [자동 채우기]: 모든 빈 칸을 압축하고 빈 페이지를 제거해 촘촘하게 재정렬합니다.
 */
export function compactPages(
  pages: ReceiptPageLayout[],
  density: ReceiptDensity
): ReceiptPageLayout[] {
  const existingPageIds = pages.map((p) => p.pageId);
  const nonEmpty: ReceiptSlotRef[] = [];
  for (const page of pages) {
    for (const slot of page.slots) {
      if (slot.kind !== 'empty') {
        nonEmpty.push(slot);
      }
    }
  }
  return chunkSlotsToPages(nonEmpty, density, existingPageIds);
}

/**
 * [기본 순서로]: 증빙번호(#01 → #N) 기본 순서로 재정렬하며,
 * 각 거래의 분할 편집점은 유지한 채 현재 밀도 기준 1칸 최대 패킹을 재적용합니다.
 */
export function resetPagesOrder(args: {
  transactions: ProcessedTransaction[];
  density: ReceiptDensity;
  includeMissingSlots: boolean;
  imageDimensions: Record<string, { width: number; height: number }>;
}): ReceiptPageLayout[] {
  const { transactions, density, includeMissingSlots, imageDimensions } = args;
  const eligible = getEligibleTransactions(transactions, includeMissingSlots);
  const linear: ReceiptSlotRef[] = [];
  for (const tx of eligible) {
    linear.push(...buildDefaultSlotsForTx(tx, density, imageDimensions));
  }
  return chunkSlotsToPages(linear, density);
}

/**
 * 영수증철 끝에 빈 A4 페이지 1장을 추가합니다.
 */
export function addEmptyPage(
  pages: ReceiptPageLayout[],
  density: ReceiptDensity
): ReceiptPageLayout[] {
  return [...pages, createEmptyPage(density, pages.length)];
}

/**
 * 페이지 전체를 스캔해 각 슬롯 좌표(`${pageIdx}:${slotIdx}`)별
 * 동일 거래의 점유 칸 순번(1/2, 2/2)과 연속 조각 번호 시작값(①, ③...)을 계산합니다.
 */
export function buildTxSlotRenderMetaMap(
  pages: ReceiptPageLayout[]
): Map<string, TxSlotRenderMeta> {
  const totalSlotsByTx = new Map<string, number>();
  for (const page of pages) {
    for (const slot of page.slots) {
      if (slot.kind === 'empty') continue;
      totalSlotsByTx.set(slot.txId, (totalSlotsByTx.get(slot.txId) || 0) + 1);
    }
  }

  const slotCursorByTx = new Map<string, number>();
  const pieceCursorByTx = new Map<string, number>();
  const metaMap = new Map<string, TxSlotRenderMeta>();

  pages.forEach((page, pageIdx) => {
    page.slots.forEach((slot, slotIdx) => {
      if (slot.kind === 'empty') return;
      const slotIndexOfTx = slotCursorByTx.get(slot.txId) || 0;
      const startPieceNumber = (pieceCursorByTx.get(slot.txId) || 0) + 1;
      const pieceCount =
        slot.kind === 'segment_group' ? Math.max(1, slot.segmentIds.length) : 1;

      metaMap.set(`${pageIdx}:${slotIdx}`, {
        txId: slot.txId,
        slotIndexOfTx,
        slotTotalOfTx: totalSlotsByTx.get(slot.txId) || 1,
        startPieceNumber,
      });

      slotCursorByTx.set(slot.txId, slotIndexOfTx + 1);
      pieceCursorByTx.set(slot.txId, startPieceNumber - 1 + pieceCount);
    });
  });

  return metaMap;
}
