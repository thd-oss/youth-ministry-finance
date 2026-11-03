import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Calculator,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Printer,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  AccountType,
  ActiveViewMode,
  AppSettings,
  BudgetDocument,
  BudgetTemplateType,
  MokjangExpenseSubType,
  MokjangGroup,
  ProcessedTransaction,
  SyncStatus,
  Transaction,
  TransactionType,
} from './types/finance';
import { formatYearMonthKorean } from './utils/koreanCurrency';
import {
  BudgetsMap,
  computeMonthlyLedger,
  deriveDynamicFiscalSchema,
  SyncManager,
} from './utils/syncManager';
import { BudgetBuilderView } from './components/BudgetBuilderView';
import { LedgerView } from './components/LedgerView';
import { MokjangDashboardView } from './components/MokjangDashboardView';
import { PrintCenterView } from './components/PrintCenterView';
import {
  SettingsTabType,
  SyncSettingsModal,
} from './components/SyncSettingsModal';
import { TransactionBottomSheet } from './components/TransactionBottomSheet';

const AVAILABLE_MONTHS = [
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
];

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveViewMode>('ledger');
  const [yearMonth, setYearMonth] = useState<string>('2026-11');
  const [accountFilter, setAccountFilter] = useState<AccountType>('all');

  const [transactions, setTransactions] = useState<Transaction[]>(() =>
    SyncManager.loadTransactions()
  );
  const [budgets, setBudgets] = useState<BudgetsMap>(() =>
    SyncManager.loadBudgets()
  );
  const [mokjangs, setMokjangs] = useState<MokjangGroup[]>(() =>
    SyncManager.loadMokjangs()
  );
  const [settings, setSettings] = useState<AppSettings>(() =>
    SyncManager.loadSettings()
  );

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    SyncManager.loadSettings().gasWebAppUrl ? 'synced' : 'local'
  );

  // 바텀시트 및 설정 모달 상태
  const [isTxSheetOpen, setIsTxSheetOpen] = useState<boolean>(false);
  const [autoTriggerCamera, setAutoTriggerCamera] = useState<boolean>(false);
  const [editingTx, setEditingTx] = useState<ProcessedTransaction | null>(null);
  const [presetMokjangId, setPresetMokjangId] = useState<string | undefined>(
    undefined
  );
  const [presetMokjangSubType, setPresetMokjangSubType] = useState<
    MokjangExpenseSubType | undefined
  >(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTabType>('gemini');

  const ledgerSummary = useMemo(
    () => computeMonthlyLedger(transactions, yearMonth, accountFilter),
    [transactions, yearMonth, accountFilter]
  );

  const allAccountsMonthlySummary = useMemo(
    () => computeMonthlyLedger(transactions, yearMonth, 'all'),
    [transactions, yearMonth]
  );

  const fiscalSchema = useMemo(
    () =>
      deriveDynamicFiscalSchema(budgets.annual_budget, settings, transactions),
    [budgets.annual_budget, settings, transactions]
  );

  const stepMonth = (delta: -1 | 1) => {
    const [y, m] = yearMonth.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const nextYm = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      '0'
    )}`;
    setYearMonth(nextYm);
  };

  const handleSaveTransaction = async (savedTx: Transaction) => {
    const exists = transactions.some((t) => t.id === savedTx.id);
    const nextTransactions = exists
      ? transactions.map((t) => (t.id === savedTx.id ? savedTx : t))
      : [...transactions, savedTx];

    setTransactions(nextTransactions);
    SyncManager.saveTransactions(nextTransactions);

    const txYm = savedTx.date.slice(0, 7);
    if (txYm !== yearMonth) {
      setYearMonth(txYm);
    }

    if (settings.gasWebAppUrl.trim()) {
      setSyncStatus('syncing');
      try {
        const computedForMonth = computeMonthlyLedger(
          nextTransactions,
          txYm,
          'all'
        );
        const enrichedTx =
          computedForMonth.processedTransactions.find(
            (t) => t.id === savedTx.id
          ) || savedTx;
        const res = await SyncManager.pushTransactionToGas(
          settings.gasWebAppUrl,
          enrichedTx
        );
        if (res.ok) {
          if (res.receiptDriveUrl) {
            const withDrive = nextTransactions.map((t) =>
              t.id === savedTx.id
                ? {
                    ...t,
                    receiptImage: res.receiptImage || t.receiptImage,
                    receiptDriveUrl: res.receiptDriveUrl,
                  }
                : t
            );
            setTransactions(withDrive);
            SyncManager.saveTransactions(withDrive);
          }
          setSyncStatus('synced');
        } else {
          setSyncStatus('local');
        }
      } catch {
        setSyncStatus('local');
      }
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    const nextTransactions = transactions.filter((t) => t.id !== id);
    setTransactions(nextTransactions);
    SyncManager.saveTransactions(nextTransactions);

    if (settings.gasWebAppUrl.trim()) {
      setSyncStatus('syncing');
      try {
        await SyncManager.deleteTransactionFromGas(settings.gasWebAppUrl, id);
        setSyncStatus('synced');
      } catch {
        setSyncStatus('local');
      }
    }
  };

  const handleUpdateBudget = (
    templateType: BudgetTemplateType,
    nextDoc: BudgetDocument
  ) => {
    const nextBudgets: BudgetsMap = {
      ...budgets,
      [templateType]: nextDoc,
    };
    setBudgets(nextBudgets);
    SyncManager.saveBudgets(nextBudgets);
  };

  const handleUpdateMokjangs = (nextMokjangs: MokjangGroup[]) => {
    setMokjangs(nextMokjangs);
    SyncManager.saveMokjangs(nextMokjangs);
  };

  const handleAddCustomCategory = (
    type: TransactionType,
    newCategory: string
  ) => {
    if (type === 'income') {
      const nextCustom = Array.from(
        new Set([...(settings.customIncomeCategories || []), newCategory])
      );
      const nextSettings = { ...settings, customIncomeCategories: nextCustom };
      setSettings(nextSettings);
      SyncManager.saveSettings(nextSettings);
    } else {
      const nextCustom = Array.from(
        new Set([...(settings.customExpenseCategories || []), newCategory])
      );
      const nextSettings = { ...settings, customExpenseCategories: nextCustom };
      setSettings(nextSettings);
      SyncManager.saveSettings(nextSettings);
    }
  };

  const handleUpdateSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    SyncManager.saveSettings(nextSettings);
    setSyncStatus(nextSettings.gasWebAppUrl.trim() ? 'synced' : 'local');
  };

  const handlePullFromGas = async (url: string) => {
    setSyncStatus('syncing');
    const result = await SyncManager.fetchAllFromGas(url);
    if (!result.ok) {
      setSyncStatus('local');
      throw new Error(result.error || '시트 응답 오류');
    }
    if (Array.isArray(result.transactions)) {
      setTransactions(result.transactions);
      SyncManager.saveTransactions(result.transactions);
    }
    if (result.budgets) {
      const mergedBudgets: BudgetsMap = {
        retreat_claim: result.budgets.retreat_claim || budgets.retreat_claim,
        annual_budget: result.budgets.annual_budget || budgets.annual_budget,
      };
      setBudgets(mergedBudgets);
      SyncManager.saveBudgets(mergedBudgets);
    }
    if (Array.isArray(result.mokjangs) && result.mokjangs.length > 0) {
      setMokjangs(result.mokjangs);
      SyncManager.saveMokjangs(result.mokjangs);
    }
    setSyncStatus('synced');
  };

  const handlePushAllToGas = async (url: string) => {
    setSyncStatus('syncing');
    const allComputed = computeMonthlyLedger(transactions, yearMonth, 'all');
    const result = await SyncManager.pushAllToGas(url, {
      transactions: allComputed.processedTransactions,
      budgets,
      mokjangs,
      settings,
    });
    if (!result.ok) {
      setSyncStatus('local');
      throw new Error(result.error || '시트 업로드 실패');
    }
    setSyncStatus('synced');
  };

  const handleImportJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result || '{}'));
        if (Array.isArray(parsed.transactions)) {
          setTransactions(parsed.transactions);
          SyncManager.saveTransactions(parsed.transactions);
        }
        if (parsed.budgets) {
          setBudgets(parsed.budgets);
          SyncManager.saveBudgets(parsed.budgets);
        }
        if (Array.isArray(parsed.mokjangs)) {
          setMokjangs(parsed.mokjangs);
          SyncManager.saveMokjangs(parsed.mokjangs);
        }
        if (parsed.settings) {
          const merged = { ...settings, ...parsed.settings };
          setSettings(merged);
          SyncManager.saveSettings(merged);
        }
      } catch (err) {
        console.error('JSON 복원 오류:', err);
      }
    };
    reader.readAsText(file);
  };

  const handleStartCleanLedger = (initialCarryover: number) => {
    const clean = SyncManager.startCleanProductionLedger(
      yearMonth,
      initialCarryover
    );
    setTransactions(clean.transactions);
    setSettings(clean.settings);
    setAccountFilter('all');
  };

  const handleResetSampleData = () => {
    const reset = SyncManager.resetToSampleData();
    setTransactions(reset.transactions);
    setBudgets(reset.budgets);
    setMokjangs(reset.mokjangs);
    setSettings(reset.settings);
    setYearMonth('2026-11');
    setAccountFilter('all');
  };

  const openSettingsAt = (tab: SettingsTabType) => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };

  const renderSyncBadge = () => {
    if (syncStatus === 'syncing') {
      return (
        <span className="px-2.5 py-1.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1">
          <span>🔵</span>
          <span>저장 중...</span>
        </span>
      );
    }
    if (syncStatus === 'synced' && settings.gasWebAppUrl.trim()) {
      return (
        <span className="px-2.5 py-1.5 rounded-full bg-[#F9FAFB] text-[#191F28] text-[12px] font-semibold flex items-center gap-1">
          <span>🟢</span>
          <span>시트 동기화됨</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1.5 rounded-full bg-[#F9FAFB] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1">
        <span>⚪</span>
        <span>로컬 모드</span>
      </span>
    );
  };

  const hasGeminiKey = Boolean(settings.geminiApiKey?.trim());

  return (
    <div className="min-h-screen bg-[#F2F4F6] text-[#191F28]">
      {/* ===================================================================
          상단 글로벌 헤더 & 4대 뷰 네비게이션 (@media print 시 완벽 숨김)
         =================================================================== */}
      <header className="no-print sticky top-0 z-30 bg-[#FFFFFF]/95 backdrop-blur-md">
        <div className="max-w-[980px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* 좌측: 브랜드 & 귀속 연월 선택기 */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#3182F6] text-[#FFFFFF] flex items-center justify-center font-bold text-[15px] shrink-0">
              청
            </div>

            <div className="flex items-center bg-[#F9FAFB] rounded-full px-1.5 py-1">
              <button
                type="button"
                onClick={() => stepMonth(-1)}
                aria-label="이전 달"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] active:scale-[0.97] transition-all duration-150"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="relative flex items-center px-2">
                <Calendar className="w-3.5 h-3.5 text-[#3182F6] mr-1.5 shrink-0" />
                <select
                  aria-label="귀속 연월 선택"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  className="appearance-none bg-transparent pr-4 text-[15px] font-bold text-[#191F28] tabular-nums cursor-pointer focus:outline-none"
                >
                  {Array.from(new Set([...AVAILABLE_MONTHS, yearMonth]))
                    .sort()
                    .map((ym) => (
                      <option key={ym} value={ym}>
                        {formatYearMonthKorean(ym)}
                      </option>
                    ))}
                </select>
                <span className="pointer-events-none absolute right-1 text-[11px] text-[#4E5968]">
                  ▾
                </span>
              </div>

              <button
                type="button"
                onClick={() => stepMonth(1)}
                aria-label="다음 달"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] active:scale-[0.97] transition-all duration-150"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 우측: Gemini AI 배지 + 구글 시트 배지 + [⚙️ 연동 설정] */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => openSettingsAt('gemini')}
              className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold flex items-center gap-1 active:scale-[0.97] transition-all duration-150 ${
                hasGeminiKey
                  ? 'bg-[#E8F3FF] text-[#1B64DA]'
                  : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#3182F6]" />
              <span>{hasGeminiKey ? 'AI 스캔 ON' : 'AI 연결'}</span>
            </button>

            {renderSyncBadge()}

            <button
              type="button"
              onClick={() => openSettingsAt('connection')}
              className="px-3 py-1.5 rounded-full bg-[#E5E8EB] hover:bg-[#D1D6DB] text-[#191F28] text-[12.5px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150 ease-out"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>설정</span>
            </button>
          </div>
        </div>

        {/* 4가지 뷰 모드 전환 네비게이션 탭 */}
        <div className="max-w-[980px] mx-auto px-4 sm:px-6 pb-3">
          <nav
            aria-label="주요 화면 전환"
            className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-2 sm:grid-cols-4 gap-1"
          >
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`py-2.5 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'ledger'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>1. 회계 장부</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('mokjang_share')}
              className={`py-2.5 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'mokjang_share'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>2. 목장 심방·회식비</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('print_center')}
              className={`py-2.5 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'print_center'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>3. 결산·영수증철 인쇄</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('budget_builder')}
              className={`py-2.5 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'budget_builder'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Calculator className="w-4 h-4 shrink-0" />
              <span>4. 예산안·청구서 빌더</span>
            </button>
          </nav>
        </div>
      </header>

      {/* ===================================================================
          메인 뷰 영역
         =================================================================== */}
      <main className="px-4 sm:px-6 pt-5">
        {activeView === 'ledger' && (
          <LedgerView
            yearMonth={yearMonth}
            accountFilter={accountFilter}
            onAccountFilterChange={setAccountFilter}
            processedTransactions={ledgerSummary.processedTransactions}
            carryoverAmount={ledgerSummary.carryoverAmount}
            monthlyIncome={ledgerSummary.monthlyIncome}
            monthlyExpense={ledgerSummary.monthlyExpense}
            currentBalance={ledgerSummary.currentBalance}
            missingReceiptCount={ledgerSummary.missingReceiptCount}
            mokjangs={mokjangs}
            categoryAllocations={fiscalSchema.categoryAllocations}
            isProductionMode={settings.isProductionMode}
            hasGeminiKey={hasGeminiKey}
            onOpenNewTransaction={(triggerCam = false) => {
              setEditingTx(null);
              setPresetMokjangId(undefined);
              setPresetMokjangSubType(undefined);
              setAutoTriggerCamera(Boolean(triggerCam));
              setIsTxSheetOpen(true);
            }}
            onSelectTransaction={(tx) => {
              setEditingTx(tx);
              setPresetMokjangId(undefined);
              setPresetMokjangSubType(undefined);
              setAutoTriggerCamera(false);
              setIsTxSheetOpen(true);
            }}
            onExportCsv={() =>
              SyncManager.exportTransactionsCsv(
                ledgerSummary.processedTransactions,
                yearMonth,
                mokjangs
              )
            }
            onSwitchToPrintCenter={() => setActiveView('print_center')}
            onSwitchToMokjangShare={() => setActiveView('mokjang_share')}
            onOpenProductionSetup={() => openSettingsAt('backup')}
            onOpenGeminiSetup={() => openSettingsAt('gemini')}
          />
        )}

        {activeView === 'mokjang_share' && (
          <MokjangDashboardView
            yearMonth={yearMonth}
            mokjangs={mokjangs}
            onUpdateMokjangs={handleUpdateMokjangs}
            processedTransactions={
              allAccountsMonthlySummary.processedTransactions
            }
            onOpenNewMokjangTransaction={(mjId, subType) => {
              setEditingTx(null);
              setPresetMokjangId(mjId);
              setPresetMokjangSubType(subType);
              setAutoTriggerCamera(false);
              setIsTxSheetOpen(true);
            }}
            onSelectTransaction={(tx) => {
              setEditingTx(tx);
              setPresetMokjangId(undefined);
              setPresetMokjangSubType(undefined);
              setAutoTriggerCamera(false);
              setIsTxSheetOpen(true);
            }}
          />
        )}

        {activeView === 'print_center' && (
          <PrintCenterView
            yearMonth={yearMonth}
            accountFilter={accountFilter}
            onAccountFilterChange={setAccountFilter}
            processedTransactions={ledgerSummary.processedTransactions}
            carryoverAmount={ledgerSummary.carryoverAmount}
            monthlyIncome={ledgerSummary.monthlyIncome}
            monthlyExpense={ledgerSummary.monthlyExpense}
            currentBalance={ledgerSummary.currentBalance}
            mokjangs={mokjangs}
            categoryAllocations={fiscalSchema.categoryAllocations}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSelectTransaction={(tx) => {
              setEditingTx(tx);
              setPresetMokjangId(undefined);
              setPresetMokjangSubType(undefined);
              setAutoTriggerCamera(false);
              setIsTxSheetOpen(true);
            }}
            onQuickSaveTransaction={handleSaveTransaction}
          />
        )}

        {activeView === 'budget_builder' && (
          <BudgetBuilderView
            budgets={budgets}
            onUpdateBudget={handleUpdateBudget}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            activeExpenseCategories={fiscalSchema.activeExpenseCategories}
          />
        )}
      </main>

      {/* 내역 입력 및 AI 영수증 업로드 바텀시트 */}
      <TransactionBottomSheet
        open={isTxSheetOpen}
        onClose={() => {
          setIsTxSheetOpen(false);
          setEditingTx(null);
          setPresetMokjangId(undefined);
          setPresetMokjangSubType(undefined);
          setAutoTriggerCamera(false);
        }}
        initialTransaction={editingTx}
        defaultYearMonth={yearMonth}
        defaultAccount={accountFilter === 'all' ? 'general' : accountFilter}
        presetMokjangId={presetMokjangId}
        presetMokjangSubType={presetMokjangSubType}
        autoTriggerCamera={autoTriggerCamera}
        geminiApiKey={settings.geminiApiKey || ''}
        geminiModel={settings.geminiModel || 'gemini-3-flash-preview'}
        onOpenGeminiSettings={() => openSettingsAt('gemini')}
        incomeCategories={fiscalSchema.activeIncomeCategories}
        expenseCategories={fiscalSchema.activeExpenseCategories}
        mokjangs={mokjangs}
        onAddCustomCategory={handleAddCustomCategory}
        onSave={handleSaveTransaction}
        onDelete={handleDeleteTransaction}
      />

      {/* AI 스캐너 · 구글 시트 연동 · 실사용 전환 모달 */}
      <SyncSettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
        settings={settings}
        onSaveSettings={handleUpdateSettings}
        onPullFromGas={handlePullFromGas}
        onPushAllToGas={handlePushAllToGas}
        onExportCsv={() =>
          SyncManager.exportTransactionsCsv(
            ledgerSummary.processedTransactions,
            yearMonth,
            mokjangs
          )
        }
        onExportJson={() =>
          SyncManager.exportBackupJson({
            transactions,
            budgets,
            mokjangs,
            settings,
          })
        }
        onImportJson={handleImportJson}
        onStartCleanLedger={handleStartCleanLedger}
        onResetSampleData={handleResetSampleData}
      />
    </div>
  );
};

export default App;
