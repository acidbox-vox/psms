// ============================================================
//  GOOGLE APPS SCRIPT — ระบบจำหน่ายบุคลากร กองบิน ๒๓
// ============================================================

function doGet(e) {
  e = e || {};
  e.parameter = e.parameter || {};
  const action = e.parameter.action || '';
  let result;

  if      (action === 'login')         return handleLogin(e);
  else if (action === 'lineLogin')     return handleLineLogin(e);
  else if (action === 'getDepts')      result = getDepts();
  else if (action === 'getLeaves')     result = getLeaves();
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

  if      (action === 'saveLeave')   result = saveLeave(data);
  else if (action === 'deleteLeave') result = deleteLeave(data);
  else if (action === 'saveDepts')   result = saveDepts(data.depts);
  else result = { error: 'Unknown action: ' + action };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================
//  Login & Access Log
//  ── flow 2 ขั้นตอน ──
//  ขั้นตอนที่ 1: handleLineLogin() แค่ยืนยันว่าเป็นบัญชี LINE จริง (ยังไม่เช็คสิทธิ์)
//  ขั้นตอนที่ 2: handleLogin() เช็ครหัสหน่วย 5 หลัก — นี่คือด่านสิทธิ์จริง ถ้าถูกจึงเข้าระบบได้
//                พร้อมบันทึก LINE User ID / ชื่อ LINE ที่ยืนยันไว้ในขั้นตอนที่ 1 ลง log ไปด้วย
// =============================================================
function handleLogin(e) {
  e = e || {};
  e.parameter = e.parameter || {};

  var code       = String(e.parameter.code || '').trim();
  var lineUserId = String(e.parameter.lineUserId || '').trim();
  var lineName   = String(e.parameter.lineName || '').trim();

  if (!code) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: 'ไม่พบรหัสหน่วย' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var unitSheet = ss.getSheetByName('เบอร์หน่วย');

  if (!unitSheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: 'ไม่พบชีต เบอร์หน่วย' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var unitData = unitSheet.getDataRange().getValues();
  var unitName = null;

  for (var i = 1; i < unitData.length; i++) {
    var phone = String(unitData[i][1] || '').trim();
    if (phone === code) {
      unitName = String(unitData[i][0] || '').trim();
      break;
    }
  }

  if (!unitName) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var logSheet = ss.getSheetByName('log');
  if (!logSheet) {
    logSheet = ss.insertSheet('log');
    logSheet.appendRow(['วันที่', 'เวลา', 'หน่วย', 'เบอร์โทร', 'LINE User ID', 'ชื่อ LINE']);
  }

  var now = new Date();
  var tz  = Session.getScriptTimeZone();
  logSheet.appendRow([
    Utilities.formatDate(now, tz, 'dd/MM/yyyy'),
    Utilities.formatDate(now, tz, 'HH:mm:ss'),
    unitName,
    code,
    lineUserId,
    lineName
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, unitName: unitName }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ขั้นตอนที่ 1 (ยืนยันตัวตนเบื้องต้นด้วย LINE): แลก code เป็น token แล้วดึงโปรไฟล์ ──
// หมายเหตุ: ฟังก์ชันนี้ "ไม่" เช็คสิทธิ์การเข้าใช้งานใดๆ แค่ยืนยันว่าเป็นบัญชี LINE จริง
// ตัวเช็คสิทธิ์จริงอยู่ที่ handleLogin() (รหัสหน่วย 5 หลัก) ด้านบน
//
// ต้องตั้งค่า Script Properties ก่อนใช้งาน (Project Settings ⚙️ > Script Properties):
//   LINE_CHANNEL_ID      = Channel ID จาก LINE Developers Console
//   LINE_CHANNEL_SECRET  = Channel secret จาก LINE Developers Console (ห้ามใส่ในโค้ด/frontend)
// และตั้งค่า Callback URL ใน LINE Developers Console ให้ตรงกับ URL ของหน้า login.html จริง (ต้องเป็น https)
// แล้วนำ Channel ID (ตัวเดียวกัน) ไปใส่ในไฟล์ js/api-config.js ที่ตัวแปร LINE_CHANNEL_ID
function handleLineLogin(e) {
  e = e || {};
  e.parameter = e.parameter || {};

  var code        = String(e.parameter.code || '').trim();
  var redirectUri = String(e.parameter.redirect_uri || '').trim();
  var props       = PropertiesService.getScriptProperties();
  var channelId     = props.getProperty('LINE_CHANNEL_ID');
  var channelSecret = props.getProperty('LINE_CHANNEL_SECRET');

  function respond(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  }

  if (!channelId || !channelSecret) {
    return respond({ success: false, message: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ID / LINE_CHANNEL_SECRET ใน Script Properties' });
  }
  if (!code || !redirectUri) {
    return respond({ success: false, message: 'ข้อมูลไม่ครบสำหรับยืนยันตัวตน' });
  }

  // ── 1) แลก authorization code เป็น access token ──
  var tokenRes;
  try {
    tokenRes = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret
      },
      muteHttpExceptions: true
    });
  } catch (err) {
    return respond({ success: false, message: 'เชื่อมต่อ LINE ไม่สำเร็จ: ' + err.message });
  }

  var tokenData = JSON.parse(tokenRes.getContentText());
  if (!tokenData.access_token) {
    return respond({ success: false, message: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ (' + (tokenData.error_description || tokenData.error || 'unknown') + ')' });
  }

  // ── 2) ดึงโปรไฟล์ผู้ใช้จาก LINE ──
  var profileRes = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
    muteHttpExceptions: true
  });
  var profile = JSON.parse(profileRes.getContentText());
  if (!profile.userId) {
    return respond({ success: false, message: 'ไม่สามารถดึงข้อมูลโปรไฟล์ LINE ได้' });
  }

  // ยืนยันตัวตนสำเร็จ — ส่งข้อมูลโปรไฟล์กลับไปให้ frontend เพื่อไปขั้นตอนที่ 2 (กรอกรหัสหน่วย) ต่อ
  return respond({
    success: true,
    lineUserId: profile.userId,
    lineName: profile.displayName || '',
    linePicture: profile.pictureUrl || ''
  });
}

// =============================================================
//  Departments
//  ── เพิ่ม cache ฝั่งเซิร์ฟเวอร์ (CacheService) ──
//  แผนกแทบไม่เปลี่ยนบ่อย จึงแคชผลลัพธ์ไว้ 30 นาที
//  ทำให้ครั้งถัดๆ ไปไม่ต้องเปิด/อ่านชีตใหม่ทุกครั้ง (เร็วขึ้นมาก)
// =============================================================
const DEPTS_CACHE_KEY = 'depts_v1';
const DEPTS_CACHE_TTL = 1800; // 30 นาที (สูงสุดที่ CacheService รองรับคือ 21600 วิ = 6 ชม.)

function getDepts() {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(DEPTS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    // ถ้า cache อ่านผิดพลาด ให้ไปอ่านชีตตามปกติ ไม่ throw
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

  Object.keys(result).forEach(k => {
    result[k] = [...new Set(result[k])];
    try { result[k].sort((a, b) => a.localeCompare(b, 'th')); } catch (err) {}
  });

  try { cache.put(DEPTS_CACHE_KEY, JSON.stringify(result), DEPTS_CACHE_TTL); } catch (err) {}

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
  try { CacheService.getScriptCache().remove(DEPTS_CACHE_KEY); } catch (err) {}
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

function getLeaves() {
  const sheet = ensureLeavesSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const tz     = Session.getScriptTimeZone();
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    let createdAt = '';
    if (row[6] instanceof Date) {
      createdAt = Utilities.formatDate(row[6], tz, 'dd/MM/yyyy HH:mm:ss');
    } else {
      createdAt = String(row[6] || '');
    }
    result.push({
      name:      String(row[0] || ''),
      dept:      String(row[1] || ''),
      leaveType: String(row[2] || ''),
      dateFrom:  normDate(row[3]),
      dateTo:    normDate(row[4]),
      remark:    String(row[5] || ''),
      createdAt: createdAt
    });
  }
  return result;
}

function getStatusData() {
  const leaves = getLeaves();
  return { success: true, totalLeaves: leaves.length, leaves: leaves };
}
