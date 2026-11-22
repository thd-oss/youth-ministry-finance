import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderOpen,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pin,
  RefreshCw,
  Rocket,
  RotateCcw,
  Smartphone,
  Sparkles,
  Upload,
} from 'lucide-react';
import { AppSettings, GeminiModelOption } from '../types/finance';
import { GAS_CODE_TEMPLATE } from '../utils/gasCodeTemplate';
import {
  BUILTIN_GOOGLE_CLIENT_ID,
  getEffectiveGoogleClientId,
  GoogleSession,
  GoogleWorkspaceInfo,
} from '../utils/googleDirectSync';
import { formatNumber } from '../utils/koreanCurrency';
import {
  FALLBACK_GEMINI_MODELS,
  fetchAvailableGeminiModels,
  sanitizeGeminiApiKey,
  testGeminiConnection,
} from '../utils/receiptAiAnalyzer';
import { TdsDialog } from './TdsDialog';

export type SettingsTabType = 'connection' | 'gemini' | 'backup';

interface DataSummaryInfo {
  transactionCount: number;
  mokjangCount: number;
  annualBudgetCount: number;
  retreatBudgetCount: number;
}

interface SyncSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTabType;
  settings: AppSettings;
  googleSession: GoogleSession | null;
  onSaveSettings: (next: AppSettings) => void;
  onGoogleSignIn: (clientId: string) => Promise<{
    session: GoogleSession;
    workspace: GoogleWorkspaceInfo;
    autoBackedUp: boolean;
    autoHydrated?: boolean;
    conflictPending?: boolean;
  }>;
  onGooglePushAll: () => Promise<void>;
  onGooglePullAll: () => Promise<{
    transactionCount: number;
    mokjangCount: number;
    annualBudgetCount: number;
    retreatBudgetCount: number;
  }>;
  onGoogleSignOut: (disconnectSheet?: boolean) => void;
  onPullFromGas: (url: string) => Promise<void>;
  onPushAllToGas: (url: string) => Promise<void>;
  onExportCsv: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => Promise<{ ok: boolean; message: string }>;
  onResetAllData: (initialCarryover: number, keepConnections: boolean) => void;
  onResetSampleData: () => void;
  dataSummary: DataSummaryInfo;
}

interface FeedbackBannerState {
  tone: 'info' | 'success' | 'error';
  message: string;
}

const DEFAULT_VISIBLE_GEMINI_MODELS = 6;

/**
 * 'Gemini 3 Flash Preview (최신 고속 비전 · 권장)' 형태에서
 * 괄호 내부의 간결한 한글 설명만 추출해 좁은 모바일 카드에서 깔끔하게 표시합니다.
 */
function formatCompactModelSubtitle(displayName: string): string {
  const parenMatch = displayName.match(/\(([^)]+)\)\s*$/);
  if (parenMatch?.[1]) {
    return parenMatch[1].trim();
  }
  return displayName;
}

export const SyncSettingsModal: React.FC<SyncSettingsModalProps> = ({
  open,
  onClose,
  initialTab = 'connection',
  settings,
  googleSession,
  onSaveSettings,
  onGoogleSignIn,
  onGooglePushAll,
  onGooglePullAll,
  onGoogleSignOut,
  onPullFromGas,
  onPushAllToGas,
  onExportCsv,
  onExportJson,
  onImportJson,
  onResetAllData,
  onResetSampleData,
  dataSummary,
}) => {
  const wasOpenRef = useRef<boolean>(false);

  const [activeTab, setActiveTab] = useState<SettingsTabType>(initialTab);
  const [clientIdInput, setClientIdInput] = useState<string>(
    getEffectiveGoogleClientId(settings)
  );
  const [showOAuthGuide, setShowOAuthGuide] = useState<boolean>(false);
  const [showLegacyGas, setShowLegacyGas] = useState<boolean>(false);
  const [showAdvancedFileBackup, setShowAdvancedFileBackup] =
    useState<boolean>(false);
  const [copiedOrigin, setCopiedOrigin] = useState<boolean>(false);
  const [copiedDeviceLink, setCopiedDeviceLink] = useState<boolean>(false);

  const [geminiKeyInput, setGeminiKeyInput] = useState<string>(
    settings.geminiApiKey || ''
  );
  const [geminiModelInput, setGeminiModelInput] = useState<string>(
    settings.geminiModel || 'gemini-3-flash-preview'
  );
  const [availableModels, setAvailableModels] = useState<GeminiModelOption[]>(
    () =>
      settings.availableGeminiModels &&
      settings.availableGeminiModels.length > 0
        ? settings.availableGeminiModels
        : FALLBACK_GEMINI_MODELS
  );
  const [hasFetchedLiveModels, setHasFetchedLiveModels] = useState<boolean>(
    () =>
      Boolean(
        settings.availableGeminiModels &&
          settings.availableGeminiModels.length > 0
      )
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [showAllModels, setShowAllModels] = useState<boolean>(false);

  const [urlInput, setUrlInput] = useState<string>(settings.gasWebAppUrl);
  const [deptInput, setDeptInput] = useState<string>(settings.departmentName);
  const [authorInput, setAuthorInput] = useState<string>(settings.authorName);

  const [carryoverStr, setCarryoverStr] = useState<string>('');
  const [keepConnectionsOnReset, setKeepConnectionsOnReset] =
    useState<boolean>(true);
  const [confirmResetStep, setConfirmResetStep] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FeedbackBannerState | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [isTestingModel, setIsTestingModel] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setActiveTab(initialTab);
      setClientIdInput(getEffectiveGoogleClientId(settings));
      setGeminiKeyInput(settings.geminiApiKey || '');
      setGeminiModelInput(settings.geminiModel || 'gemini-3-flash-preview');
      if (
        settings.availableGeminiModels &&
        settings.availableGeminiModels.length > 0
      ) {
        setAvailableModels(settings.availableGeminiModels);
        setHasFetchedLiveModels(true);
      } else {
        setAvailableModels(FALLBACK_GEMINI_MODELS);
        setHasFetchedLiveModels(false);
      }
      setUrlInput(settings.gasWebAppUrl || '');
      setDeptInput(settings.departmentName || '은혜교회 청년부');
      setAuthorInput(settings.authorName || '김송연');
      setConfirmResetStep(false);
      setCopiedDeviceLink(false);
      setShowAllModels(false);
      setFeedback(null);
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
  }, [open, initialTab, settings]);

  const parseDigits = (raw: string): number => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  const currentOrigin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://thd-oss.github.io';

  const handleCopyText = async (text: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    onDone();
  };

  // =========================================================================
  // Google OAuth 원클릭 로그인 & 시트 자동 생성/백업/복원
  // =========================================================================
  const handleClickGoogleSignIn = async () => {
    const targetClientId = clientIdInput.trim() || BUILTIN_GOOGLE_CLIENT_ID;
    if (!targetClientId) {
      setShowOAuthGuide(true);
      setFeedback({
        tone: 'error',
        message:
          '먼저 아래에 Google OAuth 클라이언트 ID를 입력해 주세요. (발급 가이드를 열었습니다)',
      });
      return;
    }

    setIsBusy(true);
    setFeedback({
      tone: 'info',
      message: 'Google 계정 로그인 및 전용 시트·영수증 폴더를 준비하는 중...',
    });
    try {
      const res = await onGoogleSignIn(targetClientId);
      if (res.conflictPending) {
        setFeedback({
          tone: 'info',
          message: `[${res.session.email}] 연결 완료! 드라이브와 이 기기 모두 작업 내역이 있어 선택 창을 열었습니다.`,
        });
        onClose();
      } else if (res.autoHydrated) {
        setFeedback({
          tone: 'success',
          message: `[${res.session.email}] 연결 완료! 구글 드라이브에 저장된 작업을 자동으로 불러왔습니다.`,
        });
      } else if (res.autoBackedUp) {
        setFeedback({
          tone: 'success',
          message: `[${res.session.email}] 연결 완료! 구글 드라이브에 시트와 영수증 폴더를 생성하고 전체 데이터를 백업했습니다.`,
        });
      } else {
        setFeedback({
          tone: 'success',
          message: `[${res.session.email}] 연결 완료! 기존 구글 시트를 찾았습니다.`,
        });
      }
    } catch (e) {
      setFeedback({
        tone: 'error',
        message:
          e instanceof Error
            ? e.message
            : '구글 로그인 중 오류가 발생했습니다.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleClickGooglePush = async () => {
    setIsBusy(true);
    setFeedback({
      tone: 'info',
      message:
        '장부·영수증·목장·연간예산안·청구서를 구글 시트와 드라이브에 백업하는 중...',
    });
    try {
      await onGooglePushAll();
      setFeedback({
        tone: 'success',
        message: '모든 탭의 데이터와 영수증이 구글 시트·드라이브에 백업되었습니다.',
      });
    } catch (e) {
      setFeedback({
        tone: 'error',
        message:
          e instanceof Error ? e.message : '구글 시트 백업 중 오류가 발생했습니다.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleClickGooglePull = async () => {
    setIsBusy(true);
    setFeedback({
      tone: 'info',
      message: '구글 시트에서 전체 데이터를 불러오는 중...',
    });
    try {
      const counts = await onGooglePullAll();
      setFeedback({
        tone: 'success',
        message: `시트 복원 완료 · 장부 ${counts.transactionCount}건, 목장 ${counts.mokjangCount}개, 연간예산 ${counts.annualBudgetCount}건, 청구서 ${counts.retreatBudgetCount}건`,
      });
    } catch (e) {
      setFeedback({
        tone: 'error',
        message:
          e instanceof Error
            ? e.message
            : '구글 시트 불러오기 중 오류가 발생했습니다.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  // =========================================================================
  // Gemini AI 모델 조회 및 고정
  // =========================================================================
  const handleFetchAvailableModels = async () => {
    const cleanKey = sanitizeGeminiApiKey(geminiKeyInput);
    if (!cleanKey) {
      setFeedback({
        tone: 'error',
        message: '먼저 Gemini API 키(AIzaSy...)를 입력해 주세요.',
      });
      return;
    }

    setIsFetchingModels(true);
    setFeedback({
      tone: 'info',
      message: '사용 가능한 최신 Gemini 모델 목록을 불러오는 중...',
    });

    const result = await fetchAvailableGeminiModels(cleanKey);
    setIsFetchingModels(false);

    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.message });
      return;
    }

    setGeminiKeyInput(cleanKey);
    setAvailableModels(result.models);
    setHasFetchedLiveModels(true);

    const stillExists = result.models.some((m) => m.id === geminiModelInput);
    const nextSelectedModel = stillExists
      ? geminiModelInput
      : result.recommendedModelId || result.models[0].id;

    setGeminiModelInput(nextSelectedModel);

    onSaveSettings({
      ...settings,
      geminiApiKey: cleanKey,
      geminiModel: nextSelectedModel,
      availableGeminiModels: result.models,
    });

    setFeedback({
      tone: 'success',
      message: `${result.message} (자동 선택: ${nextSelectedModel})`,
    });
  };

  const handleVerifyAndPinModel = async () => {
    const cleanKey = sanitizeGeminiApiKey(geminiKeyInput);
    if (!cleanKey) {
      onSaveSettings({ ...settings, geminiApiKey: '' });
      setFeedback({ tone: 'info', message: 'Gemini API 키가 해제되었습니다.' });
      return;
    }

    setIsTestingModel(true);
    let currentModels = availableModels;
    let targetModel = geminiModelInput;

    if (!hasFetchedLiveModels) {
      setFeedback({
        tone: 'info',
        message: '사용 가능한 모델 목록을 먼저 조회하는 중...',
      });
      const listRes = await fetchAvailableGeminiModels(cleanKey);
      if (!listRes.ok) {
        setIsTestingModel(false);
        setFeedback({ tone: 'error', message: listRes.message });
        return;
      }
      currentModels = listRes.models;
      setAvailableModels(currentModels);
      setHasFetchedLiveModels(true);

      const existsInLive = currentModels.some((m) => m.id === targetModel);
      if (!existsInLive) {
        targetModel = listRes.recommendedModelId || currentModels[0].id;
        setGeminiModelInput(targetModel);
      }
    }

    setFeedback({
      tone: 'info',
      message: `[${targetModel}] 모델 응답 테스트 및 고정 중...`,
    });

    const verifyResult = await testGeminiConnection(cleanKey, targetModel);
    setIsTestingModel(false);

    if (verifyResult.ok) {
      setGeminiKeyInput(cleanKey);
      setGeminiModelInput(verifyResult.verifiedModel);
      onSaveSettings({
        ...settings,
        geminiApiKey: cleanKey,
        geminiModel: verifyResult.verifiedModel,
        availableGeminiModels: currentModels,
      });
      setFeedback({ tone: 'success', message: verifyResult.message });
    } else {
      setFeedback({ tone: 'error', message: verifyResult.message });
    }
  };

  const handleSaveBasic = () => {
    onSaveSettings({
      ...settings,
      googleClientId: clientIdInput.trim(),
      gasWebAppUrl: urlInput.trim(),
      departmentName: deptInput.trim() || '은혜교회 청년부',
      authorName: authorInput.trim() || '김송연',
    });
    setFeedback({
      tone: 'success',
      message: '기본 정보가 저장되었습니다.',
    });
  };

  const handleLegacyGasPush = async () => {
    if (!urlInput.trim()) {
      setFeedback({
        tone: 'error',
        message: 'Google Apps Script 웹 앱 URL을 입력해 주세요.',
      });
      return;
    }
    setIsBusy(true);
    setFeedback({ tone: 'info', message: 'Apps Script로 업로드하는 중...' });
    try {
      onSaveSettings({
        ...settings,
        gasWebAppUrl: urlInput.trim(),
        departmentName: deptInput.trim() || '은혜교회 청년부',
        authorName: authorInput.trim() || '김송연',
      });
      await onPushAllToGas(urlInput.trim());
      setFeedback({ tone: 'success', message: '업로드가 완료되었습니다.' });
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: `업로드 실패: ${
          e instanceof Error ? e.message : 'URL을 확인하세요.'
        }`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleLegacyGasPull = async () => {
    if (!urlInput.trim()) {
      setFeedback({
        tone: 'error',
        message: 'Google Apps Script 웹 앱 URL을 입력해 주세요.',
      });
      return;
    }
    setIsBusy(true);
    setFeedback({ tone: 'info', message: 'Apps Script에서 불러오는 중...' });
    try {
      onSaveSettings({ ...settings, gasWebAppUrl: urlInput.trim() });
      await onPullFromGas(urlInput.trim());
      setFeedback({ tone: 'success', message: '데이터를 불러왔습니다.' });
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: `불러오기 실패: ${
          e instanceof Error ? e.message : 'URL을 확인하세요.'
        }`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const isPinnedModel =
    Boolean(settings.geminiApiKey?.trim()) &&
    settings.geminiModel === geminiModelInput;

  const hasLinkedSheet = Boolean(settings.googleSpreadsheetUrl);
  const effectiveClientId = clientIdInput.trim() || BUILTIN_GOOGLE_CLIENT_ID;
  const currentPathname =
    typeof window !== 'undefined' && window.location.pathname
      ? window.location.pathname
      : '/';
  const multiDeviceShareUrl = effectiveClientId
    ? !BUILTIN_GOOGLE_CLIENT_ID
      ? `${currentOrigin}${currentPathname}?gclient=${encodeURIComponent(effectiveClientId)}`
      : `${currentOrigin}${currentPathname}`
    : '';

  return (
    <TdsDialog open={open} onClose={onClose} title="설정" variant="modal">
      <div className="space-y-5">
        {/* 상단 탭 전환 (3개 핵심 탭) */}
        <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-3 gap-1">
          {[
            { id: 'connection', label: '구글 백업' },
            { id: 'gemini', label: 'AI 연결' },
            { id: 'backup', label: '초기화·파일' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as SettingsTabType);
                setFeedback(null);
              }}
              className={`py-2.5 px-1.5 sm:px-2 rounded-xl text-[12px] sm:text-[13px] font-semibold whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
                activeTab === tab.id
                  ? 'bg-[#FFFFFF] text-[#191F28]'
                  : 'text-[#8B95A1] hover:text-[#4E5968]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 상단 고정 피드백 배너 */}
        {feedback && (
          <div
            className={`px-4 py-3.5 rounded-2xl text-[13px] font-semibold flex items-start gap-2.5 ${
              feedback.tone === 'error'
                ? 'bg-[#FFEEF0] text-[#F04452]'
                : feedback.tone === 'success'
                  ? 'bg-[#E8F3FF] text-[#1B64DA]'
                  : 'bg-[#F9FAFB] text-[#4E5968]'
            }`}
          >
            {feedback.tone === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : feedback.tone === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin text-[#3182F6]" />
            )}
            <span className="leading-snug break-words [word-break:keep-all]">
              {feedback.message}
            </span>
          </div>
        )}

        {/* =================================================================
            탭 1: 구글 계정 로그인 · 시트 자동 생성 & 일원화 백업
           ================================================================= */}
        {activeTab === 'connection' && (
          <div className="space-y-4">
            {/* 메인 Google 계정 통합 백업 카드 */}
            <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold text-[#191F28]">
                    구글 시트 원클릭 통합 백업
                  </div>
                  <p className="text-[12px] text-[#4E5968] mt-0.5 break-words [word-break:keep-all]">
                    구글 계정 로그인 한 번으로 드라이브에 전용 시트(장부·목장·예산안·청구서·설정)와 영수증 폴더를 자동 생성하고 관리합니다.
                  </p>
                </div>
                {hasLinkedSheet && (
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap ${
                      googleSession
                        ? 'bg-[#E8F3FF] text-[#1B64DA]'
                        : 'bg-[#FFF8E6] text-[#B45309]'
                    }`}
                  >
                    {googleSession ? '연결됨' : '재로그인 필요'}
                  </span>
                )}
              </div>

              {/* 연결된 계정 & 시트/폴더 바로 열기 카드 */}
              {hasLinkedSheet && (
                <div className="bg-[#FFFFFF] rounded-2xl p-3 sm:p-4 space-y-3 border border-[#E5E8EB]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold text-[#191F28] truncate">
                        {settings.googleAccountName || '연결된 구글 계정'}
                      </div>
                      <div className="text-[12px] text-[#8B95A1] truncate">
                        {settings.googleAccountEmail}
                      </div>
                    </div>
                    {settings.lastSyncedAt && (
                      <span className="text-[11px] text-[#8B95A1] tabular-nums">
                        최근 백업:{' '}
                        {new Date(settings.lastSyncedAt).toLocaleString(
                          'ko-KR',
                          {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }
                        )}
                      </span>
                    )}
                  </div>

                  {/* 시트 & 영수증 폴더 원클릭 바로 열기 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <a
                      href={settings.googleSpreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-10 py-2 px-3 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap hover:underline"
                    >
                      <FileSpreadsheet className="w-4 h-4 shrink-0" />
                      <span>내 구글 시트 열기</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>

                    {settings.googleReceiptFolderUrl && (
                      <a
                        href={settings.googleReceiptFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-h-10 py-2 px-3 rounded-xl bg-[#F2F4F6] text-[#191F28] text-[12.5px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-[#E5E8EB]"
                      >
                        <FolderOpen className="w-4 h-4 text-[#3182F6] shrink-0" />
                        <span>영수증 폴더 열기</span>
                        <ExternalLink className="w-3.5 h-3.5 text-[#8B95A1] shrink-0" />
                      </a>
                    )}
                  </div>

                  {/* 백업 / 불러오기 / 재로그인 액션 */}
                  {googleSession ? (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={handleClickGooglePush}
                          className="min-h-10 py-2 px-3 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.97] disabled:opacity-50"
                        >
                          <CloudUpload className="w-4 h-4 shrink-0" />
                          <span>시트로 지금 백업</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={handleClickGooglePull}
                          className="min-h-10 py-2 px-3 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[13px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.97] disabled:opacity-50"
                        >
                          <CloudDownload className="w-4 h-4 shrink-0" />
                          <span>시트에서 불러오기</span>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#4E5968] cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={settings.googleAutoSync !== false}
                            onChange={(e) =>
                              onSaveSettings({
                                ...settings,
                                googleAutoSync: e.target.checked,
                              })
                            }
                            className="w-4 h-4 accent-[#3182F6] rounded"
                          />
                          <span>변경 시 구글 시트 자동 백업</span>
                        </label>

                        <div className="flex items-center gap-3 text-[12px]">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={handleClickGoogleSignIn}
                            className="font-semibold text-[#4E5968] hover:text-[#191F28] whitespace-nowrap"
                          >
                            계정 전환
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onGoogleSignOut(true);
                              setFeedback({
                                tone: 'info',
                                message: '구글 시트 연결이 해제되었습니다.',
                              });
                            }}
                            className="font-semibold text-[#F04452] flex items-center gap-1 whitespace-nowrap hover:underline"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>연결 해제</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={handleClickGoogleSignIn}
                        className="w-full sm:flex-1 min-h-10 py-2 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.97] disabled:opacity-50"
                      >
                        <LogIn className="w-4 h-4 shrink-0" />
                        <span>Google 계정 다시 로그인</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onGoogleSignOut(true);
                          setFeedback({
                            tone: 'info',
                            message: '구글 시트 연결이 해제되었습니다.',
                          });
                        }}
                        className="w-full sm:w-auto min-h-10 py-2 px-3 rounded-xl bg-[#F2F4F6] text-[#F04452] text-[12px] font-semibold whitespace-nowrap"
                      >
                        연결 해제
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 최초 연결 버튼 (미연결 시) */}
              {!hasLinkedSheet && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleClickGoogleSignIn}
                  className="w-full min-h-12 py-2.5 px-4 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[14px] font-bold flex items-center justify-center gap-2 whitespace-nowrap active:scale-[0.97] transition-all disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <LogIn className="w-4 h-4 shrink-0" />
                  )}
                  <span>Google 로그인 · 시트 연결</span>
                </button>
              )}

              {/* 멀티 디바이스 이어쓰기 보조 영역 */}
              {Boolean(effectiveClientId) && (
                <div className="bg-[#FFFFFF] rounded-2xl p-3 sm:p-4 space-y-2.5 border border-[#E5E8EB]">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center shrink-0">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="text-[13.5px] font-bold text-[#191F28]">
                      다른 기기에서 바로 이어쓰기
                    </div>
                  </div>
                  <p className="text-[12px] text-[#4E5968] leading-relaxed break-words [word-break:keep-all]">
                    폰·태블릿·다른 PC에서 같은 구글 계정으로 로그인하면 장부·목장·3차 예산안·영수증을 바로 이어서 작업합니다.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(multiDeviceShareUrl, () => {
                        setCopiedDeviceLink(true);
                        setTimeout(() => setCopiedDeviceLink(false), 2000);
                      })
                    }
                    className={`w-full h-10 px-3.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all ${
                      copiedDeviceLink
                        ? 'bg-[#E8F3FF] text-[#1B64DA]'
                        : 'bg-[#F2F4F6] text-[#191F28] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {copiedDeviceLink ? (
                      <>
                        <Check className="w-4 h-4 text-[#3182F6]" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-[#3182F6]" />
                        <span>다른 기기 연결 주소 복사</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* OAuth 클라이언트 ID 입력 (내장 ID가 없거나 직접 변경할 때) */}
              {!BUILTIN_GOOGLE_CLIENT_ID && (
                <div className="space-y-2 pt-2 border-t border-[#E5E8EB]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[12px] font-bold text-[#4E5968] min-w-0">
                      Google OAuth 클라이언트 ID (최초 1회)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowOAuthGuide((p) => !p)}
                      className="text-[12px] font-bold text-[#3182F6] flex items-center gap-0.5 whitespace-nowrap shrink-0 hover:underline"
                    >
                      <span>발급 방법 3분 가이드</span>
                      {showOAuthGuide ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <input
                    type="text"
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13px] font-mono text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />

                  {showOAuthGuide && (
                    <div className="bg-[#FFFFFF] rounded-xl p-3 sm:p-3.5 space-y-2 text-[12px] text-[#4E5968] leading-relaxed border border-[#E5E8EB]">
                      <div className="font-bold text-[#191F28]">
                        Google Cloud OAuth 클라이언트 ID 발급 (최초 1회 · 무료)
                      </div>
                      <ol className="list-decimal pl-4 space-y-1.5">
                        <li>
                          <a
                            href="https://console.cloud.google.com/apis/library"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#3182F6] font-bold hover:underline"
                          >
                            Google Cloud Console ↗
                          </a>
                          에서 새 프로젝트를 만들고, 라이브러리에서{' '}
                          <strong>Google Sheets API</strong>와{' '}
                          <strong>Google Drive API</strong> 2개를 [사용] 설정합니다.
                        </li>
                        <li>
                          좌측 <strong>[Google Auth Platform → 대상(Audience)]</strong>에서
                          외부(External) 선택 후 <strong>[앱 게시(프로덕션)]</strong>을 누릅니다.
                        </li>
                        <li>
                          <strong>[클라이언트 → 클라이언트 만들기]</strong>에서 유형을{' '}
                          <strong>웹 애플리케이션</strong>으로 선택하고,{' '}
                          <strong>승인된 자바스크립트 원본</strong>에 아래 주소를 추가합니다:
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <code className="px-2 py-1 rounded bg-[#F2F4F6] text-[#191F28] font-mono text-[11.5px] select-all min-w-0 break-all">
                              {currentOrigin}
                            </code>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(currentOrigin, () => {
                                  setCopiedOrigin(true);
                                  setTimeout(() => setCopiedOrigin(false), 2000);
                                })
                              }
                              className="px-2 py-1 rounded bg-[#E8F3FF] text-[#1B64DA] text-[11px] font-bold whitespace-nowrap shrink-0"
                            >
                              {copiedOrigin ? '복사됨' : '주소 복사'}
                            </button>
                          </div>
                        </li>
                        <li>
                          생성된 <strong>클라이언트 ID</strong>(<code className="break-all">...apps.googleusercontent.com</code>)를 위 칸에 붙여넣고 로그인하면 끝!
                        </li>
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 부서 기본 정보 */}
            <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    청년부 소속 명칭 (인쇄 표기)
                  </label>
                  <input
                    type="text"
                    value={deptInput}
                    onChange={(e) => setDeptInput(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    회계 담당자 성명
                  </label>
                  <input
                    type="text"
                    value={authorInput}
                    onChange={(e) => setAuthorInput(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveBasic}
                className="px-4 py-2 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[12.5px] font-bold active:scale-[0.97]"
              >
                기본 정보 저장
              </button>
            </div>

            {/* 구버전 Apps Script 연결 (접이식) */}
            <div className="bg-[#F9FAFB] rounded-2xl p-4">
              <button
                type="button"
                onClick={() => setShowLegacyGas((p) => !p)}
                className="w-full flex items-center justify-between text-[12.5px] font-semibold text-[#8B95A1]"
              >
                <span>고급: Apps Script 웹 앱 URL 직접 연동</span>
                {showLegacyGas ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showLegacyGas && (
                <div className="mt-3 pt-3 border-t border-[#E5E8EB] space-y-3">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13px] text-[#191F28] focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleLegacyGasPush}
                      className="px-3 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold"
                    >
                      업로드
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleLegacyGasPull}
                      className="px-3 py-2 rounded-xl bg-[#E5E8EB] text-[#191F28] text-[12px] font-bold"
                    >
                      불러오기
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(GAS_CODE_TEMPLATE, () => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        })
                      }
                      className="px-3 py-2 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copied ? '복사됨' : 'Code.gs 복사'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================
            탭 2: Gemini AI 영수증 스캐너 연결
           ================================================================= */}
        {activeTab === 'gemini' && (
          <div className="space-y-4">
            <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[15px] font-bold text-[#191F28]">
                  <Sparkles className="w-4 h-4 text-[#3182F6] shrink-0" />
                  <span>Gemini API 키 & 모델 설정</span>
                </div>

                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold inline-flex items-center justify-center gap-1 shrink-0 whitespace-nowrap hover:underline"
                >
                  <KeyRound className="w-3.5 h-3.5 shrink-0" />
                  <span>API 키 발급</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>

              {settings.geminiApiKey && (
                <div className="bg-[#FFFFFF] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] min-w-0 flex-1">
                    <span className="px-2 py-0.5 rounded-md bg-[#E8F3FF] text-[#1B64DA] font-bold shrink-0 whitespace-nowrap">
                      현재 고정 모델
                    </span>
                    <span className="font-mono font-bold text-[#191F28] break-all min-w-0">
                      {settings.geminiModel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setGeminiKeyInput('');
                      onSaveSettings({ ...settings, geminiApiKey: '' });
                      setFeedback({
                        tone: 'info',
                        message: '저장된 Gemini API 키가 삭제되었습니다.',
                      });
                    }}
                    className="text-[12px] font-semibold text-[#F04452] whitespace-nowrap shrink-0 hover:underline"
                  >
                    API 키 연결 해제
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[12.5px] font-bold text-[#191F28]">
                  1. API 키 입력
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={geminiKeyInput}
                      onChange={(e) => setGeminiKeyInput(e.target.value)}
                      placeholder="AIzaSy... API 키 입력"
                      className="w-full h-11 pl-3.5 pr-10 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:ring-2 focus:ring-[#3182F6] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B95A1] hover:text-[#4E5968]"
                    >
                      {showApiKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isFetchingModels || isTestingModel}
                    onClick={handleFetchAvailableModels}
                    className="h-11 px-4 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[13px] font-bold flex items-center justify-center gap-1.5 shrink-0 active:scale-[0.97] disabled:opacity-50"
                  >
                    {isFetchingModels ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    <span>사용 가능 모델 불러오기</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-[#E5E8EB]">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[12.5px] font-bold text-[#191F28]">
                    2. 모델 선택 ({availableModels.length}개)
                  </label>
                  {hasFetchedLiveModels && (
                    <span className="px-2 py-0.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11px] font-bold">
                      조회 완료
                    </span>
                  )}
                </div>

                <select
                  value={geminiModelInput}
                  onChange={(e) => setGeminiModelInput(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FFFFFF] text-[13px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(showAllModels
                    ? availableModels
                    : availableModels.slice(0, DEFAULT_VISIBLE_GEMINI_MODELS)
                  ).map((m, idx) => {
                    const selected = geminiModelInput === m.id;
                    const pinned =
                      Boolean(settings.geminiApiKey?.trim()) &&
                      settings.geminiModel === m.id;
                    const compactSubtitle = formatCompactModelSubtitle(
                      m.displayName
                    );

                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setGeminiModelInput(m.id)}
                        className={`p-3 rounded-xl text-left transition-all flex items-start justify-between gap-2 min-w-0 ${
                          selected
                            ? 'bg-[#3182F6] text-[#FFFFFF]'
                            : 'bg-[#FFFFFF] text-[#191F28] hover:bg-[#E5E8EB]/60'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[12.5px] font-bold font-mono truncate">
                              {m.id}
                            </span>
                            {idx === 0 && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 whitespace-nowrap ${
                                  selected
                                    ? 'bg-[#FFFFFF]/20 text-[#FFFFFF]'
                                    : 'bg-[#E8F3FF] text-[#1B64DA]'
                                }`}
                              >
                                추천
                              </span>
                            )}
                          </div>
                          <div
                            className={`text-[11.5px] leading-snug break-words [word-break:keep-all] mt-0.5 ${
                              selected ? 'text-[#FFFFFF]/85' : 'text-[#8B95A1]'
                            }`}
                          >
                            {compactSubtitle}
                          </div>
                        </div>

                        {pinned && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 whitespace-nowrap ${
                              selected
                                ? 'bg-[#FFFFFF] text-[#3182F6]'
                                : 'bg-[#191F28] text-[#FFFFFF]'
                            }`}
                          >
                            고정됨
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {availableModels.length > DEFAULT_VISIBLE_GEMINI_MODELS && (
                  <button
                    type="button"
                    onClick={() => setShowAllModels((prev) => !prev)}
                    className="w-full py-2 rounded-xl bg-[#FFFFFF] text-[12px] font-semibold text-[#4E5968] hover:bg-[#E5E8EB]/60 flex items-center justify-center gap-1"
                  >
                    <span>
                      {showAllModels
                        ? '모델 목록 접기'
                        : `나머지 ${availableModels.length - DEFAULT_VISIBLE_GEMINI_MODELS}개 모델 더 보기`}
                    </span>
                    {showAllModels ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={isTestingModel || isFetchingModels}
                    onClick={handleVerifyAndPinModel}
                    className="w-full sm:w-auto min-h-11 py-2.5 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13.5px] font-bold flex items-center justify-center gap-2 whitespace-nowrap active:scale-[0.97] disabled:opacity-50"
                  >
                    {isTestingModel ? (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Pin className="w-4 h-4 shrink-0" />
                    )}
                    <span>선택 모델 검증 · 고정 저장</span>
                  </button>

                  {isPinnedModel && (
                    <span className="text-[12px] font-bold text-[#1B64DA] flex items-center gap-1 whitespace-nowrap">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      고정 작동 중
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            탭 3: 전체 데이터 초기화 · 내보내기
           ================================================================= */}
        {activeTab === 'backup' && (
          <div className="space-y-3">
            {/* 현재 저장된 전체 데이터 현황 */}
            <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-2">
              <div className="text-[12.5px] font-bold text-[#4E5968]">
                현재 저장된 전체 데이터 현황
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                <div className="bg-[#FFFFFF] rounded-xl px-3 py-2">
                  <div className="text-[11px] text-[#8B95A1]">장부 거래</div>
                  <div className="text-[14px] font-bold text-[#191F28]">
                    {dataSummary.transactionCount}건
                  </div>
                </div>
                <div className="bg-[#FFFFFF] rounded-xl px-3 py-2">
                  <div className="text-[11px] text-[#8B95A1]">목장 현황</div>
                  <div className="text-[14px] font-bold text-[#191F28]">
                    {dataSummary.mokjangCount}개
                  </div>
                </div>
                <div className="bg-[#FFFFFF] rounded-xl px-3 py-2">
                  <div className="text-[11px] text-[#8B95A1]">연간 예산안</div>
                  <div className="text-[14px] font-bold text-[#191F28]">
                    {dataSummary.annualBudgetCount}건
                  </div>
                </div>
                <div className="bg-[#FFFFFF] rounded-xl px-3 py-2">
                  <div className="text-[11px] text-[#8B95A1]">행사 청구서</div>
                  <div className="text-[14px] font-bold text-[#191F28]">
                    {dataSummary.retreatBudgetCount}건
                  </div>
                </div>
              </div>
            </div>

            {/* 구글 시트 일원화 백업 바로가기 */}
            <div className="bg-[#E8F3FF] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-bold text-[#1B64DA]">
                  구글 시트 통합 백업
                </div>
                <div className="text-[12px] text-[#4E5968] mt-0.5">
                  어려운 파일 관리 없이 장부·영수증·목장·예산안을 구글 시트 한 곳에 백업하세요.
                </div>
              </div>
              {googleSession && hasLinkedSheet ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleClickGooglePush}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12.5px] font-bold flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap active:scale-[0.97]"
                >
                  <CloudUpload className="w-4 h-4 shrink-0" />
                  <span>지금 시트로 백업</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('connection')}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12.5px] font-bold shrink-0 whitespace-nowrap active:scale-[0.97]"
                >
                  구글 시트 연결하기 →
                </button>
              )}
            </div>

            {/* 전체 데이터 일괄 초기화 */}
            <div className="bg-[#FFEEF0]/70 rounded-2xl p-4 space-y-3 border border-[#F04452]/20">
              <div>
                <div className="text-[14px] font-bold text-[#F04452] flex items-center gap-1.5">
                  <Rocket className="w-4 h-4 shrink-0" />
                  <span>전체 데이터 일괄 초기화 (모든 탭 비우기)</span>
                </div>
                <div className="text-[12px] text-[#4E5968] mt-0.5 break-words [word-break:keep-all]">
                  장부 거래·영수증, 목장 목록, 연간 예산안, 수련회 청구서 항목을 한 번에 모두 비웁니다.
                </div>
              </div>

              <div className="bg-[#FFFFFF] rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                <span className="text-[12px] font-semibold text-[#4E5968]">
                  초기화 후 시작 이월금 (선택)
                </span>
                <div className="flex items-center justify-end gap-1 w-full sm:w-auto">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={carryoverStr}
                    onChange={(e) => {
                      const n = parseDigits(e.target.value);
                      setCarryoverStr(n > 0 ? formatNumber(n) : '');
                    }}
                    placeholder="0"
                    className="w-full sm:w-28 min-w-0 text-right font-bold text-[14px] text-[#191F28] bg-transparent focus:outline-none tabular-nums"
                  />
                  <span className="text-[13px] font-bold text-[#191F28] shrink-0">
                    원
                  </span>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#4E5968] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={keepConnectionsOnReset}
                  onChange={(e) => setKeepConnectionsOnReset(e.target.checked)}
                  className="w-4 h-4 accent-[#3182F6] rounded"
                />
                <span>구글 시트 연결 · AI API 키 · 부서명/결재선은 유지</span>
              </label>

              {!confirmResetStep ? (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmResetStep(true)}
                    className="px-4 py-2 rounded-xl bg-[#F04452] text-[#FFFFFF] text-[13px] font-bold active:scale-[0.97]"
                  >
                    전체 데이터 초기화
                  </button>
                </div>
              ) : (
                <div className="bg-[#FFFFFF] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-bold text-[#F04452]">
                    정말 장부·목장·예산안을 모두 비울까요?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmResetStep(false)}
                      className="px-3 py-1.5 rounded-lg bg-[#F2F4F6] text-[#4E5968] text-[12px] font-semibold"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onResetAllData(
                          parseDigits(carryoverStr),
                          keepConnectionsOnReset
                        );
                        setConfirmResetStep(false);
                        setCarryoverStr('');
                        setFeedback({
                          tone: 'success',
                          message:
                            '장부·목장·연간예산안·청구서 데이터가 모두 초기화되었습니다.',
                        });
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-[#F04452] text-[#FFFFFF] text-[12px] font-bold active:scale-[0.97]"
                    >
                      예, 전체 초기화
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* CSV & 샘플 복원 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="bg-[#F9FAFB] rounded-2xl p-3.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-[#191F28]">
                    월별 장부 엑셀(CSV)
                  </div>
                  <div className="text-[11.5px] text-[#8B95A1]">
                    선택 월 내역 다운로드
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onExportCsv}
                  className="px-3 py-2 rounded-xl bg-[#FFFFFF] text-[#191F28] text-[12px] font-semibold flex items-center gap-1 shrink-0 active:scale-[0.97]"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#3182F6]" />
                  <span>저장</span>
                </button>
              </div>

              <div className="bg-[#F9FAFB] rounded-2xl p-3.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-[#4E5968]">
                    샘플 데이터 복원
                  </div>
                  <div className="text-[11.5px] text-[#8B95A1]">
                    체험용 전체 샘플 불러오기
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onResetSampleData();
                    setConfirmResetStep(false);
                    setFeedback({
                      tone: 'info',
                      message:
                        '전체 샘플 데이터(장부·목장·예산안)가 복원되었습니다.',
                    });
                  }}
                  className="px-3 py-2 rounded-xl bg-[#E5E8EB] text-[#4E5968] text-[12px] font-bold flex items-center gap-1 shrink-0 active:scale-[0.97]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>복원</span>
                </button>
              </div>
            </div>

            {/* 오프라인 JSON 파일 백업/복원 (접이식 고급 메뉴) */}
            <div className="bg-[#F9FAFB] rounded-2xl p-4">
              <button
                type="button"
                onClick={() => setShowAdvancedFileBackup((p) => !p)}
                className="w-full flex items-center justify-between text-[12.5px] font-semibold text-[#8B95A1]"
              >
                <span>고급: 오프라인 백업 파일(JSON) 저장·복원</span>
                {showAdvancedFileBackup ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showAdvancedFileBackup && (
                <div className="mt-3 pt-3 border-t border-[#E5E8EB] flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] text-[#4E5968]">
                    구글 시트 없이 기기에 직접 백업 파일을 보관할 때 사용합니다.
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      ref={jsonInputRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const res = await onImportJson(file);
                          setFeedback({
                            tone: res.ok ? 'success' : 'error',
                            message: res.message,
                          });
                          e.target.value = '';
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={onExportJson}
                      className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] text-[#191F28] text-[12px] font-semibold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>파일 저장</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => jsonInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-[#E5E8EB] text-[#191F28] text-[12px] font-semibold flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>파일 복원</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </TdsDialog>
  );
};
