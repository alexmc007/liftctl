/* ============================================================
   LiftCtl — Apps Script sync backend (for the v11 web app).

   The app is served by GitHub Pages, so google.script.run is not
   available: this exposes the same state over plain HTTP instead.

   Storage is unchanged and backward compatible with the old app:
   one JSON blob chunked across _State!A2:A21, with A1 = "LCv1|<chunks>".
   B1/C1/D1 hold the revision, timestamp and last device — cells the
   old script never touches, so /legacy/ keeps working.

   SETUP (once):
     1. Open the Google Sheet the old app used → Extensions → Apps Script.
     2. Paste this over Code.gs (keep any Index.html file that is there).
     3. Deploy → New deployment → type "Web app"
          Execute as:  Me
          Who has access:  Anyone
     4. Copy the /exec URL → paste it into LiftCtl → Settings → Sync.
   After any edit to this file you must Deploy → Manage deployments →
   edit → New version, or the URL keeps serving the old code.
   ============================================================ */

var CHUNK = 40000;
var MAX_CHUNKS = 20;

/* Standalone scripts have no active spreadsheet, so put the target sheet id
   here (the long string in its /spreadsheets/d/<ID>/edit URL). Leave it empty
   if this script is bound to the sheet via Extensions > Apps Script. */
var SHEET_ID = '';

/* ---------- storage ---------- */

function getSS_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SSID');
  return id ? SpreadsheetApp.openById(id) : null;
}

function stateSheet_() {
  var ss = getSS_();
  if (!ss) throw new Error('No spreadsheet bound to this script');
  try { PropertiesService.getScriptProperties().setProperty('SSID', ss.getId()); } catch (e) {}
  var sh = ss.getSheetByName('_State');
  if (!sh) { sh = ss.insertSheet('_State'); sh.hideSheet(); }
  return sh;
}

function getState() {
  try {
    var sh = stateSheet_();
    var meta = String(sh.getRange(1, 1).getValue() || '');
    if (meta.indexOf('LCv1|') !== 0) return meta || '';   /* legacy single-cell fallback */
    var n = parseInt(meta.split('|')[1], 10) || 0;
    if (n <= 0) return '';
    var vals = sh.getRange(2, 1, n, 1).getValues();
    var out = '';
    for (var i = 0; i < n; i++) out += String(vals[i][0] || '');
    return out;
  } catch (e) { return ''; }
}

function saveState(json) {
  var sh = stateSheet_();
  var s = String(json || '');
  var chunks = [];
  for (var i = 0; i < s.length && chunks.length < MAX_CHUNKS; i += CHUNK) chunks.push([s.substr(i, CHUNK)]);
  if (!chunks.length) chunks = [['']];
  sh.getRange(1, 1).setValue('LCv1|' + chunks.length);
  sh.getRange(2, 1, MAX_CHUNKS, 1).clearContent();
  sh.getRange(2, 1, chunks.length, 1).setValues(chunks);
  return true;
}

/* revision bookkeeping — B1 rev, C1 updated, D1 device */
function meta_() {
  var sh = stateSheet_();
  var v = sh.getRange(1, 2, 1, 3).getValues()[0];
  return { rev: parseInt(v[0], 10) || 0, updatedAt: String(v[1] || ''), device: String(v[2] || '') };
}
function setMeta_(rev, device) {
  var sh = stateSheet_();
  sh.getRange(1, 2, 1, 3).setValues([[rev, new Date().toISOString(), String(device || '')]]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- HTTP ---------- */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'get') {
    var m = meta_();
    return json_({ ok: true, rev: m.rev, updatedAt: m.updatedAt, device: m.device, state: getState() });
  }
  if (action === 'ping') {
    var m2 = meta_();
    return json_({ ok: true, rev: m2.rev, updatedAt: m2.updatedAt, device: m2.device, bytes: getState().length });
  }
  /* No action: keep serving the old bundled app if this project still has it. */
  try {
    var t = HtmlService.createTemplateFromFile('Index');
    return t.evaluate().setTitle('LiftCtl')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    /* No Index file — answer as the sync service. Opening the /exec URL in a
       browser should confirm the deployment works, so never throw here. */
    var rev = -1;
    try { rev = meta_().rev; } catch (e2) {}
    return json_({ ok: rev >= 0, service: 'LiftCtl sync', rev: rev,
                   note: rev >= 0 ? 'ready' : 'no spreadsheet bound to this script — open the Sheet and use Extensions > Apps Script' });
  }
}

