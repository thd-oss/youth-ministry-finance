const KOREAN_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const KOREAN_SMALL_UNITS = ['', '십', '백', '천'];
const KOREAN_LARGE_UNITS = ['', '만', '억', '조'];

/**
 * 숫자를 공문서 표준 한글 금액으로 변환합니다.
 * 예: 1540000 -> "일금 일백오십사만 원정 (₩1,540,000)"
 */
export function numberToKoreanWordOnly(amount: number): string {
  const safeNum = Math.max(0, Math.floor(Math.abs(amount)));
  if (safeNum === 0) return '영';

  const numStr = String(safeNum);
  const length = numStr.length;
  let result = '';

  let groupNonZero = false;

  for (let i = 0; i < length; i++) {
    const digit = Number(numStr[i]);
    const pos = length - 1 - i; // 0-based position from right
    const smallUnitIdx = pos % 4;
    const largeUnitIdx = Math.floor(pos / 4);

    if (digit !== 0) {
      result += KOREAN_DIGITS[digit] + KOREAN_SMALL_UNITS[smallUnitIdx];
      groupNonZero = true;
    }

    if (smallUnitIdx === 0) {
      if (groupNonZero) {
        result += KOREAN_LARGE_UNITS[largeUnitIdx];
      }
      groupNonZero = false;
    }
  }

  return result;
}

export function numberToKoreanCurrency(amount: number): string {
  const safeNum = Math.max(0, Math.floor(Math.abs(amount)));
  const koreanWord = numberToKoreanWordOnly(safeNum);
  const formattedNum = safeNum.toLocaleString('ko-KR');
  return `일금 ${koreanWord} 원정 (₩${formattedNum})`;
}

export function formatNumber(amount: number): string {
  return Math.round(amount).toLocaleString('ko-KR');
}

export function formatWon(amount: number): string {
  return `${Math.round(amount).toLocaleString('ko-KR')}원`;
}

export function formatSignedWon(amount: number, type: 'income' | 'expense'): string {
  const absFormatted = Math.abs(Math.round(amount)).toLocaleString('ko-KR');
  return type === 'income' ? `+${absFormatted}원` : `-${absFormatted}원`;
}

export function formatDateHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const dayName = weekdays[dateObj.getDay()];
  return `${m}월 ${d}일 ${dayName}`;
}

export function formatShortDate(dateStr: string): string {
  return dateStr.replace(/-/g, '.');
}

export function formatYearMonthKorean(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year || !month) return yearMonth;
  return `${year}년 ${month}월`;
}
