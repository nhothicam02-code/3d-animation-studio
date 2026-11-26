import {Float32BufferAttribute} from 'three';

/* ============================================================
   Sinh shape key (morph target) cho khuôn mặt chỉ từ 6 vùng người dùng chọn:
   mày trái · mày phải · mắt trái · mắt phải · mũi · miệng.

   Kỹ thuật “chọn vùng” lấy từ trang Xưởng mô hình (index.html): chạm lên mô hình để đặt một
   quả cầu vùng, rồi đẩy các đỉnh nằm trong cầu theo hàm giảm dần mượt (smoothstep) → ra shape key.
   Ở đây làm cho cả 6 bộ phận và tự suy ra hệ trục khuôn mặt từ chính các điểm đã chọn.

   DỮ LIỆU LƯU CÙNG NHÂN VẬT (characters/custom/<id>.json → "faceRegions"), chỉ ~1 KB:
     {v:1, mesh:'<tên mesh>', verts:<số đỉnh>,
      regions:{eyeL:{c:[x,y,z], r:<bán kính>, n:[nx,ny,nz]}, …}}       toạ độ trong KHÔNG GIAN CỤC BỘ của mesh
   HÌNH DẠNG VÙNG (tuỳ chọn, mỗi vùng): ngoài bán kính r, vùng có thể là elip 3D xoay được và uốn cong — các trường sx, sy, sz, rot, bend, soft, amp
   (xem SHAPE_DEF). Thiếu trường nào thì dùng mặc định = quả cầu như bản cũ, nên nhân vật đã lưu vẫn chạy y hệt.
   Không lưu hàng MB dữ liệu morph: lúc nạp, các shape key được dựng lại (một lần, vài chục ms) rồi
   khi render chỉ còn việc ghi morphTargetInfluences — không có việc nào tính theo từng khung hình.

   Tên shape key theo chuẩn ARKit giống HUONG-DAN-NHEP-MIENG-VA-KEYSHAPE.md nên mọi mẫu biểu cảm
   trong Studio và phần nhép miệng (jawOpen) chạy được ngay.
   ============================================================ */

/** 6 vùng. k = cỡ vùng mặc định theo chiều cao đầu. */
export const REGIONS = [
  {id: 'browL', label: 'Mày trái', color: '#ffb347', k: 0.22, shape: {sx: 1, sy: 0.6, sz: 0.8, bend: 0.2, amp: 1.4}},
  {id: 'browR', label: 'Mày phải', color: '#ffe14d', k: 0.22, shape: {sx: 1, sy: 0.6, sz: 0.8, bend: 0.2, amp: 1.4}},
  {id: 'eyeL', label: 'Mắt trái', color: '#4dd2ff', k: 0.2, shape: {sx: 1, sy: 0.6, sz: 0.8}},
  {id: 'eyeR', label: 'Mắt phải', color: '#7affc1', k: 0.2, shape: {sx: 1, sy: 0.6, sz: 0.8}},
  {id: 'nose', label: 'Mũi', color: '#ff9ecb', k: 0.16, shape: {sx: 1, sy: 0.8, sz: 0.8}},
  {id: 'mouth', label: 'Miệng', color: '#ff6b6b', k: 0.28, shape: {sx: 1, sy: 0.8, sz: 0.8, amp: 1.2}}
];
export const REGION_IDS = REGIONS.map(r => r.id);

/**
 * Hình dạng vùng = quả cầu đơn vị được kéo giãn thành elip 3D, xoay trong mặt phẳng khuôn mặt, rồi uốn cong:
 *   sx Rộng (dọc trục ngang của vùng) · sy Cao · sz Sâu (ra trước/vào trong) · rot Xoay (độ, + = ngược chiều kim đồng hồ khi nhìn thẳng vào mặt)
 *   bend Cong (+ = vòm ∩ như lông mày, − = vòm ∪ như miệng cười) · soft Độ mềm viền (0.1 = lõi rộng, viền gắt → 1 = giảm dần từ tâm)
 *   amp Lực (nhân độ dời của mọi shape key thuộc vùng).
 * Mặc định = quả cầu (sx=sy=sz=1, rot=0, bend=0, soft=0.5, amp=1) — đúng hành vi bản cũ.
 */
