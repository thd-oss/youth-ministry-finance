import {
  AccountBalancesSummary,
  AccountType,
  AppSettings,
  BudgetDocument,
  BudgetTemplateType,
  EXPENSE_CATEGORIES,
  FiscalYearCloudRef,
  INCOME_CATEGORIES,
  MOKJANG_SUBTYPE_LABELS,
  MokjangGroup,
  ProcessedTransaction,
  ReceiptBookLayoutEntry,
  ReceiptBookLayoutsMap,
  ReceiptDensity,
  ReceiptDensityLayout,
  ReceiptEditConfig,
  ReceiptItemRef,
  ReceiptMetadata,
  ReceiptPageLayout,
  ReceiptSegment,
  ReceiptSlotRef,
  SegmentGroupSlotRef,
  SlotSegmentPlacement,
  Transaction,
} from '../types/finance';
import {
  DEFAULT_SETTINGS,
  INITIAL_ANNUAL_BUDGET,
  INITIAL_MOKJANG_GROUPS,
  INITIAL_RETREAT_BUDGET,
  INITIAL_TRANSACTIONS,
} from './sampleData';

const STORAGE_KEYS = {
  TRANSACTIONS: 'tds_youth_finance_transactions_v2',
  BUDGETS: 'tds_youth_finance_budgets_v2',
  MOKJANGS: 'tds_youth_finance_mokjangs_v2',
  SETTINGS: 'tds_youth_finance_settings_v2',
  RECEIPT_LAYOUTS: 'tds_youth_finance_receipt_layouts_v1',
  ACTIVE_FISCAL_YEAR: 'tds_youth_finance_active_fy_v1',
  KNOWN_FISCAL_YEARS: 'tds_youth_finance_known_fys_v1',
  FY_MIGRATED_FLAG: 'tds_youth_finance_fy_migrated_v1',
};

const BACKUP_SCHEMA_VERSION = '4.0';
export const DEFAULT_FISCAL_YEAR = 2026;
const MONTHS_PER_YEAR = 12;
const MIN_VALID_FISCAL_YEAR = 2020;
const MAX_VALID_FISCAL_YEAR = 2099;
const NORMALIZED_COORD_SCALE = 10000;
const MIN_VALID_PLACEMENT_SIZE = 0.01;
const MAX_NORMALIZED_BOUND_EPSILON = 1.001;

export function isValidFiscalYear(year: unknown): year is number {
  return (
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= MIN_VALID_FISCAL_YEAR &&
    year <= MAX_VALID_FISCAL_YEAR
  );
}

/**
 * 1월~12월 기준 회계연도의 12개월 목록('YYYY-01' ~ 'YYYY-12')을 동적으로 생성합니다.
 */
export function getFiscalYearMonths(fiscalYear: number): string[] {
  const safeYear = isValidFiscalYear(fiscalYear)
    ? fiscalYear
    : DEFAULT_FISCAL_YEAR;
  return Array.from(
    { length: MONTHS_PER_YEAR },
    (_, idx) => `${safeYear}-${String(idx + 1).padStart(2, '0')}`
  );
}

function fyStorageKey(
  kind: 'transactions' | 'budgets' | 'mokjangs' | 'receipt_layouts',
  fiscalYear: number
): string {
  return `tds_youth_finance_${kind}_fy_${fiscalYear}`;
}

function roundNormalizedCoord(value: number): number {
  return Math.round(value * NORMALIZED_COORD_SCALE) / NORMALIZED_COORD_SCALE;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidDensity(value: unknown): value is ReceiptDensity {
  return value === 2 || value === 4;
}

/**
 * 외부(구글 시트/JSON 백업 등)에서 복원한 영수증 메타데이터를 검증·정규화합니다.
 */
export function sanitizeReceiptMetadata(
  raw: unknown
): ReceiptMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const width = Number(obj.width);
  const height = Number(obj.height);
  const sizeKb = Number(obj.sizeKb);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
    sizeKb: Number.isFinite(sizeKb) && sizeKb >= 0 ? Math.round(sizeKb) : 0,
    ...(typeof obj.fileName === 'string' && obj.fileName.trim()
      ? { fileName: obj.fileName }
      : {}),
  };
}

/**
 * 거래의 비파괴 분할 설정(ReceiptEditConfig)을 검증·정규화합니다.
 */
export function sanitizeReceiptEditConfig(
  raw: unknown
): ReceiptEditConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.segments)) return undefined;

  const seenIds = new Set<string>();
  const validSegments: ReceiptSegment[] = [];

  for (const item of obj.segments) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as Record<string, unknown>;
    const id = typeof seg.id === 'string' ? seg.id.trim() : '';
    if (!id || seenIds.has(id)) continue;

    const yStart = Number(seg.yStart);
    const yEnd = Number(seg.yEnd);
    if (
      !Number.isFinite(yStart) ||
      !Number.isFinite(yEnd) ||
      yStart < 0 ||
      yEnd > MAX_NORMALIZED_BOUND_EPSILON ||
      yStart >= yEnd
    ) {
      continue;
    }

    const clampedYStart = roundNormalizedCoord(Math.max(0, Math.min(1, yStart)));
    const clampedYEnd = roundNormalizedCoord(Math.max(0, Math.min(1, yEnd)));
    if (clampedYStart >= clampedYEnd) continue;

    let xStart: number | undefined;
    let xEnd: number | undefined;
    if (seg.xStart !== undefined || seg.xEnd !== undefined) {
      const rawXStart = seg.xStart === undefined ? 0 : Number(seg.xStart);
      const rawXEnd = seg.xEnd === undefined ? 1 : Number(seg.xEnd);
      if (
        Number.isFinite(rawXStart) &&
        Number.isFinite(rawXEnd) &&
        rawXStart >= 0 &&
        rawXEnd <= MAX_NORMALIZED_BOUND_EPSILON &&
        rawXStart < rawXEnd
      ) {
        xStart = roundNormalizedCoord(Math.max(0, Math.min(1, rawXStart)));
        xEnd = roundNormalizedCoord(Math.max(0, Math.min(1, rawXEnd)));
      }
    }

    seenIds.add(id);
    validSegments.push({
      id,
      yStart: clampedYStart,
      yEnd: clampedYEnd,
      ...(xStart !== undefined && xEnd !== undefined ? { xStart, xEnd } : {}),
    });
  }

  if (validSegments.length === 0) return undefined;

  return {
    version: 1,
    segments: validSegments,
    ...(typeof obj.updatedAt === 'string' && obj.updatedAt
      ? { updatedAt: obj.updatedAt }
      : {}),
  };
}

function sanitizeCustomPlacements(
  rawPlacements: unknown,
  segmentIds: string[]
): SlotSegmentPlacement[] | null {
  if (!Array.isArray(rawPlacements) || rawPlacements.length === 0) {
    return null;
  }

  const expectedSet = new Set(segmentIds);
  const byId = new Map<string, SlotSegmentPlacement>();

  for (const item of rawPlacements) {
    if (!item || typeof item !== 'object') return null;
    const p = item as Record<string, unknown>;
    const segmentId = typeof p.segmentId === 'string' ? p.segmentId.trim() : '';
    if (!segmentId || !expectedSet.has(segmentId) || byId.has(segmentId)) {
      return null;
    }

    if (
      !isFiniteNumber(p.x) ||
      !isFiniteNumber(p.y) ||
      !isFiniteNumber(p.w) ||
      !isFiniteNumber(p.h)
    ) {
      return null;
    }

    if (
      p.x < 0 ||
      p.y < 0 ||
      p.w < MIN_VALID_PLACEMENT_SIZE ||
      p.h < MIN_VALID_PLACEMENT_SIZE ||
      p.w > 1 ||
      p.h > 1 ||
      p.x + p.w > MAX_NORMALIZED_BOUND_EPSILON ||
      p.y + p.h > MAX_NORMALIZED_BOUND_EPSILON
    ) {
      return null;
    }

    const w = roundNormalizedCoord(Math.min(1, p.w));
    const h = roundNormalizedCoord(Math.min(1, p.h));
    const x = roundNormalizedCoord(Math.min(Math.max(0, p.x), 1 - w));
    const y = roundNormalizedCoord(Math.min(Math.max(0, p.y), 1 - h));
    const z = isFiniteNumber(p.z) ? Math.round(p.z) : undefined;

    byId.set(segmentId, {
      segmentId,
      x,
      y,
      w,
      h,
      ...(z !== undefined ? { z } : {}),
    });
  }

  if (byId.size !== expectedSet.size) {
    return null;
  }

  return segmentIds.map((id) => byId.get(id)!);
}

