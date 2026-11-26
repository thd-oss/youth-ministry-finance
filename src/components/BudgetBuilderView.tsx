import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eraser,
  Eye,
  FileText,
  FolderPlus,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  X,
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
import {
  BudgetsMap,
  createBlankClaimDocument,
  syncBudgetDocumentWithDepartment,
} from '../utils/syncManager';
import { A4ScalePreview } from './A4ScalePreview';
import { AutoResizeTextarea } from './AutoResizeTextarea';

interface BudgetBuilderViewProps {
  fiscalYear: number;
  budgets: BudgetsMap;
  onUpdateBudgets: (nextBudgets: BudgetsMap) => void;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  activeExpenseCategories: string[];
  activeIncomeCategories?: string[];
  initialTemplate?: BudgetTemplateType;
}

type BuilderScreenMode = 'card_editor' | 'a4_preview';

interface BudgetSubCategoryGroup {
  key: string;
  subCategory: string;
  items: BudgetLineItem[];
  subtotal: number;
  shareOfParent: number;
  hasThirdTier: boolean;
}

interface BudgetCategoryGroup {
  key: string;
  entryType: TransactionType;
  category: string;
  items: BudgetLineItem[];
  subGroups: BudgetSubCategoryGroup[];
  subtotal: number;
  sharePercent: number;
  color: string;
}

const EXPENSE_PALETTE = [
  '#3182F6',
  '#1B64DA',
  '#00B493',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#0EA5E9',
  '#6B7684',
];

const INCOME_PALETTE = [
  '#10B981',
  '#059669',
  '#0EA5E9',
  '#3182F6',
  '#6366F1',
];

interface DraftFormState {
  category: string;
  subCategory: string;
  detailCategory: string;
  itemName: string;
  unitPriceStr: string;
  qtyStr: string;
  qtyUnit: string;
  freqStr: string;
  freqUnit: string;
  formula: string;
  amountStr: string;
  note: string;
}

const EMPTY_DRAFT: DraftFormState = {
  category: '',
  subCategory: '',
  detailCategory: '',
  itemName: '',
  unitPriceStr: '',
  qtyStr: '',
  qtyUnit: '명',
  freqStr: '',
  freqUnit: '회',
  formula: '',
  amountStr: '',
  note: '',
};

const UNASSIGNED_SUBCATEGORY_LABEL = '세부 항목 미지정';
const MAX_QUICK_CHIPS = 10;

const getEffectiveSubCategory = (item: BudgetLineItem): string =>
  item.subCategory?.trim() ||
  item.itemName?.trim() ||
  UNASSIGNED_SUBCATEGORY_LABEL;

