import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ExternalLink,
  ImagePlus,
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
import {
  compressReceiptImage,
  generateMockReceiptSvgDataUrl,
} from '../utils/imageCompressor';
import { formatNumber } from '../utils/koreanCurrency';
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
  incomeCategories: string[];
  expenseCategories: string[];
  mokjangs: MokjangGroup[];
  onAddCustomCategory: (type: TransactionType, newCategory: string) => void;
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
  incomeCategories,
  expenseCategories,
  mokjangs,
  onAddCustomCategory,
  onSave,
  onDelete,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [previewScanMode, setPreviewScanMode] = useState<boolean>(false);
  const [isAddingCategory, setIsAddingCategory] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
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
    }
  }, [
    open,
    initialTransaction,
    defaultYearMonth,
    defaultAccount,
    presetMokjangId,
    presetMokjangSubType,
    expenseCategories,
  ]);

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    if (nextType === 'income') {
      if (!incomeCategories.includes(category)) {
        setCategory(incomeCategories[1] || incomeCategories[0] || '교회지원금(예산)');
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressing(true);
    setErrorMsg('');
    try {
      const compressed = await compressReceiptImage(file, 1200, 0.8);
      setReceiptImage(compressed.dataUrl);
      setReceiptMeta(compressed.meta);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : '이미지 압축 중 오류가 발생했습니다.'
      );
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleGenerateMockReceipt = () => {
    const amount = parseRawAmount(amountStr) || 35000;
    const store = title.trim() || '청년부 지정 가맹점';
    const desc = memo.trim() || `${category} 품목 1식`;
    const svgUrl = generateMockReceiptSvgDataUrl({
      storeName: store,
      bizNo: '214-88-90123',
      ownerName: '김대표',
      address: '서울특별시 강남구 테헤란로 210',
      dateTime: `${date} 14:20:00`,
      approvalNo: String(Math.floor(10000000 + Math.random() * 90000000)),
      cardName: `${paymentMethod} (청년부 공용)`,
      category,
      totalAmount: amount,
      items: [{ name: desc.slice(0, 26), unitPrice: amount, qty: 1, amount }],
      note: initialTransaction?.evidenceNo
        ? `증빙 ${initialTransaction.evidenceNo} · ${category}`
        : `청년부 지출 증빙 · ${category}`,
    });

    setReceiptImage(svgUrl);
    setReceiptMeta({
      width: 460,
      height: 520,
      sizeKb: 14,
      fileName: `${date}_${category}_${amount}원.svg`,
    });
    if (!amountStr) setAmountStr(formatNumber(amount));
    if (!title.trim()) setTitle(store);
  };

  const handleConfirmNewCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    onAddCustomCategory(type, trimmed);
    setCategory(trimmed);
    setNewCategoryName('');
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

  return (
    <TdsDialog
      open={open}
      onClose={onClose}
      title={initialTransaction ? '거래 내역 및 증빙 상세' : '내역 기록 및 영수증 등록'}
      subtitle={
        initialTransaction?.evidenceNo
          ? `자동 부여 증빙번호: ${initialTransaction.evidenceNo} (A4 장부·영수증철 1:1 매칭)`
          : '입력 즉시 장부 잔액, 목장별 지출현황, A4 결산서·영수증철에 반영됩니다'
      }
      variant="bottom-sheet"
    >
      <form onSubmit={handleSubmit} className="space-y-5 pt-1">
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
              관/항 카테고리 선택 (연간 예산안 구조 자동 연동)
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
            <div className="mb-2.5 flex items-center gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="새 관/항 카테고리명 입력 (예: 새가족정착비)"
                className="flex-1 h-10 px-3.5 rounded-xl bg-[#F9FAFB] text-[13.5px] text-[#191F28] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleConfirmNewCategory}
                className="h-10 px-3.5 rounded-xl bg-[#3182F6] text-[#FFFFFF] text-[13px] font-semibold shrink-0"
              >
                추가
              </button>
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

        {/* 적요(사용처/내용) 및 상세 산출근거 메모 (멀티라인 자동 높이 조절) */}
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

        {/* 영수증 사진 첨부 드롭존 / 카메라 촬영 */}
        <div className="bg-[#F9FAFB] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <span className="text-[14px] font-bold text-[#191F28]">
                영수증 증빙 사진 첨부
              </span>
              <p className="text-[12px] text-[#8B95A1] mt-0.5">
                Canvas API로 최대 폭 1200px, JPEG 품질 0.8로 자동 최적화됩니다
              </p>
            </div>
            {!receiptImage && (
              <button
                type="button"
                onClick={handleGenerateMockReceipt}
                className="px-3 py-1.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
              >
                <Sparkles className="w-3.5 h-3.5" />
                가상 영수증 자동생성
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

          {receiptImage ? (
            <div className="space-y-3">
              <div className="relative rounded-2xl bg-[#FFFFFF] p-3 flex flex-col items-center">
                <img
                  src={receiptImage}
                  alt="영수증 미리보기"
                  className={`max-h-72 w-auto object-contain rounded-xl ${
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
                <button
                  type="button"
                  onClick={() => setPreviewScanMode((prev) => !prev)}
                  className={`px-3 py-2 rounded-xl text-[12px] font-semibold transition-all duration-150 active:scale-[0.97] ${
                    previewScanMode
                      ? 'bg-[#191F28] text-[#FFFFFF]'
                      : 'bg-[#E5E8EB] text-[#4E5968]'
                  }`}
                >
                  ✨ 인쇄용 스캔 보정 필터 {previewScanMode ? '켜짐' : '미리보기'}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] text-[12px] font-semibold flex items-center gap-1 active:scale-[0.97] transition-all duration-150"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    다른 사진 변경
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptImage(undefined);
                      setReceiptMeta(undefined);
                      setReceiptDriveUrl(undefined);
                    }}
                    className="px-3 py-2 rounded-xl bg-[#FFEEF0] text-[#F04452] text-[12px] font-semibold active:scale-[0.97] transition-all duration-150"
                  >
                    사진 제거
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isCompressing}
              className="w-full py-7 rounded-2xl bg-[#FFFFFF] hover:bg-[#F2F4F6] text-center flex flex-col items-center justify-center gap-2 transition-all duration-150 ease-out active:scale-[0.97]"
            >
              <div className="w-11 h-11 rounded-full bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center">
                {isCompressing ? (
                  <Camera className="w-5 h-5 animate-pulse" />
                ) : (
                  <ImagePlus className="w-5 h-5" />
                )}
              </div>
              <div className="text-[14px] font-semibold text-[#191F28]">
                {isCompressing
                  ? 'Canvas 고화질 압축 처리 중...'
                  : '영수증 사진 선택 또는 휴대폰 카메라 촬영'}
              </div>
              <div className="text-[12px] text-[#8B95A1]">
                첨부 시 [증빙 #번호]가 부여되어 A4 증빙철에 자동 배치됩니다
              </div>
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="px-4 py-3 rounded-2xl bg-[#FFEEF0] text-[#F04452] text-[13px] font-semibold">
            {errorMsg}
          </div>
        )}

        {/* 하단 액션 버튼 */}
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
            type="submit"
            className="flex-1 h-13 rounded-2xl bg-[#3182F6] text-[#FFFFFF] font-semibold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all duration-150"
          >
            {initialTransaction ? '수정 내용 저장하기' : '장부에 기록하기'}
          </button>
        </div>
      </form>
    </TdsDialog>
  );
};
