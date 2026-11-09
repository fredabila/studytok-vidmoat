/**
 * StudyTok → Google Sheets bridge and dashboard. Paste this into the Apps Script editor of the
 * "StudyTok — Users" spreadsheet (Extensions → Apps Script), set SECRET, then Deploy → New
 * deployment → Web app, "Execute as: Me", "Who has access: Anyone". Give the /exec URL to StudyTok
 * as STUDYTOK_SHEET_URL and the same secret as STUDYTOK_SHEET_SECRET. See scripts/sheet/README.md.
 *
 * StudyTok POSTs { secret, ops: [ { op: 'upsert'|'append', tab, key?, rows: [ {column: value} ] } ] }.
 * Row 1 of every tab is the header; new columns are added on the right as they appear.
 *
 * The script also builds a Dashboard tab (headline numbers, latest joins, top students,
 * breakdowns, charts) and styles the data tabs. Use the StudyTok menu in the sheet to rebuild it
 * or to pull fresh data from the app.
 */
var SECRET = 'PASTE_THE_SHARED_SECRET_HERE';
var APP_URL = 'https://studytok.vidmoat.com';

var PAPER = '#f6f1e7', INK = '#141414', INK3 = '#6f6a62', HL = '#ffd93d', HL_SOFT = '#fff3b0', LINE = '#e6dfd0', GREEN = '#d8f3e3', RED = '#ffe0e0';

// ---------------------------------------------------------------- web app (StudyTok writes here)
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
      if (!ss.getSheetByName('Dashboard')) buildDashboard_(ss);
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

// ---------------------------------------------------------------- menu (people use these)
function onOpen() {
  SpreadsheetApp.getUi().createMenu('StudyTok')
    .addItem('Rebuild dashboard', 'buildDashboard')
    .addItem('Pull fresh data from the app', 'refreshFromApp')
    .addItem('Show / hide ID columns', 'toggleIds')
    .addToUi();
}

function buildDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildDashboard_(ss);
  ss.toast('Dashboard rebuilt.', 'StudyTok', 4);
}

/** Asks StudyTok to resend every student (POST /api/admin/sheet/resync). */
function refreshFromApp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Asking the app for fresh data…', 'StudyTok', 5);
  var res = UrlFetchApp.fetch(APP_URL + '/api/admin/sheet/resync', { method: 'post', headers: { Authorization: 'Bearer ' + SECRET }, muteHttpExceptions: true });
  var text = res.getContentText();
  try { var j = JSON.parse(text); ss.toast(j.ok ? ('Refreshed ' + j.sent + ' of ' + j.users + ' students.') : ('Failed: ' + (j.error || text)), 'StudyTok', 6); }
  catch (err) { ss.toast('Failed: ' + text.slice(0, 120), 'StudyTok', 6); }
}

function toggleIds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  if (!sheet) return;
  var header = headerOf_(sheet);
  var cols = ['User ID', 'Vidmoat ID'].map(function (k) { return header.indexOf(k) + 1; }).filter(function (c) { return c > 0; });
  if (!cols.length) return;
  var hidden = sheet.isColumnHiddenByUser(cols[0]);
  cols.forEach(function (c) { if (hidden) sheet.showColumns(c); else sheet.hideColumns(c); });
}

// ---------------------------------------------------------------- writing rows
/** Returns the tab, creating and styling it when missing. */
function tab_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function headerOf_(sheet) {
  var lastCol = sheet.getLastColumn();
  return lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
}

