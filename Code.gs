// ============================================================
//  GOOGLE APPS SCRIPT — ระบบจำหน่ายบุคลากร กองบิน ๒๓
// ============================================================

function doGet(e) {
  e = e || {};
  e.parameter = e.parameter || {};
  const action = e.parameter.action || '';
  let result;

  if      (action === 'ping')          result = { ok: true };   // ใช้ "อุ่นเครื่อง" GAS ตอนเปิดหน้าล็อกอิน
  else if (action === 'getDepts')      result = getDepts();
  else if (action === 'getLeaves')     result = getLeaves(e.parameter);
  else if (action === 'getStatusData') result = getStatusData();
  else result = { error: 'Unknown action: ' + action };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Invalid JSON body' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const action = data.action;
  let result;

  if      (action === 'login')       result = handleLogin(data);
  else if (action === 'saveLeave')   result = withLeavesLock_(function () { return saveLeave(data); });
  else if (action === 'deleteLeave') result = withLeavesLock_(function () { return deleteLeave(data); });
  else if (action === 'saveDepts')   result = saveDepts(data.depts);
  else result = { error: 'Unknown action: ' + action };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================
//  Login — ตรวจ username / password กับชีต "login"
//
//  ชีต "login" ต้องมีหัวตาราง (แถวที่ 1) 3 คอลัมน์ ลำดับไหนก็ได้:
//      username | password | name
//  - username ไม่สนตัวพิมพ์เล็ก/ใหญ่ ส่วน password ต้องตรงตามตัวอักษร
//  - name คือชื่อที่จะแสดงหลังล็อกอิน
//
//  การเทียบทำฝั่งเซิร์ฟเวอร์ทั้งหมด เบราว์เซอร์ไม่เคยได้รับข้อมูลในชีตนี้
//  กันเดารหัส: ผิดครบ 5 ครั้ง (ต่อ username) จะถูกล็อก 10 นาที
//  บันทึกประวัติการเข้าระบบ (สำเร็จ/ล้มเหลว) ที่ชีต "loginLog" — ไม่บันทึกรหัสผ่าน
// =============================================================
const LOGIN_SHEET     = 'login';
const LOGIN_LOG_SHEET = 'loginLog';
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_SEC  = 600;   // 10 นาที

// ครอบเพื่อวัดเวลาทำงานฝั่งเซิร์ฟเวอร์ (ms) ส่งกลับไปให้หน้าเว็บ log ใน console ไว้ไล่ปัญหาความช้า
function handleLogin(data) {
  const t0 = Date.now();
  const r = handleLoginCore_(data);
  r.ms = Date.now() - t0;
  return r;
}

function handleLoginCore_(data) {
  data = data || {};
  const username = String(data.username || '').trim();
  const password = String(data.password || '').trim();
  if (!username || !password) {
    return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  }

  const cache   = CacheService.getScriptCache();
  const failKey = 'loginfail_' + md5Hex_(username.toLowerCase());
  const fails   = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= LOGIN_MAX_FAILS) {
    writeLoginLog_(username, '', 'ถูกล็อก (ลองผิดเกินกำหนด)');
    return { success: false, locked: true,
             message: 'ลองผิดหลายครั้งเกินไป กรุณารอ 10 นาทีแล้วลองใหม่' };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOGIN_SHEET);
  if (!sheet) {
    return { success: false, message: 'ไม่พบชีต "' + LOGIN_SHEET + '" ในระบบ กรุณาติดต่อแอดมิน' };
  }

  const values = sheet.getDataRange().getValues();
  const head   = (values[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  const iU = head.indexOf('username'), iP = head.indexOf('password'), iN = head.indexOf('name');
  if (iU < 0 || iP < 0 || iN < 0) {
    return { success: false, message: 'ชีต "' + LOGIN_SHEET + '" ต้องมีหัวตาราง username, password, name' };
  }

  const uLower = username.toLowerCase();
  let found = null;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[iU]).trim().toLowerCase() !== uLower) continue;
    if (safeEqual_(String(row[iP]).trim(), password)) { found = row; break; }
  }

  if (!found) {
    cache.put(failKey, String(fails + 1), LOGIN_LOCK_SEC);
    writeLoginLog_(username, '', 'ล้มเหลว');
    Utilities.sleep(400);   // หน่วงเล็กน้อย ให้การเดารหัสช้าลง
    return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  cache.remove(failKey);
  const name = String(found[iN] || '').trim() || username;
  writeLoginLog_(username, name, 'สำเร็จ');
  return { success: true, name: name, username: username };
}

