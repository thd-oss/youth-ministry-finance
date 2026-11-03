import React, { useState } from 'react';
import {
  CheckCircle2,
  FileText,
  Link2,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  AppSettings,
  BudgetDocument,
  BudgetLineItem,
  BudgetTemplateType,
} from '../types/finance';
import {
  formatNumber,
  formatShortDate,
  formatWon,
  numberToKoreanCurrency,
} from '../utils/koreanCurrency';
import {
  INITIAL_ANNUAL_BUDGET,
  INITIAL_RETREAT_BUDGET,
} from '../utils/sampleData';
import { AutoResizeTextarea } from './AutoResizeTextarea';

interface BudgetBuilderViewProps {
  budgets: Record<BudgetTemplateType, BudgetDocument>;
  onUpdateBudget: (
    templateType: BudgetTemplateType,
    nextDoc: BudgetDocument
  ) => void;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  activeExpenseCategories: string[];
}

export const BudgetBuilderView: React.FC<BudgetBuilderViewProps> = ({
  budgets,
  onUpdateBudget,
  settings,
  onUpdateSettings,
  activeExpenseCategories,
}) => {
  const [activeTemplate, setActiveTemplate] =
    useState<BudgetTemplateType>('retreat_claim');

  const doc = budgets[activeTemplate];

  const totalGrossAmount = doc.items.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );
  const netChurchClaimAmount = Math.max(
    0,
    totalGrossAmount - (Number(doc.selfBurdenAmount) || 0)
  );

  const handleFieldChange = <K extends keyof BudgetDocument>(
    key: K,
    value: BudgetDocument[K]
  ) => {
    onUpdateBudget(activeTemplate, {
      ...doc,
      [key]: value,
    });
  };

  const handleItemChange = <K extends keyof BudgetLineItem>(
    id: string,
    key: K,
    value: BudgetLineItem[K]
  ) => {
    const nextItems = doc.items.map((item) =>
      item.id === id ? { ...item, [key]: value } : item
    );
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: nextItems,
    });
  };

  const handleAddRow = () => {
    const newItem: BudgetLineItem = {
      id: `bg-${Date.now()}`,
      category:
        activeTemplate === 'retreat_claim' ? '프로그램/기타' : '신규사역비',
      itemName: '세부 예산 항목명을 입력하세요',
      formula: '10,000원 × 10명 × 1회',
      amount: 100000,
      note: '',
    };
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: [...doc.items, newItem],
    });
  };

  const handleRemoveRow = (id: string) => {
    if (doc.items.length <= 1) return;
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
    });
  };

  const handleResetTemplate = () => {
    const defaultDoc =
      activeTemplate === 'retreat_claim'
        ? INITIAL_RETREAT_BUDGET
        : INITIAL_ANNUAL_BUDGET;
    onUpdateBudget(activeTemplate, defaultDoc);
  };

  const parseDigits = (raw: string): number => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  const toggleSchemaSync = () => {
    onUpdateSettings({
      ...settings,
      syncCategoriesWithAnnualBudget: !settings.syncCategoriesWithAnnualBudget,
    });
  };

  return (
    <div className="space-y-6 pb-20 print-container">
      {/* 상단 컨트롤 바 (.no-print) */}
      <section className="no-print max-w-[980px] mx-auto bg-[#FFFFFF] rounded-3xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold">
                공문서 빌더 & 예산 스키마 연동
              </span>
              <h2 className="text-[19px] font-bold text-[#191F28]">
                연초·연말 예산안 & 수련회 재정 청구서 빌더 (A4 1장 칼맞춤)
              </h2>
            </div>
            <p className="text-[13px] text-[#8B95A1] mt-1">
              셀 내용이 길어지면 자동으로 줄바꿈되어 세로 높이가 늘어나며, 연간 예산안의 관/항 구조가 앱 전체 장부 카테고리와 실시간 연동됩니다.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleResetTemplate}
              className="h-12 px-4 rounded-2xl bg-[#F2F4F6] text-[#4E5968] text-[13px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <RotateCcw className="w-4 h-4" />
              샘플 기본값 복원
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="h-12 px-6 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[15px] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-all duration-150"
            >
              <Printer className="w-4 h-4" />
              🖨️ A4 청구서/예산안 인쇄
            </button>
          </div>
        </div>

        {/* 1. 문서 템플릿 전환 토글 */}
        <div className="bg-[#F2F4F6] p-1.5 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTemplate('retreat_claim')}
            className={`py-3 px-4 rounded-xl text-left flex items-center justify-between transition-all duration-150 active:scale-[0.97] ${
              activeTemplate === 'retreat_claim'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#4E5968] hover:text-[#191F28]'
            }`}
          >
            <div>
              <div className="text-[14px] font-bold">
                🏕️ 수련회/행사 재정 청구서 (가불·지원금 신청)
              </div>
              <div className="text-[12px] text-[#8B95A1] mt-0.5">
                동계·하계 수련회, 특별집회, 아웃리치 때 재정부에 제출하는 청구 공문서
              </div>
            </div>
            {activeTemplate === 'retreat_claim' && (
              <span className="px-2.5 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11px] font-bold shrink-0">
                선택됨
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTemplate('annual_budget')}
            className={`py-3 px-4 rounded-xl text-left flex items-center justify-between transition-all duration-150 active:scale-[0.97] ${
              activeTemplate === 'annual_budget'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#4E5968] hover:text-[#191F28]'
            }`}
          >
            <div>
              <div className="text-[14px] font-bold">
                📅 연초/연말 정기 예산 심의안 (장부 관/항 구조 연동)
              </div>
              <div className="text-[12px] text-[#8B95A1] mt-0.5">
                매년 예산안의 구분(관/항)을 수정하면 장부 입력 카테고리와 결산서가 자동 변경됩니다
              </div>
            </div>
            {activeTemplate === 'annual_budget' && (
              <span className="px-2.5 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11px] font-bold shrink-0">
                선택됨
              </span>
            )}
          </button>
        </div>

        {/* 연도별 예산안 구조 ↔ 앱 전체 카테고리 자동 연동 배너 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[13.5px] font-bold text-[#191F28]">
              <Link2 className="w-4 h-4 text-[#3182F6]" />
              <span>
                연도별 예산안 관/항 구조 ↔ 회계 장부 카테고리 실시간 동기화
              </span>
            </div>
            <div className="text-[12px] text-[#4E5968]">
              [연초/연말 정기 예산 심의안]의 <strong>구분(관/항)</strong>을 추가·수정하면 장부 입력 칩과 결산서 예산 집행률 표에 자동 반영됩니다.
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11.5px] font-semibold text-[#8B95A1]">
                현재 활성 지출 관/항 ({activeExpenseCategories.length}개):
              </span>
              {activeExpenseCategories.map((cat) => (
                <span
                  key={cat}
                  className="px-2 py-0.5 rounded-full bg-[#FFFFFF] text-[#1B64DA] text-[11.5px] font-semibold"
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={toggleSchemaSync}
            className={`px-4 py-2.5 rounded-xl text-[12.5px] font-bold flex items-center gap-1.5 shrink-0 active:scale-[0.97] transition-all duration-150 ${
              settings.syncCategoriesWithAnnualBudget
                ? 'bg-[#E8F3FF] text-[#1B64DA]'
                : 'bg-[#E5E8EB] text-[#4E5968]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {settings.syncCategoriesWithAnnualBudget
              ? '예산안 구조 자동연동 켜짐'
              : '기본 고정 카테고리 사용 중'}
          </button>
        </div>
      </section>

      {/* =====================================================================
          A4 1장 출력용 예산안 / 재정 청구서 본문 (전 셀 멀티라인 자동 확장)
         ===================================================================== */}
      <div className="overflow-x-auto py-1">
        <article className="a4-page flex flex-col justify-between">
          <div>
            {/* 상단 문서 타이틀 & 우측 4칸 결재란 */}
            <div className="flex items-start justify-between gap-4 pb-3.5 border-b-2 border-[#191F28]">
              <div className="flex-1 min-w-0 pt-1">
                <div className="text-[11px] font-semibold text-[#4E5968] flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#3182F6] no-print" />
                  <span>
                    [
                    {activeTemplate === 'retreat_claim'
                      ? '교회 재정부 제출용 · 특별예산/지원금 청구서'
                      : '교회 예산위원회 제출용 · 정기 예산 심의안'}
                    ]
                  </span>
                </div>

                <AutoResizeTextarea
                  value={doc.title}
                  onChange={(e) => handleFieldChange('title', e.target.value)}
                  className="text-[22px] font-bold text-[#191F28] mt-1 focus:bg-[#F9FAFB] rounded px-1 -ml-1"
                />
                <AutoResizeTextarea
                  value={doc.subtitle}
                  onChange={(e) =>
                    handleFieldChange('subtitle', e.target.value)
                  }
                  className="text-[12px] text-[#4E5968] mt-0.5 focus:bg-[#F9FAFB] rounded px-1 -ml-1"
                />
              </div>

              {/* 우측 4칸 결재란 */}
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
                          className="border border-[#191F28] px-2.5 py-1 text-[10.5px] font-bold text-[#191F28] min-w-[54px]"
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

            {/* 2. 한글 금액 자동 변환기 강조 박스 */}
            <div className="mt-4 bg-[#F9FAFB] border-2 border-[#191F28] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-[12.5px] font-bold text-[#4E5968]">
                {activeTemplate === 'retreat_claim'
                  ? '■ 교회 재정 실청구 금액 (총 소요예산 - 자체 부담금)'
                  : '■ 교회 본부 예산 편성 요청 총액'}
              </div>
              <div className="text-[17px] font-bold text-[#191F28] tabular-nums tracking-tight break-words [word-break:keep-all]">
                {numberToKoreanCurrency(netChurchClaimAmount)}
              </div>
            </div>

            {/* 3. 행사/사역 기본 개요 테이블 (멀티라인 셀 자동 확장) */}
            <div className="mt-3.5">
              <div className="text-[11.5px] font-bold text-[#191F28] mb-1">
                1. 사역 및 청구 개요
              </div>
              <table className="w-full border-collapse border border-[#191F28] text-[11.5px] tabular-nums table-fixed">
                <tbody>
                  <tr>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-1.5 px-2.5 w-[15%] text-left font-bold align-middle">
                      청구 부서
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2 w-[35%] align-middle">
                      <AutoResizeTextarea
                        value={doc.department}
                        onChange={(e) =>
                          handleFieldChange('department', e.target.value)
                        }
                        className="font-medium focus:bg-[#F9FAFB] rounded px-1"
                      />
                    </td>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-1.5 px-2.5 w-[15%] text-left font-bold align-middle">
                      청구 일자
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2 w-[35%] align-middle">
                      <input
                        type="date"
                        value={doc.requestDate}
                        onChange={(e) =>
                          handleFieldChange('requestDate', e.target.value)
                        }
                        className="w-full bg-transparent focus:outline-none focus:bg-[#F9FAFB] font-medium tabular-nums px-1"
                      />
                    </td>
                  </tr>
                  <tr>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-1.5 px-2.5 text-left font-bold align-middle">
                      사역/행사명
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2 align-middle">
                      <AutoResizeTextarea
                        value={doc.eventName}
                        onChange={(e) =>
                          handleFieldChange('eventName', e.target.value)
                        }
                        className="font-semibold focus:bg-[#F9FAFB] rounded px-1"
                      />
                    </td>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-1.5 px-2.5 text-left font-bold align-middle">
                      일시 / 기간
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2 align-middle">
                      <AutoResizeTextarea
                        value={doc.eventPeriod}
                        onChange={(e) =>
                          handleFieldChange('eventPeriod', e.target.value)
                        }
                        className="focus:bg-[#F9FAFB] rounded px-1"
                      />
                    </td>
                  </tr>
                  <tr>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-1.5 px-2.5 text-left font-bold align-middle">
                      장소
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2 align-middle">
                      <AutoResizeTextarea
                        value={doc.eventLocation}
                        onChange={(e) =>
                          handleFieldChange('eventLocation', e.target.value)
                        }
                        className="focus:bg-[#F9FAFB] rounded px-1"
                      />
                    </td>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-1.5 px-2.5 text-left font-bold align-middle">
                      참석 대상/인원
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2 align-middle">
                      <AutoResizeTextarea
                        value={doc.participants}
                        onChange={(e) =>
                          handleFieldChange('participants', e.target.value)
                        }
                        className="focus:bg-[#F9FAFB] rounded px-1"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 4. 인라인 편집 가능한 산출 기초 테이블 (멀티라인 셀 세로 확장) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11.5px] font-bold text-[#191F28]">
                  2. 세부 항목별 산출 기초 명세 (단가 × 수량 × 횟수)
                </span>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="no-print px-3 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                >
                  <Plus className="w-3.5 h-3.5" />+ 세부 항목 행 추가
                </button>
              </div>

              <table className="w-full border-collapse border border-[#191F28] text-[11.5px] tabular-nums table-fixed">
                <thead>
                  <tr className="bg-[#F2F4F6] font-bold text-[#191F28] text-center">
                    <th className="border border-[#191F28] py-1.5 px-2 w-[16%]">
                      구분(관/항)
                    </th>
                    <th className="border border-[#191F28] py-1.5 px-2 w-[25%] text-left">
                      세부 항목명
                    </th>
                    <th className="border border-[#191F28] py-1.5 px-2 w-[29%] text-left">
                      산출 기초 (단가 × 수량 × 횟수)
                    </th>
                    <th className="border border-[#191F28] py-1.5 px-2 w-[15%] text-right">
                      청구/예산 금액
                    </th>
                    <th className="border border-[#191F28] py-1.5 px-2 w-[15%]">
                      비고
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((item) => (
                    <tr key={item.id} className="group">
                      <td className="border border-[#E5E8EB] border-x-[#191F28] p-1.5 align-top">
                        <AutoResizeTextarea
                          value={item.category}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              'category',
                              e.target.value
                            )
                          }
                          className="text-center font-semibold text-[#4E5968] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="border border-[#E5E8EB] p-1.5 align-top">
                        <AutoResizeTextarea
                          value={item.itemName}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              'itemName',
                              e.target.value
                            )
                          }
                          className="font-semibold text-[#191F28] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="border border-[#E5E8EB] p-1.5 align-top">
                        <AutoResizeTextarea
                          value={item.formula}
                          onChange={(e) =>
                            handleItemChange(item.id, 'formula', e.target.value)
                          }
                          className="text-[#4E5968] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="border border-[#E5E8EB] p-1.5 align-top">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatNumber(item.amount)}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              'amount',
                              parseDigits(e.target.value)
                            )
                          }
                          className="w-full text-right font-bold text-[#191F28] bg-transparent focus:outline-none focus:bg-[#F9FAFB] rounded px-1 py-0.5 tabular-nums"
                        />
                      </td>
                      <td className="border border-[#E5E8EB] border-r-[#191F28] p-1.5 align-top">
                        <div className="flex items-start gap-1">
                          <AutoResizeTextarea
                            value={item.note}
                            onChange={(e) =>
                              handleItemChange(item.id, 'note', e.target.value)
                            }
                            placeholder="-"
                            className="text-center text-[11px] text-[#4E5968] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                          />
                          {doc.items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(item.id)}
                              title="행 삭제"
                              className="no-print text-[#8B95A1] hover:text-[#F04452] p-0.5 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {/* 합계 및 자체부담금 / 교회 재정 청구액 자동 합산 영역 */}
                  <tr className="bg-[#F9FAFB] border-t-2 border-[#191F28] font-semibold">
                    <td
                      colSpan={3}
                      className="border border-[#191F28] py-2 px-3 text-right text-[#4E5968]"
                    >
                      총 소요 예산 합계 (A)
                    </td>
                    <td className="border border-[#191F28] py-2 px-2 text-right font-bold text-[#191F28]">
                      {formatWon(totalGrossAmount)}
                    </td>
                    <td className="border border-[#191F28] py-2 px-2 text-center text-[10.5px] text-[#8B95A1]">
                      총 {doc.items.length}개 항목
                    </td>
                  </tr>

                  <tr className="bg-[#FFFFFF]">
                    <td className="border border-[#191F28] py-2 px-2 text-center font-bold text-[#4E5968] align-middle">
                      자체 부담금 (B)
                    </td>
                    <td
                      colSpan={2}
                      className="border border-[#191F28] py-1.5 px-2 align-middle"
                    >
                      <AutoResizeTextarea
                        value={doc.selfBurdenNote}
                        onChange={(e) =>
                          handleFieldChange('selfBurdenNote', e.target.value)
                        }
                        placeholder="예: 참가자 등록비 수입 (25,000원 × 40명)"
                        className="text-[#4E5968] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                      />
                    </td>
                    <td className="border border-[#191F28] py-1.5 px-2 align-middle">
                      <div className="flex items-center justify-end gap-0.5 font-semibold text-[#4E5968]">
                        <span>-</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatNumber(doc.selfBurdenAmount)}
                          onChange={(e) =>
                            handleFieldChange(
                              'selfBurdenAmount',
                              parseDigits(e.target.value)
                            )
                          }
                          className="w-24 text-right bg-transparent focus:outline-none focus:bg-[#F9FAFB] rounded px-1 py-0.5 tabular-nums"
                        />
                        <span>원</span>
                      </div>
                    </td>
                    <td className="border border-[#191F28] py-1.5 px-2 text-center text-[10.5px] text-[#8B95A1] align-middle">
                      부서 자체 충당
                    </td>
                  </tr>

                  <tr className="bg-[#E8F3FF] font-bold text-[12.5px]">
                    <td
                      colSpan={3}
                      className="border border-[#191F28] py-2.5 px-3 text-right text-[#1B64DA]"
                    >
                      교회 재정 실청구액 / 본부 지원 요청액 (A - B)
                    </td>
                    <td className="border border-[#191F28] py-2.5 px-2 text-right text-[#1B64DA] text-[14px]">
                      {formatWon(netChurchClaimAmount)}
                    </td>
                    <td className="border border-[#191F28] py-2.5 px-2 text-center text-[10.5px] text-[#1B64DA]">
                      실지급 요청액
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 5. 입금 계좌 정보 테이블 (멀티라인 셀 지원) */}
            <div className="mt-4">
              <div className="text-[11.5px] font-bold text-[#191F28] mb-1">
                3. 예산 수령 지정 입금 계좌 정보
              </div>
              <table className="w-full border-collapse border border-[#191F28] text-[11.5px] tabular-nums table-fixed">
                <tbody>
                  <tr>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-2 px-3 w-[14%] text-left font-bold align-middle">
                      입금 은행
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2.5 w-[18%] align-middle">
                      <AutoResizeTextarea
                        value={doc.bankName}
                        onChange={(e) =>
                          handleFieldChange('bankName', e.target.value)
                        }
                        className="font-semibold text-[#191F28] focus:bg-[#F9FAFB]"
                      />
                    </td>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-2 px-3 w-[14%] text-left font-bold align-middle">
                      계좌 번호
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2.5 w-[24%] align-middle">
                      <AutoResizeTextarea
                        value={doc.accountNumber}
                        onChange={(e) =>
                          handleFieldChange('accountNumber', e.target.value)
                        }
                        className="font-bold text-[#191F28] focus:bg-[#F9FAFB] tabular-nums"
                      />
                    </td>
                    <th className="border border-[#191F28] bg-[#F2F4F6] py-2 px-3 w-[11%] text-left font-bold align-middle">
                      예금주
                    </th>
                    <td className="border border-[#191F28] py-1.5 px-2.5 w-[19%] align-middle">
                      <AutoResizeTextarea
                        value={doc.accountHolder}
                        onChange={(e) =>
                          handleFieldChange('accountHolder', e.target.value)
                        }
                        className="font-semibold text-[#191F28] focus:bg-[#F9FAFB]"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. 하단 청구 문구 및 청구인 서명란 */}
          <div className="pt-4 mt-4 border-t border-[#191F28] space-y-4">
            <AutoResizeTextarea
              value={doc.purposeNote}
              onChange={(e) => handleFieldChange('purposeNote', e.target.value)}
              className="text-center text-[12.5px] font-medium text-[#191F28] focus:bg-[#F9FAFB] py-1"
            />

            <div className="flex flex-col items-end space-y-1.5 text-[12.5px] tabular-nums pr-2">
              <div className="text-[#4E5968] font-medium">
                {formatShortDate(doc.requestDate)}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 font-bold text-[#191F28]">
                <span>청구 부서: {doc.department}</span>
                <span>·</span>
                <div className="flex items-center gap-1">
                  <span>청구인({doc.proposerRole}):</span>
                  <input
                    type="text"
                    value={doc.proposerName}
                    onChange={(e) =>
                      handleFieldChange('proposerName', e.target.value)
                    }
                    className="w-20 text-center font-bold bg-transparent border-b border-[#8B95A1] focus:outline-none"
                  />
                  <span className="text-[#8B95A1] font-normal">(서명/인)</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
};
