import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  ACCOUNT_LABELS,
  getSuggestedSubCategories,
  LedgerAccount,
  MOKJANG_SUBTYPE_LABELS,
  MokjangExpenseSubType,
  MokjangGroup,
  PAYMENT_METHODS,
  PaymentMethod,
  ProcessedTransaction,
  ReceiptMetadata,
  Transaction,
  TransactionType,
} from '../types/finance';
import { compressReceiptImage } from '../utils/imageCompressor';
import { formatNumber } from '../utils/koreanCurrency';
import { analyzeReceiptWithGemini } from '../utils/receiptAiAnalyzer';
import { CategoryBudgetAllocation } from '../utils/syncManager';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { TdsDialog } from './TdsDialog';

interface TransactionBottomSheetProps {
  open: boolean;
  onClose: () => void;
  initialTransaction?: ProcessedTransaction | null;
  defaultType?: TransactionType;
  defaultYearMonth: string;
  defaultAccount: LedgerAccount;
  presetMokjangId?: string;
  presetMokjangSubType?: MokjangExpenseSubType;
  autoTriggerCamera?: boolean;
  geminiApiKey: string;
  geminiModel: string;
  onOpenGeminiSettings: () => void;
  incomeCategories: string[];
  expenseCategories: string[];
  categoryAllocations?: Record<string, CategoryBudgetAllocation>;
  mokjangs: MokjangGroup[];
  onAddCustomCategory: (
    type: TransactionType,
    newCategory: string,
    monthlyBudgetAmount?: number
  ) => void;
  onSave: (tx: Transaction) => void;
  onDelete?: (id: string) => void;
}

