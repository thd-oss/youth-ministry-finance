import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Pin,
  RefreshCw,
  Rocket,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { AppSettings, GeminiModelOption } from '../types/finance';
import { GAS_CODE_TEMPLATE } from '../utils/gasCodeTemplate';
import { formatNumber } from '../utils/koreanCurrency';
import {
  FALLBACK_GEMINI_MODELS,
  fetchAvailableGeminiModels,
  sanitizeGeminiApiKey,
  testGeminiConnection,
} from '../utils/receiptAiAnalyzer';
import { TdsDialog } from './TdsDialog';

export type SettingsTabType = 'gemini' | 'connection' | 'code_gs' | 'backup';

interface SyncSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTabType;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onPullFromGas: (url: string) => Promise<void>;
  onPushAllToGas: (url: string) => Promise<void>;
  onExportCsv: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onStartCleanLedger: (initialCarryover: number) => void;
  onResetSampleData: () => void;
}

interface FeedbackBannerState {
  tone: 'info' | 'success' | 'error';
  message: string;
}

export const SyncSettingsModal: React.FC<SyncSettingsModalProps> = ({
  open,
  onClose,
  initialTab = 'gemini',
  settings,
  onSaveSettings,
  onPullFromGas,
  onPushAllToGas,
  onExportCsv,
  onExportJson,
  onImportJson,
  onStartCleanLedger,
  onResetSampleData,
}) => {
  const wasOpenRef = useRef<boolean>(false);

  const [activeTab, setActiveTab] = useState<SettingsTabType>(initialTab);
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

  const [urlInput, setUrlInput] = useState<string>(settings.gasWebAppUrl);
  const [deptInput, setDeptInput] = useState<string>(settings.departmentName);
  const [authorInput, setAuthorInput] = useState<string>(settings.authorName);

  const [carryoverStr, setCarryoverStr] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FeedbackBannerState | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [isTestingModel, setIsTestingModel] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  // 모달이 닫혀 있다가 열리는 시점(false -> true)에만 초기 상태를 세팅하여,
  // 모달 내부에서 설정을 저장해도 탭이나 검증 결과 배너가 절대 사라지지 않도록 보장
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setActiveTab(initialTab);
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
      setFeedback(null);
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
  }, [open, initialTab, settings]);

  const parseDigits = (raw: string): number => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  /**
   * Step 1: 사용자의 API 키로 Google 서버(GET /v1beta/models)에서 실제 사용 가능한 모델 목록을 읽어옵니다.
   */
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
      message:
        'Google 서버에서 이 API 키로 사용 가능한 최신 Gemini 모델 목록을 불러오는 중...',
    });

    const result = await fetchAvailableGeminiModels(cleanKey);
    setIsFetchingModels(false);

    if (!result.ok) {
      setFeedback({
        tone: 'error',
        message: result.message,
      });
      return;
    }

    setGeminiKeyInput(cleanKey);
    setAvailableModels(result.models);
    setHasFetchedLiveModels(true);

    // 기존 선택 모델이 조회된 가용 목록에 있으면 유지하고, 없으면 가장 적합한 1순위 모델 자동 선택
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
      message: `${result.message} (자동 추천 선택: ${nextSelectedModel})`,
    });
  };

  /**
   * Step 2: 목록에서 사용자가 선택한 모델을 실제 호출(generateContent)로 검증한 뒤 고정 저장합니다.
   */
  const handleVerifyAndPinModel = async () => {
    const cleanKey = sanitizeGeminiApiKey(geminiKeyInput);
    if (!cleanKey) {
      onSaveSettings({
        ...settings,
        geminiApiKey: '',
      });
      setFeedback({
        tone: 'info',
        message: 'Gemini API 키가 해제되었습니다.',
      });
      return;
    }

    setIsTestingModel(true);
    let currentModels = availableModels;
    let targetModel = geminiModelInput;

    // 아직 실시간 모델 목록을 안 불러온 상태라면 먼저 모델 목록부터 조회하여 유효 모델 확인
    if (!hasFetchedLiveModels) {
      setFeedback({
        tone: 'info',
        message: '사용 가능한 모델 목록을 먼저 조회하는 중...',
      });
      const listRes = await fetchAvailableGeminiModels(cleanKey);
      if (!listRes.ok) {
        setIsTestingModel(false);
        setFeedback({
          tone: 'error',
          message: listRes.message,
        });
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
      message: `[${targetModel}] 모델로 실제 응답 테스트 및 고정을 진행하는 중...`,
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
      setFeedback({
        tone: 'success',
        message: verifyResult.message,
      });
    } else {
      setFeedback({
        tone: 'error',
        message: verifyResult.message,
      });
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GAS_CODE_TEMPLATE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = GAS_CODE_TEMPLATE;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleSaveBasic = () => {
    onSaveSettings({
      ...settings,
      gasWebAppUrl: urlInput.trim(),
      departmentName: deptInput.trim() || '은혜교회 청년부',
      authorName: authorInput.trim() || '김송연',
    });
    setFeedback({
      tone: 'success',
      message: '✅ 부서 정보 및 구글 시트 웹 앱 URL 설정이 저장되었습니다.',
    });
  };

  const handlePush = async () => {
    if (!urlInput.trim()) {
      setFeedback({
        tone: 'error',
        message: '먼저 Google Apps Script 웹 앱 URL을 입력해 주세요.',
      });
      return;
    }
    setIsBusy(true);
    setFeedback({
      tone: 'info',
      message: '구글 시트 및 드라이브로 데이터를 업로드하는 중...',
    });
    try {
      onSaveSettings({
        ...settings,
        gasWebAppUrl: urlInput.trim(),
        departmentName: deptInput.trim() || '은혜교회 청년부',
        authorName: authorInput.trim() || '김송연',
      });
      await onPushAllToGas(urlInput.trim());
      setFeedback({
        tone: 'success',
        message: '✅ 구글 시트 & 드라이브 동기화 업로드가 완료되었습니다.',
      });
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: `동기화 실패: ${
          e instanceof Error ? e.message : 'URL 및 배포 권한을 확인하세요.'
        }`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handlePull = async () => {
    if (!urlInput.trim()) {
      setFeedback({
        tone: 'error',
        message: '먼저 Google Apps Script 웹 앱 URL을 입력해 주세요.',
      });
      return;
    }
    setIsBusy(true);
    setFeedback({
      tone: 'info',
      message: '구글 시트에서 데이터를 불러오는 중...',
    });
    try {
      onSaveSettings({
        ...settings,
        gasWebAppUrl: urlInput.trim(),
      });
      await onPullFromGas(urlInput.trim());
      setFeedback({
        tone: 'success',
        message: '✅ 구글 시트에서 최신 데이터를 성공적으로 불러왔습니다.',
      });
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: `불러오기 실패: ${
          e instanceof Error ? e.message : 'URL 및 배포 권한을 확인하세요.'
        }`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const isPinnedModel =
    Boolean(settings.geminiApiKey?.trim()) &&
    settings.geminiModel === geminiModelInput;

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title="설정"
      variant="modal"
    >
      <div className="space-y-5">
        {/* 상단 탭 전환 (4개 탭) */}
        <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-2 sm:grid-cols-4 gap-1">
          {[
            { id: 'gemini', label: '✨ AI 연결' },
            { id: 'connection', label: '🟢 시트 연동' },
            { id: 'code_gs', label: '📋 스크립트 복사' },
            { id: 'backup', label: '🚀 초기화·백업' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as SettingsTabType);
                setFeedback(null);
              }}
              className={`py-2.5 px-2 rounded-xl text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.97] ${
                activeTab === tab.id
                  ? 'bg-[#FFFFFF] text-[#191F28]'
                  : 'text-[#8B95A1] hover:text-[#4E5968]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 상단 고정 피드백 배너 (성공 / 실패 / 진행 중 상태가 사라지지 않고 명확히 표시됨) */}
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
            탭 1: Gemini AI 영수증 자동 판독기 연결 (가용 모델 실시간 조회 + 선택 고정)
           ================================================================= */}
        {activeTab === 'gemini' && (
          <div className="space-y-4">
            <div className="bg-[#F9FAFB] rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[15px] font-bold text-[#191F28]">
                  <Sparkles className="w-4 h-4 text-[#3182F6]" />
                  <span>Gemini API 키 & 모델 설정</span>
                </div>

                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  API 키 발급
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* 현재 고정된 상태 배지 */}
              {settings.geminiApiKey && (
                <div className="bg-[#FFFFFF] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="px-2 py-0.5 rounded-md bg-[#E8F3FF] text-[#1B64DA] font-bold">
                      현재 고정 모델
                    </span>
                    <span className="font-mono font-bold text-[#191F28]">
                      {settings.geminiModel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setGeminiKeyInput('');
                      onSaveSettings({
                        ...settings,
                        geminiApiKey: '',
                      });
                      setFeedback({
                        tone: 'info',
                        message: '저장된 Gemini API 키가 삭제되었습니다.',
                      });
                    }}
                    className="text-[12px] font-semibold text-[#F04452] hover:underline"
                  >
                    API 키 연결 해제
                  </button>
                </div>
              )}

              {/* Step 1: API 키 입력 및 모델 목록 실시간 조회 */}
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
                    className="h-11 px-4 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[13px] font-bold flex items-center justify-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150 disabled:opacity-50"
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

              {/* Step 2: 읽어온 모델 목록 중에서 선택 및 고정 */}
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

                {/* 드롭다운 선택기 (전체 모델 빠른 탐색용) */}
                <select
                  value={geminiModelInput}
                  onChange={(e) => setGeminiModelInput(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>

                {/* 상위 가용 모델 원터치 선택 카드 리스트 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[210px] overflow-y-auto pr-0.5">
                  {availableModels.map((m, idx) => {
                    const selected = geminiModelInput === m.id;
                    const pinned =
                      Boolean(settings.geminiApiKey?.trim()) &&
                      settings.geminiModel === m.id;

                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setGeminiModelInput(m.id)}
                        className={`p-3 rounded-xl text-left transition-all duration-150 flex items-start justify-between gap-2 ${
                          selected
                            ? 'bg-[#3182F6] text-[#FFFFFF]'
                            : 'bg-[#FFFFFF] text-[#191F28] hover:bg-[#E5E8EB]/60'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-bold font-mono truncate">
                              {m.id}
                            </span>
                            {idx === 0 && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
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
                            className={`text-[11px] truncate mt-0.5 ${
                              selected ? 'text-[#FFFFFF]/85' : 'text-[#8B95A1]'
                            }`}
                          >
                            {m.displayName}
                          </div>
                        </div>

                        {pinned && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
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

                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={isTestingModel || isFetchingModels}
                    onClick={handleVerifyAndPinModel}
                    className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13.5px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all duration-150 disabled:opacity-50"
                  >
                    {isTestingModel ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Pin className="w-4 h-4" />
                    )}
                    <span>
                      2. [{geminiModelInput}] 모델 검증 및 고정 저장하기
                    </span>
                  </button>

                  {isPinnedModel && (
                    <span className="text-[12px] font-bold text-[#1B64DA] flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />이 모델로 고정되어 작동 중입니다
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            탭 2: 구글 시트 & 드라이브 웹 앱 URL 연동
           ================================================================= */}
        {activeTab === 'connection' && (
          <div className="space-y-4">
            <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
              <div>
                <label className="block text-[13px] font-bold text-[#191F28] mb-1">
                  Google Apps Script 웹 앱 URL
                </label>
                <p className="text-[12px] text-[#8B95A1] mb-2">
                  연결해 두면 내 폰과 맥북에서 언제나 동일한 장부와 영수증 사진이 실시간 동기화됩니다.
                </p>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    청년부 소속 명칭 (인쇄 문서 표기)
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

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveBasic}
                  disabled={isBusy}
                  className="px-4 py-2.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-semibold active:scale-[0.97] transition-all duration-150"
                >
                  설정 저장하기
                </button>

                <button
                  type="button"
                  onClick={handlePush}
                  disabled={isBusy}
                  className="px-4 py-2.5 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                >
                  <CloudUpload className="w-4 h-4" />
                  현재 데이터 시트로 전체 업로드
                </button>

                <button
                  type="button"
                  onClick={handlePull}
                  disabled={isBusy}
                  className="px-4 py-2.5 rounded-xl bg-[#F2F4F6] text-[#4E5968] text-[13px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                >
                  <CloudDownload className="w-4 h-4" />
                  시트에서 데이터 불러오기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            탭 3: Code.gs 전문 및 복사 버튼
           ================================================================= */}
        {activeTab === 'code_gs' && (
          <div className="space-y-3">
            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  복사해서 바로 쓰는 완성본 Code.gs
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  구글 스프레드시트 [확장 프로그램 &gt; Apps Script]에 붙여넣고 [새 배포 &gt; 웹 앱]으로 배포하세요.
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150 ${
                  copied
                    ? 'bg-[#191F28] text-[#FFFFFF]'
                    : 'bg-[#3182F6] text-[#FFFFFF]'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    복사 완료!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Code.gs 전체 코드 복사
                  </>
                )}
              </button>
            </div>

            <pre className="bg-[#F9FAFB] text-[#191F28] p-4 rounded-2xl text-[11.5px] leading-relaxed overflow-x-auto max-h-[340px] font-mono select-all">
              {GAS_CODE_TEMPLATE}
            </pre>
          </div>
        )}

        {/* =================================================================
            탭 4: 실제 서비스 모드 전환 / 백업 / 복원
           ================================================================= */}
        {activeTab === 'backup' && (
          <div className="space-y-3">
            {/* 실제 서비스 장부 시작 카드 */}
            <div className="bg-[#E8F3FF] rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[14px] font-bold text-[#1B64DA] flex items-center gap-1.5">
                    <Rocket className="w-4 h-4" />
                    <span>실제 서비스 모드로 깨끗하게 시작하기</span>
                  </div>
                  <div className="text-[12px] text-[#4E5968] mt-0.5">
                    테스트용 가상 샘플 내역을 모두 비우고, 우리 청년부의 실제 전월 이월금부터 바로 기록을 시작합니다.
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-[#FFFFFF] rounded-xl px-3.5 py-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[#4E5968]">
                    시작 전월 이월금 (없으면 0원):
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={carryoverStr}
                      onChange={(e) => {
                        const n = parseDigits(e.target.value);
                        setCarryoverStr(n > 0 ? formatNumber(n) : '');
                      }}
                      placeholder="0"
                      className="w-28 text-right font-bold text-[14px] text-[#191F28] bg-transparent focus:outline-none tabular-nums"
                    />
                    <span className="text-[13px] font-bold text-[#191F28]">
                      원
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onStartCleanLedger(parseDigits(carryoverStr));
                    setFeedback({
                      tone: 'success',
                      message:
                        '🚀 샘플 내역을 비우고 실제 장부 모드로 전환되었습니다!',
                    });
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold shrink-0 active:scale-[0.97] transition-all duration-150"
                >
                  샘플 비우고 실제 장부 시작
                </button>
              </div>
            </div>

            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  엑셀 호환 CSV 장부 다운로드
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  현재 선택된 월의 수입·지출·잔액·증빙번호를 엑셀 파일로 저장합니다.
                </div>
              </div>
              <button
                type="button"
                onClick={onExportCsv}
                className="px-4 py-2.5 rounded-xl bg-[#FFFFFF] text-[#191F28] text-[13px] font-semibold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#3182F6]" />
                CSV 다운로드
              </button>
            </div>

            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  전체 데이터 JSON 백업 및 복원
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  영수증 사진과 예산안·목장 설정을 포함한 전체 데이터를 백업하거나 복원합니다.
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={jsonInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onImportJson(file);
                      setFeedback({
                        tone: 'success',
                        message:
                          '✅ JSON 백업 파일이 성공적으로 복원되었습니다.',
                      });
                      e.target.value = '';
                    }
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={onExportJson}
                  className="px-3.5 py-2.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12.5px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                >
                  <Download className="w-3.5 h-3.5" />
                  백업 저장
                </button>
                <button
                  type="button"
                  onClick={() => jsonInputRef.current?.click()}
                  className="px-3.5 py-2.5 rounded-xl bg-[#E5E8EB] text-[#191F28] text-[12.5px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                >
                  <Upload className="w-3.5 h-3.5" />
                  백업 복원
                </button>
              </div>
            </div>

            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-bold text-[#4E5968]">
                  데모용 샘플 데이터 불러오기
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  기능 테스트를 위해 2026년 11월 샘플 거래 내역과 가상 영수증을 다시 불러옵니다.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetSampleData();
                  setFeedback({
                    tone: 'info',
                    message: '데모 샘플 데이터가 복원되었습니다.',
                  });
                }}
                className="px-4 py-2.5 rounded-xl bg-[#E5E8EB] text-[#4E5968] text-[12.5px] font-bold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                샘플 불러오기
              </button>
            </div>
          </div>
        )}
      </div>
    </TdsDialog>
  );
};
