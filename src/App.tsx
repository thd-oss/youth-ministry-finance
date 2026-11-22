import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  ExternalLink,
  LogIn,
  Printer,
  RefreshCw,
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
  getEffectiveGoogleClientId,
  getSpreadsheetModifiedTime,
  GoogleSession,
  GoogleWorkspaceInfo,
  loadGoogleSession,
  pullAllFromGoogleSheets,
  pushAllToGoogleSheets,
  signInWithGoogle,
  trySilentGoogleReconnect,
} from './utils/googleDirectSync';
import { formatYearMonthKorean } from './utils/koreanCurrency';
import {
  BudgetsMap,
  computeMonthlyLedger,
  deriveDynamicFiscalSchema,
  enrichAllTransactionsWithEvidence,
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
import { TdsDialog } from './components/TdsDialog';
import { TransactionBottomSheet } from './components/TransactionBottomSheet';

const AVAILABLE_MONTHS = [
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
];

const AUTO_SYNC_DEBOUNCE_MS = 2000;
const VISIBILITY_PULL_THROTTLE_MS = 15_000;
const SYNC_TOAST_DURATION_MS = 3500;
const URL_PARAM_TOAST_DURATION_MS = 5500;
const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

interface PendingCloudConflict {
  session: GoogleSession;
  workspace: GoogleWorkspaceInfo;
  nextSettings: AppSettings;
  remoteModifiedTime?: string;
}

interface SyncToastMessage {
  text: string;
  tone: 'info' | 'warning';
}

function parseIsoTimestampMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function isSameCloudTimestamp(
  remoteIso?: string | null,
  localIso?: string | null
): boolean {
  if (!remoteIso || !localIso) return false;
  const remoteMs = parseIsoTimestampMs(remoteIso);
  const localMs = parseIsoTimestampMs(localIso);
  if (remoteMs !== null && localMs !== null) {
    return remoteMs === localMs;
  }
  return remoteIso === localIso;
}

function isRemoteTimestampNewer(
  remoteIso?: string | null,
  localIso?: string | null
): boolean {
  if (!remoteIso) return false;
  if (!localIso) return true;
  const remoteMs = parseIsoTimestampMs(remoteIso);
  const localMs = parseIsoTimestampMs(localIso);
  if (remoteMs !== null && localMs !== null) {
    return remoteMs > localMs;
  }
  return remoteIso !== localIso;
}

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
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const [receiptLayouts, setReceiptLayouts] = useState<ReceiptBookLayoutsMap>(
    () => SyncManager.loadReceiptLayouts()
  );
  const receiptLayoutsRef = useRef<ReceiptBookLayoutsMap>(receiptLayouts);
  receiptLayoutsRef.current = receiptLayouts;

  const [storageQuotaWarning, setStorageQuotaWarning] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<SyncToastMessage | null>(null);
  const syncToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingCloudConflict, setPendingCloudConflict] =
    useState<PendingCloudConflict | null>(null);
  const pendingCloudConflictRef = useRef<PendingCloudConflict | null>(
    pendingCloudConflict
  );
  pendingCloudConflictRef.current = pendingCloudConflict;
  const [isResolvingConflict, setIsResolvingConflict] =
    useState<boolean>(false);

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

  // 자동 백업 트리거 및 미저장 변경 추적용 리비전 카운터 (Pull/드라이브 URL 반영 시에는 증가시키지 않음)
  const [dataRevision, setDataRevision] = useState<number>(0);
  const dataRevisionRef = useRef<number>(0);
  const lastSyncedRevisionRef = useRef<number>(0);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPushingGoogleRef = useRef<boolean>(false);
  const isPullingGoogleRef = useRef<boolean>(false);
  const lastVisibilityCheckAtRef = useRef<number>(0);

  const showSyncToast = useCallback(
    (
      text: string,
      tone: 'info' | 'warning' = 'info',
      durationMs = SYNC_TOAST_DURATION_MS
    ) => {
      if (syncToastTimerRef.current) {
        clearTimeout(syncToastTimerRef.current);
      }
      setSyncToast({ text, tone });
      syncToastTimerRef.current = setTimeout(() => {
        setSyncToast(null);
        syncToastTimerRef.current = null;
      }, durationMs);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (syncToastTimerRef.current) {
        clearTimeout(syncToastTimerRef.current);
      }
    };
  }, []);

  const bumpDataRevision = useCallback(() => {
    const next = dataRevisionRef.current + 1;
    dataRevisionRef.current = next;
    setDataRevision(next);
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
   * 구글 시트에서 전체 데이터를 내려받아 로컬 상태와 저장소에 원자적으로 반영합니다.
   */
  const applyCloudPull = useCallback(
    async (
      accessToken: string,
      spreadsheetId: string,
      baseSettings: AppSettings
    ) => {
      if (isPullingGoogleRef.current) return null;
      isPullingGoogleRef.current = true;
      setSyncStatus('syncing');
      try {
        const pulled = await pullAllFromGoogleSheets(
          accessToken,
          spreadsheetId,
          baseSettings
        );
        setTransactions(pulled.transactions);
        const savedTx = SyncManager.saveTransactions(pulled.transactions);
        setMokjangs(pulled.mokjangs);
        SyncManager.saveMokjangs(pulled.mokjangs);
        setBudgets(pulled.budgets);
        SyncManager.saveBudgets(pulled.budgets);
        setSettings(pulled.settings);
        settingsRef.current = pulled.settings;
        SyncManager.saveSettings(pulled.settings);
        setReceiptLayouts(pulled.receiptLayouts);
        receiptLayoutsRef.current = pulled.receiptLayouts;
        const savedLayouts = SyncManager.saveReceiptLayouts(
          pulled.receiptLayouts
        );
        setStorageQuotaWarning(!savedTx || !savedLayouts);
        lastSyncedRevisionRef.current = dataRevisionRef.current;
        setSyncStatus('synced');
        return {
          transactionCount: pulled.transactions.length,
          mokjangCount: pulled.mokjangs.length,
          annualBudgetCount: pulled.budgets.annual_budget.items.length,
          retreatBudgetCount: pulled.budgets.retreat_claim.items.length,
          remoteModifiedTime: pulled.remoteModifiedTime,
        };
      } catch (err) {
        const refreshed = loadGoogleSession();
        if (!refreshed) setGoogleSession(null);
        setSyncStatus('error');
        throw err;
      } finally {
        isPullingGoogleRef.current = false;
      }
    },
    []
  );

  /**
   * Google OAuth 로그인 + 드라이브 통합 폴더/영수증 폴더/5개 시트 자동 연결 + 스마트 이어받기/충돌 보호
   */
  const handleGoogleSignIn = async (
    clientId: string
  ): Promise<{
    session: GoogleSession;
    workspace: GoogleWorkspaceInfo;
    autoBackedUp: boolean;
    autoHydrated?: boolean;
    conflictPending?: boolean;
  }> => {
    const cleanClientId = clientId.trim();
    const session = await signInWithGoogle(
      cleanClientId,
      'select_account',
      settings.googleAccountEmail || undefined
    );
    setGoogleSession(session);
    setSyncStatus('syncing');

    // 다른 계정으로 로그인한 경우 이전 계정의 spreadsheetId는 무시하고 새 계정 드라이브에서 탐색/생성
    const isSameAccount = Boolean(
      settings.googleAccountEmail &&
        settings.googleAccountEmail === session.email
    );
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
    settingsRef.current = nextSettings;
    SyncManager.saveSettings(nextSettings);

    // 1) 시트가 새로 생성되었거나 비어 있으면 전체 월 데이터를 즉시 첫 백업
    if (workspace.createdNewSpreadsheet || !workspace.hasExistingData) {
      const revisionAtPushStart = dataRevisionRef.current;
      const pushRes = await pushAllToGoogleSheets(
        session.accessToken,
        workspace.spreadsheetId,
        workspace.receiptFolderId,
        {
          transactions: enrichAllTransactionsWithEvidence(transactions),
          budgets,
          mokjangs,
          settings: nextSettings,
          receiptLayouts: receiptLayoutsRef.current,
        }
      );
      setTransactions(pushRes.updatedTransactions);
      const savedTx = SyncManager.saveTransactions(pushRes.updatedTransactions);
      setStorageQuotaWarning(!savedTx);
      const syncedSettings: AppSettings = {
        ...nextSettings,
        lastSyncedAt: pushRes.syncedAt,
        lastCloudModifiedTime:
          pushRes.remoteModifiedTime || pushRes.syncedAt,
      };
      setSettings(syncedSettings);
      settingsRef.current = syncedSettings;
      SyncManager.saveSettings(syncedSettings);
      lastSyncedRevisionRef.current = revisionAtPushStart;
      setSyncStatus('synced');
      return {
        session,
        workspace,
        autoBackedUp: true,
        autoHydrated: false,
        conflictPending: false,
      };
    }

    // 2) 드라이브에 기존 작업 데이터가 있는 경우: 동일 버전 / 자동 이어받기 / 충돌 보호 분기
    const hasLocalUnsavedEdits =
      dataRevisionRef.current !== lastSyncedRevisionRef.current;
    const isLocalSampleOrEmpty =
      !settings.isProductionMode || transactions.length === 0;
    const isSwitchedAccount = Boolean(
      settings.googleAccountEmail &&
        settings.googleAccountEmail !== session.email
    );
    const isSameCloudVersion = Boolean(
      isSameAccount &&
        isSameCloudTimestamp(
          workspace.remoteModifiedTime,
          settings.lastCloudModifiedTime
        )
    );
    const isCloudNewer = isRemoteTimestampNewer(
      workspace.remoteModifiedTime,
      settings.lastCloudModifiedTime
    );

    if (isSameCloudVersion && !hasLocalUnsavedEdits) {
      setSyncStatus('synced');
      return {
        session,
        workspace,
        autoBackedUp: false,
        autoHydrated: false,
        conflictPending: false,
      };
    }

    if (
      isLocalSampleOrEmpty ||
      isSwitchedAccount ||
      (isSameAccount && !hasLocalUnsavedEdits && isCloudNewer)
    ) {
      await applyCloudPull(
        session.accessToken,
        workspace.spreadsheetId,
        nextSettings
      );
      showSyncToast('구글 드라이브의 최신 작업을 불러왔습니다');
      return {
        session,
        workspace,
        autoBackedUp: false,
        autoHydrated: true,
        conflictPending: false,
      };
    }

    // 양쪽에 서로 다른 실제 작업 내역이 충돌할 때만 선택 다이얼로그 오픈
    setPendingCloudConflict({
      session,
      workspace,
      nextSettings,
      remoteModifiedTime: workspace.remoteModifiedTime,
    });
    setSyncStatus('local');
    return {
      session,
      workspace,
      autoBackedUp: false,
      autoHydrated: false,
      conflictPending: true,
    };
  };

  const handleResolveCloudConflict = async (choice: 'pull' | 'push') => {
    if (!pendingCloudConflict || isResolvingConflict) return;
    const conflict = pendingCloudConflict;
    setIsResolvingConflict(true);
    try {
      if (choice === 'pull') {
        await applyCloudPull(
          conflict.session.accessToken,
          conflict.workspace.spreadsheetId,
          conflict.nextSettings
        );
        pendingCloudConflictRef.current = null;
        setPendingCloudConflict(null);
        showSyncToast('구글 드라이브 최신 작업을 이어받았습니다');
      } else {
        setSyncStatus('syncing');
        const revisionAtPushStart = dataRevisionRef.current;
        const pushRes = await pushAllToGoogleSheets(
          conflict.session.accessToken,
          conflict.workspace.spreadsheetId,
          conflict.workspace.receiptFolderId,
          {
            transactions: enrichAllTransactionsWithEvidence(transactions),
            budgets,
            mokjangs,
            settings: conflict.nextSettings,
            receiptLayouts: receiptLayoutsRef.current,
          }
        );
        setTransactions(pushRes.updatedTransactions);
        const savedTx = SyncManager.saveTransactions(
          pushRes.updatedTransactions
        );
        setStorageQuotaWarning(!savedTx);
        const syncedSettings: AppSettings = {
          ...conflict.nextSettings,
          lastSyncedAt: pushRes.syncedAt,
          lastCloudModifiedTime:
            pushRes.remoteModifiedTime || pushRes.syncedAt,
        };
        setSettings(syncedSettings);
        settingsRef.current = syncedSettings;
        SyncManager.saveSettings(syncedSettings);
        lastSyncedRevisionRef.current = revisionAtPushStart;
        setSyncStatus('synced');
        pendingCloudConflictRef.current = null;
        setPendingCloudConflict(null);
        showSyncToast('이 기기의 전체 데이터로 구글 드라이브를 업데이트했습니다');
      }
    } catch (err) {
      setSyncStatus('error');
      showSyncToast(
        err instanceof Error
          ? err.message
          : '동기화 처리 중 오류가 발생했습니다.',
        'warning'
      );
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const handleGooglePushAll = useCallback(
    async (silent = false) => {
      if (isPushingGoogleRef.current || pendingCloudConflictRef.current) return;
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
      const revisionAtPushStart = dataRevisionRef.current;
      try {
        const res = await pushAllToGoogleSheets(
          activeSession.accessToken,
          settings.googleSpreadsheetId,
          settings.googleReceiptFolderId,
          {
            transactions: enrichAllTransactionsWithEvidence(transactions),
            budgets,
            mokjangs,
            settings,
            receiptLayouts,
          }
        );
        setTransactions(res.updatedTransactions);
        const savedTx = SyncManager.saveTransactions(res.updatedTransactions);
        setStorageQuotaWarning(!savedTx);
        const latestSettings = settingsRef.current;
        const syncedSettings: AppSettings = {
          ...latestSettings,
          lastSyncedAt: res.syncedAt,
          lastCloudModifiedTime:
            res.remoteModifiedTime ||
            latestSettings.lastCloudModifiedTime ||
            res.syncedAt,
        };
        setSettings(syncedSettings);
        settingsRef.current = syncedSettings;
        SyncManager.saveSettings(syncedSettings);
        lastSyncedRevisionRef.current = revisionAtPushStart;
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
    [transactions, budgets, mokjangs, settings, receiptLayouts]
  );

  const handleGooglePullAll = async () => {
    const activeSession = loadGoogleSession();
    if (!activeSession || !settings.googleSpreadsheetId) {
      setGoogleSession(null);
      throw new Error(
        '구글 로그인 세션이 만료되었습니다. 먼저 [Google 계정으로 로그인]을 눌러주세요.'
      );
    }

    const pulledSummary = await applyCloudPull(
      activeSession.accessToken,
      settings.googleSpreadsheetId,
      settings
    );
    return (
      pulledSummary || {
        transactionCount: transactions.length,
        mokjangCount: mokjangs.length,
        annualBudgetCount: budgets.annual_budget.items.length,
        retreatBudgetCount: budgets.retreat_claim.items.length,
      }
    );
  };

  const handleGoogleSignOut = (disconnectSheet = false) => {
    clearGoogleSession();
    setGoogleSession(null);
    pendingCloudConflictRef.current = null;
    setPendingCloudConflict(null);
    if (disconnectSheet) {
      const cleared: AppSettings = {
        ...settings,
        googleAccountEmail: '',
        googleAccountName: '',
        googleSpreadsheetId: '',
        googleSpreadsheetUrl: '',
        googleReceiptFolderId: '',
        googleReceiptFolderUrl: '',
        lastCloudModifiedTime: undefined,
      };
      setSettings(cleared);
      settingsRef.current = cleared;
      SyncManager.saveSettings(cleared);
    }
    setSyncStatus(settings.gasWebAppUrl.trim() ? 'synced' : 'local');
  };

  // 1) 최초 마운트: URL ?gclient=... 자동 등록 + 이전 계정 무팝업 자동 재연결
  useEffect(() => {
    let cancelled = false;

    const initCloudBootstrap = async () => {
      const params = new URLSearchParams(window.location.search);
      const gclientParam = params.get('gclient')?.trim() || '';
      if (gclientParam && gclientParam.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
        const current = SyncManager.loadSettings();
        const updated: AppSettings = {
          ...current,
          googleClientId: gclientParam,
        };
        setSettings(updated);
        settingsRef.current = updated;
        SyncManager.saveSettings(updated);

        params.delete('gclient');
        const nextQuery = params.toString();
        const cleanUrl = `${window.location.pathname}${
          nextQuery ? `?${nextQuery}` : ''
        }${window.location.hash}`;
        window.history.replaceState({}, document.title, cleanUrl);

        showSyncToast(
          'Google 연결 설정이 적용되었습니다. 상단 [Google 로그인]을 눌러 이어서 작업하세요.',
          'info',
          URL_PARAM_TOAST_DURATION_MS
        );
        return;
      }

      const existingSession = loadGoogleSession();
      const currentSettings = settingsRef.current;
      const effectiveId = getEffectiveGoogleClientId(currentSettings);

      if (
        existingSession ||
        !currentSettings.googleAccountEmail ||
        !currentSettings.googleSpreadsheetId ||
        !effectiveId
      ) {
        return;
      }

      const reconnected = await trySilentGoogleReconnect(
        effectiveId,
        currentSettings.googleAccountEmail
      );
      if (cancelled || !reconnected) return;

      setGoogleSession(reconnected);
      try {
        const meta = await getSpreadsheetModifiedTime(
          reconnected.accessToken,
          currentSettings.googleSpreadsheetId
        );
        if (cancelled) return;
        const isRemoteNewer = Boolean(
          !meta.trashed &&
            isRemoteTimestampNewer(
              meta.modifiedTime,
              settingsRef.current.lastCloudModifiedTime
            )
        );
        const hasUnsaved =
          dataRevisionRef.current !== lastSyncedRevisionRef.current;

        if (isRemoteNewer && !hasUnsaved && !pendingCloudConflictRef.current) {
          await applyCloudPull(
            reconnected.accessToken,
            currentSettings.googleSpreadsheetId,
            settingsRef.current
          );
          if (!cancelled) {
            showSyncToast('다른 기기의 최신 변경사항을 불러왔습니다');
          }
        } else {
          setSyncStatus('synced');
        }
      } catch {
        if (!cancelled) {
          setSyncStatus('synced');
        }
      }
    };

    void initCloudBootstrap();

    return () => {
      cancelled = true;
    };
  }, [applyCloudPull, showSyncToast]);

  // 2) 탭 복귀(visibilitychange) 시 다른 기기의 최신 변경사항 자동 감지 및 Pull (15초 스로틀)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      const nowMs = Date.now();
      if (nowMs - lastVisibilityCheckAtRef.current < VISIBILITY_PULL_THROTTLE_MS) {
        return;
      }

      const activeSession = loadGoogleSession();
      const currentSettings = settingsRef.current;
      if (
        !activeSession ||
        !currentSettings.googleSpreadsheetId ||
        isPushingGoogleRef.current ||
        isPullingGoogleRef.current ||
        pendingCloudConflictRef.current ||
        dataRevisionRef.current !== lastSyncedRevisionRef.current
      ) {
        return;
      }

      lastVisibilityCheckAtRef.current = nowMs;
      try {
        const meta = await getSpreadsheetModifiedTime(
          activeSession.accessToken,
          currentSettings.googleSpreadsheetId
        );
        if (
          !meta.trashed &&
          isRemoteTimestampNewer(
            meta.modifiedTime,
            settingsRef.current.lastCloudModifiedTime
          ) &&
          dataRevisionRef.current === lastSyncedRevisionRef.current &&
          !pendingCloudConflictRef.current
        ) {
          await applyCloudPull(
            activeSession.accessToken,
            currentSettings.googleSpreadsheetId,
            settingsRef.current
          );
          showSyncToast('다른 기기의 최신 변경사항을 불러왔습니다');
        }
      } catch {
        const refreshed = loadGoogleSession();
        if (!refreshed) {
          setGoogleSession(null);
          setSyncStatus('local');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [applyCloudPull, showSyncToast]);

  // 3) 구글 로그인 & 자동 백업 활성화 시: 모든 탭 변경 후 2초 디바운스로 구글 시트 자동 백업
  useEffect(() => {
    if (dataRevision === 0) return;
    if (dataRevision === lastSyncedRevisionRef.current) return;
    if (
      !googleSession ||
      !settings.googleSpreadsheetId ||
      !settings.googleReceiptFolderId ||
      settings.googleAutoSync === false ||
      pendingCloudConflict
    ) {
      return;
    }

    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
    }
    autoSyncTimerRef.current = setTimeout(() => {
      void handleGooglePushAll(true);
    }, AUTO_SYNC_DEBOUNCE_MS);

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
    pendingCloudConflict,
    handleGooglePushAll,
  ]);

  // 4) 미저장 변경 대기 중 또는 업로드 중 브라우저 이탈 방지
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasActiveCloud = Boolean(
        loadGoogleSession() &&
          settingsRef.current.googleSpreadsheetId &&
          settingsRef.current.googleAutoSync !== false
      );
      if (!hasActiveCloud) return;
      const hasPendingSync =
        isPushingGoogleRef.current ||
        dataRevisionRef.current !== lastSyncedRevisionRef.current;
      if (!hasPendingSync) return;

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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
    const result = await SyncManager.pushAllToGas(url, {
      transactions: enrichAllTransactionsWithEvidence(transactions),
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

  const effectiveClientId = getEffectiveGoogleClientId(settings);

  const handleHeaderQuickSignIn = async () => {
    if (!effectiveClientId) {
      openSettingsAt('connection');
      return;
    }
    try {
      const res = await handleGoogleSignIn(effectiveClientId);
      if (res.autoBackedUp) {
        showSyncToast('구글 드라이브에 전체 데이터를 백업했습니다');
      } else if (!res.autoHydrated && !res.conflictPending) {
        showSyncToast('구글 드라이브에 연결되었습니다');
      }
    } catch (err) {
      setSyncStatus('local');
      showSyncToast(
        err instanceof Error ? err.message : '구글 로그인에 실패했습니다.',
        'warning'
      );
    }
  };

  const handleHeaderManualRefresh = async () => {
    try {
      await handleGooglePullAll();
      showSyncToast('구글 드라이브 최신 데이터를 불러왔습니다');
    } catch (err) {
      showSyncToast(
        err instanceof Error
          ? err.message
          : '최신 데이터를 불러오지 못했습니다.',
        'warning'
      );
    }
  };

  const renderSyncBadge = () => {
    if (syncStatus === 'syncing') {
      return (
        <span className="h-8 px-2.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#3182F6] animate-pulse shrink-0" />
          <span className="sm:hidden">동기화</span>
          <span className="hidden sm:inline">동기화 중</span>
        </span>
      );
    }
    if (settings.googleSpreadsheetUrl) {
      if (googleSession) {
        return (
          <div className="flex items-center gap-1 shrink-0">
            <a
              href={settings.googleSpreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="h-8 px-2.5 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#191F28] text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#00C471] shrink-0" />
              <span className="sm:hidden">시트</span>
              <span className="hidden sm:inline">내 드라이브 시트</span>
              <ExternalLink className="w-3 h-3 text-[#8B95A1] shrink-0" />
            </a>
            <button
              type="button"
              onClick={() => void handleHeaderManualRefresh()}
              aria-label="구글 드라이브 최신화"
              title="구글 드라이브 최신 데이터 불러오기"
              className="w-8 h-8 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#4E5968] flex items-center justify-center shrink-0 active:scale-[0.97] transition-all duration-150"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      }
      return (
        <button
          type="button"
          onClick={() => void handleHeaderQuickSignIn()}
          className="h-8 px-2.5 rounded-full bg-[#FFF8E6] hover:bg-[#FEF0C7] text-[#B45309] text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150"
        >
          <span className="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />
          <span>다시 연결</span>
        </button>
      );
    }
    if (syncStatus === 'synced' && settings.gasWebAppUrl.trim()) {
      return (
        <span className="h-8 px-2.5 rounded-full bg-[#F9FAFB] text-[#191F28] text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#00C471] shrink-0" />
          <span className="sm:hidden">연동</span>
          <span className="hidden sm:inline">시트 연동</span>
        </span>
      );
    }
    if (effectiveClientId) {
      return (
        <button
          type="button"
          onClick={() => void handleHeaderQuickSignIn()}
          className="h-8 px-2.5 rounded-full bg-[#3182F6] hover:bg-[#1B64DA] text-[#FFFFFF] text-[12px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150"
        >
          <LogIn className="w-3.5 h-3.5 shrink-0" />
          <span className="sm:hidden">로그인</span>
          <span className="hidden sm:inline">Google 로그인</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => openSettingsAt('connection')}
        className="h-8 px-2.5 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150"
      >
        <Cloud className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
        <span className="sm:hidden">드라이브</span>
        <span className="hidden sm:inline">드라이브 연결</span>
      </button>
    );
  };

  const hasGeminiKey = Boolean(settings.geminiApiKey?.trim());

  return (
    <div className="min-h-screen bg-[#F2F4F6] text-[#191F28]">
      {/* ===================================================================
          상단 글로벌 헤더 & 4대 뷰 네비게이션 (@media print 시 완벽 숨김)
         =================================================================== */}
      <header className="no-print sticky top-0 z-30 bg-[#FFFFFF]/95 backdrop-blur-md safe-area-top">
        <div className="max-w-[980px] mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2">
          {/* 좌측: 브랜드 & 귀속 연월 선택기 */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="hidden sm:flex w-9 h-9 rounded-2xl bg-[#3182F6] text-[#FFFFFF] items-center justify-center font-bold text-[15px] shrink-0">
              청
            </div>

            <div className="flex items-center bg-[#F9FAFB] rounded-full px-1 py-0.5 sm:px-1.5 sm:py-1 shrink-0">
              <button
                type="button"
                onClick={() => stepMonth(-1)}
                aria-label="이전 달"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="relative flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-full focus-within:ring-2 focus-within:ring-[#3182F6]/30">
                <Calendar className="w-3.5 h-3.5 text-[#3182F6] shrink-0 pointer-events-none" />
                <span className="text-[13.5px] sm:text-[15px] font-bold text-[#191F28] tabular-nums whitespace-nowrap pointer-events-none">
                  {formatYearMonthKorean(yearMonth)}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="w-3.5 h-3.5 text-[#4E5968] shrink-0 pointer-events-none"
                />
                <select
                  aria-label="귀속 연월 선택"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                >
                  {Array.from(new Set([...AVAILABLE_MONTHS, yearMonth]))
                    .sort()
                    .map((ym) => (
                      <option key={ym} value={ym}>
                        {formatYearMonthKorean(ym)}
                      </option>
                    ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => stepMonth(1)}
                aria-label="다음 달"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 우측: Gemini AI 배지 + 구글 시트 배지 + 연동 설정 */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openSettingsAt('gemini')}
              className={`h-8 px-2.5 rounded-full text-[12px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150 ${
                hasGeminiKey
                  ? 'bg-[#E8F3FF] text-[#1B64DA]'
                  : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
              <span className="sm:hidden">{hasGeminiKey ? 'AI ON' : 'AI'}</span>
              <span className="hidden sm:inline">
                {hasGeminiKey ? 'AI 스캔 ON' : 'AI 연결'}
              </span>
            </button>

            {renderSyncBadge()}

            <button
              type="button"
              onClick={() => openSettingsAt('connection')}
              aria-label="설정"
              className="w-8 h-8 sm:w-auto sm:px-3 rounded-full bg-[#E5E8EB] hover:bg-[#D1D6DB] text-[#191F28] text-[12.5px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150 ease-out"
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">설정</span>
            </button>
          </div>
        </div>

        {/* 4가지 뷰 모드 전환 네비게이션 탭 (모바일·데스크톱 공용 1줄 세그먼트) */}
        <div className="max-w-[980px] mx-auto px-3 sm:px-6 pb-2.5 sm:pb-3">
          <nav
            aria-label="주요 화면 전환"
            className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-4 gap-1"
          >
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`py-2 sm:py-2.5 px-1 sm:px-2.5 rounded-xl text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'ledger'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>장부</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('mokjang_share')}
              className={`py-2 sm:py-2.5 px-1 sm:px-2.5 rounded-xl text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'mokjang_share'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="sm:hidden">목장</span>
              <span className="hidden sm:inline">목장 현황</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('print_center')}
              className={`py-2 sm:py-2.5 px-1 sm:px-2.5 rounded-xl text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'print_center'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="sm:hidden">결산</span>
              <span className="hidden sm:inline">결산·인쇄</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('budget_builder')}
              className={`py-2 sm:py-2.5 px-1 sm:px-2.5 rounded-xl text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all duration-150 ease-out active:scale-[0.97] ${
                activeView === 'budget_builder'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Calculator className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="sm:hidden">예산안</span>
              <span className="hidden sm:inline">예산안·청구서</span>
            </button>
          </nav>
        </div>
      </header>

      {/* 클라우드 동기화 안내 토스트 (@media print 시 숨김) */}
      {syncToast && (
        <div className="no-print max-w-[980px] mx-auto px-4 sm:px-6 pt-3">
          <div
            className={`rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 text-[13px] font-semibold ${
              syncToast.tone === 'warning'
                ? 'bg-[#FFEEF0] text-[#F04452]'
                : 'bg-[#E8F3FF] text-[#1B64DA]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {syncToast.tone === 'warning' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <Cloud className="w-4 h-4 shrink-0" />
              )}
              <span className="break-words [word-break:keep-all]">
                {syncToast.text}
              </span>
            </div>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => setSyncToast(null)}
              className="p-1 rounded-lg opacity-70 hover:opacity-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 로컬 스토리지 용량 부족 경고 배너 (@media print 시 숨김) */}
      {storageQuotaWarning && (
        <div className="no-print max-w-[980px] mx-auto px-4 sm:px-6 pt-3">
          <div className="rounded-2xl bg-[#FFF8E6] px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 text-[13px] font-semibold text-[#B45309]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="break-words [word-break:keep-all]">
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

      {/* 구글 드라이브 ↔ 이 기기 동기화 충돌 선택 다이얼로그 */}
      <TdsDialog
        open={Boolean(pendingCloudConflict)}
        onClose={() => {
          // 해결 완료로 닫히는 네이티브 dialog close 이벤트나 처리 중 닫기는 무시
          if (isResolvingConflict || !pendingCloudConflictRef.current) return;
          // 실제 미해결 취소일 때만 세션을 보류해 2초 자동 푸시가 드라이브를 무단 덮어쓰는 것을 차단
          pendingCloudConflictRef.current = null;
          clearGoogleSession();
          setGoogleSession(null);
          setPendingCloudConflict(null);
          setSyncStatus('local');
          showSyncToast(
            '동기화 선택을 취소해 연결을 보류했습니다. 상단 [다시 연결]을 눌러주세요',
            'info'
          );
        }}
        title="구글 드라이브 동기화 선택"
        subtitle={pendingCloudConflict?.session.email}
        variant="modal"
      >
        <div className="space-y-4 pt-1">
          <p className="text-[14px] text-[#4E5968] leading-relaxed [word-break:keep-all]">
            이 기기와 구글 드라이브 모두에 작업 내역이 있습니다. 어느 데이터를
            기준으로 이어서 작업할까요?
          </p>

          <div className="rounded-2xl bg-[#F9FAFB] p-3.5 space-y-1.5 text-[13px] text-[#4E5968] tabular-nums">
            <div className="flex items-center justify-between">
              <span>이 기기 장부 내역</span>
              <span className="font-bold text-[#191F28]">
                {transactions.length}건
              </span>
            </div>
            {pendingCloudConflict?.remoteModifiedTime && (
              <div className="flex items-center justify-between">
                <span>구글 드라이브 최근 저장</span>
                <span className="font-semibold text-[#1B64DA]">
                  {new Date(
                    pendingCloudConflict.remoteModifiedTime
                  ).toLocaleString('ko-KR')}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={isResolvingConflict}
              onClick={() => void handleResolveCloudConflict('pull')}
              className="w-full h-12 rounded-2xl bg-[#3182F6] hover:bg-[#1B64DA] disabled:opacity-50 text-[#FFFFFF] text-[14.5px] font-bold active:scale-[0.97] transition-all duration-150"
            >
              {isResolvingConflict
                ? '동기화 처리 중...'
                : '구글 드라이브 최신 이어받기 (권장)'}
            </button>
            <button
              type="button"
              disabled={isResolvingConflict}
              onClick={() => void handleResolveCloudConflict('push')}
              className="w-full h-11 rounded-2xl bg-[#F2F4F6] hover:bg-[#E5E8EB] disabled:opacity-50 text-[#191F28] text-[13.5px] font-semibold active:scale-[0.97] transition-all duration-150"
            >
              이 기기 데이터로 드라이브 덮어쓰기
            </button>
          </div>
        </div>
      </TdsDialog>
    </div>
  );
};

export default App;
