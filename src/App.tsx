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
  FiscalYearCloudRef,
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
  listDriveFiscalYears,
  loadGoogleSession,
  pullAllFromGoogleSheets,
  pushAllToGoogleSheets,
  signInWithGoogle,
  trySilentGoogleReconnect,
} from './utils/googleDirectSync';
import { formatYearMonthKorean } from './utils/koreanCurrency';
import { notifyReceiptAuthChanged } from './utils/receiptImageLoader';
import {
  BudgetsMap,
  computeMonthlyLedger,
  computeYearEndBalancesByAccount,
  deriveDynamicFiscalSchema,
  enrichAllTransactionsWithEvidence,
  normalizeBudgetsMap,
  syncBudgetsWithDepartment,
  SyncManager,
} from './utils/syncManager';
import { BudgetBuilderView } from './components/BudgetBuilderView';
import { FiscalPeriodModal } from './components/FiscalPeriodModal';
import { LedgerView } from './components/LedgerView';
import { MokjangDashboardView } from './components/MokjangDashboardView';
import { NewFiscalYearModal } from './components/NewFiscalYearModal';
import { PrintCenterView } from './components/PrintCenterView';
import {
  SettingsTabType,
  SyncSettingsModal,
} from './components/SyncSettingsModal';
import { TdsDialog } from './components/TdsDialog';
import { TransactionBottomSheet } from './components/TransactionBottomSheet';

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

