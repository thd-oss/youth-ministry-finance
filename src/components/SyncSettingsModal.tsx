import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CloudDownload,
  CloudUpload,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Rocket,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { AppSettings } from '../types/finance';
import { GAS_CODE_TEMPLATE } from '../utils/gasCodeTemplate';
import { formatNumber } from '../utils/koreanCurrency';
import { testGeminiConnection } from '../utils/receiptAiAnalyzer';
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
  const [activeTab, setActiveTab] = useState<SettingsTabType>(initialTab);
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>(
    settings.geminiApiKey || ''
  );
  const [geminiModelInput, setGeminiModelInput] = useState<string>(
    settings.geminiModel || 'gemini-2.5-flash'
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const [urlInput, setUrlInput] = useState<string>(settings.gasWebAppUrl);
  const [deptInput, setDeptInput] = useState<string>(settings.departmentName);
  const [authorInput, setAuthorInput] = useState<string>(settings.authorName);

  const [carryoverStr, setCarryoverStr] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setGeminiKeyInput(settings.geminiApiKey || '');
      setGeminiModelInput(settings.geminiModel || 'gemini-2.5-flash');
      setUrlInput(settings.gasWebAppUrl || '');
      setDeptInput(settings.departmentName || '은혜교회 청년부');
      setAuthorInput(settings.authorName || '김송연');
      setStatusMessage('');
    }
  }, [open, initialTab, settings]);

  const parseDigits = (raw: string): number => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  const handleTestAndSaveGemini = async () => {
    const trimmedKey = geminiKeyInput.trim();
    if (!trimmedKey) {
      onSaveSettings({
        ...settings,
        geminiApiKey: '',
        geminiModel: geminiModelInput,
      });
      setStatusMessage('Gemini API 키가 해제되었습니다.');
      return;
    }

    setIsBusy(true);
    setStatusMessage('Gemini AI 연결 상태를 확인하는 중...');
    const result = await testGeminiConnection(trimmedKey, geminiModelInput);
    setIsBusy(false);

    if (result.ok) {
      onSaveSettings({
        ...settings,
        geminiApiKey: trimmedKey,
        geminiModel: geminiModelInput,
      });
    }
    setStatusMessage(result.message);
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
    setStatusMessage('✅ 부서 정보 및 구글 시트 URL 설정이 저장되었습니다.');
  };

  const handlePush = async () => {
    if (!urlInput.trim()) {
      setStatusMessage('먼저 Google Apps Script 웹 앱 URL을 입력해 주세요.');
      return;
    }
    setIsBusy(true);
    setStatusMessage('구글 시트 및 드라이브로 데이터를 업로드하는 중...');
    try {
      onSaveSettings({
        ...settings,
        gasWebAppUrl: urlInput.trim(),
        departmentName: deptInput.trim() || '은혜교회 청년부',
        authorName: authorInput.trim() || '김송연',
      });
      await onPushAllToGas(urlInput.trim());
      setStatusMessage(
        '✅ 구글 시트 & 드라이브 동기화 업로드가 완료되었습니다.'
      );
    } catch (e) {
      setStatusMessage(
        `⚠️ 동기화 실패: ${
          e instanceof Error ? e.message : 'URL 및 배포 권한을 확인하세요.'
        }`
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handlePull = async () => {
    if (!urlInput.trim()) {
      setStatusMessage('먼저 Google Apps Script 웹 앱 URL을 입력해 주세요.');
      return;
    }
    setIsBusy(true);
    setStatusMessage('구글 시트에서 데이터를 불러오는 중...');
    try {
      onSaveSettings({
        ...settings,
        gasWebAppUrl: urlInput.trim(),
      });
      await onPullFromGas(urlInput.trim());
      setStatusMessage(
        '✅ 구글 시트에서 최신 데이터를 성공적으로 불러왔습니다.'
      );
    } catch (e) {
      setStatusMessage(
        `⚠️ 불러오기 실패: ${
          e instanceof Error ? e.message : 'URL 및 배포 권한을 확인하세요.'
        }`
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title="AI 영수증 스캐너 & 구글 시트 연동 설정"
      subtitle="Gemini AI 자동 입력과 청년부 구글 계정 데이터베이스 연동을 관리합니다"
      variant="modal"
    >
      <div className="space-y-5">
        {/* 상단 탭 전환 (4개 탭) */}
        <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-2 sm:grid-cols-4 gap-1">
          {[
            { id: 'gemini', label: '✨ 1. Gemini AI 연결' },
            { id: 'connection', label: '🟢 2. 구글 시트 연동' },
            { id: 'code_gs', label: '📋 3. Code.gs 복사' },
            { id: 'backup', label: '🚀 4. 실사용·백업' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as SettingsTabType);
                setStatusMessage('');
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

        {/* =================================================================
            탭 1: Gemini AI 영수증 자동 판독기 연결
           ================================================================= */}
        {activeTab === 'gemini' && (
          <div className="space-y-4">
            <div className="bg-[#F9FAFB] rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[15px] font-bold text-[#191F28]">
                    <Sparkles className="w-4 h-4 text-[#3182F6]" />
                    <span>사용자 Gemini 계정(API Key) 연결</span>
                  </div>
                  <p className="text-[12.5px] text-[#4E5968] mt-0.5">
                    연결 후 영수증 사진을 찍거나 올리면 가맹점·금액·거래일·품목별 산출근거·추천 카테고리를 AI가 자동으로 채워줍니다.
                  </p>
                </div>

                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Google AI Studio 무료 키 발급
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[12.5px] font-semibold text-[#4E5968] mb-1">
                    Gemini API Key (내 기기 브라우저에만 안전하게 저장됨)
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={geminiKeyInput}
                      onChange={(e) => setGeminiKeyInput(e.target.value)}
                      placeholder="AIzaSy... 로 시작하는 Gemini API 키 붙여넣기"
                      className="w-full h-11 pl-3.5 pr-10 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none font-mono"
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
                </div>

                <div>
                  <label className="block text-[12.5px] font-semibold text-[#4E5968] mb-1">
                    사용할 Gemini 비전 모델
                  </label>
                  <select
                    value={geminiModelInput}
                    onChange={(e) => setGeminiModelInput(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] font-medium text-[#191F28] focus:outline-none"
                  >
                    <option value="gemini-2.5-flash">
                      gemini-2.5-flash (권장 · 가장 빠르고 무료 할당량 넉넉함)
                    </option>
                    <option value="gemini-2.5-pro">
                      gemini-2.5-pro (고성능 · 복잡한 다품목 마트 영수증 정밀 판독)
                    </option>
                    <option value="gemini-2.0-flash">
                      gemini-2.0-flash (호환용 경량 모델)
                    </option>
                  </select>
                </div>

                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleTestAndSaveGemini}
                    className="px-5 py-2.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13.5px] font-bold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                  >
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    연결 테스트 및 저장하기
                  </button>

                  {settings.geminiApiKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setGeminiKeyInput('');
                        onSaveSettings({ ...settings, geminiApiKey: '' });
                        setStatusMessage('API 키가 삭제되었습니다.');
                      }}
                      className="px-3.5 py-2.5 rounded-xl bg-[#FFEEF0] text-[#F04452] text-[12.5px] font-semibold active:scale-[0.97] transition-all duration-150"
                    >
                      키 삭제
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-2 text-[12.5px] text-[#4E5968]">
              <div className="font-bold text-[#191F28]">
                💡 10초 만에 무료 Gemini API 키 연결하는 법
              </div>
              <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                <li>
                  위 파란색 <strong>[Google AI Studio 무료 키 발급]</strong> 버튼을 눌러 본인 구글 계정으로 로그인합니다.
                </li>
                <li>
                  우측 상단 <strong>[Create API key]</strong> 버튼을 눌러 생성된 키(`AIzaSy...`)를 복사합니다.
                </li>
                <li>
                  위 입력창에 붙여넣고 <strong>[연결 테스트 및 저장하기]</strong>를 누르면 즉시 영수증 자동 기장이 활성화됩니다!
                </li>
              </ol>
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
                    setStatusMessage(
                      '🚀 샘플 내역을 비우고 실제 장부 모드로 전환되었습니다!'
                    );
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
                      setStatusMessage(
                        '✅ JSON 백업 파일이 성공적으로 복원되었습니다.'
                      );
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
                  setStatusMessage('데모 샘플 데이터가 복원되었습니다.');
                }}
                className="px-4 py-2.5 rounded-xl bg-[#E5E8EB] text-[#4E5968] text-[12.5px] font-bold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                샘플 불러오기
              </button>
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="px-4 py-3 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-semibold flex items-center gap-2">
            <Database className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>
    </TdsDialog>
  );
};