/** The header row as an array, adding any new columns from `rows`. */
function header_(sheet, rows) {
  var header = headerOf_(sheet);
  var added = false;
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (k) { if (header.indexOf(k) === -1) { header.push(k); added = true; } });
  });
  if (added || !header.length) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    styleTab_(sheet, header);
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
  textColumns_(sheet, header);
  if (op.op === 'append') {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows.map(function (r) { return toValues_(header, r); }));
    return { tab: op.tab, appended: rows.length };
  }
  // upsert: match on the key column, update in place or append.
  var keyCol = header.indexOf(String(op.key || header[0]));
  if (keyCol === -1) keyCol = 0;
  // Keys are compared as text: the key column is formatted as plain text so Sheets never turns a
  // date like 2026-11-07 or a long id into a Date or a number.
  sheet.getRange(1, keyCol + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  var lastRow = sheet.getLastRow();
  var keys = lastRow > 1 ? sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); }) : [];
  var updated = 0, appended = [];
  rows.forEach(function (row) {
    var k = String(row[header[keyCol]]).trim();
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

// ---------------------------------------------------------------- styling the data tabs
var WIDTHS = { 'Member #': 70, 'User ID': 120, 'Name': 160, 'Email': 220, 'Vidmoat ID': 120, 'Joined': 150, 'Last seen': 150, 'Set up': 60, 'Level': 190, 'Country': 120, 'Institution': 220, 'Course': 220, 'Exam': 80, 'Age': 50, 'Managed by': 120, 'Interests': 220, 'Billing mode': 120, 'Own account': 170, 'Billing problem': 120, 'Device': 110, 'Platform': 90, 'Time zone': 140, 'Language': 80, 'Updated': 150, 'When': 150, 'Event': 180, 'Detail': 260, 'Date': 100 };

function styleTab_(sheet, header) {
  header = header || headerOf_(sheet);
  if (!header.length) return;
  var n = header.length;
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, n).setFontWeight('bold').setFontColor(INK).setBackground(HL_SOFT).setFontFamily('Inter').setFontSize(10).setWrap(false).setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);
  header.forEach(function (k, i) { sheet.setColumnWidth(i + 1, WIDTHS[k] || 90); });
  var body = sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), n);
  body.setFontFamily('Inter').setFontSize(10).setVerticalAlignment('middle');
  if (!sheet.getBandings().length) body.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  var name = sheet.getName();
  if (name === 'Users') {
    sheet.setFrozenColumns(3);
    ['User ID', 'Vidmoat ID'].forEach(function (k) { var c = header.indexOf(k) + 1; if (c) sheet.hideColumns(c); });
    var rules = [];
    var col = function (k) { return header.indexOf(k) + 1; };
    var letter = function (k) { return columnLetter_(col(k)); };
    var rows = sheet.getMaxRows() - 1;
    if (col('Billing mode')) rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('own account').setBackground(GREEN).setRanges([sheet.getRange(2, col('Billing mode'), rows)]).build());
    if (col('Billing problem')) rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(RED).setRanges([sheet.getRange(2, col('Billing problem'), rows)]).build());
    if (col('Last seen')) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($' + letter('Last seen') + '2,10)=TEXT(TODAY(),"yyyy-mm-dd")').setBackground(GREEN).setRanges([sheet.getRange(2, col('Last seen'), rows)]).build());
    ['Day streak', 'Lessons watched', 'Units mastered'].forEach(function (k) {
      if (col(k)) rules.push(SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint('#ffffff').setGradientMaxpoint(HL).setRanges([sheet.getRange(2, col(k), rows)]).build());
    });
    if (col('Name')) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter('Name') + '2=""').setFontColor('#9a948a').setRanges([sheet.getRange(2, 1, rows, n)]).build()); // guests without a Vidmoat account, greyed
    sheet.setConditionalFormatRules(rules);
  }
  if (name === 'Joins') sheet.setFrozenColumns(2);
}