export const SHAPE_DEF = {sx: 1, sy: 1, sz: 1, rot: 0, bend: 0, soft: 0.5, amp: 1};
export const SHAPE_KEYS = Object.keys(SHAPE_DEF);
export const SHAPE_LIMITS = {sx: [0.001, 1000], sy: [0.001, 1000], sz: [0.001, 1000], rot: [-360, 360], bend: [-50, 50], soft: [0.02, 1], amp: [0.001, 1000]};   // gần như không giới hạn (chỉ chặn số âm/0/NaN để khỏi chia cho 0)
const clampTo = (v, [lo, hi]) => (v < lo ? lo : v > hi ? hi : v);
/** Hình dạng đầy đủ (đã kẹp giới hạn, điền mặc định) của một vùng. */
export function shapeOf(g) {
  const o = {};
  for (const k of SHAPE_KEYS) { const v = g && g[k] !== undefined ? +g[k] : NaN; o[k] = Number.isFinite(v) ? clampTo(v, SHAPE_LIMITS[k]) : SHAPE_DEF[k]; }
  return o;
}

const smooth = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Mỗi shape key: vùng cần có + hàm cho độ dời của một đỉnh, tính theo ĐƠN VỊ BÁN KÍNH VÙNG.
 *   s = vị trí ngang (dương = về phía bên TRÁI nhân vật), h = chiều cao, o = “ra ngoài” (dương = xa sống mũi),
 *   w = trọng số giảm dần theo khoảng cách (1 ở lõi → 0 ở mép vùng), sg = +1 bên trái / −1 bên phải.
 *   Trả [dNgang, dLên, dRaTrước]. Hệ số blink 0.94 / squint 0.55 / wide −0.35 lấy từ index.html.
 */
const EYE = (name, f) => [['Left', 'eyeL', 1], ['Right', 'eyeR', -1]].map(([side, region, sg]) => [name + side, region, sg, f]);
const BROW = (name, f) => [['Left', 'browL', 1], ['Right', 'browR', -1]].map(([side, region, sg]) => [name + side, region, sg, f]);
const SIDE = (name, region, f) => [['Left', 1], ['Right', -1]].map(([side, sg]) => [name + side, region, sg, f]);

const DEFS = [
  ...EYE('eyeBlink', (v) => [0, -v.h * 0.94 * v.w, 0]),
  ...EYE('eyeSquint', (v) => [0, -v.h * 0.55 * v.w, 0]),
  ...EYE('eyeWide', (v) => [0, v.h * 0.35 * v.w, 0]),
  ...EYE('eyeHappy', (v) => [0, (-v.h * 0.8 + 0.18 * (1 - Math.min(1, v.o * v.o))) * v.w, 0]),
  ...EYE('eyeSad', (v) => [0, (-0.3 * smooth((v.o + 1) / 2) - v.h * 0.15) * v.w, 0]),
  ...BROW('browDown', (v) => [0, -Math.max(0.15, 0.75 - 0.5 * v.o) * 0.3 * v.w, 0]),
  ...BROW('browInnerUp', (v) => [0, 0.4 * v.w * smooth((1 - v.o) / 2), 0]),
  ...BROW('browOuterUp', (v) => [0, 0.4 * v.w * smooth((1 + v.o) / 2), 0]),
  ...SIDE('noseSneer', 'nose', (v) => { const q = smooth(v.sg * v.s); return [v.sg * 0.08 * v.w * q, 0.3 * v.w * q, 0]; }),
  ...SIDE('mouthSmile', 'mouth', (v) => { const q = smooth(v.sg * v.s); return [v.sg * 0.18 * v.w * q, 0.3 * v.w * q, 0]; }),
  ...SIDE('mouthFrown', 'mouth', (v) => { const q = smooth(v.sg * v.s); return [v.sg * 0.05 * v.w * q, -0.28 * v.w * q, 0]; }),
  ['mouthPucker', 'mouth', 1, (v) => [-v.s * 0.45 * v.w, -v.h * 0.25 * v.w, 0.18 * v.w]],
  ['jawOpen', 'mouth', 1, (v) => { const lw = smooth((-v.h + 0.1) / 0.8); return [-v.s * 0.08 * v.w * lw, -0.7 * v.w * lw, 0]; }]
];
const SHAPE = new Map(DEFS.map(([name, region, sg, fn]) => [name, {name, region, sg, fn}]));
export const SHAPE_NAMES = DEFS.map(d => d[0]);

