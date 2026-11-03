import React, { useMemo, useState } from 'react';
import {
  Camera,
  ChevronRight,
  Download,
  FileCheck2,
  Plus,
  Printer,
  Rocket,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  ACCOUNT_LABELS,
  AccountType,
  getCategoryIconMeta,
  MOKJANG_SUBTYPE_LABELS,
  MokjangGroup,
  ProcessedTransaction,
} from '../types/finance';
import {
  formatDateHeader,
  formatSignedWon,
  formatWon,
  formatYearMonthKorean,
} from '../utils/koreanCurrency';
import { CategoryBudgetAllocation } from '../utils/syncManager';

interface LedgerViewProps {
  yearMonth: string;
  accountFilter: AccountType;
  onAccountFilterChange: (acc: AccountType) => void;
  processedTransactions: ProcessedTransaction[];
  carryoverAmount: number;
  monthlyIncome: number;
  monthlyExpense: number;
  currentBalance: number;
  missingReceiptCount: number;
  mokjangs: MokjangGroup[];
  categoryAllocations: Record<string, CategoryBudgetAllocation>;
  isProductionMode: boolean;
  hasGeminiKey: boolean;
  onOpenNewTransaction: (autoTriggerCamera?: boolean) => void;
  onSelectTransaction: (tx: ProcessedTransaction) => void;
  onExportCsv: () => void;
  onSwitchToPrintCenter: () => void;
  onSwitchToMokjangShare: () => void;
  onOpenProductionSetup: () => void;
  onOpenGeminiSetup: () => void;
}

type ListFilterType = 'all' | 'income' | 'expense' | 'missing_receipt';

