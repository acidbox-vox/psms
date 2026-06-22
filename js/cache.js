// ============================================================
//  Data Cache — ลด GAS round-trip โดยเก็บข้อมูลใน sessionStorage
//  TTL 3 นาที — หมดอายุแล้วค่อยดึงใหม่
//  หน้า index จะ preload ล่วงหน้า หน้าอื่นๆ ใช้จาก cache ทันที
// ============================================================
(function(global){
  const TTL = 3 * 60 * 1000; // 3 นาที

  function _set(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
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
  }

  // ดึง leaves — ใช้ cache ถ้ายังไม่หมดอายุ
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

  // ดึง depts — ใช้ cache ถ้ายังไม่หมดอายุ
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

  // Preload ทั้งคู่พร้อมกัน (เรียกจากหน้า index)
  async function preload() {
    // ถ้า cache ยังใช้ได้ทั้งคู่ ไม่ต้องดึงใหม่
    if (_get('cache_leaves') && _get('cache_depts')) return;
    try {
      await Promise.all([getLeaves(true), getDepts(true)]);
    } catch(e) {}
  }

  // invalidate เมื่อมีการบันทึก/ลบ (เพื่อให้ดึงข้อมูลใหม่)
  function invalidate() { _clear(); }

  global.DataCache = { getLeaves, getDepts, preload, invalidate };
})(window);