/* ---------------- Dữ liệu vùng ---------------- */
const num3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const r5 = v => Math.round(v * 1e5) / 1e5;

/** Kiểm tra / làm sạch dữ liệu đọc từ JSON. Trả null nếu không dùng được. */
export function cleanData(d) {
  if (!d || !d.regions || typeof d.regions !== 'object') return null;
  const regions = {};
  for (const id of REGION_IDS) {
    const g = d.regions[id];
    if (g && num3(g.c) && Number.isFinite(g.r) && g.r > 0) {
      const o = {c: g.c.map(r5), r: r5(g.r), n: num3(g.n) ? g.n.map(r5) : [0, 0, 1]}, sh = shapeOf(g);
      for (const k of SHAPE_KEYS) if (Math.abs(sh[k] - SHAPE_DEF[k]) > 1e-6) o[k] = r5(sh[k]);     // chỉ lưu trường khác mặc định → JSON gọn
      regions[id] = o;
    }
  }
  if (!Object.keys(regions).length) return null;
  const o = {v: 1, mesh: String(d.mesh || ''), verts: +d.verts || 0, regions};
  if (d.axes && num3(d.axes.up) && num3(d.axes.fwd)) o.axes = {up: d.axes.up.map(r5), fwd: d.axes.fwd.map(r5)};
  return o;
}

/**
 * Hệ trục khuôn mặt (trong không gian cục bộ của mesh).
 * Có `axes` {up, fwd} (lưu lúc chọn vùng) → dùng ngay, mỗi vùng độc lập. Dữ liệu cũ không có axes → suy ra từ các điểm đã chọn (null/error nếu chưa đủ).
 */
