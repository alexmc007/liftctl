/**
 * SetClock sync — Google Apps Script backend.
 *
 * Browser storage is per device, so the phone and the laptop are two separate
 * copies of the log. This holds one shared copy: the whole app state as a JSON
 * blob chunked down column A of a hidden "_State" sheet, with a revision number
 * so a stale device cannot clobber a newer one.
 *
 * SETUP (once, about two minutes)
 *   1. Go to sheets.new and make a blank spreadsheet. Name it anything.
 *   2. Extensions → Apps Script. Delete whatever is in the editor.
 *   3. Paste this whole file in and Save.
 *   4. Deploy → New deployment → type "Web app".
 *        Execute as:        Me
 *        Who has access:    Anyone
 *      Deploy, approve the permissions prompt, and copy the /exec URL.
 *   5. In SetClock: More → Plan → Sync → paste that URL → Connect.
 *
 * "Anyone" means anyone holding the URL can read and write this sheet, so treat
 * the URL like a password. It is training data, not credentials, but do not
 * post it anywhere public.
 */

var CHUNK = 45000;      /* a cell holds 50k characters; leave headroom */
var MAX_CHUNKS = 40;    /* ~1.8 MB of state, far beyond a few years of lifting */
var TAG = 'SCv1|';

/* Leave blank to use the spreadsheet this script is bound to. Only set it if
   you run the script standalone rather than from Extensions → Apps Script. */
var SHEET_ID = '';

function getSS_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No bound spreadsheet — set SHEET_ID at the top of the script.');
  return ss;
}

function stateSheet_() {
  var ss = getSS_();
  var sh = ss.getSheetByName('_State');
  if (!sh) { sh = ss.insertSheet('_State'); sh.hideSheet(); }
  return sh;
}

function getState_() {
  try {
    var sh = stateSheet_();
    var meta = String(sh.getRange(1, 1).getValue() || '');
    if (meta.indexOf(TAG) !== 0) return '';
    var n = parseInt(meta.split('|')[1], 10) || 0;
    if (n <= 0) return '';
    var vals = sh.getRange(2, 1, n, 1).getValues(), out = '';
    for (var i = 0; i < n; i++) out += String(vals[i][0] || '');
    return out;
  } catch (e) { return ''; }
}

function saveState_(json) {
  var sh = stateSheet_();
  var s = String(json || '');
  if (s.length > CHUNK * MAX_CHUNKS) throw new Error('state too large');
  var chunks = [];
  for (var i = 0; i < s.length; i += CHUNK) chunks.push([s.substr(i, CHUNK)]);
  if (!chunks.length) chunks = [['']];
  sh.getRange(1, 1).setValue(TAG + chunks.length);
  sh.getRange(2, 1, MAX_CHUNKS, 1).clearContent();
  sh.getRange(2, 1, chunks.length, 1).setValues(chunks);
  return true;
}

/* revision bookkeeping lives in B1 rev, C1 updated, D1 device */
function meta_() {
  var v = stateSheet_().getRange(1, 2, 1, 3).getValues()[0];
  return { rev: parseInt(v[0], 10) || 0, updatedAt: String(v[1] || ''), device: String(v[2] || '') };
}
function setMeta_(rev, device) {
  stateSheet_().getRange(1, 2, 1, 3)
    .setValues([[rev, new Date().toISOString(), String(device || '')]]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- HTTP ---------- */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    var m = meta_();
    if (action === 'get') {
      return json_({ ok: true, rev: m.rev, updatedAt: m.updatedAt, device: m.device, state: getState_() });
    }
    /* ping: cheap enough to call on every app load */
    return json_({ ok: true, service: 'setclock-sync', rev: m.rev, updatedAt: m.updatedAt, device: m.device });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* The app posts text/plain on purpose: any other content type makes the browser
   send a CORS preflight, and Apps Script never answers OPTIONS. */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var m = meta_();
      /* a device that started from an older revision must pull and merge first */
      if (body.baseRev !== undefined && Number(body.baseRev) < m.rev && !body.force) {
        return json_({ ok: false, conflict: true, rev: m.rev, updatedAt: m.updatedAt,
                       device: m.device, state: getState_() });
      }
      saveState_(body.state || '');
      var rev = m.rev + 1;
      setMeta_(rev, body.device || '');
      return json_({ ok: true, rev: rev });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* Run this once from the editor to confirm the sheet side works before
   touching the app. It should log ok:true and a rev number. */
function selfTest() {
  saveState_(JSON.stringify({ hello: 'setclock', at: new Date().toISOString() }));
  setMeta_(meta_().rev + 1, 'selftest');
  Logger.log(JSON.stringify({ ok: true, meta: meta_(), state: getState_() }));
}

function getAppUrl() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
