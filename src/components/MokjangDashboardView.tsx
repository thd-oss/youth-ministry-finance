import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  Plus,
  Printer,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import {
  LedgerAccount,
  MOKJANG_SUBTYPE_LABELS,
  MokjangExpenseSubType,
  MokjangGroup,
  ProcessedTransaction,
} from '../types/finance';
import {
  formatNumber,
  formatShortDate,
  formatWon,
  formatYearMonthKorean,
} from '../utils/koreanCurrency';
import { computeMokjangSummary, MokjangSpendStat } from '../utils/syncManager';
import { AutoResizeTextarea } from './AutoResizeTextarea';

interface MokjangDashboardViewProps {
  yearMonth: string;
  mokjangs: MokjangGroup[];
  onUpdateMokjangs: (next: MokjangGroup[]) => void;
  processedTransactions: ProcessedTransaction[];
  onOpenNewMokjangTransaction: (
    mokjangId: string,
    subType: MokjangExpenseSubType
  ) => void;
  onSelectTransaction: (tx: ProcessedTransaction) => void;
}

export const MokjangDashboardView: React.FC<MokjangDashboardViewProps> = ({
  yearMonth,
  mokjangs,
  onUpdateMokjangs,
  processedTransactions,
  onOpenNewMokjangTransaction,
  onSelectTransaction,
}) => {
  const [selectedMokjangId, setSelectedMokjangId] = useState<string>('all');
  const [isEditingSetup, setIsEditingSetup] = useState<boolean>(false);
  const [copiedNotice, setCopiedNotice] = useState<string>('');

  const summary = useMemo(
    () => computeMokjangSummary(mokjangs, processedTransactions),
    [mokjangs, processedTransactions]
  );

  const selectedStat: MokjangSpendStat | undefined = useMemo(
    () => summary.stats.find((s) => s.mokjang.id === selectedMokjangId),
    [summary.stats, selectedMokjangId]
  );

  const parseDigits = (raw: string): number => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  const handleMokjangFieldChange = <K extends keyof MokjangGroup>(
    id: string,
    key: K,
    val: MokjangGroup[K]
  ) => {
    onUpdateMokjangs(
      mokjangs.map((m) => (m.id === id ? { ...m, [key]: val } : m))
    );
  };

  const handleAddMokjang = () => {
    const nextIdx = mokjangs.length + 1;
    const newGroup: MokjangGroup = {
      id: `mj-${Date.now()}`,
      name: `${nextIdx}목장 (새목장)`,
      leaderName: '담당 목자',
      memberCount: 8,
      visitationBudget: 100000,
      fellowshipBudget: 160000,
      note: '',
    };
    onUpdateMokjangs([...mokjangs, newGroup]);
  };

  const handleRemoveMokjang = (id: string) => {
    if (mokjangs.length <= 1) return;
    if (selectedMokjangId === id) setSelectedMokjangId('all');
    onUpdateMokjangs(mokjangs.filter((m) => m.id !== id));
  };

  // 목자 공유용 카톡/문자 브리핑 텍스트 복사
  const handleCopyShareText = async (targetStat?: MokjangSpendStat) => {
    const ymLabel = formatYearMonthKorean(yearMonth);
    let text = '';

    if (targetStat) {
      const { mokjang: mj } = targetStat;
      const lines = targetStat.transactions.map(
        (tx, idx) =>
          `  ${idx + 1}. [${tx.date.slice(5)}] ${
            tx.mokjangSubType
              ? MOKJANG_SUBTYPE_LABELS[tx.mokjangSubType]
              : '목장지출'
          } | ${tx.title} (${formatWon(tx.amount)})${
            tx.memo ? ` - ${tx.memo}` : ''
          }`
      );

      text = [
        `📊 [${ymLabel} ${mj.name} 심방비·회식비 지출 현황]`,
        `• 담당 목자: ${mj.leaderName} (${mj.memberCount}명)`,
        ``,
        `1️⃣ 심방비 현황`,
        `  - 배정 예산: ${formatWon(mj.visitationBudget)}`,
        `  - 사용 금액: ${formatWon(targetStat.visitationSpent)} (${targetStat.visitationRate}%)`,
        `  - 남은 잔액: ${formatWon(targetStat.visitationRemaining)}`,
        ``,
        `2️⃣ 회식·모임비 현황`,
        `  - 배정 예산: ${formatWon(mj.fellowshipBudget)}`,
        `  - 사용 금액: ${formatWon(targetStat.fellowshipSpent)} (${targetStat.fellowshipRate}%)`,
        `  - 남은 잔액: ${formatWon(targetStat.fellowshipRemaining)}`,
        ``,
        `💰 총 잔여 가용 예산: ${formatWon(targetStat.totalRemaining)} (총 ${formatWon(targetStat.totalBudget)} 중 ${formatWon(targetStat.totalSpent)} 사용)`,
        ``,
        `🧾 상세 지출 내역 (${targetStat.transactions.length}건)`,
        ...(lines.length > 0 ? lines : ['  - 이번 달 지출 내역이 없습니다.']),
      ].join('\n');
    } else {
      const mjLines = summary.stats.map(
        (st) =>
          `• ${st.mokjang.name} (${st.mokjang.leaderName}): 심방비 잔액 ${formatWon(
            st.visitationRemaining
          )} / 회식비 잔액 ${formatWon(st.fellowshipRemaining)} (총 사용률 ${st.totalRate}%)`
      );
      text = [
        `📊 [${ymLabel} 청년부 전체 목장 심방비·회식비 지출 현황]`,
        `• 전체 배정 예산: ${formatWon(summary.grandTotalBudget)}`,
        `• 전체 사용 금액: ${formatWon(summary.grandTotalSpent)} (${summary.grandTotalRate}%)`,
        `• 전체 남은 잔액: ${formatWon(summary.grandTotalRemaining)}`,
        ``,
        `[목장별 잔여 한도 요약]`,
        ...mjLines,
      ].join('\n');
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    setCopiedNotice(
      targetStat
        ? `${targetStat.mokjang.name} (${targetStat.mokjang.leaderName}) 공유용 브리핑 문구가 복사되었습니다!`
        : '전체 목장 지출 현황 요약 문구가 복사되었습니다!'
    );
    setTimeout(() => setCopiedNotice(''), 2800);
  };

  return (
    <div className="max-w-[980px] mx-auto space-y-5 pb-20 print-container">
      {/* 1. 상단 컨트롤 및 목장 필터 칩 바 */}
      <section className="no-print bg-[#FFFFFF] rounded-3xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <h2 className="text-[19px] font-bold text-[#191F28]">
            {formatYearMonthKorean(yearMonth)} 목장별 심방·회식비 현황
          </h2>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsEditingSetup((prev) => !prev)}
              className={`h-10 px-3.5 rounded-2xl text-[13px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150 ${
                isEditingSetup
                  ? 'bg-[#191F28] text-[#FFFFFF]'
                  : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              예산 설정
            </button>

            <button
              type="button"
              onClick={() => handleCopyShareText(selectedStat)}
              className="h-10 px-3.5 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <Copy className="w-4 h-4" />
              카톡 공유 복사
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="h-10 px-4 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <Printer className="w-4 h-4" />
              인쇄
            </button>
          </div>
        </div>

        {copiedNotice && (
          <div className="px-4 py-3 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{copiedNotice}</span>
          </div>
        )}

        {/* 목장 선택 필터 칩 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedMokjangId('all')}
            className={`px-4 py-2 rounded-full text-[13.5px] font-semibold shrink-0 transition-all duration-150 active:scale-[0.97] ${
              selectedMokjangId === 'all'
                ? 'bg-[#3182F6] text-[#FFFFFF]'
                : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
            }`}
          >
            전체 목장 ({mokjangs.length})
          </button>

          {summary.stats.map((st) => {
            const active = selectedMokjangId === st.mokjang.id;
            return (
              <button
                key={st.mokjang.id}
                type="button"
                onClick={() => setSelectedMokjangId(st.mokjang.id)}
                className={`px-4 py-2 rounded-full text-[13.5px] font-semibold shrink-0 flex items-center gap-1.5 transition-all duration-150 active:scale-[0.97] ${
                  active
                    ? 'bg-[#191F28] text-[#FFFFFF]'
                    : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
                }`}
              >
                <span>{st.mokjang.name}</span>
                <span
                  className={`text-[12px] ${
                    active ? 'text-[#FFFFFF]/80' : 'text-[#8B95A1]'
                  }`}
                >
                  · {st.mokjang.leaderName}
                </span>
              </button>
            );
          })}
        </div>

        {/* 목장 및 배정예산 인라인 설정 패널 */}
        {isEditingSetup && (
          <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-bold text-[#191F28]">
                  목장 목록 및 심방비·회식비 배정 예산 관리
                </div>
                <div className="text-[12px] text-[#8B95A1]">
                  목장명, 담당 목자, 배정 예산을 수정하면 시각화 게이지와 잔여 한도가 즉시 재계산됩니다.
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddMokjang}
                className="px-3 py-1.5 rounded-full bg-[#3182F6] text-[#FFFFFF] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
              >
                <Plus className="w-3.5 h-3.5" />+ 목장 추가
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px] tabular-nums">
                <thead>
                  <tr className="bg-[#E5E8EB] text-[#191F28] font-bold text-left">
                    <th className="py-2 px-2.5 rounded-l-xl w-[22%]">목장명</th>
                    <th className="py-2 px-2.5 w-[16%]">담당 목자</th>
                    <th className="py-2 px-2 w-[10%] text-center">인원(명)</th>
                    <th className="py-2 px-2.5 w-[18%] text-right">심방비 배정액</th>
                    <th className="py-2 px-2.5 w-[18%] text-right">회식·모임비 배정액</th>
                    <th className="py-2 px-2.5 rounded-r-xl w-[16%]">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E8EB]">
                  {mokjangs.map((mj) => (
                    <tr key={mj.id} className="bg-[#FFFFFF]">
                      <td className="p-2 align-top">
                        <AutoResizeTextarea
                          value={mj.name}
                          onChange={(e) =>
                            handleMokjangFieldChange(mj.id, 'name', e.target.value)
                          }
                          className="font-semibold text-[#191F28]"
                        />
                      </td>
                      <td className="p-2 align-top">
                        <AutoResizeTextarea
                          value={mj.leaderName}
                          onChange={(e) =>
                            handleMokjangFieldChange(
                              mj.id,
                              'leaderName',
                              e.target.value
                            )
                          }
                          className="text-[#4E5968]"
                        />
                      </td>
                      <td className="p-2 align-top text-center">
                        <input
                          type="number"
                          min={1}
                          value={mj.memberCount}
                          onChange={(e) =>
                            handleMokjangFieldChange(
                              mj.id,
                              'memberCount',
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="w-14 text-center bg-[#F9FAFB] rounded-lg py-1 font-semibold text-[#191F28] focus:outline-none tabular-nums"
                        />
                      </td>
                      <td className="p-2 align-top text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatNumber(mj.visitationBudget)}
                          onChange={(e) =>
                            handleMokjangFieldChange(
                              mj.id,
                              'visitationBudget',
                              parseDigits(e.target.value)
                            )
                          }
                          className="w-28 text-right bg-[#F9FAFB] rounded-lg px-2 py-1 font-semibold text-[#3182F6] focus:outline-none tabular-nums"
                        />
                      </td>
                      <td className="p-2 align-top text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatNumber(mj.fellowshipBudget)}
                          onChange={(e) =>
                            handleMokjangFieldChange(
                              mj.id,
                              'fellowshipBudget',
                              parseDigits(e.target.value)
                            )
                          }
                          className="w-28 text-right bg-[#F9FAFB] rounded-lg px-2 py-1 font-semibold text-[#1B64DA] focus:outline-none tabular-nums"
                        />
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex items-start gap-1">
                          <AutoResizeTextarea
                            value={mj.note || ''}
                            placeholder="특이사항"
                            onChange={(e) =>
                              handleMokjangFieldChange(mj.id, 'note', e.target.value)
                            }
                            className="text-[#8B95A1] text-[12px]"
                          />
                          {mokjangs.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMokjang(mj.id)}
                              className="text-[#8B95A1] hover:text-[#F04452] p-1 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* =====================================================================
          모드 A: 전체 목장 한눈에 보기 (selectedMokjangId === 'all')
         ===================================================================== */}
      {selectedMokjangId === 'all' && (
        <div className="space-y-5">
          {/* 전체 목장 총괄 Hero 카드 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-[13px] font-semibold text-[#4E5968]">
                  {formatYearMonthKorean(yearMonth)} 전체 {mokjangs.length}개 목장 합산 가용 잔액
                </span>
                <div className="text-[30px] font-bold text-[#191F28] tabular-nums mt-1">
                  {formatWon(summary.grandTotalRemaining)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-bold tabular-nums">
                  전체 예산 소진율 {summary.grandTotalRate}%
                </span>
              </div>
            </div>

            {/* 전체 요약 3열 캡슐 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-[#F9FAFB] rounded-2xl p-4">
                <div className="text-[12px] font-medium text-[#8B95A1]">
                  전체 목장 배정 예산 합계
                </div>
                <div className="mt-1 text-[17px] font-bold text-[#4E5968] tabular-nums">
                  {formatWon(summary.grandTotalBudget)}
                </div>
                <div className="mt-1 text-[12px] text-[#8B95A1] tabular-nums">
                  심방 {formatWon(summary.grandVisitationBudget)} · 회식{' '}
                  {formatWon(summary.grandFellowshipBudget)}
                </div>
              </div>

              <div className="bg-[#F9FAFB] rounded-2xl p-4">
                <div className="text-[12px] font-medium text-[#8B95A1]">
                  💐 전체 심방비 지출 / 배정
                </div>
                <div className="mt-1 text-[17px] font-bold text-[#3182F6] tabular-nums">
                  {formatWon(summary.grandVisitationSpent)}{' '}
                  <span className="text-[13px] font-normal text-[#8B95A1]">
                    / {formatWon(summary.grandVisitationBudget)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[#E5E8EB] overflow-hidden">
                  <div
                    className="h-full bg-[#3182F6] rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        summary.grandVisitationBudget > 0
                          ? Math.round(
                              (summary.grandVisitationSpent /
                                summary.grandVisitationBudget) *
                                100
                            )
                          : 0
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="bg-[#F9FAFB] rounded-2xl p-4">
                <div className="text-[12px] font-medium text-[#8B95A1]">
                  🍙 전체 회식·모임비 지출 / 배정
                </div>
                <div className="mt-1 text-[17px] font-bold text-[#191F28] tabular-nums">
                  {formatWon(summary.grandFellowshipSpent)}{' '}
                  <span className="text-[13px] font-normal text-[#8B95A1]">
                    / {formatWon(summary.grandFellowshipBudget)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[#E5E8EB] overflow-hidden">
                  <div
                    className="h-full bg-[#1B64DA] rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        summary.grandFellowshipBudget > 0
                          ? Math.round(
                              (summary.grandFellowshipSpent /
                                summary.grandFellowshipBudget) *
                                100
                            )
                          : 0
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 목장별 심방비 & 회식비 비교 시각화 카드 그리드 */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summary.stats.map((st) => {
              const isOverOrNear =
                st.totalRate >= 85 ||
                st.visitationRemaining < 0 ||
                st.fellowshipRemaining < 0;

              return (
                <div
                  key={st.mokjang.id}
                  className="bg-[#FFFFFF] rounded-3xl p-6 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-4">
                    {/* 카드 상단: 목장명, 목자명, 소진율 배지 */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[18px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                            {st.mokjang.name}
                          </h3>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[12px] font-bold tabular-nums shrink-0 ${
                              isOverOrNear
                                ? 'bg-[#FFEEF0] text-[#F04452]'
                                : 'bg-[#E8F3FF] text-[#1B64DA]'
                            }`}
                          >
                            소진율 {st.totalRate}%
                          </span>
                        </div>
                        <div className="text-[13px] text-[#4E5968] mt-0.5 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-[#8B95A1]" />
                          <span>
                            {st.mokjang.leaderName} · 목장원 {st.mokjang.memberCount}명
                          </span>
                          {st.mokjang.note && (
                            <span className="text-[#8B95A1]">· {st.mokjang.note}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-[#8B95A1]">남은 총한도</div>
                        <div
                          className={`text-[16px] font-bold tabular-nums ${
                            st.totalRemaining < 0 ? 'text-[#F04452]' : 'text-[#191F28]'
                          }`}
                        >
                          {formatWon(st.totalRemaining)}
                        </div>
                      </div>
                    </div>

                    {/* 심방비 시각화 프로그레스 바 */}
                    <div className="bg-[#F9FAFB] rounded-2xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-[13px] tabular-nums">
                        <span className="font-semibold text-[#191F28]">
                          💐 심방비 ({st.visitationRate}%)
                        </span>
                        <span className="text-[#4E5968]">
                          사용 <strong className="text-[#191F28]">{formatWon(st.visitationSpent)}</strong> / 배정{' '}
                          {formatWon(st.mokjang.visitationBudget)}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-[#E5E8EB] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            st.visitationRemaining < 0 ? 'bg-[#F04452]' : 'bg-[#3182F6]'
                          }`}
                          style={{
                            width: `${Math.min(100, Math.max(0, st.visitationRate))}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[12px] tabular-nums">
                        <span className="text-[#8B95A1]">가용 심방비 잔액</span>
                        <span
                          className={`font-bold ${
                            st.visitationRemaining < 0
                              ? 'text-[#F04452]'
                              : 'text-[#3182F6]'
                          }`}
                        >
                          {formatWon(st.visitationRemaining)}
                        </span>
                      </div>
                    </div>

                    {/* 회식·모임비 시각화 프로그레스 바 */}
                    <div className="bg-[#F9FAFB] rounded-2xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-[13px] tabular-nums">
                        <span className="font-semibold text-[#191F28]">
                          🍙 회식·모임비 ({st.fellowshipRate}%)
                        </span>
                        <span className="text-[#4E5968]">
                          사용 <strong className="text-[#191F28]">{formatWon(st.fellowshipSpent)}</strong> / 배정{' '}
                          {formatWon(st.mokjang.fellowshipBudget)}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-[#E5E8EB] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            st.fellowshipRemaining < 0 ? 'bg-[#F04452]' : 'bg-[#1B64DA]'
                          }`}
                          style={{
                            width: `${Math.min(100, Math.max(0, st.fellowshipRate))}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[12px] tabular-nums">
                        <span className="text-[#8B95A1]">가용 회식·모임비 잔액</span>
                        <span
                          className={`font-bold ${
                            st.fellowshipRemaining < 0
                              ? 'text-[#F04452]'
                              : 'text-[#1B64DA]'
                          }`}
                        >
                          {formatWon(st.fellowshipRemaining)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 카드 하단 액션: 단독 공유 뷰 열기 / 카톡 복사 / 지출 등록 */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenNewMokjangTransaction(st.mokjang.id, 'visitation')
                        }
                        className="px-3 py-1.5 rounded-xl bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#4E5968] text-[12px] font-semibold active:scale-[0.97] transition-all duration-150"
                      >
                        + 심방비 기록
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenNewMokjangTransaction(st.mokjang.id, 'fellowship')
                        }
                        className="px-3 py-1.5 rounded-xl bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#4E5968] text-[12px] font-semibold active:scale-[0.97] transition-all duration-150"
                      >
                        + 회식비 기록
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedMokjangId(st.mokjang.id)}
                      className="px-3.5 py-1.5 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                    >
                      <span>이 목장 내역만 단독 보기 ({st.transactions.length}건)</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          {/* 전체 목장 심방비·회식비 정산 비교 표 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-bold text-[#191F28]">
                목장별 심방비·회식비 예산 집행 요약표
              </h3>
              <span className="text-[12px] text-[#8B95A1] tabular-nums">
                행 클릭 시 해당 목장 단독 공유 화면으로 전환됩니다
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-[#E5E8EB] text-[13px] tabular-nums">
                <thead>
                  <tr className="bg-[#F2F4F6] text-[#191F28] font-bold text-center">
                    <th className="border border-[#E5E8EB] py-2.5 px-3 text-left">
                      목장명 / 담당목자
                    </th>
                    <th className="border border-[#E5E8EB] py-2.5 px-3 text-right">
                      심방비 (사용 / 배정)
                    </th>
                    <th className="border border-[#E5E8EB] py-2.5 px-3 text-right">
                      심방비 잔액
                    </th>
                    <th className="border border-[#E5E8EB] py-2.5 px-3 text-right">
                      회식·모임비 (사용 / 배정)
                    </th>
                    <th className="border border-[#E5E8EB] py-2.5 px-3 text-right">
                      회식비 잔액
                    </th>
                    <th className="border border-[#E5E8EB] py-2.5 px-3 text-right bg-[#E8F3FF] text-[#1B64DA]">
                      총 잔여한도
                    </th>
                    <th className="border border-[#E5E8EB] py-2.5 px-2.5">소진율</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.stats.map((st) => (
                    <tr
                      key={st.mokjang.id}
                      onClick={() => setSelectedMokjangId(st.mokjang.id)}
                      className="hover:bg-[#F9FAFB] cursor-pointer transition-colors"
                    >
                      <td className="border border-[#E5E8EB] py-2.5 px-3 whitespace-pre-wrap break-words [word-break:keep-all]">
                        <div className="font-bold text-[#191F28]">
                          {st.mokjang.name}
                        </div>
                        <div className="text-[12px] text-[#8B95A1]">
                          {st.mokjang.leaderName} ({st.mokjang.memberCount}명)
                        </div>
                      </td>
                      <td className="border border-[#E5E8EB] py-2.5 px-3 text-right">
                        <span className="font-semibold text-[#191F28]">
                          {formatWon(st.visitationSpent)}
                        </span>{' '}
                        <span className="text-[11.5px] text-[#8B95A1]">
                          / {formatWon(st.mokjang.visitationBudget)}
                        </span>
                      </td>
                      <td className="border border-[#E5E8EB] py-2.5 px-3 text-right font-bold text-[#3182F6]">
                        {formatWon(st.visitationRemaining)}
                      </td>
                      <td className="border border-[#E5E8EB] py-2.5 px-3 text-right">
                        <span className="font-semibold text-[#191F28]">
                          {formatWon(st.fellowshipSpent)}
                        </span>{' '}
                        <span className="text-[11.5px] text-[#8B95A1]">
                          / {formatWon(st.mokjang.fellowshipBudget)}
                        </span>
                      </td>
                      <td className="border border-[#E5E8EB] py-2.5 px-3 text-right font-bold text-[#1B64DA]">
                        {formatWon(st.fellowshipRemaining)}
                      </td>
                      <td className="border border-[#E5E8EB] py-2.5 px-3 text-right font-bold text-[#191F28] bg-[#F9FAFB]">
                        {formatWon(st.totalRemaining)}
                      </td>
                      <td className="border border-[#E5E8EB] py-2.5 px-2.5 text-center font-bold">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11.5px] ${
                            st.totalRate >= 85
                              ? 'bg-[#FFEEF0] text-[#F04452]'
                              : 'bg-[#E8F3FF] text-[#1B64DA]'
                          }`}
                        >
                          {st.totalRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
          모드 B: 특정 목장 단독 뷰 (목자 공유 전용 화면)
         ===================================================================== */}
      {selectedStat && (
        <div className="space-y-5">
          {/* 특정 목장 전용 Hero 카드 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-[#191F28] text-[#FFFFFF] text-[12px] font-bold">
                    {selectedStat.mokjang.name} 단독 정산 뷰
                  </span>
                  <span className="text-[14px] font-semibold text-[#4E5968]">
                    담당: {selectedStat.mokjang.leaderName} ({selectedStat.mokjang.memberCount}명)
                  </span>
                </div>

                <div className="mt-3 text-[13px] font-medium text-[#8B95A1]">
                  {formatYearMonthKorean(yearMonth)} 남은 총 가용 예산 (심방비 + 회식·모임비)
                </div>
                <div className="mt-1 text-[30px] font-bold text-[#191F28] tabular-nums">
                  {formatWon(selectedStat.totalRemaining)}
                </div>
                <div className="mt-1 text-[13px] text-[#4E5968] tabular-nums">
                  총 배정 예산 {formatWon(selectedStat.totalBudget)} 중{' '}
                  <strong className="text-[#191F28]">
                    {formatWon(selectedStat.totalSpent)} ({selectedStat.totalRate}%)
                  </strong>{' '}
                  집행 완료
                </div>
              </div>

              <div className="no-print flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onOpenNewMokjangTransaction(
                      selectedStat.mokjang.id,
                      'visitation'
                    )
                  }
                  className="px-4 py-2.5 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-semibold active:scale-[0.97] transition-all duration-150"
                >
                  + 심방비 지출 등록
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenNewMokjangTransaction(
                      selectedStat.mokjang.id,
                      'fellowship'
                    )
                  }
                  className="px-4 py-2.5 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-semibold active:scale-[0.97] transition-all duration-150"
                >
                  + 회식·모임비 지출 등록
                </button>
              </div>
            </div>

            {/* 심방비 vs 회식·모임비 2열 시각화 게이지 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 심방비 카드 */}
              <div className="bg-[#F9FAFB] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-bold text-[#191F28]">
                    💐 심방비 예산 현황
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#E8F3FF] text-[#3182F6] text-[12px] font-bold tabular-nums">
                    사용률 {selectedStat.visitationRate}%
                  </span>
                </div>

                <div className="flex items-baseline justify-between tabular-nums">
                  <div>
                    <div className="text-[12px] text-[#8B95A1]">남은 심방비 한도</div>
                    <div className="text-[22px] font-bold text-[#3182F6]">
                      {formatWon(selectedStat.visitationRemaining)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] text-[#8B95A1]">사용액 / 배정액</div>
                    <div className="text-[14px] font-semibold text-[#191F28]">
                      {formatWon(selectedStat.visitationSpent)} /{' '}
                      {formatWon(selectedStat.mokjang.visitationBudget)}
                    </div>
                  </div>
                </div>

                <div className="h-3 rounded-full bg-[#E5E8EB] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      selectedStat.visitationRemaining < 0
                        ? 'bg-[#F04452]'
                        : 'bg-[#3182F6]'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, selectedStat.visitationRate)
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* 회식·모임비 카드 */}
              <div className="bg-[#F9FAFB] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-bold text-[#191F28]">
                    🍙 회식·모임비 예산 현황
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold tabular-nums">
                    사용률 {selectedStat.fellowshipRate}%
                  </span>
                </div>

                <div className="flex items-baseline justify-between tabular-nums">
                  <div>
                    <div className="text-[12px] text-[#8B95A1]">
                      남은 회식·모임비 한도
                    </div>
                    <div className="text-[22px] font-bold text-[#1B64DA]">
                      {formatWon(selectedStat.fellowshipRemaining)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] text-[#8B95A1]">사용액 / 배정액</div>
                    <div className="text-[14px] font-semibold text-[#191F28]">
                      {formatWon(selectedStat.fellowshipSpent)} /{' '}
                      {formatWon(selectedStat.mokjang.fellowshipBudget)}
                    </div>
                  </div>
                </div>

                <div className="h-3 rounded-full bg-[#E5E8EB] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      selectedStat.fellowshipRemaining < 0
                        ? 'bg-[#F04452]'
                        : 'bg-[#1B64DA]'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, selectedStat.fellowshipRate)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 선택된 목장의 상세 지출 내역 리스트 (멀티라인 줄바꿈 지원) */}
          <section className="bg-[#FFFFFF] rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-[18px] font-bold text-[#191F28]">
                  {selectedStat.mokjang.name} 상세 사용 내역
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-[#F2F4F6] text-[#4E5968] text-[12.5px] font-bold tabular-nums">
                  {selectedStat.transactions.length}건
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleCopyShareText(selectedStat)}
                className="no-print px-3.5 py-1.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
              >
                <Copy className="w-3.5 h-3.5" />
                {selectedStat.mokjang.leaderName}님 공유용 요약 복사
              </button>
            </div>

            {selectedStat.transactions.length === 0 ? (
              <div className="py-12 text-center bg-[#F9FAFB] rounded-2xl">
                <div className="text-[15px] font-semibold text-[#4E5968]">
                  이번 달 기록된 {selectedStat.mokjang.name} 지출 내역이 없습니다
                </div>
                <div className="text-[13px] text-[#8B95A1] mt-1">
                  상단 [+ 심방비 지출 등록] 또는 [+ 회식·모임비 지출 등록]으로 내역을 추가해 보세요.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedStat.transactions.map((tx) => {
                  const subLabel = tx.mokjangSubType
                    ? MOKJANG_SUBTYPE_LABELS[tx.mokjangSubType]
                    : tx.category.includes('심방')
                      ? '심방비'
                      : '회식·모임비';
                  const isVisitation = subLabel === '심방비';

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
                      className="w-full p-4 rounded-2xl bg-[#F9FAFB] hover:bg-[#F2F4F6] flex items-start justify-between gap-4 cursor-pointer active:scale-[0.97] transition-all duration-150"
                    >
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-full bg-[#FFFFFF] flex items-center justify-center text-[18px] shrink-0">
                          {isVisitation ? '💐' : '🍙'}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11.5px] font-bold ${
                                isVisitation
                                  ? 'bg-[#E8F3FF] text-[#3182F6]'
                                  : 'bg-[#E8F3FF] text-[#1B64DA]'
                              }`}
                            >
                              {subLabel}
                            </span>
                            <span className="text-[12.5px] text-[#8B95A1] tabular-nums">
                              {formatShortDate(tx.date)} · {tx.category} ·{' '}
                              {tx.paymentMethod}
                            </span>
                            {tx.evidenceNo && tx.receiptImage && (
                              <span className="px-2 py-0.5 rounded-full bg-[#FFFFFF] text-[#1B64DA] text-[11.5px] font-semibold tabular-nums">
                                증빙 {tx.evidenceNo}
                              </span>
                            )}
                            {!tx.receiptImage && (
                              <span className="px-2 py-0.5 rounded-full bg-[#FFEEF0] text-[#F04452] text-[11.5px] font-semibold">
                                영수증 미첨부
                              </span>
                            )}
                          </div>

                          <div className="text-[15.5px] font-semibold text-[#191F28] whitespace-pre-wrap break-words [word-break:keep-all]">
                            {tx.title}
                          </div>

                          {tx.memo && (
                            <div className="text-[13px] text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all]">
                              산출근거: {tx.memo}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-[16px] font-bold text-[#191F28]">
                          -{formatWon(tx.amount)}
                        </div>
                        <div className="text-[12px] text-[#8B95A1] mt-0.5">
                          클릭하여 영수증 보기
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
