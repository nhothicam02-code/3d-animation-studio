import * as THREE from 'three';

/* ============================================================
   Tự tách đồ gắn cứng dạng CẶP (giày, tất…) thành bên trái / bên phải.

   Một file giày thường chứa cả hai chiếc trong cùng một mô hình. Nếu gắn cứng vào 1 xương
   thì cả hai chiếc đi theo cùng một chân. Ở đây ta cắt mô hình làm hai nửa để mỗi nửa gắn
   vào một xương bàn chân riêng.

   Cách tách (thử lần lượt):
   1) "gap"   — gom các cụm mặt liên thông theo khoảng trải trên trục ngang (x). Nếu có đúng một
                khoảng hở rõ ràng chia thành hai nhóm cân đối → mỗi nhóm là một chiếc.
   2) "plane" — hai chiếc dính nhau thành một khối (cầu nối, đế chung): cắt theo mặt phẳng giữa,
                chỉ khi hộp bao đủ rộng so với chiều dài để giống một cặp.
   Không khớp cả hai → trả về null (giữ nguyên hành vi cũ: một mảnh gắn cứng).
   Đồ có skin (SkinnedMesh) không bao giờ bị tách — chúng đã tự ôm theo hai chân.
   ============================================================ */

/* ---------- lõi thuần số liệu (không phụ thuộc three; kiểm thử độc lập được) ---------- */

/** Chia tam giác thành các cụm liên thông, hàn các đỉnh trùng vị trí. pos: xyz phẳng, idx: 3 chỉ số / tam giác. */
export function connectedComponents(pos, idx, q) {
  const nv = Math.floor(pos.length / 3), nt = Math.floor(idx.length / 3);
  const rep = new Int32Array(nv), seen = new Map();
  for (let i = 0; i < nv; i++) {
    const k = Math.round(pos[3 * i] / q) + '_' + Math.round(pos[3 * i + 1] / q) + '_' + Math.round(pos[3 * i + 2] / q);
    const r = seen.get(k);
    if (r === undefined) { seen.set(k, i); rep[i] = i; } else rep[i] = r;
  }
  const par = new Int32Array(nv);
  for (let i = 0; i < nv; i++) par[i] = i;
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  for (let t = 0; t < nt; t++) {
    const a = rep[idx[3 * t]], b = rep[idx[3 * t + 1]], c = rep[idx[3 * t + 2]];
    uni(a, b); uni(b, c);
  }
  const comps = new Map();
  for (let t = 0; t < nt; t++) {
    const r = find(rep[idx[3 * t]]);
    let c = comps.get(r);
    if (!c) { c = {tris: [], minX: Infinity, maxX: -Infinity}; comps.set(r, c); }
    c.tris.push(t);
    for (let j = 0; j < 3; j++) { const x = pos[3 * idx[3 * t + j]]; if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; }
  }
  return [...comps.values()];
}

const emptyLists = n => Array.from({length: n}, () => []);

function boundsOf(parts) {
  const b = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity};
  for (const p of parts) {
    const a = p.pos;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < b.minX) b.minX = a[i]; if (a[i] > b.maxX) b.maxX = a[i];
      if (a[i + 1] < b.minY) b.minY = a[i + 1]; if (a[i + 1] > b.maxY) b.maxY = a[i + 1];
      if (a[i + 2] < b.minZ) b.minZ = a[i + 2]; if (a[i + 2] > b.maxZ) b.maxZ = a[i + 2];
    }
  }
  return b;
}