export function faceFrame(regions, axes) {
  if (axes) {
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const up = unit(axes.up), fwd = unit(axes.fwd);
    const side = unit([up[1] * fwd[2] - up[2] * fwd[1], up[2] * fwd[0] - up[0] * fwd[2], up[0] * fwd[1] - up[1] * fwd[0]]);   // sang trái của nhân vật
    return {side, up, fwd};
  }
  const R = regions, P = id => R[id] && R[id].c;
  const pair = P('eyeL') && P('eyeR') ? ['eyeL', 'eyeR'] : P('browL') && P('browR') ? ['browL', 'browR'] : null;
  if (!pair) return {error: 'Cần chọn cả 2 mắt (hoặc cả 2 mày) để biết đâu là trái – phải.'};
  const top = ['browL', 'browR', 'eyeL', 'eyeR'].filter(P), bottom = ['nose', 'mouth'].filter(P);
  if (!bottom.length) return {error: 'Cần chọn thêm mũi hoặc miệng để biết đâu là trên – dưới.'};
  const mean = ids => ids.reduce((m, id) => [m[0] + R[id].c[0] / ids.length, m[1] + R[id].c[1] / ids.length, m[2] + R[id].c[2] / ids.length], [0, 0, 0]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const side = nrm(sub(P(pair[0]), P(pair[1])));                    // từ mắt/mày phải sang trái của nhân vật
  const upRaw = sub(mean(top), mean(bottom));
  const k = dot(upRaw, side), up = nrm([upRaw[0] - side[0] * k, upRaw[1] - side[1] * k, upRaw[2] - side[2] * k]);
  let fwd = nrm(cross(side, up));
  const nn = Object.values(R).reduce((m, g) => [m[0] + g.n[0], m[1] + g.n[1], m[2] + g.n[2]], [0, 0, 0]);
  if (dot(fwd, nn) < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];   // pháp tuyến trung bình quyết định hướng “ra trước” thật sự
  return {side, up, fwd};
}

/** Hai trục của elip vùng sau khi xoay `rot` độ trong mặt phẳng mặt: A = trục “rộng”, B = trục “cao”; F = hướng ra trước. */
export function regionAxes(frame, shape) {
  const t = (shape.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), {side, up, fwd} = frame;
  return {
    A: [side[0] * c + up[0] * s, side[1] * c + up[1] * s, side[2] * c + up[2] * s],
    B: [-side[0] * s + up[0] * c, -side[1] * s + up[1] * c, -side[2] * s + up[2] * c],
    F: fwd
  };
}

/** Các shape key dựng được với bộ vùng hiện có. */
export function shapesAvailable(data) {
  const d = cleanData(data);
  if (!d || faceFrame(d.regions, d.axes).error) return [];
  return SHAPE_NAMES.filter(n => d.regions[SHAPE.get(n).region]);
}

/* ---------------- Lõi tính toán (không phụ thuộc three.js) ---------------- */
/**
 * positions: Float32Array|mảng phẳng xyz của mesh · trả {name: Float32Array(V*3)} — độ dời TƯƠNG ĐỐI cho các shape key yêu cầu.
 * Mỗi vùng chỉ quét đúng một lần để lọc các đỉnh nằm trong cầu; mỗi shape key chỉ duyệt các đỉnh đó.
 */
export function computeDeltas(positions, V, regions, names, axes) {
  const fr = faceFrame(regions, axes);
  if (fr.error) throw new Error(fr.error);
  const out = {};
  const stats = {};
  const near = {};                       // id vùng → các đỉnh nằm trong vùng + toạ độ chuẩn hoá (a, b, c) của chúng
  const need = new Set(names.map(n => SHAPE.get(n) && SHAPE.get(n).region).filter(Boolean));
  for (const id of need) {
    const g = regions[id]; if (!g) continue;
    const sh = shapeOf(g), ax = regionAxes(fr, sh), A = ax.A, B = ax.B, F = ax.F;
    const [cx, cy, cz] = g.c, R = g.r, Rx = R * sh.sx, Ry = R * sh.sy, Rz = R * sh.sz, bend = sh.bend, core = 1 - sh.soft;
    const reach = R * Math.max(sh.sx, sh.sy * (1 + Math.abs(bend)), sh.sz), reach2 = reach * reach;   // cầu bao ngoài: lọc nhanh trước
    const idx = [], s = [], h = [], f = [], w = [];
    for (let i = 0; i < V; i++) {
      const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy, dz = positions[i * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz >= reach2) continue;
      // toạ độ trong hệ vùng: a dọc trục rộng, b dọc trục cao (đã “duỗi thẳng” đường cong), c theo chiều sâu; vùng là x = |(a,b,c)| < 1
      const a = (dx * A[0] + dy * A[1] + dz * A[2]) / Rx, c = (dx * F[0] + dy * F[1] + dz * F[2]) / Rz;
      const b = (dx * B[0] + dy * B[1] + dz * B[2]) / Ry + bend * a * a;
      const x = Math.sqrt(a * a + b * b + c * c);
      if (x >= 1) continue;
      const t = clamp01((x - core) / (1 - core));
      idx.push(i); w.push(1 - t * t * (3 - 2 * t)); s.push(a); h.push(b); f.push(c);
    }
    near[id] = {idx, s, h, f, w, A, B, F, Rx, Ry, Rz, amp: sh.amp};
    stats[id] = idx.length;     // số đỉnh vùng này thực sự bắt được (0–vài đỉnh = biểu cảm gần như không thấy gì)
  }
  const v = {s: 0, h: 0, o: 0, w: 0, sg: 1, f: 0};
  for (const name of names) {
    const def = SHAPE.get(name), nr = def && near[def.region];
    if (!def || !nr) continue;
    const arr = new Float32Array(V * 3), {A, B, F, Rx, Ry, Rz, amp} = nr;
    for (let j = 0; j < nr.idx.length; j++) {
      v.s = nr.s[j]; v.h = nr.h[j]; v.f = nr.f[j]; v.w = nr.w[j]; v.sg = def.sg;
      // “o” = ra ngoài: vùng bên trái (sg=+1) ra ngoài là +s, vùng bên phải là −s. Vùng đơn (mũi, miệng) không dùng o.
      v.o = def.region === 'nose' || def.region === 'mouth' ? 0 : (def.region.endsWith('L') ? 1 : -1) * v.s;
      const d = def.fn(v), i = nr.idx[j] * 3, d0 = d[0] * Rx * amp, d1 = d[1] * Ry * amp, d2 = d[2] * Rz * amp;
      arr[i] += A[0] * d0 + B[0] * d1 + F[0] * d2;
      arr[i + 1] += A[1] * d0 + B[1] * d1 + F[1] * d2;
      arr[i + 2] += A[2] * d0 + B[2] * d1 + F[2] * d2;
    }
    out[name] = arr;
  }
  out.stats = stats;
  return out;
}

/* ---------------- Gắn vào mesh three.js ---------------- */
const KEY = 'faceRegionShapes';           // geometry.userData[KEY] = danh sách tên shape key do module này tạo
const SIG = 'faceRegionSig';              // geometry.userData[SIG] = chữ ký bộ vùng đã dùng để tạo chúng

/** Chữ ký ngắn của bộ vùng — để biết geometry dùng chung đang mang shape key của bộ vùng nào. */
export function signature(regions, axes) {
  const str = JSON.stringify(REGION_IDS.map(id => { const g = regions[id], sh = g && shapeOf(g); return g ? [g.c, g.r, SHAPE_KEYS.map(k => sh[k])] : 0; }).concat(axes ? [axes.up, axes.fwd] : []));
  let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Mesh chứa khuôn mặt: khớp tên + số đỉnh; không có thì khớp số đỉnh; không có nữa thì khớp tên. */
export function findMesh(model, data) {
  const d = cleanData(data); if (!d || !model) return null;
  let byName = null, byCount = null;
  model.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const n = o.geometry.attributes.position.count;
    if (o.name === d.mesh && (!d.verts || n === d.verts)) byName = byName || o;
    else if (d.verts && n === d.verts) byCount = byCount || o;
    else if (o.name === d.mesh) byName = byName || o;
  });
  return byName || byCount;
}