function sanitizeReceiptSlotRef(raw: unknown): ReceiptSlotRef {
  if (!raw || typeof raw !== 'object') return { kind: 'empty' };
  const obj = raw as Record<string, unknown>;

  if (obj.kind === 'empty') {
    return { kind: 'empty' };
  }

  if (obj.kind === 'tx') {
    const txId = typeof obj.txId === 'string' ? obj.txId.trim() : '';
    return txId ? { kind: 'tx', txId } : { kind: 'empty' };
  }

  if (obj.kind === 'segment_group') {
    const txId = typeof obj.txId === 'string' ? obj.txId.trim() : '';
    if (!txId || !Array.isArray(obj.segmentIds)) {
      return { kind: 'empty' };
    }

    const segmentIds = Array.from(
      new Set(
        obj.segmentIds
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean)
      )
    );
    if (segmentIds.length === 0) {
      return { kind: 'empty' };
    }

    const baseGroup: SegmentGroupSlotRef = {
      kind: 'segment_group',
      txId,
      segmentIds,
    };

    if (obj.layoutMode === 'custom') {
      const validPlacements = sanitizeCustomPlacements(
        obj.placements,
        segmentIds
      );
      if (validPlacements) {
        return {
          ...baseGroup,
          layoutMode: 'custom',
          placements: validPlacements,
        };
      }
      // NaN 또는 범위 이탈 좌표는 안전하게 auto 모드로 폴백
      return {
        ...baseGroup,
        layoutMode: 'auto',
      };
    }

    return {
      ...baseGroup,
      layoutMode: 'auto',
    };
  }

  return { kind: 'empty' };
}

function sanitizeReceiptItemRef(raw: unknown): ReceiptItemRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const txId = typeof obj.txId === 'string' ? obj.txId.trim() : '';
  if (!txId) return null;

  if (obj.kind === 'tx') {
    return { kind: 'tx', txId };
  }
  if (obj.kind === 'segment') {
    const segmentId =
      typeof obj.segmentId === 'string' ? obj.segmentId.trim() : '';
    if (!segmentId) return null;
    return { kind: 'segment', txId, segmentId };
  }
  return null;
}

function sanitizeDensityLayout(
  raw: unknown,
  expectedDensity: ReceiptDensity
): ReceiptDensityLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.pages)) return null;

  const pages: ReceiptPageLayout[] = obj.pages
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .map((page, pageIndex) => {
      const rawSlots = Array.isArray(page.slots) ? page.slots : [];
      const normalizedSlots: ReceiptSlotRef[] = [];
      for (let i = 0; i < expectedDensity; i++) {
        normalizedSlots.push(sanitizeReceiptSlotRef(rawSlots[i]));
      }
      const pageId =
        typeof page.pageId === 'string' && page.pageId.trim()
          ? page.pageId.trim()
          : `page-${expectedDensity}-${pageIndex + 1}`;
      return {
        pageId,
        slots: normalizedSlots,
      };
    });

  const unplaced: ReceiptItemRef[] | undefined = Array.isArray(obj.unplaced)
    ? obj.unplaced
        .map(sanitizeReceiptItemRef)
        .filter((item): item is ReceiptItemRef => item !== null)
    : undefined;

  return {
    density: expectedDensity,
    pages,
    ...(unplaced && unplaced.length > 0 ? { unplaced } : {}),
    updatedAt:
      typeof obj.updatedAt === 'string' && obj.updatedAt
        ? obj.updatedAt
        : new Date().toISOString(),
  };
}

/**
 * 영수증철 월·계정 스코프 배치 엔트리를 검증·복구합니다.
 * 잘못된 자유 배치 좌표(NaN·범위 이탈)는 layoutMode: 'auto', placements: undefined로 안전 폴백합니다.
 */
export function sanitizeReceiptLayoutEntry(
  raw: unknown
): ReceiptBookLayoutEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const activeDensity = isValidDensity(obj.activeDensity)
    ? obj.activeDensity
    : undefined;

  const rawByDensity =
    obj.byDensity && typeof obj.byDensity === 'object'
      ? (obj.byDensity as Record<string, unknown>)
      : {};

  const byDensity: Partial<Record<ReceiptDensity, ReceiptDensityLayout>> = {};
  const layout2 = sanitizeDensityLayout(rawByDensity[2] ?? rawByDensity['2'], 2);
  if (layout2) byDensity[2] = layout2;

  const layout4 = sanitizeDensityLayout(rawByDensity[4] ?? rawByDensity['4'], 4);
  if (layout4) byDensity[4] = layout4;

  if (!activeDensity && !byDensity[2] && !byDensity[4]) {
    return null;
  }

  return {
    version: 1,
    ...(activeDensity ? { activeDensity } : {}),
    byDensity,
    updatedAt:
      typeof obj.updatedAt === 'string' && obj.updatedAt
        ? obj.updatedAt
        : new Date().toISOString(),
  };
}

/**
 * 전체 영수증철 배치 맵(ReceiptBookLayoutsMap)을 검증·정규화합니다.
 */
export function sanitizeReceiptLayoutsMap(
  raw: unknown
): ReceiptBookLayoutsMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: ReceiptBookLayoutsMap = {};
  for (const [scopeKey, entry] of Object.entries(
    raw as Record<string, unknown>
  )) {
    const trimmedKey = scopeKey.trim();
    if (!trimmedKey) continue;
    const sanitized = sanitizeReceiptLayoutEntry(entry);
    if (sanitized) {
      result[trimmedKey] = sanitized;
    }
  }
  return result;
}

export interface BudgetsMap {
  retreat_claim: BudgetDocument; // 레거시 호환 미러 (항상 claims[0])
  annual_budget: BudgetDocument;
  claims: BudgetDocument[]; // 한 회기 내 특별 예산(수련회·행사) 복수 청구서 목록
}

export function createBlankAnnualBudgetDocument(
  fiscalYear: number,
  departmentName = '청년부',
  authorName = '',
  authorRole = '청년부 회계',
  bankDefaults?: {
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
  }
): BudgetDocument {
  const dept = departmentName.trim() || '청년부';
  return {
    id: 'annual_budget',
    templateType: 'annual_budget',
    fiscalYear,
    title: `${fiscalYear}년도 ${dept} 연간 예산 심의안`,
    subtitle: '',
    department: dept,
    eventName: `${fiscalYear}년 연간 사역 예산`,
    eventPeriod: `${fiscalYear}년 1월 1일 ~ ${fiscalYear}년 12월 31일`,
    eventLocation: '',
    participants: '',
    proposerName: authorName.trim(),
    proposerRole: authorRole.trim() || '청년부 회계',
    requestDate: `${fiscalYear}-01-01`,
    selfBurdenAmount: 0,
    selfBurdenNote: '',
    bankName: bankDefaults?.bankName || '',
    accountNumber: bankDefaults?.accountNumber || '',
    accountHolder: bankDefaults?.accountHolder || '',
    purposeNote: `위와 같이 ${fiscalYear}년도 ${dept} 연간 사역 예산안을 편성하여 제출하오니 심의 및 승인하여 주시기 바랍니다.`,
    items: [],
  };
}