/* Posts arrive as text/plain so the browser sends no CORS preflight. */
function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (pe) { return json_({ ok: false, error: 'bad json' }); }

  if (String(body.kind) === 'state') return saveStateHttp_(body);
  if (String(body.kind) === 'health') return health_(body);
  return json_({ ok: false, error: 'unknown kind' });
}

/* Optimistic concurrency: the client sends the revision it based its
   copy on. If the sheet moved on since then, we refuse the write and
   hand back the current state so the client can merge and retry —
   a stale tab can never delete a session logged on the other device. */
function saveStateHttp_(body) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (le) { return json_({ ok: false, error: 'busy' }); }
  try {
    var m = meta_();
    var base = (body.baseRev == null) ? null : (parseInt(body.baseRev, 10) || 0);
    if (base !== null && base !== m.rev) {
      return json_({ ok: false, conflict: true, rev: m.rev, updatedAt: m.updatedAt, device: m.device, state: getState() });
    }
    var s = String(body.state || '');
    if (s.length < 2) return json_({ ok: false, error: 'empty state refused' });
    if (s.length > CHUNK * MAX_CHUNKS) return json_({ ok: false, error: 'state too large' });
    saveState(s);
    var rev = m.rev + 1;
    setMeta_(rev, body.device);
    return json_({ ok: true, rev: rev, updatedAt: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (re) {}
  }
}

/* ---------- iOS Shortcuts inbound (unchanged behaviour) ----------
   {kind:'health', vo2value, vo2date} or {kind:'health', avghr, maxhr, machine, date} */
function health_(body) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (le) { return json_({ ok: false, error: 'busy' }); }
  try {
    var st = getState(), S = {};
    try { S = st ? JSON.parse(st) : {}; } catch (pe) { S = {}; }
    S.cardio = S.cardio || {};
    var C = S.cardio, added = 0;

    C.vo2Log = Array.isArray(C.vo2Log) ? C.vo2Log : [];
    var samples = [];
    if (body.vo2value != null) samples.push({ date: body.vo2date, value: body.vo2value });
    (body.vo2 || []).forEach(function (s) { samples.push(s); });
    samples.forEach(function (s) {
      if (!s) return;
      var d = String(s.date || '').slice(0, 10), v = parseFloat(s.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(v > 15 && v < 90)) return;
      var ex = C.vo2Log.filter(function (x) { return x.date === d; })[0];
      if (ex) { ex.value = v; ex.source = 'health'; } else { C.vo2Log.push({ date: d, value: v, source: 'health' }); added++; }
    });
    C.vo2Log.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (C.vo2Log.length > 120) C.vo2Log = C.vo2Log.slice(-120);

    if (body.avghr != null) {
      var hr = Math.round(parseFloat(body.avghr) || 0);
      if (hr >= 60 && hr <= 215) {
        C.hrLog = Array.isArray(C.hrLog) ? C.hrLog : [];
        C.hrLog.push({ date: String(body.date || '').slice(0, 10), machine: String(body.machine || ''),
                       avgHR: hr, maxHR: Math.round(parseFloat(body.maxhr) || 0) || 0 });
        if (C.hrLog.length > 60) C.hrLog = C.hrLog.slice(-60);
        added++;
      }
    }
    S._upd = Date.now();
    saveState(JSON.stringify(S));
    setMeta_(meta_().rev + 1, 'shortcut');
    return json_({ ok: true, added: added });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (re) {}
  }
}

function getAppUrl() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }
