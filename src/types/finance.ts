export type AccountType = 'all' | 'general' | 'retreat' | 'mission';

export type LedgerAccount = Exclude<AccountType, 'all'>;

export type TransactionType = 'income' | 'expense';

export type IncomeCategory = string;
export type ExpenseCategory = string;

export type PaymentMethod =
  | '체크카드'
  | '계좌이체'
  | '현금'
  | '개인선결제(청구)';

export type MokjangExpenseSubType = 'visitation' | 'fellowship';

export const MOKJANG_SUBTYPE_LABELS: Record<MokjangExpenseSubType, string> = {
  visitation: '심방비',
  fellowship: '회식·모임비',
};

export interface MokjangGroup {
  id: string;
  name: string; // 예: 1목장 (다윗목장)
  leaderName: string; // 예: 김하늘 목자
  memberCount: number;
  visitationBudget: number; // 심방비 배정 예산
  fellowshipBudget: number; // 회식·모임비 배정 예산
  note?: string;
}

export interface ReceiptMetadata {
  width: number;
  height: number;
  sizeKb: number;
  fileName?: string;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  type: TransactionType;
  account: LedgerAccount;
  category: string; // 1차 분류 (관/항: 사역 목적 또는 수입원)
  subCategory?: string; // 2차 분류 (세목: 식비·간식, 교재·도서, 강사·사례, 정기지원금, 참가등록비 등)
  title: string; // 적요 (가맹점/내역명)
  memo: string; // 상세 산출근거 메모 (예: 김밥 3,500원×10줄)
  amount: number;
  paymentMethod: PaymentMethod;
  mokjangId?: string; // 귀속 목장 ID (선택)
  mokjangSubType?: MokjangExpenseSubType; // 'visitation'(심방비) | 'fellowship'(회식·모임비)
  receiptImage?: string; // Base64 Data URL 또는 Google Drive 썸네일 URL
  receiptDriveUrl?: string; // Google Drive 원본 뷰어 URL
  receiptMeta?: ReceiptMetadata;
  createdAt: string;
}

export interface ProcessedTransaction extends Transaction {
  runningBalance: number;
  evidenceNo?: string; // '#01', '#02', ...
}

export interface BudgetLineItem {
  id: string;
  entryType?: TransactionType; // 'expense'(기본) | 'income'(수입 예산 항목)
  category: string; // 1차 구분 (관/항) - 앱의 동적 카테고리 스키마와 연동
  subCategory?: string; // 2차 세목 (선택: 식비·간식, 교재·도서 등)
  itemName: string; // 세부 항목명
  formula: string; // 산출 기초 (단가 × 수량 × 횟수)
  amount: number; // 청구/예산 금액
  note: string; // 비고
}

export type BudgetTemplateType = 'retreat_claim' | 'annual_budget';

export interface BudgetDocument {
  templateType: BudgetTemplateType;
  fiscalYear?: number;
  title: string;
  subtitle: string;
  department: string;
  eventName: string;
  eventPeriod: string;
  eventLocation: string;
  participants: string;
  proposerName: string;
  proposerRole: string;
  requestDate: string;
  selfBurdenAmount: number; // 자체 부담금 (회비/등록비 등)
  selfBurdenNote: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  purposeNote: string;
  items: BudgetLineItem[];
}

export interface GeminiModelOption {
  id: string; // 예: 'gemini-3-flash-preview'
  displayName: string; // 예: 'Gemini 3 Flash Preview'
  description?: string;
}

export interface AppSettings {
  gasWebAppUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  availableGeminiModels?: GeminiModelOption[];
  isProductionMode: boolean;
  departmentName: string;
  authorName: string;
  authorRole: string;
  approvalRoles: [string, string, string, string];
  showApprovalBox: boolean;
  syncCategoriesWithAnnualBudget: boolean;
  customIncomeCategories: string[];
  customExpenseCategories: string[];
  lastSyncedAt?: string;
}

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';

export type ActiveViewMode =
  | 'ledger'
  | 'mokjang_share'
  | 'print_center'
  | 'budget_builder';

export const ACCOUNT_LABELS: Record<AccountType, string> = {
  all: '전체',
  general: '일반회계(운영비)',
  retreat: '수련회·행사비',
  mission: '목적헌금·선교',
};

/**
 * 1차 수입 관/항 (무엇으로부터 들어온 수입인가?)
 */
export const INCOME_CATEGORIES: string[] = [
  '전월이월',
  '교회지원금(예산)',
  '부서회비/등록비',
  '찬조/기타수입',
  '수련회등록비',
  '회비수입',
];

/**
 * 2차 수입 세목 (수입 세부 명목)
 */
export const INCOME_SUBCATEGORIES_MAP: Record<string, string[]> = {
  전월이월: ['전월 이월금', '연초 이월금', '행사계정 이월금'],
  '교회지원금(예산)': [
    '월 정기예산 수령',
    '수련회·행사 특별지원금',
    '리더십·양육 지원금',
    '새가족·전도 지원금',
  ],
  '부서회비/등록비': [
    '월 정기회비',
    '수련회 참가등록비',
    '리더십 훈련 참가비',
    '청년부 행사 참가비',
  ],
  수련회등록비: [
    '수련회 참가등록비(정기)',
    '수련회 얼리버드 등록비',
    '수련회 부분참가 등록비',
  ],
  회비수입: ['월 정기회비', '임원·리더 회비', '목장 모임 회비'],
  '찬조/기타수입': [
    '교역자·장로·선배 찬조금',
    '수련회·행사 특별찬조',
    '예금 결산이자',
    '집행 잔액 환입',
  ],
};