export function createBlankClaimDocument(
  fiscalYear: number,
  departmentName = '청년부',
  authorName = '',
  authorRole = '청년부 회계',
  options?: {
    id?: string;
    title?: string;
    requestDate?: string;
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
  }
): BudgetDocument {
  const dept = departmentName.trim() || '청년부';
  const id =
    options?.id ||
    `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultRequestDate = todayIso.startsWith(`${fiscalYear}-`)
    ? todayIso
    : `${fiscalYear}-01-01`;
  return {
    id,
    templateType: 'retreat_claim',
    fiscalYear,
    title: options?.title || `${fiscalYear}년 ${dept} 특별 예산 청구서`,
    subtitle: '',
    department: dept,
    eventName: '',
    eventPeriod: '',
    eventLocation: '',
    participants: '',
    proposerName: authorName.trim(),
    proposerRole: authorRole.trim() || '청년부 회계',
    requestDate: options?.requestDate || defaultRequestDate,
    selfBurdenAmount: 0,
    selfBurdenNote: '',
    bankName: options?.bankName || '',
    accountNumber: options?.accountNumber || '',
    accountHolder: options?.accountHolder || '',
    purposeNote: `위와 같이 ${fiscalYear}년도 ${dept} 특별 사역 진행을 위한 예산을 산출하여 청구하오니 재가하여 주시기 바랍니다.`,
    items: [],
  };
}

/**
 * 구버전(retreat_claim 단일) 및 신버전(claims[] 복수) BudgetsMap을
 * 일관된 구조로 정규화합니다. 항상 claims.length >= 1 및 retreat_claim === claims[0]을 보장합니다.
 */
export function normalizeBudgetsMap(
  raw?: Partial<BudgetsMap> | null,
  fiscalYear = DEFAULT_FISCAL_YEAR,
  fallbackAnnual?: BudgetDocument,
  fallbackClaim?: BudgetDocument
): BudgetsMap {
  const annualBase = raw?.annual_budget || fallbackAnnual || INITIAL_ANNUAL_BUDGET;
  const annual_budget: BudgetDocument = {
    ...annualBase,
    id: 'annual_budget',
    templateType: 'annual_budget',
    fiscalYear: annualBase.fiscalYear || fiscalYear,
    items: Array.isArray(annualBase.items) ? annualBase.items : [],
  };

  let rawClaims: BudgetDocument[] = [];
  if (Array.isArray(raw?.claims) && raw.claims.length > 0) {
    rawClaims = raw.claims;
  } else if (raw?.retreat_claim) {
    rawClaims = [raw.retreat_claim];
  } else if (fallbackClaim) {
    rawClaims = [fallbackClaim];
  } else {
    rawClaims = [INITIAL_RETREAT_BUDGET];
  }

  const seenIds = new Set<string>();
  const claims: BudgetDocument[] = rawClaims.map((c, idx) => {
    let cid = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `claim-${idx + 1}`;
    while (seenIds.has(cid)) {
      cid = `${cid}-${idx + 1}`;
    }
    seenIds.add(cid);
    return {
      ...c,
      id: cid,
      templateType: 'retreat_claim',
      fiscalYear: c.fiscalYear || fiscalYear,
      items: Array.isArray(c.items) ? c.items : [],
    };
  });

  return {
    annual_budget,
    retreat_claim: claims[0],
    claims,
  };
}

/**
 * 특정 회계연도 전체 거래에서 통장 계정별 기말 잔액(일반/수련회/목적헌금/합계)을 계산합니다.
 * 새 회계연도 개시 시 전기이월금 자동 산출에 사용합니다.
 */
export function computeYearEndBalancesByAccount(
  transactions: Transaction[]
): AccountBalancesSummary {
  let general = 0;
  let retreat = 0;
  let mission = 0;
  for (const tx of transactions) {
    const signed = tx.type === 'income' ? Number(tx.amount) || 0 : -(Number(tx.amount) || 0);
    if (tx.account === 'retreat') {
      retreat += signed;
    } else if (tx.account === 'mission') {
      mission += signed;
    } else {
      general += signed;
    }
  }
  return {
    general,
    retreat,
    mission,
    total: general + retreat + mission,
  };
}

export interface SubCategoryBudgetAllocation {
  subCategory: string;
  annualBudget: number;
  monthlyBudget: number;
  detailNames: string[];
}

export interface CategoryBudgetAllocation {
  category: string;
  annualBudget: number;
  monthlyBudget: number;
  itemNames: string[];
  subAllocations: Record<string, SubCategoryBudgetAllocation>;
}

export interface DynamicFiscalSchema {
  activeIncomeCategories: string[];
  activeExpenseCategories: string[];
  categoryAllocations: Record<string, CategoryBudgetAllocation>;
}

export interface MokjangSpendStat {
  mokjang: MokjangGroup;
  visitationSpent: number;
  visitationRemaining: number;
  visitationRate: number;
  fellowshipSpent: number;
  fellowshipRemaining: number;
  fellowshipRate: number;
  totalBudget: number;
  totalSpent: number;
  totalRemaining: number;
  totalRate: number;
  transactions: ProcessedTransaction[];
}

const LEGACY_SAMPLE_DEPARTMENT_NAME = '은혜교회 청년부';

function replaceExactSubstring(
  text: string,
  candidates: string[],
  replacement: string
): string {
  let result = text;
  for (const oldVal of candidates) {
    if (oldVal && result.includes(oldVal)) {
      result = result.split(oldVal).join(replacement);
    }
  }
  return result;
}

/**
 * 단일 예산안/청구서 문서의 부서명·제목·장소·예금주·작성자를
 * 전역 기본 정보(settings.departmentName / authorName)와 일관되게 동기화합니다.
 * 사용자가 문서별로 의도적으로 지정한 별도 부서명은 덮어쓰지 않습니다.
 */
export function syncBudgetDocumentWithDepartment(
  doc: BudgetDocument,
  nextDeptName: string,
  prevDeptName?: string,
  nextAuthorName?: string,
  prevAuthorName?: string
): { doc: BudgetDocument; changed: boolean } {
  const cleanNextDept = nextDeptName.trim();
  const cleanPrevDept = prevDeptName?.trim() || '';
  const cleanNextAuthor = nextAuthorName?.trim() || '';
  const cleanPrevAuthor = prevAuthorName?.trim() || '';

  const deptCandidates: string[] = [];
  if (cleanPrevDept && cleanPrevDept !== cleanNextDept) {
    deptCandidates.push(cleanPrevDept);
  }
  if (
    cleanNextDept &&
    cleanNextDept !== LEGACY_SAMPLE_DEPARTMENT_NAME &&
    !deptCandidates.includes(LEGACY_SAMPLE_DEPARTMENT_NAME)
  ) {
    deptCandidates.push(LEGACY_SAMPLE_DEPARTMENT_NAME);
  }

  let changed = false;
  let nextDoc = doc;

  if (cleanNextDept) {
    const curDept = (doc.department || '').trim();
    const shouldUpdateDept =
      !curDept || deptCandidates.includes(curDept);
    const nextDepartment = shouldUpdateDept ? cleanNextDept : doc.department;
    const nextTitle = replaceExactSubstring(
      doc.title || '',
      deptCandidates,
      cleanNextDept
    );
    const nextLocation = replaceExactSubstring(
      doc.eventLocation || '',
      deptCandidates,
      cleanNextDept
    );
    const nextAccountHolder = replaceExactSubstring(
      doc.accountHolder || '',
      deptCandidates,
      cleanNextDept
    );

    if (
      nextDepartment !== doc.department ||
      nextTitle !== doc.title ||
      nextLocation !== doc.eventLocation ||
      nextAccountHolder !== doc.accountHolder
    ) {
      changed = true;
      nextDoc = {
        ...nextDoc,
        department: nextDepartment,
        title: nextTitle,
        eventLocation: nextLocation,
        accountHolder: nextAccountHolder,
      };
    }
  }

  if (cleanNextAuthor) {
    const curProposer = (nextDoc.proposerName || '').trim();
    if (
      !curProposer ||
      (cleanPrevAuthor && curProposer === cleanPrevAuthor)
    ) {
      if (nextDoc.proposerName !== cleanNextAuthor) {
        changed = true;
        nextDoc = {
          ...nextDoc,
          proposerName: cleanNextAuthor,
        };
      }
    }
  }

  return { doc: nextDoc, changed };
}

/**
 * 연간 예산안 · 복수 특별예산 청구서 전체를 전역 부서명(SSOT)과 동기화합니다.
 */
export function syncBudgetsWithDepartment(
  budgets: BudgetsMap,
  nextDeptName: string,
  prevDeptName?: string,
  nextAuthorName?: string,
  prevAuthorName?: string
): { budgets: BudgetsMap; changed: boolean } {
  const normalized = normalizeBudgetsMap(budgets);
  const annual = syncBudgetDocumentWithDepartment(
    normalized.annual_budget,
    nextDeptName,
    prevDeptName,
    nextAuthorName,
    prevAuthorName
  );
  let claimsChanged = false;
  const syncedClaims = normalized.claims.map((claimDoc) => {
    const res = syncBudgetDocumentWithDepartment(
      claimDoc,
      nextDeptName,
      prevDeptName,
      nextAuthorName,
      prevAuthorName
    );
    if (res.changed) claimsChanged = true;
    return res.doc;
  });

  if (!annual.changed && !claimsChanged) {
    return { budgets: normalized, changed: false };
  }

  return {
    budgets: {
      annual_budget: annual.doc,
      retreat_claim: syncedClaims[0],
      claims: syncedClaims,
    },
    changed: true,
  };
}

let legacyMigrationChecked = false;

/**
 * 기존 단일 연도(v2) 로컬 스토리지 데이터를 회계연도 네임스페이스(fy_YYYY)로
 * 단 1회 무손실 자동 이관합니다. 기존 v2 키는 삭제하지 않고 안전 백업으로 보존합니다.
 */
function ensureLegacyMigratedToFiscalYear(): void {
  if (legacyMigrationChecked || typeof localStorage === 'undefined') return;
  legacyMigrationChecked = true;

  try {
    if (localStorage.getItem(STORAGE_KEYS.FY_MIGRATED_FLAG) === '1') {
      return;
    }

    const legacyTxRaw = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    const legacyBudgetsRaw = localStorage.getItem(STORAGE_KEYS.BUDGETS);
    const legacyMokjangsRaw = localStorage.getItem(STORAGE_KEYS.MOKJANGS);
    const legacyLayoutsRaw = localStorage.getItem(STORAGE_KEYS.RECEIPT_LAYOUTS);
    const legacySettingsRaw = localStorage.getItem(STORAGE_KEYS.SETTINGS);

    const hasLegacy = Boolean(
      legacyTxRaw || legacyBudgetsRaw || legacyMokjangsRaw || legacyLayoutsRaw
    );

    let detectedYear = DEFAULT_FISCAL_YEAR;
    if (legacyBudgetsRaw) {
      try {
        const parsedBudgets = JSON.parse(legacyBudgetsRaw);
        const fy = Number(parsedBudgets?.annual_budget?.fiscalYear);
        if (isValidFiscalYear(fy)) detectedYear = fy;
      } catch {
        // ignore
      }
    }

    if (hasLegacy) {
      if (
        legacyTxRaw &&
        !localStorage.getItem(fyStorageKey('transactions', detectedYear))
      ) {
        localStorage.setItem(
          fyStorageKey('transactions', detectedYear),
          legacyTxRaw
        );
      }
      if (
        legacyBudgetsRaw &&
        !localStorage.getItem(fyStorageKey('budgets', detectedYear))
      ) {
        try {
          const normalized = normalizeBudgetsMap(
            JSON.parse(legacyBudgetsRaw),
            detectedYear
          );
          localStorage.setItem(
            fyStorageKey('budgets', detectedYear),
            JSON.stringify(normalized)
          );
        } catch {
          localStorage.setItem(
            fyStorageKey('budgets', detectedYear),
            legacyBudgetsRaw
          );
        }
      }
      if (
        legacyMokjangsRaw &&
        !localStorage.getItem(fyStorageKey('mokjangs', detectedYear))
      ) {
        localStorage.setItem(
          fyStorageKey('mokjangs', detectedYear),
          legacyMokjangsRaw
        );
      }
      if (
        legacyLayoutsRaw &&
        !localStorage.getItem(fyStorageKey('receipt_layouts', detectedYear))
      ) {
        localStorage.setItem(
          fyStorageKey('receipt_layouts', detectedYear),
          legacyLayoutsRaw
        );
      }
    }

    // 기존 settings.googleSpreadsheetId를 fiscalYearWorkspaces[detectedYear]로 자동 이관
    if (legacySettingsRaw) {
      try {
        const parsedSettings = JSON.parse(legacySettingsRaw) as AppSettings;
        const fyKey = String(detectedYear);
        const existingMap = parsedSettings.fiscalYearWorkspaces || {};
        if (parsedSettings.googleSpreadsheetId && !existingMap[fyKey]) {
          const ref: FiscalYearCloudRef = {
            spreadsheetId: parsedSettings.googleSpreadsheetId,
            spreadsheetUrl: parsedSettings.googleSpreadsheetUrl || '',
            receiptFolderId: parsedSettings.googleReceiptFolderId || '',
            receiptFolderUrl: parsedSettings.googleReceiptFolderUrl || '',
            lastSyncedAt: parsedSettings.lastSyncedAt,
            lastCloudModifiedTime: parsedSettings.lastCloudModifiedTime,
          };
          parsedSettings.fiscalYearWorkspaces = {
            ...existingMap,
            [fyKey]: ref,
          };
          localStorage.setItem(
            STORAGE_KEYS.SETTINGS,
            JSON.stringify(parsedSettings)
          );
        }
      } catch {
        // ignore
      }
    }

    if (!localStorage.getItem(STORAGE_KEYS.ACTIVE_FISCAL_YEAR)) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_FISCAL_YEAR, String(detectedYear));
    }
    if (!localStorage.getItem(STORAGE_KEYS.KNOWN_FISCAL_YEARS)) {
      localStorage.setItem(
        STORAGE_KEYS.KNOWN_FISCAL_YEARS,
        JSON.stringify([detectedYear])
      );
    }
    localStorage.setItem(STORAGE_KEYS.FY_MIGRATED_FLAG, '1');
  } catch (e) {
    console.error('회계연도 마이그레이션 중 오류:', e);
  }
}

export const SyncManager = {
  loadActiveFiscalYear(): number {
    ensureLegacyMigratedToFiscalYear();
    try {
      const raw = Number(localStorage.getItem(STORAGE_KEYS.ACTIVE_FISCAL_YEAR));
      return isValidFiscalYear(raw) ? raw : DEFAULT_FISCAL_YEAR;
    } catch {
      return DEFAULT_FISCAL_YEAR;
    }
  },

  saveActiveFiscalYear(fiscalYear: number): void {
    if (!isValidFiscalYear(fiscalYear)) return;
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_FISCAL_YEAR, String(fiscalYear));
      this.registerFiscalYear(fiscalYear);
    } catch {
      // ignore
    }
  },

  loadKnownFiscalYears(): number[] {
    ensureLegacyMigratedToFiscalYear();
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.KNOWN_FISCAL_YEARS);
      const parsed = raw ? JSON.parse(raw) : [];
      const active = this.loadActiveFiscalYear();
      const years = new Set<number>([active]);
      if (Array.isArray(parsed)) {
        for (const y of parsed) {
          const num = Number(y);
          if (isValidFiscalYear(num)) years.add(num);
        }
      }
      return Array.from(years).sort((a, b) => a - b);
    } catch {
      return [DEFAULT_FISCAL_YEAR];
    }
  },

  registerFiscalYear(fiscalYear: number): number[] {
    if (!isValidFiscalYear(fiscalYear)) return this.loadKnownFiscalYears();
    const current = this.loadKnownFiscalYears();
    if (!current.includes(fiscalYear)) {
      const next = [...current, fiscalYear].sort((a, b) => a - b);
      try {
        localStorage.setItem(
          STORAGE_KEYS.KNOWN_FISCAL_YEARS,
          JSON.stringify(next)
        );
      } catch {
        // ignore
      }
      return next;
    }
    return current;
  },

  hasLocalFiscalYearData(fiscalYear: number): boolean {
    ensureLegacyMigratedToFiscalYear();
    try {
      return Boolean(
        localStorage.getItem(fyStorageKey('transactions', fiscalYear)) ||
          localStorage.getItem(fyStorageKey('budgets', fiscalYear)) ||
          localStorage.getItem(fyStorageKey('mokjangs', fiscalYear))
      );
    } catch {
      return false;
    }
  },

  loadTransactions(fiscalYear?: number): Transaction[] {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    const key = fyStorageKey('transactions', resolvedYear);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        const settings = this.loadSettings();
        // 최초 샘플 모드의 기본 연도(2026)에만 샘플 거래 시딩, 새 회기는 빈 장부로 시작
        if (resolvedYear === DEFAULT_FISCAL_YEAR && !settings.isProductionMode) {
          localStorage.setItem(key, JSON.stringify(INITIAL_TRANSACTIONS));
          return INITIAL_TRANSACTIONS;
        }
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveTransactions(
    transactions: Transaction[],
    fiscalYear?: number
  ): boolean {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    try {
      localStorage.setItem(
        fyStorageKey('transactions', resolvedYear),
        JSON.stringify(transactions)
      );
      this.registerFiscalYear(resolvedYear);
      return true;
    } catch (e) {
      console.error('LocalStorage 거래 저장 실패:', e);
      return false;
    }
  },

  loadBudgets(fiscalYear?: number): BudgetsMap {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    const key = fyStorageKey('budgets', resolvedYear);
    const settings = this.loadSettings();
    const blankAnnual = createBlankAnnualBudgetDocument(
      resolvedYear,
      settings.departmentName,
      settings.authorName,
      settings.authorRole
    );
    const blankClaim = createBlankClaimDocument(
      resolvedYear,
      settings.departmentName,
      settings.authorName,
      settings.authorRole,
      { id: 'claim-1' }
    );
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        const useSample =
          resolvedYear === DEFAULT_FISCAL_YEAR && !settings.isProductionMode;
        const initial = normalizeBudgetsMap(
          useSample
            ? {
                annual_budget: INITIAL_ANNUAL_BUDGET,
                retreat_claim: INITIAL_RETREAT_BUDGET,
                claims: [INITIAL_RETREAT_BUDGET],
              }
            : {
                annual_budget: blankAnnual,
                retreat_claim: blankClaim,
                claims: [blankClaim],
              },
          resolvedYear,
          blankAnnual,
          blankClaim
        );
        localStorage.setItem(key, JSON.stringify(initial));
        return initial;
      }
      const parsed = JSON.parse(raw);
      return normalizeBudgetsMap(parsed, resolvedYear, blankAnnual, blankClaim);
    } catch {
      return normalizeBudgetsMap(null, resolvedYear, blankAnnual, blankClaim);
    }
  },

  saveBudgets(
    budgets: BudgetsMap,
    fiscalYear?: number
  ): void {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    try {
      const normalized = normalizeBudgetsMap(budgets, resolvedYear);
      localStorage.setItem(
        fyStorageKey('budgets', resolvedYear),
        JSON.stringify(normalized)
      );
      this.registerFiscalYear(resolvedYear);
    } catch (e) {
      console.error('LocalStorage 예산 저장 실패:', e);
    }
  },

  loadMokjangs(fiscalYear?: number): MokjangGroup[] {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    const key = fyStorageKey('mokjangs', resolvedYear);
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) {
        const settings = this.loadSettings();
        if (resolvedYear === DEFAULT_FISCAL_YEAR && !settings.isProductionMode) {
          localStorage.setItem(key, JSON.stringify(INITIAL_MOKJANG_GROUPS));
          return INITIAL_MOKJANG_GROUPS;
        }
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveMokjangs(
    mokjangs: MokjangGroup[],
    fiscalYear?: number
  ): void {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    try {
      localStorage.setItem(
        fyStorageKey('mokjangs', resolvedYear),
        JSON.stringify(mokjangs)
      );
      this.registerFiscalYear(resolvedYear);
    } catch (e) {
      console.error('LocalStorage 목장 저장 실패:', e);
    }
  },

  loadSettings(): AppSettings {
    ensureLegacyMigratedToFiscalYear();
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!raw) {
        localStorage.setItem(
          STORAGE_KEYS.SETTINGS,
          JSON.stringify(DEFAULT_SETTINGS)
        );
        return DEFAULT_SETTINGS;
      }
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        fiscalYearWorkspaces: parsed.fiscalYearWorkspaces || {},
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AppSettings): void {
    ensureLegacyMigratedToFiscalYear();
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error('LocalStorage 설정 저장 실패:', e);
    }
  },

  sanitizeReceiptLayoutEntry(raw: unknown): ReceiptBookLayoutEntry | null {
    return sanitizeReceiptLayoutEntry(raw);
  },

  loadReceiptLayouts(
    fiscalYear?: number
  ): ReceiptBookLayoutsMap {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    try {
      const raw = localStorage.getItem(
        fyStorageKey('receipt_layouts', resolvedYear)
      );
      if (!raw) return {};
      return sanitizeReceiptLayoutsMap(JSON.parse(raw));
    } catch {
      return {};
    }
  },

  saveReceiptLayouts(
    layouts: ReceiptBookLayoutsMap,
    fiscalYear?: number
  ): boolean {
    ensureLegacyMigratedToFiscalYear();
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    try {
      const sanitized = sanitizeReceiptLayoutsMap(layouts);
      localStorage.setItem(
        fyStorageKey('receipt_layouts', resolvedYear),
        JSON.stringify(sanitized)
      );
      this.registerFiscalYear(resolvedYear);
      return true;
    } catch (e) {
      console.error('LocalStorage 영수증철 배치 저장 실패:', e);
      return false;
    }
  },

  /**
   * 새 회계연도(1월~12월) 워크스페이스를 생성합니다.
   * - 직전 회기 계정별 기말 잔액을 YYYY-01-01 '전월이월(연초 이월금)'으로 자동 이월
   * - 목장 편성 및 연간 예산안 구조 선택 승계
   * - 기존 회계연도 데이터는 일절 변경하지 않고 격리 보존
   */
  createFiscalYearWorkspace(args: {
    targetYear: number;
    carryoverByAccount: { general: number; retreat: number; mission: number };
    copyMokjangsFrom?: MokjangGroup[];
    copyAnnualBudgetFrom?: BudgetDocument;
    settings: AppSettings;
  }): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    receiptLayouts: ReceiptBookLayoutsMap;
  } {
    const {
      targetYear,
      carryoverByAccount,
      copyMokjangsFrom,
      copyAnnualBudgetFrom,
      settings,
    } = args;
    const nowIso = new Date().toISOString();
    const startDate = `${targetYear}-01-01`;

    const accountSeeds: Array<{
      account: 'general' | 'retreat' | 'mission';
      label: string;
      amount: number;
    }> = [
      {
        account: 'general',
        label: '일반회계 전기이월',
        amount: Math.max(0, Math.round(carryoverByAccount.general || 0)),
      },
      {
        account: 'retreat',
        label: '수련회·행사비 전기이월',
        amount: Math.max(0, Math.round(carryoverByAccount.retreat || 0)),
      },
      {
        account: 'mission',
        label: '목적헌금·선교 전기이월',
        amount: Math.max(0, Math.round(carryoverByAccount.mission || 0)),
      },
    ];

    const transactions: Transaction[] = accountSeeds
      .filter((seed) => seed.amount > 0)
      .map((seed, idx) => ({
        id: `tx-carryover-${targetYear}-${seed.account}-${Date.now() + idx}`,
        date: startDate,
        type: 'income',
        account: seed.account,
        category: '전월이월',
        subCategory: '연초 이월금',
        title: `${targetYear - 1}년 기말잔액 이월 (${seed.label})`,
        memo: `${targetYear - 1}회기 마감 잔액 자동 승계`,
        amount: seed.amount,
        paymentMethod: '계좌이체',
        createdAt: nowIso,
      }));

    const bankDefaults = copyAnnualBudgetFrom
      ? {
          bankName: copyAnnualBudgetFrom.bankName,
          accountNumber: copyAnnualBudgetFrom.accountNumber,
          accountHolder: copyAnnualBudgetFrom.accountHolder,
        }
      : undefined;

    const baseAnnual = createBlankAnnualBudgetDocument(
      targetYear,
      settings.departmentName,
      settings.authorName,
      settings.authorRole,
      bankDefaults
    );

    const annualBudget: BudgetDocument = copyAnnualBudgetFrom
      ? {
          ...baseAnnual,
          items: copyAnnualBudgetFrom.items.map((item, idx) => ({
            ...item,
            id: `ab-${targetYear}-${idx + 1}-${Math.random().toString(36).slice(2, 5)}`,
          })),
        }
      : baseAnnual;

    const initialClaim = createBlankClaimDocument(
      targetYear,
      settings.departmentName,
      settings.authorName,
      settings.authorRole,
      {
        id: 'claim-1',
        requestDate: startDate,
        ...bankDefaults,
      }
    );

    const budgets: BudgetsMap = {
      annual_budget: annualBudget,
      retreat_claim: initialClaim,
      claims: [initialClaim],
    };

    const mokjangs: MokjangGroup[] = copyMokjangsFrom
      ? copyMokjangsFrom.map((m) => ({ ...m }))
      : [];

    const receiptLayouts: ReceiptBookLayoutsMap = {};

    this.saveTransactions(transactions, targetYear);
    this.saveBudgets(budgets, targetYear);
    this.saveMokjangs(mokjangs, targetYear);
    this.saveReceiptLayouts(receiptLayouts, targetYear);
    this.saveActiveFiscalYear(targetYear);

    return {
      transactions,
      budgets,
      mokjangs,
      receiptLayouts,
    };
  },

  resetToSampleData(fiscalYear?: number): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
    receiptLayouts: ReceiptBookLayoutsMap;
  } {
    const resolvedYear = fiscalYear ?? this.loadActiveFiscalYear();
    const nextSettings: AppSettings = {
      ...this.loadSettings(),
      isProductionMode: false,
    };
    const { budgets } = syncBudgetsWithDepartment(
      {
        retreat_claim: { ...INITIAL_RETREAT_BUDGET, fiscalYear: resolvedYear },
        annual_budget: { ...INITIAL_ANNUAL_BUDGET, fiscalYear: resolvedYear },
        claims: [{ ...INITIAL_RETREAT_BUDGET, id: 'claim-1', fiscalYear: resolvedYear }],
      },
      nextSettings.departmentName,
      undefined,
      nextSettings.authorName
    );
    const emptyLayouts: ReceiptBookLayoutsMap = {};
    this.saveTransactions(INITIAL_TRANSACTIONS, resolvedYear);
    this.saveBudgets(budgets, resolvedYear);
    this.saveMokjangs(INITIAL_MOKJANG_GROUPS, resolvedYear);
    this.saveSettings(nextSettings);
    this.saveReceiptLayouts(emptyLayouts, resolvedYear);
    return {
      transactions: INITIAL_TRANSACTIONS,
      budgets,
      mokjangs: INITIAL_MOKJANG_GROUPS,
      settings: nextSettings,
      receiptLayouts: emptyLayouts,
    };
  },

  /**
   * 현재 선택된 회계연도의 모든 탭 데이터(장부·영수증·목장·연간예산안·청구서·커스텀 분류·영수증철 배치)를
   * 일괄 초기화하여 깨끗한 실사용 상태로 전환합니다. (타 회계연도 데이터는 보존)
   */
  resetAllDataClean(
    yearMonth: string,
    initialCarryoverAmount = 0,
    keepConnections = true,
    fiscalYear?: number
  ): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
    receiptLayouts: ReceiptBookLayoutsMap;
  } {
    const resolvedYear =
      fiscalYear ??
      (Number(yearMonth.slice(0, 4)) || this.loadActiveFiscalYear());
    const prevSettings = this.loadSettings();
    const prevBudgets = this.loadBudgets(resolvedYear);

    const cleanTransactions: Transaction[] =
      initialCarryoverAmount > 0
        ? [
            {
              id: `tx-carryover-${Date.now()}`,
              date: `${yearMonth}-01`,
              type: 'income',
              account: 'general',
              category: '전월이월',
              subCategory: '전월 이월금',
              title: '전월 이월금 (시작 잔액)',
              memo: `${yearMonth} 회계 장부 개시 이월금`,
              amount: initialCarryoverAmount,
              paymentMethod: '계좌이체',
              createdAt: new Date().toISOString(),
            },
          ]
        : [];

    const nextSettings: AppSettings = keepConnections
      ? {
          ...prevSettings,
          customExpenseCategories: [],
          customIncomeCategories: [],
          isProductionMode: true,
        }
      : {
          ...DEFAULT_SETTINGS,
          customExpenseCategories: [],
          customIncomeCategories: [],
          isProductionMode: true,
        };

    const deptName = nextSettings.departmentName || '청년부';
    const authorName = nextSettings.authorName || '';
    const authorRole = nextSettings.authorRole || '청년부 회계';

    const annualBank = keepConnections
      ? {
          bankName: prevBudgets.annual_budget.bankName,
          accountNumber: prevBudgets.annual_budget.accountNumber,
          accountHolder: prevBudgets.annual_budget.accountHolder,
        }
      : undefined;
    const claimBank = keepConnections
      ? {
          bankName: prevBudgets.retreat_claim.bankName,
          accountNumber: prevBudgets.retreat_claim.accountNumber,
          accountHolder: prevBudgets.retreat_claim.accountHolder,
        }
      : undefined;

    const cleanAnnual = {
      ...createBlankAnnualBudgetDocument(
        resolvedYear,
        deptName,
        authorName,
        authorRole,
        annualBank
      ),
      requestDate: `${yearMonth}-01`,
    };
    const cleanClaim = createBlankClaimDocument(
      resolvedYear,
      deptName,
      authorName,
      authorRole,
      {
        id: 'claim-1',
        title: `${resolvedYear}년 ${deptName} 수련회·행사 재정 청구서`,
        requestDate: `${yearMonth}-01`,
        ...claimBank,
      }
    );

    const cleanBudgets: BudgetsMap = {
      annual_budget: cleanAnnual,
      retreat_claim: cleanClaim,
      claims: [cleanClaim],
    };

    const cleanMokjangs: MokjangGroup[] = [];
    const emptyLayouts: ReceiptBookLayoutsMap = {};

    this.saveTransactions(cleanTransactions, resolvedYear);
    this.saveBudgets(cleanBudgets, resolvedYear);
    this.saveMokjangs(cleanMokjangs, resolvedYear);
    this.saveSettings(nextSettings);
    this.saveReceiptLayouts(emptyLayouts, resolvedYear);

    return {
      transactions: cleanTransactions,
      budgets: cleanBudgets,
      mokjangs: cleanMokjangs,
      settings: nextSettings,
      receiptLayouts: emptyLayouts,
    };
  },

  startCleanProductionLedger(
    yearMonth: string,
    initialCarryoverAmount = 0,
    fiscalYear?: number
  ): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
    receiptLayouts: ReceiptBookLayoutsMap;
  } {
    const resolvedYear =
      fiscalYear ??
      (Number(yearMonth.slice(0, 4)) || this.loadActiveFiscalYear());
    return this.resetAllDataClean(
      yearMonth,
      initialCarryoverAmount,
      true,
      resolvedYear
    );
  },

  async pushTransactionToGas(
    webAppUrl: string,
    tx: ProcessedTransaction | Transaction
  ): Promise<{
    ok: boolean;
    receiptImage?: string;
    receiptDriveUrl?: string;
    syncedAt?: string;
  }> {
    if (!webAppUrl.trim()) return { ok: false };
    const response = await fetch(webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'UPSERT_TRANSACTION',
        transaction: tx,
      }),
    });
    return await response.json();
  },

  async deleteTransactionFromGas(
    webAppUrl: string,
    id: string
  ): Promise<{ ok: boolean }> {
    if (!webAppUrl.trim()) return { ok: false };
    const response = await fetch(webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'DELETE_TRANSACTION',
        id,
      }),
    });
    return await response.json();
  },

  async pushAllToGas(
    webAppUrl: string,
    payload: {
      transactions: ProcessedTransaction[];
      budgets: Record<BudgetTemplateType, BudgetDocument>;
      mokjangs?: MokjangGroup[];
      settings: AppSettings;
      receiptLayouts?: ReceiptBookLayoutsMap;
    }
  ): Promise<{ ok: boolean; syncedAt?: string; error?: string }> {
    const safeSettings = {
      ...payload.settings,
      geminiApiKey: '', // API 키는 기기 로컬에만 보관하고 외부 시트에는 업로드하지 않음
    };
    const response = await fetch(webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'SYNC_ALL',
        ...payload,
        settings: safeSettings,
      }),
    });
    return await response.json();
  },

  async fetchAllFromGas(webAppUrl: string): Promise<{
    ok: boolean;
    transactions?: Transaction[];
    budgets?: Partial<BudgetsMap>;
    mokjangs?: MokjangGroup[];
    settings?: Partial<AppSettings>;
    receiptLayouts?: ReceiptBookLayoutsMap;
    serverTime?: string;
    error?: string;
  }> {
    const response = await fetch(webAppUrl.trim(), {
      method: 'GET',
    });
    const data = await response.json();
    if (data && data.receiptLayouts) {
      data.receiptLayouts = sanitizeReceiptLayoutsMap(data.receiptLayouts);
    }
    return data;
  },

  exportTransactionsCsv(
    transactions: ProcessedTransaction[],
    yearMonth: string,
    mokjangs: MokjangGroup[] = []
  ): void {
    const mokjangMap = new Map(mokjangs.map((m) => [m.id, m.name]));

    const headers = [
      '일자',
      '구분',
      '회계계정',
      '관/항(1차 사역·수입원)',
      '세목(2차 분류)',
      '3차분류(세부목)',
      '귀속목장',
      '목장지출구분',
      '적요(내역명)',
      '산출근거/메모',
      '수입금액',
      '지출금액',
      '거래후잔액',
      '결제수단',
      '증빙번호',
      '영수증첨부여부',
    ];

    const accountMap: Record<string, string> = {
      general: '일반회계(운영비)',
      retreat: '수련회·행사비',
      mission: '목적헌금·선교',
    };

    const escapeCsv = (val: string | number) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = transactions.map((tx) => [
      tx.date,
      tx.type === 'income' ? '수입' : '지출',
      accountMap[tx.account] || tx.account,
      tx.category,
      tx.subCategory || '-',
      tx.detailCategory || '-',
      tx.mokjangId ? mokjangMap.get(tx.mokjangId) || tx.mokjangId : '-',
      tx.mokjangSubType ? MOKJANG_SUBTYPE_LABELS[tx.mokjangSubType] : '-',
      tx.title,
      tx.memo,
      tx.type === 'income' ? tx.amount : 0,
      tx.type === 'expense' ? tx.amount : 0,
      tx.runningBalance,
      tx.paymentMethod,
      tx.evidenceNo || '-',
      tx.receiptImage ? '첨부됨' : tx.type === 'expense' ? '미첨부' : '-',
    ]);

    const csvContent =
      '\uFEFF' +
      [
        headers.map(escapeCsv).join(','),
        ...rows.map((r) => r.map(escapeCsv).join(',')),
      ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `청년부_회계장부_${yearMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  exportBackupJson(data: {
    fiscalYear?: number;
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
    receiptLayouts?: ReceiptBookLayoutsMap;
  }): void {
    const fiscalYear = data.fiscalYear || this.loadActiveFiscalYear();
    const normalizedBudgets = normalizeBudgetsMap(data.budgets, fiscalYear);
    const safeSettings: AppSettings = {
      ...data.settings,
      geminiApiKey: '', // 개인 API 키는 백업 파일 유출 방지를 위해 제외
    };
    const sanitizedLayouts = sanitizeReceiptLayoutsMap(data.receiptLayouts);
    const claimItemTotal = normalizedBudgets.claims.reduce(
      (sum, doc) => sum + doc.items.length,
      0
    );
    const jsonStr = JSON.stringify(
      {
        version: BACKUP_SCHEMA_VERSION,
        fiscalYear,
        exportedAt: new Date().toISOString(),
        summary: {
          fiscalYear,
          transactionCount: data.transactions.length,
          mokjangCount: data.mokjangs.length,
          annualBudgetItemCount: normalizedBudgets.annual_budget.items.length,
          claimDocumentCount: normalizedBudgets.claims.length,
          retreatBudgetItemCount: claimItemTotal,
          receiptLayoutScopeCount: Object.keys(sanitizedLayouts).length,
        },
        transactions: data.transactions,
        budgets: normalizedBudgets,
        mokjangs: data.mokjangs,
        settings: safeSettings,
        receiptLayouts: sanitizedLayouts,
      },
      null,
      2
    );
    const blob = new Blob([jsonStr], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateTag = new Date().toISOString().slice(0, 10);
    link.download = `청년부_회계_${fiscalYear}년_전체백업_${dateTag}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  parseAndValidateBackupJson(rawText: string):
    | {
        ok: true;
        fiscalYear?: number;
        transactions: Transaction[];
        budgets: Partial<BudgetsMap>;
        mokjangs: MokjangGroup[] | null;
        settings: Partial<AppSettings> | null;
        receiptLayouts?: ReceiptBookLayoutsMap;
      }
    | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: '올바른 JSON 백업 파일 형식이 아닙니다.' };
      }

      const hasAnySection =
        Array.isArray(parsed.transactions) ||
        Boolean(parsed.budgets) ||
        Array.isArray(parsed.mokjangs) ||
        Boolean(parsed.settings) ||
        Boolean(parsed.receiptLayouts);

      if (!hasAnySection) {
        return {
          ok: false,
          error: '장부·예산안·목장 데이터가 포함되지 않은 파일입니다.',
        };
      }

      // 거래 내역 내 분할 설정/메타데이터 정합성 보정 (구버전 v3.0 호환)
      const transactions: Transaction[] = Array.isArray(parsed.transactions)
        ? parsed.transactions.map((rawTx: Transaction) => {
            if (!rawTx || typeof rawTx !== 'object') return rawTx;
            const receiptEdit = rawTx.receiptEdit
              ? sanitizeReceiptEditConfig(rawTx.receiptEdit)
              : undefined;
            const receiptMeta = rawTx.receiptMeta
              ? sanitizeReceiptMetadata(rawTx.receiptMeta)
              : undefined;
            return {
              ...rawTx,
              ...(receiptEdit ? { receiptEdit } : { receiptEdit: undefined }),
              ...(receiptMeta ? { receiptMeta } : { receiptMeta: undefined }),
            };
          })
        : [];

      const receiptLayouts =
        parsed.receiptLayouts && typeof parsed.receiptLayouts === 'object'
          ? sanitizeReceiptLayoutsMap(parsed.receiptLayouts)
          : undefined;

      const parsedFiscalYear = isValidFiscalYear(Number(parsed.fiscalYear))
        ? Number(parsed.fiscalYear)
        : undefined;

      return {
        ok: true,
        ...(parsedFiscalYear ? { fiscalYear: parsedFiscalYear } : {}),
        transactions,
        budgets:
          parsed.budgets && typeof parsed.budgets === 'object'
            ? parsed.budgets
            : {},
        mokjangs: Array.isArray(parsed.mokjangs) ? parsed.mokjangs : null,
        settings:
          parsed.settings && typeof parsed.settings === 'object'
            ? parsed.settings
            : null,
        ...(receiptLayouts !== undefined ? { receiptLayouts } : {}),
      };
    } catch {
      return {
        ok: false,
        error: 'JSON 파일을 읽을 수 없습니다. 파일이 손상되었는지 확인하세요.',
      };
    }
  },
};

/**
 * 연도별 예산안(annual_budget)의 관·항·목(1·2·3차 분류) 구조를 분석하여
 * 앱 전체(장부 카테고리 선택 칩, 결산서 예산 대비 집행률 표)와 실시간 동기화합니다.
 */
export function deriveDynamicFiscalSchema(
  annualBudget: BudgetDocument,
  settings: AppSettings,
  transactions: Transaction[]
): DynamicFiscalSchema {
  const categoryAllocations: Record<string, CategoryBudgetAllocation> = {};
  const budgetExpenseCategories: string[] = [];
  const budgetIncomeCategories: string[] = [];

  annualBudget.items.forEach((item) => {
    const cat = item.category.trim();
    if (!cat) return;
    if (item.entryType === 'income') {
      if (!budgetIncomeCategories.includes(cat)) {
        budgetIncomeCategories.push(cat);
      }
      return;
    }
    if (!categoryAllocations[cat]) {
      budgetExpenseCategories.push(cat);
      categoryAllocations[cat] = {
        category: cat,
        annualBudget: 0,
        monthlyBudget: 0,
        itemNames: [],
        subAllocations: {},
      };
    }
    const itemAmount = Number(item.amount) || 0;
    categoryAllocations[cat].annualBudget += itemAmount;
    categoryAllocations[cat].monthlyBudget = Math.round(
      categoryAllocations[cat].annualBudget / MONTHS_PER_YEAR
    );

    const subLabel = item.subCategory?.trim() || item.itemName.trim();
    if (subLabel) {
      if (!categoryAllocations[cat].itemNames.includes(subLabel)) {
        categoryAllocations[cat].itemNames.push(subLabel);
      }
      if (!categoryAllocations[cat].subAllocations[subLabel]) {
        categoryAllocations[cat].subAllocations[subLabel] = {
          subCategory: subLabel,
          annualBudget: 0,
          monthlyBudget: 0,
          detailNames: [],
        };
      }
      const subAlloc = categoryAllocations[cat].subAllocations[subLabel];
      subAlloc.annualBudget += itemAmount;
      subAlloc.monthlyBudget = Math.round(
        subAlloc.annualBudget / MONTHS_PER_YEAR
      );

      const detailLabel = item.detailCategory?.trim();
      if (detailLabel && !subAlloc.detailNames.includes(detailLabel)) {
        subAlloc.detailNames.push(detailLabel);
      }
    }
  });

  // 기존 지출 거래 내역의 2차/3차 분류도 병합 보존 (직접 입력한 분류가 장부 칩에 자동 추천되도록 유지)
  transactions.forEach((tx) => {
    if (tx.type !== 'expense') return;
    const cat = tx.category.trim();
    if (!cat) return;
    const sub = tx.subCategory?.trim();
    const detail = tx.detailCategory?.trim();
    if (!sub && !detail) return;

    if (!categoryAllocations[cat]) {
      categoryAllocations[cat] = {
        category: cat,
        annualBudget: 0,
        monthlyBudget: 0,
        itemNames: [],
        subAllocations: {},
      };
    }

    if (sub) {
      if (!categoryAllocations[cat].itemNames.includes(sub)) {
        categoryAllocations[cat].itemNames.push(sub);
      }
      if (!categoryAllocations[cat].subAllocations[sub]) {
        categoryAllocations[cat].subAllocations[sub] = {
          subCategory: sub,
          annualBudget: 0,
          monthlyBudget: 0,
          detailNames: [],
        };
      }
      const subAlloc = categoryAllocations[cat].subAllocations[sub];
      if (detail && !subAlloc.detailNames.includes(detail)) {
        subAlloc.detailNames.push(detail);
      }
    }
  });

  // 기존 거래 내역에 사용된 카테고리 보존 (예산안 구조가 바뀌어도 기존 장부 내역 카테고리 유실 방지)
  const usedExpenseCategories = transactions
    .filter((tx) => tx.type === 'expense' && tx.category.trim())
    .map((tx) => tx.category.trim());

  const usedIncomeCategories = transactions
    .filter((tx) => tx.type === 'income' && tx.category.trim())
    .map((tx) => tx.category.trim());

  const baseExpenseList = settings.syncCategoriesWithAnnualBudget
    ? budgetExpenseCategories.length > 0
      ? budgetExpenseCategories
      : EXPENSE_CATEGORIES
    : EXPENSE_CATEGORIES;

  const activeExpenseCategories = Array.from(
    new Set([
      ...baseExpenseList,
      ...(settings.customExpenseCategories || []),
      ...usedExpenseCategories,
    ])
  );

  const activeIncomeCategories = Array.from(
    new Set([
      ...budgetIncomeCategories,
      ...INCOME_CATEGORIES,
      ...(settings.customIncomeCategories || []),
      ...usedIncomeCategories,
    ])
  );

  return {
    activeIncomeCategories,
    activeExpenseCategories,
    categoryAllocations,
  };
}

/**
 * 목장별 심방비 및 회식·모임비 배정 예산 대비 지출 현황을 계산합니다.
 */
export function computeMokjangSummary(
  mokjangs: MokjangGroup[],
  transactions: ProcessedTransaction[]
) {
  const stats: MokjangSpendStat[] = mokjangs.map((mj) => {
    const mjTxs = transactions.filter(
      (tx) => tx.type === 'expense' && tx.mokjangId === mj.id
    );

    const visitationSpent = mjTxs
      .filter((tx) => {
        if (tx.mokjangSubType) return tx.mokjangSubType === 'visitation';
        return tx.category.includes('심방');
      })
      .reduce((sum, tx) => sum + tx.amount, 0);

    const fellowshipSpent = mjTxs
      .filter((tx) => {
        if (tx.mokjangSubType) return tx.mokjangSubType === 'fellowship';
        return !tx.category.includes('심방');
      })
      .reduce((sum, tx) => sum + tx.amount, 0);

    const visitationRemaining = mj.visitationBudget - visitationSpent;
    const visitationRate =
      mj.visitationBudget > 0
        ? Math.round((visitationSpent / mj.visitationBudget) * 100)
        : 0;

    const fellowshipRemaining = mj.fellowshipBudget - fellowshipSpent;
    const fellowshipRate =
      mj.fellowshipBudget > 0
        ? Math.round((fellowshipSpent / mj.fellowshipBudget) * 100)
        : 0;

    const totalBudget = mj.visitationBudget + mj.fellowshipBudget;
    const totalSpent = visitationSpent + fellowshipSpent;
    const totalRemaining = totalBudget - totalSpent;
    const totalRate =
      totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

    return {
      mokjang: mj,
      visitationSpent,
      visitationRemaining,
      visitationRate,
      fellowshipSpent,
      fellowshipRemaining,
      fellowshipRate,
      totalBudget,
      totalSpent,
      totalRemaining,
      totalRate,
      transactions: mjTxs,
    };
  });

  const grandVisitationBudget = stats.reduce(
    (s, item) => s + item.mokjang.visitationBudget,
    0
  );
  const grandVisitationSpent = stats.reduce(
    (s, item) => s + item.visitationSpent,
    0
  );
  const grandFellowshipBudget = stats.reduce(
    (s, item) => s + item.mokjang.fellowshipBudget,
    0
  );
  const grandFellowshipSpent = stats.reduce(
    (s, item) => s + item.fellowshipSpent,
    0
  );
  const grandTotalBudget = grandVisitationBudget + grandFellowshipBudget;
  const grandTotalSpent = grandVisitationSpent + grandFellowshipSpent;
  const grandTotalRemaining = grandTotalBudget - grandTotalSpent;
  const grandTotalRate =
    grandTotalBudget > 0
      ? Math.round((grandTotalSpent / grandTotalBudget) * 100)
      : 0;

  return {
    stats,
    grandVisitationBudget,
    grandVisitationSpent,
    grandFellowshipBudget,
    grandFellowshipSpent,
    grandTotalBudget,
    grandTotalSpent,
    grandTotalRemaining,
    grandTotalRate,
  };
}

/**
 * 전체 거래 내역을 월별 누락 없이 날짜·생성순으로 정렬하고,
 * 각 월(YYYY-MM)별 증빙번호(#01, #02, ...)와 전체 누적 잔액(runningBalance)을 부여합니다.
 * (구글 시트 전체 백업 시 특정 월만 필터링되어 타 월 거래가 유실되는 문제를 원천 차단)
 */
export function enrichAllTransactionsWithEvidence(
  transactions: Transaction[]
): ProcessedTransaction[] {
  const sorted = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  const monthEvidenceCounters = new Map<string, number>();
  let runningBalance = 0;

  return sorted.map((tx) => {
    if (tx.type === 'income') {
      runningBalance += tx.amount;
    } else {
      runningBalance -= tx.amount;
    }

    let evidenceNo: string | undefined = undefined;
    if (tx.type === 'expense' || Boolean(tx.receiptImage)) {
      const ym = (tx.date || '').slice(0, 7) || 'unknown';
      const nextCount = (monthEvidenceCounters.get(ym) || 0) + 1;
      monthEvidenceCounters.set(ym, nextCount);
      evidenceNo = `#${String(nextCount).padStart(2, '0')}`;
    }

    return {
      ...tx,
      runningBalance,
      evidenceNo,
    };
  });
}

