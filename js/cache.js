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

  // fetch + JSON พร้อม timeout — ไม่ค้างเงียบๆ ถ้าเซิร์ฟเวอร์ไม่ตอบ
  async function _fetchJSON(url, ms) {
    const limit = ms || 25000;
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), limit) : null;
    try {
      const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (r && r.ok === false) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('หมดเวลารอเซิร์ฟเวอร์ (เกิน ' + Math.round(limit / 1000) + ' วินาที)');
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  }

  // แปลงข้อผิดพลาดดิบเป็นข้อความที่บอกสาเหตุได้
  global.psmsExplain = function (e) {
    const m = String((e && e.message) || e || '');
    if (/Unexpected token|JSON/i.test(m)) return 'เซิร์ฟเวอร์ตอบกลับไม่ใช่ข้อมูล (อาจยังไม่ได้ Deploy เวอร์ชันใหม่ หรือสคริปต์มีข้อผิดพลาด)';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ตรวจอินเทอร์เน็ต หรือ URL ใน api-config.js)';
    return m || 'ไม่ทราบสาเหตุ';
  };

  // ตัวบอกสถานะการโหลดใต้ element ที่ระบุ: state = 'loading' | 'error' | 'ok'(ซ่อน)
  function _injectCSS() {
    if (document.getElementById('psms-ui-css')) return;
    const st = document.createElement('style'); st.id = 'psms-ui-css';
    st.textContent = '.psms-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.82em;color:#6b7a90;margin:4px 0 10px}' +
      '.psms-note.error{color:#d93025}' +
      '.psms-spin{width:14px;height:14px;border:2px solid #cfd8e6;border-top-color:#3b7cf4;border-radius:50%;animation:psmsSpin .7s linear infinite;flex:none}' +
      '.psms-retry{border:1px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:2px 10px;font:inherit;cursor:pointer}' +
      '@keyframes psmsSpin{to{transform:rotate(360deg)}}';
    (document.head || document.documentElement).appendChild(st);
  }
  global.psmsNote = function (target, state, msg, onRetry) {
    try {
      _injectCSS();
      const el = typeof target === 'string' ? document.getElementById(target) : target;
      if (!el) return;
      let host = el.nextElementSibling && el.nextElementSibling.classList.contains('psms-note') ? el.nextElementSibling : null;
      if (!host) { host = document.createElement('div'); el.insertAdjacentElement('afterend', host); }
      host.innerHTML = '';
      if (!state || state === 'ok') { host.className = 'psms-note'; host.style.display = 'none'; return; }
      host.className = 'psms-note ' + state; host.style.display = 'flex';
      if (state === 'loading') {
        const sp = document.createElement('span'); sp.className = 'psms-spin'; host.appendChild(sp);
        const t = document.createElement('span'); t.textContent = msg || 'กำลังโหลด...'; host.appendChild(t);
      } else {
        const t = document.createElement('span'); t.textContent = '⚠️ ' + (msg || 'โหลดไม่สำเร็จ'); host.appendChild(t);
        if (onRetry) { const b = document.createElement('button'); b.type = 'button'; b.className = 'psms-retry'; b.textContent = '🔄 ลองใหม่'; b.onclick = onRetry; host.appendChild(b); }
      }
    } catch (e) {}
  };

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
        const data = await _fetchJSON(GAS_API_URL + '?action=getDepts', 40000) || {};
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

  // ── รายชื่อแผนก (เฉพาะชื่อ — ไม่ใช่ชื่อบุคคล) ──
  // จำไว้ใน localStorage จึงขึ้นทันทีแม้เปิดแท็บใหม่/วันใหม่ แล้วซิงก์กับชีตเบื้องหลัง (onUpdate เมื่อรายการเปลี่ยน)
  // ลำดับ: จำไว้จากครั้งก่อน → DEPT_SEED ใน api-config.js → ถ้าไม่มีเลยค่อยรอเซิร์ฟเวอร์
  const LIST_KEY = 'psms_deptlist', LIST_FRESH = 5 * 60 * 1000;
  let _listInflight = null;

  function _readList() {
    try {
      const o = JSON.parse(localStorage.getItem(LIST_KEY) || 'null');
      return (o && Array.isArray(o.list) && o.list.length) ? o : null;
    } catch(e) { return null; }
  }
  function _seed() {
    try { return (typeof DEPT_SEED !== 'undefined' && Array.isArray(DEPT_SEED)) ? DEPT_SEED.filter(Boolean) : []; } catch(e) { return []; }
  }
  function _fetchList() {
    if (_listInflight) return _listInflight;
    _listInflight = (async () => {
      try {
        let data = await _fetchJSON(GAS_API_URL + '?action=getDeptList', 30000);
        if (!Array.isArray(data)) {
          // GAS เวอร์ชันเก่ายังไม่มี action นี้ (ยังไม่ได้ Deploy ใหม่) → ใช้ getDepts เดิมแทน แล้วเอาเฉพาะชื่อแผนก
          data = Object.keys(await getDepts() || {});
        }
        if (data.length) { try { localStorage.setItem(LIST_KEY, JSON.stringify({ ts: Date.now(), list: data })); } catch(e) {} }
        return data;
      } finally { _listInflight = null; }
    })();
    return _listInflight;
  }
  async function getDeptList(onUpdate) {
    const cached = _readList();
    const seed = _seed();
    const have = cached ? cached.list : (seed.length ? seed : null);
    if (have) {
      if (!cached || Date.now() - cached.ts > LIST_FRESH) {
        _fetchList().then(fresh => {
          if (onUpdate && fresh.length && JSON.stringify(fresh) !== JSON.stringify(have)) onUpdate(fresh);
        }).catch(() => {});
      }
      return have;
    }
    return _fetchList();
  }

  // ── รายชื่อบุคลากรของแผนกเดียว (โหลดตอนผู้ใช้เลือกแผนก) ──
  const _namesInflight = {};
  async function getDeptNames(dept) {
    const full = _getEntry('cache_depts');                       // มีข้อมูลทั้งหมดอยู่แล้ว → ไม่ต้องยิง
    if (full && full.data && Array.isArray(full.data[dept]) && Date.now() - full.ts < DEPT_MAX_STALE) return full.data[dept];
    const key = 'cache_dn:' + dept;
    const e = _getEntry(key);
    if (e && Date.now() - e.ts < DEPT_FRESH) return e.data;
    if (_namesInflight[dept]) return _namesInflight[dept];
    _namesInflight[dept] = (async () => {
      try {
        let data = await _fetchJSON(GAS_API_URL + '?action=getDeptNames&dept=' + encodeURIComponent(dept), 30000);
        if (!Array.isArray(data)) {
          // GAS เวอร์ชันเก่า → ดึงทั้งหมดด้วย getDepts แล้วหยิบเฉพาะแผนกนี้
          const all = await getDepts() || {};
          data = Array.isArray(all[dept]) ? all[dept] : [];
        }
        _set(key, data);
        return data;
      } finally { delete _namesInflight[dept]; }
    })();
    return _namesInflight[dept];
  }

  // Preload (เรียกจากหน้า index): รายชื่อแผนก (เล็ก) ก่อน แล้วโหลดรายชื่อบุคลากรทั้งหมดต่อเบื้องหลัง
  // ไม่โหลดประวัติการลาทั้งชีตล่วงหน้าอีกแล้ว — ทุกหน้าโหลดเฉพาะส่วนที่ใช้เอง (ลดภาระ GAS ตอนเริ่มใช้งาน)
  async function preload() {
    try { await getDeptList(); } catch(e) {}
    getDepts().catch(() => {});
  }

  // invalidate เมื่อมีการบันทึก/ลบการลา (ล้างเฉพาะข้อมูลการลา — แผนกไม่เปลี่ยน)
  function invalidate() { _clear(); }

  // ล้างทุกอย่างรวมแผนก — ใช้ตอนออกจากระบบ
  function clearAll() {
    _clear();
    try {
      sessionStorage.removeItem('cache_depts');
      Object.keys(sessionStorage).forEach(k => { if (k.indexOf('cache_dn:') === 0) sessionStorage.removeItem(k); });
    } catch(e) {}
  }

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
  try { if (sessionStorage.getItem('loggedIn') === '1') getDeptList().catch(function () {}); } catch (e) {}

  global.DataCache = { getLeaves, getLeavesFiltered, getDepts, getDeptList, getDeptNames, preload, invalidate, clearAll };
})(window);
