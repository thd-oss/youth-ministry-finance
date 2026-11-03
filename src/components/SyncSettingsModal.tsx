import React, { useRef, useState } from 'react';
import {
  Check,
  CloudDownload,
  CloudUpload,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { AppSettings } from '../types/finance';
import { GAS_CODE_TEMPLATE } from '../utils/gasCodeTemplate';
import { TdsDialog } from './TdsDialog';

interface SyncSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onPullFromGas: (url: string) => Promise<void>;
  onPushAllToGas: (url: string) => Promise<void>;
  onExportCsv: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onResetSampleData: () => void;
}

export const SyncSettingsModal: React.FC<SyncSettingsModalProps> = ({
  open,
  onClose,
  settings,
  onSaveSettings,
  onPullFromGas,
  onPushAllToGas,
  onExportCsv,
  onExportJson,
  onImportJson,
  onResetSampleData,
}) => {
  const [urlInput, setUrlInput] = useState<string>(settings.gasWebAppUrl);
  const [deptInput, setDeptInput] = useState<string>(settings.departmentName);
  const [authorInput, setAuthorInput] = useState<string>(settings.authorName);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'connection' | 'code_gs' | 'backup'>(
    'connection'
  );
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GAS_CODE_TEMPLATE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard fallback
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
    setStatusMessage('설정이 저장되었습니다.');
    setTimeout(() => setStatusMessage(''), 2500);
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
      setStatusMessage('✅ 구글 시트 & 드라이브 동기화 업로드가 완료되었습니다.');
    } catch (e) {
      setStatusMessage(
        `⚠️ 동기화 실패: ${e instanceof Error ? e.message : 'URL 및 배포 권한을 확인하세요.'}`
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
      setStatusMessage('✅ 구글 시트에서 최신 데이터를 성공적으로 불러왔습니다.');
    } catch (e) {
      setStatusMessage(
        `⚠️ 불러오기 실패: ${e instanceof Error ? e.message : 'URL 및 배포 권한을 확인하세요.'}`
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title="구글 시트·드라이브 연동 및 데이터 관리"
      subtitle="유료 서버 없이 청년부 구글 계정 하나로 장부와 영수증 사진을 영구 보관합니다"
      variant="modal"
    >
      <div className="space-y-5">
        {/* 상단 탭 전환 */}
        <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-3 gap-1">
          {[
            { id: 'connection', label: '1. 웹 앱 URL 연동' },
            { id: 'code_gs', label: '2. Code.gs 복사 & 가이드' },
            { id: 'backup', label: '3. 백업·복원·초기화' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2.5 px-2 rounded-xl text-[13px] font-semibold transition-all duration-150 active:scale-[0.97] ${
                activeTab === tab.id
                  ? 'bg-[#FFFFFF] text-[#191F28]'
                  : 'text-[#8B95A1] hover:text-[#4E5968]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 탭 1: 웹 앱 URL 연동 */}
        {activeTab === 'connection' && (
          <div className="space-y-4">
            <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
              <div>
                <label className="block text-[13px] font-bold text-[#191F28] mb-1">
                  Google Apps Script 웹 앱 URL
                </label>
                <p className="text-[12px] text-[#8B95A1] mb-2">
                  URL을 비워두면 브라우저 LocalStorage(오프라인 로컬 모드)로 즉시 작동합니다.
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

            {/* 3단계 요약 안내 */}
            <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-2.5">
              <div className="text-[14px] font-bold text-[#191F28]">
                💡 3분 만에 끝내는 청년부 구글 시트 + 드라이브 연동법
              </div>
              <ol className="text-[13px] text-[#4E5968] space-y-2 list-decimal list-inside leading-relaxed">
                <li>
                  청년부 구글 계정으로 <strong>새 Google 스프레드시트</strong>를 만들고 상단 메뉴{' '}
                  <span className="px-1.5 py-0.5 rounded bg-[#E5E8EB] text-[#191F28] font-semibold">
                    확장 프로그램 &gt; Apps Script
                  </span>
                  를 클릭합니다.
                </li>
                <li>
                  상단 탭{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('code_gs')}
                    className="text-[#3182F6] font-bold underline"
                  >
                    [2. Code.gs 복사 & 가이드]
                  </button>
                  에서 완성된 코드를 복사해 붙여넣고 저장합니다.
                </li>
                <li>
                  우측 상단 <strong>[배포 &gt; 새 배포 &gt; 웹 앱]</strong> 선택 후 액세스 권한을{' '}
                  <strong>"모든 사용자(Anyone)"</strong>로 설정하여 배포한 뒤, 생성된 URL을 위 입력창에 붙여넣으면 끝납니다!
                </li>
              </ol>
            </div>
          </div>
        )}

        {/* 탭 2: Code.gs 전문 및 복사 버튼 */}
        {activeTab === 'code_gs' && (
          <div className="space-y-3">
            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  복사해서 바로 쓰는 완성본 Code.gs
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  [장부내역]·[예산청구서]·[설정] 시트 자동 생성 + 구글 드라이브 월별 영수증 폴더(2026-11) 및 고화질 썸네일 자동 생성 포함
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

        {/* 탭 3: 백업 / 복원 / 초기화 */}
        {activeTab === 'backup' && (
          <div className="space-y-3">
            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  엑셀 호환 CSV 장부 다운로드
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  현재 선택된 월의 수입·지출·잔액·증빙번호를 엑셀에서 바로 열 수 있는 CSV 파일로 저장합니다.
                </div>
              </div>
              <button
                type="button"
                onClick={onExportCsv}
                className="px-4 py-2.5 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-semibold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <FileSpreadsheet className="w-4 h-4" />
                CSV 다운로드
              </button>
            </div>

            <div className="bg-[#F9FAFB] rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  전체 데이터 JSON 백업 및 복원
                </div>
                <div className="text-[12px] text-[#8B95A1] mt-0.5">
                  영수증 이미지(Base64)와 예산 청구서를 포함한 모든 데이터를 파일 하나로 백업하거나 복원합니다.
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
                      setStatusMessage('✅ JSON 백업 파일이 성공적으로 복원되었습니다.');
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

            <div className="bg-[#FFEEF0] rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-bold text-[#F04452]">
                  2026년 11월 샘플 초기 데이터로 리셋
                </div>
                <div className="text-[12px] text-[#4E5968] mt-0.5">
                  기본 탑재된 2026년 11월 청년부 거래 내역과 가상 영수증 4장, 수련회 예산 청구서 샘플로 초기화합니다.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetSampleData();
                  setStatusMessage('샘플 초기 데이터로 복원되었습니다.');
                }}
                className="px-4 py-2.5 rounded-xl bg-[#FFFFFF] text-[#F04452] text-[12.5px] font-bold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                샘플 리셋
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
