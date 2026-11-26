/// <reference types="vite/client" />
import {
  AccountType,
  AppSettings,
  BudgetDocument,
  BudgetLineItem,
  MokjangExpenseSubType,
  MokjangGroup,
  PaymentMethod,
  ProcessedTransaction,
  ReceiptBookLayoutsMap,
  ReceiptEditConfig,
  ReceiptMetadata,
  Transaction,
  TransactionType,
} from '../types/finance';
import { DEFAULT_SETTINGS } from './sampleData';
import {
  BudgetsMap,
  createBlankAnnualBudgetDocument,
  createBlankClaimDocument,
  DEFAULT_FISCAL_YEAR,
  isValidFiscalYear,
  normalizeBudgetsMap,
  sanitizeReceiptEditConfig,
  sanitizeReceiptLayoutEntry,
  sanitizeReceiptLayoutsMap,
  sanitizeReceiptMetadata,
} from './syncManager';
import { primeDriveImageCache } from './driveImageCache';

// 빌드 시 환경변수(VITE_GOOGLE_CLIENT_ID)로 기본 클라이언트 ID를 내장할 수 있습니다.
export const BUILTIN_GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const SESSION_KEY = 'tds_youth_finance_google_session_v1';

const ROOT_FOLDER_NAME = '청년부_회계_통합관리';
const RECEIPT_FOLDER_NAME = '영수증_증빙';
const DEFAULT_SPREADSHEET_TITLE = '청년부 회계장부 (통합백업)';
const DRIVE_THUMBNAIL_WIDTH_PX = 2000;
const RECEIPT_LAYOUT_SETTING_PREFIX = 'receiptLayout:';
const CLAIM_DOC_KEY_PREFIX = 'retreat_claim:';
const SILENT_RECONNECT_TIMEOUT_MS = 3500;
const FISCAL_YEAR_FOLDER_REGEX = /^(\d{4})년$/;

const SHEET_NAMES = {
  LEDGER: '장부내역',
  MOKJANG: '목장현황',
  BUDGET_ITEMS: '예산안_항목',
  BUDGET_META: '예산안_문서정보',
  SETTINGS: '설정',
} as const;

export interface GoogleSession {
  accessToken: string;
  expiresAt: number;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleWorkspaceInfo {
  fiscalYear: number;
  rootFolderId: string;
  yearFolderId: string;
  yearFolderUrl: string;
  receiptFolderId: string;
  receiptFolderUrl: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  createdNewSpreadsheet: boolean;
  hasExistingData: boolean;
  migratedFromLegacyRoot?: boolean;
  remoteModifiedTime?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    hint?: string;
    callback: (resp: GoogleTokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => {
    requestAccessToken: (overrideConfig?: {
      prompt?: string;
      hint?: string;
    }) => void;
  };
  revoke: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
    };
  }
}

export function getEffectiveGoogleClientId(settings?: AppSettings): string {
  return (settings?.googleClientId || '').trim() || BUILTIN_GOOGLE_CLIENT_ID;
}

export function loadGoogleSession(): GoogleSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleSession;
    if (!parsed.accessToken || Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveGoogleSession(session: GoogleSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage 저장 실패 시 무시
  }
}

export function clearGoogleSession(): void {
  try {
    const current = loadGoogleSession();
    if (current?.accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(current.accessToken);
    }
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 무시
  }
}

async function ensureGsiLoaded(): Promise<GoogleAccountsOAuth2> {
  if (window.google?.accounts?.oauth2) {
    return window.google.accounts.oauth2;
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    ) as HTMLScriptElement | null;

    const waitUntilReady = () => {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve(window.google.accounts.oauth2);
        } else if (tries > 50) {
          clearInterval(timer);
          reject(
            new Error(
              'Google 로그인 모듈을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.'
            )
          );
        }
      }, 100);
    };

    if (existing) {
      waitUntilReady();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => waitUntilReady();
    script.onerror = () =>
      reject(new Error('Google 로그인 스크립트를 로드할 수 없습니다.'));
    document.head.appendChild(script);
  });
}

/**
 * Google OAuth 2.0 팝업 로그인을 실행하고 사용자 프로필과 액세스 토큰을 반환합니다.
 */
export async function signInWithGoogle(
  clientId: string,
  prompt: '' | 'select_account' | 'consent' = 'select_account',
  loginHint?: string
): Promise<GoogleSession> {
  const cleanId = clientId.trim();
  if (!cleanId) {
    throw new Error('먼저 Google OAuth 클라이언트 ID를 입력해 주세요.');
  }
  const cleanHint = loginHint?.trim() || undefined;

  const oauth2 = await ensureGsiLoaded();

  const tokenResp = await new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: cleanId,
      scope: GOOGLE_SCOPES,
      ...(cleanHint ? { hint: cleanHint } : {}),
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error_description ||
                resp.error ||
                '구글 로그인 승인이 취소되었습니다.'
            )
          );
        } else {
          resolve(resp);
        }
      },
      error_callback: (err) => {
        reject(
          new Error(
            err.message ||
              '구글 로그인 팝업이 차단되었거나 취소되었습니다. 팝업 차단을 해제해 주세요.'
          )
        );
      },
    });

    client.requestAccessToken({
      prompt,
      ...(cleanHint ? { hint: cleanHint } : {}),
    });
  });

  const accessToken = tokenResp.access_token!;
  const expiresInSec = Number(tokenResp.expires_in) || 3500;

  // 사용자 이메일·이름 조회
  const profileRes = await fetch(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const profile = profileRes.ok ? await profileRes.json() : {};

  const session: GoogleSession = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresInSec - 90) * 1000,
    email: String(profile.email || ''),
    name: String(profile.name || profile.email || '구글 사용자'),
    picture: profile.picture ? String(profile.picture) : undefined,
  };

  saveGoogleSession(session);
  return session;
}

