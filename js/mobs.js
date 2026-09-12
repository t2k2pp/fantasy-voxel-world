/* ============================================================
 *  mobs.js — モブ生活シミュレータ基盤
 *   - スポーン台帳 (LAYOUT.towns) に基づく湧き
 *   - ステートマシン AI: wander / pause / flee(水避退)
 *   - InstancedMesh 描画 (種族ごとの合成ジオメトリ + tint)
 *   将来の接続先: VFV.mobs.spawn() / setSpeedScale() / onEvent 購読
 * ============================================================ */
(function () {
  const V = window.VFV;
  const W = V.LAYOUT.W;

  /* ---------- 種族定義 (merged boxes, y は足元基準) ---------- */
  function spec(def) { return def; }
  const SPECIES = {
    folk: spec({ name: 'フォルク', size: .82, speed: 1.5, hop: 3.4, tint: [[.92, .72, .55], [.65, .5, .9], [.55, .75, .5], [.9, .55, .5]],
      boxes: [ { w: .42, h: .34, d: .3, y: .17, c: .8 },   // 下半身
        { w: .46, h: .4, d: .32, y: .55, c: 1 },          // 胴
        { w: .32, h: .3, d: .3, y: .9, c: .85 },          // 頭
        { w: .12, h: .12, d: .12, x: .17, y: .56, c: .8 }, // 腕
        { w: .12, h: .12, d: .12, x: -.17, y: .56, c: .8 } ] }),
    merchant: spec({ name: 'キャラバン民', size: .92, speed: 1.15, hop: 4.4, tint: [[.95, .85, .6], [.8, .7, .45], [.6, .45, .3]],
      boxes: [ { w: .46, h: .36, d: .32, y: .18, c: .75 }, { w: .5, h: .44, d: .36, y: .58, c: 1 },
        { w: .34, h: .3, d: .32, y: .95, c: .9 }, { w: .4, h: .07, d: .38, y: 1.14, c: 1 },   // ターバン
        { w: .13, h: .13, d: .13, x: .19, y: .58, c: .75 } ] }),
    sprite: spec({ name: '森の精霊', size: .6, speed: 2.3, hop: 2.2, tint: [[.6, 1, .7], [.65, .9, 1], [1, .95, .5]],
      boxes: [ { w: .4, h: .5, d: .28, y: .3, c: 1 }, { w: .26, h: .26, d: .24, y: .74, c: .9 },
        { w: .12, h: .3, d: .05, x: .26, y: .5, c: 1.25 }, { w: .12, h: .3, d: .05, x: -.26, y: .5, c: 1.25 } ] }),
    golem: spec({ name: '岩ゴーレム', size: 1.5, speed: .75, hop: 6, tint: [[.55, .53, .5], [.45, .5, .55], [.5, .42, .38]],
      boxes: [ { w: .58, h: .46, d: .4, y: .23, c: .7 }, { w: .64, h: .5, d: .46, y: .72, c: 1 },
        { w: .36, h: .34, d: .34, y: 1.14, c: 1.15 }, { w: .18, h: .3, d: .18, x: .32, y: .72, c: .8 },
        { w: .18, h: .3, d: .18, x: -.32, y: .72, c: .8 } ] }),
    imp: spec({ name: 'インプ', size: .66, speed: 2.0, hop: 2.6, tint: [[.95, .45, .3], [.6, .35, .8], [.4, .8, .5]],
      boxes: [ { w: .34, h: .3, d: .26, y: .16, c: .7 }, { w: .38, h: .36, d: .28, y: .5, c: 1 },
        { w: .28, h: .26, d: .26, y: .82, c: 1.1 }, { w: .1, h: .14, d: .08, x: .18, y: 1.0, c: 1.15 },
        { w: .1, h: .14, d: .08, x: -.18, y: 1.0, c: 1.15 } ] })
  };
  V.SPECIES = SPECIES;

  /* ---------- ジオメトリ合成 ---------- */
  function speciesGeo(def) {
    const geos = def.boxes.map(b => {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      g.translate(b.x || 0, b.y, b.z || 0);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = b.c; col[i * 3 + 1] = b.c; col[i * 3 + 2] = b.c; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    return THREE.BufferGeometryUtils ? THREE.BufferGeometryUtils.mergeBufferGeometries(geos) : mergeManual(geos);
  }
  function mergeManual(geos) {           // r14x UMD にutilsが無い場合の手動マージ
    let pos = [], nrm = [], col = [];
    for (const g of geos) {
      const p2 = g.attributes.position, n2 = g.attributes.normal, c2 = g.attributes.color;
      for (let i = 0; i < p2.count; i++) {
        pos.push(p2.getX(i), p2.getY(i), p2.getZ(i));
        nrm.push(n2.getX(i), n2.getY(i), n2.getZ(i));
        col.push(c2.getX(i), c2.getY(i), c2.getZ(i));
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }

  /* ---------- MobManager ---------- */
  const mobs = {}; V.mobs = mobs;
  mobs.individuals = [];
  mobs.enabled = true;
  mobs.speedScale = 1;

  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(),
    tmpS = new THREE.Vector3(), eul = new THREE.Euler();
  let dayFactorGetter = () => 1;
  mobs.setDayFactorGetter = fn => dayFactorGetter = fn;

  function pickTownPos(t, margin) {
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * t.r * (margin || .9);
      const x = Math.round(t.x + Math.cos(a) * r), z = Math.round(t.z + Math.sin(a) * r);
      if (!V.world.inB(x, z)) continue;
      const h = V.world.hAt(x, z);
      if (h > V.LAYOUT.SEA && V.world.water[V.world.idx(x, z)] !== 1) return { x, z };
    }
    return null;
  }

  mobs.build = function (scene) {
    mobs.groups = {};
    for (const town of V.LAYOUT.towns) {
      const spId = town.species, def = SPECIES[spId];
      let grp = mobs.groups[spId];
      if (!grp) {
        const geo = speciesGeo(def);
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
        const maxN = 48;
        const mesh = new THREE.InstancedMesh(geo, mat, maxN);
        mesh.count = 0; mesh.frustumCulled = false;
        scene.add(mesh);
        grp = mobs.groups[spId] = { mesh, n: 0 };
      }
      for (let i = 0; i < town.pop; i++) {
        const p2 = pickTownPos(town);
        if (!p2) continue;
        const g = grp; if (g.n >= 48) break;
        const tintArr = def.tint[(Math.random() * def.tint.length) | 0];
        const shade = .85 + Math.random() * .3;
        const col = new THREE.Color(tintArr[0] * shade, tintArr[1] * shade, tintArr[2] * shade);
        g.mesh.setColorAt(g.n, col);
        mobs.individuals.push({
          townId: town.id, region: town.region, species: spId, gi: g.n++,
          x: p2.x + Math.random(), z: p2.z + Math.random(),
          y: V.world.groundY(p2.x, p2.z), yaw: Math.random() * 6.28,
          state: 'wander', timer: Math.random() * 3, tx: 0, tz: 0, hopPhase: Math.random() * 6.28
        });
      }
      grp.mesh.count = grp.n;
      if (grp.mesh.instanceColor) grp.mesh.instanceColor.needsUpdate = true;
    }
    // 初期行列
    mobs.individuals.forEach(ind => syncMatrix(ind, 0));
  };

  function retarget(ind) {
    const town = V.LAYOUT.towns.find(t => t.id === ind.townId);
    if (!town) return;
    const p2 = pickTownPos(town, .95);
    if (p2) { ind.tx = p2.x + Math.random(); ind.tz = p2.z + Math.random(); }
  }

  function syncMatrix(ind, t) {
    const def = SPECIES[ind.species];
    const moving = ind.state === 'wander';
    eul.set(0, ind.yaw, 0); tmpQ.setFromEuler(eul);
    let bob = 0;
    if (moving) bob = Math.abs(Math.sin(ind.hopPhase)) * .18 / def.size;
    tmpP.set(ind.x, ind.y + bob / 2, ind.z);
    const s = def.size * (moving ? 1 : (Math.sin(t * 2 + ind.gi) * .015 + 1));
    tmpS.set(s, s, s);
    tmpM.compose(tmpP, tmpQ, tmpS);
    const g = mobs.groups[ind.species];
    if (g) g.mesh.setMatrixAt(ind.gi, tmpM);
  }

  mobs.update = function (dt, t) {
    const light = dayFactorGetter();
    for (const ind of mobs.individuals) {
      ind.timer -= dt;
      if (ind.state === 'wander') {
        const def = SPECIES[ind.species];
        let dx = ind.tx - ind.x, dz = ind.tz - ind.z;
        const dist = Math.hypot(dx, dz);
        if (dist < .35 || ind.timer < 0) { ind.state = 'pause'; ind.timer = 1 + Math.random() * 2.6; }
        else {
          // 夜間は行動半径を縮小 → 静かになる
          const sp = def.speed * mobs.speedScale * (light > .4 ? 1 : .35);
          dx /= dist; dz /= dist;
          let nx = ind.x + dx * sp * dt, nz = ind.z + dz * sp * dt;
          const gh = V.world.hAt(nx | 0, nz | 0);
          if (gh <= V.LAYOUT.SEA) { retarget(ind); }       // 水に入ったら引き返す
          else {
            ind.x = nx; ind.z = nz; ind.y = gh;
            const wy = Math.atan2(dx, dz);
            let dy = wy - ind.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
            ind.yaw += dy * Math.min(1, dt * 8);
            ind.hopPhase += dt * def.hop * sp * 2.4;
          }
        }
      } else {                                     // pause / idle
        if (ind.timer < 0) {
          retarget(ind);
          if (Math.random() > .15) { ind.state = 'wander'; ind.timer = 3 + Math.random() * 7; }
          else { ind.state = 'pause'; ind.timer = 2 + Math.random() * 4; }
        }
      }
      syncMatrix(ind, t);
    }
    for (const sp in mobs.groups) {
      const g = mobs.groups[sp];
      if (!mobs.enabled) { g.mesh.visible = false; continue; }
      g.mesh.visible = true;
      g.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  /* ---------- 将来向け API (README に記載) ---------- */
  mobs.spawn = function (townId, species, n) {
    const town = V.LAYOUT.towns.find(t => t.id === townId); if (!town) return 0;
    const def = SPECIES[species] || SPECIES.folk;
    const g = mobs.groups[def ? species : 'folk']; if (!g) return 0;
    let added = 0;
    for (let i = 0; i < n && g.n < 48; i++) {
      const p2 = pickTownPos(town); if (!p2) continue;
      const tintArr = def.tint[(Math.random() * def.tint.length) | 0];
      g.mesh.setColorAt(g.n, new THREE.Color(tintArr[0], tintArr[1], tintArr[2]));
      mobs.individuals.push({ townId, region: town.region, species, gi: g.n++, x: p2.x + .5, z: p2.z + .5, y: V.world.groundY(p2.x, p2.z), yaw: 0, state: 'pause', timer: Math.random() * 2, tx: 0, tz: 0, hopPhase: 0 });
      added++;
    }
    g.mesh.count = g.n;
    if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    return added;
  };
  mobs.popTable = function () {
    const byTown = {};
    for (const ind of mobs.individuals) byTown[ind.townId] = (byTown[ind.townId] || 0) + 1;
    return V.LAYOUT.towns.map(t => ({ town: t, count: byTown[t.id] || 0 }));
  };
})();