function byGap(comps, parts, W, total) {
  const sorted = comps.slice().sort((a, b) => a.minX - b.minX), tol = W * 0.002, clusters = [];
  for (const c of sorted) {
    const k = clusters[clusters.length - 1];
    if (k && c.minX <= k.hi + tol) { k.hi = Math.max(k.hi, c.maxX); k.comps.push(c); k.n += c.tris.length; }
    else clusters.push({lo: c.minX, hi: c.maxX, comps: [c], n: c.tris.length});
  }
  if (clusters.length < 2) return null;
  let bi = 0, bg = -1;
  for (let i = 0; i < clusters.length - 1; i++) { const g = clusters[i + 1].lo - clusters[i].hi; if (g > bg) { bg = g; bi = i; } }
  if (bg < W * 0.02) return null;
  const A = clusters.slice(0, bi + 1), B = clusters.slice(bi + 1);
  const nA = A.reduce((s, k) => s + k.n, 0), nB = B.reduce((s, k) => s + k.n, 0);
  if (nA < total * 0.15 || nB < total * 0.15) return null;
  const wA = A[A.length - 1].hi - A[0].lo, wB = B[B.length - 1].hi - B[0].lo, r = wA / Math.max(wB, 1e-12);
  if (r < 0.5 || r > 2) return null;
  const lo = emptyLists(parts.length), hi = emptyLists(parts.length);
  for (const k of A) for (const c of k.comps) lo[c.part].push(...c.tris);
  for (const k of B) for (const c of k.comps) hi[c.part].push(...c.tris);
  return {mode: 'gap', lo, hi};
}

function byPlane(parts, b, total) {
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  if (W < 0.7 * D) return null;                       // một chiếc giày đơn thì dài hơn rộng nhiều
  const mid = (b.minX + b.maxX) / 2, lo = emptyLists(parts.length), hi = emptyLists(parts.length);
  const box = () => ({x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, n: 0});
  const sa = box(), sb = box();
  parts.forEach((p, pi) => {
    const nt = Math.floor(p.idx.length / 3);
    for (let t = 0; t < nt; t++) {
      let cx = 0;
      for (let j = 0; j < 3; j++) cx += p.pos[3 * p.idx[3 * t + j]];
      const up = cx / 3 >= mid, s = up ? sb : sa;
      (up ? hi : lo)[pi].push(t); s.n++;
      for (let j = 0; j < 3; j++) {
        const v = 3 * p.idx[3 * t + j];
        s.x0 = Math.min(s.x0, p.pos[v]); s.x1 = Math.max(s.x1, p.pos[v]);
        s.y0 = Math.min(s.y0, p.pos[v + 1]); s.y1 = Math.max(s.y1, p.pos[v + 1]);
        s.z0 = Math.min(s.z0, p.pos[v + 2]); s.z1 = Math.max(s.z1, p.pos[v + 2]);
      }
    }
  });
  if (sa.n < total * 0.3 || sb.n < total * 0.3) return null;
  const close = (u, v) => Math.abs(u - v) <= 0.35 * Math.max(u, v, 1e-12);   // hai nửa của một cặp đối xứng có kích thước gần nhau
  if (!close(sa.y1 - sa.y0, sb.y1 - sb.y0) || !close(sa.z1 - sa.z0, sb.z1 - sb.z0) || !close(sa.x1 - sa.x0, sb.x1 - sb.x0)) return null;
  return {mode: 'plane', lo, hi};
}

/**
 * parts: [{pos: Float32Array xyz, idx: Uint32Array}] trong cùng một hệ toạ độ (x = trục ngang).
 * Trả về {mode, lo, hi}: lo/hi[i] = danh sách chỉ số tam giác của parts[i] thuộc nửa x thấp / x cao; hoặc null.
 */
export function planSplit(parts) {
  const b = boundsOf(parts), W = b.maxX - b.minX;
  if (!(W > 0)) return null;
  const diag = Math.hypot(W, b.maxY - b.minY, b.maxZ - b.minZ), q = Math.max(diag * 1e-5, 1e-9);
  const comps = []; let total = 0;
  parts.forEach((p, pi) => { for (const c of connectedComponents(p.pos, p.idx, q)) { c.part = pi; comps.push(c); total += c.tris.length; } });
  if (!comps.length) return null;
  return byGap(comps, parts, W, total) || byPlane(parts, b, total);
}

/* ---------- phần dùng three ---------- */