const toRelative = g => {
  const mp = g.morphAttributes.position; if (!mp || !mp.length || g.morphTargetsRelative) return;
  const pos = g.attributes.position, nor = g.attributes.normal, mn = g.morphAttributes.normal, n = pos.count;
  mp.forEach(a => { for (let v = 0; v < n; v++) a.setXYZ(v, a.getX(v) - pos.getX(v), a.getY(v) - pos.getY(v), a.getZ(v) - pos.getZ(v)); });
  if (nor && mn) mn.forEach(a => { for (let v = 0; v < n; v++) a.setXYZ(v, a.getX(v) - nor.getX(v), a.getY(v) - nor.getY(v), a.getZ(v) - nor.getZ(v)); });
};
const refreshMats = mesh => { for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) if (m) m.needsUpdate = true; };

/** Xóa các shape key do module này tạo khỏi mesh (giữ nguyên shape key gốc của model). */
export function clearShapes(mesh) {
  const g = mesh && mesh.geometry, mine = g && g.userData[KEY];
  if (!mine || !mine.length) return 0;
  const set = new Set(mine);
  for (const k of ['position', 'normal']) {
    const arr = g.morphAttributes[k]; if (!arr) continue;
    const keep = arr.filter(a => !set.has(a.name));
    if (keep.length) g.morphAttributes[k] = keep; else delete g.morphAttributes[k];
  }
  g.userData[KEY] = [];
  if (g.morphAttributes.position && g.morphAttributes.position.length) mesh.updateMorphTargets();
  else { mesh.morphTargetInfluences = undefined; mesh.morphTargetDictionary = undefined; }
  g.dispose(); refreshMats(mesh);
  return set.size;
}