export const COMMON_INCOME_SUBCATEGORIES: string[] = [
  '월 정기예산 수령',
  '수련회·행사 특별지원금',
  '수련회 참가등록비',
  '월 정기회비',
  '교역자·선배 찬조금',
  '전월 이월금',
  '예금 결산이자',
];

/**
 * 1차 지출 관/항 (어떤 사역 목적을 위한 지출인가?)
 */
export const EXPENSE_CATEGORIES: string[] = [
  '예배/양육비',
  '간식/다과비',
  '청년부행사/전도비',
  '수련회/행사비',
  '심방/축하/조의',
  '주보/인쇄/비품',
  '기타운영비',
];

/**
 * 2차 지출 세목 (그 사역에서 무엇을 구매/지출했는가? — 모든 사역 공통 품목)
 * 예: 리더십 훈련(1차) + 식비·간식/다과(2차), 청년부 행사(1차) + 식비·간식/다과(2차), 수련회(1차) + 식비·간식/다과(2차)
 */
export const COMMON_EXPENSE_SUBCATEGORIES: string[] = [
  '식비·간식/다과',
  '교재·도서·양육물품',
  '강사·사례비',
  '숙박·대관·차량',
  '심방·선물·꽃',
  '주보·인쇄·홍보물',
  '비품·데코·소모품',
];

export function getSuggestedSubCategories(
  type: TransactionType,
  category: string,
  budgetItemNames: string[] = []
): string[] {
  if (type === 'income') {
    const mapped = INCOME_SUBCATEGORIES_MAP[category] || [];
    return Array.from(
      new Set([...budgetItemNames, ...mapped, ...COMMON_INCOME_SUBCATEGORIES])
    );
  }
  return Array.from(
    new Set([...budgetItemNames, ...COMMON_EXPENSE_SUBCATEGORIES])
  );
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  '체크카드',
  '계좌이체',
  '현금',
  '개인선결제(청구)',
];

export const CATEGORY_ICONS: Record<string, { emoji: string; bg: string }> = {
  전월이월: { emoji: '🏦', bg: '#E8F3FF' },
  '교회지원금(예산)': { emoji: '⛪', bg: '#E8F3FF' },
  '부서회비/등록비': { emoji: '💳', bg: '#E8F3FF' },
  회비수입: { emoji: '💳', bg: '#E8F3FF' },
  수련회등록비: { emoji: '🏕️', bg: '#E8F3FF' },
  '찬조/기타수입': { emoji: '🎁', bg: '#E8F3FF' },
  '간식/다과비': { emoji: '🍙', bg: '#F2F4F6' },
  '간식/새가족비': { emoji: '🍙', bg: '#F2F4F6' },
  '예배/양육비': { emoji: '📖', bg: '#F2F4F6' },
  '청년부행사/전도비': { emoji: '🎉', bg: '#F2F4F6' },
  '수련회/행사비': { emoji: '⛺', bg: '#F2F4F6' },
  '심방/축하/조의': { emoji: '💐', bg: '#F2F4F6' },
  '심방/선교/기타': { emoji: '💐', bg: '#F2F4F6' },
  '목장심방/회식비': { emoji: '🤝', bg: '#F2F4F6' },
  '주보/인쇄/비품': { emoji: '🖨️', bg: '#F2F4F6' },
  기타운영비: { emoji: '🗂️', bg: '#F2F4F6' },
};

/**
 * 예산안 구조가 변경되어 새로운 관/항 카테고리가 생성되더라도
 * 키워드를 분석해 가장 알맞은 아이콘과 배경색을 반환합니다.
 */
export function getCategoryIconMeta(
  category: string,
  type: TransactionType
): { emoji: string; bg: string } {
  if (CATEGORY_ICONS[category]) {
    return CATEGORY_ICONS[category];
  }
  if (type === 'income') {
    if (category.includes('이월')) return { emoji: '🏦', bg: '#E8F3FF' };
    if (category.includes('지원') || category.includes('예산'))
      return { emoji: '⛪', bg: '#E8F3FF' };
    if (category.includes('수련회') || category.includes('등록'))
      return { emoji: '🏕️', bg: '#E8F3FF' };
    if (category.includes('회비')) return { emoji: '💳', bg: '#E8F3FF' };
    return { emoji: '💰', bg: '#E8F3FF' };
  }
  if (
    category.includes('간식') ||
    category.includes('다과') ||
    category.includes('식비') ||
    category.includes('회식')
  ) {
    return { emoji: '🍙', bg: '#F2F4F6' };
  }
  if (
    category.includes('예배') ||
    category.includes('양육') ||
    category.includes('리더') ||
    category.includes('훈련')
  ) {
    return { emoji: '📖', bg: '#F2F4F6' };
  }
  if (category.includes('행사') || category.includes('전도')) {
    return { emoji: '🎉', bg: '#F2F4F6' };
  }
  if (
    category.includes('수련회') ||
    category.includes('아웃리치') ||
    category.includes('숙박')
  ) {
    return { emoji: '⛺', bg: '#F2F4F6' };
  }
  if (
    category.includes('심방') ||
    category.includes('축하') ||
    category.includes('목장')
  ) {
    return { emoji: '💐', bg: '#F2F4F6' };
  }
  if (
    category.includes('인쇄') ||
    category.includes('주보') ||
    category.includes('비품')
  ) {
    return { emoji: '🖨️', bg: '#F2F4F6' };
  }
  return { emoji: '🧾', bg: '#F2F4F6' };
}
