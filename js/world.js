/* ============================================================
 *  world.js — 地盤生成: 高度 / バイオーム / 川・湖 / 峠 / 道路 / パレット確定
 *  使い方: V.world.gen() → (structures.padAll) → V.world.relaxRoads()
 *          → V.world.finalize() → ブロックベイクは bake.js相当(structures側で呼ぶ)
 * ============================================================ */
(function () {
  const V = window.VFV;
  const L = V.LAYOUT, B = V.B, p = V.p;
  const W = L.W, SEA = L.SEA;

  const world = {};
  V.world = world;

  world.H = new Int16Array(W * W);        // 地表面レベル(この値が地面の高さ。ブロックは0..H-1)
  world.biome = new Uint8Array(W * W);
  world.road = new Uint8Array(W * W);     // 道路フラグ
  world.carve = new Uint8Array(W * W);    // 掘削(川・湖・峠)で上書きされた
  world.water = new Uint8Array(W * W);
  world.topPal = new Uint16Array(W * W);
  world.sidePal = new Uint16Array(W * W);
  world.painted = new Uint8Array(W * W);  // structuresによる路面ペイント済みフラグ

  const idx = (x, z) => z * W + x;
  world.idx = idx;
  world.inB = (x, z) => x >= 0 && z >= 0 && x < W && z < W;
  world.hAt = (x, z) => {
    x = Math.floor(x); z = Math.floor(z);
    if (!world.inB(x, z)) return 0;
    return world.H[idx(x, z)];
  };
  world.groundY = (x, z) => world.hAt(x, z);      // モブの足元のy

  // だ円フィールド重み
  function fieldW(x, z, f) {
    const dx = (x - f.cx) / f.rx, dz = (z - f.cz) / f.rz;
    const rn = Math.sqrt(dx * dx + dz * dz);
    return V.smoothstep(1.08, .35, rn);
  }

  /* ---------- 1. 高度生成 ---------- */
  world.genHeights = function () {
    const F = L.field;
    // 川ポリラインのセグメント前計算
    const riv = L.river;
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < W; x++) {
        // --- 基本の平原 ---
        let h = 5.4 + V.fbm(x * .021, z * .021, 4, 3) * 4.6;

        // --- 山脈 (ridged noise) ---
        const mw = fieldW(x, z, F.mountain);
        if (mw > 0.002) {
          let rg = V.ridge(x * .048, z * .048, 4, 7);
          rg = Math.pow(rg, 1.35);
          h += mw * rg * 21;
          h -= mw * 1.2;
        }
        // --- 森の緩やかな丘 ---
        const fw = fieldW(x, z, F.forest);
        if (fw > .002) h += V.fbm(x * .045 + 9, z * .045, 3, 11) * 3.2 * fw;

        // --- 砂漠の砂丘 ---
        const dw = fieldW(x, z, F.desert);
        if (dw > .002) {
          const turb = V.fbm(x * .03, z * .03, 3, 17);
          const dune = (Math.sin((x + z * .55) * .11 + turb * 5.5) + 1) * .5;
          const dh = 6.2 + Math.pow(dune, 1.4) * 3.4 + turb * 1.2;
          h = V.lerp(h, dh, dw);
        }
        // --- 魔王領域の棘岩 ---
        const cw = fieldW(x, z, F.castle);
        if (cw > .002) {
          const spk = Math.pow(V.ridge(x * .095, z * .095, 3, 5), 1.6);
          const ch = 6 + spk * 11.5;
          h = V.lerp(h, ch, cw * .92);
        }

        // --- 南岸 (南端の海) ---
        const coast = 214 + (V.fbm(x * .02, 40.7, 3, 23) - .5) * 30;
        if (z > coast - 9) {
          const k = V.smoothstep(coast - 9, coast + 7, z);
          h = V.lerp(h, 1.6, k);
        }
        // --- 世界フチをなだらかに (海に沈む) ---
        const m = Math.min(x, z, W - 1 - x, W - 1 - z);
        if (m < 5) h = V.lerp(h, 2.0, (5 - m) / 5);

        world.H[idx(x, z)] = Math.max(0, Math.min(L.MAXH - 1, Math.round(h)));
      }
    }
  };

  /* ---------- 2. 川・湖・峠の掘削 ---------- */
  world.carveAll = function () {
    // 川
    const rv = L.river.map(s => ({ x: s[0], z: s[1] }));
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      let d = 1e9;
      for (let i = 0; i < rv.length - 1; i++) {
        const dd = V.distSeg(x, z, rv[i].x, rv[i].z, rv[i + 1].x, rv[i + 1].z);
        if (dd < d) d = dd;
      }
      const wob = (V.n2(x * .08, z * .08, 31) - .5) * 1.4;
      const rw = L.riverW + wob + (z > 195 ? (z - 195) * .06 : 0); // 下流で広がる
      const k = V.smoothstep(rw, rw * .45, d + Math.max(0, Math.min(1, (x - 60) * 0)) * 0);
      if (k > 0) {
        const floorH = SEA - 1.7;
        const cur = world.H[idx(x, z)];
        world.H[idx(x, z)] = Math.round(Math.min(cur, V.lerp(cur, floorH, k)));
        if (d < rw * .8) world.carve[idx(x, z)] = 1;
      }
    }
    // 湖
    for (const lk of L.lakes) {
      const r2 = lk.r * lk.r;
      const x0 = Math.max(0, Math.floor(lk.x - lk.r - 3)), x1 = Math.min(W - 1, Math.ceil(lk.x + lk.r + 3));
      const z0 = Math.max(0, Math.floor(lk.z - lk.r - 3)), z1 = Math.min(W - 1, Math.ceil(lk.z + lk.r + 3));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - lk.x, z - lk.z) / lk.r;
        const k = V.smoothstep(1.05, .6, d);
        if (k > 0) {
          const cur = world.H[idx(x, z)];
          world.H[idx(x, z)] = Math.round(Math.min(cur, V.lerp(cur, SEA - 1.8, k)));
          if (d < .85) world.carve[idx(x, z)] = 1;
        }
      }
    }
    // 峠 (山脈を抜ける回廊: h を8以下に抑える)
    const pp = V.polyPoints(L.passCarve, 1);
    for (const [px, pz] of pp) {
      const x0 = Math.max(0, px - 6 | 0), x1 = Math.min(W - 1, px + 6 | 0);
      const z0 = Math.max(0, pz - 6 | 0), z1 = Math.min(W - 1, pz + 6 | 0);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - px, z - pz);
        if (d < 4.6) {
          const ceiling = V.lerp(7.4, world.H[idx(x, z)], V.smoothstep(2.4, 5.2, d));
          if (world.H[idx(x, z)] > ceiling) world.H[idx(x, z)] = Math.round(ceiling);
        }
      }
    }
  };

  /* ---------- 3. 道路フラグ & やや平坦化 ---------- */
  world.stampRoads = function () {
    for (const rd of L.roads) {
      const pts = V.polyPoints(rd.pts, .7);
      for (const [px, pz] of pts) {
        const x0 = Math.max(0, px - rd.w | 0), x1 = Math.min(W - 1, px + rd.w | 0);
        const z0 = Math.max(0, pz - rd.w | 0), z1 = Math.min(W - 1, pz + rd.w | 0);
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - px, z - pz);
          if (d < rd.w + .4) world.road[idx(x, z)] = 1;
        }
      }
    }
  };

  // 道路セルの高さを隣接平均でなめらかに (川掘削セルは触らない)
  world.relaxRoads = function () {
    const H = world.H;
    for (let it = 0; it < 3; it++) {
      const copy = Int16Array.from(H);
      for (let z = 1; z < W - 1; z++) for (let x = 1; x < W - 1; x++) {
        const i = idx(x, z);
        if (!world.road[i] || world.carve[i]) continue;
        const avg = (copy[i - 1] + copy[i + 1] + copy[i - W] + copy[i + W] + copy[i] * 2) / 6;
        H[i] = Math.round(avg);
      }
    }
  };

  /* ---------- 4. バイオーム & パレット確定 ---------- */
  world.finalize = function () {
    const F = L.field, H = world.H;
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z), h = H[i];
      // バイオーム決定は Influence argmax
      const wP = .35;
      const scores = [
        wP,                                        // PLAINS
        fieldW(x, z, F.forest) * 1.02 + .04,       // FOREST
        fieldW(x, z, F.mountain) * 1.05 + h * .012,// MOUNTAIN
        fieldW(x, z, F.desert) * 1.03 + .02,       // DESERT
        fieldW(x, z, F.castle) * 1.06 + .05        // CASTLE
      ];
      let bi = 0; for (let k = 1; k < 5; k++) if (scores[k] > scores[bi]) bi = k;
      world.biome[i] = bi;

      const n = V.n2(x * .37, z * .37, 41);   // 斑模様
      const n2v = V.n2(x * .11, z * .11, 53);
      let top, side;
      switch (bi) {
        case B.PLAINS:  top = n < .33 ? p.grass : n < .66 ? p.grass2 : p.grass3; side = p.dirt; break;
        case B.FOREST:  top = n < .4 ? p.moss : n < .75 ? p.darkGrass : p.leaf2;  side = p.dirt; break;
        case B.MOUNTAIN:
          if (h >= 19) { top = p.snow; side = p.rockL; }
          else if (h >= 15) { top = n < .5 ? p.rockL : p.rock; side = p.rockD; }
          else if (h >= 12) { top = p.rock; side = p.rockD; }
          else { top = n2v > .62 ? p.gravel : p.grass2; side = p.dirt; }
          break;
        case B.DESERT:  top = n < .3 ? p.sand2 : n < .78 ? p.sand : p.sandW; side = p.sandstone; break;
        case B.CASTLE:  top = n < .5 ? p.ash : p.ashRock; side = p.darkSoil; break;
      }
      // 水辺の砂浜 (海に近く、低い)
      if (h <= SEA + 1 && bi !== B.CASTLE) { top = p.sandW; side = p.sand; }
      world.topPal[i] = top; world.sidePal[i] = side;
    }
    // 道路舗装
    const roadPal = [p.cobble, p.cobbleD];
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z);
      if (!world.road[i] || world.carve[i]) continue;
      if (V.n2(x * .9, z * .9, 61) < .5) world.topPal[i] = roadPal[0]; else world.topPal[i] = roadPal[1];
    }
    // 水面セル
    for (let i = 0; i < W * W; i++) world.water[i] = (H[i] < SEA) ? 1 : 0;
  };

  // structures から: 指定マスを色で塗る(広場など)。焼き込み前に呼ぶこと
  world.paint = function (cx, cz, palId, r) {
    r = r || 0;
    const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r);
    const z0 = Math.max(0, cz - r), z1 = Math.min(W - 1, cz + r);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, z);
      world.topPal[i] = palId; world.painted[i] = 1; world.sidePal[i] = p.cobbleD;
    }
  };

  // 台形平坦化 (建築パッド)。焼き込み前に呼ぶ。noScatterにも印を付ける
  world.noScatter = new Uint8Array(W * W);
  world.pad = function (cx, cz, rw, rd, hOverride) {
    let sum = 0, cnt = 0;
    const x0 = Math.max(1, cx - rw), x1 = Math.min(W - 2, cx + rw);
    const z0 = Math.max(1, cz - rd), z1 = Math.min(W - 2, cz + rd);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { sum += world.H[idx(x, z)]; cnt++; }
    const th = hOverride != null ? hOverride : Math.round(sum / (cnt || 1));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      world.H[idx(x, z)] = th;
      world.noScatter[idx(x, z)] = 2;   // スキャッタ禁止
    }
    return th;
  };

  /* ---------- まとめ実行 ---------- */
  world.gen = function () {
    world.genHeights();
    world.carveAll();
    world.stampRoads();
  };

  /* ---------- ブロックベイク (可視面のみ) ---------- */
  // 戻り: {cells:[x,y,z,pal,...]} を配列フラットで
  world.bakeTerrain = function () {
    const H = world.H;
    const bx = [], by = [], bz = [], bp = [];
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z), h = H[i];
      if (h <= 0) continue;
      let mn = h;
      if (x > 0) mn = Math.min(mn, H[i - 1]); else mn = 0;
      if (x < W - 1) mn = Math.min(mn, H[i + 1]); else mn = 0;
      if (z > 0) mn = Math.min(mn, H[i - W]); else mn = 0;
      if (z < W - 1) mn = Math.min(mn, H[i + W]); else mn = 0;
      for (let y = h - 1; y >= mn && y >= 0; y--) { bx.push(x); by.push(y); bz.push(z); bp.push(world.sidePal[i]); }
      bx.push(x); by.push(h - 1 >= 0 ? h - 1 : 0); bz.push(z); bp.push(world.topPal[i]);
    }
    return { x: bx, y: by, z: bz, p: bp };
  };

  world.waterCells = function () {
    const out = [];
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      if (!world.water[idx(x, z)]) continue;
      // 完全に囲われた微小プールは無視(ノイズ) — 隣接 water/陸 check は簡略化し全描画
      out.push([x, z]);
    }
    return out;
  };

  /* ---------- ミニマップ用RGBA ---------- */
  world.minimapRGBA = function () {
    const data = new Uint8ClampedArray(W * W * 4);
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z), o = i * 4;
      let c;
      if (world.water[i]) {
        const dep = V.clamp((SEA - world.H[i]) / 5, 0, 1);
        c = [34 + 40 * (1 - dep), 96 + 60 * (1 - dep), 170 + 50 * (1 - dep)];
      } else {
        const pal = V.PAL[world.topPal[i]];
        let r = pal.r, g = pal.g, b = pal.b;
        if (world.road[i] && !world.carve[i]) { r *= 1.18; g *= 1.14; b *= 1.05; }
        const sh = V.clamp(.62 + world.H[i] * .024, .5, 1.35);   // 高さ陰影
        c = [r * sh * 255, g * sh * 255, b * sh * 255];
      }
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    return data;
  };
})();