// เทียบสตริงแบบใช้เวลาเท่ากันไม่ว่าจะผิดตัวไหน
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function md5Hex_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function writeLoginLog_(username, name, result) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let log = ss.getSheetByName(LOGIN_LOG_SHEET);
    if (!log) {
      log = ss.insertSheet(LOGIN_LOG_SHEET);
      log.appendRow(['วันที่', 'เวลา', 'username', 'ชื่อ', 'ผลลัพธ์']);
    }
    const now = new Date(), tz = Session.getScriptTimeZone();
    log.appendRow([
      Utilities.formatDate(now, tz, 'dd/MM/yyyy'),
      Utilities.formatDate(now, tz, 'HH:mm:ss'),
      username, name, result
    ]);
  } catch (err) {
    // เขียน log ไม่ได้ ไม่ควรทำให้ล็อกอินล้ม
  }
}

// =============================================================
//  Departments
//  ── เพิ่ม cache ฝั่งเซิร์ฟเวอร์ (CacheService) ──
//  แผนกแทบไม่เปลี่ยนบ่อย จึงแคชผลลัพธ์ไว้ 30 นาที
//  ทำให้ครั้งถัดๆ ไปไม่ต้องเปิด/อ่านชีตใหม่ทุกครั้ง (เร็วขึ้นมาก)
// =============================================================
const DEPTS_CACHE_KEY = 'depts_v2';
const DEPTS_CACHE_TTL = 1800; // 30 นาที (ล้างทันทีเมื่อ saveDepts หรือแก้ชีต Departments ด้วยมือ)

function getDepts() {
  const cache = CacheService.getScriptCache();
  const hit = readChunked_(cache, DEPTS_CACHE_KEY);
  if (hit) {
    const out = {};
    hit.forEach(function (pair) { out[pair[0]] = pair[1]; });
    return out;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Departments');

  if (!sheet) {
    sheet = ss.insertSheet('Departments');
    sheet.getRange('A1:B1').setValues([['Department', 'Employees']]);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 300);
  }

  const data   = sheet.getDataRange().getValues();
  const result = {};

  for (let i = 1; i < data.length; i++) {
    const dept     = data[i][0] == null ? '' : String(data[i][0]).trim();
    const empsCell = data[i][1] == null ? '' : String(data[i][1]).trim();
    if (!dept && !empsCell) continue;
    const key = dept || 'ไม่ระบุ';
    if (!result[key]) result[key] = [];
    if (empsCell) {
      const parts = empsCell.split(/[,\n;\/]+/).map(s => s.trim()).filter(Boolean);
      result[key] = result[key].concat(parts);
    }
  }

  // สร้าง Collator ครั้งเดียวแล้วใช้ซ้ำ — localeCompare(…, 'th') ในลูป sort สร้างตัวเทียบใหม่ทุกคู่ ช้ามากเมื่อรายชื่อเยอะ
  let cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  try { cmp = new Intl.Collator('th').compare; } catch (err) {}

  Object.keys(result).forEach(k => {
    result[k] = [...new Set(result[k])];
    result[k].sort(cmp);
  });

  writeChunked_(cache, DEPTS_CACHE_KEY,
    Object.keys(result).map(function (k) { return [k, result[k]]; }),
    DEPTS_CACHE_TTL);

  return result;
}

