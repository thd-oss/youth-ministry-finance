import {
  AccountType,
  AppSettings,
  BudgetDocument,
  BudgetTemplateType,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  MOKJANG_SUBTYPE_LABELS,
  MokjangGroup,
  ProcessedTransaction,
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
};

export interface BudgetsMap {
  retreat_claim: BudgetDocument;
  annual_budget: BudgetDocument;
}

export interface CategoryBudgetAllocation {
  category: string;
  annualBudget: number;
  monthlyBudget: number;
  itemNames: string[];
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

export const SyncManager = {
  loadTransactions(): Transaction[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
      if (!raw) {
        localStorage.setItem(
          STORAGE_KEYS.TRANSACTIONS,
          JSON.stringify(INITIAL_TRANSACTIONS)
        );
        return INITIAL_TRANSACTIONS;
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : INITIAL_TRANSACTIONS;
    } catch {
      return INITIAL_TRANSACTIONS;
    }
  },

  saveTransactions(transactions: Transaction[]): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.TRANSACTIONS,
        JSON.stringify(transactions)
      );
    } catch (e) {
      console.error('LocalStorage 거래 저장 실패:', e);
    }
  },

  loadBudgets(): BudgetsMap {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BUDGETS);
      if (!raw) {
        const initial: BudgetsMap = {
          retreat_claim: INITIAL_RETREAT_BUDGET,
          annual_budget: INITIAL_ANNUAL_BUDGET,
        };
        localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(initial));
        return initial;
      }
      const parsed = JSON.parse(raw);
      return {
        retreat_claim: parsed.retreat_claim || INITIAL_RETREAT_BUDGET,
        annual_budget: parsed.annual_budget || INITIAL_ANNUAL_BUDGET,
      };
    } catch {
      return {
        retreat_claim: INITIAL_RETREAT_BUDGET,
        annual_budget: INITIAL_ANNUAL_BUDGET,
      };
    }
  },

  saveBudgets(budgets: BudgetsMap): void {
    try {
      localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgets));
    } catch (e) {
      console.error('LocalStorage 예산 저장 실패:', e);
    }
  },

  loadMokjangs(): MokjangGroup[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.MOKJANGS);
      if (raw === null) {
        localStorage.setItem(
          STORAGE_KEYS.MOKJANGS,
          JSON.stringify(INITIAL_MOKJANG_GROUPS)
        );
        return INITIAL_MOKJANG_GROUPS;
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : INITIAL_MOKJANG_GROUPS;
    } catch {
      return INITIAL_MOKJANG_GROUPS;
    }
  },

  saveMokjangs(mokjangs: MokjangGroup[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.MOKJANGS, JSON.stringify(mokjangs));
    } catch (e) {
      console.error('LocalStorage 목장 저장 실패:', e);
    }
  },

  loadSettings(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!raw) {
        localStorage.setItem(
          STORAGE_KEYS.SETTINGS,
          JSON.stringify(DEFAULT_SETTINGS)
        );
        return DEFAULT_SETTINGS;
      }
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error('LocalStorage 설정 저장 실패:', e);
    }
  },

  resetToSampleData(): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
  } {
    const budgets: BudgetsMap = {
      retreat_claim: INITIAL_RETREAT_BUDGET,
      annual_budget: INITIAL_ANNUAL_BUDGET,
    };
    const nextSettings: AppSettings = {
      ...this.loadSettings(),
      isProductionMode: false,
    };
    localStorage.setItem(
      STORAGE_KEYS.TRANSACTIONS,
      JSON.stringify(INITIAL_TRANSACTIONS)
    );
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgets));
    localStorage.setItem(
      STORAGE_KEYS.MOKJANGS,
      JSON.stringify(INITIAL_MOKJANG_GROUPS)
    );
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(nextSettings));
    return {
      transactions: INITIAL_TRANSACTIONS,
      budgets,
      mokjangs: INITIAL_MOKJANG_GROUPS,
      settings: nextSettings,
    };
  },

  /**
   * 모든 탭의 데이터(장부 거래·영수증 + 목장 현황 + 연간 예산안 + 수련회 청구서 + 커스텀 분류)를
   * 일괄 초기화하여 깨끗한 실사용 상태로 전환합니다.
   */
  resetAllDataClean(
    yearMonth: string,
    initialCarryoverAmount = 0,
    keepConnections = true
  ): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
  } {
    const prevSettings = this.loadSettings();
    const prevBudgets = this.loadBudgets();

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
    const fiscalYear = Number(yearMonth.slice(0, 4)) || new Date().getFullYear();

    const cleanBudgets: BudgetsMap = {
      annual_budget: {
        ...prevBudgets.annual_budget,
        templateType: 'annual_budget',
        fiscalYear,
        title: `${fiscalYear}년도 ${deptName} 연간 예산 심의안`,
        subtitle: '',
        department: deptName,
        eventName: `${fiscalYear}년 연간 사역 예산`,
        eventPeriod: `${fiscalYear}년 1월 1일 ~ ${fiscalYear}년 12월 31일`,
        eventLocation: '',
        participants: '',
        proposerName: authorName,
        requestDate: `${yearMonth}-01`,
        selfBurdenAmount: 0,
        selfBurdenNote: '',
        bankName: keepConnections ? prevBudgets.annual_budget.bankName : '',
        accountNumber: keepConnections
          ? prevBudgets.annual_budget.accountNumber
          : '',
        accountHolder: keepConnections
          ? prevBudgets.annual_budget.accountHolder
          : '',
        items: [],
      },
      retreat_claim: {
        ...prevBudgets.retreat_claim,
        templateType: 'retreat_claim',
        fiscalYear,
        title: `${fiscalYear}년 ${deptName} 수련회·행사 재정 청구서`,
        subtitle: '',
        department: deptName,
        eventName: '',
        eventPeriod: '',
        eventLocation: '',
        participants: '',
        proposerName: authorName,
        requestDate: `${yearMonth}-01`,
        selfBurdenAmount: 0,
        selfBurdenNote: '',
        bankName: keepConnections ? prevBudgets.retreat_claim.bankName : '',
        accountNumber: keepConnections
          ? prevBudgets.retreat_claim.accountNumber
          : '',
        accountHolder: keepConnections
          ? prevBudgets.retreat_claim.accountHolder
          : '',
        items: [],
      },
    };

    const cleanMokjangs: MokjangGroup[] = [];

    localStorage.setItem(
      STORAGE_KEYS.TRANSACTIONS,
      JSON.stringify(cleanTransactions)
    );
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(cleanBudgets));
    localStorage.setItem(STORAGE_KEYS.MOKJANGS, JSON.stringify(cleanMokjangs));
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(nextSettings));

    return {
      transactions: cleanTransactions,
      budgets: cleanBudgets,
      mokjangs: cleanMokjangs,
      settings: nextSettings,
    };
  },

  startCleanProductionLedger(
    yearMonth: string,
    initialCarryoverAmount = 0
  ): {
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
  } {
    return this.resetAllDataClean(yearMonth, initialCarryoverAmount, true);
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
    serverTime?: string;
    error?: string;
  }> {
    const response = await fetch(webAppUrl.trim(), {
      method: 'GET',
    });
    return await response.json();
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
      '세목(2차 품목·명목)',
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
    transactions: Transaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
  }): void {
    const safeSettings: AppSettings = {
      ...data.settings,
      geminiApiKey: '', // 개인 API 키는 백업 파일 유출 방지를 위해 제외
    };
    const jsonStr = JSON.stringify(
      {
        version: '3.0',
        exportedAt: new Date().toISOString(),
        summary: {
          transactionCount: data.transactions.length,
          mokjangCount: data.mokjangs.length,
          annualBudgetItemCount: data.budgets.annual_budget.items.length,
          retreatBudgetItemCount: data.budgets.retreat_claim.items.length,
        },
        transactions: data.transactions,
        budgets: data.budgets,
        mokjangs: data.mokjangs,
        settings: safeSettings,
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
    link.download = `청년부_회계_전체백업_${dateTag}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  parseAndValidateBackupJson(rawText: string):
    | {
        ok: true;
        transactions: Transaction[];
        budgets: Partial<BudgetsMap>;
        mokjangs: MokjangGroup[] | null;
        settings: Partial<AppSettings> | null;
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
        Boolean(parsed.settings);

      if (!hasAnySection) {
        return {
          ok: false,
          error: '장부·예산안·목장 데이터가 포함되지 않은 파일입니다.',
        };
      }

      return {
        ok: true,
        transactions: Array.isArray(parsed.transactions)
          ? parsed.transactions
          : [],
        budgets:
          parsed.budgets && typeof parsed.budgets === 'object'
            ? parsed.budgets
            : {},
        mokjangs: Array.isArray(parsed.mokjangs) ? parsed.mokjangs : null,
        settings:
          parsed.settings && typeof parsed.settings === 'object'
            ? parsed.settings
            : null,
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
 * 연도별 예산안(annual_budget)의 관/항 구조를 분석하여
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
      };
    }
    categoryAllocations[cat].annualBudget += Number(item.amount) || 0;
    categoryAllocations[cat].monthlyBudget = Math.round(
      categoryAllocations[cat].annualBudget / 12
    );
    const subLabel = item.subCategory?.trim() || item.itemName.trim();
    if (subLabel && !categoryAllocations[cat].itemNames.includes(subLabel)) {
      categoryAllocations[cat].itemNames.push(subLabel);
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
