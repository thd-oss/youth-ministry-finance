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
  category: string;
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
  category: string; // 구분 (관/항) - 앱의 동적 카테고리 스키마와 연동
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

export interface AppSettings {
  gasWebAppUrl: string;
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

export const INCOME_CATEGORIES: string[] = [
  '전월이월',
  '교회지원금(예산)',
  '회비수입',
  '수련회등록비',
  '찬조/기타수입',
];

export const EXPENSE_CATEGORIES: string[] = [
  '간식/다과비',
  '예배/양육비',
  '수련회/행사비',
  '심방/축하/조의',
  '주보/인쇄/비품',
  '기타운영비',
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  '체크카드',
  '계좌이체',
  '현금',
  '개인선결제(청구)',
];

export const CATEGORY_ICONS: Record<string, { emoji: string; bg: string }> = {
  '전월이월': { emoji: '🏦', bg: '#E8F3FF' },
  '교회지원금(예산)': { emoji: '⛪', bg: '#E8F3FF' },
  '회비수입': { emoji: '💳', bg: '#E8F3FF' },
  '수련회등록비': { emoji: '🏕️', bg: '#E8F3FF' },
  '찬조/기타수입': { emoji: '🎁', bg: '#E8F3FF' },
  '간식/다과비': { emoji: '🍙', bg: '#F2F4F6' },
  '간식/새가족비': { emoji: '🍙', bg: '#F2F4F6' },
  '예배/양육비': { emoji: '📖', bg: '#F2F4F6' },
  '수련회/행사비': { emoji: '⛺', bg: '#F2F4F6' },
  '심방/축하/조의': { emoji: '💐', bg: '#F2F4F6' },
  '심방/선교/기타': { emoji: '💐', bg: '#F2F4F6' },
  '목장심방/회식비': { emoji: '🤝', bg: '#F2F4F6' },
  '주보/인쇄/비품': { emoji: '🖨️', bg: '#F2F4F6' },
  '기타운영비': { emoji: '🗂️', bg: '#F2F4F6' },
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
    if (category.includes('수련회') || category.includes('행사'))
      return { emoji: '🏕️', bg: '#E8F3FF' };
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
  if (category.includes('예배') || category.includes('양육') || category.includes('강사')) {
    return { emoji: '📖', bg: '#F2F4F6' };
  }
  if (category.includes('수련회') || category.includes('행사') || category.includes('숙박')) {
    return { emoji: '⛺', bg: '#F2F4F6' };
  }
  if (category.includes('심방') || category.includes('축하') || category.includes('목장')) {
    return { emoji: '💐', bg: '#F2F4F6' };
  }
  if (category.includes('인쇄') || category.includes('주보') || category.includes('비품')) {
    return { emoji: '🖨️', bg: '#F2F4F6' };
  }
  return { emoji: '🧾', bg: '#F2F4F6' };
}