function saveDepts(depts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Departments');
  if (!sheet) sheet = ss.insertSheet('Departments');
  sheet.clearContents();
  sheet.getRange('A1:B1').setValues([['Department', 'Employees']]);
  let row = 2;
  for (const [dept, emps] of Object.entries(depts)) {
    sheet.getRange(row, 1).setValue(dept);
    sheet.getRange(row, 2).setValue(Array.isArray(emps) ? emps.join(',') : String(emps));
    row++;
  }
  // แผนกเปลี่ยนแล้ว → ล้าง cache ทันที ไม่งั้นจะเห็นข้อมูลเก่าไปอีก 30 นาที
  invalidateDeptsCache_();
  return { success: true, message: 'บันทึกแผนกแล้ว' };
}

// =============================================================
//  Helper: normalize date → "YYYY-MM-DD"
//  รองรับทุก format ที่พบจริงใน Sheets:
//  1) YYYYMMDD number เช่น 20260514  → "2026-05-14"
//  2) Date object                     → formatDate yyyy-MM-dd
//  3) Sheets Serial number (< 100000) → แปลงจาก epoch
//  4) String "yyyy-MM-dd"             → คืนตรง
//  5) String "yyyy-M-d"               → เติม leading zero
//  6) String "dd/MM/yyyy"             → สลับ
// =============================================================
function normDate(val) {
  if (val === null || val === undefined || val === '') return '';

  // Date Object
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val)) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  // ตัวเลข
  if (typeof val === 'number') {
    var n = Math.round(val);

    // YYYYMMDD เช่น 20260514 (ตัวเลข 8 หลัก ปี > 9999*365)
    if (n >= 19000101 && n <= 21001231) {
      var ys = String(n).slice(0, 4);
      var ms = String(n).slice(4, 6);
      var ds = String(n).slice(6, 8);
      return ys + '-' + ms + '-' + ds;
    }

    // Sheets Serial Number (ตัวเลขน้อยกว่า 19000101)
    var jsDate = new Date(Math.round((n - 25569) * 86400000));
    return Utilities.formatDate(jsDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var s = String(val).trim();
  if (!s) return '';

  // YYYYMMDD string เช่น "20260514"
  if (/^\d{8}$/.test(s)) {
    return s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8);
  }

  // yyyy-MM-dd (leading zero ครบ)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // yyyy-M-d (ไม่มี leading zero)
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const p = s.split('-');
    return p[0] + '-' + p[1].padStart(2,'0') + '-' + p[2].padStart(2,'0');
  }

  // dd/MM/yyyy หรือ d/M/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const p = s.split('/');
    return p[2] + '-' + p[1].padStart(2,'0') + '-' + p[0].padStart(2,'0');
  }

  return s;
}

// =============================================================
//  Leaves (การจำหน่าย)
//  Sheet "Leaves": A=Name B=Department C=LeaveType D=DateFrom E=DateTo F=Remark G=CreatedAt
// =============================================================
function ensureLeavesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Leaves');
  if (!sheet) {
    sheet = ss.insertSheet('Leaves');
    sheet.getRange('A1:G1').setValues([['Name','Department','LeaveType','DateFrom','DateTo','Remark','CreatedAt']]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 7, 130);
    const hdr = sheet.getRange('A1:G1');
    hdr.setBackground('#1a1a2e');
    hdr.setFontColor('#ffffff');
    hdr.setFontWeight('bold');
  }
  return sheet;
}

function saveLeave(data) {
  if (!data.name || !data.leaveType || !data.dateFrom || !data.dateTo) {
    return { success: false, message: 'ข้อมูลไม่ครบ' };
  }

  const newFrom   = normDate(data.dateFrom);
  const newTo     = normDate(data.dateTo);
  const sheet     = ensureLeavesSheet();
  const rows      = sheet.getDataRange().getValues();
  const conflicts = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    if (String(row[0]).trim() !== String(data.name).trim()) continue;
    const exFrom = normDate(row[3]);
    const exTo   = normDate(row[4]);
    if (!exFrom || !exTo) continue;
    if (newFrom <= exTo && newTo >= exFrom) {
      conflicts.push({ leaveType: String(row[2]), dateFrom: exFrom, dateTo: exTo });
    }
  }

  if (conflicts.length > 0) {
    const TH_M = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    function thDate(s) {
      if (!s) return s;
      const p = s.split('-');
      return `${+p[2]} ${TH_M[+p[1]]} ${+p[0]+543}`;
    }
    const detail = conflicts.map(c =>
      `• ${c.leaveType}: ${thDate(c.dateFrom)}${c.dateFrom !== c.dateTo ? ' → ' + thDate(c.dateTo) : ''}`
    ).join('\n');
    return { success: false, duplicate: true, message: `${data.name} มีรายการที่วันที่ซ้ำกันอยู่แล้ว:\n${detail}` };
  }

  const tz = Session.getScriptTimeZone();
  sheet.appendRow([
    data.name,
    data.dept      || '',
    data.leaveType,
    normDate(data.dateFrom),
    normDate(data.dateTo),
    data.remark    || '',
    Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss')
  ]);
  return { success: true, message: 'บันทึกการจำหน่ายเรียบร้อย' };
}

function deleteLeave(data) {
  if (!data.name || !data.dateFrom || !data.dateTo) {
    return { success: false, message: 'ข้อมูลไม่ครบ' };
  }

  const targetFrom = normDate(data.dateFrom);
  const targetTo   = normDate(data.dateTo);
  const sheet      = ensureLeavesSheet();
  const rows       = sheet.getDataRange().getValues();

  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    if (!row[0]) continue;
    if (
      String(row[0]).trim() === String(data.name).trim()      &&
      String(row[2]).trim() === String(data.leaveType).trim() &&
      normDate(row[3])      === targetFrom                    &&
      normDate(row[4])      === targetTo
    ) {
      sheet.deleteRow(i + 1);
      return { success: true, message: 'ลบรายการเรียบร้อย' };
    }
  }
  return { success: false, message: 'ไม่พบรายการที่ต้องการลบ' };
}

// =============================================================
//  getLeaves — กรองฝั่งเซิร์ฟเวอร์ + cache (CacheService)
//
//  พารามิเตอร์ (ทั้งหมดไม่บังคับ — ถ้าไม่ส่งอะไรเลยจะได้ทุกแถวเหมือนเดิม
//  หน้าอื่นๆ ที่เรียก ?action=getLeaves เฉยๆ จึงไม่กระทบ):
//    dept    = ชื่อแผนก ('ALL' หรือว่าง = ทุกแผนก)
//    year    = ปี ค.ศ. 4 หลัก (ว่าง = ทุกปี)
//    month   = '01'..'12' (ว่าง = ทุกเดือน)
//    compact = '1' → ส่งเป็นอาร์เรย์ [name,dept,leaveType,dateFrom,dateTo]
//              (เล็กกว่าออบเจกต์ราวครึ่งหนึ่ง และตัด remark/createdAt ทิ้ง)
//    nocache = '1' → ข้าม cache แล้วอ่านชีตใหม่ (ใช้กับปุ่มรีเฟรช)
//
//  Cache: เก็บทั้งชีตแบบย่อไว้ใน CacheService แบ่งเป็นก้อน ก้อนละ ≤ ~30,000 ตัวอักษร
//  (ขีดจำกัดต่อ key = 100KB และภาษาไทย 1 ตัว = 3 ไบต์) แบ่งตาม "แถว" ไม่ตัดกลางสตริง
//  ล้าง cache ทุกครั้งที่ saveLeave/deleteLeave และเมื่อแก้ชีต Leaves ด้วยมือ (onEdit)
// =============================================================
const LEAVES_CACHE_KEY   = 'leaves_v2';
const LEAVES_CACHE_TTL   = 900;    // 15 นาที — กันกรณีแก้ชีตด้วยวิธีที่ onEdit จับไม่ได้
const LEAVES_CHUNK_CHARS = 30000;