function pickDefaultMonthForFiscalYear(
  fiscalYear: number,
  txs: Transaction[],
  isProductionMode: boolean
): string {
  const now = new Date();
  if (now.getFullYear() === fiscalYear) {
    return `${fiscalYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (!isProductionMode && fiscalYear === 2026) {
    return '2026-11';
  }
  const yearMonths = txs
    .map((tx) => tx.date?.slice(0, 7) || '')
    .filter((ym) => ym.startsWith(`${fiscalYear}-`))
    .sort();
  if (yearMonths.length > 0) {
    return yearMonths[yearMonths.length - 1];
  }
  return `${fiscalYear}-01`;
}

function applyCloudRefToSettings(
  base: AppSettings,
  fiscalYear: number,
  ref?: FiscalYearCloudRef | null
): AppSettings {
  const fyKey = String(fiscalYear);
  const nextMap: Record<string, FiscalYearCloudRef> = {
    ...(base.fiscalYearWorkspaces || {}),
  };
  if (ref) {
    nextMap[fyKey] = ref;
  }
  return {
    ...base,
    fiscalYearWorkspaces: nextMap,
    googleSpreadsheetId: ref?.spreadsheetId || '',
    googleSpreadsheetUrl: ref?.spreadsheetUrl || '',
    googleReceiptFolderId: ref?.receiptFolderId || '',
    googleReceiptFolderUrl: ref?.receiptFolderUrl || '',
    lastSyncedAt: ref?.lastSyncedAt,
    lastCloudModifiedTime: ref?.lastCloudModifiedTime,
  };
}

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveViewMode>('ledger');
  const [activeFiscalYear, setActiveFiscalYear] = useState<number>(() =>
    SyncManager.loadActiveFiscalYear()
  );
  const activeFiscalYearRef = useRef<number>(activeFiscalYear);
  activeFiscalYearRef.current = activeFiscalYear;

  const [availableFiscalYears, setAvailableFiscalYears] = useState<number[]>(
    () => SyncManager.loadKnownFiscalYears()
  );
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState<boolean>(false);
  const [isNewFiscalYearOpen, setIsNewFiscalYearOpen] = useState<boolean>(false);
  const [isSwitchingYear, setIsSwitchingYear] = useState<boolean>(false);

  const [accountFilter, setAccountFilter] = useState<AccountType>('all');

  const [transactions, setTransactions] = useState<Transaction[]>(() =>
    SyncManager.loadTransactions(SyncManager.loadActiveFiscalYear())
  );
  const [budgets, setBudgets] = useState<BudgetsMap>(() =>
    SyncManager.loadBudgets(SyncManager.loadActiveFiscalYear())
  );
  const budgetsRef = useRef<BudgetsMap>(budgets);
  budgetsRef.current = budgets;
  const pendingDeptHealSyncRef = useRef<boolean>(false);
  const [mokjangs, setMokjangs] = useState<MokjangGroup[]>(() =>
    SyncManager.loadMokjangs(SyncManager.loadActiveFiscalYear())
  );
  const [settings, setSettings] = useState<AppSettings>(() => {
    const fy = SyncManager.loadActiveFiscalYear();
    const loaded = SyncManager.loadSettings();
    const ref = loaded.fiscalYearWorkspaces?.[String(fy)];
    return ref ? applyCloudRefToSettings(loaded, fy, ref) : loaded;
  });
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const [yearMonth, setYearMonth] = useState<string>(() => {
    const fy = SyncManager.loadActiveFiscalYear();
    const loadedSettings = SyncManager.loadSettings();
    const loadedTxs = SyncManager.loadTransactions(fy);
    return pickDefaultMonthForFiscalYear(
      fy,
      loadedTxs,
      loadedSettings.isProductionMode
    );
  });

  const [receiptLayouts, setReceiptLayouts] = useState<ReceiptBookLayoutsMap>(
    () => SyncManager.loadReceiptLayouts(SyncManager.loadActiveFiscalYear())
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

  const monthlyTxCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tx of transactions) {
      const ym = tx.date?.slice(0, 7);
      if (ym) {
        counts[ym] = (counts[ym] || 0) + 1;
      }
    }
    return counts;
  }, [transactions]);

  const currentYearClosingBalances = useMemo(
    () => computeYearEndBalancesByAccount(transactions),
    [transactions]
  );

  const mergeDiscoveredFiscalYears = useCallback((years: number[]) => {
    let nextYears = SyncManager.loadKnownFiscalYears();
    for (const y of years) {
      nextYears = SyncManager.registerFiscalYear(y);
    }
    setAvailableFiscalYears(nextYears);
  }, []);

  const handleSaveTransaction = async (savedTx: Transaction) => {
    const fy = activeFiscalYearRef.current;
    const exists = transactions.some((t) => t.id === savedTx.id);
    const nextTransactions = exists
      ? transactions.map((t) => (t.id === savedTx.id ? savedTx : t))
      : [...transactions, savedTx];

    setTransactions(nextTransactions);
    const savedLocal = SyncManager.saveTransactions(nextTransactions, fy);
    setStorageQuotaWarning(!savedLocal);
    bumpDataRevision();

    const txYm = savedTx.date.slice(0, 7);
    if (txYm.startsWith(`${fy}-`) && txYm !== yearMonth) {
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
            const savedDriveLocal = SyncManager.saveTransactions(withDrive, fy);
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
    const fy = activeFiscalYearRef.current;
    const nextTransactions = transactions.filter((t) => t.id !== id);
    setTransactions(nextTransactions);
    const savedLocal = SyncManager.saveTransactions(nextTransactions, fy);
    if (savedLocal) setStorageQuotaWarning(false);
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

  const handleUpdateBudgets = (nextBudgets: BudgetsMap) => {
    const fy = activeFiscalYearRef.current;
    const normalized = normalizeBudgetsMap(nextBudgets, fy);
    setBudgets(normalized);
    budgetsRef.current = normalized;
    SyncManager.saveBudgets(normalized, fy);
    bumpDataRevision();
  };

  const handleUpdateMokjangs = (nextMokjangs: MokjangGroup[]) => {
    const fy = activeFiscalYearRef.current;
    setMokjangs(nextMokjangs);
    SyncManager.saveMokjangs(nextMokjangs, fy);
    bumpDataRevision();
  };

  const handleAddCustomCategory = (
    type: TransactionType,
    newCategory: string,
    monthlyBudgetAmount?: number
  ) => {
    const fy = activeFiscalYearRef.current;
    if (type === 'income') {
      const nextCustom = Array.from(
        new Set([...(settings.customIncomeCategories || []), newCategory])
      );
      const nextSettings = { ...settings, customIncomeCategories: nextCustom };
      setSettings(nextSettings);
      settingsRef.current = nextSettings;
      SyncManager.saveSettings(nextSettings);
    } else {
      const nextCustom = Array.from(
        new Set([...(settings.customExpenseCategories || []), newCategory])
      );
      const nextSettings = { ...settings, customExpenseCategories: nextCustom };
      setSettings(nextSettings);
      settingsRef.current = nextSettings;
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
        handleUpdateBudgets({
          ...budgets,
          annual_budget: nextAnnualDoc,
        });
      }
    }
    void fy;
  };

  const handleUpdateSettings = (nextSettings: AppSettings) => {
    const prevSettings = settingsRef.current;
    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    SyncManager.saveSettings(nextSettings);

    // 전역 기본 정보(부서명·작성자)를 연간예산안·수련회청구서 문서에 단일 기준(SSOT)으로 전파
    const { budgets: syncedBudgets, changed: budgetsChanged } =
      syncBudgetsWithDepartment(
        budgetsRef.current,
        nextSettings.departmentName,
        prevSettings.departmentName,
        nextSettings.authorName,
        prevSettings.authorName
      );
    if (budgetsChanged) {
      setBudgets(syncedBudgets);
      budgetsRef.current = syncedBudgets;
      SyncManager.saveBudgets(syncedBudgets, activeFiscalYearRef.current);
    }

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
      const saved = SyncManager.saveReceiptLayouts(
        next,
        activeFiscalYearRef.current
      );
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
   * 구글 시트에서 특정 회계연도의 전체 데이터를 내려받아 로컬 상태와 저장소에 원자적으로 반영합니다.
   */
  const applyCloudPull = useCallback(
    async (
      accessToken: string,
      spreadsheetId: string,
      baseSettings: AppSettings,
      targetYear = activeFiscalYearRef.current
    ) => {
      if (isPullingGoogleRef.current) return null;
      isPullingGoogleRef.current = true;
      setSyncStatus('syncing');
      try {
        const pulled = await pullAllFromGoogleSheets(
          accessToken,
          spreadsheetId,
          baseSettings,
          targetYear
        );
        const { budgets: normalizedBudgets, changed: deptHealed } =
          syncBudgetsWithDepartment(
            pulled.budgets,
            pulled.settings.departmentName,
            undefined,
            pulled.settings.authorName
          );
        const existingRef = baseSettings.fiscalYearWorkspaces?.[String(targetYear)];
        const updatedRef: FiscalYearCloudRef = {
          folderId: existingRef?.folderId,
          folderUrl: existingRef?.folderUrl,
          spreadsheetId,
          spreadsheetUrl:
            existingRef?.spreadsheetUrl ||
            baseSettings.googleSpreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          receiptFolderId:
            existingRef?.receiptFolderId ||
            baseSettings.googleReceiptFolderId ||
            '',
          receiptFolderUrl:
            existingRef?.receiptFolderUrl ||
            baseSettings.googleReceiptFolderUrl ||
            '',
          lastSyncedAt: pulled.settings.lastSyncedAt,
          lastCloudModifiedTime:
            pulled.remoteModifiedTime || pulled.settings.lastCloudModifiedTime,
        };
        const syncedSettings = applyCloudRefToSettings(
          pulled.settings,
          targetYear,
          updatedRef
        );

        const savedTx = SyncManager.saveTransactions(
          pulled.transactions,
          targetYear
        );
        SyncManager.saveMokjangs(pulled.mokjangs, targetYear);
        SyncManager.saveBudgets(normalizedBudgets, targetYear);
        SyncManager.saveSettings(syncedSettings);
        const savedLayouts = SyncManager.saveReceiptLayouts(
          pulled.receiptLayouts,
          targetYear
        );

        if (activeFiscalYearRef.current === targetYear) {
          setTransactions(pulled.transactions);
          setMokjangs(pulled.mokjangs);
          setBudgets(normalizedBudgets);
          budgetsRef.current = normalizedBudgets;
          setSettings(syncedSettings);
          settingsRef.current = syncedSettings;
          setReceiptLayouts(pulled.receiptLayouts);
          receiptLayoutsRef.current = pulled.receiptLayouts;
          setStorageQuotaWarning(!savedTx || !savedLayouts);
          if (deptHealed) {
            bumpDataRevision();
          } else {
            lastSyncedRevisionRef.current = dataRevisionRef.current;
          }
          setSyncStatus('synced');
        }
        return {
          transactionCount: pulled.transactions.length,
          mokjangCount: pulled.mokjangs.length,
          annualBudgetCount: normalizedBudgets.annual_budget.items.length,
          retreatBudgetCount: normalizedBudgets.claims.reduce(
            (sum, c) => sum + c.items.length,
            0
          ),
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
    [bumpDataRevision]
  );

  /**
   * Google OAuth 로그인 + 회계연도별 드라이브 폴더(청년부_회계_통합관리/YYYY년/) 자동 연결 + 스마트 이어받기/충돌 보호
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

    const fy = activeFiscalYearRef.current;

    // 다른 계정으로 로그인한 경우 이전 계정의 워크스페이스 맵은 비우고 새 계정 드라이브에서 탐색/생성
    const isSameAccount = Boolean(
      settings.googleAccountEmail &&
        settings.googleAccountEmail === session.email
    );
    const existingFyRef = isSameAccount
      ? settings.fiscalYearWorkspaces?.[String(fy)]
      : undefined;

    const [workspace, remoteYears] = await Promise.all([
      ensureGoogleWorkspace(
        session.accessToken,
        settings.departmentName,
        fy,
        existingFyRef?.spreadsheetId ||
          (isSameAccount ? settings.googleSpreadsheetId : undefined)
      ),
      listDriveFiscalYears(session.accessToken),
    ]);
    mergeDiscoveredFiscalYears([...remoteYears, fy]);

    const newFyRef: FiscalYearCloudRef = {
      folderId: workspace.yearFolderId,
      folderUrl: workspace.yearFolderUrl,
      spreadsheetId: workspace.spreadsheetId,
      spreadsheetUrl: workspace.spreadsheetUrl,
      receiptFolderId: workspace.receiptFolderId,
      receiptFolderUrl: workspace.receiptFolderUrl,
      lastSyncedAt: isSameAccount ? existingFyRef?.lastSyncedAt : undefined,
      lastCloudModifiedTime: isSameAccount
        ? existingFyRef?.lastCloudModifiedTime || settings.lastCloudModifiedTime
        : undefined,
    };

    const baseNextSettings: AppSettings = {
      ...settings,
      googleClientId: cleanClientId,
      googleAccountEmail: session.email,
      googleAccountName: session.name,
      googleAutoSync: settings.googleAutoSync ?? true,
      fiscalYearWorkspaces: isSameAccount
        ? settings.fiscalYearWorkspaces || {}
        : {},
    };
    const nextSettings = applyCloudRefToSettings(baseNextSettings, fy, newFyRef);
    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    SyncManager.saveSettings(nextSettings);

    if (workspace.migratedFromLegacyRoot) {
      showSyncToast(
        `기존 시트·영수증을 드라이브 [${fy}년] 폴더로 안전하게 정리했습니다`
      );
    }

    // 1) 시트가 새로 생성되었거나 비어 있으면 해당 회기 전체 데이터를 즉시 첫 백업
    if (workspace.createdNewSpreadsheet || !workspace.hasExistingData) {
      const revisionAtPushStart = dataRevisionRef.current;
      const pushRes = await pushAllToGoogleSheets(
        session.accessToken,
        workspace.spreadsheetId,
        workspace.receiptFolderId,
        {
          fiscalYear: fy,
          transactions: enrichAllTransactionsWithEvidence(transactions),
          budgets,
          mokjangs,
          settings: nextSettings,
          receiptLayouts: receiptLayoutsRef.current,
        }
      );
      setTransactions(pushRes.updatedTransactions);
      const savedTx = SyncManager.saveTransactions(
        pushRes.updatedTransactions,
        fy
      );
      setStorageQuotaWarning(!savedTx);
      const syncedSettings = applyCloudRefToSettings(nextSettings, fy, {
        ...newFyRef,
        lastSyncedAt: pushRes.syncedAt,
        lastCloudModifiedTime: pushRes.remoteModifiedTime || pushRes.syncedAt,
      });
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
    const localKnownModified =
      existingFyRef?.lastCloudModifiedTime || settings.lastCloudModifiedTime;
    const isSameCloudVersion = Boolean(
      isSameAccount &&
        isSameCloudTimestamp(workspace.remoteModifiedTime, localKnownModified)
    );
    const isCloudNewer = isRemoteTimestampNewer(
      workspace.remoteModifiedTime,
      localKnownModified
    );

    if (isSameCloudVersion && !hasLocalUnsavedEdits) {
      setSyncStatus('synced');
      if (pendingDeptHealSyncRef.current) {
        pendingDeptHealSyncRef.current = false;
        bumpDataRevision();
      }
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
        nextSettings,
        fy
      );
      showSyncToast(`구글 드라이브의 ${fy}년 최신 작업을 불러왔습니다`);
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
    const fy = conflict.workspace.fiscalYear || activeFiscalYearRef.current;
    setIsResolvingConflict(true);
    try {
      if (choice === 'pull') {
        await applyCloudPull(
          conflict.session.accessToken,
          conflict.workspace.spreadsheetId,
          conflict.nextSettings,
          fy
        );
        pendingCloudConflictRef.current = null;
        setPendingCloudConflict(null);
        showSyncToast(`구글 드라이브의 ${fy}년 최신 작업을 이어받았습니다`);
      } else {
        setSyncStatus('syncing');
        const revisionAtPushStart = dataRevisionRef.current;
        const pushRes = await pushAllToGoogleSheets(
          conflict.session.accessToken,
          conflict.workspace.spreadsheetId,
          conflict.workspace.receiptFolderId,
          {
            fiscalYear: fy,
            transactions: enrichAllTransactionsWithEvidence(transactions),
            budgets,
            mokjangs,
            settings: conflict.nextSettings,
            receiptLayouts: receiptLayoutsRef.current,
          }
        );
        setTransactions(pushRes.updatedTransactions);
        const savedTx = SyncManager.saveTransactions(
          pushRes.updatedTransactions,
          fy
        );
        setStorageQuotaWarning(!savedTx);
        const prevRef = conflict.nextSettings.fiscalYearWorkspaces?.[String(fy)];
        const syncedSettings = applyCloudRefToSettings(
          conflict.nextSettings,
          fy,
          {
            folderId: prevRef?.folderId || conflict.workspace.yearFolderId,
            folderUrl: prevRef?.folderUrl || conflict.workspace.yearFolderUrl,
            spreadsheetId: conflict.workspace.spreadsheetId,
            spreadsheetUrl: conflict.workspace.spreadsheetUrl,
            receiptFolderId: conflict.workspace.receiptFolderId,
            receiptFolderUrl: conflict.workspace.receiptFolderUrl,
            lastSyncedAt: pushRes.syncedAt,
            lastCloudModifiedTime:
              pushRes.remoteModifiedTime || pushRes.syncedAt,
          }
        );
        setSettings(syncedSettings);
        settingsRef.current = syncedSettings;
        SyncManager.saveSettings(syncedSettings);
        lastSyncedRevisionRef.current = revisionAtPushStart;
        setSyncStatus('synced');
        pendingCloudConflictRef.current = null;
        setPendingCloudConflict(null);
        showSyncToast(`이 기기의 ${fy}년 데이터로 구글 드라이브를 업데이트했습니다`);
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
      const fy = activeFiscalYearRef.current;
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
      const sheetIdAtPush = settings.googleSpreadsheetId;
      const sheetUrlAtPush = settings.googleSpreadsheetUrl || '';
      const receiptIdAtPush = settings.googleReceiptFolderId;
      const receiptUrlAtPush = settings.googleReceiptFolderUrl || '';

      try {
        const res = await pushAllToGoogleSheets(
          activeSession.accessToken,
          sheetIdAtPush,
          receiptIdAtPush,
          {
            fiscalYear: fy,
            transactions: enrichAllTransactionsWithEvidence(transactions),
            budgets,
            mokjangs,
            settings,
            receiptLayouts,
          }
        );
        const savedTx = SyncManager.saveTransactions(res.updatedTransactions, fy);

        const latestSettings = settingsRef.current;
        const prevRef = latestSettings.fiscalYearWorkspaces?.[String(fy)];
        const updatedRef: FiscalYearCloudRef = {
          folderId: prevRef?.folderId,
          folderUrl: prevRef?.folderUrl,
          spreadsheetId: sheetIdAtPush,
          spreadsheetUrl: sheetUrlAtPush,
          receiptFolderId: receiptIdAtPush,
          receiptFolderUrl: receiptUrlAtPush,
          lastSyncedAt: res.syncedAt,
          lastCloudModifiedTime:
            res.remoteModifiedTime ||
            prevRef?.lastCloudModifiedTime ||
            res.syncedAt,
        };

        if (activeFiscalYearRef.current === fy) {
          setTransactions(res.updatedTransactions);
          setStorageQuotaWarning(!savedTx);
          const syncedSettings = applyCloudRefToSettings(
            latestSettings,
            fy,
            updatedRef
          );
          setSettings(syncedSettings);
          settingsRef.current = syncedSettings;
          SyncManager.saveSettings(syncedSettings);
          lastSyncedRevisionRef.current = revisionAtPushStart;
          setSyncStatus('synced');
        } else {
          // 회기 전환 중 완료된 푸시는 해당 회기의 워크스페이스 메타만 안전하게 기록
          const patchedSettings: AppSettings = {
            ...latestSettings,
            fiscalYearWorkspaces: {
              ...(latestSettings.fiscalYearWorkspaces || {}),
              [String(fy)]: updatedRef,
            },
          };
          setSettings(patchedSettings);
          settingsRef.current = patchedSettings;
          SyncManager.saveSettings(patchedSettings);
        }
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
    const fy = activeFiscalYearRef.current;
    if (!activeSession || !settings.googleSpreadsheetId) {
      setGoogleSession(null);
      throw new Error(
        '구글 로그인 세션이 만료되었습니다. 먼저 [Google 계정으로 로그인]을 눌러주세요.'
      );
    }

    const pulledSummary = await applyCloudPull(
      activeSession.accessToken,
      settings.googleSpreadsheetId,
      settings,
      fy
    );
    return (
      pulledSummary || {
        transactionCount: transactions.length,
        mokjangCount: mokjangs.length,
        annualBudgetCount: budgets.annual_budget.items.length,
        retreatBudgetCount: budgets.claims.reduce(
          (sum, c) => sum + c.items.length,
          0
        ),
      }
    );
  };

  /**
   * 회계연도(회기) 전환: 현재 회기 미저장 변경분 선반영 → 대상 회기 로컬 로드 → 로그인 시 드라이브 연도 폴더 연결·불러오기
   */
  const handleSwitchFiscalYear = async (
    targetYear: number,
    preferredMonth?: string
  ) => {
    if (targetYear === activeFiscalYearRef.current || isSwitchingYear) return;
    setIsSwitchingYear(true);

    try {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }

      const activeSession = loadGoogleSession();
      if (
        activeSession &&
        settingsRef.current.googleSpreadsheetId &&
        settingsRef.current.googleReceiptFolderId &&
        dataRevisionRef.current !== lastSyncedRevisionRef.current &&
        !pendingCloudConflictRef.current
      ) {
        await handleGooglePushAll(true);
      }

      const hadLocalTarget = SyncManager.hasLocalFiscalYearData(targetYear);
      SyncManager.saveActiveFiscalYear(targetYear);
      activeFiscalYearRef.current = targetYear;
      setActiveFiscalYear(targetYear);
      mergeDiscoveredFiscalYears([targetYear]);

      const nextTxs = SyncManager.loadTransactions(targetYear);
      const nextBudgets = SyncManager.loadBudgets(targetYear);
      const nextMokjangs = SyncManager.loadMokjangs(targetYear);
      const nextLayouts = SyncManager.loadReceiptLayouts(targetYear);

      setTransactions(nextTxs);
      setBudgets(nextBudgets);
      budgetsRef.current = nextBudgets;
      setMokjangs(nextMokjangs);
      setReceiptLayouts(nextLayouts);
      receiptLayoutsRef.current = nextLayouts;
      setAccountFilter('all');
      setYearMonth(
        preferredMonth && preferredMonth.startsWith(`${targetYear}-`)
          ? preferredMonth
          : pickDefaultMonthForFiscalYear(
              targetYear,
              nextTxs,
              settingsRef.current.isProductionMode
            )
      );

      // 전환 직후 불필요한 자동 푸시가 발생하지 않도록 리비전 기준선 동기화
      lastSyncedRevisionRef.current = dataRevisionRef.current;

      const existingRef =
        settingsRef.current.fiscalYearWorkspaces?.[String(targetYear)] || null;
      const switchedSettings = applyCloudRefToSettings(
        settingsRef.current,
        targetYear,
        existingRef
      );
      setSettings(switchedSettings);
      settingsRef.current = switchedSettings;
      SyncManager.saveSettings(switchedSettings);

      if (activeSession) {
        setSyncStatus('syncing');
        const workspace = await ensureGoogleWorkspace(
          activeSession.accessToken,
          switchedSettings.departmentName,
          targetYear,
          existingRef?.spreadsheetId
        );
        const cloudRef: FiscalYearCloudRef = {
          folderId: workspace.yearFolderId,
          folderUrl: workspace.yearFolderUrl,
          spreadsheetId: workspace.spreadsheetId,
          spreadsheetUrl: workspace.spreadsheetUrl,
          receiptFolderId: workspace.receiptFolderId,
          receiptFolderUrl: workspace.receiptFolderUrl,
          lastSyncedAt: existingRef?.lastSyncedAt,
          lastCloudModifiedTime: existingRef?.lastCloudModifiedTime,
        };
        const connectedSettings = applyCloudRefToSettings(
          switchedSettings,
          targetYear,
          cloudRef
        );
        setSettings(connectedSettings);
        settingsRef.current = connectedSettings;
        SyncManager.saveSettings(connectedSettings);

        const isCloudNewer = isRemoteTimestampNewer(
          workspace.remoteModifiedTime,
          existingRef?.lastCloudModifiedTime
        );

        if (workspace.hasExistingData && (!hadLocalTarget || isCloudNewer)) {
          await applyCloudPull(
            activeSession.accessToken,
            workspace.spreadsheetId,
            connectedSettings,
            targetYear
          );
          const refreshedTxs = SyncManager.loadTransactions(targetYear);
          if (!preferredMonth) {
            setYearMonth(
              pickDefaultMonthForFiscalYear(
                targetYear,
                refreshedTxs,
                connectedSettings.isProductionMode
              )
            );
          }
        } else if (
          (workspace.createdNewSpreadsheet || !workspace.hasExistingData) &&
          (nextTxs.length > 0 ||
            nextMokjangs.length > 0 ||
            nextBudgets.annual_budget.items.length > 0)
        ) {
          const pushRes = await pushAllToGoogleSheets(
            activeSession.accessToken,
            workspace.spreadsheetId,
            workspace.receiptFolderId,
            {
              fiscalYear: targetYear,
              transactions: enrichAllTransactionsWithEvidence(nextTxs),
              budgets: nextBudgets,
              mokjangs: nextMokjangs,
              settings: connectedSettings,
              receiptLayouts: nextLayouts,
            }
          );
          const savedSettings = applyCloudRefToSettings(
            connectedSettings,
            targetYear,
            {
              ...cloudRef,
              lastSyncedAt: pushRes.syncedAt,
              lastCloudModifiedTime:
                pushRes.remoteModifiedTime || pushRes.syncedAt,
            }
          );
          setSettings(savedSettings);
          settingsRef.current = savedSettings;
          SyncManager.saveSettings(savedSettings);
          setSyncStatus('synced');
        } else {
          setSyncStatus('synced');
        }
      } else {
        setSyncStatus(
          switchedSettings.gasWebAppUrl.trim() ? 'synced' : 'local'
        );
      }

      showSyncToast(`${targetYear}년 회기로 전환했습니다`);
    } catch (err) {
      showSyncToast(
        err instanceof Error
          ? err.message
          : '회계연도 전환 중 오류가 발생했습니다.',
        'warning'
      );
    } finally {
      setIsSwitchingYear(false);
    }
  };

  /**
   * 새 회계연도(1월~12월) 생성 및 직전 회기 계정별 기말잔액 전기이월 + 드라이브 연도 폴더 자동 생성
   */
  const handleCreateFiscalYear = async (params: {
    targetYear: number;
    carryoverByAccount: { general: number; retreat: number; mission: number };
    copyMokjangs: boolean;
    copyAnnualBudget: boolean;
  }) => {
    if (isSwitchingYear) return;
    setIsSwitchingYear(true);

    try {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }

      const activeSession = loadGoogleSession();
      if (
        activeSession &&
        settingsRef.current.googleSpreadsheetId &&
        settingsRef.current.googleReceiptFolderId &&
        dataRevisionRef.current !== lastSyncedRevisionRef.current &&
        !pendingCloudConflictRef.current
      ) {
        await handleGooglePushAll(true);
      }

      const created = SyncManager.createFiscalYearWorkspace({
        targetYear: params.targetYear,
        carryoverByAccount: params.carryoverByAccount,
        copyMokjangsFrom: params.copyMokjangs ? mokjangs : undefined,
        copyAnnualBudgetFrom: params.copyAnnualBudget
          ? budgets.annual_budget
          : undefined,
        settings: settingsRef.current,
      });

      activeFiscalYearRef.current = params.targetYear;
      setActiveFiscalYear(params.targetYear);
      mergeDiscoveredFiscalYears([params.targetYear]);

      setTransactions(created.transactions);
      setBudgets(created.budgets);
      budgetsRef.current = created.budgets;
      setMokjangs(created.mokjangs);
      setReceiptLayouts(created.receiptLayouts);
      receiptLayoutsRef.current = created.receiptLayouts;
      setAccountFilter('all');
      setYearMonth(`${params.targetYear}-01`);
      lastSyncedRevisionRef.current = dataRevisionRef.current;

      const baseSettings: AppSettings = applyCloudRefToSettings(
        {
          ...settingsRef.current,
          isProductionMode: true,
        },
        params.targetYear,
        null
      );
      setSettings(baseSettings);
      settingsRef.current = baseSettings;
      SyncManager.saveSettings(baseSettings);

      if (activeSession) {
        setSyncStatus('syncing');
        const workspace = await ensureGoogleWorkspace(
          activeSession.accessToken,
          baseSettings.departmentName,
          params.targetYear
        );
        const cloudRef: FiscalYearCloudRef = {
          folderId: workspace.yearFolderId,
          folderUrl: workspace.yearFolderUrl,
          spreadsheetId: workspace.spreadsheetId,
          spreadsheetUrl: workspace.spreadsheetUrl,
          receiptFolderId: workspace.receiptFolderId,
          receiptFolderUrl: workspace.receiptFolderUrl,
        };
        const linkedSettings = applyCloudRefToSettings(
          baseSettings,
          params.targetYear,
          cloudRef
        );
        const pushRes = await pushAllToGoogleSheets(
          activeSession.accessToken,
          workspace.spreadsheetId,
          workspace.receiptFolderId,
          {
            fiscalYear: params.targetYear,
            transactions: enrichAllTransactionsWithEvidence(
              created.transactions
            ),
            budgets: created.budgets,
            mokjangs: created.mokjangs,
            settings: linkedSettings,
            receiptLayouts: created.receiptLayouts,
          }
        );
        const syncedSettings = applyCloudRefToSettings(
          linkedSettings,
          params.targetYear,
          {
            ...cloudRef,
            lastSyncedAt: pushRes.syncedAt,
            lastCloudModifiedTime:
              pushRes.remoteModifiedTime || pushRes.syncedAt,
          }
        );
        setSettings(syncedSettings);
        settingsRef.current = syncedSettings;
        SyncManager.saveSettings(syncedSettings);
        setSyncStatus('synced');
      }

      setIsNewFiscalYearOpen(false);
      showSyncToast(
        `${params.targetYear}년 회기를 시작했습니다 (드라이브 ${params.targetYear}년 폴더 분리 완료)`
      );
    } catch (err) {
      showSyncToast(
        err instanceof Error
          ? err.message
          : '새 회계연도 생성 중 오류가 발생했습니다.',
        'warning'
      );
    } finally {
      setIsSwitchingYear(false);
    }
  };

  const stepMonth = (delta: -1 | 1) => {
    const [y, m] = yearMonth.split('-').map(Number);
    const nextMonth = m + delta;
    if (nextMonth >= 1 && nextMonth <= 12) {
      setYearMonth(`${y}-${String(nextMonth).padStart(2, '0')}`);
      return;
    }
    const targetYear = nextMonth < 1 ? y - 1 : y + 1;
    const targetYm = `${targetYear}-${nextMonth < 1 ? '12' : '01'}`;
    if (availableFiscalYears.includes(targetYear)) {
      void handleSwitchFiscalYear(targetYear, targetYm);
    } else {
      showSyncToast(
        nextMonth > 12
          ? `${y}년 마지막 달입니다. 연월을 눌러 ${targetYear}년 회기를 시작할 수 있어요`
          : `${y}년 첫 달입니다. 연월을 눌러 다른 회기로 이동할 수 있어요`,
        'info'
      );
    }
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
        fiscalYearWorkspaces: {},
        lastCloudModifiedTime: undefined,
      };
      setSettings(cleared);
      settingsRef.current = cleared;
      SyncManager.saveSettings(cleared);
    }
    setSyncStatus(settings.gasWebAppUrl.trim() ? 'synced' : 'local');
  };

  // Google 로그인 토큰 확보 시 마운트된 모든 영수증 이미지가 인증 Drive API로 즉시 재해석되도록 알림
  useEffect(() => {
    if (googleSession?.accessToken) {
      notifyReceiptAuthChanged();
    }
  }, [googleSession?.accessToken]);

  // 최초 로드 시 이미 변경된 부서명(settings.departmentName)과 불일치하는 구 샘플 부서명 예산 문서 자동 보정
  useEffect(() => {
    const { budgets: healedBudgets, changed } = syncBudgetsWithDepartment(
      budgetsRef.current,
      settingsRef.current.departmentName,
      undefined,
      settingsRef.current.authorName
    );
    if (changed) {
      setBudgets(healedBudgets);
      budgetsRef.current = healedBudgets;
      SyncManager.saveBudgets(healedBudgets, activeFiscalYearRef.current);
      // 이미 로그인 세션이 살아 있는 경우에만 즉시 클라우드 반영(미로그인 시 재연결 직후 자동 반영)
      if (loadGoogleSession()) {
        bumpDataRevision();
      } else {
        pendingDeptHealSyncRef.current = true;
      }
    }
  }, [bumpDataRevision]);

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
        const fy = activeFiscalYearRef.current;
        const [meta, remoteYears] = await Promise.all([
          getSpreadsheetModifiedTime(
            reconnected.accessToken,
            currentSettings.googleSpreadsheetId
          ),
          listDriveFiscalYears(reconnected.accessToken),
        ]);
        if (cancelled) return;
        mergeDiscoveredFiscalYears([...remoteYears, fy]);
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
            settingsRef.current,
            fy
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
  }, [applyCloudPull, mergeDiscoveredFiscalYears, showSyncToast]);

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
      const savedTx = SyncManager.saveTransactions(
        result.transactions,
        activeFiscalYearRef.current
      );
      if (!savedTx) setStorageQuotaWarning(true);
    }
    if (result.budgets) {
      const mergedBudgets = normalizeBudgetsMap(
        {
          annual_budget: result.budgets.annual_budget || budgets.annual_budget,
          retreat_claim: result.budgets.retreat_claim || budgets.retreat_claim,
          claims: result.budgets.claims || budgets.claims,
        },
        activeFiscalYearRef.current
      );
      setBudgets(mergedBudgets);
      budgetsRef.current = mergedBudgets;
      SyncManager.saveBudgets(mergedBudgets, activeFiscalYearRef.current);
    }
    if (Array.isArray(result.mokjangs) && result.mokjangs.length > 0) {
      setMokjangs(result.mokjangs);
      SyncManager.saveMokjangs(result.mokjangs, activeFiscalYearRef.current);
    }
    if (result.receiptLayouts) {
      setReceiptLayouts(result.receiptLayouts);
      receiptLayoutsRef.current = result.receiptLayouts;
      const savedLayouts = SyncManager.saveReceiptLayouts(
        result.receiptLayouts,
        activeFiscalYearRef.current
      );
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

        const fy = activeFiscalYearRef.current;
        setTransactions(result.transactions);
        const savedTx = SyncManager.saveTransactions(result.transactions, fy);

        const nextBudgets = normalizeBudgetsMap(
          {
            annual_budget:
              result.budgets.annual_budget || budgets.annual_budget,
            retreat_claim:
              result.budgets.retreat_claim || budgets.retreat_claim,
            claims: result.budgets.claims || undefined,
          },
          fy
        );
        setBudgets(nextBudgets);
        budgetsRef.current = nextBudgets;
        SyncManager.saveBudgets(nextBudgets, fy);

        const nextMokjangs =
          result.mokjangs !== null ? result.mokjangs : mokjangs;
        if (result.mokjangs !== null) {
          setMokjangs(nextMokjangs);
          SyncManager.saveMokjangs(nextMokjangs, fy);
        }

        const nextReceiptLayouts = result.receiptLayouts ?? {};
        setReceiptLayouts(nextReceiptLayouts);
        receiptLayoutsRef.current = nextReceiptLayouts;
        const savedLayouts = SyncManager.saveReceiptLayouts(
          nextReceiptLayouts,
          fy
        );
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
          settingsRef.current = merged;
          SyncManager.saveSettings(merged);
          setSyncStatus(merged.gasWebAppUrl.trim() ? 'synced' : 'local');
        }

        resolve({
          ok: true,
          message: `전체 복원 완료 (${fy}년) · 장부 ${result.transactions.length}건, 목장 ${nextMokjangs.length}개, 연간예산 ${nextBudgets.annual_budget.items.length}건, 청구서 ${nextBudgets.claims.length}건`,
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
    const fy = activeFiscalYearRef.current;
    const clean = SyncManager.resetAllDataClean(
      yearMonth,
      initialCarryover,
      keepConnections,
      fy
    );
    setTransactions(clean.transactions);
    setBudgets(clean.budgets);
    budgetsRef.current = clean.budgets;
    setMokjangs(clean.mokjangs);
    setSettings(clean.settings);
    settingsRef.current = clean.settings;
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
    const fy = activeFiscalYearRef.current;
    const reset = SyncManager.resetToSampleData(fy);
    setTransactions(reset.transactions);
    setBudgets(reset.budgets);
    budgetsRef.current = reset.budgets;
    setMokjangs(reset.mokjangs);
    setSettings(reset.settings);
    settingsRef.current = reset.settings;
    setReceiptLayouts(reset.receiptLayouts);
    receiptLayoutsRef.current = reset.receiptLayouts;
    setStorageQuotaWarning(false);
    setYearMonth(`${fy}-11`);
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
              className="h-7 sm:h-8 px-2 sm:px-2.5 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#191F28] text-[11.5px] sm:text-[12px] font-semibold flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#00C471] shrink-0" />
              <span className="sm:hidden">시트</span>
              <span className="hidden sm:inline">내 드라이브 시트</span>
              <ExternalLink className="hidden sm:block w-3 h-3 text-[#8B95A1] shrink-0" />
            </a>
            <button
              type="button"
              onClick={() => void handleHeaderManualRefresh()}
              aria-label="구글 드라이브 최신화"
              title="구글 드라이브 최신 데이터 불러오기"
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#4E5968] flex items-center justify-center shrink-0 active:scale-[0.97] transition-all duration-150"
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
          className="h-7 sm:h-8 px-2 sm:px-2.5 rounded-full bg-[#FFF8E6] hover:bg-[#FEF0C7] text-[#B45309] text-[11.5px] sm:text-[12px] font-semibold flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150"
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
        <div className="max-w-[980px] mx-auto px-2.5 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-1 sm:gap-2">
          {/* 좌측: 브랜드 & 귀속 연월 선택기 */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className="hidden sm:flex w-9 h-9 rounded-2xl bg-[#3182F6] text-[#FFFFFF] items-center justify-center font-bold text-[15px] shrink-0">
              청
            </div>

            <div className="flex items-center bg-[#F9FAFB] rounded-full px-0.5 py-0.5 sm:px-1.5 sm:py-1 shrink-0">
              <button
                type="button"
                onClick={() => stepMonth(-1)}
                aria-label="이전 달"
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsPeriodModalOpen(true)}
                aria-label="회계연도 및 귀속 월 선택"
                className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 py-1 rounded-full hover:bg-[#E5E8EB]/60 active:scale-[0.97] transition-all"
              >
                <Calendar className="hidden sm:block w-3.5 h-3.5 text-[#3182F6] shrink-0" />
                <span className="text-[13px] sm:text-[15px] font-bold text-[#191F28] tabular-nums whitespace-nowrap">
                  {formatYearMonthKorean(yearMonth)}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="w-3.5 h-3.5 text-[#4E5968] shrink-0"
                />
              </button>

              <button
                type="button"
                onClick={() => stepMonth(1)}
                aria-label="다음 달"
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 우측: Gemini AI 배지 + 구글 시트 배지 + 연동 설정 */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openSettingsAt('gemini')}
              className={`h-7 sm:h-8 px-2 sm:px-2.5 rounded-full text-[11.5px] sm:text-[12px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150 ${
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
              className="w-7 h-7 sm:w-auto sm:h-8 sm:px-3 rounded-full bg-[#E5E8EB] hover:bg-[#D1D6DB] text-[#191F28] text-[12.5px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap shrink-0 active:scale-[0.97] transition-all duration-150 ease-out"
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
            fiscalYear={activeFiscalYear}
            budgets={budgets}
            onUpdateBudgets={handleUpdateBudgets}
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
        activeFiscalYear={activeFiscalYear}
        availableFiscalYears={availableFiscalYears}
        onSwitchFiscalYear={(y) => void handleSwitchFiscalYear(y)}
        onOpenNewFiscalYear={() => {
          setIsSettingsOpen(false);
          setIsNewFiscalYearOpen(true);
        }}
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
            fiscalYear: activeFiscalYear,
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
          retreatBudgetCount: budgets.claims.reduce(
            (sum, c) => sum + c.items.length,
            0
          ),
          claimDocumentCount: budgets.claims.length,
        }}
      />

      {/* 회계연도(회기) 전환 및 1~12월 선택 모달 */}
      <FiscalPeriodModal
        open={isPeriodModalOpen}
        onClose={() => setIsPeriodModalOpen(false)}
        activeFiscalYear={activeFiscalYear}
        yearMonth={yearMonth}
        availableFiscalYears={availableFiscalYears}
        cloudWorkspaces={settings.fiscalYearWorkspaces}
        monthlyTxCounts={monthlyTxCounts}
        isSwitchingYear={isSwitchingYear}
        onSelectFiscalYear={(y) => void handleSwitchFiscalYear(y)}
        onSelectMonth={(ym) => setYearMonth(ym)}
        onOpenNewFiscalYear={() => setIsNewFiscalYearOpen(true)}
      />

      {/* 새 회계연도 시작(전기이월 자동 승계) 모달 */}
      <NewFiscalYearModal
        open={isNewFiscalYearOpen}
        onClose={() => setIsNewFiscalYearOpen(false)}
        sourceFiscalYear={activeFiscalYear}
        existingYears={availableFiscalYears}
        closingBalances={currentYearClosingBalances}
        mokjangCount={mokjangs.length}
        annualBudgetItemCount={budgets.annual_budget.items.length}
        isGoogleConnected={Boolean(googleSession)}
        isSubmitting={isSwitchingYear}
        onCreateFiscalYear={handleCreateFiscalYear}
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