function triIndex(geo) {
  const n = geo.index ? geo.index.count : geo.attributes.position.count, a = new Uint32Array(n);
  if (geo.index) for (let i = 0; i < n; i++) a[i] = geo.index.getX(i); else for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

function posArray(geo) {
  const p = geo.attributes.position, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { a[3 * i] = p.getX(i); a[3 * i + 1] = p.getY(i); a[3 * i + 2] = p.getZ(i); }
  return a;
}

/** Tạo geometry mới chỉ gồm các tam giác `tris` (giữ thuộc tính, nhóm vật liệu). */
function subsetGeometry(geo, tris) {
  const nv = geo.attributes.position.count, idx = triIndex(geo), nt = Math.floor(idx.length / 3);
  const mask = new Uint8Array(nt);
  for (const t of tris) mask[t] = 1;
  const order = [], groups = [];
  const src = geo.groups && geo.groups.length ? geo.groups : [{start: 0, count: nt * 3, plain: true}];
  for (const g of src) {
    const s = g.start / 3, e = Math.min(nt, (g.start + g.count) / 3), from = order.length;
    for (let t = s; t < e; t++) if (mask[t]) order.push(t);
    if (!g.plain && order.length > from) groups.push({start: from * 3, count: (order.length - from) * 3, materialIndex: g.materialIndex});
  }
  if (!order.length) return null;
  const remap = new Int32Array(nv).fill(-1), srcV = [], outIdx = new Uint32Array(order.length * 3);
  let nn = 0;
  order.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const v = idx[3 * t + j];
      if (remap[v] < 0) { remap[v] = nn++; srcV.push(v); }
      outIdx[3 * i + j] = remap[v];
    }
  });
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name], s = a.itemSize, arr = new Float32Array(nn * s);
    const get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < nn; i++) for (let c = 0; c < s; c++) arr[i * s + c] = get[c].call(a, srcV[i]);
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  out.setIndex(new THREE.BufferAttribute(outIdx, 1));
  for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex);
  return out;
}

function buildHalf(parts, lists, tag, obj) {
  const g = new THREE.Group();
  g.name = tag;
  parts.forEach((p, i) => {
    if (!lists[i] || !lists[i].length) return;
    const geo = subsetGeometry(p.geo, lists[i]);
    if (!geo) return;
    const m = new THREE.Mesh(geo, p.mesh.material);
    m.name = p.mesh.name; m.castShadow = p.mesh.castShadow; m.receiveShadow = p.mesh.receiveShadow; m.renderOrder = p.mesh.renderOrder;
    g.add(m);
  });
  if (!g.children.length) return null;
  const box = new THREE.Box3();
  for (const m of g.children) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
  const c = box.getCenter(new THREE.Vector3());
  // vị trí gốc của nửa này trong không gian file (nhân autoScale → mét) — dùng để đặt đúng chỗ nếu file xuất cùng hệ trục với nhân vật
  const fc = obj.userData && obj.userData.fitCenter, k = (obj.userData && obj.userData.autoScale) || 1;
  const anchor = c.clone().add(fc || new THREE.Vector3()).multiplyScalar(k);
  for (const m of g.children) m.geometry.translate(-c.x, -c.y, -c.z);   // tâm nửa này về gốc, giống fitImported
  return {obj: g, anchor};
}

/**
 * Tách `obj` (đã qua fitImported) thành nửa trái / phải theo bộ xương `rig`.
 * Không sửa `obj`. Trả về {l, r, mode} với l/r = {obj: Group đã căn tâm, anchor: Vector3 (mét)}, hoặc null nếu không phải một cặp.
 */
export function splitPair(obj, rig) {
  if (!obj || !rig) return null;
  obj.updateMatrixWorld(true);
  const meshes = [];
  let skinned = false;
  obj.traverse(o => {
    if (o.isSkinnedMesh) skinned = true;
    else if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o);
  });
  if (skinned || !meshes.length) return null;
  const inv = obj.matrixWorld.clone().invert();
  const parts = meshes.map(mesh => {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(inv.clone().multiply(mesh.matrixWorld));   // đưa mọi mesh về chung một hệ toạ độ
    return {mesh, geo, pos: posArray(geo), idx: triIndex(geo)};
  });
  const plan = planSplit(parts);
  if (!plan) return null;
  const lf = rig.pos('lFoot'), rf = rig.pos('rFoot');
  const sign = lf && rf && Math.abs(lf.x - rf.x) > 1e-6 ? (lf.x >= rf.x ? 1 : -1) : (rig.lsign || 1);   // bên trái của nhân vật nằm ở +x hay -x
  const L = sign > 0 ? plan.hi : plan.lo, R = sign > 0 ? plan.lo : plan.hi;
  const l = buildHalf(parts, L, 'half_l', obj), r = buildHalf(parts, R, 'half_r', obj);
  if (!l || !r) return null;
  return {l, r, mode: plan.mode};
}