/**
 * Dựng các shape key `names` (mặc định: tất cả dựng được) lên mesh. Shape key đã có thì bỏ qua → gọi lại nhiều lần vẫn an toàn,
 * kể cả khi nhiều bản sao nhân vật dùng chung một geometry. Trả {added, skipped}.
 */
export function buildShapes(mesh, data, names) {
  const d = cleanData(data); if (!d) throw new Error('Dữ liệu vùng mặt không hợp lệ.');
  let g = mesh.geometry;
  const sig = signature(d.regions, d.axes);
  // Geometry dùng chung (nhiều bản sao nhân vật cùng một file) đang mang shape key của BỘ VÙNG KHÁC → tách riêng cho mesh này.
  if (g.userData[KEY] && g.userData[KEY].length && g.userData[SIG] !== sig) {
    mesh.geometry = g = g.clone();
    clearShapes(mesh);
  }
  const pos = g.attributes.position, V = pos.count;
  if (g.morphAttributes.position) mesh.updateMorphTargets();     // đồng bộ bảng tên với geometry dùng chung
  const have = new Set(Object.keys(mesh.morphTargetDictionary || {}));
  const want = (names && names.length ? names : shapesAvailable(d)).filter(n => SHAPE.has(n) && d.regions[SHAPE.get(n).region]);
  const todo = want.filter(n => !have.has(n)), skipped = want.filter(n => have.has(n));
  if (!todo.length) return {added: [], skipped, stats: {}};
  const flat = pos.isInterleavedBufferAttribute || !(pos.array instanceof Float32Array) ? (() => { const a = new Float32Array(V * 3); for (let i = 0; i < V; i++) { a[i * 3] = pos.getX(i); a[i * 3 + 1] = pos.getY(i); a[i * 3 + 2] = pos.getZ(i); } return a; })() : pos.array;
  const deltas = computeDeltas(flat, V, d.regions, todo, d.axes);
  const old = (mesh.morphTargetInfluences || []).slice();
  toRelative(g);
  const mine = g.userData[KEY] || (g.userData[KEY] = []);
  for (const name of todo) {
    const a = new Float32BufferAttribute(deltas[name], 3); a.name = name;
    (g.morphAttributes.position = g.morphAttributes.position || []).push(a);
    if (g.morphAttributes.normal) g.morphAttributes.normal.push(new Float32BufferAttribute(new Float32Array(V * 3), 3));
    mine.push(name);
  }
  g.morphTargetsRelative = true; g.userData[SIG] = sig;
  mesh.updateMorphTargets();
  old.forEach((v, j) => { if (j < mesh.morphTargetInfluences.length) mesh.morphTargetInfluences[j] = v; });
  g.dispose(); refreshMats(mesh);
  return {added: todo, skipped, stats: deltas.stats || {}};
}

/* ---------------- Dùng khi chạy (Studio / xuất video) ---------------- */
/** Tên shape key mà các biểu cảm keyshape thực sự dùng (+ jawOpen cho nhép miệng) → chỉ dựng những cái cần, tiết kiệm bộ nhớ GPU. */
export function neededNames(expressions) {
  const set = new Set(), list = Array.isArray(expressions) ? expressions : [];
  let any = false;
  for (const e of list) if (e && e.mode === 'keyshape' && e.tracks) { any = true; for (const n of Object.keys(e.tracks)) if (SHAPE.has(n)) set.add(n); }
  if (any) set.add('jawOpen');
  return [...set];
}

/**
 * Gọi ngay sau khi nạp model, TRƯỚC khi quét keyshape của model (createShapeDriver.setModel).
 * data = doc.faceRegions · expressions = doc.expressions (null → dựng tất cả).
 * Trả {mesh, added, skipped} hoặc null nếu nhân vật không dùng vùng mặt.
 */
export function applyRegions(model, data, expressions) {
  const d = cleanData(data); if (!d) return null;
  const mesh = findMesh(model, d); if (!mesh) return null;
  const names = expressions == null ? null : neededNames(expressions);
  if (names && !names.length) return {mesh, added: [], skipped: []};
  return {mesh, ...buildShapes(mesh, d, names)};
}
