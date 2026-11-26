import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  FolderPlus,
  Loader2,
  Minus,
  Plus,
  Square,
} from 'lucide-react';
import { AccountBalancesSummary } from '../types/finance';
import { formatNumber, formatWon } from '../utils/koreanCurrency';
import { TdsDialog } from './TdsDialog';

interface NewFiscalYearModalProps {
  open: boolean;
  onClose: () => void;
  sourceFiscalYear: number;
  existingYears: number[];
  closingBalances: AccountBalancesSummary;
  mokjangCount: number;
  annualBudgetItemCount: number;
  isGoogleConnected: boolean;
  isSubmitting: boolean;
  onCreateFiscalYear: (params: {
    targetYear: number;
    carryoverByAccount: { general: number; retreat: number; mission: number };
    copyMokjangs: boolean;
    copyAnnualBudget: boolean;
  }) => Promise<void>;
}

function parseAmountInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

export const NewFiscalYearModal: React.FC<NewFiscalYearModalProps> = ({
  open,
  onClose,
  sourceFiscalYear,
  existingYears,
  closingBalances,
  mokjangCount,
  annualBudgetItemCount,
  isGoogleConnected,
  isSubmitting,
  onCreateFiscalYear,
}) => {
  const suggestedYear = Math.max(sourceFiscalYear, ...existingYears) + 1;
  const [targetYear, setTargetYear] = useState<number>(suggestedYear);
  const [includeCarryover, setIncludeCarryover] = useState<boolean>(true);
  const [generalStr, setGeneralStr] = useState<string>('');
  const [retreatStr, setRetreatStr] = useState<string>('');
  const [missionStr, setMissionStr] = useState<string>('');
  const [copyMokjangs, setCopyMokjangs] = useState<boolean>(true);
  const [copyAnnualBudget, setCopyAnnualBudget] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    setTargetYear(Math.max(sourceFiscalYear, ...existingYears) + 1);
    setIncludeCarryover(true);
    setGeneralStr(
      closingBalances.general > 0
        ? formatNumber(Math.round(closingBalances.general))
        : '0'
    );
    setRetreatStr(
      closingBalances.retreat > 0
        ? formatNumber(Math.round(closingBalances.retreat))
        : '0'
    );
    setMissionStr(
      closingBalances.mission > 0
        ? formatNumber(Math.round(closingBalances.mission))
        : '0'
    );
    setCopyMokjangs(mokjangCount > 0);
    setCopyAnnualBudget(annualBudgetItemCount > 0);
  }, [
    open,
    sourceFiscalYear,
    existingYears,
    closingBalances.general,
    closingBalances.retreat,
    closingBalances.mission,
    mokjangCount,
    annualBudgetItemCount,
  ]);

  const alreadyExists = existingYears.includes(targetYear);
  const generalAmt = includeCarryover ? parseAmountInput(generalStr) : 0;
  const retreatAmt = includeCarryover ? parseAmountInput(retreatStr) : 0;
  const missionAmt = includeCarryover ? parseAmountInput(missionStr) : 0;
  const totalCarryover = generalAmt + retreatAmt + missionAmt;

  const handleSubmit = async () => {
    if (isSubmitting || alreadyExists) return;
    await onCreateFiscalYear({
      targetYear,
      carryoverByAccount: {
        general: generalAmt,
        retreat: retreatAmt,
        mission: missionAmt,
      },
      copyMokjangs,
      copyAnnualBudget,
    });
  };

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title="새 회계연도 시작"
      subtitle={`${sourceFiscalYear}년 데이터는 그대로 보존되고, 독립된 새 회기가 열립니다`}
      variant="modal"
    >
      <div className="space-y-4">
        {/* 1. 새 회계연도 선택 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-[#191F28]">
              생성할 회계연도
            </div>
            <div className="text-[11.5px] text-[#8B95A1]">
              {targetYear}년 1월 ~ 12월
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTargetYear((y) => Math.max(2020, y - 1))}
              aria-label="이전 연도"
              className="w-9 h-9 rounded-xl bg-[#FFFFFF] border border-[#E5E8EB] flex items-center justify-center text-[#4E5968] active:scale-[0.95]"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="min-w-[68px] text-center text-[16px] font-bold text-[#191F28] tabular-nums">
              {targetYear}년
            </span>
            <button
              type="button"
              onClick={() => setTargetYear((y) => Math.min(2099, y + 1))}
              aria-label="다음 연도"
              className="w-9 h-9 rounded-xl bg-[#FFFFFF] border border-[#E5E8EB] flex items-center justify-center text-[#4E5968] active:scale-[0.95]"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {alreadyExists && (
          <div className="px-3.5 py-2.5 rounded-2xl bg-[#FFF8E6] text-[#B45309] text-[12.5px] font-semibold break-words [word-break:keep-all]">
            {targetYear}년 회기가 이미 존재합니다. 다른 연도를 선택하거나 회기 선택 창에서 이동해 주세요.
          </div>
        )}

        {/* 2. 계정별 전기이월금 승계 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-4 space-y-3">
          <button
            type="button"
            onClick={() => setIncludeCarryover((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              {includeCarryover ? (
                <CheckSquare className="w-4 h-4 text-[#3182F6] shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-[#8B95A1] shrink-0" />
              )}
              <span className="text-[13.5px] font-bold text-[#191F28]">
                {sourceFiscalYear}년 기말잔액 전기이월
              </span>
            </div>
            <span className="text-[13px] font-bold text-[#3182F6] tabular-nums shrink-0">
              {formatWon(totalCarryover)}
            </span>
          </button>

          {includeCarryover && (
            <div className="space-y-2 pt-1">
              {[
                {
                  label: '일반회계(운영비)',
                  val: generalStr,
                  setVal: setGeneralStr,
                },
                {
                  label: '수련회·행사비',
                  val: retreatStr,
                  setVal: setRetreatStr,
                },
                {
                  label: '목적헌금·선교',
                  val: missionStr,
                  setVal: setMissionStr,
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-[12.5px] font-medium text-[#4E5968] shrink-0">
                    {row.label}
                  </span>
                  <div className="relative w-36 sm:w-40">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.val}
                      onChange={(e) => {
                        const n = parseAmountInput(e.target.value);
                        row.setVal(n > 0 ? formatNumber(n) : '0');
                      }}
                      className="w-full h-9 pl-3 pr-7 rounded-xl bg-[#FFFFFF] border border-[#E5E8EB] text-right text-[13px] font-bold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[#8B95A1] pointer-events-none">
                      원
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. 기본 틀 승계 옵션 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-3.5 sm:p-4 space-y-2.5">
          <div className="text-[12.5px] font-bold text-[#4E5968]">
            기본 틀 승계 (선택)
          </div>

          <button
            type="button"
            onClick={() => setCopyMokjangs((v) => !v)}
            className="w-full flex items-center gap-2 text-left py-1"
          >
            {copyMokjangs ? (
              <CheckSquare className="w-4 h-4 text-[#3182F6] shrink-0" />
            ) : (
              <Square className="w-4 h-4 text-[#8B95A1] shrink-0" />
            )}
            <span className="text-[13px] font-semibold text-[#191F28] break-words [word-break:keep-all]">
              목장 편성·예산 틀 복사 ({mokjangCount}개 목장, 지출은 0원 시작)
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCopyAnnualBudget((v) => !v)}
            className="w-full flex items-center gap-2 text-left py-1"
          >
            {copyAnnualBudget ? (
              <CheckSquare className="w-4 h-4 text-[#3182F6] shrink-0" />
            ) : (
              <Square className="w-4 h-4 text-[#8B95A1] shrink-0" />
            )}
            <span className="text-[13px] font-semibold text-[#191F28] break-words [word-break:keep-all]">
              연간 예산안 1·2·3차 항목 복사 ({annualBudgetItemCount}개 항목 초안)
            </span>
          </button>
        </div>

        {isGoogleConnected && (
          <div className="px-3.5 py-2.5 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold break-words [word-break:keep-all]">
            구글 드라이브에 <strong>청년부_회계_통합관리/{targetYear}년/</strong> 폴더와 전용 회계장부 시트가 자동 생성됩니다.
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="flex-1 h-12 rounded-2xl bg-[#F2F4F6] text-[#4E5968] text-[14px] font-bold active:scale-[0.97] transition-all disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={isSubmitting || alreadyExists}
            onClick={() => void handleSubmit()}
            className="flex-[1.6] h-12 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[14px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <FolderPlus className="w-4 h-4 shrink-0" />
            )}
            <span>{targetYear}년 회기 시작</span>
          </button>
        </div>
      </div>
    </TdsDialog>
  );
};
