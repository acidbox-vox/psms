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
    ['cache_leaves'].forEach(k => sessionStorage.removeItem(k));
    _evictQueries();
  }

  // ดึง leaves — ใช้ cache ถ้ายังไม่หมดอายุ (แยกอิสระจาก getDepts)
  async function getLeaves(force) {
    if (!force) {
      const cached = _get('cache_leaves');
      if (cached) return _toObjects(cached);
    }
    // compact=1 → เซิร์ฟเวอร์ส่งเป็นอาร์เรย์ (เล็กกว่าราวครึ่งหนึ่ง) แล้วแปลงกลับเป็นออบเจกต์ที่นี่
    // เก็บลง cache เป็นออบเจกต์เหมือนเดิม (leave-report อ่าน cache_leaves ตรงๆ)
    const r = await fetch(GAS_API_URL + '?action=getLeaves&compact=1');
    const raw = await r.json() || [];
    if (!Array.isArray(raw)) throw new Error((raw && raw.error) || 'รูปแบบข้อมูลไม่ถูกต้อง');
    const data = _toObjects(raw);
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

  // ── แผนก: stale-while-revalidate ──
  // แผนก/รายชื่อแทบไม่เปลี่ยน จึงไม่ควรทำให้ผู้ใช้ "รอ GAS" ทุกครั้งที่เปิดเมนู
  //  - อายุ < 10 นาที   → ใช้ cache เลย
  //  - 10 นาที–12 ชม.   → แสดงของเดิมทันที แล้วรีเฟรชเบื้องหลัง (เปิดหน้าถัดไปได้ของใหม่)
  //  - ไม่มี / เก่ากว่านั้น → ต้องรอดึงจริง
  // invalidate() (หลังบันทึก/ลบการลา) "ไม่" ล้างแผนกอีกแล้ว เพราะการลาไม่ได้เปลี่ยนแผนก
  const DEPT_FRESH     = 10 * 60 * 1000;
  const DEPT_MAX_STALE = 12 * 60 * 60 * 1000;
  let _deptInflight = null;

  function _getEntry(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && o.ts) ? o : null;
    } catch(e) { return null; }
  }

  // คำขอ getDepts ที่กำลังบินอยู่ใช้ร่วมกัน — ไม่ยิงซ้ำถ้าหลายส่วนของหน้าเรียกพร้อมกัน
  function _fetchDepts() {
    if (_deptInflight) return _deptInflight;
    _deptInflight = (async () => {
      try {
        const r = await fetch(GAS_API_URL + '?action=getDepts');
        const data = await r.json() || {};
        if (data.error) throw new Error(data.error);
        _set('cache_depts', data);
        return data;
      } finally { _deptInflight = null; }
    })();
    return _deptInflight;
  }

  async function getDepts(force) {
    if (!force) {
      const e = _getEntry('cache_depts');
      if (e) {
        const age = Date.now() - e.ts;
        if (age < DEPT_FRESH) return e.data;
        if (age < DEPT_MAX_STALE) { _fetchDepts().catch(() => {}); return e.data; }
      }
    }
    return _fetchDepts();
  }

  // Preload (เรียกจากหน้า index): แผนกก่อน (เล็ก ต้องใช้ทุกเมนู) แล้วค่อยโหลดประวัติการลาเต็มชุดเบื้องหลัง
  // ไม่รอ/ไม่บล็อกใคร และไม่ใช้ force เพื่อไม่ทิ้ง cache ที่ยังใช้ได้
  async function preload() {
    try { await getDepts(); } catch(e) {}
    if (!_get('cache_leaves')) getLeaves(false).catch(() => {});
  }

  // invalidate เมื่อมีการบันทึก/ลบการลา (ล้างเฉพาะข้อมูลการลา — แผนกไม่เปลี่ยน)
  function invalidate() { _clear(); }

  // ล้างทุกอย่างรวมแผนก — ใช้ตอนออกจากระบบ
  function clearAll() { _clear(); try { sessionStorage.removeItem('cache_depts'); } catch(e) {} }

  // โหลดไลบรารี Excel (~900KB) เฉพาะตอนต้องใช้ — เดิมใส่เป็น <script> ในหัวหน้า ทำให้ทั้งหน้าต้องรอ
  let _xlsxP = null;
  global.loadXLSX = function () {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (_xlsxP) return _xlsxP;
    _xlsxP = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = function () { resolve(global.XLSX); };
      s.onerror = function () { _xlsxP = null; reject(new Error('โหลดไลบรารี Excel ไม่ได้ (อินเทอร์เน็ตช้าหรือ CDN ถูกบล็อก)')); };
      document.head.appendChild(s);
    });
    return _xlsxP;
  };

  // ทันทีที่สคริปต์นี้ทำงาน (ก่อน DOM พร้อม) ถ้าล็อกอินแล้วให้เริ่มโหลดแผนกเลย
  // หน้าที่เรียก getDepts() ทีหลังจะได้ของที่มาถึงแล้วหรืออยู่ระหว่างโหลด ไม่ต้องรอ window.onload
  try { if (sessionStorage.getItem('loggedIn') === '1') getDepts().catch(function () {}); } catch (e) {}

  global.DataCache = { getLeaves, getLeavesFiltered, getDepts, preload, invalidate, clearAll };
})(window);
