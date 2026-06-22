// ============================================================
//  วิธีติดตั้ง: เปิด Google Apps Script เดิม
//  แล้วทำ 2 ขั้นตอน ด้านล่างนี้
// ============================================================

// ══════════════════════════════════════════════
//  ขั้นตอนที่ 1: ใน doGet() เดิม
//  เพิ่ม บรรทัดนี้บรรทัดเดียว ต่อจาก const action = ...
//  ──────────────────────────────────────────────
//
//    if (action === 'login') return handleLogin(e);
//
//  ตัวอย่างผลลัพธ์ที่ถูกต้อง:
//
//  function doGet(e) {
//    const action = e.parameter.action;
//    let result;
//
//    if (action === 'login')               return handleLogin(e);   // <-- เพิ่มบรรทัดนี้
//    else if (action === 'getConfig')      result = getConfig();
//    else if (action === 'getKnownFaces')  result = getKnownFaces();
//    ... (ส่วนที่เหลือเหมือนเดิมทุกอย่าง)
//  }
//
// ══════════════════════════════════════════════
//  ขั้นตอนที่ 2: วาง function handleLogin ด้านล่างนี้
//  ลงในไฟล์ Code.gs ต่อจาก function เดิมทั้งหมด
// ══════════════════════════════════════════════

// ── Login: ตรวจสอบเบอร์หน่วย & บันทึก log ──
function handleLogin(e) {
  var code = (e.parameter.code || '').trim();

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ชีต "เบอร์หน่วย" — คอลัม A=หน่วย, B=เบอร์โทร
  var unitSheet = ss.getSheetByName('เบอร์หน่วย');
  if (!unitSheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'ไม่พบ sheet เบอร์หน่วย' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var unitData = unitSheet.getDataRange().getValues();
  var unitName = null;

  for (var i = 1; i < unitData.length; i++) {   // row 1 = header
    var phone = String(unitData[i][1]).trim();
    if (phone === code) {
      unitName = String(unitData[i][0]).trim();
      break;
    }
  }

  var result;
  if (unitName) {
    // บันทึก log ด้วย timezone เดียวกับระบบเดิม (Session.getScriptTimeZone())
    var logSheet = ss.getSheetByName('log');
    if (logSheet) {
      var now = new Date();
      var tz  = Session.getScriptTimeZone();
      var dateStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
      var timeStr = Utilities.formatDate(now, tz, 'HH:mm:ss');
      logSheet.appendRow([dateStr, timeStr, unitName, code]);
    }
    result = { success: true, unitName: unitName };
  } else {
    result = { success: false };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  หัวตาราง log sheet:
//  คอลัม A: วันที่   คอลัม B: เวลา   คอลัม C: หน่วย   คอลัม D: เบอร์โทร
// ============================================================
