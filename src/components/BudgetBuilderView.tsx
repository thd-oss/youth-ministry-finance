import React, { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Eraser,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Plus,
  Printer,
  RotateCcw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  AppSettings,
  BudgetDocument,
  BudgetLineItem,
  BudgetTemplateType,
  COMMON_EXPENSE_SUBCATEGORIES,
  COMMON_INCOME_SUBCATEGORIES,
  TransactionType,
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
import { A4ScalePreview } from './A4ScalePreview';
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
  activeIncomeCategories?: string[];
  initialTemplate?: BudgetTemplateType;
}

type BuilderScreenMode = 'card_editor' | 'a4_preview';

export const BudgetBuilderView: React.FC<BudgetBuilderViewProps> = ({
  budgets,
  onUpdateBudget,
  settings,
  activeExpenseCategories,
  activeIncomeCategories = [],
  initialTemplate = 'annual_budget',
}) => {
  const [activeTemplate, setActiveTemplate] =
    useState<BudgetTemplateType>(initialTemplate);

  useEffect(() => {
    if (initialTemplate) {
      setActiveTemplate(initialTemplate);
    }
  }, [initialTemplate]);

  // 모바일(< 860px)은 물론 예산 항목을 직접 작성할 때 가장 편한 카드형 편집기를 기본 제공
  const [screenMode, setScreenMode] = useState<BuilderScreenMode>('card_editor');
  const [a4ZoomMode, setA4ZoomMode] = useState<'fit' | 'actual'>('fit');
  const [isOverviewExpanded, setIsOverviewExpanded] = useState<boolean>(false);

  // 새 예산 항목 직접 작성기(Composer) 상태 (수입/지출 구분 + 1차 관/항 + 2차 세목 지원)
  const [draftEntryType, setDraftEntryType] =
    useState<TransactionType>('expense');
  const [draftCategory, setDraftCategory] = useState<string>('');
  const [draftSubCategory, setDraftSubCategory] = useState<string>('');
  const [draftItemName, setDraftItemName] = useState<string>('');
  const [draftUnitPriceStr, setDraftUnitPriceStr] = useState<string>('');
  const [draftQtyStr, setDraftQtyStr] = useState<string>('');
  const [draftQtyUnit, setDraftQtyUnit] = useState<string>('명');
  const [draftFreqStr, setDraftFreqStr] = useState<string>('');
  const [draftFreqUnit, setDraftFreqUnit] = useState<string>('회');
  const [draftFormula, setDraftFormula] = useState<string>('');
  const [draftAmountStr, setDraftAmountStr] = useState<string>('');
  const [draftNote, setDraftNote] = useState<string>('');
  const [composerFeedback, setComposerFeedback] = useState<string>('');

  const composerCategoryRef = useRef<HTMLInputElement | null>(null);

  const doc = budgets[activeTemplate];

  const totalGrossAmount = doc.items.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );
  const netChurchClaimAmount = Math.max(
    0,
    totalGrossAmount - (Number(doc.selfBurdenAmount) || 0)
  );

  // 현재 문서 내 고유 카테고리 + 활성 카테고리 (빠른 선택 칩 제공용)
  const suggestedCategories = Array.from(
    new Set([
      ...doc.items
        .filter((item) => (item.entryType || 'expense') === draftEntryType)
        .map((item) => item.category.trim())
        .filter(Boolean),
      ...(draftEntryType === 'income'
        ? activeIncomeCategories
        : activeExpenseCategories),
    ])
  ).slice(0, 12);

  const suggestedSubCategories =
    draftEntryType === 'income'
      ? COMMON_INCOME_SUBCATEGORIES
      : COMMON_EXPENSE_SUBCATEGORIES;

  const parseDigits = (raw: string): number => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  // 단가 × 수량 × 횟수 입력 시 자동으로 산출 기초 문자열과 총액을 계산
  const recalculateDraftFromMultipliers = (
    nextUnitStr: string,
    nextQtyStr: string,
    nextQtyUnit: string,
    nextFreqStr: string,
    nextFreqUnit: string
  ) => {
    const unitPrice = parseDigits(nextUnitStr);
    const qty = parseDigits(nextQtyStr);
    const freq = parseDigits(nextFreqStr);

    if (unitPrice > 0) {
      const effectiveQty = qty > 0 ? qty : 1;
      const effectiveFreq = freq > 0 ? freq : 1;
      const total = unitPrice * effectiveQty * effectiveFreq;
      setDraftAmountStr(formatNumber(total));

      const parts: string[] = [`${formatNumber(unitPrice)}원`];
      if (qty > 0) parts.push(`${formatNumber(qty)}${nextQtyUnit}`);
      if (freq > 0) parts.push(`${formatNumber(freq)}${nextFreqUnit}`);
      setDraftFormula(parts.join(' × '));
    }
  };

  const handleCreateItemFromComposer = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCategory =
      draftCategory.trim() ||
      (draftEntryType === 'income'
        ? '교회지원금(예산)'
        : activeTemplate === 'annual_budget'
          ? '예배/양육비'
          : '수련회/행사비');
    const cleanSubCategory = draftSubCategory.trim();
    const cleanDescription = draftItemName.trim();
    const numericAmount = parseDigits(draftAmountStr);

    if (!cleanSubCategory) {
      setComposerFeedback('⚠️ 2차 세부 항목(세목)을 선택하거나 입력해 주세요.');
      return;
    }

    const newItem: BudgetLineItem = {
      id: `bg-${Date.now()}`,
      entryType: draftEntryType,
      category: cleanCategory,
      subCategory: cleanSubCategory,
      itemName: cleanDescription,
      formula:
        draftFormula.trim() ||
        (numericAmount > 0 ? `${formatNumber(numericAmount)}원 × 1식` : ''),
      amount: numericAmount,
      note: draftNote.trim(),
    };

    onUpdateBudget(activeTemplate, {
      ...doc,
      items: [...doc.items, newItem],
    });

    setDraftSubCategory('');
    setDraftItemName('');
    setDraftUnitPriceStr('');
    setDraftQtyStr('');
    setDraftFreqStr('');
    setDraftFormula('');
    setDraftAmountStr('');
    setDraftNote('');
    setComposerFeedback(
      `✅ [${cleanCategory} › ${cleanSubCategory}] (${formatWon(numericAmount)}) 추가됨`
    );
    setTimeout(() => setComposerFeedback(''), 2500);
  };

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

  const handleMoveRow = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= doc.items.length) return;
    const nextItems = [...doc.items];
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(targetIndex, 0, moved);
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: nextItems,
    });
  };

  // 더미 텍스트 없이 깨끗한 빈 카드/행 추가
  const handleAddBlankRow = () => {
    const newItem: BudgetLineItem = {
      id: `bg-${Date.now()}`,
      category: '',
      itemName: '',
      formula: '',
      amount: 0,
      note: '',
    };
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: [...doc.items, newItem],
    });
  };

  // 마지막 1개까지도 모두 삭제 가능하도록 제한 해제
  const handleRemoveRow = (id: string) => {
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
    });
  };

  // 샘플 항목을 전부 비우고 백지 상태에서 직접 예산 작성 시작
  const handleClearAllItems = () => {
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: [],
      selfBurdenAmount: 0,
      selfBurdenNote: '',
    });
    setScreenMode('card_editor');
    setComposerFeedback('🧹 항목을 모두 비웠습니다. 새로 입력해 보세요.');
    setTimeout(() => {
      composerCategoryRef.current?.focus();
    }, 100);
  };

  const handleResetTemplate = () => {
    const defaultDoc =
      activeTemplate === 'retreat_claim'
        ? INITIAL_RETREAT_BUDGET
        : INITIAL_ANNUAL_BUDGET;
    onUpdateBudget(activeTemplate, defaultDoc);
    setComposerFeedback('샘플 예산안이 복원되었습니다.');
    setTimeout(() => setComposerFeedback(''), 2500);
  };

  return (
    <div className="space-y-5 pb-28 print-container">
      {/* =====================================================================
          상단 컨트롤 바 (.no-print)
         ===================================================================== */}
      <section className="no-print max-w-[980px] mx-auto bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <h2 className="text-[19px] font-bold text-[#191F28]">
            예산안 · 청구서 작성
          </h2>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClearAllItems}
              className="h-10 px-3.5 rounded-2xl bg-[#FFEEF0] text-[#F04452] text-[12.5px] font-bold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <Eraser className="w-4 h-4" />
              전체 비우기
            </button>

            <button
              type="button"
              onClick={handleResetTemplate}
              className="h-10 px-3.5 rounded-2xl bg-[#F2F4F6] text-[#4E5968] text-[12.5px] font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <RotateCcw className="w-4 h-4" />
              샘플 복원
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="h-10 px-4 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[13.5px] font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all duration-150"
            >
              <Printer className="w-4 h-4" />
              인쇄 / PDF
            </button>
          </div>
        </div>

        {/* 1. 문서 템플릿 전환 토글 */}
        <div className="bg-[#F2F4F6] p-1.5 rounded-2xl grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTemplate('annual_budget')}
            className={`py-2.5 px-4 rounded-xl text-[14px] font-bold transition-all duration-150 active:scale-[0.97] ${
              activeTemplate === 'annual_budget'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#4E5968] hover:text-[#191F28]'
            }`}
          >
            📅 연간 예산안
          </button>

          <button
            type="button"
            onClick={() => setActiveTemplate('retreat_claim')}
            className={`py-2.5 px-4 rounded-xl text-[14px] font-bold transition-all duration-150 active:scale-[0.97] ${
              activeTemplate === 'retreat_claim'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#4E5968] hover:text-[#191F28]'
            }`}
          >
            🏕️ 수련회·행사 청구서
          </button>
        </div>

        {/* 2. 편집 화면 모드 전환: [📝 항목 편집] vs [📄 A4 미리보기] */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-[#F9FAFB] p-2 rounded-2xl">
          <div className="bg-[#E5E8EB] p-1 rounded-xl grid grid-cols-2 gap-1 flex-1">
            <button
              type="button"
              onClick={() => setScreenMode('card_editor')}
              className={`py-2 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'card_editor'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>항목 편집</span>
            </button>

            <button
              type="button"
              onClick={() => setScreenMode('a4_preview')}
              className={`py-2 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97] ${
                screenMode === 'a4_preview'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Eye className="w-4 h-4 shrink-0" />
              <span>A4 미리보기</span>
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
                  <span>화면 맞춤 (100%로 보기)</span>
                </>
              ) : (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#3182F6]" />
                  <span>100% 크기 (화면 맞춤으로)</span>
                </>
              )}
            </button>
          )}
        </div>
      </section>

      {/* =====================================================================
          모드 A: 새 예산 항목 직접 작성기(Composer) + 모바일 친화적 카드 에디터
         ===================================================================== */}
      {screenMode === 'card_editor' && (
        <div className="no-print max-w-[980px] mx-auto space-y-4">
          {/* 1. 실시간 청구/예산 총액 요약 히어로 카드 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[12px] font-bold text-[#3182F6]">
                  {activeTemplate === 'retreat_claim'
                    ? '교회 재정 실청구 금액 (A - B)'
                    : '교회 본부 예산 편성 요청 총액'}
                </span>
                <div className="text-[26px] sm:text-[30px] font-bold text-[#191F28] tabular-nums tracking-tight mt-0.5">
                  {formatWon(netChurchClaimAmount)}
                </div>
                <div className="text-[13px] font-semibold text-[#4E5968] tabular-nums mt-0.5 break-words [word-break:keep-all]">
                  {numberToKoreanCurrency(netChurchClaimAmount)}
                </div>
              </div>

              <span className="px-3 py-1.5 rounded-full bg-[#F9FAFB] text-[#4E5968] text-[12px] font-bold tabular-nums shrink-0">
                총 {doc.items.length}개 항목
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1 tabular-nums">
              <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
                <div className="text-[12px] text-[#8B95A1]">
                  총 소요 예산 합계 (A)
                </div>
                <div className="text-[16px] font-bold text-[#191F28] mt-0.5">
                  {formatWon(totalGrossAmount)}
                </div>
              </div>

              <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
                <div className="text-[12px] text-[#8B95A1]">
                  자체 부담금 차감 (B)
                </div>
                <div className="text-[16px] font-bold text-[#4E5968] mt-0.5">
                  -{formatWon(doc.selfBurdenAmount)}
                </div>
              </div>
            </div>
          </section>

          {/* =================================================================
              2. [핵심] 새 예산 항목 직접 작성기 (1차 구분 + 2차 세부항목 + 선택 설명)
             ================================================================= */}
          <section className="bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-3.5 border-2 border-[#3182F6]/20">
            <h3 className="text-[16px] font-bold text-[#191F28]">
              ✍️ 예산 항목 추가
            </h3>

            <form onSubmit={handleCreateItemFromComposer} className="space-y-3.5">
              {/* 지출 vs 수입 선택 토글 */}
              <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDraftEntryType('expense');
                    setDraftCategory('');
                    setDraftSubCategory('');
                  }}
                  className={`py-2 px-3 rounded-xl text-[13px] font-bold transition-all duration-150 active:scale-[0.97] ${
                    draftEntryType === 'expense'
                      ? 'bg-[#FFFFFF] text-[#191F28]'
                      : 'text-[#8B95A1] hover:text-[#4E5968]'
                  }`}
                >
                  ➖ 지출 항목
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftEntryType('income');
                    setDraftCategory('');
                    setDraftSubCategory('');
                  }}
                  className={`py-2 px-3 rounded-xl text-[13px] font-bold transition-all duration-150 active:scale-[0.97] ${
                    draftEntryType === 'income'
                      ? 'bg-[#3182F6] text-[#FFFFFF]'
                      : 'text-[#8B95A1] hover:text-[#4E5968]'
                  }`}
                >
                  ➕ 수입 항목
                </button>
              </div>

              {/* 1행: 1차 구분(필수) + 2차 세부 항목(필수) + 설명(선택) */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-4">
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    {draftEntryType === 'income'
                      ? '1차 구분 (수입원 · 필수)'
                      : '1차 구분 (사역/행사 · 필수)'}
                  </label>
                  <input
                    ref={composerCategoryRef}
                    type="text"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    placeholder={
                      draftEntryType === 'income'
                        ? '예: 교회지원금(예산), 부서회비'
                        : '예: 예배/양육비, 수련회/행사비'
                    }
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] font-bold text-[#1B64DA] placeholder:text-[#8B95A1] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    2차 세부 항목 (세목 · 필수)
                  </label>
                  <input
                    type="text"
                    value={draftSubCategory}
                    onChange={(e) => setDraftSubCategory(e.target.value)}
                    placeholder={
                      draftEntryType === 'income'
                        ? '예: 월 정기예산 수령'
                        : '예: 식비·간식/다과, 교재·도서'
                    }
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] font-bold text-[#191F28] placeholder:text-[#8B95A1] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[12px] font-semibold text-[#8B95A1] mb-1">
                    설명 (선택 입력)
                  </label>
                  <input
                    type="text"
                    value={draftItemName}
                    onChange={(e) => setDraftItemName(e.target.value)}
                    placeholder="예: 리더십 훈련 간식, 목자반 도서"
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>
              </div>

              {/* 빠른 1차 구분 & 2차 세부 항목 칩 선택 */}
              <div className="space-y-1.5">
                {suggestedCategories.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    <span className="text-[11px] font-semibold text-[#8B95A1] shrink-0">
                      1차 구분:
                    </span>
                    {suggestedCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setDraftCategory(cat)}
                        className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold shrink-0 transition-all ${
                          draftCategory === cat
                            ? 'bg-[#3182F6] text-[#FFFFFF]'
                            : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  <span className="text-[11px] font-semibold text-[#8B95A1] shrink-0">
                    2차 세부 항목:
                  </span>
                  {suggestedSubCategories.map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setDraftSubCategory(sub)}
                      className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold shrink-0 transition-all ${
                        draftSubCategory === sub
                          ? 'bg-[#191F28] text-[#FFFFFF]'
                          : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2행: 단가 × 수량/인원 × 횟수/개월 자동 계산기 */}
              <div className="bg-[#F9FAFB] rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#4E5968]">
                  <Calculator className="w-3.5 h-3.5 text-[#3182F6]" />
                  <span>단가 × 수량 × 횟수 자동 계산 (선택)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draftUnitPriceStr}
                      onChange={(e) => {
                        const n = parseDigits(e.target.value);
                        const nextStr = n > 0 ? formatNumber(n) : '';
                        setDraftUnitPriceStr(nextStr);
                        recalculateDraftFromMultipliers(
                          nextStr,
                          draftQtyStr,
                          draftQtyUnit,
                          draftFreqStr,
                          draftFreqUnit
                        );
                      }}
                      placeholder="단가 (예: 15,000)"
                      className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#FFFFFF] text-[13.5px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                    <span className="absolute right-3 text-[12px] text-[#8B95A1] pointer-events-none">
                      원
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[#8B95A1] font-bold text-[13px]">
                      ×
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draftQtyStr}
                      onChange={(e) => {
                        const n = parseDigits(e.target.value);
                        const nextStr = n > 0 ? formatNumber(n) : '';
                        setDraftQtyStr(nextStr);
                        recalculateDraftFromMultipliers(
                          draftUnitPriceStr,
                          nextStr,
                          draftQtyUnit,
                          draftFreqStr,
                          draftFreqUnit
                        );
                      }}
                      placeholder="수량/인원 (예: 30)"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13.5px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                    <select
                      value={draftQtyUnit}
                      onChange={(e) => {
                        const nextU = e.target.value;
                        setDraftQtyUnit(nextU);
                        recalculateDraftFromMultipliers(
                          draftUnitPriceStr,
                          draftQtyStr,
                          nextU,
                          draftFreqStr,
                          draftFreqUnit
                        );
                      }}
                      className="h-10 px-2 rounded-xl bg-[#FFFFFF] text-[12.5px] font-semibold text-[#4E5968] shrink-0 focus:outline-none"
                    >
                      <option value="명">명</option>
                      <option value="개">개</option>
                      <option value="팀">팀</option>
                      <option value="권">권</option>
                      <option value="식">식</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[#8B95A1] font-bold text-[13px]">
                      ×
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draftFreqStr}
                      onChange={(e) => {
                        const n = parseDigits(e.target.value);
                        const nextStr = n > 0 ? formatNumber(n) : '';
                        setDraftFreqStr(nextStr);
                        recalculateDraftFromMultipliers(
                          draftUnitPriceStr,
                          draftQtyStr,
                          draftQtyUnit,
                          nextStr,
                          draftFreqUnit
                        );
                      }}
                      placeholder="횟수/기간 (예: 12)"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13.5px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                    <select
                      value={draftFreqUnit}
                      onChange={(e) => {
                        const nextFU = e.target.value;
                        setDraftFreqUnit(nextFU);
                        recalculateDraftFromMultipliers(
                          draftUnitPriceStr,
                          draftQtyStr,
                          draftQtyUnit,
                          draftFreqStr,
                          nextFU
                        );
                      }}
                      className="h-10 px-2 rounded-xl bg-[#FFFFFF] text-[12.5px] font-semibold text-[#4E5968] shrink-0 focus:outline-none"
                    >
                      <option value="회">회</option>
                      <option value="개월">개월</option>
                      <option value="주">주</option>
                      <option value="박">박</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 3행: 최종 산출 기초 텍스트 & 최종 금액(원) & 비고 & 추가 버튼 */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-5">
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    산출 기초 표기 (직접 수정 가능)
                  </label>
                  <input
                    type="text"
                    value={draftFormula}
                    onChange={(e) => setDraftFormula(e.target.value)}
                    placeholder="예: 월 250,000원 × 12개월"
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    편성 / 청구 금액 (원)
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draftAmountStr}
                      onChange={(e) => {
                        const n = parseDigits(e.target.value);
                        setDraftAmountStr(n > 0 ? formatNumber(n) : '');
                      }}
                      placeholder="0"
                      className="w-full h-11 pl-3.5 pr-9 rounded-2xl bg-[#F9FAFB] text-right text-[16px] font-bold text-[#3182F6] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                    <span className="absolute right-3.5 text-[13px] font-bold text-[#4E5968] pointer-events-none">
                      원
                    </span>
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    비고 (선택)
                  </label>
                  <input
                    type="text"
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    placeholder="예: 목장 회식비 포함"
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {composerFeedback ? (
                  <span className="text-[12.5px] font-bold text-[#1B64DA]">
                    {composerFeedback}
                  </span>
                ) : (
                  <span />
                )}

                <button
                  type="submit"
                  className="w-full sm:w-auto h-11 px-6 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[14px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all duration-150"
                >
                  <Plus className="w-4 h-4" />
                  <span>항목 추가</span>
                </button>
              </div>
            </form>
          </section>

          {/* 3. 문서 제목 & 사역/행사 기본 개요 (아코디언 카드) */}
          <section className="bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-4">
            <button
              type="button"
              onClick={() => setIsOverviewExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <div className="text-[15px] font-bold text-[#191F28]">
                  1. 문서 제목 · 개요 설정
                </div>
                <div className="text-[12.5px] text-[#8B95A1] mt-0.5">
                  {doc.title} · {doc.eventPeriod}
                </div>
              </div>
              <span className="px-3 py-1.5 rounded-xl bg-[#F2F4F6] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1 shrink-0">
                {isOverviewExpanded ? (
                  <>
                    <span>접기</span>
                    <ChevronUp className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>수정하기</span>
                    <ChevronDown className="w-4 h-4" />
                  </>
                )}
              </span>
            </button>

            {isOverviewExpanded && (
              <div className="space-y-3.5 pt-2 border-t border-[#F2F4F6]">
                <div>
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    문서 메인 제목
                  </label>
                  <input
                    type="text"
                    value={doc.title}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                    문서 부제목 / 설명
                  </label>
                  <input
                    type="text"
                    value={doc.subtitle}
                    onChange={(e) =>
                      handleFieldChange('subtitle', e.target.value)
                    }
                    className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] text-[#4E5968] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                      청구 부서
                    </label>
                    <input
                      type="text"
                      value={doc.department}
                      onChange={(e) =>
                        handleFieldChange('department', e.target.value)
                      }
                      className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-semibold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                      청구/기안 일자
                    </label>
                    <input
                      type="date"
                      value={doc.requestDate}
                      onChange={(e) =>
                        handleFieldChange('requestDate', e.target.value)
                      }
                      className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                      사역/행사명
                    </label>
                    <input
                      type="text"
                      value={doc.eventName}
                      onChange={(e) =>
                        handleFieldChange('eventName', e.target.value)
                      }
                      className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-semibold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                      일시 / 기간
                    </label>
                    <input
                      type="text"
                      value={doc.eventPeriod}
                      onChange={(e) =>
                        handleFieldChange('eventPeriod', e.target.value)
                      }
                      className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                      장소
                    </label>
                    <input
                      type="text"
                      value={doc.eventLocation}
                      onChange={(e) =>
                        handleFieldChange('eventLocation', e.target.value)
                      }
                      className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                      참석 대상 / 인원
                    </label>
                    <input
                      type="text"
                      value={doc.participants}
                      onChange={(e) =>
                        handleFieldChange('participants', e.target.value)
                      }
                      className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 4. 세부 예산 항목 카드 리스트 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[15px] font-bold text-[#191F28]">
                2. 예산 항목 목록 ({doc.items.length}건)
              </h3>
              <button
                type="button"
                onClick={handleAddBlankRow}
                className="h-9 px-3 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[12.5px] font-bold flex items-center gap-1 shrink-0 active:scale-[0.97] transition-all duration-150"
              >
                <Plus className="w-4 h-4" />빈 항목 추가
              </button>
            </div>

            {doc.items.length === 0 ? (
              <div className="bg-[#FFFFFF] rounded-3xl p-10 text-center space-y-2">
                <div className="text-[15px] font-bold text-[#191F28]">
                  등록된 예산 항목이 없습니다
                </div>
                <p className="text-[13px] text-[#8B95A1]">
                  위 입력창에서 첫 예산 항목을 추가해 보세요.
                </p>
              </div>
            ) : (
              doc.items.map((item, idx) => (
                <div
                  key={item.id}
                  className="bg-[#FFFFFF] rounded-3xl p-5 space-y-3"
                >
                  {/* 카드 상단 바: 번호 배지 + 지출/수입 토글 + 1차 구분 + 2차 세부 항목 + 순서이동/삭제 */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <span className="px-2.5 py-1 rounded-xl bg-[#191F28] text-[#FFFFFF] text-[12px] font-bold tabular-nums shrink-0">
                        #{String(idx + 1).padStart(2, '0')}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleItemChange(
                            item.id,
                            'entryType',
                            item.entryType === 'income' ? 'expense' : 'income'
                          )
                        }
                        className={`px-2.5 py-1 rounded-xl text-[12px] font-bold shrink-0 transition-all active:scale-[0.97] ${
                          item.entryType === 'income'
                            ? 'bg-[#3182F6] text-[#FFFFFF]'
                            : 'bg-[#F2F4F6] text-[#4E5968]'
                        }`}
                      >
                        {item.entryType === 'income' ? '➕ 수입' : '➖ 지출'}
                      </button>
                      <input
                        type="text"
                        value={item.category}
                        onChange={(e) =>
                          handleItemChange(item.id, 'category', e.target.value)
                        }
                        placeholder="1차 구분 (예: 예배/양육비)"
                        aria-label={`항목 ${idx + 1} 1차 구분`}
                        className="h-9 px-3 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-bold w-full max-w-[165px] placeholder:text-[#1B64DA]/50 focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                      <input
                        type="text"
                        value={item.subCategory || ''}
                        onChange={(e) =>
                          handleItemChange(
                            item.id,
                            'subCategory',
                            e.target.value
                          )
                        }
                        placeholder="2차 세부 항목 (예: 식비·간식/다과)"
                        aria-label={`항목 ${idx + 1} 2차 세부 항목`}
                        className="h-9 px-3 rounded-xl bg-[#F9FAFB] text-[#191F28] text-[13px] font-bold w-full max-w-[190px] placeholder:text-[#8B95A1] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMoveRow(idx, -1)}
                        disabled={idx === 0}
                        aria-label="위로 이동"
                        className="w-8 h-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center disabled:opacity-30 active:scale-[0.97]"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveRow(idx, 1)}
                        disabled={idx === doc.items.length - 1}
                        aria-label="아래로 이동"
                        className="w-8 h-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center disabled:opacity-30 active:scale-[0.97]"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(item.id)}
                        aria-label="항목 삭제"
                        className="w-8 h-8 rounded-xl bg-[#FFEEF0] text-[#F04452] flex items-center justify-center active:scale-[0.97]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* 설명(선택) & 예산 금액 */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-7">
                      <label className="block text-[11.5px] font-semibold text-[#8B95A1] mb-1">
                        설명 (선택)
                      </label>
                      <input
                        type="text"
                        value={item.itemName}
                        onChange={(e) =>
                          handleItemChange(item.id, 'itemName', e.target.value)
                        }
                        placeholder="부연 설명이 필요할 때만 입력 (선택)"
                        className="w-full h-10 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                    </div>

                    <div className="sm:col-span-5">
                      <label className="block text-[11.5px] font-semibold text-[#8B95A1] mb-1">
                        금액 (원)
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.amount > 0 ? formatNumber(item.amount) : ''}
                          placeholder="0"
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              'amount',
                              parseDigits(e.target.value)
                            )
                          }
                          className="w-full h-10 pl-3.5 pr-9 rounded-2xl bg-[#F9FAFB] text-right text-[15.5px] font-bold text-[#3182F6] tabular-nums placeholder:text-[#8B95A1]/50 focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                        />
                        <span className="absolute right-3.5 text-[13px] font-bold text-[#4E5968] pointer-events-none">
                          원
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 산출 기초 & 비고 */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-8">
                      <label className="block text-[11.5px] font-semibold text-[#8B95A1] mb-1">
                        산출식 (단가 × 수량 × 횟수)
                      </label>
                      <input
                        type="text"
                        value={item.formula}
                        onChange={(e) =>
                          handleItemChange(item.id, 'formula', e.target.value)
                        }
                        placeholder="예: 10,000원 × 40명 × 2회"
                        className="w-full h-10 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13px] text-[#4E5968] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <label className="block text-[11.5px] font-semibold text-[#8B95A1] mb-1">
                        비고 (선택)
                      </label>
                      <input
                        type="text"
                        value={item.note}
                        onChange={(e) =>
                          handleItemChange(item.id, 'note', e.target.value)
                        }
                        placeholder="비고 (선택)"
                        className="w-full h-10 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13px] text-[#4E5968] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* 5. 자체 부담금 및 입금 계좌 · 청구인 서명란 카드 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-5 sm:p-6 space-y-4">
            <h3 className="text-[15px] font-bold text-[#191F28]">
              3. 자체 부담금 차감 및 수령 계좌 · 청구인 정보
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-[#F9FAFB] p-4 rounded-2xl">
              <div className="sm:col-span-7">
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  자체 부담금 (B) 산출 내역
                </label>
                <input
                  type="text"
                  value={doc.selfBurdenNote}
                  onChange={(e) =>
                    handleFieldChange('selfBurdenNote', e.target.value)
                  }
                  placeholder="예: 참가자 등록비 수입 (25,000원 × 40명)"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  자체 부담금 차감액 (원)
                </label>
                <div className="relative flex items-center">
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
                    className="w-full h-11 pl-3.5 pr-9 rounded-xl bg-[#FFFFFF] text-right text-[15px] font-bold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                  />
                  <span className="absolute right-3.5 text-[13px] font-bold text-[#4E5968] pointer-events-none">
                    원
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  입금 은행
                </label>
                <input
                  type="text"
                  value={doc.bankName}
                  onChange={(e) =>
                    handleFieldChange('bankName', e.target.value)
                  }
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-semibold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  계좌 번호
                </label>
                <input
                  type="text"
                  value={doc.accountNumber}
                  onChange={(e) =>
                    handleFieldChange('accountNumber', e.target.value)
                  }
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-bold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  예금주
                </label>
                <input
                  type="text"
                  value={doc.accountHolder}
                  onChange={(e) =>
                    handleFieldChange('accountHolder', e.target.value)
                  }
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-semibold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="sm:col-span-2">
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  하단 청구/제출 문구
                </label>
                <input
                  type="text"
                  value={doc.purposeNote}
                  onChange={(e) =>
                    handleFieldChange('purposeNote', e.target.value)
                  }
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[13.5px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                  청구인 ({doc.proposerRole}) 성명
                </label>
                <input
                  type="text"
                  value={doc.proposerName}
                  onChange={(e) =>
                    handleFieldChange('proposerName', e.target.value)
                  }
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>
            </div>
          </section>

          {/* 6. 모바일 하단 빠른 미리보기/인쇄 바 */}
          <div className="sticky bottom-4 z-20 bg-[#191F28] text-[#FFFFFF] rounded-2xl p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-[#8B95A1]">
                실청구/편성 요청 총액 ({doc.items.length}개 항목)
              </div>
              <div className="text-[16px] font-bold tabular-nums truncate">
                {formatWon(netChurchClaimAmount)}
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
          모드 B & 실제 인쇄 DOM: A4 1장 출력용 예산안 / 재정 청구서 본문
         ===================================================================== */}
      <div
        className={`max-w-[980px] mx-auto print-force-show ${
          screenMode === 'card_editor' ? 'hidden' : 'block'
        }`}
      >
        <A4ScalePreview zoomMode={a4ZoomMode}>
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

              {/* 3. 행사/사역 기본 개요 테이블 */}
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

              {/* 4. 인라인 편집 가능한 산출 기초 테이블 */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11.5px] font-bold text-[#191F28]">
                    2. 세부 항목별 산출 기초 명세 (단가 × 수량 × 횟수)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddBlankRow}
                    className="no-print px-3 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                  >
                    <Plus className="w-3.5 h-3.5" />+ 빈 항목 행 추가
                  </button>
                </div>

                <table className="w-full border-collapse border border-[#191F28] text-[11.5px] tabular-nums table-fixed">
                  <thead>
                    <tr className="bg-[#F2F4F6] font-bold text-[#191F28] text-center">
                      <th className="border border-[#191F28] py-1.5 px-2 w-[16%]">
                        1차 구분
                      </th>
                      <th className="border border-[#191F28] py-1.5 px-2 w-[25%] text-left">
                        2차 세부 항목 · 설명
                      </th>
                      <th className="border border-[#191F28] py-1.5 px-2 w-[29%] text-left">
                        산출식 (단가 × 수량 × 횟수)
                      </th>
                      <th className="border border-[#191F28] py-1.5 px-2 w-[15%] text-right">
                        금액
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
                            placeholder="1차 구분"
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
                        <td className="border border-[#E5E8EB] p-1.5 align-top space-y-0.5">
                          <AutoResizeTextarea
                            value={item.subCategory || ''}
                            placeholder="2차 세부 항목 입력"
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                'subCategory',
                                e.target.value
                              )
                            }
                            className="font-bold text-[#191F28] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                          />
                          {(item.itemName || !item.subCategory) && (
                            <AutoResizeTextarea
                              value={item.itemName}
                              placeholder="설명 (선택)"
                              onChange={(e) =>
                                handleItemChange(
                                  item.id,
                                  'itemName',
                                  e.target.value
                                )
                              }
                              className="text-[10.5px] text-[#4E5968] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                            />
                          )}
                        </td>
                        <td className="border border-[#E5E8EB] p-1.5 align-top">
                          <AutoResizeTextarea
                            value={item.formula}
                            placeholder="단가 × 수량 × 횟수"
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                'formula',
                                e.target.value
                              )
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
                                handleItemChange(
                                  item.id,
                                  'note',
                                  e.target.value
                                )
                              }
                              placeholder="-"
                              className="text-center text-[11px] text-[#4E5968] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(item.id)}
                              title="행 삭제"
                              className="no-print text-[#8B95A1] hover:text-[#F04452] p-0.5 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

              {/* 5. 입금 계좌 정보 테이블 */}
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
                onChange={(e) =>
                  handleFieldChange('purposeNote', e.target.value)
                }
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
                    <span className="text-[#8B95A1] font-normal">
                      (서명/인)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </A4ScalePreview>
      </div>
    </div>
  );
};
