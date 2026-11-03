export const GAS_CODE_TEMPLATE = `/**
 * ============================================================================
 * 청년부 회계 관리 & 이중 결재 문서 자동화 (Google Sheets + Drive Serverless Backend)
 * ============================================================================
 * [설치 방법]
 * 1. 청년부 구글 계정으로 새 Google 스프레드시트를 생성합니다.
 * 2. 상단 메뉴 [확장 프로그램] > [Apps Script]를 클릭합니다.
 * 3. 기존 코드를 모두 지우고 이 코드 전체를 붙여넣은 뒤 저장(Ctrl+S / Cmd+S)합니다.
 * 4. 우측 상단 [배포] > [새 배포] > 유형: [웹 앱] 선택
 *    - 다음 사용자 인증 정보로 실행: "나 (본인 계정)"
 *    - 액세스 권한이 있는 사용자: "모든 사용자 (Anyone)"
 * 5. 배포 후 생성된 [웹 앱 URL]을 복사하여 회계 앱의 [⚙️ 연동 설정]에 붙여넣으세요.
 */

const SHEET_LEDGER = '장부내역';
const SHEET_BUDGET = '예산청구서';
const SHEET_SETTINGS = '설정';
const ROOT_FOLDER_NAME = '청년부_회계_영수증_증빙';

function ensureSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ledgerSheet = ss.getSheetByName(SHEET_LEDGER);
  if (!ledgerSheet) {
    ledgerSheet = ss.insertSheet(SHEET_LEDGER);
    ledgerSheet.appendRow([
      'id',
      'date',
      'type',
      'account',
      'category',
      'title',
      'memo',
      'amount',
      'paymentMethod',
      'evidenceNo',
      'receiptThumbnailUrl',
      'receiptDriveUrl',
      'createdAt',
      'updatedAt'
    ]);
    ledgerSheet.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#F2F4F6');
    ledgerSheet.setFrozenRows(1);
  }

  let budgetSheet = ss.getSheetByName(SHEET_BUDGET);
  if (!budgetSheet) {
    budgetSheet = ss.insertSheet(SHEET_BUDGET);
    budgetSheet.appendRow(['templateType', 'jsonPayload', 'updatedAt']);
    budgetSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#F2F4F6');
    budgetSheet.setFrozenRows(1);
  }

  let settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet(SHEET_SETTINGS);
    settingsSheet.appendRow(['key', 'value', 'updatedAt']);
    settingsSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#F2F4F6');
    settingsSheet.setFrozenRows(1);
  }

  return { ss, ledgerSheet, budgetSheet, settingsSheet };
}

function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder
    ? parentFolder.getFoldersByName(folderName)
    : DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder
    ? parentFolder.createFolder(folderName)
    : DriveApp.createFolder(folderName);
}

/**
 * Base64 영수증 이미지를 Google Drive 월별 폴더에 저장하고
 * 브라우저 <img> 태그에서 즉시 렌더링 가능한 고화질 썸네일 URL을 반환합니다.
 */
function saveReceiptToDrive(tx) {
  if (!tx.receiptImage || !tx.receiptImage.startsWith('data:image/')) {
    return {
      thumbnailUrl: tx.receiptImage || '',
      driveUrl: tx.receiptDriveUrl || ''
    };
  }

  const rootFolder = getOrCreateFolder(null, ROOT_FOLDER_NAME);
  const yearMonth = (tx.date || '2026-11').slice(0, 7);
  const monthFolder = getOrCreateFolder(rootFolder, yearMonth);

  const parts = tx.receiptImage.split(',');
  const mimeMatch = parts[0].match(/data:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = parts[1];

  const cleanCategory = String(tx.category || '지출').replace(/[\\/\\\\:*?"<>|\\s]/g, '');
  const evBadge = tx.evidenceNo || '#00';
  const ext = mimeType.includes('svg') ? 'svg' : 'jpg';
  const fileName = \`\${tx.date}_\${evBadge}_\${cleanCategory}_\${tx.amount}원.\${ext}\`;

  const decoded = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(decoded, mimeType, fileName);
  const file = monthFolder.createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // 조직 정책상 전체 공개가 제한된 경우 도메인/기본 권한 유지
  }

  const fileId = file.getId();
  return {
    thumbnailUrl: \`https://drive.google.com/thumbnail?id=\${fileId}&sz=w1200\`,
    driveUrl: file.getUrl()
  };
}

function doGet(e) {
  try {
    const { ledgerSheet, budgetSheet, settingsSheet } = ensureSheets();

    const ledgerRows = ledgerSheet.getDataRange().getValues();
    const transactions = [];
    for (let i = 1; i < ledgerRows.length; i++) {
      const r = ledgerRows[i];
      if (!r[0]) continue;
      transactions.push({
        id: String(r[0]),
        date: String(r[1]),
        type: String(r[2]),
        account: String(r[3] || 'general'),
        category: String(r[4]),
        title: String(r[5]),
        memo: String(r[6] || ''),
        amount: Number(r[7] || 0),
        paymentMethod: String(r[8] || '체크카드'),
        evidenceNo: String(r[9] || ''),
        receiptImage: String(r[10] || ''),
        receiptDriveUrl: String(r[11] || ''),
        createdAt: String(r[12] || new Date().toISOString())
      });
    }

    const budgetRows = budgetSheet.getDataRange().getValues();
    const budgets = {};
    for (let i = 1; i < budgetRows.length; i++) {
      const r = budgetRows[i];
      if (!r[0] || !r[1]) continue;
      try {
        budgets[String(r[0])] = JSON.parse(String(r[1]));
      } catch (err) {}
    }

    const settingRows = settingsSheet.getDataRange().getValues();
    let settings = null;
    for (let i = 1; i < settingRows.length; i++) {
      if (settingRows[i][0] === 'app_settings' && settingRows[i][1]) {
        try {
          settings = JSON.parse(String(settingRows[i][1]));
        } catch (err) {}
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        ok: true,
        transactions,
        budgets,
        settings,
        serverTime: new Date().toISOString()
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(error) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const { ledgerSheet, budgetSheet, settingsSheet } = ensureSheets();
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || 'SYNC_ALL';
    const now = new Date().toISOString();

    if (action === 'UPSERT_TRANSACTION' && body.transaction) {
      const tx = body.transaction;
      const driveInfo = saveReceiptToDrive(tx);
      const rows = ledgerSheet.getDataRange().getValues();
      let foundRowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(tx.id)) {
          foundRowIndex = i + 1;
          break;
        }
      }

      const rowValues = [
        tx.id,
        tx.date,
        tx.type,
        tx.account,
        tx.category,
        tx.title,
        tx.memo || '',
        tx.amount,
        tx.paymentMethod || '체크카드',
        tx.evidenceNo || '',
        driveInfo.thumbnailUrl,
        driveInfo.driveUrl,
        tx.createdAt || now,
        now
      ];

      if (foundRowIndex > 0) {
        ledgerSheet.getRange(foundRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        ledgerSheet.appendRow(rowValues);
      }

      return ContentService.createTextOutput(
        JSON.stringify({
          ok: true,
          receiptImage: driveInfo.thumbnailUrl,
          receiptDriveUrl: driveInfo.driveUrl,
          syncedAt: now
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'DELETE_TRANSACTION' && body.id) {
      const rows = ledgerSheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][0]) === String(body.id)) {
          ledgerSheet.deleteRow(i + 1);
        }
      }
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, syncedAt: now })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'SYNC_ALL') {
      if (Array.isArray(body.transactions)) {
        ledgerSheet.clearContents();
        ledgerSheet.appendRow([
          'id', 'date', 'type', 'account', 'category', 'title', 'memo',
          'amount', 'paymentMethod', 'evidenceNo', 'receiptThumbnailUrl',
          'receiptDriveUrl', 'createdAt', 'updatedAt'
        ]);
        body.transactions.forEach(function(tx) {
          const driveInfo = saveReceiptToDrive(tx);
          ledgerSheet.appendRow([
            tx.id,
            tx.date,
            tx.type,
            tx.account,
            tx.category,
            tx.title,
            tx.memo || '',
            tx.amount,
            tx.paymentMethod || '체크카드',
            tx.evidenceNo || '',
            driveInfo.thumbnailUrl,
            driveInfo.driveUrl,
            tx.createdAt || now,
            now
          ]);
        });
      }

      if (body.budgets) {
        budgetSheet.clearContents();
        budgetSheet.appendRow(['templateType', 'jsonPayload', 'updatedAt']);
        Object.keys(body.budgets).forEach(function(key) {
          budgetSheet.appendRow([key, JSON.stringify(body.budgets[key]), now]);
        });
      }

      if (body.settings) {
        settingsSheet.clearContents();
        settingsSheet.appendRow(['key', 'value', 'updatedAt']);
        settingsSheet.appendRow(['app_settings', JSON.stringify(body.settings), now]);
      }

      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, syncedAt: now })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: 'Unknown action: ' + action })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(error) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
`;