function getLeaves(p) {
  p = p || {};
  if (String(p.nocache) === '1') invalidateLeavesCache_();

  let rows = getLeavesRows_();

  const dept  = String(p.dept  || '').trim();
  const year  = String(p.year  || '').trim();
  let   month = String(p.month || '').trim();
  if (month) month = ('0' + month).slice(-2);
  const filterDept = dept && dept !== 'ALL';

  if (filterDept || year || month) {
    rows = rows.filter(function (r) {
      if (filterDept && r[1] !== dept) return false;
      return leaveOverlaps_(r[3], r[4], year, month);
    });
  }

  if (String(p.compact) === '1') {
    return rows.map(function (r) { return [r[0], r[1], r[2], r[3], r[4]]; });
  }
  return rows.map(function (r) {
    return { name: r[0], dept: r[1], leaveType: r[2], dateFrom: r[3], dateTo: r[4], remark: r[5], createdAt: r[6] };
  });
}

// รายการ [from,to] ซ้อนทับกับ (ปี/เดือน) ที่เลือกหรือไม่ — logic เดียวกับ applyFilters ฝั่งหน้าเว็บ
function leaveOverlaps_(from, to, year, month) {
  if (!year && !month) return true;
  if (!from) return false;
  to = to || from;

  if (year) {
    let rs, re;
    if (month) {
      const last = new Date(+year, +month, 0).getDate();
      rs = year + '-' + month + '-01';
      re = year + '-' + month + '-' + ('0' + last).slice(-2);
    } else {
      rs = year + '-01-01';
      re = year + '-12-31';
    }
    return !(from > re || to < rs);
  }

  // เลือกเดือนอย่างเดียว (ทุกปี): ตรวจทุกปีที่รายการครอบคลุม
  const y1 = +from.slice(0, 4), y2 = +to.slice(0, 4);
  if (y2 - y1 >= 2) return true; // ครอบคลุมเกิน 1 ปี → ต้องคาบเกี่ยวทุกเดือนแน่นอน
  for (let y = y1; y <= y2; y++) {
    const last = new Date(y, +month, 0).getDate();
    const rs = y + '-' + month + '-01';
    const re = y + '-' + month + '-' + ('0' + last).slice(-2);
    if (!(from > re || to < rs)) return true;
  }
  return false;
}

// อ่านชีตจริง → แถวแบบย่อ [name,dept,leaveType,dateFrom,dateTo,remark,createdAt]
function readLeavesRows_() {
  const sheet = ensureLeavesSheet();
  const last  = sheet.getLastRow();
  if (last <= 1) return [];

  const data = sheet.getRange(2, 1, last - 1, 7).getValues(); // เฉพาะ 7 คอลัมน์ ไม่ใช้ getDataRange
  const tz   = Session.getScriptTimeZone();
  const rows = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const createdAt = (row[6] instanceof Date)
      ? Utilities.formatDate(row[6], tz, 'dd/MM/yyyy HH:mm:ss')
      : String(row[6] || '');
    rows.push([
      String(row[0] || ''),
      String(row[1] || ''),
      String(row[2] || ''),
      normDate(row[3]),
      normDate(row[4]),
      String(row[5] || ''),
      createdAt
    ]);
  }
  return rows;
}

