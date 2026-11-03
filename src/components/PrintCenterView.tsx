import React, { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Edit3,
  Eye,
  FileSpreadsheet,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Minimize2,
  Printer,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react';
import {
  ACCOUNT_LABELS,
  AccountType,
  AppSettings,
  MOKJANG_SUBTYPE_LABELS,
  MokjangGroup,
  ProcessedTransaction,
  Transaction,
} from '../types/finance';
import { compressReceiptImage } from '../utils/imageCompressor';
import {
  formatNumber,
  formatShortDate,
  formatWon,
  formatYearMonthKorean,
  numberToKoreanCurrency,
} from '../utils/koreanCurrency';
import { CategoryBudgetAllocation } from '../utils/syncManager';
import { A4ScalePreview } from './A4ScalePreview';

interface PrintCenterViewProps {
  yearMonth: string;
  accountFilter: AccountType;
  onAccountFilterChange: (acc: AccountType) => void;
  processedTransactions: ProcessedTransaction[];
  carryoverAmount: number;
  monthlyIncome: number;
  monthlyExpense: number;
  currentBalance: number;
  mokjangs: MokjangGroup[];
  categoryAllocations: Record<string, CategoryBudgetAllocation>;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onSelectTransaction: (tx: ProcessedTransaction) => void;
  onQuickSaveTransaction?: (tx: Transaction) => void;
}

type PrintOutputMode = 'both' | 'ledger_only' | 'receipts_only';
type ReceiptDensity = 2 | 4;
type ReceiptFitMode = 'contain' | 'width';
type PrintScreenMode = 'mobile_inspector' | 'a4_preview';
type InspectorFilter = 'all' | 'missing' | 'attached';

export const PrintCenterView: React.FC<PrintCenterViewProps> = ({
  yearMonth,
  accountFilter,
  onAccountFilterChange,
  processedTransactions,
  carryoverAmount,
  monthlyIncome,
  monthlyExpense,
  currentBalance,
  mokjangs,
  categoryAllocations,
  settings,
  onUpdateSettings,
  onSelectTransaction,
  onQuickSaveTransaction,
}) => {
  const [outputMode, setOutputMode] = useState<PrintOutputMode>('both');
  const [density, setDensity] = useState<ReceiptDensity>(4);
  const [fitMode, setFitMode] = useState<ReceiptFitMode>('contain');
  const [scanFilter, setScanFilter] = useState<boolean>(false);
  const [includeMissingSlots, setIncludeMissingSlots] = useState<boolean>(true);
  const [reportDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  // 모바일(< 860px)에서는 모바일 검수·편집 카드 피드가 기본값, 데스크톱에서는 A4 용지 미리보기가 기본값
  const [screenMode, setScreenMode] = useState<PrintScreenMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 860
      ? 'mobile_inspector'
      : 'a4_preview'
  );
  const [a4ZoomMode, setA4ZoomMode] = useState<'fit' | 'actual'>('fit');
  const [inspectorFilter, setInspectorFilter] =
    useState<InspectorFilter>('all');
  const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);
  const [uploadingTxId, setUploadingTxId] = useState<string | null>(null);

  const mokjangMap = useMemo(
    () => new Map(mokjangs.map((m) => [m.id, m])),
    [mokjangs]
  );

  const allExpenseEvidenceItems = useMemo(
    () => processedTransactions.filter((tx) => Boolean(tx.evidenceNo)),
    [processedTransactions]
  );

  const missingReceiptCount = useMemo(
    () => allExpenseEvidenceItems.filter((tx) => !tx.receiptImage).length,
    [allExpenseEvidenceItems]
  );

  const attachedReceiptCount =
    allExpenseEvidenceItems.length - missingReceiptCount;

  const evidenceItems = useMemo(() => {
    return processedTransactions.filter((tx) => {
      if (!tx.evidenceNo) return false;
      if (!includeMissingSlots && !tx.receiptImage) return false;
      return true;
    });
  }, [processedTransactions, includeMissingSlots]);

  const filteredInspectorItems = useMemo(() => {
    if (inspectorFilter === 'missing') {
      return allExpenseEvidenceItems.filter((tx) => !tx.receiptImage);
    }
    if (inspectorFilter === 'attached') {
      return allExpenseEvidenceItems.filter((tx) => Boolean(tx.receiptImage));
    }
    return allExpenseEvidenceItems;
  }, [allExpenseEvidenceItems, inspectorFilter]);

  const receiptPages = useMemo(() => {
    const pages: ProcessedTransaction[][] = [];
    for (let i = 0; i < evidenceItems.length; i += density) {
      pages.push(evidenceItems.slice(i, i + density));
    }
    return pages.length > 0 ? pages : [[]];
  }, [evidenceItems, density]);

  // 관/항(카테고리)별 지출 소계 + 연간 예산안 연동 월평균 예산 대비 집행률 집계
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    processedTransactions
      .filter((tx) => tx.type === 'expense')
      .forEach((tx) => {
        const prev = map.get(tx.category) || { count: 0, total: 0 };
        map.set(tx.category, {
          count: prev.count + 1,
          total: prev.total + tx.amount,
        });
      });

    return Array.from(map.entries()).map(([cat, info]) => {
      const monthlyBudget = categoryAllocations[cat]?.monthlyBudget || 0;
      const rate =
        monthlyBudget > 0 ? Math.round((info.total / monthlyBudget) * 100) : 0;
      return {
        category: cat,
        count: info.count,
        total: info.total,
        monthlyBudget,
        rate,
      };
    });
  }, [processedTransactions, categoryAllocations]);

  const rowCount = processedTransactions.length;
  const tableRowPaddingClass =
    rowCount > 18
      ? 'py-1 px-1.5 text-[10px]'
      : rowCount > 12
        ? 'py-1.5 px-2 text-[11px]'
        : 'py-2 px-2.5 text-[11.5px]';

  const handleRoleChange = (idx: 0 | 1 | 2 | 3, val: string) => {
    const nextRoles: [string, string, string, string] = [
      ...settings.approvalRoles,
    ] as [string, string, string, string];
    nextRoles[idx] = val;
    onUpdateSettings({
      ...settings,
      approvalRoles: nextRoles,
    });
  };

  const toggleApprovalBox = () => {
    onUpdateSettings({
      ...settings,
      showApprovalBox: !settings.showApprovalBox,
    });
  };

  const handleInlinePhotoUpload = async (
    tx: ProcessedTransaction,
    file?: File
  ) => {
    if (!file || !onQuickSaveTransaction) return;
    setUploadingTxId(tx.id);
    try {
      const compressed = await compressReceiptImage(file, 1200, 0.8);
      const { evidenceNo: _ev, runningBalance: _rb, ...rawTx } = tx;
      onQuickSaveTransaction({
        ...rawTx,
        receiptImage: compressed.dataUrl,
      });
    } catch (err) {
      console.error('영수증 즉시 압축 실패:', err);
    } finally {
      setUploadingTxId(null);
    }
  };

  const handleInlineMemoChange = (
    tx: ProcessedTransaction,
    nextMemo: string
  ) => {
    if (!onQuickSaveTransaction) return;
    const { evidenceNo: _ev, runningBalance: _rb, ...rawTx } = tx;
    onQuickSaveTransaction({
      ...rawTx,
      memo: nextMemo,
    });
  };

  const yearMonthTitle = formatYearMonthKorean(yearMonth);

  return (
    <div className="space-y-5 pb-28 print-container">
      {/* =====================================================================
          1. 상단 컨트롤 & 모드 전환 바 (@media print 시 완벽 숨김: .no-print)
         ===================================================================== */}
      <section className="no-print max-w-[980px] mx-auto bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-[18px] sm:text-[19px] font-bold text-[#191F28]">
            결산서 · 영수증철 인쇄
          </h2>

          <button
            type="button"
            onClick={() => window.print()}
            className="h-11 px-5 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[14px] font-semibold flex items-center justify-center gap-2 shrink-0 active:scale-[0.97] transition-all duration-150"
          >
            <Printer className="w-4 h-4" />
            인쇄 / PDF 저장
          </button>
        </div>

        {/* 화면 모드 전환 탭 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-[#F9FAFB] p-2.5 rounded-2xl">
          <div className="bg-[#E5E8EB] p-1 rounded-xl grid grid-cols-2 gap-1 flex-1">
            <button
              type="button"
              onClick={() => setScreenMode('mobile_inspector')}
              className={`py-2.5 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'mobile_inspector'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>
                📱 영수증 검수 ({allExpenseEvidenceItems.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScreenMode('a4_preview')}
              className={`py-2.5 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'a4_preview'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Eye className="w-4 h-4 shrink-0" />
              <span>📄 A4 미리보기</span>
            </button>
          </div>

          {screenMode === 'a4_preview' && (
            <button
              type="button"
              onClick={() =>
                setA4ZoomMode((prev) => (prev === 'fit' ? 'actual' : 'fit'))
              }
              className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center justify-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150"
            >
              {a4ZoomMode === 'fit' ? (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#3182F6]" />
                  <span>화면 맞춤 (100% 보기)</span>
                </>
              ) : (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#3182F6]" />
                  <span>100% 크기 (화면 맞춤)</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* 출력 문서 구성 선택 (언제나 빠르게 선택 가능) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            {
              id: 'both',
              label: '세트 전체 출력',
              sub: `장부 1장 + 영수증철 ${receiptPages.length}장`,
            },
            {
              id: 'ledger_only',
              label: '1. 월별 장부만',
              sub: '결산 보고서 (A4 1장)',
            },
            {
              id: 'receipts_only',
              label: '2. 영수증 증빙철만',
              sub: `증빙 첨부지 (A4 ${receiptPages.length}장)`,
            },
          ].map((opt) => {
            const active = outputMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setOutputMode(opt.id as PrintOutputMode)}
                className={`p-3 rounded-2xl text-left transition-all duration-150 active:scale-[0.97] ${
                  active
                    ? 'bg-[#3182F6] text-[#FFFFFF]'
                    : 'bg-[#F9FAFB] text-[#191F28] hover:bg-[#E5E8EB]'
                }`}
              >
                <div className="text-[13px] font-bold">{opt.label}</div>
                <div
                  className={`text-[11.5px] mt-0.5 tabular-nums ${
                    active ? 'text-[#FFFFFF]/85' : 'text-[#8B95A1]'
                  }`}
                >
                  {opt.sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* 인쇄 레이아웃 & 결재란 상세 설정 아코디언 (모바일 화면 공간 절약) */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => setIsConfigExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#3182F6]" />
              <span className="text-[13px] font-bold text-[#191F28]">
                영수증 배치({density}분할) · 스캔 필터 · 결재선 직분 설정
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1 shrink-0">
              {isConfigExpanded ? (
                <>
                  <span>접기</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>옵션 열기</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </span>
          </button>

          {isConfigExpanded && (
            <div className="space-y-4 pt-3 border-t border-[#E5E8EB]">
              {/* 영수증 증빙철 레이아웃 & 이미지 옵션 */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#4E5968]">
                  <ImageIcon className="w-4 h-4 text-[#3182F6]" />
                  영수증 증빙철 레이아웃 & 이미지 보정
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDensity(2)}
                    className={`p-2.5 rounded-xl text-left transition-all duration-150 active:scale-[0.97] ${
                      density === 2
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968]'
                    }`}
                  >
                    <div className="text-[12.5px] font-bold">
                      A4 1장당 2개 (좌우 2열)
                    </div>
                    <div
                      className={`text-[11px] ${
                        density === 2 ? 'text-[#FFFFFF]/80' : 'text-[#8B95A1]'
                      }`}
                    >
                      긴 마트·모바일 영수증용
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDensity(4)}
                    className={`p-2.5 rounded-xl text-left transition-all duration-150 active:scale-[0.97] ${
                      density === 4
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968]'
                    }`}
                  >
                    <div className="text-[12.5px] font-bold">
                      A4 1장당 4개 (2×2 격자)
                    </div>
                    <div
                      className={`text-[11px] ${
                        density === 4 ? 'text-[#FFFFFF]/80' : 'text-[#8B95A1]'
                      }`}
                    >
                      표준 영수증 절약 인쇄용
                    </div>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setFitMode((prev) =>
                        prev === 'contain' ? 'width' : 'contain'
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#3182F6]" />
                    피팅:{' '}
                    {fitMode === 'contain'
                      ? '원본 비율 전체보기'
                      : '폭 맞춤 확대보기'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setScanFilter((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150 ${
                      scanFilter
                        ? 'bg-[#3182F6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />✨ 스캔 보정 필터{' '}
                    {scanFilter ? 'ON' : 'OFF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIncludeMissingSlots((prev) => !prev)}
                    className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                  >
                    {includeMissingSlots ? (
                      <CheckSquare className="w-3.5 h-3.5 text-[#3182F6]" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-[#8B95A1]" />
                    )}
                    미첨부 지출도 공란 표시
                  </button>
                </div>
              </div>

              {/* 결재란 직분 커스터마이징 */}
              <div className="space-y-2.5 pt-2 border-t border-[#E5E8EB]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-bold text-[#4E5968]">
                    결재선 직분 & 작성자 정보
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={accountFilter}
                      onChange={(e) =>
                        onAccountFilterChange(e.target.value as AccountType)
                      }
                      className="h-8 px-3 rounded-xl bg-[#FFFFFF] text-[12px] font-semibold text-[#191F28] focus:outline-none"
                    >
                      <option value="all">계정: 전체 통합</option>
                      <option value="general">계정: 일반회계(운영비)</option>
                      <option value="retreat">계정: 수련회·행사비</option>
                      <option value="mission">계정: 목적헌금·선교</option>
                    </select>

                    <button
                      type="button"
                      onClick={toggleApprovalBox}
                      className={`px-3 py-1 rounded-xl text-[12px] font-semibold transition-all duration-150 active:scale-[0.97] ${
                        settings.showApprovalBox
                          ? 'bg-[#E8F3FF] text-[#1B64DA]'
                          : 'bg-[#E5E8EB] text-[#4E5968]'
                      }`}
                    >
                      결재란 {settings.showApprovalBox ? '표시 중' : '숨김'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#8B95A1] mb-1">
                      소속 부서명
                    </label>
                    <input
                      type="text"
                      value={settings.departmentName}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          departmentName: e.target.value,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-[12.5px] font-medium text-[#191F28] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#8B95A1] mb-1">
                      작성자(회계)
                    </label>
                    <input
                      type="text"
                      value={settings.authorName}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          authorName: e.target.value,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-[12.5px] font-medium text-[#191F28] focus:outline-none"
                    />
                  </div>
                  {([0, 1, 2, 3] as const).map((idx) => (
                    <div key={idx}>
                      <label className="block text-[11px] text-[#8B95A1] mb-1">
                        결재란 {idx + 1}열 직분
                      </label>
                      <input
                        type="text"
                        value={settings.approvalRoles[idx]}
                        onChange={(e) => handleRoleChange(idx, e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-[12.5px] font-medium text-[#191F28] focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
          모드 A: 모바일 친화적 영수증 증빙 카드 검수·편집 피드 (가로 스크롤 ZERO)
         ===================================================================== */}
      {screenMode === 'mobile_inspector' && (
        <div className="no-print max-w-[980px] mx-auto space-y-4">
          {/* 1. 월간 결산 요약 & 증빙 첨부율 카드 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[12px] font-bold text-[#3182F6]">
                  {yearMonthTitle} · {ACCOUNT_LABELS[accountFilter]} 결산 요약
                </span>
                <div className="text-[24px] sm:text-[28px] font-bold text-[#191F28] tabular-nums tracking-tight mt-0.5">
                  잔액 {formatWon(currentBalance)}
                </div>
                <div className="text-[12.5px] font-medium text-[#4E5968] tabular-nums mt-0.5">
                  {numberToKoreanCurrency(currentBalance)}
                </div>
              </div>

              <div
                className={`px-3 py-1.5 rounded-2xl text-[12px] font-bold tabular-nums shrink-0 ${
                  missingReceiptCount === 0
                    ? 'bg-[#E8F3FF] text-[#1B64DA]'
                    : 'bg-[#FFEEF0] text-[#F04452]'
                }`}
              >
                {missingReceiptCount === 0
                  ? `증빙 ${allExpenseEvidenceItems.length}건 완료`
                  : `영수증 미첨부 ${missingReceiptCount}건`}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <div className="bg-[#F9FAFB] rounded-2xl p-3">
                <div className="text-[11px] text-[#8B95A1]">전월 이월</div>
                <div className="text-[13.5px] font-bold text-[#4E5968] mt-0.5">
                  {formatWon(carryoverAmount)}
                </div>
              </div>
              <div className="bg-[#F9FAFB] rounded-2xl p-3">
                <div className="text-[11px] text-[#8B95A1]">금월 수입</div>
                <div className="text-[13.5px] font-bold text-[#3182F6] mt-0.5">
                  +{formatWon(monthlyIncome)}
                </div>
              </div>
              <div className="bg-[#F9FAFB] rounded-2xl p-3">
                <div className="text-[11px] text-[#8B95A1]">금월 지출</div>
                <div className="text-[13.5px] font-bold text-[#191F28] mt-0.5">
                  -{formatWon(monthlyExpense)}
                </div>
              </div>
            </div>

            {/* 증빙 필터 탭 */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1">
              {[
                {
                  id: 'all',
                  label: `전체 지출 증빙 (${allExpenseEvidenceItems.length})`,
                },
                {
                  id: 'missing',
                  label: `⚠️ 영수증 미첨부 (${missingReceiptCount})`,
                },
                {
                  id: 'attached',
                  label: `✅ 영수증 첨부됨 (${attachedReceiptCount})`,
                },
              ].map((tab) => {
                const active = inspectorFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() =>
                      setInspectorFilter(tab.id as InspectorFilter)
                    }
                    className={`px-3.5 py-2 rounded-full text-[12.5px] font-bold shrink-0 transition-all active:scale-[0.97] ${
                      active
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#F2F4F6] text-[#4E5968]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. 모바일 영수증 증빙 카드 리스트 (#01 ~ #N) */}
          {filteredInspectorItems.length === 0 ? (
            <div className="bg-[#FFFFFF] rounded-3xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-9 h-9 text-[#3182F6] mx-auto" />
              <div className="text-[15px] font-bold text-[#191F28]">
                {inspectorFilter === 'missing'
                  ? '모든 지출 내역에 영수증이 첨부되어 있습니다!'
                  : '표시할 지출 증빙 내역이 없습니다.'}
              </div>
              <div className="text-[13px] text-[#8B95A1]">
                하단 [A4 미리보기] 또는 [인쇄/PDF] 버튼을 눌러 결산서를 출력하세요.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredInspectorItems.map((tx) => {
                const mj = tx.mokjangId
                  ? mokjangMap.get(tx.mokjangId)
                  : undefined;
                const isUploading = uploadingTxId === tx.id;

                return (
                  <div
                    key={tx.id}
                    className="bg-[#FFFFFF] rounded-3xl p-5 flex flex-col justify-between space-y-3.5"
                  >
                    {/* 상단 헤더: 증빙번호 + 날짜/카테고리 + 금액 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2.5 py-0.5 rounded-lg bg-[#191F28] text-[#FFFFFF] text-[12px] font-bold tabular-nums">
                            증빙 {tx.evidenceNo}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-[#F2F4F6] text-[#4E5968] text-[11.5px] font-semibold tabular-nums">
                            {formatShortDate(tx.date)}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold">
                            {tx.category}
                            {tx.subCategory ? ` › ${tx.subCategory}` : ''}
                          </span>
                          {mj && (
                            <span className="px-2 py-0.5 rounded-lg bg-[#F9FAFB] text-[#4E5968] text-[11px] font-semibold">
                              {mj.name.split(' ')[0]}
                            </span>
                          )}
                        </div>
                        <div className="text-[15.5px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                          {tx.title}
                        </div>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-[16px] font-bold text-[#191F28]">
                          {formatWon(tx.amount)}
                        </div>
                        <div className="text-[11px] text-[#8B95A1]">
                          {tx.paymentMethod}
                        </div>
                      </div>
                    </div>

                    {/* 영수증 이미지 프리뷰 또는 즉시 촬영/첨부 슬롯 */}
                    <div className="rounded-2xl bg-[#F9FAFB] overflow-hidden flex flex-col items-center justify-center min-h-[210px] p-3 relative">
                      {tx.receiptImage ? (
                        <div className="w-full flex flex-col items-center space-y-2.5">
                          <img
                            src={tx.receiptImage}
                            alt={`증빙 ${tx.evidenceNo}`}
                            className={`max-h-[260px] w-full object-contain rounded-xl bg-[#FFFFFF] ${
                              scanFilter ? 'receipt-scan-filter' : ''
                            }`}
                          />
                          <div className="w-full flex items-center justify-between gap-2 pt-1">
                            <label className="flex-1 h-9 px-3 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.97]">
                              <Camera className="w-3.5 h-3.5 text-[#3182F6]" />
                              <span>
                                {isUploading
                                  ? '압축 저장 중...'
                                  : '사진 바로 교체'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) =>
                                  handleInlinePhotoUpload(
                                    tx,
                                    e.target.files?.[0]
                                  )
                                }
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => onSelectTransaction(tx)}
                              className="h-9 px-3 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold flex items-center justify-center gap-1 active:scale-[0.97]"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>상세/AI 스캔</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full py-6 px-4 text-center space-y-3">
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FFEEF0] text-[#F04452] text-[12px] font-bold">
                            [{tx.evidenceNo}] 영수증 미첨부
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <label className="h-10 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12.5px] font-bold flex items-center gap-1.5 cursor-pointer active:scale-[0.97]">
                              <Camera className="w-4 h-4" />
                              <span>
                                {isUploading
                                  ? '저장 중...'
                                  : '📷 사진 등록'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) =>
                                  handleInlinePhotoUpload(
                                    tx,
                                    e.target.files?.[0]
                                  )
                                }
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => onSelectTransaction(tx)}
                              className="h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[#191F28] text-[12.5px] font-semibold flex items-center gap-1.5 active:scale-[0.97]"
                            >
                              <Sparkles className="w-4 h-4 text-[#3182F6]" />
                              <span>AI 스캔</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 하단 산출근거 메모 인라인 편집란 */}
                    <div>
                      <label className="block text-[11.5px] font-semibold text-[#8B95A1] mb-1">
                        산출근거 · 메모
                      </label>
                      <input
                        type="text"
                        value={tx.memo}
                        onChange={(e) =>
                          handleInlineMemoChange(tx, e.target.value)
                        }
                        placeholder="예: 삼겹살 4인분 × 15,000원 외"
                        className="w-full h-10 px-3.5 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 모바일 하단 고정 미리보기/인쇄 바 */}
          <div className="sticky bottom-4 z-20 bg-[#191F28] text-[#FFFFFF] rounded-2xl p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-[#8B95A1]">
                장부 1장 + 영수증철 {receiptPages.length}장
              </div>
              <div className="text-[14.5px] font-bold tabular-nums truncate">
                증빙 {attachedReceiptCount}/{allExpenseEvidenceItems.length}건 첨부 완료
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setScreenMode('a4_preview')}
                className="h-10 px-3.5 rounded-xl bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12.5px] font-semibold flex items-center gap-1.5 active:scale-[0.97]"
              >
                <Eye className="w-4 h-4" />
                <span>A4 미리보기</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="h-10 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold flex items-center gap-1.5 active:scale-[0.97]"
              >
                <Printer className="w-4 h-4" />
                <span>인쇄/PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          모드 B & 실제 인쇄 DOM: 문서 1 (월별 회계 결산 보고서) + 문서 2 (영수증 증빙철)
          - 화면에서 mobile_inspector 모드일 때는 숨겨지지만 @media print(.print-force-show) 시에는 항상 출력됨
          - 화면에서 a4_preview 모드일 때는 모바일 화면 폭에 맞춰 자동 Scale-to-Fit 적용
         ===================================================================== */}
      <div
        className={`max-w-[980px] mx-auto space-y-6 print-force-show ${
          screenMode === 'mobile_inspector' ? 'hidden' : 'block'
        }`}
      >
        {/* 문서 1: 월별 회계 결산 보고서 (A4 1장 칼맞춤) */}
        {(outputMode === 'both' || outputMode === 'ledger_only') && (
          <A4ScalePreview zoomMode={a4ZoomMode}>
            <article className="a4-page flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-4 pb-3 border-b-2 border-[#191F28]">
                  <div className="pt-1 min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-[#4E5968] tracking-tight">
                      [{settings.departmentName} 재정 결산 공문서 · 문서 1]
                    </div>
                    <h1 className="text-[22px] font-bold text-[#191F28] mt-0.5 leading-tight break-words [word-break:keep-all]">
                      {yearMonthTitle} 청년부 회계 결산 보고서
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11.5px] text-[#4E5968] tabular-nums">
                      <span>
                        <strong>소속:</strong> {settings.departmentName}
                      </span>
                      <span>
                        <strong>회계구분:</strong>{' '}
                        {ACCOUNT_LABELS[accountFilter]}
                      </span>
                      <span>
                        <strong>작성일:</strong> {formatShortDate(reportDate)}
                      </span>
                      <span>
                        <strong>작성자:</strong> {settings.authorName}
                      </span>
                    </div>
                  </div>

                  {settings.showApprovalBox && (
                    <table className="border-collapse border border-[#191F28] text-center shrink-0">
                      <tbody>
                        <tr className="bg-[#F2F4F6]">
                          <td
                            rowSpan={2}
                            className="border border-[#191F28] px-2 py-1 text-[11px] font-bold text-[#191F28] w-6 leading-tight"
                          >
                            결
                            <br />재
                          </td>
                          {settings.approvalRoles.map((role, i) => (
                            <th
                              key={i}
                              className="border border-[#191F28] px-2.5 py-1 text-[10.5px] font-bold text-[#191F28] min-w-[54px] break-words"
                            >
                              {role}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {settings.approvalRoles.map((_, i) => (
                            <td
                              key={i}
                              className="border border-[#191F28] h-12 text-[10px] text-[#8B95A1] align-bottom pb-1"
                            >
                              (인)
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 요약 테이블 */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11.5px] font-bold text-[#191F28]">
                      1. 월간 수지 결산 요약
                    </span>
                    <span className="text-[10.5px] text-[#4E5968] tabular-nums">
                      금월 잔액 한글표기:{' '}
                      <strong>{numberToKoreanCurrency(currentBalance)}</strong>
                    </span>
                  </div>
                  <table className="w-full border-collapse border border-[#191F28] text-center tabular-nums">
                    <thead>
                      <tr className="bg-[#F2F4F6] text-[11px] font-bold text-[#191F28]">
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4">
                          전월 이월금 (A)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4">
                          금월 총수입 (B)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4">
                          금월 총지출 (C)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 w-1/4 bg-[#E8F3FF] text-[#1B64DA]">
                          금월 잔액 · 차월 이월금 (A+B-C)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="text-[13px] font-bold">
                        <td className="border border-[#191F28] py-2 px-2 text-[#4E5968]">
                          {formatWon(carryoverAmount)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-2 text-[#3182F6]">
                          +{formatWon(monthlyIncome)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-2 text-[#191F28]">
                          -{formatWon(monthlyExpense)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-2 bg-[#F9FAFB] text-[#191F28] text-[14px]">
                          {formatWon(currentBalance)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 본문 내역 테이블 */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11.5px] font-bold text-[#191F28]">
                      2. 일자별 수입·지출 상세 명세 (증빙번호는 [문서 2: 영수증 증빙철]과 1:1 매칭)
                    </span>
                    <span className="text-[10.5px] text-[#8B95A1] tabular-nums">
                      단위: 원 (₩)
                    </span>
                  </div>

                  <table className="w-full border-collapse border border-[#191F28] tabular-nums table-fixed">
                    <thead>
                      <tr className="bg-[#F2F4F6] text-[10.5px] font-bold text-[#191F28] text-center">
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[52px]">
                          일자
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1 w-[36px]">
                          구분
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[94px]">
                          관/항 · 세목
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-2 text-left">
                          적요 (내역 및 산출근거)
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[72px] text-right">
                          수입금액
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[72px] text-right">
                          지출금액
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1.5 w-[76px] text-right">
                          잔액
                        </th>
                        <th className="border border-[#191F28] py-1.5 px-1 w-[50px]">
                          증빙번호
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedTransactions.map((tx) => {
                        const mj = tx.mokjangId
                          ? mokjangMap.get(tx.mokjangId)
                          : undefined;
                        return (
                          <tr key={tx.id} className="text-[#191F28]">
                            <td
                              className={`border border-[#E5E8EB] border-x-[#191F28] text-center text-[#4E5968] align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.date.slice(5).replace('-', '.')}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-center font-semibold align-middle ${tableRowPaddingClass} ${
                                tx.type === 'income'
                                  ? 'text-[#3182F6]'
                                  : 'text-[#191F28]'
                              }`}
                            >
                              {tx.type === 'income' ? '수입' : '지출'}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-center text-[#4E5968] align-middle whitespace-pre-wrap break-words [word-break:keep-all] ${tableRowPaddingClass}`}
                            >
                              <div className="font-semibold text-[#191F28]">
                                {tx.category}
                              </div>
                              {tx.subCategory && (
                                <div className="text-[9.5px] text-[#4E5968] leading-tight mt-0.5">
                                  ({tx.subCategory})
                                </div>
                              )}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] align-top whitespace-pre-wrap break-words [word-break:keep-all] ${tableRowPaddingClass}`}
                            >
                              <div className="font-semibold text-[#191F28] leading-snug">
                                {tx.title}
                              </div>
                              {(tx.memo || mj) && (
                                <div className="text-[10px] text-[#4E5968] leading-snug mt-0.5">
                                  └{' '}
                                  {mj
                                    ? `[${mj.name.split(' ')[0]} ${
                                        tx.mokjangSubType
                                          ? MOKJANG_SUBTYPE_LABELS[
                                              tx.mokjangSubType
                                            ]
                                          : ''
                                      }] `
                                    : ''}
                                  {tx.memo} ({tx.paymentMethod})
                                </div>
                              )}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-right font-semibold text-[#3182F6] align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.type === 'income'
                                ? formatNumber(tx.amount)
                                : '-'}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-right font-semibold text-[#191F28] align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.type === 'expense'
                                ? formatNumber(tx.amount)
                                : '-'}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] text-right text-[#4E5968] align-middle ${tableRowPaddingClass}`}
                            >
                              {formatNumber(tx.runningBalance)}
                            </td>
                            <td
                              className={`border border-[#E5E8EB] border-r-[#191F28] text-center font-bold align-middle ${tableRowPaddingClass}`}
                            >
                              {tx.evidenceNo ? (
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                                    tx.receiptImage
                                      ? 'bg-[#E8F3FF] text-[#1B64DA]'
                                      : 'bg-[#FFEEF0] text-[#F04452]'
                                  }`}
                                >
                                  {tx.evidenceNo}
                                </span>
                              ) : (
                                <span className="text-[#8B95A1]">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="bg-[#F2F4F6] font-bold text-[11.5px] border-t-2 border-[#191F28]">
                        <td
                          colSpan={4}
                          className="border border-[#191F28] py-2 px-3 text-center text-[#191F28]"
                        >
                          합 계 (이월금 포함 총수입 vs 총지출)
                        </td>
                        <td className="border border-[#191F28] py-2 px-1.5 text-right text-[#3182F6]">
                          {formatNumber(carryoverAmount + monthlyIncome)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-1.5 text-right text-[#191F28]">
                          {formatNumber(monthlyExpense)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-1.5 text-right bg-[#E8F3FF] text-[#1B64DA]">
                          {formatNumber(currentBalance)}
                        </td>
                        <td className="border border-[#191F28] py-2 px-1 text-center text-[10px] text-[#4E5968]">
                          총 {evidenceItems.length}건
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 관/항별 지출 소계 요약 */}
                {categoryBreakdown.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10.5px] font-bold text-[#4E5968] mb-1">
                      3. 관/항(카테고리)별 지출 집행 내역 요약 (연간 예산안 연동)
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 tabular-nums">
                      {categoryBreakdown.map((item) => (
                        <div
                          key={item.category}
                          className="border border-[#E5E8EB] bg-[#F9FAFB] px-2.5 py-1.5 rounded flex items-start justify-between gap-2 text-[10.5px]"
                        >
                          <span className="text-[#4E5968] font-medium whitespace-pre-wrap break-words [word-break:keep-all]">
                            {item.category} ({item.count}건)
                          </span>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-[#191F28]">
                              {formatWon(item.total)}
                            </div>
                            {item.monthlyBudget > 0 && (
                              <div className="text-[9.5px] text-[#8B95A1]">
                                월예산 대비 {item.rate}%
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[#E5E8EB] flex items-center justify-between text-[11px] text-[#4E5968]">
                <div>
                  위와 같이 {yearMonthTitle} {settings.departmentName} 회계 결산 내역 및 별첨 영수증 증빙철을 보고합니다.
                </div>
                <div className="font-semibold text-[#191F28] tabular-nums">
                  문서 1 / 회계 결산 장부 (A4 1매)
                </div>
              </div>
            </article>
          </A4ScalePreview>
        )}

        {/* 문서 2: 월별 지출 증빙 영수증 첨부지 (A4 여러 장 자동 분할) */}
        {(outputMode === 'both' || outputMode === 'receipts_only') &&
          receiptPages.map((pageItems, pageIdx) => (
            <A4ScalePreview key={pageIdx} zoomMode={a4ZoomMode}>
              <article className="a4-page flex flex-col justify-between">
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between pb-2.5 border-b-2 border-[#191F28] mb-3.5">
                    <div>
                      <div className="text-[10.5px] font-semibold text-[#4E5968]">
                        [{settings.departmentName} 지출 증빙 서류 · 문서 2]
                      </div>
                      <h2 className="text-[18px] font-bold text-[#191F28] tabular-nums">
                        {yearMonthTitle} 청년부 지출 증빙 영수증 철 (Page{' '}
                        {pageIdx + 1} / {receiptPages.length})
                      </h2>
                    </div>

                    <table className="border-collapse border border-[#191F28] text-center text-[10px] shrink-0 tabular-nums">
                      <tbody>
                        <tr className="bg-[#F2F4F6] font-bold">
                          <td className="border border-[#191F28] px-2.5 py-0.5">
                            회계담당
                          </td>
                          <td className="border border-[#191F28] px-2.5 py-0.5">
                            부서장확인
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-[#191F28] px-2.5 py-2 text-[#4E5968]">
                            {settings.authorName} (인)
                          </td>
                          <td className="border border-[#191F28] px-2.5 py-2 text-[#8B95A1]">
                            (서명/인)
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {pageItems.length === 0 ? (
                    <div className="flex-1 border border-dashed border-[#D1D6DB] rounded-2xl flex flex-col items-center justify-center text-center p-8">
                      <FileSpreadsheet className="w-8 h-8 text-[#8B95A1] mb-2" />
                      <div className="text-[14px] font-semibold text-[#4E5968]">
                        해당 월에 등록된 지출 증빙 내역이 없습니다
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`grid gap-3.5 flex-1 ${
                        density === 2
                          ? 'grid-cols-2'
                          : 'grid-cols-2 grid-rows-2'
                      }`}
                    >
                      {pageItems.map((tx) => {
                        const slotCardHeightClass =
                          density === 2 ? 'h-[236mm]' : 'h-[114mm]';

                        return (
                          <div
                            key={tx.id}
                            className={`receipt-card ${slotCardHeightClass} border border-[#191F28] rounded-xl overflow-hidden flex flex-col justify-between bg-[#FFFFFF]`}
                          >
                            {/* 박스 상단 헤더 바 */}
                            <div className="bg-[#F2F4F6] border-b border-[#191F28] px-2.5 py-1.5 flex items-start justify-between gap-2 tabular-nums shrink-0">
                              <span className="px-1.5 py-0.5 rounded bg-[#191F28] text-[#FFFFFF] text-[10.5px] font-bold shrink-0 mt-0.5">
                                [증빙 {tx.evidenceNo}]
                              </span>

                              <span className="text-[10.5px] font-semibold text-[#191F28] flex-1 text-center whitespace-pre-wrap break-words [word-break:keep-all] leading-snug">
                                {formatShortDate(tx.date)} | {tx.category}
                                {tx.subCategory
                                  ? ` › ${tx.subCategory}`
                                  : ''}{' '}
                                | {tx.title}
                              </span>

                              <span className="text-[11.5px] font-bold text-[#191F28] shrink-0 mt-0.5">
                                {formatWon(tx.amount)}
                              </span>
                            </div>

                            {/* 박스 본문 */}
                            <div className="w-full flex-1 min-h-0 bg-[#FFFFFF] flex items-center justify-center p-2 overflow-hidden relative">
                              {tx.receiptImage ? (
                                <img
                                  src={tx.receiptImage}
                                  alt={`증빙 ${tx.evidenceNo} - ${tx.title}`}
                                  className={`max-h-full ${
                                    fitMode === 'contain'
                                      ? 'w-full h-full object-contain'
                                      : 'w-full h-full object-cover object-top'
                                  } ${scanFilter ? 'receipt-scan-filter' : ''}`}
                                />
                              ) : (
                                <div className="w-full h-full border border-dashed border-[#D1D6DB] rounded-lg flex flex-col items-center justify-center text-center p-4 bg-[#F9FAFB]">
                                  <div className="text-[12px] font-bold text-[#F04452] mb-1">
                                    [증빙 {tx.evidenceNo}] 디지털 영수증 미첨부
                                  </div>
                                  <div className="text-[11px] text-[#8B95A1] max-w-[200px] break-words [word-break:keep-all]">
                                    인쇄 후 이 자리에 실물 종이 영수증을 풀로 부착하거나, 아래 버튼으로 사진을 업로드하세요.
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onSelectTransaction(tx)}
                                    className="no-print mt-3 px-3 py-1.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[11.5px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                                  >
                                    <Upload className="w-3.5 h-3.5" />
                                    영수증 사진 지금 등록
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* 박스 하단: 상세 메모/산출근거 표시 */}
                            <div className="bg-[#F9FAFB] border-t border-[#E5E8EB] px-2.5 py-1.5 flex items-start justify-between gap-2 text-[10px] tabular-nums shrink-0">
                              <span className="text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all] leading-snug flex-1">
                                <strong>산출근거:</strong>{' '}
                                {tx.memo || tx.title}
                              </span>
                              <span className="text-[#8B95A1] shrink-0">
                                {tx.paymentMethod}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-2.5 mt-2 border-t border-[#E5E8EB] flex items-center justify-between text-[10.5px] text-[#8B95A1] tabular-nums">
                  <span>
                    ※ 본 증빙철의 [증빙 #번호]는 {yearMonthTitle} 회계 결산 보고서(문서 1) 우측 끝 열의 번호와 일치합니다.
                  </span>
                  <span className="font-semibold text-[#4E5968]">
                    Page {pageIdx + 1} of {receiptPages.length}
                  </span>
                </div>
              </article>
            </A4ScalePreview>
          ))}
      </div>
    </div>
  );
};