export const TransactionBottomSheet: React.FC<TransactionBottomSheetProps> = ({
  open,
  onClose,
  initialTransaction,
  defaultType = 'expense',
  defaultYearMonth,
  defaultAccount,
  presetMokjangId,
  presetMokjangSubType,
  autoTriggerCamera = false,
  geminiApiKey,
  geminiModel,
  onOpenGeminiSettings,
  incomeCategories,
  expenseCategories,
  categoryAllocations = {},
  mokjangs,
  onAddCustomCategory,
  onSave,
  onDelete,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const submitBtnRef = useRef<HTMLButtonElement | null>(null);

  const [type, setType] = useState<TransactionType>('expense');
  const [account, setAccount] = useState<LedgerAccount>('general');
  const [date, setDate] = useState<string>(`${defaultYearMonth}-01`);
  const [amountStr, setAmountStr] = useState<string>('');
  const [category, setCategory] = useState<string>(
    expenseCategories[0] || '예배/양육비'
  );
  const [subCategory, setSubCategory] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('체크카드');
  const [title, setTitle] = useState<string>('');
  const [memo, setMemo] = useState<string>('');
  const [mokjangId, setMokjangId] = useState<string>('');
  const [mokjangSubType, setMokjangSubType] =
    useState<MokjangExpenseSubType>('fellowship');
  const [receiptImage, setReceiptImage] = useState<string | undefined>(
    undefined
  );
  const [receiptDriveUrl, setReceiptDriveUrl] = useState<string | undefined>(
    undefined
  );
  const [receiptMeta, setReceiptMeta] = useState<ReceiptMetadata | undefined>(
    undefined
  );

  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  const [isAnalyzingAi, setIsAnalyzingAi] = useState<boolean>(false);
  const [aiFilledNotice, setAiFilledNotice] = useState<string>('');
  const [previewScanMode, setPreviewScanMode] = useState<boolean>(false);
  const [isAddingCategory, setIsAddingCategory] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [newCategoryMonthlyBudgetStr, setNewCategoryMonthlyBudgetStr] =
    useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setAiFilledNotice('');
    setIsAddingCategory(false);
    setNewCategoryName('');
    setNewCategoryMonthlyBudgetStr('');

    if (initialTransaction) {
      setType(initialTransaction.type);
      setAccount(initialTransaction.account);
      setDate(initialTransaction.date);
      setAmountStr(formatNumber(initialTransaction.amount));
      setCategory(initialTransaction.category);
      setSubCategory(initialTransaction.subCategory || '');
      setPaymentMethod(initialTransaction.paymentMethod);
      setTitle(initialTransaction.title);
      setMemo(initialTransaction.memo);
      setMokjangId(initialTransaction.mokjangId || '');
      setMokjangSubType(initialTransaction.mokjangSubType || 'fellowship');
      setReceiptImage(initialTransaction.receiptImage);
      setReceiptDriveUrl(initialTransaction.receiptDriveUrl);
      setReceiptMeta(initialTransaction.receiptMeta);
    } else {
      const todayIso = new Date().toISOString().slice(0, 10);
      const defaultDate = todayIso.startsWith(defaultYearMonth)
        ? todayIso
        : `${defaultYearMonth}-15`;

      const initialTxType = defaultType;
      setType(initialTxType);
      setAccount(defaultAccount);
      setDate(defaultDate);
      setAmountStr('');
      setTitle('');
      setMemo('');
      setMokjangId(presetMokjangId || '');
      setMokjangSubType(presetMokjangSubType || 'fellowship');

      if (initialTxType === 'income') {
        const defaultIncCat =
          incomeCategories[1] || incomeCategories[0] || '교회지원금(예산)';
        setCategory(defaultIncCat);
        setSubCategory('월 정기예산 수령');
        setPaymentMethod('계좌이체');
      } else {
        setPaymentMethod('체크카드');
        if (presetMokjangSubType === 'visitation') {
          const visitCat = expenseCategories.find((c) => c.includes('심방'));
          setCategory(visitCat || expenseCategories[0] || '심방/축하/조의');
          setSubCategory('심방·선물·꽃');
        } else if (presetMokjangId) {
          setCategory(expenseCategories[0] || '간식/다과비');
          setSubCategory('식비·간식/다과');
        } else {
          setCategory(expenseCategories[0] || '예배/양육비');
          setSubCategory('식비·간식/다과');
        }
      }

      setReceiptImage(undefined);
      setReceiptDriveUrl(undefined);
      setReceiptMeta(undefined);

      if (autoTriggerCamera && initialTxType === 'expense') {
        setTimeout(() => {
          fileInputRef.current?.click();
        }, 180);
      }
    }
  }, [
    open,
    initialTransaction,
    defaultType,
    defaultYearMonth,
    defaultAccount,
    presetMokjangId,
    presetMokjangSubType,
    autoTriggerCamera,
    expenseCategories,
    incomeCategories,
  ]);

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    if (nextType === 'income') {
      const nextCat = incomeCategories.includes(category)
        ? category
        : incomeCategories[1] || incomeCategories[0] || '교회지원금(예산)';
      setCategory(nextCat);
      const nextSubs = getSuggestedSubCategories('income', nextCat, []);
      setSubCategory(nextSubs[0] || '');
      setPaymentMethod('계좌이체');
      setMokjangId('');
    } else {
      const nextCat = expenseCategories.includes(category)
        ? category
        : expenseCategories[0] || '예배/양육비';
      setCategory(nextCat);
      const budgetItems = categoryAllocations[nextCat]?.itemNames || [];
      const nextSubs = getSuggestedSubCategories(
        'expense',
        nextCat,
        budgetItems
      );
      setSubCategory(nextSubs[0] || '식비·간식/다과');
      setPaymentMethod('체크카드');
    }
  };

  const handleCategorySelect = (nextCat: string) => {
    setCategory(nextCat);
    const budgetItems =
      type === 'expense' ? categoryAllocations[nextCat]?.itemNames || [] : [];
    const nextSubs = getSuggestedSubCategories(type, nextCat, budgetItems);
    if (!subCategory || !nextSubs.includes(subCategory)) {
      setSubCategory(nextSubs[0] || '');
    }
  };

  const parseRawAmount = (val: string): number => {
    const digits = val.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = parseRawAmount(e.target.value);
    setAmountStr(num > 0 ? formatNumber(num) : '');
  };

  const handleQuickAddAmount = (delta: number) => {
    const current = parseRawAmount(amountStr);
    const next = current + delta;
    setAmountStr(formatNumber(next));
  };

  // Gemini AI 영수증 분석 및 자동 채우기 + 등록 버튼 코앞으로 스크롤/포커스
  const runGeminiExtraction = async (dataUrl: string) => {
    if (!geminiApiKey.trim()) return;

    setIsAnalyzingAi(true);
    setErrorMsg('');
    setAiFilledNotice('');

    try {
      const result = await analyzeReceiptWithGemini({
        imageDataUrl: dataUrl,
        apiKey: geminiApiKey,
        model: geminiModel || 'gemini-3-flash-preview',
        expenseCategories,
        mokjangs,
        defaultYearMonth,
      });

      setType('expense');
      if (result.amount > 0) {
        setAmountStr(formatNumber(result.amount));
      }
      if (result.date) {
        setDate(result.date);
      }
      if (result.title) {
        setTitle(result.title);
      }
      if (result.memo) {
        setMemo(result.memo);
      }
      if (result.category) {
        setCategory(result.category);
      }
      if (result.subCategory) {
        setSubCategory(result.subCategory);
      }
      if (result.paymentMethod) {
        setPaymentMethod(result.paymentMethod);
      }
      if (result.account) {
        setAccount(result.account);
      }
      if (result.mokjangId && !presetMokjangId) {
        setMokjangId(result.mokjangId);
      }
      if (result.mokjangSubType && !presetMokjangSubType) {
        setMokjangSubType(result.mokjangSubType);
      }

      setAiFilledNotice(result.summaryComment);

      setTimeout(() => {
        submitBtnRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
        submitBtnRef.current?.focus();
      }, 150);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'AI 영수증 분석 중 오류가 발생했습니다. 직접 입력하거나 다시 시도해 주세요.'
      );
    } finally {
      setIsAnalyzingAi(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressing(true);
    setErrorMsg('');
    try {
      const compressed = await compressReceiptImage(file, 1200, 0.8);
      setReceiptImage(compressed.dataUrl);
      setReceiptMeta(compressed.meta);
      setIsCompressing(false);

      if (type === 'expense' && geminiApiKey.trim()) {
        await runGeminiExtraction(compressed.dataUrl);
      }
    } catch (err) {
      setIsCompressing(false);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : '이미지 압축 중 오류가 발생했습니다.'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmNewCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    const monthlyBudget = parseRawAmount(newCategoryMonthlyBudgetStr);
    onAddCustomCategory(
      type,
      trimmed,
      type === 'expense' && monthlyBudget > 0 ? monthlyBudget : undefined
    );
    setCategory(trimmed);
    setNewCategoryName('');
    setNewCategoryMonthlyBudgetStr('');
    setIsAddingCategory(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseRawAmount(amountStr);
    if (numericAmount <= 0) {
      setErrorMsg('금액을 1원 이상 입력해 주세요.');
      return;
    }
    if (!title.trim()) {
      setErrorMsg(
        type === 'income'
          ? '적요(입금 출처 또는 수입 내역명)를 입력해 주세요.'
          : '적요(사용처 또는 지출 내역명)를 입력해 주세요.'
      );
      return;
    }

    const savedTx: Transaction = {
      id: initialTransaction?.id || `tx-${Date.now()}`,
      date,
      type,
      account,
      category,
      subCategory: subCategory.trim() || undefined,
      title: title.trim(),
      memo: memo.trim(),
      amount: numericAmount,
      paymentMethod,
      mokjangId: type === 'expense' && mokjangId ? mokjangId : undefined,
      mokjangSubType:
        type === 'expense' && mokjangId ? mokjangSubType : undefined,
      receiptImage,
      receiptDriveUrl,
      receiptMeta,
      createdAt: initialTransaction?.createdAt || new Date().toISOString(),
    };

    onSave(savedTx);
    onClose();
  };

  const categories = type === 'income' ? incomeCategories : expenseCategories;
  const currentBudgetItemNames =
    type === 'expense' ? categoryAllocations[category]?.itemNames || [] : [];
  const suggestedSubCategories = getSuggestedSubCategories(
    type,
    category,
    currentBudgetItemNames
  );
  const hasGeminiKey = Boolean(geminiApiKey.trim());

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title={
        initialTransaction
          ? '거래 내역 및 2단계 회계 분류 상세'
          : type === 'income'
            ? '💰 수입 내역 기록하기 (+)'
            : '🧾 지출 내역 기록 & AI 영수증 스캔 (-)'
      }
      subtitle={
        initialTransaction?.evidenceNo
          ? `자동 부여 증빙번호: ${initialTransaction.evidenceNo} (A4 장부·영수증철 1:1 매칭)`
          : type === 'income'
            ? '교회 본부 지원금, 수련회 등록비, 월회비, 찬조금 등 수입을 2단계(수입원 → 세부명목)로 기록합니다'
            : '1차 사역 목적(항)과 2차 지출 품목(세목: 식비·간식, 교재, 강사비 등)으로 정확하게 분류합니다'
      }
      variant="bottom-sheet"
    >
      <form onSubmit={handleSubmit} className="space-y-5 pt-1">
        {/* =================================================================
            0. 최상단 지출(-) / 수입(+) 모드 전환 탭
           ================================================================= */}
        <div className="bg-[#F2F4F6] p-1.5 rounded-2xl grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`py-3 rounded-xl text-[14.5px] font-bold transition-all duration-150 ease-out active:scale-[0.97] ${
              type === 'expense'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#8B95A1] hover:text-[#4E5968]'
            }`}
          >
            ➖ 지출 내역 기록 (영수증/사역비)
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`py-3 rounded-xl text-[14.5px] font-bold transition-all duration-150 ease-out active:scale-[0.97] ${
              type === 'income'
                ? 'bg-[#FFFFFF] text-[#3182F6]'
                : 'text-[#8B95A1] hover:text-[#4E5968]'
            }`}
          >
            ➕ 수입 내역 기록 (지원금/회비/등록비)
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* =================================================================
            1. 지출 모드일 때: 최상단 Camera-First 영수증 AI 스캐너
           ================================================================= */}
        {type === 'expense' && (
          <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  AI 영수증 스캔
                </span>
                <span className="text-[14px] font-bold text-[#191F28]">
                  영수증 사진 찍기 / 업로드
                </span>
              </div>

              {!hasGeminiKey ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGeminiSettings();
                  }}
                  className="px-3 py-1 rounded-full bg-[#FFEEF0] text-[#F04452] text-[11.5px] font-bold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                >
                  <KeyRound className="w-3 h-3" />
                  Gemini 계정 연결하기
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGeminiSettings();
                  }}
                  className="text-[11.5px] font-semibold text-[#3182F6] flex items-center gap-1 hover:underline"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>AI 고정 모델: {geminiModel}</span>
                </button>
              )}
            </div>

            {isAnalyzingAi && (
              <div className="p-4 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin shrink-0 text-[#3182F6]" />
                <div>
                  <div className="text-[14px] font-bold">
                    ✨ Gemini AI가 영수증을 읽고 있어요...
                  </div>
                  <div className="text-[12px] text-[#4E5968] mt-0.5">
                    가맹점명, 결제금액, 거래일자, 품목별 산출근거와 사역/품목 분류를 자동으로 채워줍니다.
                  </div>
                </div>
              </div>
            )}

            {receiptImage ? (
              <div className="space-y-3">
                <div className="relative rounded-2xl bg-[#FFFFFF] p-3 flex flex-col items-center">
                  <img
                    src={receiptImage}
                    alt="영수증 미리보기"
                    className={`max-h-60 w-auto object-contain rounded-xl ${
                      previewScanMode ? 'receipt-scan-filter' : ''
                    }`}
                  />
                  {receiptMeta && (
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[12px] text-[#8B95A1] tabular-nums">
                      <span>
                        해상도 {receiptMeta.width}×{receiptMeta.height}px
                      </span>
                      <span>·</span>
                      <span>압축 용량 약 {receiptMeta.sizeKb}KB</span>
                      {receiptDriveUrl && (
                        <>
                          <span>·</span>
                          <a
                            href={receiptDriveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#1B64DA] font-semibold inline-flex items-center gap-0.5 hover:underline"
                          >
                            Drive 원본 열기 <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {hasGeminiKey && (
                      <button
                        type="button"
                        disabled={isAnalyzingAi}
                        onClick={() => runGeminiExtraction(receiptImage)}
                        className="px-3 py-2 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        AI로 내용 다시 추출
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setPreviewScanMode((prev) => !prev)}
                      className={`px-3 py-2 rounded-xl text-[12px] font-semibold transition-all duration-150 active:scale-[0.97] ${
                        previewScanMode
                          ? 'bg-[#191F28] text-[#FFFFFF]'
                          : 'bg-[#E5E8EB] text-[#4E5968]'
                      }`}
                    >
                      ✨ 스캔 보정 {previewScanMode ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      사진 변경
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptImage(undefined);
                        setReceiptMeta(undefined);
                        setReceiptDriveUrl(undefined);
                        setAiFilledNotice('');
                      }}
                      className="px-3 py-2 rounded-xl bg-[#FFEEF0] text-[#F04452] text-[12px] font-semibold active:scale-[0.97] transition-all duration-150"
                    >
                      제거
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCompressing || isAnalyzingAi}
                className="w-full py-5 px-4 rounded-2xl bg-[#FFFFFF] hover:bg-[#E8F3FF]/50 text-center flex flex-col items-center justify-center gap-1.5 transition-all duration-150 ease-out active:scale-[0.97]"
              >
                <div className="w-11 h-11 rounded-full bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center">
                  <Camera className="w-5 h-5" />
                </div>
                <div className="text-[14.5px] font-bold text-[#191F28]">
                  {isCompressing
                    ? '영수증 고화질 압축 처리 중...'
                    : '📸 여기를 눌러 영수증 촬영 또는 사진 선택'}
                </div>
                <div className="text-[12px] text-[#4E5968]">
                  {hasGeminiKey
                    ? '사진을 올리는 즉시 Gemini AI가 금액·가맹점·산출근거를 자동으로 채워줍니다'
                    : '영수증 없이 수기로만 기록할 경우 아래 입력란에 바로 입력하세요'}
                </div>
              </button>
            )}
          </div>
        )}

        {/* =================================================================
            2. 금액 입력 영역
           ================================================================= */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[13px] font-bold text-[#4E5968]">
              {type === 'income' ? '💰 입금 / 수입 금액' : '💸 결제 / 지출 금액'}
            </label>
            <div className="flex gap-1.5">
              {(type === 'income'
                ? [50000, 100000, 500000, 1000000]
                : [10000, 50000, 100000]
              ).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => handleQuickAddAmount(unit)}
                  className="px-2.5 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold tabular-nums active:scale-[0.97] transition-all duration-150"
                >
                  +{unit >= 10000 ? `${unit / 10000}만` : unit}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-[24px] font-bold ${
                type === 'income' ? 'text-[#3182F6]' : 'text-[#191F28]'
              }`}
            >
              {type === 'income' ? '+' : '-'}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={handleAmountChange}
              placeholder="0"
              className={`w-full bg-transparent text-[28px] font-bold tabular-nums focus:outline-none placeholder:text-[#8B95A1]/40 ${
                type === 'income' ? 'text-[#3182F6]' : 'text-[#191F28]'
              }`}
            />
            <span className="text-[20px] font-bold text-[#191F28] shrink-0">
              원
            </span>
          </div>
        </div>

        {/* 3. 통장 계정 & 거래일자 & 결제/입금 수단 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              회계 통장 계정
            </label>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value as LedgerAccount)}
              className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-medium text-[#191F28] focus:outline-none focus:bg-[#F2F4F6]"
            >
              <option value="general">{ACCOUNT_LABELS.general}</option>
              <option value="retreat">{ACCOUNT_LABELS.retreat}</option>
              <option value="mission">{ACCOUNT_LABELS.mission}</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              {type === 'income' ? '입금 일자' : '지출 일자'}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-medium text-[#191F28] tabular-nums focus:outline-none focus:bg-[#F2F4F6]"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              {type === 'income' ? '입금 수단' : '결제 수단'}
            </label>
            <select
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value as PaymentMethod)
              }
              className="w-full h-11 px-3.5 rounded-2xl bg-[#F9FAFB] text-[14px] font-medium text-[#191F28] focus:outline-none focus:bg-[#F2F4F6]"
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* =================================================================
            4. [핵심] 2단계 회계 분류 시스템:
               - 1차(관/항): 어떤 사역 목적 / 어떤 수입원인가?
               - 2차(세목): 무엇을 구매했는가(간식/교재/강사비 등) / 어떤 세부 명목인가?
           ================================================================= */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-4">
          {/* Step A: 1차 관/항 (사역 목적 또는 수입원) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[13px] font-bold text-[#191F28] flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#3182F6]" />
                <span>
                  {type === 'income'
                    ? '1차 분류 (관/항 · 어디서 들어온 수입인가요?)'
                    : '1차 분류 (관/항 · 어느 사역/모임을 위한 지출인가요?)'}
                </span>
              </label>
              <button
                type="button"
                onClick={() => setIsAddingCategory((prev) => !prev)}
                className="text-[12px] font-semibold text-[#3182F6] flex items-center gap-0.5"
              >
                <Plus className="w-3.5 h-3.5" />새 관/항 추가
              </button>
            </div>

            {isAddingCategory && (
              <div className="mb-3 p-3 rounded-2xl bg-[#FFFFFF] space-y-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder={
                      type === 'income'
                        ? '새 수입 관/항 입력 (예: 바자회수입)'
                        : '새 지출 사역 관/항 입력 (예: 리더십훈련비)'
                    }
                    className="flex-1 h-10 px-3.5 rounded-xl bg-[#F9FAFB] text-[13.5px] font-semibold text-[#191F28] focus:outline-none"
                  />
                  {type === 'expense' && (
                    <div className="relative flex items-center sm:w-44">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={newCategoryMonthlyBudgetStr}
                        onChange={(e) => {
                          const n = parseRawAmount(e.target.value);
                          setNewCategoryMonthlyBudgetStr(
                            n > 0 ? formatNumber(n) : ''
                          );
                        }}
                        placeholder="월 배정예산(선택)"
                        className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#F9FAFB] text-right text-[13px] font-bold text-[#3182F6] tabular-nums focus:outline-none"
                      />
                      <span className="absolute right-3 text-[12px] text-[#8B95A1] pointer-events-none">
                        원
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleConfirmNewCategory}
                    className="h-10 px-4 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-bold shrink-0"
                  >
                    + 관/항 등록
                  </button>
                </div>
                {type === 'expense' && (
                  <div className="text-[11.5px] text-[#8B95A1]">
                    💡 월 배정예산을 함께 입력하면 연간 예산안(×12개월) 항목으로도 자동 편성됩니다.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const selected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategorySelect(cat)}
                    className={`px-3.5 py-2 rounded-full text-[13px] font-semibold transition-all duration-150 ease-out active:scale-[0.97] flex items-center gap-1.5 ${
                      selected
                        ? 'bg-[#3182F6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5" />}
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step B: 2차 세목 (품목/성질 또는 수입 세부명목) */}
          <div className="pt-3 border-t border-[#E5E8EB] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[13px] font-bold text-[#191F28] flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-[#3182F6]" />
                <span>
                  {type === 'income'
                    ? `2차 세목 ([${category}]의 세부 수입 명목)`
                    : `2차 세목 ([${category}]에서 무엇을 지출했나요?)`}
                </span>
              </label>
              <span className="text-[11.5px] text-[#8B95A1]">
                {type === 'expense'
                  ? '리더십 훈련·행사·수련회 어디서든 [식비·간식/다과]를 세목으로 지정 가능'
                  : '칩을 선택하거나 직접 입력'}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {suggestedSubCategories.map((sub) => {
                const active = subCategory === sub;
                return (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setSubCategory(sub)}
                    className={`px-3 py-1.5 rounded-xl text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.97] ${
                      active
                        ? 'bg-[#191F28] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {sub}
                  </button>
                );
              })}
            </div>

            <input
              type="text"
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              placeholder={
                type === 'income'
                  ? '세부 수입 명목 직접 입력 (예: 동계수련회 1차 등록비, 11월 본부 지원금)'
                  : '세부 지출 세목 직접 입력 (예: 식비·간식/다과, 리더십 훈련 교재, 강사 사례비)'
              }
              className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13px] font-medium text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
            />
          </div>
        </div>

        {/* 지출 시: 목장별 심방비/회식비 연동 선택 */}
        {type === 'expense' && (
          <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[13.5px] font-bold text-[#191F28]">
                <Users className="w-4 h-4 text-[#3182F6]" />
                <span>목장별 심방비·회식비 현황 연동 (선택)</span>
              </div>
              {mokjangId && (
                <button
                  type="button"
                  onClick={() => setMokjangId('')}
                  className="text-[12px] text-[#8B95A1] hover:text-[#4E5968]"
                >
                  목장 선택 해제
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setMokjangId('')}
                className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-all duration-150 ${
                  !mokjangId
                    ? 'bg-[#191F28] text-[#FFFFFF]'
                    : 'bg-[#FFFFFF] text-[#4E5968]'
                }`}
              >
                부서 공통 (특정 목장 아님)
              </button>
              {mokjangs.map((mj) => {
                const active = mokjangId === mj.id;
                return (
                  <button
                    key={mj.id}
                    type="button"
                    onClick={() => setMokjangId(mj.id)}
                    className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-all duration-150 ${
                      active
                        ? 'bg-[#3182F6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#4E5968]'
                    }`}
                  >
                    {mj.name} ({mj.leaderName})
                  </button>
                );
              })}
            </div>

            {mokjangId && (
              <div className="pt-1 flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-[#4E5968]">
                  지출 성격:
                </span>
                {(['visitation', 'fellowship'] as const).map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => {
                      setMokjangSubType(sub);
                      if (sub === 'visitation') {
                        setSubCategory('심방·선물·꽃');
                      } else {
                        setSubCategory('식비·간식/다과');
                      }
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-[12.5px] font-bold transition-all duration-150 ${
                      mokjangSubType === sub
                        ? 'bg-[#E8F3FF] text-[#1B64DA]'
                        : 'bg-[#FFFFFF] text-[#8B95A1]'
                    }`}
                  >
                    {sub === 'visitation' ? '💐 ' : '🍙 '}
                    {MOKJANG_SUBTYPE_LABELS[sub]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 적요(사용처/입금출처) 및 상세 산출근거 메모 */}
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              {type === 'income'
                ? '적요 (입금 출처 / 수입 내역 제목)'
                : '적요 (가맹점명 / 지출 내역 제목)'}
            </label>
            <div className="px-4 py-3 rounded-2xl bg-[#F9FAFB] focus-within:bg-[#F2F4F6]">
              <AutoResizeTextarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  type === 'income'
                    ? '예: 교회 재정부 11월 정기예산 수령, 동계수련회 등록비 입금'
                    : '예: 김밥천국 역삼점 (리더십 훈련 간식), 교보문고 (목자반 교재)'
                }
                className="text-[15px] font-medium text-[#191F28] placeholder:text-[#8B95A1]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              상세 산출근거 메모 (결산 보고서 및 영수증철 하단에 인쇄됨)
            </label>
            <div className="px-4 py-3 rounded-2xl bg-[#F9FAFB] focus-within:bg-[#F2F4F6]">
              <AutoResizeTextarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={
                  type === 'income'
                    ? '예: 수련회 등록비 25,000원 × 32명 입금 완료'
                    : '예: 참치김밥 4,500원×15줄 + 라면 5,000원×5개 (리더십 훈련 저녁)'
                }
                className="text-[14px] text-[#4E5968] placeholder:text-[#8B95A1]"
              />
            </div>
          </div>
        </div>

        {/* 수입 모드일 때: 선택적 이체확인증/증빙 첨부 슬롯 */}
        {type === 'income' && (
          <div className="bg-[#F9FAFB] rounded-2xl p-3.5 flex items-center justify-between gap-3">
            <div className="text-[12.5px] text-[#4E5968]">
              {receiptImage
                ? '📎 입금/이체확인증 이미지가 첨부되었습니다.'
                : '📎 입금내역 캡처나 통장 사본 첨부가 필요하면 우측 버튼을 누르세요 (선택)'}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] text-[#4E5968] text-[12px] font-semibold shrink-0 flex items-center gap-1"
            >
              <Upload className="w-3.5 h-3.5 text-[#3182F6]" />
              {receiptImage ? '이미지 변경' : '이체확인증 첨부'}
            </button>
          </div>
        )}

        {/* AI 자동 채우기 완료 브리핑 배너 */}
        {aiFilledNotice && (
          <div className="px-4 py-3 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] text-[13px] font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              ✨ {aiFilledNotice} — 내용을 확인하고 아래 버튼을 눌러 등록하세요!
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="px-4 py-3 rounded-2xl bg-[#FFEEF0] text-[#F04452] text-[13px] font-medium">
            {errorMsg}
          </div>
        )}

        {/* 하단 저장 / 삭제 액션 바 */}
        <div className="pt-2 flex items-center gap-2.5">
          {initialTransaction && onDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete(initialTransaction.id);
                onClose();
              }}
              className="h-13 px-4 rounded-2xl bg-[#FFEEF0] text-[#F04452] font-semibold text-[14px] flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all duration-150 ease-out"
            >
              <Trash2 className="w-4 h-4" />
              삭제
            </button>
          )}

          <button
            ref={submitBtnRef}
            type="submit"
            disabled={isCompressing || isAnalyzingAi}
            className="flex-1 h-13 rounded-2xl bg-[#3182F6] hover:bg-[#1B64DA] text-[#FFFFFF] font-semibold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all duration-150 ease-out focus:ring-4 focus:ring-[#3182F6]/30"
          >
            {initialTransaction
              ? '수정 내용 저장하기'
              : type === 'income'
                ? '💰 수입 내역 장부에 기록하기'
                : aiFilledNotice
                  ? '✅ AI 추출 내역 장부에 바로 기록하기'
                  : '🧾 지출 내역 장부에 기록하기'}
          </button>
        </div>
      </form>
    </TdsDialog>
  );
};
