import React from 'react';
import { Calendar, Check, FolderOpen, Loader2, Plus } from 'lucide-react';
import { FiscalYearCloudRef } from '../types/finance';
import { getFiscalYearMonths } from '../utils/syncManager';
import { TdsDialog } from './TdsDialog';

interface FiscalPeriodModalProps {
  open: boolean;
  onClose: () => void;
  activeFiscalYear: number;
  yearMonth: string;
  availableFiscalYears: number[];
  cloudWorkspaces?: Record<string, FiscalYearCloudRef>;
  monthlyTxCounts: Record<string, number>;
  isSwitchingYear: boolean;
  onSelectFiscalYear: (year: number) => void;
  onSelectMonth: (ym: string) => void;
  onOpenNewFiscalYear: () => void;
}

export const FiscalPeriodModal: React.FC<FiscalPeriodModalProps> = ({
  open,
  onClose,
  activeFiscalYear,
  yearMonth,
  availableFiscalYears,
  cloudWorkspaces,
  monthlyTxCounts,
  isSwitchingYear,
  onSelectFiscalYear,
  onSelectMonth,
  onOpenNewFiscalYear,
}) => {
  const months = getFiscalYearMonths(activeFiscalYear);
  const currentCloudRef = cloudWorkspaces?.[String(activeFiscalYear)];

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title="회계연도 · 월 선택"
      subtitle="1월~12월 회기 단위로 장부·목장·예산안·영수증이 분리 관리됩니다"
      variant="modal"
    >
      <div className="space-y-5">
        {/* 1. 회계연도(회기) 선택 바 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold text-[#4E5968]">
              회계연도 (회기)
            </span>
            <button
              type="button"
              disabled={isSwitchingYear}
              onClick={() => {
                onClose();
                onOpenNewFiscalYear();
              }}
              className="h-8 px-3 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold inline-flex items-center gap-1 whitespace-nowrap active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>새 회기 시작</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {availableFiscalYears.map((fy) => {
              const isActive = fy === activeFiscalYear;
              const hasCloud = Boolean(cloudWorkspaces?.[String(fy)]?.spreadsheetId);
              return (
                <button
                  key={fy}
                  type="button"
                  disabled={isSwitchingYear}
                  onClick={() => {
                    if (fy !== activeFiscalYear) {
                      onSelectFiscalYear(fy);
                    }
                  }}
                  className={`h-10 px-3.5 rounded-2xl text-[13.5px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-all active:scale-[0.97] disabled:opacity-60 ${
                    isActive
                      ? 'bg-[#191F28] text-[#FFFFFF]'
                      : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
                  }`}
                >
                  {isActive && isSwitchingYear ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : hasCloud ? (
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isActive ? 'bg-[#00C471]' : 'bg-[#00C471]/80'
                      }`}
                    />
                  ) : null}
                  <span className="tabular-nums">{fy}년</span>
                  {isActive && !isSwitchingYear && (
                    <Check className="w-3.5 h-3.5 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {currentCloudRef?.folderUrl && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F9FAFB] text-[11.5px] text-[#4E5968]">
              <span className="truncate">
                드라이브 폴더: 청년부_회계_통합관리/{activeFiscalYear}년
              </span>
              <a
                href={currentCloudRef.folderUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#3182F6] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 hover:underline"
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span>열기</span>
              </a>
            </div>
          )}
        </div>

        {/* 2. 해당 회기 1월~12월 그리드 */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#4E5968]">
            <Calendar className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
            <span>{activeFiscalYear}년 월별 이동</span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {months.map((ym, idx) => {
              const monthNum = idx + 1;
              const isSelected = ym === yearMonth;
              const count = monthlyTxCounts[ym] || 0;
              return (
                <button
                  key={ym}
                  type="button"
                  disabled={isSwitchingYear}
                  onClick={() => {
                    onSelectMonth(ym);
                    onClose();
                  }}
                  className={`h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all active:scale-[0.97] disabled:opacity-50 ${
                    isSelected
                      ? 'bg-[#3182F6] text-[#FFFFFF]'
                      : count > 0
                        ? 'bg-[#F2F4F6] text-[#191F28] hover:bg-[#E5E8EB]'
                        : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#F2F4F6]'
                  }`}
                >
                  <span className="text-[14px] font-bold tabular-nums">
                    {monthNum}월
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      isSelected
                        ? 'text-[#FFFFFF]/90'
                        : count > 0
                          ? 'text-[#3182F6]'
                          : 'text-[#8B95A1]'
                    }`}
                  >
                    {count > 0 ? `${count}건` : '내역 없음'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </TdsDialog>
  );
};
