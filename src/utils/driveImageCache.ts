/**
 * Google Drive fileId -> 동일 출처 blob: URL 세션 캐시 (순환 참조 없는 경량 스토어)
 * - googleDirectSync.ts (업로드 직후 워밍업)
 * - receiptImageLoader.ts (Drive API 인증 다운로드 및 <img>/<svg> 해석)
 * - receiptSliceRenderer.ts (Canvas 300 DPI 슬라이스 합성)
 * 세 계층이 이 단일 캐시를 공유합니다.
 */
const driveObjectUrlCache = new Map<string, string>();
const authListeners = new Set<() => void>();

export function getCachedDriveBlobUrl(fileId: string): string | undefined {
  return driveObjectUrlCache.get(fileId.trim());
}

export function primeDriveImageCache(fileId: string, blob: Blob): string {
  const cleanId = fileId.trim();
  const prevUrl = driveObjectUrlCache.get(cleanId);
  if (prevUrl) {
    URL.revokeObjectURL(prevUrl);
  }
  const nextUrl = URL.createObjectURL(blob);
  driveObjectUrlCache.set(cleanId, nextUrl);
  return nextUrl;
}

export function invalidateDriveImageCache(fileId: string): void {
  const cleanId = fileId.trim();
  const prevUrl = driveObjectUrlCache.get(cleanId);
  if (prevUrl) {
    URL.revokeObjectURL(prevUrl);
    driveObjectUrlCache.delete(cleanId);
  }
}

export function notifyReceiptAuthChanged(): void {
  authListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  });
}

export function subscribeReceiptAuthChange(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}