const parseDigits = (raw: string): number => {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export const BudgetBuilderView: React.FC<BudgetBuilderViewProps> = ({
  fiscalYear,
  budgets,
  onUpdateBudgets,
  settings,
  activeExpenseCategories,
  activeIncomeCategories = [],
  initialTemplate = 'annual_budget',
}) => {
  const [activeTemplate, setActiveTemplate] =
    useState<BudgetTemplateType>(initialTemplate);
  const [activeClaimId, setActiveClaimId] = useState<string>(
    () => budgets.claims?.[0]?.id || budgets.retreat_claim?.id || 'claim-1'
  );

  useEffect(() => {
    if (initialTemplate) {
      setActiveTemplate(initialTemplate);
    }
  }, [initialTemplate]);

  const claims = useMemo(
    () =>
      budgets.claims && budgets.claims.length > 0
        ? budgets.claims
        : [budgets.retreat_claim],
    [budgets.claims, budgets.retreat_claim]
  );

  useEffect(() => {
    if (!claims.some((c) => c.id === activeClaimId)) {
      setActiveClaimId(claims[0]?.id || 'claim-1');
    }
  }, [claims, activeClaimId]);

  const activeClaimDoc = useMemo(
    () => claims.find((c) => c.id === activeClaimId) || claims[0],
    [claims, activeClaimId]
  );

  const onUpdateBudget = (
    templateType: BudgetTemplateType,
    nextDoc: BudgetDocument
  ) => {
    if (templateType === 'annual_budget') {
      onUpdateBudgets({
        ...budgets,
        annual_budget: {
          ...nextDoc,
          id: 'annual_budget',
          templateType: 'annual_budget',
          fiscalYear: nextDoc.fiscalYear || fiscalYear,
        },
      });
      return;
    }

    const targetId = activeClaimDoc.id || 'claim-1';
    const nextClaims = claims.map((c) =>
      c.id === targetId
        ? {
            ...nextDoc,
            id: targetId,
            templateType: 'retreat_claim' as const,
            fiscalYear: nextDoc.fiscalYear || fiscalYear,
          }
        : c
    );
    onUpdateBudgets({
      ...budgets,
      claims: nextClaims,
      retreat_claim: nextClaims[0],
    });
  };

  const [screenMode, setScreenMode] =
    useState<BuilderScreenMode>('card_editor');
  const [a4ZoomMode, setA4ZoomMode] = useState<'fit' | 'actual'>('fit');

  // 아코디언 / 트리 UI 상태
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [collapsedSubGroups, setCollapsedSubGroups] = useState<
    Record<string, boolean>
  >({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [renamingGroupKey, setRenamingGroupKey] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState<string>('');
  const [renamingSubGroupKey, setRenamingSubGroupKey] = useState<string | null>(
    null
  );
  const [renameSubGroupValue, setRenameSubGroupValue] = useState<string>('');

  // 그룹/소그룹 내부 빠른 항목 추가 상태
  const [addingTarget, setAddingTarget] = useState<{
    entryType: TransactionType;
    category: string | null; // null이면 '새 1차 분류' 모드
    subCategory?: string | null; // 지정되면 '2차 소그룹 [+ 3차]' 모드
  } | null>(null);
  const [draft, setDraft] = useState<DraftFormState>(EMPTY_DRAFT);
  const [feedback, setFeedback] = useState<string>('');

  // 문서 기본정보 & 계좌정보 접이식 상태
  const [isDocMetaExpanded, setIsDocMetaExpanded] = useState<boolean>(false);

  // 인라인 편집 시 간편 단가 계산기 상태
  const [editCalcUnit, setEditCalcUnit] = useState<string>('');
  const [editCalcQty, setEditCalcQty] = useState<string>('');
  const [editCalcQtyUnit, setEditCalcQtyUnit] = useState<string>('명');
  const [editCalcFreq, setEditCalcFreq] = useState<string>('');
  const [editCalcFreqUnit, setEditCalcFreqUnit] = useState<string>('회');

  const draftCatInputRef = useRef<HTMLInputElement | null>(null);
  const draftSubInputRef = useRef<HTMLInputElement | null>(null);
  const draftDetailInputRef = useRef<HTMLInputElement | null>(null);

  const doc =
    activeTemplate === 'annual_budget' ? budgets.annual_budget : activeClaimDoc;

  // 템플릿 또는 활성 청구서 전환 시 편집/입력 패널 초기화
  useEffect(() => {
    setEditingItemId(null);
    setAddingTarget(null);
    setRenamingGroupKey(null);
    setRenamingSubGroupKey(null);
    setFeedback('');
  }, [activeTemplate, activeClaimId, fiscalYear]);

  const handleAddNewClaim = () => {
    const newClaim = createBlankClaimDocument(
      fiscalYear,
      settings.departmentName,
      settings.authorName,
      settings.authorRole,
      {
        title: `${fiscalYear}년 ${settings.departmentName || '청년부'} 특별 예산 청구서 #${claims.length + 1}`,
        bankName: activeClaimDoc.bankName,
        accountNumber: activeClaimDoc.accountNumber,
        accountHolder: activeClaimDoc.accountHolder,
      }
    );
    const nextClaims = [...claims, newClaim];
    onUpdateBudgets({
      ...budgets,
      claims: nextClaims,
      retreat_claim: nextClaims[0],
    });
    setActiveTemplate('retreat_claim');
    setActiveClaimId(newClaim.id || 'claim-1');
    setScreenMode('card_editor');
    setIsDocMetaExpanded(true);
    showToast('새 특별예산 청구서를 추가했습니다.');
  };

  const handleDuplicateActiveClaim = () => {
    const clonedId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const cloned: BudgetDocument = {
      ...activeClaimDoc,
      id: clonedId,
      templateType: 'retreat_claim',
      fiscalYear,
      title: `${activeClaimDoc.title} (사본)`,
      items: activeClaimDoc.items.map((item, idx) => ({
        ...item,
        id: `bg-${Date.now()}-${idx}`,
      })),
    };
    const nextClaims = [...claims, cloned];
    onUpdateBudgets({
      ...budgets,
      claims: nextClaims,
      retreat_claim: nextClaims[0],
    });
    setActiveClaimId(clonedId);
    showToast('현재 청구서를 복제했습니다.');
  };

  const handleDeleteActiveClaim = () => {
    if (claims.length <= 1) return;
    if (
      !window.confirm(
        `"${activeClaimDoc.title || '이 청구서'}"를 삭제할까요?\n(다른 청구서와 연간 예산안은 유지됩니다)`
      )
    ) {
      return;
    }
    const nextClaims = claims.filter((c) => c.id !== activeClaimDoc.id);
    onUpdateBudgets({
      ...budgets,
      claims: nextClaims,
      retreat_claim: nextClaims[0],
    });
    setActiveClaimId(nextClaims[0]?.id || 'claim-1');
    showToast('청구서를 삭제했습니다.');
  };

  // 3단계 중첩 위계 트리 파생: 1차 분류 -> 2차 소그룹 -> 3차 세부 항목
  const {
    expenseGroups,
    incomeGroups,
    totalExpense,
    totalIncome,
    netChurchClaimAmount,
  } = useMemo(() => {
    const expMap = new Map<string, BudgetLineItem[]>();
    const incMap = new Map<string, BudgetLineItem[]>();
    let expTotal = 0;
    let incTotal = 0;

    doc.items.forEach((item) => {
      const eType: TransactionType =
        item.entryType === 'income' ? 'income' : 'expense';
      const cat = item.category.trim() || '미분류';
      const amt = Number(item.amount) || 0;

      if (eType === 'income') {
        incTotal += amt;
        const arr = incMap.get(cat) || [];
        arr.push(item);
        incMap.set(cat, arr);
      } else {
        expTotal += amt;
        const arr = expMap.get(cat) || [];
        arr.push(item);
        expMap.set(cat, arr);
      }
    });

    const buildCategoryGroups = (
      entryType: TransactionType,
      map: Map<string, BudgetLineItem[]>,
      grandTotal: number,
      palette: string[]
    ): BudgetCategoryGroup[] =>
      Array.from(map.entries()).map(([category, items], idx) => {
        const subtotal = items.reduce(
          (sum, it) => sum + (Number(it.amount) || 0),
          0
        );
        const sharePercent =
          grandTotal > 0 ? Math.round((subtotal / grandTotal) * 1000) / 10 : 0;

        // 2차 분류 기준 소그룹 파생
        const subMap = new Map<string, BudgetLineItem[]>();
        items.forEach((it) => {
          const subKey = getEffectiveSubCategory(it);
          const arr = subMap.get(subKey) || [];
          arr.push(it);
          subMap.set(subKey, arr);
        });

        const subGroups: BudgetSubCategoryGroup[] = Array.from(
          subMap.entries()
        ).map(([subCategory, subItems]) => {
          const subTotal = subItems.reduce(
            (sum, it) => sum + (Number(it.amount) || 0),
            0
          );
          const shareOfParent =
            subtotal > 0 ? Math.round((subTotal / subtotal) * 1000) / 10 : 0;
          const hasThirdTier =
            subItems.length >= 2 ||
            subItems.some((it) => Boolean(it.detailCategory?.trim()));

          return {
            key: `${entryType}::${category}::${subCategory}`,
            subCategory,
            items: subItems,
            subtotal: subTotal,
            shareOfParent,
            hasThirdTier,
          };
        });

        return {
          key: `${entryType}::${category}`,
          entryType,
          category,
          items,
          subGroups,
          subtotal,
          sharePercent,
          color: palette[idx % palette.length],
        };
      });

    const expGroups = buildCategoryGroups(
      'expense',
      expMap,
      expTotal,
      EXPENSE_PALETTE
    );
    const incGroups = buildCategoryGroups(
      'income',
      incMap,
      incTotal,
      INCOME_PALETTE
    );

    const netClaim = Math.max(
      0,
      expTotal - (Number(doc.selfBurdenAmount) || 0)
    );

    return {
      expenseGroups: expGroups,
      incomeGroups: incGroups,
      totalExpense: expTotal,
      totalIncome: incTotal,
      netChurchClaimAmount: netClaim,
    };
  }, [doc.items, doc.selfBurdenAmount]);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2600);
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

  const handleRemoveRow = (id: string) => {
    if (editingItemId === id) setEditingItemId(null);
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
    });
  };

  const handleRenameGroup = (
    entryType: TransactionType,
    oldCategory: string,
    newCategoryRaw: string
  ) => {
    const nextCat = newCategoryRaw.trim();
    if (!nextCat || nextCat === oldCategory) {
      setRenamingGroupKey(null);
      return;
    }
    const nextItems = doc.items.map((item) => {
      const itemType: TransactionType =
        item.entryType === 'income' ? 'income' : 'expense';
      const itemCat = item.category.trim() || '미분류';
      if (itemType === entryType && itemCat === oldCategory) {
        return { ...item, category: nextCat };
      }
      return item;
    });
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: nextItems,
    });
    setRenamingGroupKey(null);
    showToast(`1차 분류가 [${nextCat}]로 변경되었습니다.`);
  };

  const handleRenameSubGroup = (
    entryType: TransactionType,
    category: string,
    oldSubCategory: string,
    newSubCategoryRaw: string
  ) => {
    const nextSub = newSubCategoryRaw.trim();
    if (!nextSub || nextSub === oldSubCategory) {
      setRenamingSubGroupKey(null);
      return;
    }
    const nextItems = doc.items.map((item) => {
      const itemType: TransactionType =
        item.entryType === 'income' ? 'income' : 'expense';
      const itemCat = item.category.trim() || '미분류';
      const itemSub = getEffectiveSubCategory(item);
      if (
        itemType === entryType &&
        itemCat === category &&
        itemSub === oldSubCategory
      ) {
        return { ...item, subCategory: nextSub };
      }
      return item;
    });
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: nextItems,
    });
    setRenamingSubGroupKey(null);
    showToast(`2차 분류가 [${nextSub}]로 변경되었습니다.`);
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const toggleSubGroupCollapsed = (subGroupKey: string) => {
    setCollapsedSubGroups((prev) => ({
      ...prev,
      [subGroupKey]: !prev[subGroupKey],
    }));
  };

  const openInlineAdd = (
    entryType: TransactionType,
    category: string | null,
    subCategory: string | null = null
  ) => {
    setEditingItemId(null);
    setRenamingGroupKey(null);
    setRenamingSubGroupKey(null);
    if (category) {
      const gKey = `${entryType}::${category}`;
      setCollapsedGroups((prev) => ({ ...prev, [gKey]: false }));
      if (subCategory) {
        const subKey = `${entryType}::${category}::${subCategory}`;
        setCollapsedSubGroups((prev) => ({ ...prev, [subKey]: false }));
      }
    }
    setAddingTarget({ entryType, category, subCategory });
    setDraft({
      ...EMPTY_DRAFT,
      category: category || '',
      subCategory: subCategory || '',
    });
    setTimeout(() => {
      if (category && subCategory) {
        draftDetailInputRef.current?.focus();
      } else if (category) {
        draftSubInputRef.current?.focus();
      } else {
        draftCatInputRef.current?.focus();
      }
    }, 60);
  };

  const updateDraftMultipliers = (patch: Partial<DraftFormState>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      const unitPrice = parseDigits(next.unitPriceStr);
      const qty = parseDigits(next.qtyStr);
      const freq = parseDigits(next.freqStr);
      if (unitPrice > 0) {
        const effQty = qty > 0 ? qty : 1;
        const effFreq = freq > 0 ? freq : 1;
        next.amountStr = formatNumber(unitPrice * effQty * effFreq);
        const parts: string[] = [`${formatNumber(unitPrice)}원`];
        if (qty > 0) parts.push(`${formatNumber(qty)}${next.qtyUnit}`);
        if (freq > 0) parts.push(`${formatNumber(freq)}${next.freqUnit}`);
        next.formula = parts.join(' × ');
      }
      return next;
    });
  };

  const handleSubmitInlineAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingTarget) return;

    const cleanCategory =
      (addingTarget.category || draft.category).trim() ||
      (addingTarget.entryType === 'income' ? '교회지원금(예산)' : '기타운영비');
    const cleanSubCategory = (
      addingTarget.subCategory || draft.subCategory
    ).trim();
    const cleanDetailCategory = draft.detailCategory.trim();
    const cleanDescription = draft.itemName.trim();
    const numericAmount = parseDigits(draft.amountStr);

    if (!cleanSubCategory) {
      showToast('2차 분류를 입력하거나 선택해 주세요.');
      return;
    }

    if (addingTarget.subCategory && !cleanDetailCategory && !cleanDescription) {
      showToast('3차 분류 또는 설명을 입력해 주세요.');
      return;
    }

    const newItem: BudgetLineItem = {
      id: `bg-${Date.now()}`,
      entryType: addingTarget.entryType,
      category: cleanCategory,
      subCategory: cleanSubCategory,
      detailCategory: cleanDetailCategory || undefined,
      itemName: cleanDescription,
      formula:
        draft.formula.trim() ||
        (numericAmount > 0 ? `${formatNumber(numericAmount)}원 × 1식` : ''),
      amount: numericAmount,
      note: draft.note.trim(),
    };

    onUpdateBudget(activeTemplate, {
      ...doc,
      items: [...doc.items, newItem],
    });

    const keepLockedSub = addingTarget.subCategory ? cleanSubCategory : null;
    setAddingTarget({
      entryType: addingTarget.entryType,
      category: cleanCategory,
      subCategory: keepLockedSub,
    });
    setDraft({
      ...EMPTY_DRAFT,
      category: cleanCategory,
      subCategory: keepLockedSub || '',
    });

    const pathLabel = cleanDetailCategory
      ? `${cleanCategory} › ${cleanSubCategory} › ${cleanDetailCategory}`
      : `${cleanCategory} › ${cleanSubCategory}`;
    showToast(`[${pathLabel}] ${formatWon(numericAmount)} 추가됨`);

    if (keepLockedSub) {
      setTimeout(() => {
        draftDetailInputRef.current?.focus();
      }, 40);
    }
  };

  const handleOpenEditItem = (item: BudgetLineItem) => {
    if (editingItemId === item.id) {
      setEditingItemId(null);
      return;
    }
    setAddingTarget(null);
    setEditingItemId(item.id);
    setEditCalcUnit('');
    setEditCalcQty('');
    setEditCalcFreq('');
  };

  const applyEditItemCalculator = (
    itemId: string,
    uStr: string,
    qStr: string,
    qUnit: string,
    fStr: string,
    fUnit: string
  ) => {
    const unitPrice = parseDigits(uStr);
    const qty = parseDigits(qStr);
    const freq = parseDigits(fStr);
    if (unitPrice <= 0) return;

    const effQty = qty > 0 ? qty : 1;
    const effFreq = freq > 0 ? freq : 1;
    const total = unitPrice * effQty * effFreq;
    const parts: string[] = [`${formatNumber(unitPrice)}원`];
    if (qty > 0) parts.push(`${formatNumber(qty)}${qUnit}`);
    if (freq > 0) parts.push(`${formatNumber(freq)}${fUnit}`);

    const nextItems = doc.items.map((item) =>
      item.id === itemId
        ? { ...item, amount: total, formula: parts.join(' × ') }
        : item
    );
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: nextItems,
    });
  };

  const handleAddBlankRowForA4 = () => {
    const newItem: BudgetLineItem = {
      id: `bg-${Date.now()}`,
      entryType: 'expense',
      category: expenseGroups[expenseGroups.length - 1]?.category || '기타운영비',
      subCategory: '',
      detailCategory: '',
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

  const handleClearAllItems = () => {
    onUpdateBudget(activeTemplate, {
      ...doc,
      items: [],
      selfBurdenAmount: 0,
      selfBurdenNote: '',
    });
    setEditingItemId(null);
    setAddingTarget({ entryType: 'expense', category: null, subCategory: null });
    setDraft(EMPTY_DRAFT);
    setScreenMode('card_editor');
    showToast('항목을 모두 비웠습니다. 새 분류를 추가해 보세요.');
  };

  const handleResetTemplate = () => {
    const rawDefaultDoc =
      activeTemplate === 'retreat_claim'
        ? INITIAL_RETREAT_BUDGET
        : INITIAL_ANNUAL_BUDGET;
    const { doc: syncedDefaultDoc } = syncBudgetDocumentWithDepartment(
      rawDefaultDoc,
      settings.departmentName,
      undefined,
      settings.authorName
    );
    onUpdateBudget(activeTemplate, syncedDefaultDoc);
    setEditingItemId(null);
    setAddingTarget(null);
    setRenamingGroupKey(null);
    setRenamingSubGroupKey(null);
    showToast('샘플 예산안이 복원되었습니다.');
  };

  const allExpanded =
    expenseGroups.length + incomeGroups.length > 0 &&
    [...expenseGroups, ...incomeGroups].every((g) => !collapsedGroups[g.key]);

  const toggleExpandAll = () => {
    const nextGroupState: Record<string, boolean> = {};
    const nextSubState: Record<string, boolean> = {};
    const shouldCollapse = allExpanded;
    [...expenseGroups, ...incomeGroups].forEach((g) => {
      nextGroupState[g.key] = shouldCollapse;
      g.subGroups.forEach((sg) => {
        nextSubState[sg.key] = shouldCollapse;
      });
    });
    setCollapsedGroups(nextGroupState);
    setCollapsedSubGroups(nextSubState);
  };

  // 인라인 추가 폼 렌더러 (새 1차 분류 / 1차 그룹 [+ 항목] / 2차 소그룹 [+ 3차] 3종 공용)
  const renderInlineAddForm = (
    entryType: TransactionType,
    lockedCategory: string | null,
    lockedSubCategory: string | null = null,
    existingSubCategories: string[] = []
  ) => {
    const isIncome = entryType === 'income';
    const commonDetailChips = isIncome
      ? COMMON_INCOME_SUBCATEGORIES
      : COMMON_EXPENSE_SUBCATEGORIES;
    const catChips = Array.from(
      new Set([
        ...(isIncome ? activeIncomeCategories : activeExpenseCategories),
      ])
    ).slice(0, MAX_QUICK_CHIPS);
    const subChips = Array.from(
      new Set([...existingSubCategories, ...commonDetailChips])
    ).slice(0, MAX_QUICK_CHIPS);

    const formTitle =
      lockedCategory && lockedSubCategory
        ? `[${lockedCategory} › ${lockedSubCategory}] 3차 항목 추가`
        : lockedCategory
          ? `[${lockedCategory}] 항목 추가`
          : isIncome
            ? '새 수입 분류 추가'
            : '새 1차 분류 추가';

    return (
      <form
        onSubmit={handleSubmitInlineAdd}
        className="bg-[#F9FAFB] rounded-2xl p-3 sm:p-4 space-y-3 border border-[#E5E8EB]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold text-[#191F28] truncate">
            {formTitle}
          </span>
          <button
            type="button"
            onClick={() => setAddingTarget(null)}
            aria-label="입력 닫기"
            className="w-8 h-8 rounded-full bg-[#FFFFFF] text-[#4E5968] flex items-center justify-center hover:bg-[#E5E8EB] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1차 분류 입력 (새 1차 분류 모드일 때만) */}
        {!lockedCategory && (
          <div className="space-y-1.5">
            <label className="block text-[11.5px] font-semibold text-[#4E5968]">
              1차 분류 (필수)
            </label>
            <input
              ref={draftCatInputRef}
              type="text"
              value={draft.category}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, category: e.target.value }))
              }
              placeholder={
                isIncome
                  ? '예: 교회지원금(예산), 수련회등록비'
                  : '예: 수련회/행사비, 목장/심방비, 예배/양육비'
              }
              className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] font-bold text-[#191F28] placeholder:text-[#8B95A1] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
            {catChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {catChips.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, category: cat }))
                    }
                    className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-all active:scale-[0.97] ${
                      draft.category === cat
                        ? 'bg-[#3182F6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2차 분류 입력 (2차 소그룹 고정 모드가 아닐 때) */}
        {!lockedSubCategory && (
          <div className="space-y-1.5">
            <label className="block text-[11.5px] font-semibold text-[#4E5968]">
              2차 분류 (필수)
            </label>
            <input
              ref={draftSubInputRef}
              type="text"
              value={draft.subCategory}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, subCategory: e.target.value }))
              }
              placeholder={
                isIncome
                  ? '예: 월 정기예산 수령'
                  : '예: 동계수련회, 주일 목장모임, 제자훈련'
              }
              className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] font-bold text-[#191F28] placeholder:text-[#8B95A1] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
            {subChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {subChips.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, subCategory: sub }))
                    }
                    className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-all active:scale-[0.97] ${
                      draft.subCategory === sub
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3차 분류 (선택) + 설명 (선택) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <label className="block text-[11.5px] font-semibold text-[#4E5968]">
              3차 분류 (선택)
            </label>
            <input
              ref={draftDetailInputRef}
              type="text"
              value={draft.detailCategory}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  detailCategory: e.target.value,
                }))
              }
              placeholder={
                isIncome ? '예: 1차 등록비' : '예: 숙박·대관·차량, 식비·간식/다과'
              }
              className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] font-bold text-[#191F28] placeholder:text-[#8B95A1] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11.5px] font-semibold text-[#4E5968]">
              설명 (선택)
            </label>
            <input
              type="text"
              value={draft.itemName}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, itemName: e.target.value }))
              }
              placeholder="구체적 내역"
              className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
          </div>
        </div>

        {/* 3차 세목 빠른 칩 */}
        <div className="flex flex-wrap gap-1.5">
          {commonDetailChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  detailCategory: prev.detailCategory === chip ? '' : chip,
                }))
              }
              className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-all active:scale-[0.97] ${
                draft.detailCategory === chip
                  ? 'bg-[#3182F6] text-[#FFFFFF]'
                  : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
              }`}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* 단가 × 수량 × 횟수 간편 계산기 (모바일 2행: 단가 풀폭 + 수량|횟수 2열) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[11px] font-medium text-[#8B95A1] mb-1">
              단가 (원)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={draft.unitPriceStr}
              onChange={(e) => {
                const n = parseDigits(e.target.value);
                updateDraftMultipliers({
                  unitPriceStr: n > 0 ? formatNumber(n) : '',
                });
              }}
              placeholder="예: 10,000"
              className="w-full min-w-0 h-9 px-2.5 rounded-xl bg-[#FFFFFF] text-right text-[13px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-medium text-[#8B95A1] mb-1">
              수량
            </label>
            <div className="flex gap-1 min-w-0">
              <input
                type="text"
                inputMode="numeric"
                value={draft.qtyStr}
                onChange={(e) => {
                  const n = parseDigits(e.target.value);
                  updateDraftMultipliers({
                    qtyStr: n > 0 ? String(n) : '',
                  });
                }}
                placeholder="40"
                className="min-w-0 flex-1 h-9 px-2 rounded-xl bg-[#FFFFFF] text-right text-[13px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <select
                value={draft.qtyUnit}
                onChange={(e) =>
                  updateDraftMultipliers({ qtyUnit: e.target.value })
                }
                aria-label="수량 단위"
                className="h-9 px-1.5 rounded-xl bg-[#FFFFFF] text-[12px] font-semibold text-[#4E5968] shrink-0 focus:outline-none"
              >
                <option value="명">명</option>
                <option value="개월">개월</option>
                <option value="개">개</option>
                <option value="식">식</option>
                <option value="부">부</option>
              </select>
            </div>
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-medium text-[#8B95A1] mb-1">
              횟수
            </label>
            <div className="flex gap-1 min-w-0">
              <input
                type="text"
                inputMode="numeric"
                value={draft.freqStr}
                onChange={(e) => {
                  const n = parseDigits(e.target.value);
                  updateDraftMultipliers({
                    freqStr: n > 0 ? String(n) : '',
                  });
                }}
                placeholder="1"
                className="min-w-0 flex-1 h-9 px-2 rounded-xl bg-[#FFFFFF] text-right text-[13px] font-semibold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <select
                value={draft.freqUnit}
                onChange={(e) =>
                  updateDraftMultipliers({ freqUnit: e.target.value })
                }
                aria-label="횟수 단위"
                className="h-9 px-1.5 rounded-xl bg-[#FFFFFF] text-[12px] font-semibold text-[#4E5968] shrink-0 focus:outline-none"
              >
                <option value="회">회</option>
                <option value="개월">개월</option>
                <option value="박">박</option>
                <option value="끼">끼</option>
              </select>
            </div>
          </div>
        </div>

        {/* 금액 · 산출식 · 비고 */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-4">
            <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
              예산 금액 (원)
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                inputMode="numeric"
                value={draft.amountStr}
                onChange={(e) => {
                  const n = parseDigits(e.target.value);
                  setDraft((prev) => ({
                    ...prev,
                    amountStr: n > 0 ? formatNumber(n) : '',
                  }));
                }}
                placeholder="0"
                className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#FFFFFF] text-right text-[15px] font-bold text-[#3182F6] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <span className="absolute right-3 text-[12.5px] font-bold text-[#4E5968] pointer-events-none">
                원
              </span>
            </div>
          </div>

          <div className="sm:col-span-5">
            <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
              산출식
            </label>
            <input
              type="text"
              value={draft.formula}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, formula: e.target.value }))
              }
              placeholder="예: 10,000원 × 40명"
              className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13px] text-[#4E5968] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
              비고 (선택)
            </label>
            <input
              type="text"
              value={draft.note}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, note: e.target.value }))
              }
              placeholder="비고"
              className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13px] text-[#4E5968] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setAddingTarget(null)}
            className="h-9 px-3.5 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12.5px] font-semibold hover:bg-[#E5E8EB]"
          >
            닫기
          </button>
          <button
            type="submit"
            className="h-9 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold flex items-center gap-1 active:scale-[0.97]"
          >
            <Plus className="w-4 h-4" />
            <span>항목 추가</span>
          </button>
        </div>
      </form>
    );
  };

  // 그룹 섹션 렌더러 (지출 예산 / 수입 예산 공용)
  const renderSection = (
    entryType: TransactionType,
    groups: BudgetCategoryGroup[],
    sectionTotal: number
  ) => {
    const isIncome = entryType === 'income';
    const sectionItemCount = groups.reduce((acc, g) => acc + g.items.length, 0);
    const isAddingNewGroup =
      addingTarget?.entryType === entryType && addingTarget.category === null;

    const categoryMoveOptions = Array.from(
      new Set([
        ...groups.map((g) => g.category),
        ...(isIncome ? activeIncomeCategories : activeExpenseCategories),
      ])
    );

    const renderInlineEditCard = (
      item: BudgetLineItem,
      existingSubCategories: string[]
    ) => {
      const detailChips = isIncome
        ? COMMON_INCOME_SUBCATEGORIES
        : COMMON_EXPENSE_SUBCATEGORIES;
      const subDatalistId = `sub-list-${entryType}-${item.id}`;

      return (
        <div
          key={item.id}
          className="bg-[#F9FAFB] rounded-2xl p-3 sm:p-4 space-y-3 border border-[#3182F6]/30"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold text-[#3182F6]">
              항목 편집
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleRemoveRow(item.id)}
                className="h-8 px-2.5 rounded-lg bg-[#FFEEF0] text-[#F04452] text-[12px] font-bold flex items-center gap-1 whitespace-nowrap active:scale-[0.97]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>삭제</span>
              </button>
              <button
                type="button"
                onClick={() => setEditingItemId(null)}
                className="h-8 px-3 rounded-lg bg-[#3182F6] text-[#FFFFFF] text-[12px] font-bold flex items-center gap-1 whitespace-nowrap active:scale-[0.97]"
              >
                <Check className="w-3.5 h-3.5" />
                <span>완료</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
                1차 분류
              </label>
              <input
                type="text"
                list={`cat-list-${entryType}`}
                value={item.category}
                onChange={(e) =>
                  handleItemChange(item.id, 'category', e.target.value)
                }
                className="w-full h-9 px-3 rounded-xl bg-[#FFFFFF] text-[13px] font-bold text-[#1B64DA] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <datalist id={`cat-list-${entryType}`}>
                {categoryMoveOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
                2차 분류
              </label>
              <input
                type="text"
                list={subDatalistId}
                value={item.subCategory || ''}
                onChange={(e) =>
                  handleItemChange(item.id, 'subCategory', e.target.value)
                }
                placeholder="예: 동계수련회"
                className="w-full h-9 px-3 rounded-xl bg-[#FFFFFF] text-[13px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <datalist id={subDatalistId}>
                {existingSubCategories.map((sub) => (
                  <option key={sub} value={sub} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
                3차 분류 (선택)
              </label>
              <input
                type="text"
                value={item.detailCategory || ''}
                onChange={(e) =>
                  handleItemChange(
                    item.id,
                    'detailCategory',
                    e.target.value || undefined
                  )
                }
                placeholder="예: 식비·간식/다과"
                className="w-full h-9 px-3 rounded-xl bg-[#FFFFFF] text-[13px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
            </div>
          </div>

          {/* 3차 세목 빠른 선택 칩 */}
          <div className="flex flex-wrap gap-1.5">
            {detailChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() =>
                  handleItemChange(
                    item.id,
                    'detailCategory',
                    item.detailCategory === chip ? undefined : chip
                  )
                }
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-[0.97] ${
                  item.detailCategory === chip
                    ? 'bg-[#3182F6] text-[#FFFFFF]'
                    : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
                }`}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* 설명 & 금액 */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-7">
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
                설명 (선택)
              </label>
              <input
                type="text"
                value={item.itemName}
                onChange={(e) =>
                  handleItemChange(item.id, 'itemName', e.target.value)
                }
                placeholder="구체적 내역"
                className="w-full h-9 px-3 rounded-xl bg-[#FFFFFF] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
            </div>

            <div className="sm:col-span-5">
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
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
                  className="w-full h-9 pl-3 pr-8 rounded-xl bg-[#FFFFFF] text-right text-[14.5px] font-bold text-[#3182F6] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
                <span className="absolute right-3 text-[12px] font-bold text-[#4E5968] pointer-events-none">
                  원
                </span>
              </div>
            </div>
          </div>

          {/* 간편 단가 자동계산 보조줄 (모바일 2행: 단가 풀폭 + 수량|횟수 2열) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            <input
              type="text"
              inputMode="numeric"
              value={editCalcUnit}
              onChange={(e) => {
                const n = parseDigits(e.target.value);
                const nextU = n > 0 ? formatNumber(n) : '';
                setEditCalcUnit(nextU);
                applyEditItemCalculator(
                  item.id,
                  nextU,
                  editCalcQty,
                  editCalcQtyUnit,
                  editCalcFreq,
                  editCalcFreqUnit
                );
              }}
              placeholder="단가 (자동계산)"
              className="col-span-2 sm:col-span-1 w-full min-w-0 h-9 px-2.5 rounded-lg bg-[#FFFFFF] text-right text-[12.5px] text-[#4E5968] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
            <div className="flex gap-1 min-w-0">
              <input
                type="text"
                inputMode="numeric"
                value={editCalcQty}
                onChange={(e) => {
                  const n = parseDigits(e.target.value);
                  const nextQ = n > 0 ? String(n) : '';
                  setEditCalcQty(nextQ);
                  applyEditItemCalculator(
                    item.id,
                    editCalcUnit,
                    nextQ,
                    editCalcQtyUnit,
                    editCalcFreq,
                    editCalcFreqUnit
                  );
                }}
                placeholder="수량"
                className="min-w-0 flex-1 h-9 px-2 rounded-lg bg-[#FFFFFF] text-right text-[12.5px] text-[#4E5968] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <select
                value={editCalcQtyUnit}
                onChange={(e) => {
                  setEditCalcQtyUnit(e.target.value);
                  applyEditItemCalculator(
                    item.id,
                    editCalcUnit,
                    editCalcQty,
                    e.target.value,
                    editCalcFreq,
                    editCalcFreqUnit
                  );
                }}
                aria-label="수량 단위"
                className="h-9 px-1.5 rounded-lg bg-[#FFFFFF] text-[12px] text-[#4E5968] shrink-0 focus:outline-none"
              >
                <option value="명">명</option>
                <option value="개월">개월</option>
                <option value="개">개</option>
                <option value="식">식</option>
              </select>
            </div>
            <div className="flex gap-1 min-w-0">
              <input
                type="text"
                inputMode="numeric"
                value={editCalcFreq}
                onChange={(e) => {
                  const n = parseDigits(e.target.value);
                  const nextF = n > 0 ? String(n) : '';
                  setEditCalcFreq(nextF);
                  applyEditItemCalculator(
                    item.id,
                    editCalcUnit,
                    editCalcQty,
                    editCalcQtyUnit,
                    nextF,
                    editCalcFreqUnit
                  );
                }}
                placeholder="횟수"
                className="min-w-0 flex-1 h-9 px-2 rounded-lg bg-[#FFFFFF] text-right text-[12.5px] text-[#4E5968] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
              <select
                value={editCalcFreqUnit}
                onChange={(e) => {
                  setEditCalcFreqUnit(e.target.value);
                  applyEditItemCalculator(
                    item.id,
                    editCalcUnit,
                    editCalcQty,
                    editCalcQtyUnit,
                    editCalcFreq,
                    e.target.value
                  );
                }}
                aria-label="횟수 단위"
                className="h-9 px-1.5 rounded-lg bg-[#FFFFFF] text-[12px] text-[#4E5968] shrink-0 focus:outline-none"
              >
                <option value="회">회</option>
                <option value="개월">개월</option>
                <option value="박">박</option>
              </select>
            </div>
          </div>

          {/* 산출식 & 비고 */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-8">
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
                산출식
              </label>
              <input
                type="text"
                value={item.formula}
                onChange={(e) =>
                  handleItemChange(item.id, 'formula', e.target.value)
                }
                placeholder="단가 × 수량 × 횟수"
                className="w-full h-9 px-3 rounded-xl bg-[#FFFFFF] text-[12.5px] text-[#4E5968] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-[11px] font-semibold text-[#8B95A1] mb-1">
                비고 (선택)
              </label>
              <input
                type="text"
                value={item.note}
                onChange={(e) =>
                  handleItemChange(item.id, 'note', e.target.value)
                }
                placeholder="비고"
                className="w-full h-9 px-3 rounded-xl bg-[#FFFFFF] text-[12.5px] text-[#4E5968] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
              />
            </div>
          </div>
        </div>
      );
    };

    return (
      <section className="space-y-3">
        {/* 섹션 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-[12px] font-bold ${
                isIncome
                  ? 'bg-[#E8F3FF] text-[#1B64DA]'
                  : 'bg-[#191F28] text-[#FFFFFF]'
              }`}
            >
              {isIncome ? '수입 예산' : '지출 예산'}
            </span>
            <span className="text-[14px] font-bold text-[#191F28] tabular-nums">
              {formatWon(sectionTotal)}
            </span>
            <span className="text-[12.5px] text-[#8B95A1] tabular-nums">
              ({groups.length}개 분류 · {sectionItemCount}건)
            </span>
          </div>

          <button
            type="button"
            onClick={() => openInlineAdd(entryType, null, null)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold flex items-center gap-1 active:scale-[0.97] transition-all ${
              isIncome
                ? 'bg-[#E8F3FF] text-[#1B64DA]'
                : 'bg-[#FFFFFF] text-[#191F28] hover:bg-[#E5E8EB]'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{isIncome ? '새 수입 분류 추가' : '새 1차 분류 추가'}</span>
          </button>
        </div>

        {/* 새 1차 분류 생성 폼 */}
        {isAddingNewGroup && (
          <div className="bg-[#FFFFFF] rounded-3xl p-4">
            {renderInlineAddForm(entryType, null, null, [])}
          </div>
        )}

        {/* 그룹 카드 목록 */}
        {groups.length === 0 ? (
          !isAddingNewGroup && (
            <div className="bg-[#FFFFFF] rounded-3xl p-6 text-center">
              <div className="text-[13.5px] font-medium text-[#8B95A1]">
                {isIncome
                  ? '등록된 수입 예산 항목이 없습니다'
                  : '등록된 지출 예산 항목이 없습니다'}
              </div>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.key]);
              const isRenaming = renamingGroupKey === group.key;
              const isAddingAtGroupLevel =
                addingTarget?.entryType === entryType &&
                addingTarget.category === group.category &&
                !addingTarget.subCategory;
              const existingSubsInGroup = group.subGroups.map(
                (sg) => sg.subCategory
              );

              return (
                <div
                  key={group.key}
                  className="bg-[#FFFFFF] rounded-3xl overflow-hidden"
                >
                  {/* 1차 분류 헤더 (모바일 2행으로 분류명 말줄임 방지, sm 이상 1행 유지) */}
                  <div className="px-3.5 py-3.5 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-[#FFFFFF]">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed(group.key)}
                        aria-label={isCollapsed ? '펼치기' : '접기'}
                        className="w-8 h-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center shrink-0 hover:bg-[#E5E8EB] active:scale-[0.97]"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>

                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: group.color }}
                      />

                      {isRenaming ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="text"
                            value={renameGroupValue}
                            onChange={(e) =>
                              setRenameGroupValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleRenameGroup(
                                  entryType,
                                  group.category,
                                  renameGroupValue
                                );
                              } else if (e.key === 'Escape') {
                                setRenamingGroupKey(null);
                              }
                            }}
                            autoFocus
                            className="h-8 px-2.5 rounded-lg bg-[#F9FAFB] text-[14px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6] min-w-0 flex-1 max-w-[200px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleRenameGroup(
                                entryType,
                                group.category,
                                renameGroupValue
                              )
                            }
                            className="w-8 h-8 rounded-lg bg-[#3182F6] text-[#FFFFFF] flex items-center justify-center shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingGroupKey(null)}
                            className="w-8 h-8 rounded-lg bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(group.key)}
                            className="text-[15px] sm:text-[15.5px] font-bold text-[#191F28] break-words [word-break:keep-all] sm:truncate text-left"
                          >
                            {group.category}
                          </button>
                          <span className="px-2 py-0.5 rounded-full bg-[#F2F4F6] text-[#4E5968] text-[11px] font-semibold tabular-nums shrink-0 whitespace-nowrap">
                            {group.items.length}건
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingSubGroupKey(null);
                              setRenamingGroupKey(group.key);
                              setRenameGroupValue(group.category);
                            }}
                            aria-label="1차 분류 이름 변경"
                            title="1차 분류 이름 변경"
                            className="w-8 h-8 rounded-lg text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F2F4F6] flex items-center justify-center shrink-0"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 우측(모바일 2행): 그룹 소계 · 비중(%) · [+ 항목] */}
                    <div className="flex items-center justify-between sm:justify-end gap-2.5 pl-10 sm:pl-0 shrink-0 tabular-nums">
                      <div className="flex items-baseline gap-2 sm:block sm:text-right">
                        <div
                          className={`text-[15px] sm:text-[15.5px] font-bold whitespace-nowrap ${
                            isIncome ? 'text-[#3182F6]' : 'text-[#191F28]'
                          }`}
                        >
                          {formatWon(group.subtotal)}
                        </div>
                        <div className="text-[11px] font-semibold text-[#8B95A1] whitespace-nowrap">
                          비중 {group.sharePercent}%
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          openInlineAdd(entryType, group.category, null)
                        }
                        className="h-8 px-2.5 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-bold flex items-center gap-1 whitespace-nowrap active:scale-[0.97] transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>항목</span>
                      </button>
                    </div>
                  </div>

                  {/* 그룹 비중 얇은 바 */}
                  <div className="px-3.5 sm:px-5">
                    <div className="h-1 rounded-full bg-[#F2F4F6] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(2, group.sharePercent))}%`,
                          backgroundColor: group.color,
                        }}
                      />
                    </div>
                  </div>

                  {/* 2차 소그룹 & 3차 세부 항목 유연 공존 트리 */}
                  {!isCollapsed && (
                    <div className="px-3 sm:px-5 pt-2.5 pb-3.5 sm:pb-4">
                      <div className="border-l-2 border-[#E5E8EB] ml-1.5 pl-2.5 sm:ml-3 sm:pl-3.5 space-y-2">
                        {group.subGroups.map((subGroup) => {
                          const isAddingInThisSub =
                            addingTarget?.entryType === entryType &&
                            addingTarget.category === group.category &&
                            addingTarget.subCategory === subGroup.subCategory;
                          const isEditingSoleItem =
                            subGroup.items.length === 1 &&
                            editingItemId === subGroup.items[0]?.id;
                          const useSubGroupWrapper =
                            !isEditingSoleItem &&
                            (subGroup.hasThirdTier || isAddingInThisSub);

                          // Case A: 2차 소그룹 래퍼 (3차 분류가 있거나 2건 이상 묶인 경우)
                          if (useSubGroupWrapper) {
                            const isSubCollapsed = Boolean(
                              collapsedSubGroups[subGroup.key]
                            );
                            const isRenamingSub =
                              renamingSubGroupKey === subGroup.key;

                            return (
                              <div
                                key={subGroup.key}
                                className="rounded-2xl bg-[#F9FAFB] p-2.5 sm:p-3 space-y-2"
                              >
                                {/* 2차 소그룹 헤더 */}
                                <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleSubGroupCollapsed(subGroup.key)
                                      }
                                      aria-label={
                                        isSubCollapsed ? '펼치기' : '접기'
                                      }
                                      className="w-8 h-8 rounded-lg bg-[#FFFFFF] text-[#4E5968] flex items-center justify-center shrink-0 hover:bg-[#E5E8EB]"
                                    >
                                      {isSubCollapsed ? (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      )}
                                    </button>

                                    {isRenamingSub ? (
                                      <div className="flex items-center gap-1 flex-1 min-w-0">
                                        <input
                                          type="text"
                                          value={renameSubGroupValue}
                                          onChange={(e) =>
                                            setRenameSubGroupValue(
                                              e.target.value
                                            )
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              handleRenameSubGroup(
                                                entryType,
                                                group.category,
                                                subGroup.subCategory,
                                                renameSubGroupValue
                                              );
                                            } else if (e.key === 'Escape') {
                                              setRenamingSubGroupKey(null);
                                            }
                                          }}
                                          autoFocus
                                          className="h-8 px-2 rounded-lg bg-[#FFFFFF] text-[13px] font-bold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6] min-w-0 flex-1 max-w-[160px]"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleRenameSubGroup(
                                              entryType,
                                              group.category,
                                              subGroup.subCategory,
                                              renameSubGroupValue
                                            )
                                          }
                                          className="w-8 h-8 rounded-lg bg-[#3182F6] text-[#FFFFFF] flex items-center justify-center shrink-0"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setRenamingSubGroupKey(null)
                                          }
                                          className="w-8 h-8 rounded-lg bg-[#FFFFFF] text-[#4E5968] flex items-center justify-center shrink-0"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1 min-w-0">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleSubGroupCollapsed(
                                              subGroup.key
                                            )
                                          }
                                          className="text-[13.5px] font-bold text-[#191F28] truncate text-left"
                                        >
                                          {subGroup.subCategory}
                                        </button>
                                        <span className="px-1.5 py-0.5 rounded-full bg-[#FFFFFF] text-[#4E5968] text-[11px] font-semibold tabular-nums shrink-0">
                                          {subGroup.items.length}건
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRenamingGroupKey(null);
                                            setRenamingSubGroupKey(
                                              subGroup.key
                                            );
                                            setRenameSubGroupValue(
                                              subGroup.subCategory
                                            );
                                          }}
                                          aria-label="2차 분류 이름 변경"
                                          title="2차 분류 이름 변경"
                                          className="w-8 h-8 rounded-lg text-[#8B95A1] hover:text-[#191F28] hover:bg-[#FFFFFF] flex items-center justify-center shrink-0"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 tabular-nums">
                                    <span
                                      className={`text-[13.5px] font-bold whitespace-nowrap ${
                                        isIncome
                                          ? 'text-[#3182F6]'
                                          : 'text-[#191F28]'
                                      }`}
                                    >
                                      {formatWon(subGroup.subtotal)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openInlineAdd(
                                          entryType,
                                          group.category,
                                          subGroup.subCategory
                                        )
                                      }
                                      className="h-8 px-2.5 rounded-lg bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold flex items-center gap-0.5 whitespace-nowrap active:scale-[0.97]"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>3차</span>
                                    </button>
                                  </div>
                                </div>

                                {/* 3차 세부 항목 리스트 */}
                                {!isSubCollapsed && (
                                  <div className="border-l-2 border-[#E5E8EB] ml-1 pl-2 sm:ml-2.5 sm:pl-3 space-y-1.5">
                                    {subGroup.items.map((item) => {
                                      if (editingItemId === item.id) {
                                        return renderInlineEditCard(
                                          item,
                                          existingSubsInGroup
                                        );
                                      }

                                      const primaryTitle =
                                        item.detailCategory?.trim() ||
                                        item.itemName?.trim() ||
                                        subGroup.subCategory;
                                      const descText =
                                        item.detailCategory?.trim()
                                          ? item.itemName?.trim()
                                          : '';

                                      return (
                                        <div
                                          key={item.id}
                                          role="button"
                                          tabIndex={0}
                                          onClick={() =>
                                            handleOpenEditItem(item)
                                          }
                                          onKeyDown={(e) => {
                                            if (
                                              e.key === 'Enter' ||
                                              e.key === ' '
                                            ) {
                                              e.preventDefault();
                                              handleOpenEditItem(item);
                                            }
                                          }}
                                          className="group px-2.5 sm:px-3 py-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#F2F4F6] flex items-start justify-between gap-2 cursor-pointer transition-all duration-150 active:scale-[0.99]"
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                              <span className="text-[13.5px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                                                {primaryTitle}
                                              </span>
                                              {descText && (
                                                <span className="text-[12px] text-[#4E5968] break-words [word-break:keep-all]">
                                                  {descText}
                                                </span>
                                              )}
                                            </div>
                                            {(item.formula || item.note) && (
                                              <div className="mt-0.5 text-[11px] text-[#8B95A1] tabular-nums break-words [word-break:keep-all]">
                                                {item.formula}
                                                {item.formula && item.note
                                                  ? ' · '
                                                  : ''}
                                                {item.note}
                                              </div>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                            <span
                                              className={`text-[13.5px] sm:text-[14px] font-bold tabular-nums whitespace-nowrap ${
                                                isIncome
                                                  ? 'text-[#3182F6]'
                                                  : 'text-[#191F28]'
                                              }`}
                                            >
                                              {formatWon(item.amount)}
                                            </span>
                                            <Pencil className="hidden sm:block w-3.5 h-3.5 text-[#8B95A1] opacity-60 group-hover:opacity-100 group-hover:text-[#3182F6] transition-opacity" />
                                          </div>
                                        </div>
                                      );
                                    })}

                                    {/* 2차 소그룹 내부 [+ 3차] 추가 폼 */}
                                    {isAddingInThisSub && (
                                      <div className="pt-1">
                                        {renderInlineAddForm(
                                          entryType,
                                          group.category,
                                          subGroup.subCategory,
                                          existingSubsInGroup
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          // Case B: 단순 2차 1줄 항목 (모바일 2단 분리로 제목·금액 폭 확보)
                          const item = subGroup.items[0];
                          if (!item) return null;
                          if (editingItemId === item.id) {
                            return renderInlineEditCard(
                              item,
                              existingSubsInGroup
                            );
                          }

                          const displaySub = getEffectiveSubCategory(item);
                          const displayDesc = item.subCategory?.trim()
                            ? item.itemName?.trim()
                            : '';

                          return (
                            <div
                              key={item.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleOpenEditItem(item)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleOpenEditItem(item);
                                }
                              }}
                              className="group px-3 sm:px-3.5 py-2.5 rounded-2xl bg-[#F9FAFB] hover:bg-[#F2F4F6] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 cursor-pointer transition-all duration-150 active:scale-[0.99]"
                            >
                              <div className="flex items-start justify-between gap-2 sm:block min-w-0 sm:flex-1">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="text-[14px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                                      {displaySub}
                                    </span>
                                    {displayDesc && (
                                      <span className="text-[12.5px] text-[#4E5968] break-words [word-break:keep-all]">
                                        {displayDesc}
                                      </span>
                                    )}
                                  </div>

                                  {(item.formula || item.note) && (
                                    <div className="hidden sm:block mt-0.5 text-[11.5px] text-[#8B95A1] tabular-nums break-words [word-break:keep-all]">
                                      {item.formula}
                                      {item.formula && item.note ? ' · ' : ''}
                                      {item.note}
                                    </div>
                                  )}
                                </div>

                                <span
                                  className={`sm:hidden text-[14px] font-bold tabular-nums whitespace-nowrap shrink-0 pt-0.5 ${
                                    isIncome
                                      ? 'text-[#3182F6]'
                                      : 'text-[#191F28]'
                                  }`}
                                >
                                  {formatWon(item.amount)}
                                </span>
                              </div>

                              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                                {(item.formula || item.note) ? (
                                  <div className="sm:hidden text-[11px] text-[#8B95A1] tabular-nums break-words [word-break:keep-all] min-w-0 flex-1">
                                    {item.formula}
                                    {item.formula && item.note ? ' · ' : ''}
                                    {item.note}
                                  </div>
                                ) : (
                                  <span className="sm:hidden" />
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openInlineAdd(
                                      entryType,
                                      group.category,
                                      subGroup.subCategory
                                    );
                                  }}
                                  className="h-8 px-2.5 rounded-lg bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E8F3FF] hover:text-[#1B64DA] text-[11.5px] font-bold flex items-center gap-0.5 whitespace-nowrap shrink-0 active:scale-[0.97]"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>3차</span>
                                </button>
                                <span
                                  className={`hidden sm:inline text-[14.5px] font-bold tabular-nums whitespace-nowrap ${
                                    isIncome
                                      ? 'text-[#3182F6]'
                                      : 'text-[#191F28]'
                                  }`}
                                >
                                  {formatWon(item.amount)}
                                </span>
                                <Pencil className="hidden sm:block w-3.5 h-3.5 text-[#8B95A1] opacity-60 group-hover:opacity-100 group-hover:text-[#3182F6] transition-opacity" />
                              </div>
                            </div>
                          );
                        })}

                        {/* 1차 그룹 내부 [+ 항목] 추가 폼 */}
                        {isAddingAtGroupLevel && (
                          <div className="pt-1.5">
                            {renderInlineAddForm(
                              entryType,
                              group.category,
                              null,
                              existingSubsInGroup
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-5 pb-28 sm:pb-16 print-container">
      {/* =====================================================================
          상단 컨트롤 바 (.no-print)
         ===================================================================== */}
      <section className="no-print max-w-[980px] mx-auto bg-[#FFFFFF] rounded-3xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[19px] font-bold text-[#191F28]">
              예산안 · 청구서
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-[#F2F4F6] text-[#4E5968] text-[12px] font-bold tabular-nums shrink-0">
              {fiscalYear}년
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClearAllItems}
              className="h-9 px-3 rounded-2xl bg-[#FFEEF0] text-[#F04452] text-[12px] font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97] transition-all"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>비우기</span>
            </button>

            <button
              type="button"
              onClick={handleResetTemplate}
              className="h-9 px-3 rounded-2xl bg-[#F2F4F6] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97] transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>샘플 복원</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 px-4 rounded-2xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.97] transition-all"
            >
              <Printer className="w-4 h-4" />
              <span>인쇄 / PDF</span>
            </button>
          </div>
        </div>

        {/* 1. 문서 템플릿 전환 토글 */}
        <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setActiveTemplate('annual_budget')}
            className={`py-2.5 px-2.5 sm:px-4 rounded-xl text-[13px] sm:text-[13.5px] font-bold whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
              activeTemplate === 'annual_budget'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#4E5968] hover:text-[#191F28]'
            }`}
          >
            연간 예산안
          </button>

          <button
            type="button"
            onClick={() => setActiveTemplate('retreat_claim')}
            className={`py-2.5 px-2.5 sm:px-4 rounded-xl text-[13px] sm:text-[13.5px] font-bold whitespace-nowrap transition-all duration-150 active:scale-[0.97] ${
              activeTemplate === 'retreat_claim'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#4E5968] hover:text-[#191F28]'
            }`}
          >
            특별예산·청구서 ({claims.length})
          </button>
        </div>

        {/* 1-2. 복수 특별예산 청구서 선택 및 추가 바 */}
        {activeTemplate === 'retreat_claim' && (
          <div className="bg-[#F9FAFB] rounded-2xl p-2.5 sm:p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-[#4E5968] shrink-0">
                청구서 목록 ({claims.length}건)
              </span>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleDuplicateActiveClaim}
                  className="h-7 px-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E8EB] text-[#4E5968] text-[11.5px] font-semibold inline-flex items-center gap-1 whitespace-nowrap active:scale-[0.97]"
                >
                  <Copy className="w-3 h-3 shrink-0" />
                  <span>복제</span>
                </button>
                {claims.length > 1 && (
                  <button
                    type="button"
                    onClick={handleDeleteActiveClaim}
                    className="h-7 px-2.5 rounded-lg bg-[#FFEEF0] text-[#F04452] text-[11.5px] font-semibold inline-flex items-center gap-1 whitespace-nowrap active:scale-[0.97]"
                  >
                    <Trash2 className="w-3 h-3 shrink-0" />
                    <span>삭제</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddNewClaim}
                  className="h-7 px-2.5 rounded-lg bg-[#3182F6] text-[#FFFFFF] text-[11.5px] font-bold inline-flex items-center gap-1 whitespace-nowrap active:scale-[0.97]"
                >
                  <Plus className="w-3 h-3 shrink-0" />
                  <span>새 청구서</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {claims.map((claimDoc, idx) => {
                const isSelected = claimDoc.id === activeClaimDoc.id;
                const claimNet = Math.max(
                  0,
                  claimDoc.items
                    .filter((i) => i.entryType !== 'income')
                    .reduce((s, i) => s + (Number(i.amount) || 0), 0) -
                    (Number(claimDoc.selfBurdenAmount) || 0)
                );
                const shortLabel =
                  claimDoc.eventName?.trim() ||
                  claimDoc.title?.trim() ||
                  `특별예산 청구서 #${idx + 1}`;
                return (
                  <button
                    key={claimDoc.id || `claim-${idx}`}
                    type="button"
                    onClick={() =>
                      setActiveClaimId(claimDoc.id || `claim-${idx + 1}`)
                    }
                    className={`h-9 px-3 rounded-xl text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 max-w-[240px] transition-all active:scale-[0.97] ${
                      isSelected
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968] border border-[#E5E8EB] hover:bg-[#F2F4F6]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    <span className="truncate">{shortLabel}</span>
                    {claimNet > 0 && (
                      <span
                        className={`text-[11px] font-bold tabular-nums shrink-0 ${
                          isSelected ? 'text-[#93C5FD]' : 'text-[#3182F6]'
                        }`}
                      >
                        {formatWon(claimNet)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. 편집 / A4 미리보기 전환 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#F9FAFB] p-2 rounded-2xl">
          <div className="bg-[#E5E8EB] p-1 rounded-xl grid grid-cols-2 gap-1 flex-1">
            <button
              type="button"
              onClick={() => setScreenMode('card_editor')}
              className={`py-2 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] ${
                screenMode === 'card_editor'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>계층 편집</span>
            </button>

            <button
              type="button"
              onClick={() => setScreenMode('a4_preview')}
              className={`py-2 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] ${
                screenMode === 'a4_preview'
                  ? 'bg-[#FFFFFF] text-[#3182F6]'
                  : 'text-[#4E5968] hover:text-[#191F28]'
              }`}
            >
              <Eye className="w-4 h-4 shrink-0" />
              <span>A4 미리보기</span>
            </button>
          </div>

          {screenMode === 'card_editor' &&
            expenseGroups.length + incomeGroups.length > 0 && (
              <button
                type="button"
                onClick={toggleExpandAll}
                className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold shrink-0 hover:bg-[#E5E8EB] active:scale-[0.97]"
              >
                {allExpanded ? '분류 모두 접기' : '분류 모두 펼치기'}
              </button>
            )}

          {screenMode === 'a4_preview' && (
            <button
              type="button"
              onClick={() =>
                setA4ZoomMode((prev) => (prev === 'fit' ? 'actual' : 'fit'))
              }
              className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold flex items-center justify-center gap-1.5 shrink-0 active:scale-[0.97]"
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
      </section>

      {/* 토스트 알림 */}
      {feedback && (
        <div className="no-print max-w-[980px] mx-auto px-4 py-3 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-bold">
          {feedback}
        </div>
      )}

      {/* =====================================================================
          모드 A: 계층형 예산 계획 대시보드 & 트리 에디터
         ===================================================================== */}
      {screenMode === 'card_editor' && (
        <div className="no-print max-w-[980px] mx-auto space-y-5">
          {/* 1. 예산 총액 요약 + 사역별 비중 막대 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[12px] font-bold text-[#3182F6]">
                  {activeTemplate === 'retreat_claim'
                    ? '교회 실청구액 (지출 - 자체부담)'
                    : '총 편성 예산 요청액'}
                </span>
                <div className="text-[26px] sm:text-[30px] font-bold text-[#191F28] tabular-nums tracking-tight mt-0.5">
                  {formatWon(netChurchClaimAmount)}
                </div>
                <div className="text-[12.5px] font-medium text-[#4E5968] tabular-nums mt-0.5">
                  {numberToKoreanCurrency(netChurchClaimAmount)}
                </div>
              </div>

              <span className="px-3 py-1.5 rounded-full bg-[#F9FAFB] text-[#4E5968] text-[12px] font-bold tabular-nums shrink-0">
                {expenseGroups.length + incomeGroups.length}개 분류 ·{' '}
                {doc.items.length}건
              </span>
            </div>

            {/* 지출 / 수입 / 자체부담 요약 캡슐 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 tabular-nums">
              <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
                <div className="text-[11.5px] text-[#8B95A1]">지출 총액</div>
                <div className="text-[15.5px] font-bold text-[#191F28] mt-0.5">
                  {formatWon(totalExpense)}
                </div>
              </div>

              <div className="bg-[#F9FAFB] rounded-2xl p-3.5">
                <div className="text-[11.5px] text-[#8B95A1]">
                  자체 부담금 차감
                </div>
                <div className="text-[15.5px] font-bold text-[#4E5968] mt-0.5">
                  -{formatWon(doc.selfBurdenAmount)}
                </div>
              </div>

              <div className="bg-[#F9FAFB] rounded-2xl p-3.5 col-span-2 sm:col-span-1">
                <div className="text-[11.5px] text-[#8B95A1]">
                  별도 수입 항목 합계
                </div>
                <div className="text-[15.5px] font-bold text-[#3182F6] mt-0.5">
                  +{formatWon(totalIncome)}
                </div>
              </div>
            </div>

            {/* 1차 사역별 지출 비중 스택 바 */}
            {expenseGroups.length > 0 && totalExpense > 0 && (
              <div className="space-y-2 pt-1">
                <div className="h-3 rounded-full bg-[#F2F4F6] overflow-hidden flex gap-0.5">
                  {expenseGroups.map((g) => (
                    <div
                      key={g.key}
                      title={`${g.category}: ${formatWon(g.subtotal)} (${g.sharePercent}%)`}
                      style={{
                        width: `${Math.max(2, g.sharePercent)}%`,
                        backgroundColor: g.color,
                      }}
                      className="h-full transition-all duration-300"
                    />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] tabular-nums">
                  {expenseGroups.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() =>
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [g.key]: false,
                        }))
                      }
                      className="flex items-center gap-1.5 text-[#4E5968] hover:text-[#191F28]"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="font-semibold">{g.category}</span>
                      <span className="text-[#8B95A1]">{g.sharePercent}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 2. 지출 예산 계층 트리 */}
          {renderSection('expense', expenseGroups, totalExpense)}

          {/* 3. 수입 예산 계층 트리 */}
          {renderSection('income', incomeGroups, totalIncome)}

          {/* 4. 문서 개요 · 자체부담금 · 수령계좌 설정 아코디언 */}
          <section className="bg-[#FFFFFF] rounded-3xl p-4 sm:p-5 space-y-3">
            <button
              type="button"
              onClick={() => setIsDocMetaExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <SlidersHorizontal className="w-4 h-4 text-[#3182F6] shrink-0" />
                <span className="text-[14px] font-bold text-[#191F28] break-words [word-break:keep-all]">
                  문서 정보 · 자체 부담금 · 수령 계좌 설정
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-xl bg-[#F2F4F6] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1 shrink-0">
                {isDocMetaExpanded ? (
                  <>
                    <span>접기</span>
                    <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                  </>
                ) : (
                  <>
                    <span>열기</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </>
                )}
              </span>
            </button>

            {isDocMetaExpanded && (
              <div className="space-y-4 pt-3 border-t border-[#E5E8EB]">
                {/* 자체 부담금 */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-[#F9FAFB] p-3.5 rounded-2xl">
                  <div className="sm:col-span-7">
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      자체 부담금 내역
                    </label>
                    <input
                      type="text"
                      value={doc.selfBurdenNote}
                      onChange={(e) =>
                        handleFieldChange('selfBurdenNote', e.target.value)
                      }
                      placeholder="예: 참가자 등록비 수입 (25,000원 × 40명)"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
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
                        className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#FFFFFF] text-right text-[14.5px] font-bold text-[#191F28] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                      />
                      <span className="absolute right-3 text-[12.5px] font-bold text-[#4E5968] pointer-events-none">
                        원
                      </span>
                    </div>
                  </div>
                </div>

                {/* 문서 기본정보 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      문서 제목
                    </label>
                    <input
                      type="text"
                      value={doc.title}
                      onChange={(e) =>
                        handleFieldChange('title', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] font-semibold text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      청구 부서
                    </label>
                    <input
                      type="text"
                      value={doc.department}
                      onChange={(e) =>
                        handleFieldChange('department', e.target.value)
                      }
                      placeholder={settings.departmentName}
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      사역/행사명
                    </label>
                    <input
                      type="text"
                      value={doc.eventName}
                      onChange={(e) =>
                        handleFieldChange('eventName', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      일시 / 기간
                    </label>
                    <input
                      type="text"
                      value={doc.eventPeriod}
                      onChange={(e) =>
                        handleFieldChange('eventPeriod', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      대상 / 인원
                    </label>
                    <input
                      type="text"
                      value={doc.participants}
                      onChange={(e) =>
                        handleFieldChange('participants', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                    />
                  </div>
                </div>

                {/* 계좌 및 청구인 */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      입금 은행
                    </label>
                    <input
                      type="text"
                      value={doc.bankName}
                      onChange={(e) =>
                        handleFieldChange('bankName', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] font-semibold text-[#191F28] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      계좌 번호
                    </label>
                    <input
                      type="text"
                      value={doc.accountNumber}
                      onChange={(e) =>
                        handleFieldChange('accountNumber', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] font-semibold text-[#191F28] tabular-nums focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      예금주
                    </label>
                    <input
                      type="text"
                      value={doc.accountHolder}
                      onChange={(e) =>
                        handleFieldChange('accountHolder', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] text-[#191F28] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4E5968] mb-1">
                      청구인 성명
                    </label>
                    <input
                      type="text"
                      value={doc.proposerName}
                      onChange={(e) =>
                        handleFieldChange('proposerName', e.target.value)
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F9FAFB] text-[13px] font-bold text-[#191F28] focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 5. 하단 고정 미리보기/인쇄 바 */}
          <div className="sticky sticky-bottom-safe z-20 bg-[#191F28] text-[#FFFFFF] rounded-2xl p-3 sm:p-3.5 flex items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-[#8B95A1] truncate">
                실청구/요청 총액 ({doc.items.length}건)
              </div>
              <div className="text-[15.5px] sm:text-[16px] font-bold tabular-nums truncate">
                {formatWon(netChurchClaimAmount)}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setScreenMode('a4_preview')}
                className="h-10 px-3 sm:px-3.5 rounded-xl bg-[#FFFFFF]/15 text-[#FFFFFF] text-[12.5px] font-semibold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97]"
              >
                <Eye className="w-4 h-4 shrink-0" />
                <span className="sm:hidden">미리보기</span>
                <span className="hidden sm:inline">A4 미리보기</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="h-10 px-3 sm:px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-[0.97]"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span className="sm:hidden">인쇄</span>
                <span className="hidden sm:inline">인쇄/PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          모드 B & 실제 인쇄 DOM: 1차 구분별 그룹핑 + 소계 포함 A4 예산서
         ===================================================================== */}
      <div
        role={a4ZoomMode === 'actual' ? 'region' : undefined}
        tabIndex={a4ZoomMode === 'actual' ? 0 : undefined}
        aria-label={a4ZoomMode === 'actual' ? '예산서 A4 미리보기' : undefined}
        className={`max-w-[980px] mx-auto print-force-show ${
          screenMode === 'card_editor' ? 'hidden' : 'block'
        } ${
          a4ZoomMode === 'actual'
            ? 'overflow-x-auto max-w-full print:overflow-visible'
            : ''
        }`}
      >
        <A4ScalePreview zoomMode={a4ZoomMode}>
          <article className="a4-page a4-page-flow flex flex-col justify-between">
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

              {/* 한글 금액 강조 박스 (A4 인쇄 규격 고정: 모바일 뷰포트 분기 배제) */}
              <div className="mt-4 bg-[#F9FAFB] border-2 border-[#191F28] rounded-xl p-3.5 flex flex-row items-center justify-between gap-2">
                <div className="text-[12.5px] font-bold text-[#4E5968]">
                  {activeTemplate === 'retreat_claim'
                    ? '■ 교회 재정 실청구 금액 (총 소요예산 - 자체 부담금)'
                    : '■ 교회 본부 예산 편성 요청 총액'}
                </div>
                <div className="text-[17px] font-bold text-[#191F28] tabular-nums tracking-tight break-words [word-break:keep-all]">
                  {numberToKoreanCurrency(netChurchClaimAmount)}
                </div>
              </div>

              {/* 1. 사역 및 청구 개요 */}
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

              {/* 2. 계층형(1차 구분별 그룹 + 소계) 산출 기초 테이블 */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11.5px] font-bold text-[#191F28]">
                    2. 분류별 예산 산출 기초 명세 (단가 × 수량 × 횟수)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddBlankRowForA4}
                    className="no-print px-3 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>빈 항목 행 추가</span>
                  </button>
                </div>

                <table className="w-full border-collapse border border-[#191F28] text-[11.5px] tabular-nums table-fixed">
                  <thead>
                    <tr className="bg-[#F2F4F6] font-bold text-[#191F28] text-center">
                      <th className="border border-[#191F28] py-1.5 px-2 w-[16%]">
                        1차 분류
                      </th>
                      <th className="border border-[#191F28] py-1.5 px-2 w-[26%] text-left">
                        2차 · 3차 세부 항목
                      </th>
                      <th className="border border-[#191F28] py-1.5 px-2 w-[28%] text-left">
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
                    {expenseGroups.map((group) => (
                      <React.Fragment key={group.key}>
                        {group.items.length >= 2 && (
                          <tr className="bg-[#F2F4F6]/80 font-bold text-[11px] text-[#191F28] print-keep-with-next">
                            <td
                              colSpan={3}
                              className="border border-[#191F28] py-1.5 px-2.5 text-left"
                            >
                              ■ {group.category}{' '}
                              <span className="font-normal text-[#4E5968]">
                                ({group.items.length}건 · 비중 {group.sharePercent}%)
                              </span>
                            </td>
                            <td className="border border-[#191F28] py-1.5 px-2 text-right font-bold text-[#191F28]">
                              {formatWon(group.subtotal)}
                            </td>
                            <td className="border border-[#191F28] py-1.5 px-2 text-center text-[10px] text-[#8B95A1]">
                              1차 소계
                            </td>
                          </tr>
                        )}

                        {group.subGroups.map((subGroup) => (
                          <React.Fragment key={subGroup.key}>
                            {subGroup.items.length >= 2 && (
                              <tr className="bg-[#F9FAFB] text-[10.5px] font-semibold text-[#4E5968] print-keep-with-next">
                                <td
                                  colSpan={3}
                                  className="border border-[#E5E8EB] border-l-[#191F28] py-1 px-3 text-left"
                                >
                                  └ {subGroup.subCategory}{' '}
                                  <span className="font-normal text-[#8B95A1]">
                                    ({subGroup.items.length}건)
                                  </span>
                                </td>
                                <td className="border border-[#E5E8EB] py-1 px-2 text-right font-bold text-[#191F28]">
                                  소계 {formatWon(subGroup.subtotal)}
                                </td>
                                <td className="border border-[#E5E8EB] border-r-[#191F28] py-1 px-2 text-center text-[9.5px] text-[#8B95A1]">
                                  2차 소계
                                </td>
                              </tr>
                            )}

                            {subGroup.items.map((item) => {
                              const hasDetail = Boolean(
                                item.detailCategory?.trim()
                              );
                              return (
                                <tr key={item.id}>
                                  <td className="border border-[#E5E8EB] border-l-[#191F28] bg-[#F9FAFB]/50 p-1.5 text-center font-semibold text-[#4E5968] align-top whitespace-pre-wrap break-words [word-break:keep-all]">
                                    <div>{group.category}</div>
                                    {group.items.length === 1 && (
                                      <div className="text-[9.5px] font-normal text-[#8B95A1] mt-0.5">
                                        ({group.sharePercent}%)
                                      </div>
                                    )}
                                  </td>
                                  <td className="border border-[#E5E8EB] p-1.5 align-top space-y-0.5">
                                    <AutoResizeTextarea
                                      value={item.subCategory || ''}
                                      placeholder="2차 분류"
                                      onChange={(e) =>
                                        handleItemChange(
                                          item.id,
                                          'subCategory',
                                          e.target.value
                                        )
                                      }
                                      className={`focus:bg-[#F9FAFB] rounded px-1 py-0.5 ${
                                        hasDetail
                                          ? 'text-[10.5px] font-semibold text-[#4E5968]'
                                          : 'font-bold text-[#191F28]'
                                      }`}
                                    />
                                    {hasDetail && (
                                      <div className="flex items-start gap-1 pl-1">
                                        <span className="text-[#3182F6] font-bold leading-snug pt-0.5 shrink-0">
                                          ›
                                        </span>
                                        <AutoResizeTextarea
                                          value={item.detailCategory || ''}
                                          placeholder="3차 분류"
                                          onChange={(e) =>
                                            handleItemChange(
                                              item.id,
                                              'detailCategory',
                                              e.target.value || undefined
                                            )
                                          }
                                          className="font-bold text-[#191F28] focus:bg-[#F9FAFB] rounded px-1 py-0.5"
                                        />
                                      </div>
                                    )}
                                    {(item.itemName ||
                                      (!item.subCategory && !hasDetail)) && (
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
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </React.Fragment>
                    ))}

                    {/* 수입 예산 항목이 있는 경우 별도 구분 출력 (rowSpan 없이 페이지 분할 안전) */}
                    {incomeGroups.length > 0 && (
                      <>
                        <tr className="bg-[#E8F3FF]/70 font-bold text-[11px] text-[#1B64DA] print-keep-with-next">
                          <td
                            colSpan={3}
                            className="border border-[#191F28] py-1.5 px-2.5 text-left"
                          >
                            [별도 수입 예산 항목]
                          </td>
                          <td className="border border-[#191F28] py-1.5 px-2 text-right font-bold text-[#1B64DA]">
                            +{formatWon(totalIncome)}
                          </td>
                          <td className="border border-[#191F28] py-1.5 px-2 text-center text-[10px] text-[#1B64DA]">
                            수입 합계
                          </td>
                        </tr>
                        {incomeGroups.map((group) => (
                          <React.Fragment key={group.key}>
                            {group.subGroups.map((subGroup) => (
                              <React.Fragment key={subGroup.key}>
                                {subGroup.items.length >= 2 && (
                                  <tr className="bg-[#F9FAFB] text-[10.5px] font-semibold text-[#4E5968] print-keep-with-next">
                                    <td
                                      colSpan={3}
                                      className="border border-[#E5E8EB] border-l-[#191F28] py-1 px-3 text-left"
                                    >
                                      └ {subGroup.subCategory}{' '}
                                      <span className="font-normal text-[#8B95A1]">
                                        ({subGroup.items.length}건)
                                      </span>
                                    </td>
                                    <td className="border border-[#E5E8EB] py-1 px-2 text-right font-bold text-[#3182F6]">
                                      +{formatWon(subGroup.subtotal)}
                                    </td>
                                    <td className="border border-[#E5E8EB] border-r-[#191F28] py-1 px-2 text-center text-[9.5px] text-[#8B95A1]">
                                      2차 소계
                                    </td>
                                  </tr>
                                )}
                                {subGroup.items.map((item) => (
                                  <tr key={item.id}>
                                    <td className="border border-[#E5E8EB] border-l-[#191F28] bg-[#F9FAFB]/50 p-1.5 text-center font-semibold text-[#1B64DA] align-top whitespace-pre-wrap break-words [word-break:keep-all]">
                                      {group.category}
                                    </td>
                                    <td className="border border-[#E5E8EB] p-1.5 align-top whitespace-pre-wrap break-words [word-break:keep-all]">
                                      <div
                                        className={
                                          item.detailCategory
                                            ? 'text-[10.5px] font-semibold text-[#4E5968]'
                                            : 'font-bold text-[#191F28]'
                                        }
                                      >
                                        {item.subCategory || item.itemName}
                                      </div>
                                      {item.detailCategory && (
                                        <div className="font-bold text-[#191F28]">
                                          › {item.detailCategory}
                                        </div>
                                      )}
                                      {item.subCategory && item.itemName && (
                                        <div className="text-[10.5px] text-[#4E5968]">
                                          {item.itemName}
                                        </div>
                                      )}
                                    </td>
                                    <td className="border border-[#E5E8EB] p-1.5 align-top text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all]">
                                      {item.formula}
                                    </td>
                                    <td className="border border-[#E5E8EB] p-1.5 align-top text-right font-bold text-[#3182F6]">
                                      +{formatNumber(item.amount)}
                                    </td>
                                    <td className="border border-[#E5E8EB] border-r-[#191F28] p-1.5 align-top text-center text-[11px] text-[#4E5968] whitespace-pre-wrap break-words [word-break:keep-all]">
                                      {item.note || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            ))}
                          </React.Fragment>
                        ))}
                      </>
                    )}

                    {/* 합계 및 자체부담금 / 교회 재정 청구액 */}
                    <tr className="bg-[#F9FAFB] border-t-2 border-[#191F28] font-semibold">
                      <td
                        colSpan={3}
                        className="border border-[#191F28] py-2 px-3 text-right text-[#4E5968]"
                      >
                        총 지출 소요 예산 합계 (A)
                      </td>
                      <td className="border border-[#191F28] py-2 px-2 text-right font-bold text-[#191F28]">
                        {formatWon(totalExpense)}
                      </td>
                      <td className="border border-[#191F28] py-2 px-2 text-center text-[10.5px] text-[#8B95A1]">
                        {expenseGroups.length}개 분류
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
                        <div className="flex items-center justify-end gap-0.5 w-full min-w-0 font-semibold text-[#4E5968]">
                          <span className="shrink-0">-</span>
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
                            className="w-full min-w-0 flex-1 text-right bg-transparent focus:outline-none focus:bg-[#F9FAFB] rounded px-0.5 py-0.5 tabular-nums"
                          />
                          <span className="shrink-0">원</span>
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

              {/* 3. 입금 계좌 정보 */}
              <div className="mt-4 print-avoid-break">
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

            {/* 하단 청구 문구 및 청구인 서명란 */}
            <div className="pt-4 mt-4 border-t border-[#191F28] space-y-4 print-avoid-break">
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