export function computeMonthlyLedger(
  allTransactions: Transaction[],
  yearMonth: string,
  accountFilter: AccountType
) {
  const accountFiltered = allTransactions.filter((tx) =>
    accountFilter === 'all' ? true : tx.account === accountFilter
  );

  const previousMonthsBalance = accountFiltered
    .filter((tx) => tx.date.slice(0, 7) < yearMonth)
    .reduce(
      (sum, tx) => sum + (tx.type === 'income' ? tx.amount : -tx.amount),
      0
    );

  const monthlyRaw = accountFiltered
    .filter((tx) => tx.date.slice(0, 7) === yearMonth)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.createdAt.localeCompare(b.createdAt);
    });

  let runningBalance = previousMonthsBalance;
  let evidenceCounter = 0;

  let carryoverAmount = previousMonthsBalance;
  let monthlyIncome = 0;
  let monthlyExpense = 0;

  const processed: ProcessedTransaction[] = monthlyRaw.map((tx) => {
    if (tx.type === 'income') {
      runningBalance += tx.amount;
      if (tx.category === '전월이월') {
        carryoverAmount += tx.amount;
      } else {
        monthlyIncome += tx.amount;
      }
    } else {
      runningBalance -= tx.amount;
      monthlyExpense += tx.amount;
    }

    let evidenceNo: string | undefined = undefined;
    if (tx.type === 'expense' || Boolean(tx.receiptImage)) {
      evidenceCounter += 1;
      evidenceNo = `#${String(evidenceCounter).padStart(2, '0')}`;
    }

    return {
      ...tx,
      runningBalance,
      evidenceNo,
    };
  });

  const missingReceiptTransactions = processed.filter(
    (tx) => tx.type === 'expense' && !tx.receiptImage
  );

  return {
    processedTransactions: processed,
    carryoverAmount,
    monthlyIncome,
    monthlyExpense,
    totalIncomeWithCarryover: carryoverAmount + monthlyIncome,
    currentBalance: runningBalance,
    missingReceiptCount: missingReceiptTransactions.length,
    missingReceiptTransactions,
  };
}
