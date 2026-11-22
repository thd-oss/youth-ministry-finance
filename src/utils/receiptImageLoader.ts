import {
  getCachedDriveBlobUrl,
  invalidateDriveImageCache,
  notifyReceiptAuthChanged,
  primeDriveImageCache,
  subscribeReceiptAuthChange,
} from './driveImageCache';
import {
  extractDriveFileId,
  fetchDriveFileBlob,
  loadGoogleSession,
} from './googleDirectSync';

export {
  getCachedDriveBlobUrl,
  invalidateDriveImageCache,
  notifyReceiptAuthChanged,
  primeDriveImageCache,
  subscribeReceiptAuthChange,
};

const DRIVE_PUBLIC_IMAGE_WIDTH_PX = 2000;
const driveInFlight = new Map<string, Promise<string | undefined>>();

/**
 * 비로그인 공개 파일용 lh3 직접 이미지 URL 폴백을 생성합니다.
 */
export function buildDrivePublicFallbackUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(
    fileId.trim()
  )}=w${DRIVE_PUBLIC_IMAGE_WIDTH_PX}`;
}

/**
 * 동기적으로 즉시 렌더링 가능한 이미지 URL을 반환합니다.
 * - data: / blob: / 일반 외부 URL -> 즉시 반환
 * - Google Drive URL -> 세션 캐시에 blob: URL이 있으면 즉시 반환, 없으면 undefined
 */
export function getCachedReceiptDisplayUrl(src?: string): string | undefined {
  if (!src) return undefined;
  const trimmed = src.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const fileId = extractDriveFileId(trimmed);
  if (!fileId) {
    return trimmed;
  }

  return getCachedDriveBlobUrl(fileId);
}

/**
 * OAuth 액세스 토큰으로 Google Drive 원본 이미지를 동일 출처 blob: URL로 로드합니다.
 * Canvas CORS Tainted 및 iOS PWA 서드파티 쿠키 차단(ITP) 엑박을 원천 차단합니다.
 */
export async function getDriveBlobObjectUrl(
  fileId: string,
  forceRefresh = false
): Promise<string | undefined> {
  const cleanId = fileId.trim();
  if (!cleanId) return undefined;

  if (forceRefresh) {
    invalidateDriveImageCache(cleanId);
  } else {
    const cached = getCachedDriveBlobUrl(cleanId);
    if (cached) return cached;
  }

  const pending = driveInFlight.get(cleanId);
  if (pending) return pending;

  const task = (async (): Promise<string | undefined> => {
    const session = loadGoogleSession();
    if (!session?.accessToken) {
      return undefined;
    }

    try {
      const blob = await fetchDriveFileBlob(cleanId, session.accessToken);
      if (!blob || blob.size === 0) {
        return undefined;
      }
      return primeDriveImageCache(cleanId, blob);
    } catch {
      return undefined;
    }
  })();

  driveInFlight.set(cleanId, task);
  try {
    return await task;
  } finally {
    driveInFlight.delete(cleanId);
  }
}

/**
 * 영수증 이미지 소스를 브라우저(특히 iOS PWA)·SVG·인쇄에서 안정적으로 표시 가능한 URL로 해석합니다.
 */
export async function resolveReceiptDisplayUrl(
  src?: string,
  options?: { forceRefresh?: boolean }
): Promise<string | undefined> {
  if (!src) return undefined;
  const trimmed = src.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const fileId = extractDriveFileId(trimmed);
  if (!fileId) {
    return trimmed;
  }

  const blobUrl = await getDriveBlobObjectUrl(fileId, options?.forceRefresh);
  if (blobUrl) {
    return blobUrl;
  }

  // 비로그인 또는 토큰 만료 시 공개 lh3 URL로 폴백
  return buildDrivePublicFallbackUrl(fileId);
}
