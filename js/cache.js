// ============================================================
//  Data Cache — ลด GAS round-trip โดยเก็บข้อมูลใน sessionStorage
//  TTL 3 นาที — หมดอายุแล้วค่อยดึงใหม่
//  หน้า index จะ preload ล่วงหน้า หน้าอื่นๆ ใช้จาก cache ทันที
//
//  getDepts และ getLeaves เป็นคนละคำขอ แยกอิสระจากกันโดยตั้งใจ:
//  แผนก + รายชื่อคนในแผนก มาจาก getDepts() ล้วนๆ ส่วน getLeaves()
//  (ประวัติการลาทั้งหมด) ใช้แค่ตอนเช็ควันซ้ำ/บันทึกเท่านั้น จึงไม่ควร
//  ให้แผนกต้องรอ getLeaves() โหลดเสร็จก่อน — ปล่อยให้ getLeaves()
//  วิ่งเบื้องหลังแยกไปเลย จะได้ไม่ไปถ่วงเวลาที่ผู้ใช้เห็น dropdown
//
//  getLeavesFiltered(q) — สำหรับหน้าที่ดูเฉพาะแผนก/เดือน/ปี (เช่น เมนู 02)
//  ให้เซิร์ฟเวอร์กรองและส่งกลับเฉพาะที่ต้องใช้ แทนการโหลดทั้งชีต
// ============================================================
(function(global){
  const TTL = 3 * 60 * 1000; // 3 นาที

  function _set(key, data) {
    const val = JSON.stringify({ ts: Date.now(), data: data });
    try {
      sessionStorage.setItem(key, val);
    } catch(e) {
      // โควตาเต็ม → ล้างผลคิวรีเก่าแล้วลองใหม่ 1 ครั้ง
      _evictQueries();
      try { sessionStorage.setItem(key, val); } catch(e2) {}
    }
  }

  function _evictQueries() {
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.indexOf('cache_lq:') === 0) sessionStorage.removeItem(k);
      });
    } catch(e) {}
  }

  function _get(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.ts > TTL) { sessionStorage.removeItem(key); return null; }
      return obj.data;
    } catch(e) { return null; }
  }

  function _clear() {
    ['cache_leaves','cache_depts'].forEach(k => sessionStorage.removeItem(k));
    _evictQueries();
  }

  // ดึง leaves — ใช้ cache ถ้ายังไม่หมดอายุ (แยกอิสระจาก getDepts)
  async function getLeaves(force) {
    if (!force) {
      const cached = _get('cache_leaves');
      if (cached) return cached;
    }
    const r = await fetch(GAS_API_URL + '?action=getLeaves');
    const data = await r.json() || [];
    _set('cache_leaves', data);
    return data;
  }

  // ดึง leaves แบบกรองที่เซิร์ฟเวอร์ — q = { dept, year, month } (ว่าง = ไม่กรองมิตินั้น)
  // แยก cache ตามคิวรี จึงเล็กพอสำหรับ sessionStorage; force = ข้ามทั้ง cache เบราว์เซอร์และเซิร์ฟเวอร์
  async function getLeavesFiltered(q, force) {
    q = q || {};
    const key = 'cache_lq:' + [q.dept || '', q.year || '', q.month || ''].join('|');
    if (!force) {
      const cached = _get(key);
      if (cached) return _toObjects(cached);
    }
    const p = new URLSearchParams({ action: 'getLeaves', compact: '1' });
    if (q.dept)  p.set('dept',  q.dept);
    if (q.year)  p.set('year',  q.year);
    if (q.month) p.set('month', q.month);
    if (force)   p.set('nocache', '1');
    const r = await fetch(GAS_API_URL + '?' + p.toString());
    const raw = await r.json();
    if (!Array.isArray(raw)) throw new Error((raw && raw.error) || 'รูปแบบข้อมูลไม่ถูกต้อง');
    _set(key, raw);
    return _toObjects(raw);
  }

  // รองรับทั้งแบบอาร์เรย์ (compact) และออบเจกต์ (กรณี GAS เก่ายังไม่ได้ deploy ใหม่)
  function _toObjects(rows) {
    return rows.map(a => Array.isArray(a)
      ? { name: a[0], dept: a[1], leaveType: a[2], dateFrom: a[3], dateTo: a[4] }
      : a);
  }

  // ดึง depts — ใช้ cache ถ้ายังไม่หมดอายุ (แยกอิสระจาก getLeaves)
  async function getDepts(force) {
    if (!force) {
      const cached = _get('cache_depts');
      if (cached) return cached;
    }
    const r = await fetch(GAS_API_URL + '?action=getDepts');
    const data = await r.json() || {};
    _set('cache_depts', data);
    return data;
  }

  // Preload ทั้งคู่พร้อมกัน (เรียกจากหน้า index / login) — ยิงคู่ขนาน
  async function preload() {
    if (_get('cache_leaves') && _get('cache_depts')) return;
    try {
      await Promise.all([getLeaves(true), getDepts(true)]);
    } catch(e) {}
  }

  // invalidate เมื่อมีการบันทึก/ลบ (เพื่อให้ดึงข้อมูลใหม่)
  function invalidate() { _clear(); }

  global.DataCache = { getLeaves, getLeavesFiltered, getDepts, preload, invalidate };
})(window);
