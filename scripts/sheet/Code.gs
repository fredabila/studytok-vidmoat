/**
 * StudyTok → Google Sheets bridge. Paste this into the Apps Script editor of the "StudyTok — Users"
 * spreadsheet (Extensions → Apps Script), set SECRET, then Deploy → New deployment → Web app,
 * "Execute as: Me", "Who has access: Anyone". Give the /exec URL to StudyTok as STUDYTOK_SHEET_URL
 * and the same secret as STUDYTOK_SHEET_SECRET. See scripts/sheet/README.md.
 *
 * StudyTok POSTs { secret, ops: [ { op: 'upsert'|'append', tab, key?, rows: [ {column: value} ] } ] }.
 * Row 1 of every tab is the header; new columns are added on the right as they appear.
 */
var SECRET = 'PASTE_THE_SHARED_SECRET_HERE';

function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (!SECRET || body.secret !== SECRET) return json_({ ok: false, error: 'bad secret' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var results = (body.ops || []).map(function (op) { return applyOp_(ss, op); });
      out = { ok: true, results: results };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return json_(out);
}

function doGet() {
  return json_({ ok: true, service: 'studytok-sheet', tabs: SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function (s) { return s.getName(); }) });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Returns the tab, creating it (with a frozen, bold header) when missing. */
function tab_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** The header row as an array, adding any new columns from `rows`. */
function header_(sheet, rows) {
  var lastCol = sheet.getLastColumn();
  var header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var added = false;
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (k) { if (header.indexOf(k) === -1) { header.push(k); added = true; } });
  });
  if (added || !lastCol) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#fff3b0');
    sheet.setFrozenRows(1);
  }
  return header;
}

function toValues_(header, row) {
  return header.map(function (k) { var v = row[k]; return v === undefined || v === null ? '' : v; });
}

function applyOp_(ss, op) {
  var rows = Array.isArray(op.rows) ? op.rows : [];
  if (!rows.length) return { tab: op.tab, n: 0 };
  var sheet = tab_(ss, String(op.tab || 'Sheet1'));
  var header = header_(sheet, rows);
  if (op.op === 'append') {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows.map(function (r) { return toValues_(header, r); }));
    return { tab: op.tab, appended: rows.length };
  }
  // upsert: match on the key column, update in place or append.
  var keyCol = header.indexOf(String(op.key || header[0]));
  if (keyCol === -1) keyCol = 0;
  var lastRow = sheet.getLastRow();
  var keys = lastRow > 1 ? sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var updated = 0, appended = [];
  rows.forEach(function (row) {
    var k = String(row[header[keyCol]]);
    var i = keys.indexOf(k);
    if (i === -1) { appended.push(toValues_(header, row)); keys.push(k); }
    else { sheet.getRange(i + 2, 1, 1, header.length).setValues([toValues_(header, row)]); updated++; }
  });
  if (appended.length) sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, header.length).setValues(appended);
  // Keep the Users tab ordered by member number when that column exists.
  var memberCol = header.indexOf('Member #');
  if (memberCol !== -1 && appended.length && sheet.getLastRow() > 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).sort({ column: memberCol + 1, ascending: true });
  return { tab: op.tab, updated: updated, appended: appended.length };
}
