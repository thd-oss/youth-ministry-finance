import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Printer,
  Settings,
  Sparkles,
  Users,
  X,
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
  ReceiptBookLayoutEntry,
  ReceiptBookLayoutsMap,
  SyncStatus,
  Transaction,
  TransactionType,
} from './types/finance';
import {
  clearGoogleSession,
  ensureGoogleWorkspace,
  GoogleSession,
  GoogleWorkspaceInfo,
  loadGoogleSession,
  pullAllFromGoogleSheets,
  pushAllToGoogleSheets,
  signInWithGoogle,
} from './utils/googleDirectSync';
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
  const [receiptLayouts, setReceiptLayouts] = useState<ReceiptBookLayoutsMap>(
    () => SyncManager.loadReceiptLayouts()
  );
  const receiptLayoutsRef = useRef<ReceiptBookLayoutsMap>(receiptLayouts);
  receiptLayoutsRef.current = receiptLayouts;

  const [storageQuotaWarning, setStorageQuotaWarning] = useState<boolean>(false);

  const [googleSession, setGoogleSession] = useState<GoogleSession | null>(() =>
    loadGoogleSession()
  );

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => {
    const s = SyncManager.loadSettings();
    const sess = loadGoogleSession();
    if (sess && s.googleSpreadsheetId) return 'synced';
    if (s.gasWebAppUrl) return 'synced';
    return 'local';
  });

  // 자동 백업 트리거용 수정 리비전 카운터 (시트에서 불러오기/드라이브 URL 반영 시에는 증가시키지 않음)
  const [dataRevision, setDataRevision] = useState<number>(0);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPushingGoogleRef = useRef<boolean>(false);

  const bumpDataRevision = useCallback(() => {
    setDataRevision((r) => r + 1);
  }, []);

  // 바텀시트 및 설정 모달 상태
  const [isTxSheetOpen, setIsTxSheetOpen] = useState<boolean>(false);
  const [autoTriggerCamera, setAutoTriggerCamera] = useState<boolean>(false);
  const [defaultTxType, setDefaultTxType] =
    useState<TransactionType>('expense');
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
    const savedLocal = SyncManager.saveTransactions(nextTransactions);
    setStorageQuotaWarning(!savedLocal);
    bumpDataRevision();

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
            const savedDriveLocal = SyncManager.saveTransactions(withDrive);
            setStorageQuotaWarning(!savedDriveLocal);
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
    const savedLocal = SyncManager.saveTransactions(nextTransactions);
    if (savedLocal) setStorageQuotaWarning(false);
    bumpDataRevision();
    bumpDataRevision();

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
    bumpDataRevision();
  };

  const handleUpdateMokjangs = (nextMokjangs: MokjangGroup[]) => {
    setMokjangs(nextMokjangs);
    SyncManager.saveMokjangs(nextMokjangs);
    bumpDataRevision();
  };

  const handleAddCustomCategory = (
    type: TransactionType,
    newCategory: string,
    monthlyBudgetAmount?: number
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

      if (monthlyBudgetAmount && monthlyBudgetAmount > 0) {
        const annualAmount = monthlyBudgetAmount * 12;
        const nextAnnualDoc: BudgetDocument = {
          ...budgets.annual_budget,
          items: [
            ...budgets.annual_budget.items,
            {
              id: `ab-${Date.now()}`,
              category: newCategory,
              subCategory: '기타',
              itemName: '',
              formula: `월 ${monthlyBudgetAmount.toLocaleString('ko-KR')}원 × 12개월`,
              amount: annualAmount,
              note: '',
            },
          ],
        };
        handleUpdateBudget('annual_budget', nextAnnualDoc);
      }
    }
  };

  const handleUpdateSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    SyncManager.saveSettings(nextSettings);
    bumpDataRevision();
    if (googleSession && nextSettings.googleSpreadsheetId) {
      setSyncStatus('synced');
    } else {
      setSyncStatus(nextSettings.gasWebAppUrl.trim() ? 'synced' : 'local');
    }
  };

  const handleUpdateReceiptLayout = useCallback(
    (scopeKey: string, entry: ReceiptBookLayoutEntry) => {
      const next: ReceiptBookLayoutsMap = {
        ...receiptLayoutsRef.current,
        [scopeKey]: entry,
      };
      receiptLayoutsRef.current = next;
      setReceiptLayouts(next);
      const saved = SyncManager.saveReceiptLayouts(next);
      if (!saved) {
        setStorageQuotaWarning(true);
      } else {
        setStorageQuotaWarning(false);
      }
      bumpDataRevision();
    },
    [bumpDataRevision]
  );

  /**
   * Google OAuth 로그인 + 드라이브 통합 폴더/영수증 폴더/5개 시트 스프레드시트 자동 생성·연결
   */
  const handleGoogleSignIn = async (
    clientId: string
  ): Promise<{
    session: GoogleSession;
    workspace: GoogleWorkspaceInfo;
    autoBackedUp: boolean;
  }> => {
    const cleanClientId = clientId.trim();
    const session = await signInWithGoogle(cleanClientId, 'select_account');
    setGoogleSession(session);
    setSyncStatus('syncing');

    // 다른 계정으로 로그인한 경우 이전 계정의 spreadsheetId는 무시하고 새 계정 드라이브에서 탐색/생성
    const isSameAccount =
      settings.googleAccountEmail &&
      settings.googleAccountEmail === session.email;
    const workspace = await ensureGoogleWorkspace(
      session.accessToken,
      settings.departmentName,
      isSameAccount ? settings.googleSpreadsheetId : undefined
    );

    const nextSettings: AppSettings = {
      ...settings,
      googleClientId: cleanClientId,
      googleAccountEmail: session.email,
      googleAccountName: session.name,
      googleSpreadsheetId: workspace.spreadsheetId,
      googleSpreadsheetUrl: workspace.spreadsheetUrl,
      googleReceiptFolderId: workspace.receiptFolderId,
      googleReceiptFolderUrl: workspace.receiptFolderUrl,
      googleAutoSync: settings.googleAutoSync ?? true,
    };
    setSettings(nextSettings);
    SyncManager.saveSettings(nextSettings);

    // 시트가 새로 생성되었거나 비어 있으면 현재 앱 데이터를 즉시 첫 백업
    let autoBackedUp = false;
    if (workspace.createdNewSpreadsheet || !workspace.hasExistingData) {
      const allComputed = computeMonthlyLedger(transactions, yearMonth, 'all');
      const pushRes = await pushAllToGoogleSheets(
        session.accessToken,
        workspace.spreadsheetId,
        workspace.receiptFolderId,
        {
          transactions: allComputed.processedTransactions,
          budgets,
          mokjangs,
          settings: nextSettings,
          receiptLayouts: receiptLayoutsRef.current,
        }
      );
      setTransactions(pushRes.updatedTransactions);
      const savedTx = SyncManager.saveTransactions(pushRes.updatedTransactions);
      setStorageQuotaWarning(!savedTx);
      const syncedSettings = { ...nextSettings, lastSyncedAt: pushRes.syncedAt };
      setSettings(syncedSettings);
      SyncManager.saveSettings(syncedSettings);
      autoBackedUp = true;
    }

    setSyncStatus('synced');
    return { session, workspace, autoBackedUp };
  };

  const handleGooglePushAll = useCallback(
    async (silent = false) => {
      if (isPushingGoogleRef.current) return;
      const activeSession = loadGoogleSession();
      if (
        !activeSession ||
        !settings.googleSpreadsheetId ||
        !settings.googleReceiptFolderId
      ) {
        if (!silent) {
          throw new Error(
            '구글 로그인 세션이 만료되었거나 연결된 시트가 없습니다. 먼저 [Google 계정으로 로그인]을 눌러주세요.'
          );
        }
        setGoogleSession(null);
        setSyncStatus('local');
        return;
      }

      isPushingGoogleRef.current = true;
      setSyncStatus('syncing');
      try {
        const allComputed = computeMonthlyLedger(transactions, yearMonth, 'all');
        const res = await pushAllToGoogleSheets(
          activeSession.accessToken,
          settings.googleSpreadsheetId,
          settings.googleReceiptFolderId,
          {
            transactions: allComputed.processedTransactions,
            budgets,
            mokjangs,
            settings,
            receiptLayouts,
          }
        );
        setTransactions(res.updatedTransactions);
        const savedTx = SyncManager.saveTransactions(res.updatedTransactions);
        setStorageQuotaWarning(!savedTx);
        const syncedSettings = { ...settings, lastSyncedAt: res.syncedAt };
        setSettings(syncedSettings);
        SyncManager.saveSettings(syncedSettings);
        setSyncStatus('synced');
      } catch (err) {
        const refreshed = loadGoogleSession();
        if (!refreshed) setGoogleSession(null);
        setSyncStatus('error');
        if (!silent) throw err;
      } finally {
        isPushingGoogleRef.current = false;
      }
    },
    [transactions, budgets, mokjangs, settings, receiptLayouts, yearMonth]
  );

  const handleGooglePullAll = async () => {
    const activeSession = loadGoogleSession();
    if (!activeSession || !settings.googleSpreadsheetId) {
      setGoogleSession(null);
      throw new Error(
        '구글 로그인 세션이 만료되었습니다. 먼저 [Google 계정으로 로그인]을 눌러주세요.'
      );
    }

    setSyncStatus('syncing');
    try {
      const pulled = await pullAllFromGoogleSheets(
        activeSession.accessToken,
        settings.googleSpreadsheetId,
        settings
      );
      setTransactions(pulled.transactions);
      const savedTx = SyncManager.saveTransactions(pulled.transactions);
      setMokjangs(pulled.mokjangs);
      SyncManager.saveMokjangs(pulled.mokjangs);
      setBudgets(pulled.budgets);
      SyncManager.saveBudgets(pulled.budgets);
      setSettings(pulled.settings);
      SyncManager.saveSettings(pulled.settings);
      setReceiptLayouts(pulled.receiptLayouts);
      receiptLayoutsRef.current = pulled.receiptLayouts;
      const savedLayouts = SyncManager.saveReceiptLayouts(pulled.receiptLayouts);
      setStorageQuotaWarning(!savedTx || !savedLayouts);
      setSyncStatus('synced');
      return {
        transactionCount: pulled.transactions.length,
        mokjangCount: pulled.mokjangs.length,
        annualBudgetCount: pulled.budgets.annual_budget.items.length,
        retreatBudgetCount: pulled.budgets.retreat_claim.items.length,
      };
    } catch (err) {
      setSyncStatus('error');
      throw err;
    }
  };

  const handleGoogleSignOut = (disconnectSheet = false) => {
    clearGoogleSession();
    setGoogleSession(null);
    if (disconnectSheet) {
      const cleared: AppSettings = {
        ...settings,
        googleAccountEmail: '',
        googleAccountName: '',
        googleSpreadsheetId: '',
        googleSpreadsheetUrl: '',
        googleReceiptFolderId: '',
        googleReceiptFolderUrl: '',
      };
      setSettings(cleared);
      SyncManager.saveSettings(cleared);
    }
    setSyncStatus(settings.gasWebAppUrl.trim() ? 'synced' : 'local');
  };

  // 구글 로그인 & 자동 백업 활성화 시: 모든 탭 변경 후 2.5초 디바운스로 구글 시트 자동 백업
  useEffect(() => {
    if (dataRevision === 0) return;
    if (
      !googleSession ||
      !settings.googleSpreadsheetId ||
      !settings.googleReceiptFolderId ||
      settings.googleAutoSync === false
    ) {
      return;
    }

    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
    }
    autoSyncTimerRef.current = setTimeout(() => {
      void handleGooglePushAll(true);
    }, 2500);

    return () => {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
      }
    };
  }, [
    dataRevision,
    googleSession,
    settings.googleSpreadsheetId,
    settings.googleReceiptFolderId,
    settings.googleAutoSync,
    handleGooglePushAll,
  ]);

  const handlePullFromGas = async (url: string) => {
    setSyncStatus('syncing');
    const result = await SyncManager.fetchAllFromGas(url);
    if (!result.ok) {
      setSyncStatus('local');
      throw new Error(result.error || '시트 응답 오류');
    }
    if (Array.isArray(result.transactions)) {
      setTransactions(result.transactions);
      const savedTx = SyncManager.saveTransactions(result.transactions);
      if (!savedTx) setStorageQuotaWarning(true);
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
    if (result.receiptLayouts) {
      setReceiptLayouts(result.receiptLayouts);
      receiptLayoutsRef.current = result.receiptLayouts;
      const savedLayouts = SyncManager.saveReceiptLayouts(result.receiptLayouts);
      if (!savedLayouts) setStorageQuotaWarning(true);
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
      receiptLayouts,
    });
    if (!result.ok) {
      setSyncStatus('local');
      throw new Error(result.error || '시트 업로드 실패');
    }
    setSyncStatus('synced');
  };

  const handleImportJson = (
    file: File
  ): Promise<{ ok: boolean; message: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = SyncManager.parseAndValidateBackupJson(
          String(e.target?.result || '')
        );
        if (!result.ok) {
          resolve({ ok: false, message: result.error });
          return;
        }

        setTransactions(result.transactions);
        const savedTx = SyncManager.saveTransactions(result.transactions);

        const nextBudgets: BudgetsMap = {
          annual_budget:
            result.budgets.annual_budget || budgets.annual_budget,
          retreat_claim:
            result.budgets.retreat_claim || budgets.retreat_claim,
        };
        setBudgets(nextBudgets);
        SyncManager.saveBudgets(nextBudgets);

        const nextMokjangs =
          result.mokjangs !== null ? result.mokjangs : mokjangs;
        if (result.mokjangs !== null) {
          setMokjangs(nextMokjangs);
          SyncManager.saveMokjangs(nextMokjangs);
        }

        const nextReceiptLayouts = result.receiptLayouts ?? {};
        setReceiptLayouts(nextReceiptLayouts);
        receiptLayoutsRef.current = nextReceiptLayouts;
        const savedLayouts =
          SyncManager.saveReceiptLayouts(nextReceiptLayouts);
        setStorageQuotaWarning(!savedTx || !savedLayouts);

        if (result.settings) {
          const merged: AppSettings = {
            ...settings,
            ...result.settings,
            // 백업 파일에 API 키가 비어 있으면 현재 기기의 키를 보존
            geminiApiKey:
              result.settings.geminiApiKey?.trim() ||
              settings.geminiApiKey ||
              '',
          };
          setSettings(merged);
          SyncManager.saveSettings(merged);
          setSyncStatus(merged.gasWebAppUrl.trim() ? 'synced' : 'local');
        }

        resolve({
          ok: true,
          message: `전체 복원 완료 · 장부 ${result.transactions.length}건, 목장 ${nextMokjangs.length}개, 연간예산 ${nextBudgets.annual_budget.items.length}건, 청구서 ${nextBudgets.retreat_claim.items.length}건`,
        });
      };
      reader.onerror = () => {
        resolve({ ok: false, message: '파일을 읽는 중 오류가 발생했습니다.' });
      };
      reader.readAsText(file);
    });
  };

  const handleResetAllData = (
    initialCarryover: number,
    keepConnections: boolean
  ) => {
    const clean = SyncManager.resetAllDataClean(
      yearMonth,
      initialCarryover,
      keepConnections
    );
    setTransactions(clean.transactions);
    setBudgets(clean.budgets);
    setMokjangs(clean.mokjangs);
    setSettings(clean.settings);
    setReceiptLayouts(clean.receiptLayouts);
    receiptLayoutsRef.current = clean.receiptLayouts;
    setStorageQuotaWarning(false);
    if (!keepConnections) {
      clearGoogleSession();
      setGoogleSession(null);
      setSyncStatus('local');
    } else {
      bumpDataRevision();
    }
    setAccountFilter('all');
  };

  const handleResetSampleData = () => {
    const reset = SyncManager.resetToSampleData();
    setTransactions(reset.transactions);
    setBudgets(reset.budgets);
    setMokjangs(reset.mokjangs);
    setSettings(reset.settings);
    setReceiptLayouts(reset.receiptLayouts);
    receiptLayoutsRef.current = reset.receiptLayouts;
    setStorageQuotaWarning(false);
    setYearMonth('2026-11');
    setAccountFilter('all');
    bumpDataRevision();
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
          <span>시트 백업 중</span>
        </span>
      );
    }
    if (settings.googleSpreadsheetUrl) {
      if (googleSession) {
        return (
          <a
            href={settings.googleSpreadsheetUrl}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1.5 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#191F28] text-[12px] font-semibold flex items-center gap-1 transition-all"
          >
            <span>🟢</span>
            <span>내 시트</span>
            <ExternalLink className="w-3 h-3 text-[#8B95A1]" />
          </a>
        );
      }
      return (
        <button
          type="button"
          onClick={() => openSettingsAt('connection')}
          className="px-2.5 py-1.5 rounded-full bg-[#FFF8E6] text-[#B45309] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97]"
        >
          <span>🟡</span>
          <span>시트 재연결</span>
        </button>
      );
    }
    if (syncStatus === 'synced' && settings.gasWebAppUrl.trim()) {
      return (
        <span className="px-2.5 py-1.5 rounded-full bg-[#F9FAFB] text-[#191F28] text-[12px] font-semibold flex items-center gap-1">
          <span>🟢</span>
          <span>시트 연동</span>
        </span>
      );
    }
    return null;
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
              <span>장부</span>
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
              <span>목장 현황</span>
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
              <span>결산·인쇄</span>
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
              <span>예산안·청구서</span>
            </button>
          </nav>
        </div>
      </header>

      {/* 로컬 스토리지 용량 부족 경고 배너 (@media print 시 숨김) */}
      {storageQuotaWarning && (
        <div className="no-print max-w-[980px] mx-auto px-4 sm:px-6 pt-3">
          <div className="rounded-2xl bg-[#FFF8E6] px-4 py-2.5 flex items-center justify-between gap-3 text-[13px] font-semibold text-[#B45309]">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="truncate sm:whitespace-normal">
                브라우저 저장 공간이 부족합니다. 구글 시트 백업을 권장합니다.
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => openSettingsAt('connection')}
                className="px-2.5 py-1 rounded-xl bg-[#FFFFFF] text-[#B45309] text-[12px] font-bold active:scale-[0.97] transition-all duration-150"
              >
                백업 설정
              </button>
              <button
                type="button"
                aria-label="경고 닫기"
                onClick={() => setStorageQuotaWarning(false)}
                className="p-1 rounded-lg text-[#B45309]/70 hover:text-[#B45309]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

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
            onOpenNewTransaction={(
              triggerCam = false,
              initialType: TransactionType = 'expense'
            ) => {
              setEditingTx(null);
              setPresetMokjangId(undefined);
              setPresetMokjangSubType(undefined);
              setDefaultTxType(initialType);
              setAutoTriggerCamera(Boolean(triggerCam));
              setIsTxSheetOpen(true);
            }}
            onSelectTransaction={(tx) => {
              setEditingTx(tx);
              setPresetMokjangId(undefined);
              setPresetMokjangSubType(undefined);
              setDefaultTxType(tx.type);
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
            onSwitchToBudgetBuilder={() => setActiveView('budget_builder')}
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
            receiptLayouts={receiptLayouts}
            onUpdateReceiptLayout={handleUpdateReceiptLayout}
          />
        )}

        {activeView === 'budget_builder' && (
          <BudgetBuilderView
            budgets={budgets}
            onUpdateBudget={handleUpdateBudget}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            activeExpenseCategories={fiscalSchema.activeExpenseCategories}
            activeIncomeCategories={fiscalSchema.activeIncomeCategories}
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
        defaultType={defaultTxType}
        presetMokjangId={presetMokjangId}
        presetMokjangSubType={presetMokjangSubType}
        autoTriggerCamera={autoTriggerCamera}
        geminiApiKey={settings.geminiApiKey || ''}
        geminiModel={settings.geminiModel || 'gemini-3-flash-preview'}
        onOpenGeminiSettings={() => openSettingsAt('gemini')}
        incomeCategories={fiscalSchema.activeIncomeCategories}
        expenseCategories={fiscalSchema.activeExpenseCategories}
        categoryAllocations={fiscalSchema.categoryAllocations}
        mokjangs={mokjangs}
        onAddCustomCategory={handleAddCustomCategory}
        onSave={handleSaveTransaction}
        onDelete={handleDeleteTransaction}
      />

      {/* AI 스캐너 · 구글 시트 통합 백업 · 초기화 모달 */}
      <SyncSettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
        settings={settings}
        googleSession={googleSession}
        onSaveSettings={handleUpdateSettings}
        onGoogleSignIn={handleGoogleSignIn}
        onGooglePushAll={() => handleGooglePushAll(false)}
        onGooglePullAll={handleGooglePullAll}
        onGoogleSignOut={handleGoogleSignOut}
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
            receiptLayouts,
          })
        }
        onImportJson={handleImportJson}
        onResetAllData={handleResetAllData}
        onResetSampleData={handleResetSampleData}
        dataSummary={{
          transactionCount: transactions.length,
          mokjangCount: mokjangs.length,
          annualBudgetCount: budgets.annual_budget.items.length,
          retreatBudgetCount: budgets.retreat_claim.items.length,
        }}
      />
    </div>
  );
};

export default App;
