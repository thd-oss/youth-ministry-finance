import { useCallback, useEffect, useState } from 'react';
import { extractDriveFileId } from '../utils/googleDirectSync';
import {
  buildDrivePublicFallbackUrl,
  getCachedReceiptDisplayUrl,
  invalidateDriveImageCache,
  resolveReceiptDisplayUrl,
  subscribeReceiptAuthChange,
} from '../utils/receiptImageLoader';

export interface ResolvedReceiptSrcState {
  resolvedSrc?: string;
  isLoading: boolean;
  hasError: boolean;
  handleImgError: () => void;
  retry: () => void;
}

/**
 * 로컬 Data URL 및 Google Drive URL을 iOS PWA·Safari·Chrome·인쇄 환경에서
 * 엑박 없이 표시 가능한 동일 출처 blob: / data: URL로 자동 해석하는 훅입니다.
 */
export function useResolvedReceiptSrc(src?: string): ResolvedReceiptSrcState {
  const driveFileId = extractDriveFileId(src);

  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() =>
    getCachedReceiptDisplayUrl(src)
  );
  const [isLoading, setIsLoading] = useState<boolean>(() =>
    Boolean(src && driveFileId && !getCachedReceiptDisplayUrl(src))
  );
  const [hasError, setHasError] = useState<boolean>(false);
  const [authTick, setAuthTick] = useState<number>(0);
  const [retryTick, setRetryTick] = useState<number>(0);
  const [fallbackStep, setFallbackStep] = useState<number>(0);

  useEffect(() => {
    return subscribeReceiptAuthChange(() => {
      setAuthTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!src || !src.trim()) {
      setResolvedSrc(undefined);
      setIsLoading(false);
      setHasError(false);
      setFallbackStep(0);
      return;
    }

    const immediate = getCachedReceiptDisplayUrl(src);
    if (immediate && retryTick === 0) {
      setResolvedSrc(immediate);
      setIsLoading(false);
      setHasError(false);
      setFallbackStep(0);
      return;
    }

    if (!driveFileId) {
      setResolvedSrc(src);
      setIsLoading(false);
      setHasError(false);
      setFallbackStep(0);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setFallbackStep(0);

    void resolveReceiptDisplayUrl(src, { forceRefresh: retryTick > 0 }).then(
      (nextUrl) => {
        if (cancelled) return;
        if (nextUrl) {
          setResolvedSrc(nextUrl);
          setIsLoading(false);
        } else {
          setResolvedSrc(undefined);
          setIsLoading(false);
          setHasError(true);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [src, driveFileId, authTick, retryTick]);

  const handleImgError = useCallback(() => {
    if (!src) {
      setHasError(true);
      return;
    }

    // 1단계: 캐시된 blob: URL이 iOS 백그라운드 회수로 깨진 경우 강제 재다운로드 1회
    if (driveFileId && resolvedSrc?.startsWith('blob:') && fallbackStep === 0) {
      invalidateDriveImageCache(driveFileId);
      setFallbackStep(1);
      setRetryTick((n) => n + 1);
      return;
    }

    // 2단계: lh3 폴백이 실패한 경우 원본 Drive URL 1회 시도
    if (driveFileId && fallbackStep < 2) {
      const publicUrl = buildDrivePublicFallbackUrl(driveFileId);
      if (resolvedSrc !== publicUrl && fallbackStep === 0) {
        setFallbackStep(1);
        setResolvedSrc(publicUrl);
        return;
      }
      if (resolvedSrc !== src) {
        setFallbackStep(2);
        setResolvedSrc(src);
        return;
      }
    }

    setIsLoading(false);
    setHasError(true);
  }, [src, driveFileId, resolvedSrc, fallbackStep]);

  const retry = useCallback(() => {
    if (driveFileId) {
      invalidateDriveImageCache(driveFileId);
    }
    setHasError(false);
    setFallbackStep(0);
    setRetryTick((n) => n + 1);
  }, [driveFileId]);

  return {
    resolvedSrc,
    isLoading,
    hasError,
    handleImgError,
    retry,
  };
}
