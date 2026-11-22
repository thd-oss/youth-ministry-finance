import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useResolvedReceiptSrc } from '../hooks/useResolvedReceiptSrc';

interface ReceiptImgProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string;
  fallbackHeightClass?: string;
  compactFallback?: boolean;
}

/**
 * 로컬 Data URL 및 Google Drive 영수증 URL을 iOS PWA에서도 엑박 없이
 * OAuth 인증 Blob URL로 표시하는 통합 이미지 컴포넌트입니다.
 */
export const ReceiptImg: React.FC<ReceiptImgProps> = ({
  src,
  alt = '영수증 이미지',
  className = '',
  fallbackHeightClass = 'min-h-[140px]',
  compactFallback = false,
  onError,
  ...imgProps
}) => {
  const { resolvedSrc, isLoading, hasError, handleImgError, retry } =
    useResolvedReceiptSrc(src);

  if (isLoading && !resolvedSrc) {
    return (
      <div
        className={`w-full ${fallbackHeightClass} rounded-xl bg-[#F2F4F6] flex flex-col items-center justify-center gap-1.5 text-[#8B95A1]`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-[#3182F6]" />
        {!compactFallback && (
          <span className="text-[11.5px] font-medium">영수증 불러오는 중...</span>
        )}
      </div>
    );
  }

  if (hasError || !resolvedSrc) {
    return (
      <div
        className={`w-full ${fallbackHeightClass} rounded-xl bg-[#F9FAFB] border border-[#E5E8EB] flex flex-col items-center justify-center gap-2 p-3 text-center`}
      >
        <span className="text-[12px] font-semibold text-[#4E5968] break-words [word-break:keep-all]">
          {compactFallback
            ? '이미지 로드 실패'
            : '영수증 이미지를 불러오지 못했습니다'}
        </span>
        {!compactFallback && (
          <span className="text-[11px] text-[#8B95A1] break-words [word-break:keep-all]">
            상단 구글 로그인 상태를 확인한 뒤 다시 시도해 주세요
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            retry();
          }}
          className="h-8 px-3 rounded-lg bg-[#E8F3FF] text-[#1B64DA] text-[11.5px] font-bold inline-flex items-center gap-1 active:scale-[0.97]"
        >
          <RefreshCw className="w-3 h-3" />
          <span>다시 불러오기</span>
        </button>
      </div>
    );
  }

  return (
    <img
      {...imgProps}
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={(e) => {
        handleImgError();
        onError?.(e);
      }}
      className={className}
    />
  );
};

interface ResolvedSvgImageProps
  extends Omit<React.SVGProps<SVGImageElement>, 'href'> {
  href?: string;
}

/**
 * SVG <image> 폴백 슬롯에서도 Google Drive URL을 동일 출처 blob: URL로 해석해
 * iOS PWA WebKit의 SVG 외부 이미지 차단을 방지합니다.
 */
export const ResolvedSvgImage: React.FC<ResolvedSvgImageProps> = ({
  href,
  ...svgProps
}) => {
  const { resolvedSrc } = useResolvedReceiptSrc(href);
  if (!resolvedSrc) return null;
  return <image {...svgProps} href={resolvedSrc} />;
};
