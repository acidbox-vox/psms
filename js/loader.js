/**
 * Algorithm Race Loader — Transparent Edition
 * ระบบจำหน่ายบุคลากร · กองบิน ๒๓
 */
(function () {
  'use strict';

  var canvas, ctx, pbar, raf;
  var nodes, edges, dijkV, dijkP, aV, aP, si, ei;
  var state = {};
  var hidden = false;
  var W, H;

  function hypot(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* ── Graph ── */
  function buildGraph() {
    var N = 65, ns = [], es = [];
    for (var i = 0; i < N; i++)
      ns.push({ x: 10 + Math.random() * (W - 20), y: 10 + Math.random() * (H - 20) });

    /* 1. Minimum spanning tree — การันตีว่าทุก node เชื่อมถึงกันแน่นอน */
    var inTree = [0], notIn = [];
    for (var i = 1; i < N; i++) notIn.push(i);
    while (notIn.length) {
      var bestD = Infinity, bestI = -1, bestJ = -1;
      for (var a = 0; a < inTree.length; a++) {
        for (var b = 0; b < notIn.length; b++) {
          var d = hypot(ns[inTree[a]], ns[notIn[b]]);
          if (d < bestD) { bestD = d; bestI = inTree[a]; bestJ = notIn[b]; }
        }
      }
      es.push([bestI, bestJ]);
      inTree.push(bestJ);
      notIn.splice(notIn.indexOf(bestJ), 1);
    }

    /* 2. เพิ่ม edge แบบสุ่มให้กราฟดูหนาแน่นขึ้น */
    for (var i = 0; i < N; i++) {
      var c = [];
      for (var j = 0; j < N; j++) if (i !== j) c.push({ j: j, d: hypot(ns[i], ns[j]) });
      c.sort(function (a, b) { return a.d - b.d; });
      c.slice(0, 3).forEach(function (x) { if (x.d < 115) es.push([i, x.j]); });
    }

    /* 3. เลือก start/end จากคู่ที่ไกลที่สุด — path มีแน่นอนจาก MST */
    var s = 0, e = 1, mx = 0;
    for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
      var d = hypot(ns[i], ns[j]); if (d > mx) { mx = d; s = i; e = j; }
    }
    return { ns: ns, es: es, si: s, ei: e };
  }

  function buildAdj(ns, es) {
    var adj = {};
    ns.forEach(function (_, i) { adj[i] = []; });
    es.forEach(function (e) {
      var d = hypot(ns[e[0]], ns[e[1]]);
      adj[e[0]].push({ n: e[1], c: d }); adj[e[1]].push({ n: e[0], c: d });
    });
    return adj;
  }

  function dijkstra(ns, es, s, e) {
    var adj = buildAdj(ns, es), dist = {}, parent = {}, vis = [];
    ns.forEach(function (_, i) { dist[i] = Infinity; }); dist[s] = 0;
    var q = ns.map(function (_, i) { return i; });
    while (q.length) {
      q.sort(function (a, b) { return dist[a] - dist[b]; });
      var u = q.shift(); vis.push(u);
      if (u === e) break;
      adj[u].forEach(function (nb) {
        if (dist[u] + nb.c < dist[nb.n]) { dist[nb.n] = dist[u] + nb.c; parent[nb.n] = u; }
      });
    }
    var p = [], c = e; while (c !== undefined) { p.unshift(c); c = parent[c]; }
    return { vis: vis, p: p };
  }

  function aStar(ns, es, s, e) {
    var adj = buildAdj(ns, es), g = {}, f = {}, parent = {}, vis = [];
    ns.forEach(function (_, i) { g[i] = Infinity; f[i] = Infinity; });
    g[s] = 0; f[s] = hypot(ns[s], ns[e]);
    var open = new Map(); open.set(s, f[s]);
    while (open.size) {
      var cur = null, best = Infinity;
      open.forEach(function (v, k) { if (v < best) { best = v; cur = k; } });
      if (cur === e) {
        var p = [], c = cur; while (c !== undefined) { p.unshift(c); c = parent[c]; }
        return { vis: vis, p: p };
      }
      open.delete(cur); vis.push(cur);
      adj[cur].forEach(function (nb) {
        var tg = g[cur] + nb.c;
        if (tg < g[nb.n]) { parent[nb.n] = cur; g[nb.n] = tg; f[nb.n] = tg + hypot(ns[nb.n], ns[e]); open.set(nb.n, f[nb.n]); }
      });
    }
    return { vis: vis, p: [] };
  }

  /* ── Detect dark mode ── */
  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  /* ── Draw frame ── */
  function draw() {
    if (hidden) return;
    ctx.clearRect(0, 0, W, H);

    var dark = isDark();
    var s = state;
    if (!nodes) { raf = requestAnimationFrame(draw); return; }

    /* base edges */
    edges.forEach(function (e) {
      ctx.beginPath();
      ctx.moveTo(nodes[e[0]].x, nodes[e[0]].y);
      ctx.lineTo(nodes[e[1]].x, nodes[e[1]].y);
      ctx.strokeStyle = dark ? 'rgba(100,130,210,0.18)' : 'rgba(59,100,200,0.10)';
      ctx.lineWidth = 0.7; ctx.stroke();
    });

    /* Dijkstra visited — blue */
    var dr = Math.min(Math.floor(s.dijkR || 0), dijkV.length);
    for (var i = 0; i < dr; i++) {
      var n = nodes[dijkV[i]];
      ctx.beginPath(); ctx.arc(n.x, n.y, 3.2, 0, 6.28);
      ctx.fillStyle = 'rgba(59,124,244,0.82)';
      ctx.shadowColor = '#3b7cf4'; ctx.shadowBlur = 10;
      ctx.fill(); ctx.shadowBlur = 0;
    }

    /* A* visited — purple */
    var ar = Math.min(Math.floor(s.aR || 0), aV.length);
    for (var i = 0; i < ar; i++) {
      var n = nodes[aV[i]];
      ctx.beginPath(); ctx.arc(n.x, n.y, 3.2, 0, 6.28);
      ctx.fillStyle = 'rgba(124,58,237,0.82)';
      ctx.shadowColor = '#7c3aed'; ctx.shadowBlur = 10;
      ctx.fill(); ctx.shadowBlur = 0;
    }

    /* Dijkstra path */
    if ((s.dijkPR || 0) > 0 && dijkP.length > 1) {
      var pr = Math.min(Math.floor(s.dijkPR), dijkP.length - 1);
      ctx.beginPath();
      ctx.moveTo(nodes[dijkP[0]].x, nodes[dijkP[0]].y);
      for (var i = 1; i <= pr; i++) ctx.lineTo(nodes[dijkP[i]].x, nodes[dijkP[i]].y);
      ctx.strokeStyle = '#3b7cf4'; ctx.lineWidth = 2.5;
      ctx.shadowColor = '#3b7cf4'; ctx.shadowBlur = 18;
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    /* A* path */
    if ((s.aPR || 0) > 0 && aP.length > 1) {
      var pr = Math.min(Math.floor(s.aPR), aP.length - 1);
      ctx.beginPath();
      ctx.moveTo(nodes[aP[0]].x, nodes[aP[0]].y);
      for (var i = 1; i <= pr; i++) ctx.lineTo(nodes[aP[i]].x, nodes[aP[i]].y);
      ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2.5;
      ctx.shadowColor = '#7c3aed'; ctx.shadowBlur = 18;
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    /* START / TARGET */
    [[si, '#3b7cf4', 'START'], [ei, '#10b981', 'TARGET']].forEach(function (m) {
      var n = nodes[m[0]];
      ctx.beginPath(); ctx.arc(n.x, n.y, 8, 0, 6.28);
      ctx.fillStyle = m[1]; ctx.shadowColor = m[1]; ctx.shadowBlur = 22;
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = dark ? '#ffffff' : '#1a2340';
      ctx.textAlign = 'center'; ctx.fillText(m[2], n.x, n.y - 14);
    });

    /* animate phases — ผูกกับ _dataReady ไม่ให้ path ถึง TARGET ก่อนข้อมูลมา */
    if (s.phase === 'explore') {
      s.dijkR = Math.min((s.dijkR || 0) + 1.2, dijkV.length);
      s.aR    = Math.min((s.aR    || 0) + 2.2, aV.length);
      var p = Math.round(55 * Math.max(s.dijkR / dijkV.length, s.aR / aV.length));
      if (pbar) pbar.style.width = p + '%';
      if (s.dijkR >= dijkV.length && s.aR >= aV.length) s.phase = 'path';
    } else if (s.phase === 'path') {
      var maxDijkPR = s._dataReady ? Math.max(dijkP.length - 1, 1) : Math.max(dijkP.length - 1, 1) * 0.82;
      var maxAPR    = s._dataReady ? Math.max(aP.length    - 1, 1) : Math.max(aP.length    - 1, 1) * 0.82;
      /* ชะลอเมื่อใกล้ขีดจำกัด — ไม่ให้ดูสะดุดหยุดนิ่ง */
      var dijkRemain = maxDijkPR - (s.dijkPR || 0);
      var aRemain    = maxAPR    - (s.aPR    || 0);
      s.dijkPR = Math.min((s.dijkPR || 0) + Math.max(0.05, dijkRemain * 0.06 + 0.12), maxDijkPR);
      s.aPR    = Math.min((s.aPR    || 0) + Math.max(0.05, aRemain    * 0.06 + 0.18), maxAPR);
      var ratio = Math.max(
        (s.dijkPR) / Math.max(dijkP.length - 1, 1),
        (s.aPR)    / Math.max(aP.length    - 1, 1)
      );
      var p = 55 + Math.round(40 * ratio);
      if (pbar) pbar.style.width = p + '%';
      /* จบได้เมื่อข้อมูลพร้อม และ animation วิ่งถึง target แล้ว */
      if (s._dataReady && s.dijkPR >= dijkP.length - 1 && s.aPR >= aP.length - 1) {
        s.phase = 'done';
        if (pbar) pbar.style.width = '100%';
      }
    }

    raf = requestAnimationFrame(draw);
  }

  /* ── Resize canvas to fullscreen ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  /* ── Rebuild graph & restart ── */
  function restart() {
    if (raf) cancelAnimationFrame(raf);
    resize();
    var g = buildGraph();
    nodes = g.ns; edges = g.es; si = g.si; ei = g.ei;
    var d = dijkstra(nodes, edges, si, ei);
    var a = aStar(nodes, edges, si, ei);
    dijkV = d.vis; dijkP = d.p; aV = a.vis; aP = a.p;
    state = { phase: 'explore', dijkR: 0, aR: 0, dijkPR: 0, aPR: 0, _dataReady: false };
    hidden = false;
    if (pbar) pbar.style.width = '0%';
    draw();
  }

  /* ── Public API ── */
  window.Loader = {
    hide: function () {
      /* บอก animation ว่าข้อมูลพร้อมแล้ว → วิ่งจบได้เลย */
      if (state) state._dataReady = true;

      function doFade() {
        if (pbar) pbar.style.width = '100%';
        setTimeout(function () {
          canvas.style.transition = 'opacity 0.4s ease';
          canvas.style.opacity = '0';
          if (pbar) {
            pbar.parentNode.style.transition = 'opacity 0.4s ease';
            pbar.parentNode.style.opacity = '0';
          }
          setTimeout(function () {
            hidden = true;
            if (raf) cancelAnimationFrame(raf);
            canvas.style.display = 'none';
            if (pbar) pbar.parentNode.style.display = 'none';
          }, 420);
        }, 150);
      }

      /* รอให้ animation วิ่งถึง TARGET ก่อน (max 1.5s) แล้วค่อย fade */
      var waited = 0;
      var waitInterval = setInterval(function () {
        waited += 50;
        if ((state && state.phase === 'done') || waited >= 1500) {
          clearInterval(waitInterval);
          doFade();
        }
      }, 50);
    },
    show: function () {
      hidden = false;
      canvas.style.display = 'block';
      canvas.style.opacity = '1';
      canvas.style.transition = '';
      if (pbar) { pbar.parentNode.style.display = 'block'; pbar.parentNode.style.opacity = '1'; }
      restart();
    },
  };

  /* ── Init on DOM ready ── */
  function init() {
    /* Canvas — fullscreen, transparent, on top of everything */
    canvas = document.createElement('canvas');
    canvas.id = 'algo-loader-canvas';
    canvas.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99998',
      'pointer-events:none', 'display:block',
      'width:100%', 'height:100%',
    ].join(';');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');

    /* Progress bar — thin stripe at very bottom */
    var wrap = document.createElement('div');
    wrap.id = 'algo-loader-bar-wrap';
    wrap.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'height:3px',
      'z-index:99999', 'pointer-events:none',
      'background:rgba(0,0,0,0.08)',
    ].join(';');
    pbar = document.createElement('div');
    pbar.style.cssText = [
      'height:100%', 'width:0%',
      'background:linear-gradient(90deg,#3b7cf4,#7c3aed)',
      'transition:width 0.1s linear',
      'box-shadow:0 0 6px #3b7cf4',
    ].join(';');
    wrap.appendChild(pbar);
    document.body.appendChild(wrap);

    window.addEventListener('resize', function () {
      if (!hidden) resize();
    });

    restart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── Intercept in-site navigation ── */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript') === 0 || href.indexOf('http') === 0) return;
    e.preventDefault();
    window.Loader.show();
    setTimeout(function () { window.location.href = href; }, 950);
  }, true);

})();