/** Timestamps and ids stay plain text, so Sheets never turns "2026-11-08 17:44:33" into a date serial. */
var TEXT_COLUMNS = ['Joined', 'Last seen', 'Updated', 'When', 'Date', 'User ID', 'Vidmoat ID', 'Own account', 'Quiz accuracy', 'Row', 'Mean watch', 'Early leaves', 'Completion', 'Lift vs flat', 'Weight'];
function textColumns_(sheet, header) {
  header.forEach(function (k, i) { if (TEXT_COLUMNS.indexOf(k) !== -1) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@'); });
}

function columnLetter_(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }

// ---------------------------------------------------------------- the dashboard
function buildDashboard_(ss) {
  var users = tab_(ss, 'Users'), joins = tab_(ss, 'Joins'), daily = tab_(ss, 'Daily');
  // Make sure the tabs the formulas point at have their headers.
  if (!headerOf_(users).length) header_(users, [{ 'Member #': '', 'User ID': '', 'Name': '', 'Email': '', 'Vidmoat ID': '', 'Joined': '', 'Last seen': '', 'Set up': '', 'Level': '', 'Country': '', 'Institution': '', 'Course': '', 'Exam': '', 'Age': '', 'Managed by': '', 'Courses': '', 'Units': '', 'Interests': '', 'Lessons watched': '', 'Minutes watched': '', 'Sessions': '', 'Active days': '', 'Day streak': '', 'Quizzes': '', 'Quiz accuracy': '', 'Units mastered': '', 'Likes': '', 'Saves': '', 'Shares': '', 'Billing mode': '', 'Free lessons used': '', 'Own account': '', 'Own credits': '', 'Own plan': '', 'Billing problem': '', 'Device': '', 'Platform': '', 'Time zone': '', 'Language': '', 'Updated': '' }]);
  if (!headerOf_(joins).length) header_(joins, [{ 'When': '', 'Event': '', 'Member #': '', 'Name': '', 'Email': '', 'Level': '', 'Course': '', 'Detail': '' }]);
  if (!headerOf_(daily).length) header_(daily, [{ 'Date': '', 'New students': '', 'Total students': '', 'Active students': '', 'Lessons watched': '', 'Completed': '', 'Quiz answers': '', 'Quiz accuracy': '', 'Likes': '', 'Saves': '', 'Shares': '', 'Drops': '', 'Library size': '', 'Updated': '' }]);
  [users, joins, daily].forEach(function (s) { styleTab_(s); });
  var uh = headerOf_(users);
  var U = function (k) { var c = uh.indexOf(k) + 1; return c ? columnLetter_(c) : null; };
  var ur = function (k) { return 'Users!' + U(k) + '2:' + U(k); };

  var d = ss.getSheetByName('Dashboard');
  if (d) { d.clear(); d.getCharts().forEach(function (c) { d.removeChart(c); }); d.clearConditionalFormatRules(); d.getBandings().forEach(function (b) { b.remove(); }); }
  else d = ss.insertSheet('Dashboard', 0);
  ss.setActiveSheet(d); ss.moveActiveSheet(1);
  d.setHiddenGridlines(true);
  d.getRange(1, 1, d.getMaxRows(), d.getMaxColumns()).setBackground(PAPER).setFontFamily('Inter').setFontColor(INK);
  for (var c = 1; c <= 14; c++) d.setColumnWidth(c, 118);
  d.setColumnWidth(1, 150); d.setColumnWidth(7, 40);

  // Title
  d.getRange('A1').setValue('StudyTok').setFontSize(30).setFontWeight('bold').setFontFamily('Fraunces');
  d.getRange('A1:F1').setBackground(HL);
  d.getRange('A2').setFormula('="Live from the app · last update " & IFERROR(SORTN(' + ur('Updated') + ',1,0,1,FALSE),"—") & " (UTC)"').setFontColor(INK3).setFontSize(11);
  d.getRange('H1').setValue('Rows update by themselves as students use StudyTok. Menu StudyTok ▸ Pull fresh data to force a refresh.').setFontColor(INK3).setFontSize(10).setWrap(true);
  d.getRange('H1:N2').merge();
  d.setRowHeight(1, 46); d.setRowHeight(2, 24);

  // KPI tiles: two rows of six (label over value), each two columns wide
  var today = 'TEXT(TODAY(),"yyyy-mm-dd")', weekAgo = 'TEXT(TODAY()-7,"yyyy-mm-dd")';
  var tiles = [
    ['Students', '=COUNTA(' + ur('User ID') + ')'],
    ['Signed in with Vidmoat', '=COUNTA(' + ur('Email') + ')'],
    ['Active today', '=SUMPRODUCT(LEFT(' + ur('Last seen') + ',10)>=' + today + ')'],
    ['Active this week', '=SUMPRODUCT(LEFT(' + ur('Last seen') + ',10)>=' + weekAgo + ')'],
    ['Joined this week', '=SUMPRODUCT(LEFT(' + ur('Joined') + ',10)>=' + weekAgo + ')'],
    ['On their own credits', '=COUNTIF(' + ur('Billing mode') + ',"own account")'],
    ['Lessons watched', '=SUM(' + ur('Lessons watched') + ')'],
    ['Minutes watched', '=SUM(' + ur('Minutes watched') + ')'],
    ['Quiz answers', '=SUM(' + ur('Quizzes') + ')'],
    ['Units mastered', '=SUM(' + ur('Units mastered') + ')'],
    ['Likes + saves', '=SUM(' + ur('Likes') + ')+SUM(' + ur('Saves') + ')'],
    ['Cards shared', '=SUM(' + ur('Shares') + ')'],
  ];
  tiles.forEach(function (t, i) {
    var row = 4 + Math.floor(i / 6) * 3, col = 1 + (i % 6) * 2 + (i % 6 >= 3 ? 1 : 0); // G is a narrow spacer
    var label = d.getRange(row, col, 1, 2), value = d.getRange(row + 1, col, 1, 2);
    label.merge().setValue(t[0]).setFontSize(9).setFontColor(INK3).setBackground('#ffffff').setVerticalAlignment('bottom').setHorizontalAlignment('left');
    value.merge().setFormula(t[1]).setFontSize(26).setFontWeight('bold').setFontFamily('Fraunces').setBackground('#ffffff').setVerticalAlignment('top').setHorizontalAlignment('left').setNumberFormat('#,##0');
    d.getRange(row, col, 2, 2).setBorder(true, true, true, true, false, false, LINE, SpreadsheetApp.BorderStyle.SOLID);
  });
  d.setRowHeight(4, 26); d.setRowHeight(5, 48); d.setRowHeight(7, 26); d.setRowHeight(8, 48);

  // Latest joins (left) and top students (right)
  section_(d, 'A11', 'Latest joins and milestones');
  d.getRange('A12').setFormula('=IFERROR(QUERY(Joins!A:H,"select A,B,D,G,H where A is not null order by A desc limit 14 label A \'When (UTC)\', B \'What\', D \'Who\', G \'Course\', H \'Detail\'",1),"Nothing yet. Joins appear here as they happen.")');
  section_(d, 'H11', 'Most active students (signed in)');
  d.getRange('H12').setFormula('=IFERROR(QUERY(Users!A:' + U('Updated') + ',"select A,C,L,' + U('Lessons watched') + ',' + U('Day streak') + ',' + U('Units mastered') + ',' + U('Billing mode') + ' where C is not null and ' + U('Lessons watched') + ' > 0 order by ' + U('Lessons watched') + ' desc limit 14 label A \'#\', C \'Name\', L \'Course\', ' + U('Lessons watched') + ' \'Lessons\', ' + U('Day streak') + ' \'Streak\', ' + U('Units mastered') + ' \'Mastered\', ' + U('Billing mode') + ' \'Credits\'",1),"No activity yet.")');
  tableStyle_(d, 'A12:F26'); tableStyle_(d, 'H12:N26');

  // Breakdowns
  section_(d, 'A28', 'By level');
  d.getRange('A29').setFormula('=IFERROR(QUERY(Users!A:' + U('Updated') + ',"select I, count(B), sum(' + U('Lessons watched') + ') where B is not null group by I order by count(B) desc label I \'Level\', count(B) \'Students\', sum(' + U('Lessons watched') + ') \'Lessons\'",1),"—")');
  section_(d, 'E28', 'By country');
  d.getRange('E29').setFormula('=IFERROR(QUERY(Users!A:' + U('Updated') + ',"select J, count(B) where B is not null group by J order by count(B) desc label J \'Country\', count(B) \'Students\'",1),"—")');
  section_(d, 'H28', 'Courses students chose');
  d.getRange('H29').setFormula('=IFERROR(QUERY(Users!A:' + U('Updated') + ',"select L, count(B) where L is not null group by L order by count(B) desc limit 10 label L \'Course\', count(B) \'Students\'",1),"—")');
  section_(d, 'L28', 'Credits');
  d.getRange('L29').setFormula('=IFERROR(QUERY(Users!A:' + U('Updated') + ',"select ' + U('Billing mode') + ', count(B) where B is not null group by ' + U('Billing mode') + ' label ' + U('Billing mode') + ' \'Mode\', count(B) \'Students\'",1),"—")');
  tableStyle_(d, 'A29:C40'); tableStyle_(d, 'E29:F40'); tableStyle_(d, 'H29:J40'); tableStyle_(d, 'L29:N40');

  // Charts from the Daily tab
  section_(d, 'A42', 'Day by day');
  var dh = headerOf_(daily);
  var D = function (k) { return dh.indexOf(k) + 1; };
  var last = Math.max(2, daily.getLastRow());
  var chart1 = d.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(daily.getRange(1, D('Date'), last)).addRange(daily.getRange(1, D('New students'), last)).addRange(daily.getRange(1, D('Active students'), last))
    .setOption('title', 'Students: new and active per day').setOption('legend', { position: 'bottom' }).setOption('colors', ['#141414', '#e0b400']).setOption('backgroundColor', '#ffffff')
    .setOption('useFirstColumnAsDomain', true).setNumHeaders(1).setPosition(43, 1, 0, 0).setOption('width', 560).setOption('height', 300).build();
  var chart2 = d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(daily.getRange(1, D('Date'), last)).addRange(daily.getRange(1, D('Lessons watched'), last)).addRange(daily.getRange(1, D('Completed'), last))
    .setOption('title', 'Lessons watched and completed per day').setOption('legend', { position: 'bottom' }).setOption('colors', ['#ffd93d', '#141414']).setOption('backgroundColor', '#ffffff')
    .setOption('useFirstColumnAsDomain', true).setNumHeaders(1).setPosition(43, 8, 0, 0).setOption('width', 560).setOption('height', 300).build();
  d.insertChart(chart1); d.insertChart(chart2);
  d.getRange('A60').setValue('Tabs: Users (one row per student, hover a column header for its meaning), Joins (every sign-up and milestone), Daily (one row per day). ID columns are hidden; StudyTok ▸ Show / hide ID columns reveals them.').setFontColor(INK3).setFontSize(9);
  d.getRange('A60:N60').merge().setWrap(true);
  ss.setActiveSheet(d);
}

function section_(d, a1, title) {
  d.getRange(a1).setValue(title).setFontSize(13).setFontWeight('bold').setFontFamily('Fraunces');
}

function tableStyle_(d, a1) {
  var r = d.getRange(a1);
  r.setBackground('#ffffff').setFontSize(10).setBorder(true, true, true, true, false, false, LINE, SpreadsheetApp.BorderStyle.SOLID);
  d.getRange(r.getRow(), r.getColumn(), 1, r.getNumColumns()).setFontWeight('bold').setBackground(HL_SOFT);
}
