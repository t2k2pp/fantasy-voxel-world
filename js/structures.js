/* ============================================================
 *  structures.js — 手工芸ワールドビルダー
 *   フェーズA: stx.pads()      … 建築パッド平坦化 (relaxRoads の前)
 *   フェーズB: stx.paintPads() … 地面ペイント (finalize の後・ベイクの前)
 *   フェーズC: stx.build()     … 構造物/樹木/小物をボクセルで刻印
 * ============================================================ */
(function () {
  const V = window.VFV, W = V.LAYOUT.W, SEA = V.LAYOUT.SEA;
  const p = V.p;
  if (p.cactus === undefined) p.cactus = V.C(0x5a9c52, .06);
  if (p.ironDark === undefined) p.ironDark = V.C(0x4a4e58, .05);

  const stx = {}; V.stx = stx;
  const rng = () => V.rng();
  const R = (a, b) => a + rng() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));

  /* ---------- ブロックバッファ ---------- */
  const buf = { X: [], Y: [], Z: [], P: [], win: [], GX: [], GY: [], GZ: [], GP: [] };
  stx.buf = buf;
  stx.extras = [];   // app側でTHREEオブジェクト化する追加物 (風車・光源)

  function c(x, y, z, pi) {           // 通常ブロック刻印
    x |= 0; y |= 0; z |= 0;
    if (x < 0 || z < 0 || x >= W || z >= W || y < 0 || y > 36) return;
    buf.X.push(x); buf.Y.push(y); buf.Z.push(z); buf.P.push(pi);
  }
  function cw(x, y, z, pi) {          // 夜に光る窓
    if (x < 0 || z < 0 || x >= W || z >= W || y < 0) return;
    buf.win.push(buf.X.length); c(x, y, z, pi);
  }
  function glow(x, y, z, pi) {        // 発光系 (溶岩/ポータル/クリスタル)
    x |= 0; y |= 0; z |= 0;
    if (x < 0 || z < 0 || x >= W || z >= W || y < 0) return;
    buf.GX.push(x); buf.GY.push(y); buf.GZ.push(z); buf.GP.push(pi);
  }
  function box(x0, x1, y0, y1, z0, z1, pi, mode) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
          if (mode === 'hollow') {
            const nx = x === x0 || x === x1, nz = z === z0 || z === z1, ny = y === y0 || y === y1;
            if (!(nx || nz || ny)) continue;
          }
          c(x, y, z, pi);
        }
  }
  function cyl(cx, cz, r, y0, y1, pi) {
    for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++)
      for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d <= r + .25) for (let y = y0; y <= y1; y++) c(x, y, z, pi);
      }
  }
  function blob(cx, cy, cz, rx, ry, rz, pi, holey) {
    for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++)
      for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++)
        for (let z = Math.ceil(cz - rz); z <= Math.floor(cz + rz); z++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (d <= 1.08 && (!holey || rng() > .14)) c(x, y, z, pi);
        }
  }
  const hAt = (x, z) => V.world.hAt(x, z);
  function block(x0, z0, x1, z1) {    // スキャッタ禁止印
    for (let z = Math.max(0, z0 | 0); z <= Math.min(W - 1, z1 | 0); z++)
      for (let x = Math.max(0, x0 | 0); x <= Math.min(W - 1, x1 | 0); x++)
        V.world.noScatter[V.world.idx(x, z)] = 2;
  }
  function padCircle(cx, cz, r, h) {
    let sum = 0, n = 0;
    for (let z = Math.max(1, cz - r | 0); z <= Math.min(W - 2, cz + r | 0); z++)
      for (let x = Math.max(1, cx - r | 0); x <= Math.min(W - 2, cx + r | 0); x++)
        if (Math.hypot(x - cx, z - cz) <= r) { sum += hAt(x, z); n++; }
    const th = h != null ? h : Math.round(sum / (n || 1));
    for (let z = Math.max(1, cz - r | 0); z <= Math.min(W - 2, cz + r | 0); z++)
      for (let x = Math.max(1, cx - r | 0); x <= Math.min(W - 2, cx + r | 0); x++)
        if (Math.hypot(x - cx, z - cz) <= r) { V.world.H[V.world.idx(x, z)] = th; V.world.noScatter[V.world.idx(x, z)] = 2; }
    return th;
  }
  stx.padCircle = padCircle;

  /* ================= 基本ビルダー ================= */
  function house(x0, z0, w, d, hh, wallP, roofP, door, opts) {
    opts = opts || {};
    const baseY = hAt(x0, z0);
    const hw = Math.floor(w / 2), hd = Math.floor(d / 2);
    // 壁 (中空。内側は天板で塞ぐので暗がりが窓から覗く)
    for (let x = x0 - hw; x <= x0 + hw; x++)
      for (let z = z0 - hd; z <= z0 + hd; z++)
        for (let y = baseY; y < baseY + hh; y++) {
          const ring = x === x0 - hw || x === x0 + hw || z === z0 - hd || z === z0 + hd;
          if (!ring) continue;
          let pi = wallP;
          if (opts.stripes && ((x + z) & 3) === 0 && y > baseY) pi = p.woodDark;   // 木骨風
          c(x, y, z, pi);
        }
    // 天板 & 妻
    box(x0 - hw, x0 + hw, baseY + hh, baseY + hh, z0 - hd, z0 + hd, opts.flatFill || p.plank);
    // 窓 (2列交互)
    const wy = baseY + Math.max(1, hh - 2);
    for (let x = x0 - hw + 1; x < x0 + hw; x += 2) { cw(x, wy, z0 - hd, p.glass); cw(x, wy, z0 + hd, p.glass); }
    for (let z = z0 - hd + 1; z < z0 + hd; z += 2) { cw(x0 - hw, wy, z, p.glass); cw(x0 + hw, wy, z, p.glass); }
    // 扉
    let dx = x0, dz = z0 + hd;
    if (door === 'N') dz = z0 - hd; else if (door === 'W') { dx = x0 - hw; dz = z0; } else if (door === 'E') { dx = x0 + hw; dz = z0; }
    c(dx, baseY, dz, p.woodDark); c(dx, baseY + 1, dz, p.woodDark);
    if (opts.flat) {                       // 平屋根 (砂漠様式): 娘壁
      for (let x = x0 - hw; x <= x0 + hw; x++) for (let z = z0 - hd; z <= z0 + hd; z++)
        if (x === x0 - hw || x === x0 + hw || z === z0 - hd || z === z0 + hd) c(x, baseY + hh + 1, z, opts.flatFill || p.wallCream);
    } else {                               // 切妻屋根 (x方向勾配)
      const rb = baseY + hh + 1;
      for (let k = 0; k <= hw + 1; k++) {
        const yy = rb + k;
        box(x0 - hw + k, x0 + hw - k, yy, yy, z0 - hd - 1, z0 + hd + 1, roofP);
      }
    }
  }

  function tower(cx, cz, r, baseY, hh, wallP, capP, opts) {
    opts = opts || {};
    for (let y = baseY; y < baseY + hh; y++)
      for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++)
        for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d > r + .25) continue;
          const edge = d > r - 1.05;
          let pi = wallP;
          if (opts.accent && ((y % 5 === 3) && edge)) { glow(Math.round(x), y, Math.round(z), opts.accent); continue; }
          if (edge) c(x, y, z, pi);
        }
    // 城壁の歯 (cavalier hat)
    for (let a = 0; a < 8; a++) {
      const ang = a / 8 * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r), z = Math.round(cz + Math.sin(ang) * r);
      if ((a & 1) === 0) { c(x, baseY + hh, z, wallP); c(x, baseY + hh + 1, z, wallP); }
    }
    // 屋根 (円錐)
    const yb = baseY + hh + 2;
    for (let k = 0; ; k++) {
      const rr = r + .5 - k; if (rr < -.2) break;
      cyl(cx, cz, Math.max(0, rr), yb + k, yb + k, capP);
    }
  }

  function wallSeg(x0, z0, x1, z1, baseY, hh, pi, gateC, gateHalf) {
    // axis-aligned; gateC = ゲート中心軸座標 (gate が通る側だけ), gateHalf = 開口径
    const axH = z0 === z1;                      // x 方向の壁
    for (let t = 0; t <= 200; t++) {
      const x = Math.round(V.lerp(x0, x1, t / 200)), z = Math.round(V.lerp(z0, z1, t / 200));
      if (!axH && (x !== Math.round(x0))) continue;
      if (axH && (z !== Math.round(z0))) continue;
      const gc = axH ? z : x;
      if (gateHalf != null && Math.abs(gc - gateC) <= gateHalf) continue;
      for (let y = baseY; y < baseY + hh; y++) c(x, y, z, pi);
      c(x, baseY + hh, z, ((x + z) & 1) ? p.ironDark : pi);   // 胸壁のギザギザ
    }
  }

  function stall(x, z, stripP, dir) {
    const baseY = hAt(x, z);
    for (const [ox, oz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) c(x + ox, baseY, z + oz, p.woodDark);
    box(x - 1, x + 1, baseY + 2, baseY + 2, z - 1, z + 1, stripP);
    box(x - 1, x + 1, baseY + 1, baseY + 1, z - 1, z - 1, p.straw);   // 商品棚
    c(x, baseY + 3, z, rng() > .5 ? p.gold : p.crystal);
  }

  function fountain(cx, cz) {
    const baseY = hAt(cx, cz);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++)
      if (Math.abs(x) === 2 || Math.abs(z) === 2) { c(cx + x, baseY, cz + z, p.rockL); c(cx + x, baseY + 1, cz + z, p.rock); }
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) glow(cx + x, baseY + 1, cz + z, p.crystal);
    c(cx, baseY + 2, cz, p.rockL); c(cx, baseY + 3, cz, p.rockL); c(cx, baseY + 4, cz, p.waterWhl);
  }

  function tent(x, z, palP) {
    const b = hAt(x, z);
    for (let k = -1; k <= 1; k++) { box(x + k, x + k, b, b + Math.max(0, 1 - Math.abs(k)), z - 1, z + 1, palP); }
    c(x, b, z + 1, p.castleB3);   // 暗い出入口
    box(x - 2, x + 2, b, b, z, z, p.plank);
  }

  function campfire(x, z) {
    const b = hAt(x, z);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) c(x + ox, b, z + oz, p.rockD);
    glow(x, b, z, p.lavaHot); glow(x, b + 1, z, p.lava);
    stx.extras.push({ type: 'light', x: x + .5, y: b + 2.2, z: z + .5, color: 0xff9a3c, intensity: 1.4, dist: 14, flicker: true });
  }

  function windmill(x, z) {
    const b = hAt(x, z);
    cyl(x, z, 2.2, b, b + 4, p.wallCream);
    cyl(x, z, 2.4, b, b, p.wallTan);
    box(x - 1, x + 1, b + 5, b + 5, z - 1, z + 1, p.roofBrown);
    c(x, b + 6, z, p.woodDark);
    stx.extras.push({ type: 'mill', x: x + .5, y: b + 4.6, z: z + 2.8 });
  }

  function farmPlot(cx, cz, fw, fd) {
    const b = hAt(cx, cz);
    for (let x = cx - fw; x <= cx + fw; x++)
      for (let z = cz - fd; z <= cz + fd; z++) {
        const border = x === cx - fw || x === cx + fw || z === cz - fd || z === cz + fd;
        if (border && ((x + z) & 1) === 0) { c(x, b, z, p.fence); c(x, b + 1, z, p.straw); continue; }
        if (border) continue;
        const crop = ((z - cz) % 3 + 3) % 3 !== 1 && rng() > .25;
        c(x, b, z, p.dirt);
        if (crop) { c(x, b + 1, z, rng() > .45 ? p.cropY : p.cropG); if (rng() > .8) c(x, b + 2, z, p.cropY); }
      }
    block(cx - fw - 1, cz - fd - 1, cx + fw + 1, cz + fd + 1);
  }

  function treeOak(x, z) {
    const b = hAt(x, z);
    const th = RI(2, 3);
    for (let y = 0; y < th; y++) c(x, b + y, z, p.wood);
    const lp = rng() > .5 ? p.leaf1 : rng() > .4 ? p.leaf3 : p.leaf2;
    blob(x, b + th + 1, z, 1.9 + rng(), 1.5, 1.9 + rng(), lp, true);
    c(x, b + th + 3, z, lp);
  }
  function treePine(x, z) {
    const b = hAt(x, z);
    const th = RI(2, 3), tall = rng() > .4;
    for (let y = 0; y < th + (tall ? 2 : 0); y++) c(x, b + y, z, p.woodDark);
    const lp = rng() > .5 ? p.pine1 : p.pine2;
    let yy = b + th - 1;
    for (let k = 0; k < 3 + (tall ? 1 : 0); k++) {
      const r = 1.8 - k * .5;
      cyl(x, z, Math.max(.2, r), yy, yy + 1, lp);
      yy += 2;
    }
    c(x, yy, z, lp);
  }
  function treePalm(x, z) {
    const b = hAt(x, z);
    const th = RI(3, 5);
    for (let y = 0; y < th; y++) c(x + ((y > 1 && (y & 2)) ? 1 : 0), b + y, z, p.wood);
    const tx = x + ((th > 1 && (th & 2)) ? 1 : 0), ty = b + th;
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      c(tx + ax, ty, z + az, p.palmLeaf); c(tx + ax * 2, ty - 1, z + az * 2, p.palmLeaf);
    }
    c(tx, ty + 1, z + 1, p.palmLeaf); c(tx, ty + 1, z - 1, p.palmLeaf); c(tx, ty, z, p.straw);
    if (rng() > .5) c(x, b + 1, z, p.sandW);
  }
  function treeDead(x, z) {
    const b = hAt(x, z);
    const th = RI(2, 4);
    for (let y = 0; y < th; y++) c(x, b + y, z, p.deadWood);
    c(x + 1, b + th - 1, z, p.deadWood); c(x - 1, b + th, z, p.deadWood); c(x, b + th, z + 1, p.deadWood);
  }
  function giantTree(cx, cz) {
    const b = hAt(cx, cz);
    block(cx - 6, cz - 6, cx + 6, cz + 6);
    for (let y = 0; y < 9; y++) for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]])
      c(cx + ox, b + y, cz + oz, y > 5 ? p.wood : p.woodDark);
    for (const [ox, oz] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) c(cx + ox, b, cz + oz, p.woodDark);
    blob(cx, b + 11, cz, 5.4, 3.2, 5.4, p.leaf2, true);
    blob(cx - 3, b + 9, cz + 2, 3, 2, 3, p.leaf1, true);
    blob(cx + 3, b + 10, cz - 2, 3, 2.2, 3, p.leaf3, true);
    for (const [ox, oz] of [[-2, -2], [2, 2], [-2, 2]]) glow(cx + ox, b + 1, cz + oz, p.portalG);
    stx.extras.push({ type: 'light', x: cx + .5, y: b + 3, z: cz + .5, color: 0x54e6c8, intensity: 1.1, dist: 16 });
  }

  function cactus(x, z) {
    const b = hAt(x, z);
    const th = RI(2, 3);
    for (let y = 0; y < th; y++) c(x, b + y, z, p.cactus);
    if (th > 2) { c(x + 1, b + 1, z, p.cactus); c(x + 1, b + 2, z, p.cactus); }
    if (rng() > .5) { c(x - 1, b + 1, z, p.cactus); }
    if (rng() > .6) c(x, b + th, z, p.flowerR);
  }
  function rockBoulder(x, z) {
    const b = hAt(x, z);
    const pi = rng() > .5 ? p.rockD : p.gravel;
    c(x, b, z, pi); if (rng() > .4) c(x + 1, b, z, pi), c(x, b, z + 1, pi);
    if (rng() > .6) c(x, b + 1, z, pi);
  }
  function crystalCluster(x, z) {
    const b = hAt(x, z);
    for (let k = 0; k < 3; k++) {
      const ox = RI(-1, 1), oz = RI(-1, 1), hh = RI(1, 3);
      for (let y = 0; y < hh; y++) glow(x + ox, b + y, z + oz, p.crystal);
    }
  }
  function bonePile(x, z) {
    const b = hAt(x, z);
    c(x, b, z, p.bone); if (rng() > .4) c(x + 1, b, z, p.bone); if (rng() > .5) c(x, b + 1, z, p.bone);
  }
  function obelisk(x, z, h, pi) {
    const b = hAt(x, z);
    box(x - 1, x + 1, b, b, z - 1, z + 1, p.sandstone);
    for (let y = 1; y < h; y++) { c(x, b + y, z, y % 3 === 2 ? p.gold : pi); if (y > h - 3) c(x + (x & 1) ? 0 : 0, b, z, pi); }
    glow(x, b + h, z, p.gold);
  }
  function stoneTrail(x0, z0, x1, z1, palP) {
    const pts = V.polyPoints([[x0, z0], [x1, z1]], .8);
    let i = 0;
    for (const [px, pz] of pts) {
      if ((i++ & 1) === 0) continue;
      const x = Math.round(px), z = Math.round(pz), b = hAt(x, z);
      if (V.world.water[V.world.idx(x, z)]) continue;
      c(x, b - 1 + 1, z, palP || p.cobbleD);   // 地表と面一に敷石
    }
  }

  /* ================= ダンジョン類 ================= */
  function forestDungeon(cx, cz) {
    const b = hAt(cx, cz);
    block(cx - 7, cz - 8, cx + 7, cz + 6);
    // 遺跡リング (折れた石柱)
    for (let a = 0; a < 10; a++) {
      const ang = a / 10 * Math.PI * 2, rr = 5.2;
      const x = Math.round(cx + Math.cos(ang) * rr), z = Math.round(cz + Math.sin(ang) * rr);
      if (Math.abs(z - (cz + 6)) < 1.4 && Math.abs(x - cx) < 2) continue;   // 入口路を開ける
      const hh = RI(1, 3);
      for (let y = 0; y <= hh; y++) c(x, b + y, z, rng() > .5 ? p.mossStone : p.rockL);
    }
    // 石門 + ポータル
    const gz = cz - 2;
    for (const sx of [-2, -1, 1, 2]) { c(cx + sx, b, gz, p.rockL); c(cx + sx, b + 1, gz, p.rockL); c(cx + sx, b + 2, gz, p.rockL); }
    box(cx - 2, cx + 2, b + 3, b + 3, gz, gz, p.rock);
    c(cx - 2, b + 4, gz, p.rune); c(cx + 2, b + 4, gz, p.rune); c(cx, b + 4, gz, p.rune);
    for (let y = 0; y <= 2; y++) for (const x of [-1, 0, 1]) glow(cx + x, b + y, gz - 1, ((x + y) & 1) ? p.portalG : p.portalD);
    // 内陣のルーン石柱
    for (const [ox, oz] of [[-2, 2], [2, 2]]) { c(cx + ox, b, cz + oz, p.mossStone); glow(cx + ox, b + 1, cz + oz, p.rune); }
    stx.extras.push({ type: 'light', x: cx + .5, y: b + 2.4, z: gz - .5, color: 0x54e6c8, intensity: 1.6, dist: 15 });
    stoneTrail(cx, cz + 7, 57, 110, p.cobbleD);
  }

  function mineEntrance(cx, cz) {   // 南 face を向く岩山トンネル入口 (cz が口、内側は -z)
    const b = hAt(cx, cz);
    block(cx - 7, cz - 6, cx + 7, cz + 2);
    for (let x = cx - 6; x <= cx + 6; x++)
      for (let z = cz - 5; z <= cz; z++) {
        const top = b + 9 - Math.abs(x - cx) * .8 - (cz - z) * .3;
        for (let y = hAt(x, z); y <= top; y++) c(x, y, z, rng() > .6 ? p.rockD : p.rock);
      }
    // 坑口: 木枠 + 暗闇
    for (const sx of [-2, 2]) { c(cx + sx, b, cz, p.woodDark); c(cx + sx, b + 1, cz, p.wood); c(cx + sx, b + 2, cz, p.wood); c(cx + sx, b + 3, cz, p.woodDark); }
    box(cx - 2, cx + 2, b + 4, b + 4, cz, cz, p.woodDark);
    for (let x = -1; x <= 1; x++) for (let y = 0; y <= 3; y++) c(cx + x, b + y, cz - 1, p.castleB3);
    box(cx - 2, cx + 2, b, b, cz - 4, cz - 1, p.gravel);       // 坑内床
    for (let x = -1; x <= 1; x += 2) { c(cx + x, b, cz + 1, p.gold); glow(cx + x, b + 1, cz + 1, p.lavaHot); }
    stx.extras.push({ type: 'light', x: cx + .5, y: b + 2.4, z: cz + 1.6, color: 0xffb85c, intensity: 1.3, dist: 12, flicker: true });
    // 鉱車とレール
    for (let t = 0; t < 6; t++) c(cx - 4 + t, hAt(cx - 4 + t, cz + 3), cz + 3, p.ironDark);
    box(cx - 5, cx - 4, hAt(cx - 5, cz + 3) + 1, hAt(cx - 5, cz + 3) + 2, cz + 3, cz + 3, p.woodDark);
    glow(cx - 6, hAt(cx - 6, cz + 4), cz + 4, p.gold);         // 鉱脈の輝き
  }

  function demonCastle() {
    const cx = 210, cz = 26;
    const b = padCircle(cx, cz, 9, Math.max(9, hAt(cx, cz)));
    block(cx - 14, cz - 12, cx + 14, cz + 13);
    // 城壁リング
    for (let a = 0; a < 64; a++) {
      const ang = a / 64 * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * 8), z = Math.round(cz + Math.sin(ang) * 8);
      if (z > cz + 7 && Math.abs(x - cx) < 2.1) continue;      // 南門を開ける
      for (let y = b; y < b + 5; y++) c(x, y, z, ((x + z + y) & 3) === 0 ? p.castleB2 : p.castleBlk);
      if (((a & 3) !== 3)) c(x, b + 5, z, p.castleB3);
    }
    // 四隅の塔
    for (const [sx, sz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]])
      tower(cx + sx, cz + sz, 2.4, b, 9, p.castleBlk, p.castleB3, { accent: p.rune });
    // メインキープ
    const kx = cx, kz = cz - 3;
    box(kx - 3, kx + 3, b, b + 12, kz - 3, kz + 3, p.castleB2, 'hollow');
    for (let y = b + 1; y < b + 12; y += 3) { c(kx, y, kz + 3.5 - 0, p.rune); }
    box(kx - 3, kx + 3, b + 13, b + 13, kz - 3, kz + 3, p.castleBlk);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++)
      if ((x & 1) === 0 && (z & 1) === 0) c(kx + x, b + 14, kz + z, p.castleB3);
    cyl(kx, kz, 2, b + 14, b + 18, p.castleBlk);
    glow(kx, b + 19, kz, p.rune);
    stx.extras.push({ type: 'light', x: kx + .5, y: b + 20.5, z: kz + .5, color: 0x9a5cff, intensity: 1.6, dist: 26 });
    // 門楼
    for (const sx of [-3, 3]) { cyl(cx + sx, cz + 8, 1.7, b, b + 8, p.castleBlk); c(cx + sx, b + 9, cz + 8, p.rune); }
    box(cx - 4, cx + 4, b + 5, b + 6, cz + 8, cz + 8, p.castleB2);
    for (const sx of [-1, 0, 1]) { c(cx + sx, b, cz + 8, p.ironDark); c(cx + sx, b + 1, cz + 8, p.ironDark); c(cx + sx, b + 2, cz + 8, p.ironDark); }
    // 本殿 (西棟)
    box(cx - 6, cx - 2, b, b + 5, cz - 2, cz + 3, p.castleB3, 'hollow');
    box(cx - 6, cx - 2, b + 6, b + 6, cz - 2, cz + 3, p.castleBlk);
    // 玄武岩の柱 & デッドツリー枠外は scatter 任せ。庭のルーン池
    for (const [ox, oz] of [[-4, -6], [4, -6], [-5, 2], [5, 1]]) { c(cx + ox, b, cz + oz, p.castleB3); glow(cx + ox, b + 1, cz + oz, p.rune); }
    // 南門前広場 → 城下 (mahou-jou) スポーン地点は padCircle しない (開けた棘岩地)
  }

  function lavaRing(cx, cz, r0, r1) {
    for (let z = Math.max(0, cz - r1 | 0); z <= Math.min(W - 1, cz + r1 | 0); z++)
      for (let x = Math.max(0, cx - r1 | 0); x <= Math.min(W - 1, cx + r1 | 0); x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d < r0 || d > r1) continue;
        if (z < cz - 3) continue;                       // 南と東に流れる溶岩湖
        if (V.world.water[V.world.idx(x, z)]) continue;
        const b = hAt(x, z);
        glow(x, b, z, rng() > .35 ? p.lava : p.lavaHot);
      }
    stx.extras.push({ type: 'light', x: cx + r0 + 2.5, y: hAt(cx + r0 + 2, cz + 4) + 2, z: cz + r0 - 2.5, color: 0xff7a2e, intensity: 1.6, dist: 30 });
  }

  function ziggurat(cx, cz) {
    const b = padCircle(cx, cz, 6, null);
    let w = 5;
    for (let y = b; w >= 0; y += 2, w -= 1.4) {
      box(Math.round(cx - w), Math.round(cx + w), y, y + 1, Math.round(cz - w), Math.round(cz + w), p.sandstone, 'hollow');
      if (w > 3.4) for (const s of [[0, 1], [0, -1]]) c(cx + s[0], y, cz + s[1] * (Math.round(w)), p.sandW);
    }
    box(cx - 1, cx + 1, b, b + 2, Math.round(cz + 4) , Math.round(cz + 4), p.ironDark);   // 内部暗室
    c(cx - 2, b + 1, cz + 5, p.gold); c(cx + 2, b + 1, cz + 5, p.gold);
    glow(cx, b + 9, cz, p.crystal); c(cx, b + 8, cz, p.gold);
    stx.extras.push({ type: 'light', x: cx + .5, y: b + 10.4, z: cz + .5, color: 0x7fd4ff, intensity: 1.2, dist: 18 });
  }

  function desertWalls() {
    const x0 = 190, x1 = 211, z0 = 157, z1 = 176;
    const b = Math.round((hAt(x0 + 3, z0) + hAt(x0 + 3, z1)) / 2);
    padCircle(200, 167, 9, null);
    wallSeg(x0, z0, x1, z0, b, 4, p.sandstone);          // 北
    wallSeg(x0, z1, x1, z1, b, 4, p.sandstone);          // 南
    wallSeg(x0, z0, x0, z1, b, 4, p.sandstone, 167, 1.4);// 西 (門あり)
    wallSeg(x1, z0, x1, z1, b, 4, p.sandstone);          // 東
    tower(x0, z0, 2.2, b, 6, p.sandstone, p.sandW); tower(x1, z0, 2.2, b, 6, p.sandstone, p.sandW);
    tower(x0, z1, 2.2, b, 6, p.sandstone, p.sandW); tower(x1, z1, 2.2, b, 6, p.sandstone, p.sandW);
    for (const sx of [-3, 3]) c(200 + sx, hAt(200 + sx | 0, z1), Math.round(z1), p.sandW);
  }

  function bridgeBuild(pts, dir) {
    // dir: 'x' or 'z' crossing; pts = [sample..., bankY]
  }

  /* ================= フェーズA: パッド ================= */
  const TOWN_HOUSES = [
    [127, 148, 5, 5, p.roofRed], [136, 145, 6, 5, p.roofBlue], [145, 149, 5, 5, p.roofBrown],
    [147, 156, 5, 5, p.roofRed], [145, 168, 6, 5, p.roofBlue], [136, 172, 5, 5, p.roofTeal],
    [126, 169, 5, 5, p.roofBrown], [124, 147, 5, 4, p.roofTeal]
  ];
  const DESERT_HOUSES = [[195, 161, 4, 4], [206, 161, 4, 4], [194, 173, 4, 4], [206, 173, 4, 4], [200, 159, 4, 4]];
  const MINE_HOUSES = [[132, 92, 5, 4], [143, 91, 5, 4], [138, 96, 5, 4]];

  stx.pads = function () {
    for (const [x, z, w] of TOWN_HOUSES) V.world.pad(x, z, Math.floor(w / 2) + 1, Math.floor(5 / 2) + 1);
    for (const [x, z, w, d] of DESERT_HOUSES) V.world.pad(x, z, Math.floor(w / 2) + 1, Math.floor(d / 2) + 1);
    for (const [x, z, w, d] of MINE_HOUSES) V.world.pad(x, z, Math.floor(w / 2) + 1, Math.floor(d / 2) + 1);
    padCircle(136, 157, 5.5, null);                 // 町の中心広場
    padCircle(56, 114, 6.5, null);                  // 森の宿営地
    padCircle(40, 92, 6.5, null);                   // 大公樹の谷
    forestDungeonPad();
    V.world.pad(139, 79, 6, 3, null);               // 鉱山前
    for (const [x, z] of MINE_HOUSES) { /* pad済み */ }
    demonCastlePad();
    const b = hAt(190, 150);                        // オアシス周りを固める
    block(185, 145, 195, 155);
    V.world.pad(200, 186, 7, 7);                    // ジッグラートの丘
  };
  function forestDungeonPad() { padCircle(54, 90, 7, null); }
  function demonCastlePad() { /* demonCastle() 内で実施 */ }

  stx.paintPads = function () {
    const P = V.world.paint;
    // 町の広場: 市松の敷石
    for (let z = -6; z <= 6; z++) for (let x = -6; x <= 6; x++) {
      const cx = 136 + x, cz = 157 + z;
      if (Math.hypot(x, z) > 6.2) continue;
      P(cx, cz, ((x + z) & 1) ? p.cobble : p.cobbleD);
    }
    // 砂漠の街の内区画
    for (let z = 158; z <= 175; z++) for (let x = 191; x <= 210; x++) P(x, z, ((x * z + x) % 5 === 0) ? p.sandW : p.clay_road);
    // 森の遺跡は苔、城の中庭は黒岩
    for (let z = -7; z <= 7; z++) for (let x = -7; x <= 7; x++) {
      if (Math.hypot(x, z) > 7.2) continue;
      P(54 + x, 90 + z, rng() > .6 ? p.moss : p.darkGrass);
    }
    for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) {
      const d = Math.hypot(x, z); if (d > 9.2 || d < 2) continue;
      P(210 + x, 26 + z, rng() > .5 ? p.darkSoil : p.ashRock);
    }
    // ジッグラートの参道
    for (let z = 178; z <= 184; z++) for (let x = 199; x <= 201; x++) P(x, z, p.clay_road);
  };

  /* ================= フェーズC: 刻印本体 ================= */
  stx.build = function () {
    const Wm = V.world;

    /* ---- 町 ---- */
    for (let i = 0; i < TOWN_HOUSES.length; i++) {
      const [x, z, w, d, roof] = TOWN_HOUSES[i];
      const ang = Math.atan2(z - 157, x - 136);
      const door = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang)) ? (Math.cos(ang) > 0 ? 'W' : 'E') : (Math.sin(ang) > 0 ? 'N' : 'S');
      house(x, z, w, d, 3, i % 3 === 0 ? p.wallCream : p.wallWht, roof, door, { stripes: i % 2 === 0 });
    }
    fountain(136, 157);
    well(131, 160); noticeBoard(139, 162);
    farmPlot(148, 168, 3, 5); farmPlot(153, 176, 3, 5); farmPlot(146, 182, 3, 4);
    windmill(116, 170);
    // 森の宿営地
    tent(57, 112, p.canvas1); tent(59, 116, p.leaf2); campfire(55, 114);
    stall(53, 117, p.stripB);
    giantTree(40, 92); forestDungeon(54, 90);

    /* ---- 山 ---- */
    mineEntrance(139, 79);
    for (let i = 0; i < MINE_HOUSES.length; i++) {
      const [x, z] = MINE_HOUSES[i];
      house(x, z, 5, 4, 3, p.rockL, p.roofBrown, 'S', {});
    }
    campfire(137, 88);
    for (const [ox, oz] of [[-8, 2], [-5, -6], [7, -8], [10, -3]]) crystalCluster(139 + ox, 79 + oz);

    /* ---- 砂漠の街 ---- */
    desertWalls();
    for (const [x, z, w, d] of DESERT_HOUSES) house(x, z, w, d, 3, p.wallTan, 0, 'E', { flat: true, flatFill: p.sandW });
    fountain(200, 167);
    for (let a = 0; a < 8; a++) {
      const ang = a / 8 * Math.PI * 2 + .3;
      stall(Math.round(200 + Math.cos(ang) * 5), Math.round(167 + Math.sin(ang) * 5), a % 2 ? p.stripR : p.stripB);
    }
    ziggurat(200, 186);
    obelisk(186, 163, 5, p.sandstone); obelisk(186, 172, 5, p.sandstone);

    /* ---- 魔王城 ---- */
    demonCastle();
    lavaRing(210, 26, 11.5, 14.5);
    for (const [ox, oz] of [[-10, 8], [-13, 3], [12, 7], [9, 12]]) bonePile(210 + ox, 26 + oz);

    /* ---- オアシス / 植栽 ---- */
    for (let a = 0; a < 9; a++) {
      const ang = a / 9 * Math.PI * 2;
      treePalm(Math.round(190 + Math.cos(ang) * 4.5), Math.round(150 + Math.sin(ang) * 4.5));
    }
    treePalm(208, 172); treePalm(193, 161);

    /* ---- 橋 (道路 × 水面 を自動検出) ---- */
    stampBridges();

    /* ---- 樹木・小物の散布 ---- */
    scatterAll();

    return buf;
  };

  function well(x, z) {
    const b = hAt(x, z);
    for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) c(x + ox, b, z + oz, p.rockL);
    glow(x, b, z, p.crystal);
    c(x - 1, b + 2, z, p.woodDark); c(x + 1, b + 2, z, p.woodDark); box(x - 1, x + 1, b + 3, b + 3, z - 1, z + 1, p.roofBrown);
  }
  function noticeBoard(x, z) {
    const b = hAt(x, z);
    c(x, b, z, p.woodDark); box(x - 1, x + 1, b + 1, b + 2, z, z, p.plank);
  }

  function stampBridges() {
    const Wm = V.world;
    for (const rd of V.LAYOUT.roads) {
      const pts = V.polyPoints(rd.pts, .5);
      for (let i = 0; i < pts.length; i++) {
        const [px, pz] = pts[i];
        const x = Math.round(px), z = Math.round(pz);
        if (!Wm.inB(x, z) || !Wm.water[Wm.idx(x, z)]) continue;
        // 陸地がすぐ両側にあるか (幅の広い海は橋にしない: 半径3以内に陸 && 川/湖)
        let bank = null;
        for (let s = 1; s <= 7; s++) {
          const a = Wm.hAt(x + s, z), b2 = Wm.hAt(x - s, z), c1 = Wm.hAt(x, z + s), d1 = Wm.hAt(x, z - s);
          if (a >= SEA || b2 >= SEA) { bank = Math.max(a, b2); break; }
          if (c1 >= SEA || d1 >= SEA) { bank = Math.max(c1, d1); break; }
        }
        if (bank == null) continue;
        const dirX = Wm.hAt(x + 1, z) >= SEA || Wm.hAt(x - 1, z) >= SEA;
        const y = bank - 1;
        if (dirX) for (let o = -1; o <= 1; o++) c(x, y, z + o, p.plank);
        else for (let o = -1; o <= 1; o++) c(x + o, y, z, p.plank);
        // 手すり柱
        if ((x + z) % 2 === 0) {
          if (dirX) { c(x, y + 1, z - 1, p.fence); c(x, y + 1, z + 1, p.fence); }
          else { c(x - 1, y + 1, z, p.fence); c(x + 1, y + 1, z, p.fence); }
        }
      }
    }
  }

  /* ---------- 散布 ---------- */
  const occ = new Uint8Array(W * W);
  function canPlant(x, z) {
    if (x < 3 || z < 3 || x > W - 4 || z > W - 4) return false;
    const i = V.world.idx(x, z);
    if (V.world.water[i] || V.world.road[i] || V.world.noScatter[i] || occ[i]) return false;
    return true;
  }
  function markOcc(x, z, r) {
    for (let zz = Math.max(0, z - r); zz <= Math.min(W - 1, z + r); zz++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) occ[V.world.idx(xx, zz)] = 1;
  }
  function scatterAll() {
    const F = V.LAYOUT.field;
    const fwAt = (x, z) => V.smoothstep(1.08, .35, Math.hypot((x - F.forest.cx) / F.forest.rx, (z - F.forest.cz) / F.forest.rz));
    const dwAt = (x, z) => V.smoothstep(1.08, .35, Math.hypot((x - F.desert.cx) / F.desert.rx, (z - F.desert.cz) / F.desert.rz));
    const cwAt = (x, z) => V.smoothstep(1.08, .35, Math.hypot((x - F.castle.cx) / F.castle.cx * 0 + (x - F.castle.cx) / F.castle.rx, (z - F.castle.cz) / F.castle.rz));
    for (let z = 4; z < W - 4; z++) for (let x = 4; x < W - 4; x++) {
      if (!canPlant(x, z)) continue;
      const h = hAt(x, z);
      const fw = fwAt(x, z), dw = dwAt(x, z), cw = cwAt(x, z);
      // 森:密度の高い針葉樹+広葉樹
      if (fw > .42 && rng() < .062 * fw) {
        if (rng() > .38) treePine(x, z); else treeOak(x, z);
        markOcc(x, z, 2.2); continue;
      }
      // 平原:まばらな森のまだら
      const clump = V.fbm(x * .04, z * .04, 3, 71);
      if (fw < .3 && dw < .35 && cw < .3 && h > SEA + 1 && rng() < .028 * Math.max(0, clump - .48) * 6) {
        treeOak(x, z); markOcc(x, z, 2.2); continue;
      }
      // 山の針葉樹帯
      if (h >= 12 && h <= 15.5 && rng() < .03) { treePine(x, z); markOcc(x, z, 2); continue; }
      // 砂漠:サボテン
      if (dw > .45 && cw < .3 && rng() < .013) { cactus(x, z); markOcc(x, z, 1.6); continue; }
      // 魔界:枯れ木
      if (cw > .4 && rng() < .016) { treeDead(x, z); markOcc(x, z, 2); continue; }
      // 草原の花・岩
      if (fw < .35 && dw < .35 && cw < .3 && h > SEA + 1) {
        const r = rng();
        if (r < .016) c(x, hAt(x, z), z, rng() > .5 ? p.flowerR : p.flowerY);
        else if (r < .021) rockBoulder(x, z);
        else if (r < .023 && clump > .55) c(x, hAt(x, z), z, p.mush);
      }
    }
    // 山岳地帯のクリスタル群生
    for (let k = 0; k < 14; k++) {
      const x = RI(70, 190), z = RI(30, 62);
      if (!canPlant(x, z) || hAt(x, z) < SEA + 2) continue;
      crystalCluster(x, z); markOcc(x, z, 2);
    }
  }
})();
