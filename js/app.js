/* ============================================================
 *  app.js — Three.js シーン / カメラ / 昼夜 / UI / メインループ
 * ============================================================ */
(function () {
  const V = window.VFV;
  const $ = id => document.getElementById(id);
  const errBox = $('err');
  function fatal(e) {
    console.error(e);
    errBox.style.display = 'block';
    errBox.textContent = '⚠ ' + (e && e.stack ? e.stack : JSON.stringify(e));
  }
  window.addEventListener('error', ev => fatal(ev.error || ev.message));

  const L = V.LAYOUT;
  let renderer, scene, camera, sun, hemi, skyColor, waterMat, glowMat, cloudMat;
  let structMeshRef = null;              // 構造物メッシュ (窓の色替え先)
  let winIdx = null, winDayCol = null, winNightCol = null;
  let windowsLit;                        // true=夜点灯
  let sunDisc, moonDisc, cloudMesh, cloudsData = [];
  const anims = [];
  const state = {
    mode: 'orbit',
    yaw: .9, pitch: .85, dist: 130, target: new THREE.Vector3(124, 6, 130),
    walkX: 136, walkZ: 172, walkYaw: -Math.PI / 2, walkPitch: -.1,
    auto: true, cycle: true, hours: 9.5, dayF: 1, time: 0,
    keys: {}, tween: null, fpsT: 0, fpsN: 0
  };

  /* =================== ワールド構築 =================== */
  function buildWorld() {
    V.world.gen();            // 高度 → 川湖/峠掘削 → 道路フラグ
    V.stx.pads();             // 建築パッド平坦化
    V.world.relaxRoads();     // 道路沿い高さをならす
    V.world.finalize();       // バイオーム & パレット確定 + 水面定義
    V.stx.paintPads();        // 広場などの路面ペイント

    const tb = V.world.bakeTerrain();
    const buf = V.stx.build();

    const mBox = new THREE.BoxGeometry(1, 1, 1);
    const matL = new THREE.MeshLambertMaterial({ color: 0xffffff });

    scene.add(makeVox(mBox, matL, tb.x, tb.y, tb.z, tb.p, tb.x.length));
    structMeshRef = makeVox(mBox, matL, buf.X, buf.Y, buf.Z, buf.P, buf.X.length);
    scene.add(structMeshRef);

    // 夜に光る窓のテーブル
    if (buf.win.length) {
      winIdx = Int32Array.from(buf.win);
      const n = winIdx.length;
      winDayCol = new Float32Array(n * 3); winNightCol = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const g = V.PAL[V.p.glass], j1 = V.rng() * .1 - .05;
        winDayCol[i * 3] = g.r + j1; winDayCol[i * 3 + 1] = g.g + j1; winDayCol[i * 3 + 2] = g.b + j1;
        const jn = .9 + V.rng() * .18;
        winNightCol[i * 3] = jn; winNightCol[i * 3 + 1] = .76 * jn; winNightCol[i * 3 + 2] = .4 * jn;
      }
    }

    // 発光ブロック (溶岩/ポータル/クリスタル)
    glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (buf.GX.length) scene.add(makeVox(mBox, glowMat, buf.GX, buf.GY, buf.GZ, buf.GP, buf.GX.length));

    // 水
    waterMat = new THREE.MeshPhongMaterial({ color: 0x3d9ed9, transparent: true, opacity: .8, shininess: 110, specular: 0xaaddff });
    const wc = V.world.waterCells();
    if (wc.length) {
      const wxs = [], wys = [], wz = [], wp = [];
      for (const cell of wc) { wxs.push(cell[0]); wz.push(cell[1]); wys.push(L.SEA - 1); wp.push(0); }
      const water = makeVox(mBox, waterMat, wxs, wys, wz, wp, wxs.length, true);
      scene.add(water);
      anims.push({ fn: (dt, t) => { water.position.y = Math.sin(t * 1.3) * .045; } });
    }

    // extras: 風車・光源
    for (const ex of V.stx.extras) {
      if (ex.type === 'mill') {
        const g = new THREE.Group(); g.position.set(ex.x, ex.y, ex.z);
        const bladeMat = new THREE.MeshLambertMaterial({ color: 0xd9cdb6 });
        for (let k = 0; k < 4; k++) {
          const bl = new THREE.Mesh(new THREE.BoxGeometry(.18, 2.7, .07), bladeMat);
          bl.position.y = 1.35;
          const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 2; arm.add(bl); g.add(arm);
        }
        g.add(new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .4), new THREE.MeshLambertMaterial({ color: 0x5c452b })));
        scene.add(g);
        anims.push({ fn: dt => { g.rotation.z += dt * 1.1; } });
      } else if (ex.type === 'light') {
        const pl = new THREE.PointLight(ex.color, ex.intensity, ex.dist);
        pl.position.set(ex.x, ex.y, ex.z); scene.add(pl);
        if (ex.flicker) anims.push({ fn: (dt, t) => { pl.intensity = ex.intensity * (.78 + .22 * Math.sin(t * 13 + ex.x) * Math.sin(t * 7.3 + ex.z)); } });
      }
    }

    drawMinimapBase();
  }

  function makeVox(geo, mat, xs, ys, zs, ps, n, noColor) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.count = n;
    const arr = new Float32Array(n * 16);
    const colArr = noColor ? null : new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      arr[o] = 1; arr[o + 5] = 1; arr[o + 10] = 1; arr[o + 15] = 1;
      arr[o + 12] = xs[i] + .5; arr[o + 13] = ys[i] + .5; arr[o + 14] = zs[i] + .5;
      if (colArr) {
        const c = V.PAL[ps[i]];
        const j = c.j ? (V.rng() * 2 - 1) * c.j : 0;
        colArr[i * 3] = Math.min(1, Math.max(0, c.r + j));
        colArr[i * 3 + 1] = Math.min(1, Math.max(0, c.g + j));
        colArr[i * 3 + 2] = Math.min(1, Math.max(0, c.b + j));
      }
    }
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(arr, 16);
    if (colArr) { mesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3); mesh.userData.colArr = colArr; }
    mesh.frustumCulled = false;
    return mesh;
  }

  function paintWindows(lit) {
    if (!winIdx || !structMeshRef) return;
    const arr = structMeshRef.userData.colArr; if (!arr) return;
    const src = lit ? winNightCol : winDayCol;
    for (let i = 0; i < winIdx.length; i++) {
      arr[winIdx[i] * 3] = src[i * 3]; arr[winIdx[i] * 3 + 1] = src[i * 3 + 1]; arr[winIdx[i] * 3 + 2] = src[i * 3 + 2];
    }
    structMeshRef.instanceColor.needsUpdate = true;
  }

  /* =================== 空・光 =================== */
  const COL = {
    daySky: new THREE.Color(0x8ecdf2), nightSky: new THREE.Color(0x0b1026), dusk: new THREE.Color(0xf5a06a),
    sunDay: new THREE.Color(0xfff4e0), sunDusk: new THREE.Color(0xff9550)
  };
  function initSky() {
    hemi = new THREE.HemisphereLight(0xbfe3ff, 0x7d6a4f, .68); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
    sun.target.position.set(120, 0, 130); scene.add(sun, sun.target);
    scene.fog = new THREE.FogExp2(0x9cc7ea, .0021);
    skyColor = new THREE.Color();
    scene.background = skyColor;

    sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 18), new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false, transparent: true }));
    moonDisc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 16), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, transparent: true }));
    scene.add(sunDisc, moonDisc);

    cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .92 });
    const cgeo = mergeGeos([[0, 0, 3, 1.6, .5, 2], [2.4, .1, 2, 1.7, .55, 1.5], [-1.8, -.05, 1.6, 1.3, .5, 1.2], [.4, .4, 2.2, 1.2, .4, 1]].map(cloudBox));
    cloudMesh = new THREE.InstancedMesh(cgeo, cloudMat, 34);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    for (let i = 0; i < 34; i++) {
      const sc = .9 + V.rng() * 1.7, x = V.rng() * 280 - 20, z = 15 + V.rng() * 220, y = 31 + V.rng() * 7;
      cloudsData.push({ x, y, z, sc, sp: .5 + V.rng() * .7 });
      p3.set(x, y, z); s3.set(sc, sc * .8, sc); q.identity();
      m4.compose(p3, q, s3); cloudMesh.setMatrixAt(i, m4);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
    cloudMesh.frustumCulled = false;
    scene.add(cloudMesh);
  }
  function cloudBox(d) { const g = new THREE.BoxGeometry(d[3], d[4], d[5]); g.translate(d[0], d[1], d[2]); return g; }
  function mergeGeos(geos) {
    let pos = [], nrm = [];
    for (const g of geos) {
      const p2 = g.attributes.position, n2 = g.attributes.normal;
      for (let i = 0; i < p2.count; i++) { pos.push(p2.getX(i), p2.getY(i), p2.getZ(i)); nrm.push(n2.getX(i), n2.getY(i), n2.getZ(i)); }
    }
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    o.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return o;
  }

  function updateSky(dt) {
    if (state.cycle) state.hours = (state.hours + dt * (24 / 170)) % 24;
    const phi = (state.hours - 6) / 12 * Math.PI;
    const s = Math.sin(phi), cphi = Math.cos(phi);
    state.dayF = V.smoothstep(-.08, .3, s);

    sun.position.set(120 + cphi * 54, 8 + s * 60, 130 - 9 + cphi * 15);
    sun.intensity = .1 + 1.05 * state.dayF;
    const duskAmt = 1 - V.clamp(Math.abs(s) / .42, 0, 1);
    sun.color.copy(COL.sunDay).lerp(COL.sunDusk, duskAmt * .8);

    const base = COL.nightSky.clone().lerp(COL.daySky, state.dayF);
    if (s > -.35 && s < .4) base.lerp(COL.dusk, duskAmt * .5);
    skyColor.copy(base); scene.fog.color.copy(base);

    sunDisc.position.set(120 + cphi * 205, Math.max(s, -.15) * 205 + 60, 130 - 30);
    sunDisc.lookAt(camera.position);
    sunDisc.material.opacity = V.clamp((s + .18) * 4, 0, 1);
    moonDisc.position.set(120 - cphi * 195, Math.max(-s, .04) * 170 + 60, 130 + 40);
    moonDisc.lookAt(camera.position);
    moonDisc.material.opacity = V.clamp((-s + .1) * 2.6, 0, 1);

    hemi.intensity = .26 + .46 * state.dayF;
    if (waterMat) waterMat.color.setHex(0x3d9ed9).multiplyScalar(.35 + .65 * state.dayF);
    if (cloudMat) cloudMat.color.setRGB(.35 + .65 * state.dayF, .37 + .63 * state.dayF, .42 + .58 * state.dayF);
    if (glowMat) glowMat.color.setScalar(1.02 + Math.sin(state.time * 2.2) * .12);

    const litNow = state.dayF < .45;
    if (windowsLit === undefined || litNow !== windowsLit) { windowsLit = litNow; paintWindows(litNow); }

    if (!(state.cycle)) { /* スライダー側が表示を更新 */ }
    const hh = Math.floor(state.hours), mm = Math.floor((state.hours % 1) * 60);
    $('clockTxt').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    if (state.cycle) $('timeSlider').value = String(Math.round(state.hours / 24 * 240));
  }

  /* =================== カメラ操作 =================== */
  function initControls() {
    const el = renderer.domElement;
    let dragBtn = -1, lastX = 0, lastY = 0;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { dragBtn = e.button; lastX = e.clientX; lastY = e.clientY; state.tween = null; });
    window.addEventListener('pointerup', () => dragBtn = -1);
    window.addEventListener('pointermove', e => {
      if (dragBtn < 0) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      if (state.mode === 'orbit') {
        if (dragBtn === 2 || e.shiftKey) {
          const f = state.dist * .0018, fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
          state.target.x += (-fz * dx - fx * dy) * f; state.target.z += (fx * dx - fz * dy) * f;
        } else {
          state.yaw -= dx * .0055; state.pitch = V.clamp(state.pitch - dy * .0042, .12, 1.48);
        }
      } else {
        state.walkYaw -= dx * .005; state.walkPitch = V.clamp(state.walkPitch - dy * .004, -1.3, 1.25);
      }
    });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (state.mode === 'orbit') state.dist = V.clamp(state.dist * (1 + Math.sign(e.deltaY) * .11), 7, 210);
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      state.keys[e.key.toLowerCase()] = true;
      if (e.key >= '1' && e.key <= '5') flyTo(L.regions[+e.key - 1].id);
      if (e.key.toLowerCase() === 'f') toggleMode();
    });
    window.addEventListener('keyup', e => state.keys[e.key.toLowerCase()] = false);
  }

  function applyCamera(dt) {
    let mx = 0, mz = 0;
    const k = state.keys;
    if (k.w || k.arrowup) mz += 1; if (k.s || k.arrowdown) mz -= 1;
    if (k.a || k.arrowleft) mx -= 1; if (k.d || k.arrowright) mx += 1;
    const speed = (k['shift'] ? 2.6 : 1);
    if (mx || mz) {
      state.tween = null;
      const f = Math.hypot(mx, mz);
      if (state.mode === 'orbit') {
        const yaw = state.yaw;
        const vx = (mx * Math.cos(yaw) - mz * Math.sin(yaw)) / f, vz = (-mx * Math.sin(yaw) - mz * Math.cos(yaw)) / f;
        state.target.x = V.clamp(state.target.x + vx * dt * 34 * speed, -20, L.W + 20);
        state.target.z = V.clamp(state.target.z + vz * dt * 34 * speed, -20, L.W + 20);
      } else {
        const yaw = state.walkYaw;
        const vx = (mx * Math.cos(yaw) - mz * Math.sin(yaw)) / f, vz = (-mx * Math.sin(yaw) - mz * Math.cos(yaw)) / f;
        state.walkX = V.clamp(state.walkX + vx * dt * 14 * speed, 1, L.W - 2);
        state.walkZ = V.clamp(state.walkZ + vz * dt * 14 * speed, 1, L.W - 2);
      }
    }
    if (state.tween) {
      const tw = state.tween; tw.k = Math.min(1, tw.k + dt / tw.dur);
      const e = tw.k < .5 ? 4 * tw.k ** 3 : 1 - Math.pow(-2 * tw.k + 2, 3) / 2;
      state.target.lerpVectors(tw.fromT, tw.toT, e);
      state.dist = V.lerp(tw.fromD, tw.toD, e);
      let dyaw = tw.toYaw - tw.fromYaw; while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      state.yaw = tw.fromYaw + dyaw * e;
      state.pitch = V.lerp(tw.fromPitch, tw.toPitch, e);
      if (tw.k >= 1) state.tween = null;
    }
    if (state.mode === 'orbit') {
      if (state.auto && !state.tween) state.yaw += dt * .05;
      const cp = Math.cos(state.pitch), sp2 = Math.sin(state.pitch);
      camera.position.set(
        state.target.x + Math.sin(state.yaw) * cp * state.dist,
        state.target.y + sp2 * state.dist + 2,
        state.target.z + Math.cos(state.yaw) * cp * state.dist);
      camera.lookAt(state.target);
    } else {
      const gh = V.world.hAt(Math.floor(state.walkX), Math.floor(state.walkZ)) + 1.68;
      camera.position.set(state.walkX, Math.max(gh, L.SEA + .3), state.walkZ);
      camera.lookAt(camera.position.x + Math.sin(state.walkYaw) * Math.cos(state.walkPitch),
        camera.position.y + Math.sin(state.walkPitch),
        camera.position.z + Math.cos(state.walkYaw) * Math.cos(state.walkPitch));
    }
  }

  function flyTo(regionId) {
    const pr = L.cameraPresets[regionId] || L.cameraPresets.town;
    setMode('orbit');
    state.tween = {
      fromT: state.target.clone(), toT: new THREE.Vector3(pr.t[0], pr.t[1], pr.t[2]),
      fromD: state.dist, toD: pr.dist, fromYaw: state.yaw, toYaw: pr.yaw,
      fromPitch: state.pitch, toPitch: pr.pitch, k: 0, dur: 1.5
    };
    markRegionBtn(regionId);
  }

  function toggleMode() { setMode(state.mode === 'orbit' ? 'walk' : 'orbit'); }
  function setMode(m) {
    if (state.mode === m && $('btnMode').textContent.indexOf(m === 'orbit' ? '展望' : '地上') > 0) return;
    state.mode = m; state.tween = null;
    $('btnMode').textContent = m === 'orbit' ? '🎥 展望' : '🚶 地上';
    if (m === 'walk') {
      let wx = V.clamp(Math.round(state.target.x), 2, L.W - 3), wz = V.clamp(Math.round(state.target.z), 2, L.W - 3);
      for (let r = 0; r <= 40 && V.world.hAt(wx, wz) <= L.SEA; r++) {   // 陸を探す (渦巻き探索)
        const ang = r * .9;
        wx = V.clamp(Math.round(state.target.x + Math.cos(ang) * r), 2, L.W - 3);
        wz = V.clamp(Math.round(state.target.z + Math.sin(ang) * r), 2, L.W - 3);
      }
      state.walkX = wx + .5; state.walkZ = wz + .5; state.walkYaw = state.yaw + Math.PI;
    }
  }

  /* =================== UI =================== */
  function initUI() {
    const box = $('regionBtns');
    L.regions.forEach(r => {
      const b = document.createElement('button'); b.className = 'rbtn'; b.dataset.region = r.id;
      b.innerHTML = `${r.icon} ${r.name}<span class="pop" data-pop="${r.id}"></span>`;
      b.onclick = () => flyTo(r.id); box.appendChild(b);
    });
    $('btnMode').onclick = toggleMode;
    $('btnAuto').onclick = () => { state.auto = !state.auto; $('btnAuto').style.opacity = state.auto ? 1 : .45; };
    $('btnMobs').onclick = () => { V.mobs.enabled = !V.mobs.enabled; $('btnMobs').textContent = '👥 モブ: ' + (V.mobs.enabled ? 'ON' : 'OFF'); };
    $('btnCycle').onclick = () => { state.cycle = !state.cycle; $('btnCycle').textContent = state.cycle ? '⏸ サイクル' : '▶ サイクル'; };
    $('timeSlider').oninput = e => { state.hours = +e.target.value / 240 * 24; state.cycle = false; $('btnCycle').textContent = '▶ サイクル'; };

    setInterval(() => {
      for (const row of V.mobs.popTable()) {
        const el = document.querySelector(`[data-pop="${row.town.region}"]`);
        if (el) el.textContent = `${row.count}/${row.town.cap}`;
      }
    }, 800);

    $('mm-stack').addEventListener('pointerdown', e => {
      const rect = $('minimap').getBoundingClientRect();
      const x = V.clamp((e.clientX - rect.left) / rect.width * L.W, 1, L.W - 2);
      const z = V.clamp((e.clientY - rect.top) / rect.height * L.W, 1, L.W - 2);
      setMode('orbit');
      state.tween = {
        fromT: state.target.clone(), toT: new THREE.Vector3(x, V.world.hAt(Math.floor(x), Math.floor(z)) + 2.5, z),
        fromD: state.dist, toD: Math.min(state.dist, 52), fromYaw: state.yaw, toYaw: state.yaw,
        fromPitch: state.pitch, toPitch: .9, k: 0, dur: 1.1
      };
    });

    window.addEventListener('resize', onResize);
  }

  let mmBase = null;
  function drawMinimapBase() {
    const c = $('minimap'), ov = $('mmOverlay');
    c.width = ov.width = L.W; c.height = ov.height = L.W;
    const off = document.createElement('canvas'); off.width = off.height = L.W;
    const ctx0 = off.getContext('2d');
    ctx0.putImageData(new ImageData(V.world.minimapRGBA(), L.W, L.W), 0, 0);
    for (const r of L.regions) {
      ctx0.fillStyle = 'rgba(6,10,22,.85)'; ctx0.fillRect(r.x - 3.6, r.z - 3.6, 7.2, 7.2);
      ctx0.fillStyle = r.mapColor; ctx0.fillRect(r.x - 2.4, r.z - 2.4, 4.8, 4.8);
    }
    mmBase = off;
  }
  function drawMinimapOverlay() {
    if (!mmBase) return;
    const ov = $('mmOverlay'), c = ov.getContext('2d');
    c.clearRect(0, 0, L.W, L.W);
    c.drawImage(mmBase, 0, 0);
    const cx = state.mode === 'orbit' ? state.target.x : state.walkX;
    const cz = state.mode === 'orbit' ? state.target.z : state.walkZ;
    const yaw = (state.mode === 'orbit' ? state.yaw + Math.PI : state.walkYaw) - Math.PI / 2;
    c.save();
    c.fillStyle = 'rgba(255,230,140,.16)';
    c.beginPath(); c.moveTo(cx, cz);
    c.arc(cx, cz, 26, yaw - .45, yaw + .45); c.closePath(); c.fill();
    c.fillStyle = '#ffe68a'; c.strokeStyle = '#14203c'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(cx, cz, 3.4, 0, 7); c.fill(); c.stroke();
    c.restore();
  }

  function markRegionBtn(id) {
    document.querySelectorAll('.rbtn').forEach(b => b.classList.toggle('cur', id ? b.dataset.region === id : false));
  }
  function trackCurrentRegion() {
    const cx = state.mode === 'orbit' ? state.target.x : state.walkX;
    const cz = state.mode === 'orbit' ? state.target.z : state.walkZ;
    let best = null, bd = 1e9;
    for (const r of L.regions) { const d = Math.hypot(cx - r.x, cz - r.z); if (d < bd) { bd = d; best = r.id; } }
    markRegionBtn(bd < 55 ? best : null);
  }

  /* =================== boot =================== */
  function onResize() {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.domElement.className = 'main';
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .1, 900);

    initSky();
    buildWorld();
    V.mobs.build(scene);
    V.mobs.setDayFactorGetter(() => state.dayF);

    initControls(); initUI();

    const pr0 = L.cameraPresets.overview;
    state.target.set(pr0.t[0], pr0.t[1], pr0.t[2]); state.dist = pr0.dist + 34; state.yaw = pr0.yaw - .5; state.pitch = pr0.pitch;
    setTimeout(() => flyTo('town'), 1000);

    let last = performance.now();
    const loop = now => {
      const dt = Math.min(.05, (now - last) / 1000); last = now; state.time += dt;
      applyCamera(dt);
      updateSky(dt);
      V.mobs.update(dt, state.time);
      for (const a of anims) a.fn(dt, state.time);
      if (cloudMesh) {
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().identity(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3();
        for (let i = 0; i < cloudsData.length; i++) {
          const cl = cloudsData[i]; cl.x += dt * cl.sp; if (cl.x > L.W + 30) cl.x = -40;
          p3.set(cl.x, cl.y, cl.z); s3.set(cl.sc, cl.sc * .8, cl.sc);
          m4.compose(p3, q, s3); cloudMesh.setMatrixAt(i, m4);
        }
        cloudMesh.instanceMatrix.needsUpdate = true;
      }
      renderer.render(scene, camera);
      state.fpsN++;
      if (now - state.fpsT > 500) {
        $('fps').textContent = Math.round(state.fpsN * 1000 / (now - state.fpsT)) + ' fps';
        state.fpsT = now; state.fpsN = 0; trackCurrentRegion();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(t => { last = t; loop(t); });

    setTimeout(() => { const l = $('loading'); l.style.opacity = '0'; setTimeout(() => l.remove(), 800); }, 300);
    setInterval(drawMinimapOverlay, 120);
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => { try { init(); } catch (e) { fatal(e); } });
  else { try { init(); } catch (e) { fatal(e); } }
})();
