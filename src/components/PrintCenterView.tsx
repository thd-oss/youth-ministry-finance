import React, { useMemo, useState } from 'react';
import {
  CheckSquare,
  Eye,
  FileSpreadsheet,
  Image as ImageIcon,
  Layers,
  Printer,
  SlidersHorizontal,
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
} from '../types/finance';
import {
  formatNumber,
  formatShortDate,
  formatWon,
  formatYearMonthKorean,
  numberToKoreanCurrency,
} from '../utils/koreanCurrency';
import { CategoryBudgetAllocation } from '../utils/syncManager';

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
}

type PrintOutputMode = 'both' | 'ledger_only' | 'receipts_only';
type ReceiptDensity = 2 | 4;
type ReceiptFitMode = 'contain' | 'width';

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
}) => {
  const [outputMode, setOutputMode] = useState<PrintOutputMode>('both');
  const [density, setDensity] = useState<ReceiptDensity>(4);
  const [fitMode, setFitMode] = useState<ReceiptFitMode>('contain');
  const [scanFilter, setScanFilter] = useState<boolean>(false);
  const [includeMissingSlots, setIncludeMissingSlots] = useState<boolean>(true);
  const [reportDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  const mokjangMap = useMemo(
    () => new Map(mokjangs.map((m) => [m.id, m])),
    [mokjangs]
  );

  const evidenceItems = useMemo(() => {
    return processedTransactions.filter((tx) => {
      if (!tx.evidenceNo) return false;
      if (!includeMissingSlots && !tx.receiptImage) return false;
      return true;
    });
  }, [processedTransactions, includeMissingSlots]);

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

  const yearMonthTitle = formatYearMonthKorean(yearMonth);

  return (
    <div className="space-y-6 pb-20 print-container">
      {/* 1. 인쇄 옵션 컨트롤 바 (@media print 시 완벽 숨김: .no-print) */}
      <section className="no-print max-w-[980px] mx-auto bg-[#FFFFFF] rounded-3xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold">
                이중 결재 자동화
              </span>
              <h2 className="text-[19px] font-bold text-[#191F28]">
                월별 결산 장부 + 영수증 증빙철 A4 인쇄 센터
              </h2>
            </div>
            <p className="text-[13px] text-[#8B95A1] mt-1">
              [문서 1: 월별 회계 결산서] 우측 끝 열의 증빙번호(#01~)와 [문서 2: 영수증 증빙철] 슬롯 헤더가 1:1로 자동 매칭됩니다.
            </p>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="h-12 px-6 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[15px] font-semibold flex items-center justify-center gap-2 shrink-0 active:scale-[0.97] transition-all duration-150"
          >
            <Printer className="w-4 h-4" />
            🖨️ A4 인쇄 / PDF 저장
          </button>
        </div>

        {/* 통장 계정 선택 + 출력 모드 선택 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
          <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#4E5968]">
              <Layers className="w-4 h-4 text-[#3182F6]" />
              출력 문서 구성 선택
            </div>
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
                    className={`p-3 rounded-xl text-left transition-all duration-150 active:scale-[0.97] ${
                      active
                        ? 'bg-[#3182F6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#191F28] hover:bg-[#E5E8EB]'
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
          </div>

          <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#4E5968]">
              <ImageIcon className="w-4 h-4 text-[#3182F6]" />
              영수증 증빙철 레이아웃 & 이미지 옵션
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
                <Eye className="w-3.5 h-3.5 text-[#3182F6]" />
                피팅:{' '}
                {fitMode === 'contain'
                  ? '원본 비율 전체보기 (object-contain)'
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
                <Sparkles className="w-3.5 h-3.5" />✨ 영수증 스캔 보정 필터{' '}
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
                미첨부 지출도 실물 부착 공란으로 표시
              </button>
            </div>
          </div>
        </div>

        {/* 결재란 직분 커스터마이징 & 회계계정 필터 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#4E5968]">
              <SlidersHorizontal className="w-4 h-4 text-[#3182F6]" />
              결재란 직분 커스터마이징 & 보고서 기본 정보
            </div>

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
                  onUpdateSettings({ ...settings, authorName: e.target.value })
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
      </section>

      {/* =====================================================================
          문서 1: 월별 회계 결산 보고서 (A4 1장 칼맞춤 · 멀티라인 셀 자동 확장)
         ===================================================================== */}
      {(outputMode === 'both' || outputMode === 'ledger_only') && (
        <div className="overflow-x-auto py-1">
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
                      <strong>회계구분:</strong> {ACCOUNT_LABELS[accountFilter]}
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

              {/* 본문 내역 테이블 (모든 셀 줄바꿈 및 세로 확장 지원) */}
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
                      <th className="border border-[#191F28] py-1.5 px-1.5 w-[88px]">
                        관/항(카테고리)
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
                            {tx.category}
                          </td>
                          <td
                            className={`border border-[#E5E8EB] align-top whitespace-pre-wrap break-words [word-break:keep-all] ${tableRowPaddingClass}`}
                          >
                            <div className="font-semibold text-[#191F28] leading-snug">
                              {tx.title}
                            </div>
                            {(tx.memo || mj) && (
                              <div className="text-[10px] text-[#4E5968] leading-snug mt-0.5">
                                └ {mj ? `[${mj.name.split(' ')[0]} ${tx.mokjangSubType ? MOKJANG_SUBTYPE_LABELS[tx.mokjangSubType] : ''}] ` : ''}
                                {tx.memo} ({tx.paymentMethod})
                              </div>
                            )}
                          </td>
                          <td
                            className={`border border-[#E5E8EB] text-right font-semibold text-[#3182F6] align-middle ${tableRowPaddingClass}`}
                          >
                            {tx.type === 'income' ? formatNumber(tx.amount) : '-'}
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

              {/* 관/항별 지출 소계 요약 (줄바꿈 지원 & 연간 예산안 연동 집행률 표기) */}
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
        </div>
      )}

      {/* =====================================================================
          문서 2: 월별 지출 증빙 영수증 첨부지 (A4 여러 장 자동 분할 · 헤더/메모 줄바꿈 지원)
         ===================================================================== */}
      {(outputMode === 'both' || outputMode === 'receipts_only') &&
        receiptPages.map((pageItems, pageIdx) => (
          <div key={pageIdx} className="overflow-x-auto py-1">
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
                          {/* 박스 상단 헤더 바 (말줄임 없이 줄바꿈되어 세로로 확장) */}
                          <div className="bg-[#F2F4F6] border-b border-[#191F28] px-2.5 py-1.5 flex items-start justify-between gap-2 tabular-nums shrink-0">
                            <span className="px-1.5 py-0.5 rounded bg-[#191F28] text-[#FFFFFF] text-[10.5px] font-bold shrink-0 mt-0.5">
                              [증빙 {tx.evidenceNo}]
                            </span>

                            <span className="text-[10.5px] font-semibold text-[#191F28] flex-1 text-center whitespace-pre-wrap break-words [word-break:keep-all] leading-snug">
                              {formatShortDate(tx.date)} | {tx.category} |{' '}
                              {tx.title}
                            </span>

                            <span className="text-[11.5px] font-bold text-[#191F28] shrink-0 mt-0.5">
                              {formatWon(tx.amount)}
                            </span>
                          </div>

                          {/* 박스 본문: 남은 높이를 유동적으로 차지(flex-1 min-h-0)하여 영수증 원본이 절대 잘리지 않게 렌더링 */}
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

                          {/* 박스 하단: 상세 메모/산출근거 표시 (줄바꿈 지원) */}
                          <div className="bg-[#F9FAFB] border-t border-[#E5E8EB] px-2.5 py-1.5 flex items-start justify-between gap-2 text-[10px] tabular-nums shrink-0">
                            <span className="text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all] leading-snug flex-1">
                              <strong>산출근거:</strong> {tx.memo || tx.title}
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
          </div>
        ))}
    </div>
  );
};