export const LedgerView: React.FC<LedgerViewProps> = ({
  yearMonth,
  accountFilter,
  onAccountFilterChange,
  processedTransactions,
  carryoverAmount,
  monthlyIncome,
  monthlyExpense,
  currentBalance,
  missingReceiptCount,
  mokjangs,
  categoryAllocations,
  isProductionMode,
  hasGeminiKey,
  onOpenNewTransaction,
  onSelectTransaction,
  onExportCsv,
  onSwitchToPrintCenter,
  onSwitchToMokjangShare,
  onOpenProductionSetup,
  onOpenGeminiSetup,
}) => {
  const [listFilter, setListFilter] = useState<ListFilterType>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const mokjangMap = useMemo(
    () => new Map(mokjangs.map((m) => [m.id, m])),
    [mokjangs]
  );

  const filteredTransactions = useMemo(() => {
    return processedTransactions.filter((tx) => {
      if (listFilter === 'income' && tx.type !== 'income') return false;
      if (listFilter === 'expense' && tx.type !== 'expense') return false;
      if (
        listFilter === 'missing_receipt' &&
        !(tx.type === 'expense' && !tx.receiptImage)
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const mjName = tx.mokjangId
          ? (mokjangMap.get(tx.mokjangId)?.name || '').toLowerCase()
          : '';
        const matchTitle = tx.title.toLowerCase().includes(q);
        const matchMemo = tx.memo.toLowerCase().includes(q);
        const matchCategory = tx.category.toLowerCase().includes(q);
        const matchEvidence = (tx.evidenceNo || '').toLowerCase().includes(q);
        const matchMokjang = mjName.includes(q);
        if (
          !matchTitle &&
          !matchMemo &&
          !matchCategory &&
          !matchEvidence &&
          !matchMokjang
        ) {
          return false;
        }
      }

      return true;
    });
  }, [processedTransactions, listFilter, searchQuery, mokjangMap]);

  const groupedByDate = useMemo(() => {
    const groups: { date: string; items: ProcessedTransaction[] }[] = [];
    filteredTransactions.forEach((tx) => {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.date !== tx.date) {
        groups.push({ date: tx.date, items: [tx] });
      } else {
        lastGroup.items.push(tx);
      }
    });
    return groups;
  }, [filteredTransactions]);

  const budgetComparison = useMemo(() => {
    const spentMap = new Map<string, number>();
    processedTransactions
      .filter((tx) => tx.type === 'expense')
      .forEach((tx) => {
        spentMap.set(tx.category, (spentMap.get(tx.category) || 0) + tx.amount);
      });

    const allCats = Array.from(
      new Set([
        ...Object.keys(categoryAllocations),
        ...Array.from(spentMap.keys()),
      ])
    );

    return allCats.map((cat) => {
      const spent = spentMap.get(cat) || 0;
      const monthlyBudget = categoryAllocations[cat]?.monthlyBudget || 0;
      const rate =
        monthlyBudget > 0 ? Math.round((spent / monthlyBudget) * 100) : 0;
      return { category: cat, spent, monthlyBudget, rate };
    });
  }, [processedTransactions, categoryAllocations]);

  const accounts: AccountType[] = ['all', 'general', 'retreat', 'mission'];

  return (
    <div className="max-w-[780px] mx-auto space-y-4 pb-16">
      {/* 실제 서비스 전환 안내 배너 (데모 샘플 모드일 때만 표시) */}
      {!isProductionMode && (
        <div className="bg-[#FFFFFF] rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center shrink-0">
              <Rocket className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[14px] font-bold text-[#191F28]">
                실제 청년부 회계 장부로 바로 시작해 보세요
              </div>
              <div className="text-[12px] text-[#8B95A1]">
                현재 기능 체험용 샘플이 표시 중입니다 · 샘플을 비우고 실제 장부로 바로 전환할 수 있어요
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!hasGeminiKey && (
              <button
                type="button"
                onClick={onOpenGeminiSetup}
                className="px-3 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Gemini 연결
              </button>
            )}
            <button
              type="button"
              onClick={onOpenProductionSetup}
              className="px-3.5 py-2 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[12px] font-bold active:scale-[0.97] transition-all duration-150"
            >
              실제 장부로 시작 →
            </button>
          </div>
        </div>
      )}

      {/* 1. 통장 쪼개기 탭 필터 */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 no-scrollbar">
        <div className="flex items-center gap-2">
          {accounts.map((acc) => {
            const isActive = accountFilter === acc;
            return (
              <button
                key={acc}
                type="button"
                onClick={() => onAccountFilterChange(acc)}
                className={`px-4 py-2 rounded-full text-[14px] font-semibold shrink-0 transition-all duration-150 ease-out active:scale-[0.97] ${
                  isActive
                    ? 'bg-[#191F28] text-[#FFFFFF]'
                    : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
                }`}
              >
                {ACCOUNT_LABELS[acc]}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onSwitchToMokjangShare}
          className="px-3.5 py-2 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-bold shrink-0 flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
        >
          <Users className="w-3.5 h-3.5" />
          목장별 심방·회식비 현황
        </button>
      </div>

      {/* 2. 메인 잔액 카드 (Hero Card) */}
      <section className="bg-[#FFFFFF] rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-[#4E5968]">
            {formatYearMonthKorean(yearMonth)} · {ACCOUNT_LABELS[accountFilter]}{' '}
            현재 잔액
          </span>
          <button
            type="button"
            onClick={onSwitchToPrintCenter}
            className="px-3 py-1.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
          >
            <Printer className="w-3.5 h-3.5" />
            결산장부·영수증철 인쇄
          </button>
        </div>

        {/* Hero Balance */}
        <div className="mt-2 text-[30px] font-bold text-[#191F28] tabular-nums tracking-tight">
          {formatWon(currentBalance)}
        </div>

        {/* 전월 이월금 / 이번 달 수입 / 이번 달 지출 요약 캡슐 */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
            <div className="text-[12px] font-medium text-[#8B95A1]">
              전월 이월금
            </div>
            <div className="mt-1 text-[15px] font-semibold text-[#4E5968] tabular-nums">
              {formatWon(carryoverAmount)}
            </div>
          </div>

          <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
            <div className="text-[12px] font-medium text-[#8B95A1]">
              이번 달 수입
            </div>
            <div className="mt-1 text-[15px] font-semibold text-[#3182F6] tabular-nums">
              +{formatWon(monthlyIncome)}
            </div>
          </div>

          <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
            <div className="text-[12px] font-medium text-[#8B95A1]">
              이번 달 지출
            </div>
            <div className="mt-1 text-[15px] font-semibold text-[#191F28] tabular-nums">
              -{formatWon(monthlyExpense)}
            </div>
          </div>
        </div>

        {/* 하단 원스톱 액션 버튼 2종: [📸 영수증 찍어서 AI 자동 기장] + [+ 수기 내역 등록] */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => onOpenNewTransaction(true)}
            className="sm:col-span-2 h-13 px-4 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[15.5px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all duration-150 ease-out"
          >
            <Camera className="w-5 h-5" />
            <span>📸 영수증 찍어서 AI 자동 기장</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenNewTransaction(false)}
            className="h-13 px-4 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[15px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all duration-150 ease-out"
          >
            <Plus className="w-4 h-4" />
            <span>직접 내역 입력</span>
          </button>
        </div>
      </section>

      {/* 3. 영수증 미증빙 알림 배너 */}
      {missingReceiptCount > 0 && (
        <button
          type="button"
          onClick={() =>
            setListFilter((prev) =>
              prev === 'missing_receipt' ? 'all' : 'missing_receipt'
            )
          }
          className="w-full bg-[#FFEEF0] rounded-3xl px-5 py-4 flex items-center justify-between gap-3 text-left active:scale-[0.97] transition-all duration-150 ease-out"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[20px] shrink-0" role="img" aria-label="경고">
              🚨
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-[#F04452] tabular-nums break-words [word-break:keep-all]">
                영수증 사진이 누락된 지출이 {missingReceiptCount}건 있어요
              </div>
              <div className="text-[13px] text-[#4E5968] mt-0.5 break-words [word-break:keep-all]">
                {listFilter === 'missing_receipt'
                  ? '현재 미증빙 내역만 보고 있어요 · 다시 누르면 전체 내역으로 돌아갑니다'
                  : '여기를 눌러 미증빙 내역만 모아보고 영수증 사진을 등록하세요'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[13px] font-semibold text-[#F04452] shrink-0">
            <span>
              {listFilter === 'missing_receipt' ? '전체보기' : '모아보기'}
            </span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>
      )}

      {/* 4. 연간 예산안 연동: 관/항별 월 예산 대비 집행 현황 바 */}
      {budgetComparison.length > 0 && (
        <section className="bg-[#FFFFFF] rounded-3xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-bold text-[#191F28]">
              예산안 연동 · 관/항별 월평균 예산 대비 지출 현황
            </span>
            <span className="text-[12px] text-[#8B95A1]">
              연간 예산안 수정 시 자동 반영
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {budgetComparison.map((item) => (
              <div
                key={item.category}
                className="bg-[#F9FAFB] rounded-2xl p-3 space-y-1.5 tabular-nums"
              >
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-semibold text-[#191F28] break-words [word-break:keep-all]">
                    {item.category}
                  </span>
                  <span className="text-[#4E5968] shrink-0">
                    <strong className="text-[#191F28]">
                      {formatWon(item.spent)}
                    </strong>
                    {item.monthlyBudget > 0 && (
                      <span className="text-[11.5px] text-[#8B95A1]">
                        {' '}
                        / 월 {formatWon(item.monthlyBudget)} ({item.rate}%)
                      </span>
                    )}
                  </span>
                </div>
                {item.monthlyBudget > 0 && (
                  <div className="h-1.5 rounded-full bg-[#E5E8EB] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        item.rate > 100 ? 'bg-[#F04452]' : 'bg-[#3182F6]'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, item.rate))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. 일자별 거래 내역 피드 */}
      <section className="bg-[#FFFFFF] rounded-3xl pt-5 pb-3">
        <div className="px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-[19px] font-bold text-[#191F28]">거래 내역</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-[#F2F4F6] text-[#4E5968] text-[13px] font-semibold tabular-nums">
              {filteredTransactions.length}건
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportCsv}
              className="px-3 py-1.5 rounded-full bg-[#F9FAFB] hover:bg-[#E5E8EB] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <Download className="w-3.5 h-3.5" />
              엑셀(CSV) 저장
            </button>
          </div>
        </div>

        {/* 검색창 & 상태 필터 칩 */}
        <div className="px-5 space-y-3 mb-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8B95A1] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="가맹점명, 산출근거, 카테고리, 목장명(1목장), 증빙번호(#01) 검색"
              className="w-full h-11 pl-10 pr-9 rounded-2xl bg-[#F9FAFB] text-[14px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:bg-[#F2F4F6]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B95A1] hover:text-[#4E5968]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {[
              { id: 'all', label: '전체' },
              { id: 'income', label: '수입 내역' },
              { id: 'expense', label: '지출 내역' },
              {
                id: 'missing_receipt',
                label: `영수증 미첨부 (${missingReceiptCount})`,
              },
            ].map((chip) => {
              const active = listFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setListFilter(chip.id as ListFilterType)}
                  className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold shrink-0 transition-all duration-150 ease-out active:scale-[0.97] ${
                    active
                      ? chip.id === 'missing_receipt'
                        ? 'bg-[#F04452] text-[#FFFFFF]'
                        : 'bg-[#3182F6] text-[#FFFFFF]'
                      : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 일자별 내역 리스트 */}
        {groupedByDate.length === 0 ? (
          <div className="py-16 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-[#F9FAFB] text-[#8B95A1] flex items-center justify-center mx-auto mb-3">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <div className="text-[16px] font-semibold text-[#4E5968]">
              기록된 거래 내역이 없어요
            </div>
            <div className="text-[13px] text-[#8B95A1] mt-1">
              상단 [📸 영수증 찍어서 AI 자동 기장] 버튼을 눌러 첫 영수증을 촬영해 보세요!
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedByDate.map((group) => (
              <div key={group.date}>
                <div className="px-5 pt-3 pb-1 text-[13px] font-medium text-[#8B95A1] tabular-nums">
                  {formatDateHeader(group.date)}
                </div>

                <div>
                  {group.items.map((tx) => {
                    const iconMeta = getCategoryIconMeta(tx.category, tx.type);
                    const hasReceipt = Boolean(tx.receiptImage);
                    const mokjang = tx.mokjangId
                      ? mokjangMap.get(tx.mokjangId)
                      : undefined;

                    return (
                      <div
                        key={tx.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectTransaction(tx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectTransaction(tx);
                          }
                        }}
                        style={{ padding: '14px 20px' }}
                        className="w-full flex items-start justify-between gap-3 rounded-2xl cursor-pointer select-none hover:bg-[#F9FAFB] active:scale-[0.97] active:bg-[#F2F4F6] transition-all duration-150 ease-out"
                      >
                        <div className="flex items-start gap-3.5 min-w-0 flex-1">
                          <div
                            style={{ backgroundColor: iconMeta.bg }}
                            className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] shrink-0 mt-0.5"
                          >
                            {iconMeta.emoji}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="text-[16px] font-medium text-[#191F28] whitespace-pre-wrap break-words [word-break:keep-all] leading-snug">
                              {tx.title}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] font-normal text-[#8B95A1] tabular-nums">
                              <span>{tx.category}</span>
                              <span>·</span>
                              <span>{tx.paymentMethod}</span>

                              {mokjang && (
                                <span className="px-2 py-0.5 rounded-full bg-[#F2F4F6] text-[#4E5968] text-[11.5px] font-semibold">
                                  {mokjang.name.split(' ')[0]} ·{' '}
                                  {tx.mokjangSubType
                                    ? MOKJANG_SUBTYPE_LABELS[tx.mokjangSubType]
                                    : '목장지출'}
                                </span>
                              )}

                              {tx.evidenceNo && hasReceipt && (
                                <span className="px-2 py-0.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-semibold tabular-nums">
                                  증빙 {tx.evidenceNo}
                                </span>
                              )}

                              {tx.type === 'expense' && !hasReceipt && (
                                <span className="px-2 py-0.5 rounded-full bg-[#FFEEF0] text-[#F04452] text-[11.5px] font-semibold tabular-nums">
                                  {tx.evidenceNo ? `${tx.evidenceNo} ` : ''}영수증 미첨부
                                </span>
                              )}
                            </div>

                            {tx.memo && (
                              <div className="mt-1 text-[12.5px] text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all] leading-snug">
                                {tx.memo}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0 pt-0.5">
                          <div
                            className={`text-[16px] font-semibold tabular-nums ${
                              tx.type === 'income'
                                ? 'text-[#3182F6]'
                                : 'text-[#191F28]'
                            }`}
                          >
                            {formatSignedWon(tx.amount, tx.type)}
                          </div>
                          <div className="mt-0.5 text-[13px] font-normal text-[#8B95A1] tabular-nums">
                            잔액 {formatWon(tx.runningBalance)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
