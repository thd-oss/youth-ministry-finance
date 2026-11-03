import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  ACCOUNT_LABELS,
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
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { TdsDialog } from './TdsDialog';

interface TransactionBottomSheetProps {
  open: boolean;
  onClose: () => void;
  initialTransaction?: ProcessedTransaction | null;
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
    expenseCategories[0] || '간식/다과비'
  );
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

    if (initialTransaction) {
      setType(initialTransaction.type);
      setAccount(initialTransaction.account);
      setDate(initialTransaction.date);
      setAmountStr(formatNumber(initialTransaction.amount));
      setCategory(initialTransaction.category);
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
      setType('expense');
      setAccount(defaultAccount);
      setDate(defaultDate);
      setAmountStr('');
      setPaymentMethod('체크카드');
      setTitle('');
      setMemo('');
      setMokjangId(presetMokjangId || '');
      setMokjangSubType(presetMokjangSubType || 'fellowship');
      if (presetMokjangSubType === 'visitation') {
        const visitCat = expenseCategories.find((c) => c.includes('심방'));
        setCategory(visitCat || expenseCategories[0] || '심방/축하/조의');
      } else {
        setCategory(expenseCategories[0] || '간식/다과비');
      }
      setReceiptImage(undefined);
      setReceiptDriveUrl(undefined);
      setReceiptMeta(undefined);

      if (autoTriggerCamera) {
        setTimeout(() => {
          fileInputRef.current?.click();
        }, 180);
      }
    }
  }, [
    open,
    initialTransaction,
    defaultYearMonth,
    defaultAccount,
    presetMokjangId,
    presetMokjangSubType,
    autoTriggerCamera,
    expenseCategories,
  ]);

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    if (nextType === 'income') {
      if (!incomeCategories.includes(category)) {
        setCategory(
          incomeCategories[1] || incomeCategories[0] || '교회지원금(예산)'
        );
      }
      setPaymentMethod('계좌이체');
      setMokjangId('');
    } else {
      if (!expenseCategories.includes(category)) {
        setCategory(expenseCategories[0] || '간식/다과비');
      }
      setPaymentMethod('체크카드');
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

      // 추출이 완료되면 바로 업로드(장부에 기록하기) 버튼 코앞으로 스크롤 및 포커스 이동
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

      // Gemini API Key가 연결되어 있으면 사진 업로드 즉시 자동으로 내용 추출 실행
      if (geminiApiKey.trim()) {
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
      setErrorMsg('적요(사용처 또는 내역명)를 입력해 주세요.');
      return;
    }

    const savedTx: Transaction = {
      id: initialTransaction?.id || `tx-${Date.now()}`,
      date,
      type,
      account,
      category,
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
  const hasGeminiKey = Boolean(geminiApiKey.trim());

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title={
        initialTransaction ? '거래 내역 및 증빙 상세' : '내역 기록 및 AI 영수증 등록'
      }
      subtitle={
        initialTransaction?.evidenceNo
          ? `자동 부여 증빙번호: ${initialTransaction.evidenceNo} (A4 장부·영수증철 1:1 매칭)`
          : '영수증 사진을 찍거나 올리면 Gemini AI가 내용을 자동으로 채워줍니다'
      }
      variant="bottom-sheet"
    >
      <form onSubmit={handleSubmit} className="space-y-5 pt-1">
        {/* =================================================================
            1. 최상단 Camera-First 영수증 스캐너 (찍으면 AI 자동 채우기)
           ================================================================= */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Step 1 · 영수증 스캔
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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* AI 분석 진행 중 오버레이 배너 */}
          {isAnalyzingAi && (
            <div className="p-4 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin shrink-0 text-[#3182F6]" />
              <div>
                <div className="text-[14px] font-bold">
                  ✨ Gemini AI가 영수증을 읽고 있어요...
                </div>
                <div className="text-[12px] text-[#4E5968] mt-0.5">
                  가맹점명, 결제금액, 거래일자, 품목별 단가×수량 산출근거를 자동으로 채운 뒤 등록 버튼으로 이동합니다.
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
              className="w-full py-6 px-4 rounded-2xl bg-[#FFFFFF] hover:bg-[#E8F3FF]/50 text-center flex flex-col items-center justify-center gap-2 transition-all duration-150 ease-out active:scale-[0.97]"
            >
              <div className="w-12 h-12 rounded-full bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center">
                <Camera className="w-6 h-6" />
              </div>
              <div className="text-[15px] font-bold text-[#191F28]">
                {isCompressing
                  ? '영수증 고화질 압축 처리 중...'
                  : '📸 여기를 눌러 영수증 촬영 또는 사진 선택'}
              </div>
              <div className="text-[12.5px] text-[#4E5968] max-w-[400px] break-words [word-break:keep-all]">
                {hasGeminiKey
                  ? '사진을 올리는 즉시 Gemini AI가 금액·가맹점·산출근거·카테고리를 모두 채우고 등록 버튼으로 이동합니다'
                  : '영수증 없이 수기로만 기록할 경우 아래 입력란에 바로 입력하세요'}
              </div>
            </button>
          )}
        </div>

        {/* 지출 / 수입 세그먼트 토글 */}
        <div className="bg-[#F2F4F6] p-1 rounded-2xl grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`py-2.5 rounded-xl text-[15px] font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
              type === 'expense'
                ? 'bg-[#FFFFFF] text-[#191F28]'
                : 'text-[#8B95A1] hover:text-[#4E5968]'
            }`}
          >
            지출 내역 (-)
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`py-2.5 rounded-xl text-[15px] font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
              type === 'income'
                ? 'bg-[#FFFFFF] text-[#3182F6]'
                : 'text-[#8B95A1] hover:text-[#4E5968]'
            }`}
          >
            수입 내역 (+)
          </button>
        </div>

        {/* 금액 입력 영역 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[13px] font-medium text-[#4E5968]">
              {type === 'income' ? '수입 금액' : '지출 금액'}
            </label>
            <div className="flex gap-1.5">
              {[10000, 50000, 100000].map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => handleQuickAddAmount(unit)}
                  className="px-2.5 py-1 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold tabular-nums active:scale-[0.97] transition-all duration-150"
                >
                  +{unit / 10000}만
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

        {/* 통장 쪼개기 계정 & 거래일자 & 결제수단 */}
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
              거래 일자
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
              결제/입금 수단
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

        {/* 원터치 카테고리 칩 선택 (연간 예산안 구조와 실시간 연동) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[#4E5968]">
              관/항 카테고리 선택 (연간 예산안 연동)
            </label>
            <button
              type="button"
              onClick={() => setIsAddingCategory((prev) => !prev)}
              className="text-[12px] font-semibold text-[#3182F6] flex items-center gap-0.5"
            >
              <Plus className="w-3.5 h-3.5" />
              새 관/항 추가
            </button>
          </div>

          {isAddingCategory && (
            <div className="mb-3 p-3 rounded-2xl bg-[#F9FAFB] space-y-2">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="새 관/항 카테고리명 (예: 새가족정착비)"
                  className="flex-1 h-10 px-3.5 rounded-xl bg-[#FFFFFF] text-[13.5px] font-semibold text-[#191F28] focus:outline-none"
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
                      className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#FFFFFF] text-right text-[13px] font-bold text-[#3182F6] tabular-nums focus:outline-none"
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

          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const selected = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3.5 py-2 rounded-full text-[13px] font-semibold transition-all duration-150 ease-out active:scale-[0.97] flex items-center gap-1.5 ${
                    selected
                      ? 'bg-[#3182F6] text-[#FFFFFF]'
                      : 'bg-[#F9FAFB] text-[#4E5968] hover:bg-[#E5E8EB]'
                  }`}
                >
                  {selected && <Check className="w-3.5 h-3.5" />}
                  {cat}
                </button>
              );
            })}
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
                        const vCat = expenseCategories.find((c) =>
                          c.includes('심방')
                        );
                        if (vCat) setCategory(vCat);
                      } else {
                        const fCat = expenseCategories.find(
                          (c) => c.includes('간식') || c.includes('회식')
                        );
                        if (fCat) setCategory(fCat);
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

        {/* 적요(사용처/내용) 및 상세 산출근거 메모 */}
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              적요 (가맹점명 / 내역 제목)
            </label>
            <div className="px-4 py-3 rounded-2xl bg-[#F9FAFB] focus-within:bg-[#F2F4F6]">
              <AutoResizeTextarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  type === 'expense'
                    ? '예: 김밥천국 역삼본점 (1목장 주일 점심 회식)'
                    : '예: 11월 청년부 정기 교육부서 예산 수령'
                }
                className="text-[15px] font-medium text-[#191F28] placeholder:text-[#8B95A1]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#4E5968] mb-1.5">
              상세 산출근거 메모 (결산 보고서 및 영수증철 하단에 줄바꿈되어 전체 인쇄됨)
            </label>
            <div className="px-4 py-3 rounded-2xl bg-[#F9FAFB] focus-within:bg-[#F2F4F6]">
              <AutoResizeTextarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 야채김밥 3,500원×20줄 (1목장 소그룹 모임 식사 및 다과)"
                className="text-[14px] text-[#191F28] placeholder:text-[#8B95A1]"
              />
            </div>
          </div>
        </div>

        {/* AI 자동 입력 완료 안내 배너 (등록 버튼 바로 위) */}
        {aiFilledNotice && (
          <div className="px-4 py-3.5 rounded-2xl bg-[#E8F3FF] text-[#1B64DA] flex items-start gap-2.5">
            <Sparkles className="w-5 h-5 shrink-0 mt-0.5 text-[#3182F6]" />
            <div className="text-[13px] leading-snug">
              <div className="font-bold">
                ✨ AI 자동 채우기 완료: {aiFilledNotice}
              </div>
              <div className="text-[#4E5968] text-[12px] mt-0.5">
                입력된 내용을 확인하시고 바로 아래 [장부에 기록하기] 버튼을 눌러주세요!
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="px-4 py-3 rounded-2xl bg-[#FFEEF0] text-[#F04452] text-[13px] font-semibold">
            {errorMsg}
          </div>
        )}

        {/* 하단 액션 버튼 (AI 추출 완료 시 이 버튼으로 자동 스크롤 & 포커스) */}
        <div className="flex items-center gap-2.5 pt-1">
          {initialTransaction && onDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete(initialTransaction.id);
                onClose();
              }}
              className="h-13 px-4 rounded-2xl bg-[#FFEEF0] text-[#F04452] font-semibold text-[15px] flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all duration-150 shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              삭제
            </button>
          )}
          <button
            ref={submitBtnRef}
            type="submit"
            className="flex-1 h-14 rounded-2xl bg-[#3182F6] text-[#FFFFFF] font-bold text-[16px] flex items-center justify-center gap-2 focus:ring-4 focus:ring-[#3182F6]/30 active:scale-[0.97] transition-all duration-150"
          >
            <Check className="w-5 h-5" />
            {initialTransaction ? '수정 내용 저장하기' : '장부에 기록하기'}
          </button>
        </div>
      </form>
    </TdsDialog>
  );
};