/**
 * 이전에 연결된 계정 힌트(loginHint)로 무팝업(prompt: '') 세션 복구를 시도합니다.
 * 팝업 승인 필요·차단·타임아웃(3500ms) 시 예외를 던지지 않고 null을 반환합니다.
 */
export async function trySilentGoogleReconnect(
  clientId: string,
  loginHint: string
): Promise<GoogleSession | null> {
  const cleanId = clientId.trim();
  const cleanHint = loginHint.trim();
  if (!cleanId || !cleanHint) return null;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), SILENT_RECONNECT_TIMEOUT_MS);
    });
    const session = await Promise.race([
      signInWithGoogle(cleanId, '', cleanHint).catch(() => null),
      timeoutPromise,
    ]);
    return session;
  } catch {
    return null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * 구글 드라이브 스프레드시트의 최종 수정 시각(modifiedTime)과 휴지통 여부를 초경량 조회합니다.
 * (다른 기기 변경 감지 및 충돌 판단용)
 */
export async function getSpreadsheetModifiedTime(
  accessToken: string,
  spreadsheetId: string
): Promise<{ modifiedTime: string | null; trashed: boolean }> {
  const cleanId = spreadsheetId.trim();
  if (!cleanId) return { modifiedTime: null, trashed: false };

  const res = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      cleanId
    )}?fields=modifiedTime,trashed`,
    accessToken
  );

  if (!res.ok) {
    return { modifiedTime: null, trashed: false };
  }

  const info = await res.json();
  return {
    modifiedTime:
      typeof info.modifiedTime === 'string' && info.modifiedTime
        ? info.modifiedTime
        : null,
    trashed: Boolean(info.trashed),
  };
}

async function googleApiFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (res.status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    throw new Error(
      '구글 로그인 세션이 만료되었습니다. [구글 다시 로그인] 버튼을 눌러 재연결해 주세요.'
    );
  }
  return res;
}

async function findDriveFolderOnly(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<{ id: string; webViewLink: string } | null> {
  const escapedName = folderName.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false${parentClause}`;

  const searchRes = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,webViewLink)&spaces=drive`,
    accessToken
  );
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  if (Array.isArray(searchData.files) && searchData.files.length > 0) {
    const f = searchData.files[0];
    return {
      id: f.id,
      webViewLink:
        f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
    };
  }
  return null;
}

async function moveDriveFileToFolder(
  accessToken: string,
  fileId: string,
  targetParentId: string,
  removeParentId?: string
): Promise<boolean> {
  const removeClause = removeParentId
    ? `&removeParents=${encodeURIComponent(removeParentId)}`
    : '';
  try {
    const res = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?addParents=${encodeURIComponent(targetParentId)}${removeClause}&fields=id,parents`,
      accessToken,
      { method: 'PATCH' }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 구글 드라이브의 청년부_회계_통합관리 폴더에서 생성되어 있는 회계연도(YYYY년) 목록을 조회합니다.
 */
export async function listDriveFiscalYears(
  accessToken: string
): Promise<number[]> {
  try {
    const rootFolder = await findDriveFolderOnly(accessToken, ROOT_FOLDER_NAME);
    if (!rootFolder) return [];

    const q = `'${rootFolder.id}' in parents and trashed=false`;
    const res = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        q
      )}&fields=files(id,name,mimeType)&pageSize=100`,
      accessToken
    );
    if (!res.ok) return [];
    const data = await res.json();
    const years = new Set<number>();
    let hasLegacyRootSheet = false;

    for (const f of data.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder' && f.name) {
        const match = String(f.name).trim().match(FISCAL_YEAR_FOLDER_REGEX);
        if (match?.[1]) {
          const y = Number(match[1]);
          if (isValidFiscalYear(y)) years.add(y);
        }
      } else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
        hasLegacyRootSheet = true;
      }
    }

    if (hasLegacyRootSheet && years.size === 0) {
      years.add(DEFAULT_FISCAL_YEAR);
    }

    return Array.from(years).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<{ id: string; webViewLink: string }> {
  const escapedName = folderName.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false${parentClause}`;

  const searchRes = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,webViewLink)&spaces=drive`,
    accessToken
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(
      `Google Drive 폴더 조회 실패 (${searchRes.status}): Drive API가 활성화되었는지 확인해 주세요. ${errText.slice(0, 120)}`
    );
  }

  const searchData = await searchRes.json();
  if (Array.isArray(searchData.files) && searchData.files.length > 0) {
    const f = searchData.files[0];
    return {
      id: f.id,
      webViewLink:
        f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
    };
  }

  // 없으면 새 폴더 생성
  const createRes = await googleApiFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    }
  );

  if (!createRes.ok) {
    throw new Error(`Google Drive 폴더 생성 실패 (${createRes.status})`);
  }

  const created = await createRes.json();
  return {
    id: created.id,
    webViewLink:
      created.webViewLink ||
      `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function ensureAllSheetTabs(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const metaRes = await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    accessToken
  );
  if (!metaRes.ok) {
    throw new Error(`스프레드시트 탭 정보 조회 실패 (${metaRes.status})`);
  }

  const meta = await metaRes.json();
  const existingTitles = new Set<string>(
    (meta.sheets || []).map(
      (s: { properties?: { title?: string } }) => s.properties?.title || ''
    )
  );

  const requiredTitles = Object.values(SHEET_NAMES);
  const requests = requiredTitles
    .filter((title) => !existingTitles.has(title))
    .map((title) => ({
      addSheet: {
        properties: {
          title,
          gridProperties: { frozenRowCount: 1 },
        },
      },
    }));

  if (requests.length > 0) {
    await googleApiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      }
    );
  }
}