function getLeavesRows_() {
  const cache = CacheService.getScriptCache();
  const hit = readLeavesCache_(cache);
  if (hit) return hit;

  // cache miss → อ่านชีตภายใต้ lock เพื่อไม่ให้เขียน cache ทับข้อมูลที่เพิ่งถูกแก้
  const lock = LockService.getScriptLock();
  let locked = false;
  try { lock.waitLock(10000); locked = true; } catch (err) {}

  try {
    if (locked) {
      const again = readLeavesCache_(cache);   // คนอื่นอาจเติม cache ระหว่างรอ lock
      if (again) return again;
    }
    const rows = readLeavesRows_();
    if (locked) writeLeavesCache_(cache, rows);
    return rows;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function readLeavesCache_(cache)        { return readChunked_(cache, LEAVES_CACHE_KEY); }
function writeLeavesCache_(cache, rows) { writeChunked_(cache, LEAVES_CACHE_KEY, rows, LEAVES_CACHE_TTL); }

// ── cache แบบแบ่งก้อนใช้ร่วมกัน (leaves / depts) ──
// rows = อาร์เรย์ของ "แถว" แต่ละก้อนเก็บหลายแถว ก้อนละ ≤ LEAVES_CHUNK_CHARS ตัวอักษร
// (CacheService จำกัด 100KB ต่อ key และภาษาไทย 1 ตัว = 3 ไบต์ — ถ้าเก็บก้อนเดียวใหญ่เกิน put() จะ throw
//  แล้วโค้ดเดิมกลืน error ทิ้ง ผลคือ "ไม่มี cache เลย" ทุกครั้งต้องอ่านชีตใหม่)
function readChunked_(cache, key) {
  try {
    const meta = cache.get(key + '_n');
    if (!meta) return null;
    const n = parseInt(meta, 10);
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    let rows = [];
    for (let i = 0; i < n; i++) {
      const part = got[keys[i]];
      if (part == null) return null;           // ก้อนใดก้อนหนึ่งหาย/หมดอายุ → ถือว่า miss
      rows = rows.concat(JSON.parse(part));
    }
    return rows;
  } catch (err) {
    return null;
  }
}

function writeChunked_(cache, key, rows, ttl) {
  try {
    const chunks = [];
    let cur = [], size = 2;
    rows.forEach(function (r) {
      const s = JSON.stringify(r).length + 1;
      if (cur.length && size + s > LEAVES_CHUNK_CHARS) { chunks.push(cur); cur = []; size = 2; }
      cur.push(r);
      size += s;
    });
    if (cur.length || !chunks.length) chunks.push(cur);

    const obj = {};
    chunks.forEach(function (c, i) { obj[key + '_' + i] = JSON.stringify(c); });
    obj[key + '_n'] = String(chunks.length);
    cache.putAll(obj, ttl);
  } catch (err) {
    // เขียน cache ไม่สำเร็จ ไม่เป็นไร รอบหน้าอ่านชีตตามปกติ
  }
}

// ลบแค่ key "_n" ก็พอ — ไม่มี _n = miss ก้อนที่เหลือจะหมดอายุเอง
function invalidateLeavesCache_() {
  try { CacheService.getScriptCache().remove(LEAVES_CACHE_KEY + '_n'); } catch (err) {}
}

// ครอบ save/delete: ล็อกกันชนกับการเติม cache แล้วล้าง cache หลังเขียนชีตเสร็จ
function withLeavesLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return { success: false, message: 'ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง' };
  }
  try {
    const result = fn();
    invalidateLeavesCache_();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// แก้ชีต Leaves ด้วยมือ → ล้าง cache ทันที (simple trigger, ไม่ต้องตั้งค่าอะไรเพิ่ม)
function onEdit(e) {
  try {
    const name = e && e.range ? e.range.getSheet().getName() : '';
    if (name === 'Leaves')           invalidateLeavesCache_();
    else if (name === 'Departments') invalidateDeptsCache_();
  } catch (err) {}
}

function invalidateDeptsCache_() {
  try { CacheService.getScriptCache().remove(DEPTS_CACHE_KEY + '_n'); } catch (err) {}
}

function getStatusData() {
  const leaves = getLeaves();
  return { success: true, totalLeaves: leaves.length, leaves: leaves };
}
