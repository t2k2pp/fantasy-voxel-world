/* ============================================================
 *  core.js — RNG / ノイズ / パレット / ワールドレイアウト定義
 *  ファンタジー・ボクセルワールド (Mob生活シミュレータ土台)
 * ============================================================ */
window.VFV = window.VFV || {};
(function () {
  const V = window.VFV;

  /* ---------- seeded RNG & noise ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const seed = new URLSearchParams(location.search).get('seed');
  V.rng = mulberry32(seed ? (+seed | 0) : 1337);

  function hash2(x, y, s) {
    x |= 0; y |= 0;
    let n = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  const smooth = t => t * t * (3 - 2 * t);

  V.n2 = function (x, y, s) {
    s = s || 0;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
    const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  V.fbm = function (x, y, oct, s) {
    let f = 1, a = .5, sum = 0, norm = 0; oct = oct || 4; s = s || 0;
    for (let i = 0; i < oct; i++) { sum += a * V.n2(x * f, y * f, s + i * 37); norm += a; f *= 2; a *= .5; }
    return sum / norm;
  };
  V.ridge = function (x, y, oct, s) {
    let f = 1, a = .5, sum = 0, norm = 0; oct = oct || 3; s = s || 0;
    for (let i = 0; i < oct; i++) {
      const n = V.n2(x * f, y * f, s + i * 91);
      sum += a * (1 - Math.abs(n * 2 - 1)); norm += a; f *= 2; a *= .6;
    }
    return sum / norm;
  };

  V.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  V.smoothstep = (e0, e1, x) => { const t = V.clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
  V.lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- palette ---------- */
  const PAL = [];                      // {r,g,b,j} j=ジッター幅
  function C(hex, j) {
    PAL.push({ r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, j: j == null ? .05 : j });
    return PAL.length - 1;
  }
  V.PAL = PAL;
  V.C = C;                       // 追加色登録用

  const p = {};   // 名前付きパレットindex
  // --- 自然 ---
  p.grass     = C(0x6fae4f, .07);  p.grass2 = C(0x5c9d42, .07);  p.grass3 = C(0x82bd5c, .07);
  p.moss      = C(0x4a8338, .08);  p.darkGrass = C(0x3f6f35, .08);
  p.dirt      = C(0x8a6b45, .06);  p.rockD   = C(0x6d727c, .05);  p.rock    = C(0x818691, .05);
  p.rockL     = C(0x989daa, .04);  p.snow    = C(0xeef3fa, .03);  p.gravel  = C(0x8f8d82, .06);
  p.sand      = C(0xd9bf7f, .05);  p.sand2   = C(0xcdb172, .05);  p.sandW   = C(0xe4cf94, .04);
  p.sandstone = C(0xc8a669, .05);  p.clay    = C(0xb3714a, .05);
  p.ash       = C(0x4c4251, .06);  p.ashRock = C(0x3a3140, .06);  p.darkSoil= C(0x2e2833, .06);
  p.leaf1     = C(0x3f8f3a, .07);  p.leaf2   = C(0x2f7534, .07);  p.leaf3   = C(0x57a346, .07);
  p.pine1     = C(0x2c6b3e, .07);  p.pine2   = C(0x255a36, .07);
  p.palmLeaf  = C(0x4fae55, .06);
  p.deadWood  = C(0x5f4b3a, .06);  p.wood    = C(0x8a6a42, .05);  p.woodDark= C(0x5c452b, .05);
  p.plank     = C(0xa1794a, .05);
  // --- 街道具 ---
  p.wallCream = C(0xd9c9a3, .04);  p.wallWht = C(0xe8e2d4, .04);  p.wallTan = C(0xc7ab7d, .04);
  p.roofRed   = C(0xb8503f, .05);  p.roofBlue= C(0x4a6fa5, .05);  p.roofBrown=C(0x7d5a3c, .05);
  p.roofTeal  = C(0x3e8577, .05);
  p.glass     = C(0x2c4666, .02);  p.straw   = C(0xc9a84c, .05);
  p.cobble    = C(0x9b958a, .06);  p.cobbleD = C(0x7f7a71, .06);  p.clay_road=C(0xb99b6d, .05);
  p.fence     = C(0x947248, .05);  p.cropY   = C(0xcfb03e, .06);  p.cropG   = C(0x7ba53c, .07);
  p.canvas1   = C(0xd9d2bd, .04);  p.stripR  = C(0xc06a58, .05);  p.stripB  = C(0x5c7fb0, .05);
  p.banner    = C(0xa03a4e, .04);
  // --- ダーク / 光 ---
  p.castleBlk = C(0x2b2436, .04);  p.castleB2= C(0x383049, .05);  p.castleB3= C(0x211b2d, .04);
  p.rune      = C(0x7f3fbf, 0);    p.lava    = C(0xff6a2a, .08);  p.lavaHot = C(0xffb04a, .1);
  p.portalG   = C(0x59e6c8, 0);    p.portalD = C(0x1f8d7e, 0);    p.crystal = C(0x63c8ff, .02);
  p.gold      = C(0xe8c04a, .04);  p.bone    = C(0xd8cfb8, .05);  p.mossStone=C(0x7d8771, .06);
  // --- 装飾(花・小物) ---
  p.flowerR   = C(0xd4566a, .05);  p.flowerY = C(0xe8c84a, .05);  p.mush    = C(0xc1584b, .05);
  p.waterWhl  = C(0xe3ddca, .03);
  V.p = p;

  /* ---------- biomes ---------- */
  const B = { PLAINS: 0, FOREST: 1, MOUNTAIN: 2, DESERT: 3, CASTLE: 4 };
  V.B = B;
  V.biomeNames = ['平原', '森', '山岳', '砂漠', '魔界'];

  /* ---------- ワールドレイアウト ---------- */
  V.LAYOUT = {
    W: 240, SEA: 5, MAXH: 27,
    regions: [
      { id: 'town',     name: '初めの町',   icon: '🏘️', x: 136, z: 158, r: 26, mapColor: '#7ac74f' },
      { id: 'forest',   name: '森のダンジョン', icon: '🌲', x: 46,  z: 102, r: 33, mapColor: '#2d7a3a' },
      { id: 'mountain', name: '山のダンジョン', icon: '⛰️', x: 138, z: 52,  r: 34, mapColor: '#8b8f9c' },
      { id: 'desert',   name: '砂漠の街',   icon: '🏜️', x: 200, z: 166, r: 35, mapColor: '#e0c070' },
      { id: 'castle',   name: '魔王城',     icon: '🏰', x: 210, z: 24,  r: 26, mapColor: '#7a4fa8' }
    ],
    // 山脈 (だ円) / 砂漠 / 森 の地勢フィールド
    field: {
      mountain: { cx: 128, cz: 38, rx: 80, rz: 30 },
      desert:   { cx: 202, cz: 168, rx: 47, rz: 41 },
      forest:   { cx: 42,  cz: 102, rx: 38, rz: 34 },
      castle:   { cx: 214, cz: 22,  rx: 31, rz: 27 }
    },
    // 川 (山岳湖 → 町西 → 南の海へ) と湖
    river: [[124, 68], [120, 90], [125, 112], [120, 132], [121, 151], [127, 171], [136, 193], [147, 216], [157, 240]],
    riverW: 3.1,
    lakes: [{ x: 122, z: 76, r: 6.5 }, { x: 190, z: 150, r: 3.6 }, { x: 48, z: 112, r: 2.6 }],
    // 峠道 (山脈を抜ける切り立った回廊)
    passCarve: [[170, 80], [178, 66], [186, 54], [194, 44], [200, 37]],
    // 道路ネットワーク (ポリライン)。橋は自動検出
    roads: [
      { pts: [[131, 157], [118, 156], [100, 152], [80, 142], [64, 128], [56, 116]], w: 3 },   // 町↔森
      { pts: [[142, 161], [158, 165], [172, 168], [184, 168]], w: 3 },                          // 町↔砂漠の街(東)
      { pts: [[137, 150], [138, 128], [139, 108], [138, 92], [139, 82]], w: 3 },                // 町↔山のダンジョン
      { pts: [[139, 82], [152, 74], [164, 70], [170, 80]], w: 3 },                              // 鉱山→峠入口
      { pts: [[170, 80], [178, 66], [186, 54], [194, 44], [200, 37], [206, 33]], w: 3 },        // 峠→魔王城
      { pts: [[133, 166], [130, 180], [126, 192], [122, 204]], w: 2 }                           // 町→南(川沿い)
    ],
    cameraPresets: {
      town:     { t: [136, 8, 156], dist: 44, yaw: .9,  pitch: .85 },
      forest:   { t: [52, 9, 100],   dist: 42, yaw: -.6, pitch: .9 },
      mountain: { t: [134, 15, 70],  dist: 58, yaw: .4,  pitch: .95 },
      desert:   { t: [200, 8, 164],  dist: 46, yaw: 2.2, pitch: .85 },
      castle:   { t: [210, 12, 26],  dist: 52, yaw: 3.6, pitch: .8 },
      overview: { t: [124, 6, 130],  dist: 150, yaw: .7, pitch: .95 }
    },
    // モブスポーン台帳 — ここが将来の生活シミュレータの接続点
    towns: [
      { region: 'town',     id: 'hajime-no-machi',  name: '初めの町',   x: 136, z: 157, r: 15, cap: 20, pop: 18, species: 'folk' },
      { region: 'desert',   id: 'sunabata-city',    name: '砂漠の街',   x: 200, z: 167, r: 13, cap: 20, pop: 15, species: 'merchant' },
      { region: 'forest',   id: 'mori-camp',        name: '森の宿営地', x: 56,  z: 114, r: 9,  cap: 20, pop: 10, species: 'sprite' },
      { region: 'mountain', id: 'yama-no-hara',     name: '山岳の集落', x: 137, z: 86,  r: 8,  cap: 14, pop: 7,  species: 'golem' },
      { region: 'castle',   id: 'mahou-jou',        name: '魔王城下',   x: 205, z: 36,  r: 10, cap: 16, pop: 10, species: 'imp' }
    ]
  };

  V.distSeg = function (px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-6;
    let t = ((px - ax) * dx + (pz - az) * dz) / L2;
    t = V.clamp(t, 0, 1);
    const x = px - (ax + dx * t), z = pz - (az + dz * t);
    return Math.sqrt(x * x + z * z);
  };
  // ポリライン上の等間隔サンプル
  V.polyPoints = function (pts, step) {
    step = step || 1; const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  };
})();