/**
 * 로그인한 구글 계정의 드라이브에 회계연도별 독립 폴더(청년부_회계_통합관리/YYYY년/)와
 * 연도 전용 5개 시트 스프레드시트·영수증 폴더를 자동 준비합니다.
 * 기존 루트에 저장된 레거시 시트·영수증 폴더가 있으면 파일 ID 변경 없이 연도 폴더로 무손실 이관합니다.
 */
export async function ensureGoogleWorkspace(
  accessToken: string,
  departmentName: string,
  fiscalYear = DEFAULT_FISCAL_YEAR,
  existingSpreadsheetId?: string
): Promise<GoogleWorkspaceInfo> {
  const safeYear = isValidFiscalYear(fiscalYear)
    ? fiscalYear
    : DEFAULT_FISCAL_YEAR;
  const rootFolder = await findOrCreateDriveFolder(
    accessToken,
    ROOT_FOLDER_NAME
  );
  const yearFolder = await findOrCreateDriveFolder(
    accessToken,
    `${safeYear}년`,
    rootFolder.id
  );

  let spreadsheetId = '';
  let spreadsheetUrl = '';
  let remoteModifiedTime: string | undefined;
  let createdNewSpreadsheet = false;
  let migratedFromLegacyRoot = false;

  // 1) 전달받은 기존 spreadsheetId가 유효하며 해당 연도 폴더(또는 루트 레거시)에 있는지 확인
  if (existingSpreadsheetId?.trim()) {
    const checkRes = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files/${existingSpreadsheetId.trim()}?fields=id,trashed,webViewLink,modifiedTime,parents`,
      accessToken
    );
    if (checkRes.ok) {
      const info = await checkRes.json();
      const parents: string[] = Array.isArray(info.parents) ? info.parents : [];
      if (info.id && !info.trashed) {
        if (parents.includes(yearFolder.id)) {
          spreadsheetId = info.id;
          spreadsheetUrl =
            info.webViewLink ||
            `https://docs.google.com/spreadsheets/d/${info.id}/edit`;
          if (typeof info.modifiedTime === 'string' && info.modifiedTime) {
            remoteModifiedTime = info.modifiedTime;
          }
        } else if (parents.includes(rootFolder.id)) {
          // 기존 루트에 있던 시트를 연도 폴더로 무손실 이동 (spreadsheetId 100% 유지)
          await moveDriveFileToFolder(
            accessToken,
            info.id,
            yearFolder.id,
            rootFolder.id
          );
          migratedFromLegacyRoot = true;
          spreadsheetId = info.id;
          spreadsheetUrl =
            info.webViewLink ||
            `https://docs.google.com/spreadsheets/d/${info.id}/edit`;
          if (typeof info.modifiedTime === 'string' && info.modifiedTime) {
            remoteModifiedTime = info.modifiedTime;
          }
        }
      }
    }
  }

  // 2) 해당 연도 폴더 안에서 기존 스프레드시트 검색
  if (!spreadsheetId) {
    const q = `mimeType='application/vnd.google-apps.spreadsheet' and '${yearFolder.id}' in parents and trashed=false`;
    const listRes = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        q
      )}&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime desc`,
      accessToken
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.files) && listData.files.length > 0) {
        const f = listData.files[0];
        spreadsheetId = f.id;
        spreadsheetUrl =
          f.webViewLink ||
          `https://docs.google.com/spreadsheets/d/${f.id}/edit`;
        if (typeof f.modifiedTime === 'string' && f.modifiedTime) {
          remoteModifiedTime = f.modifiedTime;
        }
      }
    }
  }

  // 3) 연도 폴더가 비어 있을 때, 기본 연도(2026)라면 루트에 남아 있는 레거시 통합 시트를 무손실 이관
  if (!spreadsheetId && safeYear === DEFAULT_FISCAL_YEAR) {
    const legacyQ = `mimeType='application/vnd.google-apps.spreadsheet' and '${rootFolder.id}' in parents and trashed=false`;
    const legacyListRes = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        legacyQ
      )}&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime desc`,
      accessToken
    );
    if (legacyListRes.ok) {
      const legacyData = await legacyListRes.json();
      if (Array.isArray(legacyData.files) && legacyData.files.length > 0) {
        const f = legacyData.files[0];
        await moveDriveFileToFolder(
          accessToken,
          f.id,
          yearFolder.id,
          rootFolder.id
        );
        migratedFromLegacyRoot = true;
        spreadsheetId = f.id;
        spreadsheetUrl =
          f.webViewLink ||
          `https://docs.google.com/spreadsheets/d/${f.id}/edit`;
        if (typeof f.modifiedTime === 'string' && f.modifiedTime) {
          remoteModifiedTime = f.modifiedTime;
        }
      }
    }
  }

  // 4) 연도 폴더 안 영수증_증빙 폴더 준비 (루트에 레거시 영수증 폴더가 있으면 파일 ID 유지한 채 통째 이동)
  let receiptFolder = await findDriveFolderOnly(
    accessToken,
    RECEIPT_FOLDER_NAME,
    yearFolder.id
  );
  if (!receiptFolder && (migratedFromLegacyRoot || safeYear === DEFAULT_FISCAL_YEAR)) {
    const legacyReceiptFolder = await findDriveFolderOnly(
      accessToken,
      RECEIPT_FOLDER_NAME,
      rootFolder.id
    );
    if (legacyReceiptFolder) {
      await moveDriveFileToFolder(
        accessToken,
        legacyReceiptFolder.id,
        yearFolder.id,
        rootFolder.id
      );
      receiptFolder = legacyReceiptFolder;
    }
  }
  if (!receiptFolder) {
    receiptFolder = await findOrCreateDriveFolder(
      accessToken,
      RECEIPT_FOLDER_NAME,
      yearFolder.id
    );
  }

  // 5) 없으면 연도 전용 새 스프레드시트를 5개 시트 구성으로 자동 생성하고 연도 폴더로 이동
  if (!spreadsheetId) {
    const title = departmentName?.trim()
      ? `${safeYear}년 ${departmentName.trim()} 회계장부`
      : `${safeYear}년 ${DEFAULT_SPREADSHEET_TITLE}`;

    const createRes = await googleApiFetch(
      'https://sheets.googleapis.com/v4/spreadsheets',
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { title, locale: 'ko_KR' },
          sheets: Object.values(SHEET_NAMES).map((sheetTitle) => ({
            properties: {
              title: sheetTitle,
              gridProperties: { frozenRowCount: 1 },
            },
          })),
        }),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(
        `구글 스프레드시트 자동 생성 실패 (${createRes.status}): Google Sheets API가 활성화되었는지 확인해 주세요. ${errText.slice(0, 120)}`
      );
    }

    const created = await createRes.json();
    spreadsheetId = created.spreadsheetId;
    spreadsheetUrl =
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    createdNewSpreadsheet = true;

    // 생성된 시트를 청년부_회계_통합관리/YYYY년/ 폴더로 이동
    await moveDriveFileToFolder(
      accessToken,
      spreadsheetId,
      yearFolder.id,
      'root'
    );

    // 5개 시트 머리글 행 볼드 + 회색 배경 스타일 적용
    try {
      const sheetIds: number[] = (created.sheets || []).map(
        (s: { properties: { sheetId: number } }) => s.properties.sheetId
      );
      await googleApiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: sheetIds.map((sheetId) => ({
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.95, green: 0.96, blue: 0.97 },
                    textFormat: { bold: true },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            })),
          }),
        }
      );
    } catch {
      // 서식 적용 실패는 무시
    }
  } else {
    await ensureAllSheetTabs(accessToken, spreadsheetId);
  }

  // 4) 기존 시트에 이미 저장된 행이 있는지 확인
  let hasExistingData = false;
  if (!createdNewSpreadsheet) {
    try {
      const ranges = [
        `${SHEET_NAMES.LEDGER}!A2:A3`,
        `${SHEET_NAMES.BUDGET_ITEMS}!A2:A3`,
        `${SHEET_NAMES.MOKJANG}!A2:A3`,
      ];
      const checkValRes = await googleApiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${ranges
          .map((r) => `ranges=${encodeURIComponent(r)}`)
          .join('&')}`,
        accessToken
      );
      if (checkValRes.ok) {
        const valData = await checkValRes.json();
        hasExistingData = (valData.valueRanges || []).some(
          (vr: { values?: unknown[][] }) =>
            Array.isArray(vr.values) && vr.values.length > 0
        );
      }
    } catch {
      hasExistingData = false;
    }
  }

  if (!remoteModifiedTime && spreadsheetId) {
    try {
      const meta = await getSpreadsheetModifiedTime(accessToken, spreadsheetId);
      if (meta.modifiedTime) {
        remoteModifiedTime = meta.modifiedTime;
      }
    } catch {
      // 수정 시각 조회 실패 시 무시
    }
  }

  return {
    fiscalYear: safeYear,
    rootFolderId: rootFolder.id,
    yearFolderId: yearFolder.id,
    yearFolderUrl: yearFolder.webViewLink,
    receiptFolderId: receiptFolder.id,
    receiptFolderUrl: receiptFolder.webViewLink,
    spreadsheetId,
    spreadsheetUrl,
    createdNewSpreadsheet,
    hasExistingData,
    ...(migratedFromLegacyRoot ? { migratedFromLegacyRoot: true } : {}),
    remoteModifiedTime,
  };
}

/**
 * Google Drive 썸네일·뷰어 URL에서 파일 ID를 추출합니다.
 * Data URL이거나 드라이브 URL이 아니면 null을 반환합니다.
 */
export function extractDriveFileId(url?: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  const isDriveHost =
    trimmed.includes('drive.google.com') ||
    trimmed.includes('googleusercontent.com');
  if (!isDriveHost) return null;

  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1];

  const filePathMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (filePathMatch?.[1]) return filePathMatch[1];

  const shortPathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (shortPathMatch?.[1]) return shortPathMatch[1];

  return null;
}

/**
 * OAuth 액세스 토큰으로 Google Drive 원본 이미지 Blob을 직접 내려받습니다.
 * (썸네일 해상도 저하 및 Canvas CORS Tainted 오류를 원천 방지)
 */
export async function fetchDriveFileBlob(
  fileId: string,
  accessToken: string
): Promise<Blob> {
  const cleanId = fileId.trim();
  if (!cleanId) {
    throw new Error('유효한 Google Drive 파일 ID가 아닙니다.');
  }
  const res = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      cleanId
    )}?alt=media`,
    accessToken
  );
  if (!res.ok) {
    throw new Error(
      `Google Drive 원본 이미지 불러오기 실패 (${res.status})`
    );
  }
  return await res.blob();
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/data:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const isBase64 = parts[0].includes(';base64');
  const raw = isBase64 ? atob(parts[1]) : decodeURIComponent(parts[1]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  const ext = mimeType.includes('svg')
    ? 'svg'
    : mimeType.includes('png')
      ? 'png'
      : 'jpg';
  return { blob: new Blob([bytes], { type: mimeType }), ext };
}

async function uploadReceiptImageToDrive(
  accessToken: string,
  receiptFolderId: string,
  tx: Transaction | ProcessedTransaction,
  monthFolderCache: Map<string, string>
): Promise<{ thumbnailUrl: string; driveUrl: string }> {
  if (!tx.receiptImage || !tx.receiptImage.startsWith('data:image/')) {
    return {
      thumbnailUrl: tx.receiptImage || '',
      driveUrl: tx.receiptDriveUrl || '',
    };
  }

  const ym = (tx.date || new Date().toISOString().slice(0, 7)).slice(0, 7);
  let monthFolderId = monthFolderCache.get(ym);
  if (!monthFolderId) {
    const folder = await findOrCreateDriveFolder(
      accessToken,
      ym,
      receiptFolderId
    );
    monthFolderId = folder.id;
    monthFolderCache.set(ym, monthFolderId);
  }

  const { blob, ext } = dataUrlToBlob(tx.receiptImage);
  const cleanCat = (tx.category || '지출').replace(/[\\/:*?"<>|\s]/g, '');
  const ev = 'evidenceNo' in tx && tx.evidenceNo ? tx.evidenceNo : '#00';
  const fileName = `${tx.date}_${ev}_${cleanCat}_${tx.amount}원.${ext}`;

  const metadata = {
    name: fileName,
    parents: [monthFolderId],
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob, fileName);

  const uploadRes = await googleApiFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    accessToken,
    {
      method: 'POST',
      body: form,
    }
  );

  if (!uploadRes.ok) {
    return {
      thumbnailUrl: tx.receiptImage,
      driveUrl: tx.receiptDriveUrl || '',
    };
  }

  const uploaded = await uploadRes.json();
  const fileId = uploaded.id;

  // 업로드 직후 방금 만든 원본 Blob을 동일 출처 캐시에 즉시 워밍업 (iOS PWA 동기화 직후 엑박·깜빡임 방지)
  if (fileId && blob.size > 0) {
    primeDriveImageCache(fileId, blob);
  }

  // 링크가 있는 사용자 읽기 권한 설정 (다른 기기·시트에서도 썸네일 즉시 표시)
  try {
    await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    );
  } catch {
    // 조직 정책상 외부 공유가 제한된 경우 기본 권한 유지
  }

  return {
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w${DRIVE_THUMBNAIL_WIDTH_PX}`,
    driveUrl:
      uploaded.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

/**
 * 모든 탭(장부·영수증·목장·연간예산안·수련회청구서·설정·영수증철 배치)의 데이터를
 * 구글 시트 5개 탭과 구글 드라이브 영수증 폴더에 일괄 백업합니다.
 */
export async function pushAllToGoogleSheets(
  accessToken: string,
  spreadsheetId: string,
  receiptFolderId: string,
  payload: {
    fiscalYear?: number;
    transactions: ProcessedTransaction[];
    budgets: BudgetsMap;
    mokjangs: MokjangGroup[];
    settings: AppSettings;
    receiptLayouts?: ReceiptBookLayoutsMap;
  }
): Promise<{
  updatedTransactions: Transaction[];
  syncedAt: string;
  remoteModifiedTime?: string;
}> {
  await ensureAllSheetTabs(accessToken, spreadsheetId);

  // 1) Base64 영수증 이미지를 구글 드라이브 월별 폴더에 업로드
  const monthFolderCache = new Map<string, string>();
  const uploadedTransactions: Transaction[] = [];
  const now = new Date().toISOString();

  for (const tx of payload.transactions) {
    const { evidenceNo, runningBalance: _rb, ...rawTx } = tx;
    if (tx.receiptImage && tx.receiptImage.startsWith('data:image/')) {
      const driveInfo = await uploadReceiptImageToDrive(
        accessToken,
        receiptFolderId,
        tx,
        monthFolderCache
      );
      uploadedTransactions.push({
        ...rawTx,
        receiptImage: driveInfo.thumbnailUrl,
        receiptDriveUrl: driveInfo.driveUrl,
      });
    } else {
      uploadedTransactions.push(rawTx);
    }
    void evidenceNo;
  }

  // 2) 5개 시트 표 데이터 생성
  const ledgerRows: (string | number)[][] = [
    [
      'ID',
      '일자',
      '구분',
      '회계계정',
      '1차구분(사역/수입원)',
      '2차세목',
      '목장ID',
      '목장지출구분',
      '사용처/내역명',
      '산출근거/메모',
      '금액',
      '결제수단',
      '증빙번호',
      '영수증이미지URL',
      '영수증드라이브링크',
      '생성일시',
      '수정일시',
      '영수증분할정보',
      '영수증메타',
      '3차분류',
    ],
    ...payload.transactions.map((tx, idx) => {
      const saved = uploadedTransactions[idx];
      return [
        saved.id,
        saved.date,
        saved.type,
        saved.account,
        saved.category,
        saved.subCategory || '',
        saved.mokjangId || '',
        saved.mokjangSubType || '',
        saved.title,
        saved.memo || '',
        Number(saved.amount) || 0,
        saved.paymentMethod || '체크카드',
        tx.evidenceNo || '',
        saved.receiptImage || '',
        saved.receiptDriveUrl || '',
        saved.createdAt || now,
        now,
        saved.receiptEdit ? JSON.stringify(saved.receiptEdit) : '',
        saved.receiptMeta ? JSON.stringify(saved.receiptMeta) : '',
        saved.detailCategory || '',
      ];
    }),
  ];

  const mokjangRows: (string | number)[][] = [
    [
      '목장ID',
      '목장명',
      '담당목자',
      '인원수',
      '심방비예산',
      '회식비예산',
      '비고',
    ],
    ...payload.mokjangs.map((m) => [
      m.id,
      m.name,
      m.leaderName,
      Number(m.memberCount) || 1,
      Number(m.visitationBudget) || 0,
      Number(m.fellowshipBudget) || 0,
      m.note || '',
    ]),
  ];

  const activeFiscalYear = isValidFiscalYear(payload.fiscalYear)
    ? payload.fiscalYear
    : payload.budgets.annual_budget?.fiscalYear || DEFAULT_FISCAL_YEAR;
  const normalizedBudgets = normalizeBudgetsMap(
    payload.budgets,
    activeFiscalYear
  );

  const budgetItemRows: (string | number)[][] = [
    [
      '문서구분',
      '항목ID',
      '수입/지출',
      '1차구분',
      '2차세목',
      '설명',
      '산출식',
      '금액',
      '비고',
      '3차분류',
    ],
  ];

  const budgetMetaRows: (string | number)[][] = [
    [
      '문서구분',
      '회계연도',
      '제목',
      '부제',
      '부서명',
      '사역/행사명',
      '일시/기간',
      '장소',
      '참석인원',
      '청구인',
      '직책',
      '청구일자',
      '자체부담금',
      '자체부담내역',
      '은행명',
      '계좌번호',
      '예금주',
      '하단문구',
    ],
  ];

  const docEntries: Array<{ key: string; doc: BudgetDocument }> = [
    { key: 'annual_budget', doc: normalizedBudgets.annual_budget },
    ...normalizedBudgets.claims.map((claimDoc, idx) => {
      const claimId = claimDoc.id?.trim() || `claim-${idx + 1}`;
      // 첫 기본 청구서(claim-1)는 구버전 시트 호환을 위해 'retreat_claim', 추가 청구서는 'retreat_claim:<id>' 사용
      const docKey =
        claimId === 'claim-1'
          ? 'retreat_claim'
          : `${CLAIM_DOC_KEY_PREFIX}${claimId}`;
      return { key: docKey, doc: claimDoc };
    }),
  ];

  docEntries.forEach(({ key, doc }) => {
    budgetMetaRows.push([
      key,
      Number(doc.fiscalYear) || activeFiscalYear,
      doc.title || '',
      doc.subtitle || '',
      doc.department || '',
      doc.eventName || '',
      doc.eventPeriod || '',
      doc.eventLocation || '',
      doc.participants || '',
      doc.proposerName || '',
      doc.proposerRole || '',
      doc.requestDate || '',
      Number(doc.selfBurdenAmount) || 0,
      doc.selfBurdenNote || '',
      doc.bankName || '',
      doc.accountNumber || '',
      doc.accountHolder || '',
      doc.purposeNote || '',
    ]);

    doc.items.forEach((item) => {
      budgetItemRows.push([
        key,
        item.id,
        item.entryType || 'expense',
        item.category || '',
        item.subCategory || '',
        item.itemName || '',
        item.formula || '',
        Number(item.amount) || 0,
        item.note || '',
        item.detailCategory || '',
      ]);
    });
  });

  const safeSettings: Partial<AppSettings> = {
    departmentName: payload.settings.departmentName,
    authorName: payload.settings.authorName,
    authorRole: payload.settings.authorRole,
    approvalRoles: payload.settings.approvalRoles,
    showApprovalBox: payload.settings.showApprovalBox,
    syncCategoriesWithAnnualBudget:
      payload.settings.syncCategoriesWithAnnualBudget,
    customIncomeCategories: payload.settings.customIncomeCategories,
    customExpenseCategories: payload.settings.customExpenseCategories,
    isProductionMode: payload.settings.isProductionMode,
  };

  const settingRows: (string | number)[][] = [
    ['항목', '값', '수정일시'],
    ['fiscalYear', String(activeFiscalYear), now],
    ['departmentName', safeSettings.departmentName || '', now],
    ['authorName', safeSettings.authorName || '', now],
    ['authorRole', safeSettings.authorRole || '', now],
    ['approvalRoles', JSON.stringify(safeSettings.approvalRoles || []), now],
    ['showApprovalBox', String(Boolean(safeSettings.showApprovalBox)), now],
    [
      'syncCategoriesWithAnnualBudget',
      String(Boolean(safeSettings.syncCategoriesWithAnnualBudget)),
      now,
    ],
    [
      'customIncomeCategories',
      JSON.stringify(safeSettings.customIncomeCategories || []),
      now,
    ],
    [
      'customExpenseCategories',
      JSON.stringify(safeSettings.customExpenseCategories || []),
      now,
    ],
    ['isProductionMode', String(Boolean(safeSettings.isProductionMode)), now],
  ];

  // 월·계정 스코프별 영수증철 배치 행 추가 (셀 50,000자 제한 회피를 위해 행 분리 저장)
  const sanitizedLayouts = sanitizeReceiptLayoutsMap(payload.receiptLayouts);
  for (const [scopeKey, entry] of Object.entries(sanitizedLayouts)) {
    settingRows.push([
      `${RECEIPT_LAYOUT_SETTING_PREFIX}${scopeKey}`,
      JSON.stringify(entry),
      entry.updatedAt || now,
    ]);
  }

  // 3) 기존 시트 내용 클리어 후 5개 시트 일괄 쓰기
  const clearRanges = Object.values(SHEET_NAMES).map((name) => `${name}!A:Z`);
  await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranges: clearRanges }),
    }
  );

  const updateRes = await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: `${SHEET_NAMES.LEDGER}!A1`, values: ledgerRows },
          { range: `${SHEET_NAMES.MOKJANG}!A1`, values: mokjangRows },
          { range: `${SHEET_NAMES.BUDGET_ITEMS}!A1`, values: budgetItemRows },
          { range: `${SHEET_NAMES.BUDGET_META}!A1`, values: budgetMetaRows },
          { range: `${SHEET_NAMES.SETTINGS}!A1`, values: settingRows },
        ],
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(
      `구글 시트 데이터 저장 실패 (${updateRes.status}): ${errText.slice(0, 120)}`
    );
  }

  let remoteModifiedTime: string | undefined;
  try {
    const meta = await getSpreadsheetModifiedTime(accessToken, spreadsheetId);
    if (meta.modifiedTime) {
      remoteModifiedTime = meta.modifiedTime;
    }
  } catch {
    // 수정 시각 조회 실패 시 syncedAt으로 폴백 가능하도록 undefined 유지
  }

  return {
    updatedTransactions: uploadedTransactions,
    syncedAt: now,
    remoteModifiedTime,
  };
}

/**
 * 구글 시트 5개 탭에서 전체 데이터(장부·목장·연간예산안·수련회청구서·설정)를 읽어와 복원합니다.
 */
export async function pullAllFromGoogleSheets(
  accessToken: string,
  spreadsheetId: string,
  currentSettings: AppSettings,
  fiscalYear = DEFAULT_FISCAL_YEAR
): Promise<{
  transactions: Transaction[];
  mokjangs: MokjangGroup[];
  budgets: BudgetsMap;
  settings: AppSettings;
  receiptLayouts: ReceiptBookLayoutsMap;
  remoteModifiedTime?: string;
}> {
  await ensureAllSheetTabs(accessToken, spreadsheetId);

  const ranges = [
    `${SHEET_NAMES.LEDGER}!A1:T`,
    `${SHEET_NAMES.MOKJANG}!A1:G`,
    `${SHEET_NAMES.BUDGET_ITEMS}!A1:J`,
    `${SHEET_NAMES.BUDGET_META}!A1:R`,
    `${SHEET_NAMES.SETTINGS}!A1:C`,
  ];

  const [res, remoteMeta] = await Promise.all([
    googleApiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${ranges
        .map((r) => `ranges=${encodeURIComponent(r)}`)
        .join('&')}`,
      accessToken
    ),
    getSpreadsheetModifiedTime(accessToken, spreadsheetId).catch(() => ({
      modifiedTime: null,
      trashed: false,
    })),
  ]);

  if (!res.ok) {
    throw new Error(`구글 시트 데이터 불러오기 실패 (${res.status})`);
  }

  const remoteModifiedTime = remoteMeta.modifiedTime || undefined;

  const data = await res.json();
  const valueRanges = data.valueRanges || [];

  // 1) 장부내역 파싱
  const ledgerValues: string[][] = valueRanges[0]?.values || [];
  const transactions: Transaction[] = [];
  for (let i = 1; i < ledgerValues.length; i++) {
    const r = ledgerValues[i];
    if (!r || !r[0]) continue;
    const rawType = String(r[2] || 'expense');
    const type: TransactionType = rawType === 'income' ? 'income' : 'expense';
    const rawAcc = String(r[3] || 'general');
    const account: Exclude<AccountType, 'all'> =
      rawAcc === 'retreat' || rawAcc === 'mission' ? rawAcc : 'general';
    const rawSubType = String(r[7] || '');
    const mokjangSubType: MokjangExpenseSubType | undefined =
      rawSubType === 'visitation' || rawSubType === 'fellowship'
        ? rawSubType
        : undefined;

    let receiptEdit: ReceiptEditConfig | undefined;
    if (r[17]) {
      try {
        receiptEdit = sanitizeReceiptEditConfig(JSON.parse(String(r[17])));
      } catch {
        receiptEdit = undefined;
      }
    }

    let receiptMeta: ReceiptMetadata | undefined;
    if (r[18]) {
      try {
        receiptMeta = sanitizeReceiptMetadata(JSON.parse(String(r[18])));
      } catch {
        receiptMeta = undefined;
      }
    }

    transactions.push({
      id: String(r[0]),
      date: String(r[1] || new Date().toISOString().slice(0, 10)),
      type,
      account,
      category: String(r[4] || '기타운영비'),
      subCategory: r[5] ? String(r[5]) : undefined,
      detailCategory: r[19] ? String(r[19]) : undefined,
      mokjangId: r[6] ? String(r[6]) : undefined,
      mokjangSubType,
      title: String(r[8] || ''),
      memo: String(r[9] || ''),
      amount: Number(r[10]) || 0,
      paymentMethod: (String(r[11] || '체크카드') as PaymentMethod) || '체크카드',
      receiptImage: r[13] ? String(r[13]) : undefined,
      receiptDriveUrl: r[14] ? String(r[14]) : undefined,
      ...(receiptMeta ? { receiptMeta } : {}),
      ...(receiptEdit ? { receiptEdit } : {}),
      createdAt: String(r[15] || new Date().toISOString()),
    });
  }

  // 2) 목장현황 파싱
  const mokjangValues: string[][] = valueRanges[1]?.values || [];
  const mokjangs: MokjangGroup[] = [];
  for (let i = 1; i < mokjangValues.length; i++) {
    const r = mokjangValues[i];
    if (!r || !r[0]) continue;
    mokjangs.push({
      id: String(r[0]),
      name: String(r[1] || ''),
      leaderName: String(r[2] || ''),
      memberCount: Number(r[3]) || 1,
      visitationBudget: Number(r[4]) || 0,
      fellowshipBudget: Number(r[5]) || 0,
      note: String(r[6] || ''),
    });
  }

  // 3) 예산안 문서정보 + 복수 특별예산 청구서 항목 파싱
  const itemValues: string[][] = valueRanges[2]?.values || [];
  const metaValues: string[][] = valueRanges[3]?.values || [];
  const safeYear = isValidFiscalYear(fiscalYear)
    ? fiscalYear
    : DEFAULT_FISCAL_YEAR;

  const annualDoc: BudgetDocument = createBlankAnnualBudgetDocument(
    safeYear,
    currentSettings.departmentName,
    currentSettings.authorName,
    currentSettings.authorRole
  );
  const claimMap = new Map<string, BudgetDocument>();

  const getOrCreateClaimDoc = (rawKey: string): BudgetDocument | null => {
    if (rawKey === 'retreat_claim') {
      let existing = claimMap.get('claim-1');
      if (!existing) {
        existing = createBlankClaimDocument(
          safeYear,
          currentSettings.departmentName,
          currentSettings.authorName,
          currentSettings.authorRole,
          { id: 'claim-1' }
        );
        claimMap.set('claim-1', existing);
      }
      return existing;
    }
    if (rawKey.startsWith(CLAIM_DOC_KEY_PREFIX)) {
      const claimId = rawKey.slice(CLAIM_DOC_KEY_PREFIX.length).trim();
      if (!claimId) return null;
      let existing = claimMap.get(claimId);
      if (!existing) {
        existing = createBlankClaimDocument(
          safeYear,
          currentSettings.departmentName,
          currentSettings.authorName,
          currentSettings.authorRole,
          { id: claimId }
        );
        claimMap.set(claimId, existing);
      }
      return existing;
    }
    return null;
  };

  for (let i = 1; i < metaValues.length; i++) {
    const r = metaValues[i];
    if (!r || !r[0]) continue;
    const rawKey = String(r[0]).trim();
    const target =
      rawKey === 'annual_budget' ? annualDoc : getOrCreateClaimDoc(rawKey);
    if (!target) continue;

    target.fiscalYear = Number(r[1]) || safeYear;
    target.title = String(r[2] || target.title);
    target.subtitle = String(r[3] || '');
    target.department = String(r[4] || '');
    target.eventName = String(r[5] || '');
    target.eventPeriod = String(r[6] || '');
    target.eventLocation = String(r[7] || '');
    target.participants = String(r[8] || '');
    target.proposerName = String(r[9] || '');
    target.proposerRole = String(r[10] || '');
    target.requestDate = String(r[11] || '');
    target.selfBurdenAmount = Number(r[12]) || 0;
    target.selfBurdenNote = String(r[13] || '');
    target.bankName = String(r[14] || '');
    target.accountNumber = String(r[15] || '');
    target.accountHolder = String(r[16] || '');
    target.purposeNote = String(r[17] || '');
  }

  for (let i = 1; i < itemValues.length; i++) {
    const r = itemValues[i];
    if (!r || !r[0]) continue;
    const rawKey = String(r[0]).trim();
    const item: BudgetLineItem = {
      id: String(r[1] || `bg-${Date.now()}-${i}`),
      entryType: String(r[2]) === 'income' ? 'income' : 'expense',
      category: String(r[3] || ''),
      subCategory: r[4] ? String(r[4]) : undefined,
      detailCategory: r[9] ? String(r[9]) : undefined,
      itemName: String(r[5] || ''),
      formula: String(r[6] || ''),
      amount: Number(r[7]) || 0,
      note: String(r[8] || ''),
    };
    if (rawKey === 'annual_budget') {
      annualDoc.items.push(item);
    } else {
      const claimTarget = getOrCreateClaimDoc(rawKey);
      if (claimTarget) {
        claimTarget.items.push(item);
      }
    }
  }

  const parsedClaims = Array.from(claimMap.values());
  const defaultFallbackClaim = createBlankClaimDocument(
    safeYear,
    currentSettings.departmentName,
    currentSettings.authorName,
    currentSettings.authorRole,
    { id: 'claim-1' }
  );
  const resolvedBudgets = normalizeBudgetsMap(
    {
      annual_budget: annualDoc,
      claims: parsedClaims.length > 0 ? parsedClaims : [defaultFallbackClaim],
    },
    safeYear,
    annualDoc,
    defaultFallbackClaim
  );

  // 4) 설정 파싱 (로컬 전용 API 키·클라이언트 ID·시트 ID는 유지)
  const settingValues: string[][] = valueRanges[4]?.values || [];
  const nextSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...currentSettings,
  };
  const receiptLayouts: ReceiptBookLayoutsMap = {};

  for (let i = 1; i < settingValues.length; i++) {
    const r = settingValues[i];
    if (!r || !r[0]) continue;
    const k = String(r[0]);
    const v = String(r[1] ?? '');
    try {
      if (k.startsWith(RECEIPT_LAYOUT_SETTING_PREFIX) && v) {
        const scopeKey = k.slice(RECEIPT_LAYOUT_SETTING_PREFIX.length).trim();
        if (scopeKey) {
          const parsedEntry = sanitizeReceiptLayoutEntry(JSON.parse(v));
          if (parsedEntry) {
            receiptLayouts[scopeKey] = parsedEntry;
          }
        }
        continue;
      }
      if (k === 'departmentName' && v) nextSettings.departmentName = v;
      if (k === 'authorName' && v) nextSettings.authorName = v;
      if (k === 'authorRole' && v) nextSettings.authorRole = v;
      if (k === 'approvalRoles' && v) {
        const arr = JSON.parse(v);
        if (Array.isArray(arr) && arr.length === 4) {
          nextSettings.approvalRoles = arr as [string, string, string, string];
        }
      }
      if (k === 'showApprovalBox') nextSettings.showApprovalBox = v === 'true';
      if (k === 'syncCategoriesWithAnnualBudget') {
        nextSettings.syncCategoriesWithAnnualBudget = v === 'true';
      }
      if (k === 'customIncomeCategories' && v) {
        nextSettings.customIncomeCategories = JSON.parse(v);
      }
      if (k === 'customExpenseCategories' && v) {
        nextSettings.customExpenseCategories = JSON.parse(v);
      }
      if (k === 'isProductionMode') {
        nextSettings.isProductionMode = v === 'true';
      }
    } catch {
      // 잘못된 개별 설정 행은 무시
    }
  }

  return {
    transactions,
    mokjangs,
    budgets: resolvedBudgets,
    settings: {
      ...nextSettings,
      lastSyncedAt: new Date().toISOString(),
      ...(remoteModifiedTime
        ? { lastCloudModifiedTime: remoteModifiedTime }
        : {}),
    },
    receiptLayouts,
    remoteModifiedTime,
  };
}
