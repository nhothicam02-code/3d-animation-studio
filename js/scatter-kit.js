import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

/* ============================================================
   Lớp rải (scatter) cho các địa điểm — cỏ, hoa, bụi cây, đá, sỏi, tuyết, băng trôi
   và BẤT KỲ mô hình nào trong kho thư viện. Mỗi lớp là một InstancedMesh (hàng nghìn cá thể, 1 draw call).
   Dữ liệu nằm trong s.env.layers = [{id, kind, on, color, color2, density, near, far, size, ... }].

   Vật lí (tính từ thời gian t nên tua / xuất video cho kết quả giống hệt):
     • gió       : lắc theo sóng + gió của khối hiệu ứng "Gió" (fx-kit)         → wind, stiff
     • bị đạp    : nhân vật đi qua thì cỏ / hoa / bụi rạp xuống và nghiêng ra    → push, pushr
     • rơi & nảy : cả lớp rơi từ trên cao xuống, nảy vài lần rồi nằm yên         → drop, dropH, bounce
     • nhấp nhô  : băng trôi / mảng băng bập bềnh theo sóng                     → bob
   ============================================================ */

const MAXN = 24000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mul32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hstr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const nz3 = (x, y, z) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return v - Math.floor(v); };
const vnz = (x, y, z, k) => { // nhiễu mượt theo vị trí: các đỉnh trùng nhau dịch chuyển như nhau → không nứt khe
  x *= k; y *= k; z *= k; const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const s = t => t * t * (3 - 2 * t), a = s(fx), b = s(fy), c = s(fz), L = (p, q, t) => p + (q - p) * t;
  const g = (i, j, k2) => nz3(ix + i, iy + j, iz + k2);
  return L(L(L(g(0, 0, 0), g(1, 0, 0), a), L(g(0, 1, 0), g(1, 1, 0), a), b), L(L(g(0, 0, 1), g(1, 0, 1), a), L(g(0, 1, 1), g(1, 1, 1), a), b), c);
};

/* ---------------- Loại lớp + thông số mặc định ---------------- */
const WHERE = [['any', 'Mọi nơi'], ['off', 'Ngoài lối đi / ngoài nước (chừa đường)'], ['path', 'Chỉ trên lối đi'], ['land', 'Đất liền (không nước)'], ['water', 'Chỉ trên mặt nước'], ['shore', 'Ven bờ nước (dải đất sát mép nước)']];
const SW = {sway: 1}, BOB = {bob: 1}, STILL = {}, FLT = {bob: 1, drift: 1};
export const LAYER_KINDS = {
  grass: {ic: '🌿', name: 'Cỏ', f: SW, dmax: 1500, smax: 5, d: {color: '#3f8f2e', color2: '#a6d65a', density: 300, near: .6, far: 14, size: 1, sizeVar: .4, where: 'off', clump: .35, wind: 1, stiff: .3, push: 1, pushr: .7}},
  flower: {ic: '🌸', name: 'Hoa', f: SW, dmax: 300, smax: 4, d: {color: '#ff5f9e', color2: '#ffd23f', density: 40, near: .8, far: 13, size: 1, sizeVar: .35, where: 'off', clump: .6, wind: 1, stiff: .4, push: 1, pushr: .6}},
  bush: {ic: '🌳', name: 'Bụi cây', f: SW, dmax: 40, smax: 6, d: {color: '#2f6f34', color2: '#6aa840', density: 4, near: 2, far: 18, size: 1.2, sizeVar: .5, where: 'off', clump: .4, wind: .4, stiff: .75, push: .5, pushr: .9}},
  rock: {ic: '🪨', name: 'Đá tảng', f: STILL, dmax: 40, smax: 12, d: {color: '#8d8a84', color2: '#b9b3a8', density: 3, near: 2, far: 30, size: 1, sizeVar: .7, where: 'any', clump: .3}},
  cobble: {ic: '⚪', name: 'Đá cuội', f: STILL, dmax: 400, smax: 6, d: {color: '#9b958b', color2: '#6f6a62', density: 80, near: .5, far: 12, size: 1, sizeVar: .5, where: 'any', clump: .2}},
  pebble: {ic: '🔹', name: 'Sỏi', f: STILL, dmax: 3000, smax: 6, d: {color: '#b7ab98', color2: '#7d7364', density: 600, near: .3, far: 10, size: 1, sizeVar: .6, where: 'any', clump: 0}},
  snow: {ic: '🏔', name: 'Đụn tuyết', f: STILL, dmax: 30, smax: 10, d: {color: '#f4f8ff', color2: '#cfe0f2', density: 3, near: 2, far: 26, size: 1.4, sizeVar: .6, where: 'land', clump: .3}},
  iceberg: {ic: '🧊', name: 'Tảng băng trôi', f: BOB, dmax: 1.5, smax: 20, d: {color: '#eaf6ff', color2: '#9fd0f0', density: .06, near: 8, far: 90, size: 3, sizeVar: .6, where: 'water', clump: 0, bob: 1, falloff: .3}},
  floe: {ic: '❄️', name: 'Mảng băng nhỏ', f: BOB, dmax: 8, smax: 8, d: {color: '#f2f9ff', color2: '#bfe0f5', density: .8, near: 6, far: 70, size: 1, sizeVar: .7, where: 'water', clump: .35, bob: 1.4, falloff: .2}},
  leaf: {ic: '🍃', name: 'Lá xanh trôi', f: FLT, dmax: 150, smax: 4, d: {color: '#3f9a3a', color2: '#a6d252', density: 12, near: 2, far: 30, size: 1, sizeVar: .45, where: 'water', clump: .45, bob: .6, drift: 1, ddir: 90, falloff: .2}},
  petal: {ic: '🌸', name: 'Cánh hoa trôi', f: FLT, dmax: 800, smax: 4, d: {color: '#ffb0cb', color2: '#ffffff', density: 70, near: 1.5, far: 26, size: 1, sizeVar: .4, where: 'water', clump: .75, bob: .5, drift: 1.1, ddir: 90, falloff: .25}},
  lilypad: {ic: '🟢', name: 'Lá súng / lá sen', f: FLT, dmax: 80, smax: 3, d: {color: '#2f7f3a', color2: '#6db04c', density: 20, near: 4, far: 34, size: 1.2, sizeVar: .35, where: 'water', clump: .5, bob: .35, drift: 0, ddir: 90, falloff: .1}},
  lotus: {ic: '🪷', name: 'Hoa súng / hoa sen', f: FLT, dmax: 30, smax: 3, d: {color: '#ff8cb6', color2: '#fff0f5', density: 5, near: 5, far: 32, size: 1.1, sizeVar: .3, where: 'water', clump: .55, bob: .3, drift: 0, ddir: 90, falloff: .1}},
  reed: {ic: '🌾', name: 'Lau sậy ven bờ', f: SW, dmax: 250, smax: 3, d: {color: '#6a8f3a', color2: '#b9c96a', density: 45, near: .5, far: 26, size: 1, sizeVar: .4, where: 'shore', clump: .7, wind: 1, stiff: .45, push: .8, pushr: .7}},
  lib: {ic: '📦', name: 'Mô hình thư viện', f: SW, dmax: 100, smax: 20, d: {color: '#ffffff', color2: '#ffffff', tint: 0, density: 1, near: 2, far: 16, size: 1.5, sizeVar: .3, where: 'any', clump: .2, wind: .3, stiff: .8, push: .3, pushr: .8}}
};
const COMMON = {on: true, shape: 'ring', cx: 0, cz: 0, sx: 0, sz: -6, sw: 6, sl: 16, seed: 1, falloff: 0, drop: false, dropH: 6, bounce: .45, bob: 0, wind: 0, stiff: .5, push: 0, pushr: .7, sizeVar: .3, clump: 0, tint: 1, drift: 0, ddir: 90};

let _uid = 0;
export function layerDefaults(kind) { const K = LAYER_KINDS[kind] || LAYER_KINDS.grass; return {id: 'ly' + Date.now().toString(36) + (++_uid), kind, name: K.name, ...COMMON, ...K.d}; }
export const layerOf = (L) => ({...COMMON, ...(LAYER_KINDS[L.kind] || LAYER_KINDS.grass).d, ...L});

/** Danh sách trường chỉnh của một lớp: [khoá, nhãn, kiểu('r'|'c'|'b'|'s'|'h'), min, max, step, tuỳ chọn] */
export function layerFields(L) {
  const K = LAYER_KINDS[L.kind] || LAYER_KINDS.grass, ring = L.shape !== 'strip', f = [];
  f.push(['h', '🎨 Màu & kích thước']);
  if (L.kind === 'lib') f.push(['color', 'Màu nhuộm thêm', 'c'], ['tint', 'Mức nhuộm màu (0 = giữ màu gốc)', 'r', 0, 1, .01], ['size', 'Kích thước (m, cạnh lớn nhất)', 'r', .05, K.smax, .05]);
  else f.push(['color', L.kind === 'flower' ? 'Màu hoa chính' : 'Màu chính', 'c'], ['color2', L.kind === 'flower' ? 'Màu hoa phụ (trộn ngẫu nhiên)' : 'Màu phụ (biến thiên giữa các cá thể)', 'c'], ['size', 'Kích thước (hệ số)', 'r', .1, K.smax, .05]);
  f.push(['sizeVar', 'Chênh lệch kích thước ngẫu nhiên', 'r', 0, 1, .01]);
  f.push(['h', '📍 Mật độ & vị trí']);
  f.push(['density', 'Mật độ (số cá thể / 100 m²)', 'r', 0, K.dmax, K.dmax > 100 ? 1 : K.dmax > 10 ? .1 : .005]);
  f.push(['where', 'Rải ở đâu', 's', WHERE], ['shape', 'Hình vùng rải', 's', [['ring', 'Vành khuyên quanh tâm (gần → xa)'], ['strip', 'Dải chữ nhật']]]);
  if (ring) f.push(['near', 'Gần nhất (m) — chừa trống quanh tâm', 'r', 0, 60, .1], ['far', 'Xa nhất (m)', 'r', 1, 150, .5], ['falloff', 'Dồn về phía gần (0 = đều)', 'r', 0, 1, .01], ['cx', 'Tâm X (m)', 'r', -40, 40, .1], ['cz', 'Tâm Z (m) — âm là phía trước camera', 'r', -80, 40, .1]);
  else f.push(['sx', 'Tâm dải X (m)', 'r', -60, 60, .1], ['sz', 'Tâm dải Z (m)', 'r', -120, 40, .1], ['sw', 'Bề rộng dải (m)', 'r', .5, 120, .1], ['sl', 'Chiều dài dải (m)', 'r', .5, 200, .1]);
  f.push(['clump', 'Mức mọc thành cụm', 'r', 0, 1, .01], ['seed', 'Hạt giống ngẫu nhiên (đổi để rải khác đi)', 'r', 1, 999, 1]);
  f.push(['h', '⚙️ Vật lí']);
  if (K.f.sway) f.push(['wind', 'Độ lắc theo gió', 'r', 0, 3, .01], ['stiff', 'Độ cứng (0 = mềm dẻo · 1 = cứng)', 'r', 0, 1, .01], ['push', 'Bị nhân vật đạp rạp (0 = không)', 'r', 0, 2, .01], ['pushr', 'Bán kính bị đạp (m)', 'r', .1, 3, .05]);
  if (K.f.bob) f.push(['bob', 'Nhấp nhô theo sóng', 'r', 0, 3, .01]);
  if (K.f.drift) f.push(['drift', 'Trôi theo dòng nước (0 = đứng yên · 1 = đúng tốc độ dòng)', 'r', 0, 3, .01], ['ddir', 'Hướng trôi (độ: 0 = +X, 90 = về phía camera)', 'r', 0, 360, 1]);
  f.push(['drop', 'Rơi từ trên cao xuống & nảy khi bắt đầu cảnh', 'b']);
  if (L.drop) f.push(['dropH', 'Thả từ độ cao (m)', 'r', 1, 20, .1], ['bounce', 'Độ nảy (0 = dính đất)', 'r', 0, .9, .01]);
  return f;
}

/* ---------------- Địa hình: lối đi / mặt nước (khớp với shader mặt đất trong env-kit) ---------------- */
/** Mặt nước loại 8 (hồ / sông / suối / biển) — công thức PHẢI khớp hàm wsd() trong shader của env-kit.js. > 0: trong nước, < 0: đất liền. */
export function waterSd(x, z, P) {
  const k = P.wk || 0;
  if (k < .5) { const sh = -P.wdist + 3 * Math.sin(x * .15) + 1.5 * Math.sin(x * .41 + 2), fs = -P.wfar + 6 * Math.sin(x * .07 + 1) + 3 * Math.sin(x * .23); return Math.min(sh - z, z - fs); }
  if (k < 2.5) { const cx = P.wcx + (Math.sin(z * .11) * 2.2 + Math.sin(z * .04 + 1) * 3) * P.pcurve, w = P.pw * (1 + .2 * Math.sin(z * .3)); return w - Math.abs(x - cx); }
  return -P.wdist + 2.2 * Math.sin(x * .12) + 1.1 * Math.sin(x * .37 + 2) - z;
}
export function groundInfo(x, z, P) {
  const g = P.gnd | 0; let pd = 99, water = false;
  if (g === 2 || g === 6 || g === 7) { const cx = (Math.sin(z * .11) * 2.2 + Math.sin(z * .04 + 1) * 3) * P.pcurve, w = P.pw * (1 + .2 * Math.sin(z * .3)); pd = Math.abs(x - cx) - w; }
  else if (g === 4) pd = Math.abs(x) - (P.pw + 2.35);
  else if (g === 5 && P.water > .05) water = z < -P.wdist + 3 * Math.sin(x * .15) + 1.5 * Math.sin(x * .41 + 2) - .4;
  else if (g === 8) { const sd = waterSd(x, z, P); water = sd > .25; pd = -sd; }
  return {pd, water, hasPath: g === 2 || g === 4 || g === 6 || g === 7, hasWater: (g === 5 && P.water > .05) || g === 8};
}
const okAt = (w, x, z, P) => { const i = groundInfo(x, z, P); switch (w) { case 'off': return i.pd > .3 && !i.water; case 'path': return i.hasPath && i.pd < 0; case 'land': return !i.water; case 'water': return i.water; case 'shore': return i.hasWater && !i.water && i.pd > .05 && i.pd < 3.4; default: return true; } };

/* ---------------- Dựng hình (tất cả không chỉ mục; thuộc tính: position, normal, color, aSw, aHead) ---------------- */
function Build() {
  const p = [], c = [], s = [], h = [];
  const v = (x, y, z, col, sw, hd) => { p.push(x, y, z); c.push(col[0], col[1], col[2]); s.push(sw); h.push(hd); };
  return {
    v, tri: (a, b, d, col, sw, hd) => { for (const q of [a, b, d]) v(q[0], q[1], q[2], col, typeof sw === 'function' ? sw(q) : sw, hd); },
    done(flat = true) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setAttribute('aSw', new THREE.Float32BufferAttribute(s, 1)); g.setAttribute('aHead', new THREE.Float32BufferAttribute(h, 1));
      g.computeVertexNormals(); g.computeBoundingSphere(); return g;
    }
  };
}
function grassGeo() {
  const b = Build(), R = mul32(11), N = 9, SEG = 3;
  for (let i = 0; i < N; i++) {
    const a = R() * 6.283, r = Math.sqrt(R()) * .09, bx = Math.cos(a) * r, bz = Math.sin(a) * r, yaw = R() * 6.283, H = .2 + R() * .2, W = .013 + R() * .008, bend = .05 + R() * .13;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), px = -dz, pz = dx, rows = [];
    for (let k = 0; k <= SEG; k++) { const t = k / SEG, w = W * (1 - t * t * .96), off = bend * t * t, cx = bx + dx * off, cz = bz + dz * off, y = H * t; rows.push({L: [cx - px * w, y, cz - pz * w], R: [cx + px * w, y, cz + pz * w], t}); }
    for (let k = 0; k < SEG; k++) {
      const A = rows[k], B = rows[k + 1], c1 = [.38 + .62 * A.t, .38 + .62 * A.t, .38 + .62 * A.t], c2 = [.38 + .62 * B.t, .38 + .62 * B.t, .38 + .62 * B.t];
      b.v(...A.L, c1, A.t, 1); b.v(...A.R, c1, A.t, 1); b.v(...B.R, c2, B.t, 1);
      b.v(...A.L, c1, A.t, 1); b.v(...B.R, c2, B.t, 1); b.v(...B.L, c2, B.t, 1);
    }
  }
  return b.done();
}
function flowerGeo() {
  const b = Build(), Hs = .36, bend = .05, G = [.17, .43, .12], K = 3, ring = (t, r) => { const o = bend * t * t, y = Hs * t; return [0, 1, 2].map(i => { const a = i / 3 * 6.283; return [Math.cos(a) * r + o, y, Math.sin(a) * r]; }); };
  for (let k = 0; k < 4; k++) { const A = ring(k / 4, .008), B = ring((k + 1) / 4, .008), t0 = k / 4, t1 = (k + 1) / 4; for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; b.v(...A[i], G, t0 * t0, 0); b.v(...A[j], G, t0 * t0, 0); b.v(...B[j], G, t1 * t1, 0); b.v(...A[i], G, t0 * t0, 0); b.v(...B[j], G, t1 * t1, 0); b.v(...B[i], G, t1 * t1, 0); } }
  for (const [yy, ang] of [[.1, 0.4], [.18, 3.6]]) { const o = bend * (yy / Hs) ** 2, dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx, tip = [o + dx * .09, yy + .035, dz * .09], m = [o + dx * .045, yy + .012, dz * .045]; b.tri([o, yy, 0], [m[0] + px * .02, m[1], m[2] + pz * .02], tip, G, .25, 0); b.tri([o, yy, 0], tip, [m[0] - px * .02, m[1], m[2] - pz * .02], G, .25, 0); }
  const ho = bend, hy = Hs, NP = 7;
  for (let i = 0; i < NP; i++) {
    const a = i / NP * 6.283, a1 = (i + .5) / NP * 6.283, a2 = (i + 1) / NP * 6.283, r0 = .014, r1 = .062, tip = [ho + Math.cos(a1) * r1, hy + .028, Math.sin(a1) * r1];
    b.tri([ho + Math.cos(a) * r0, hy, Math.sin(a) * r0], [ho + Math.cos(a1) * .04 + Math.sin(a1) * .018, hy + .014, Math.sin(a1) * .04 - Math.cos(a1) * .018], tip, [.82, .82, .82], 1, 1);
    b.tri([ho + Math.cos(a2) * r0, hy, Math.sin(a2) * r0], tip, [ho + Math.cos(a1) * .04 - Math.sin(a1) * .018, hy + .014, Math.sin(a1) * .04 + Math.cos(a1) * .018], [1, 1, 1], 1, 1);
  }
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283, a2 = (i + 1) / 6 * 6.283; b.tri([ho, hy + .014, 0], [ho + Math.cos(a) * .017, hy + .006, Math.sin(a) * .017], [ho + Math.cos(a2) * .017, hy + .006, Math.sin(a2) * .017], [1, .78, .16], 1, 0); }
  return b.done();
}
function blobs(parts, o) { // các khối cầu lồi lõm gộp lại: bụi cây
  const b = Build();
  for (const [cx, cy, cz, r, sy] of parts) {
    const g = new THREE.IcosahedronGeometry(1, o.detail), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      const V = [0, 1, 2].map(k => { const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k), n = .78 + .45 * vnz(x + cx * 3, y + cy * 3, z + cz * 3, 2.3); return [cx + x * r * n, cy + y * r * n * sy, cz + z * r * n]; });
      for (const q of V) { const sh = clamp(.5 + .6 * (q[1] / o.top), .42, 1.05); b.v(q[0], Math.max(q[1], 0), q[2], [sh, sh, sh], clamp(q[1] / o.top, 0, 1) * o.sw, 1); }
    }
  }
  return b.done();
}
const bushGeo = () => blobs([[0, .3, 0, .46, .78], [.3, .24, .1, .33, .8], [-.28, .22, -.08, .34, .8], [.05, .26, -.3, .31, .8], [-.06, .19, .3, .28, .8]], {detail: 1, top: .75, sw: .55});
function rockGeo({r = .5, flat = 1, amp = .3, k = 2.2, detail = 1, smooth = false, shade = 1, bottomCut = .35}) {
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const n = 1 + amp * (vnz(x + 5, y + 5, z + 5, k) - .5) * 2; x *= r * n; y *= r * n * flat; z *= r * n; y = Math.max(y, -r * flat * bottomCut); pos.setXYZ(i, x, y, z); }
  let mn = 1e9, mx = -1e9; for (let i = 0; i < pos.count; i++) { mn = Math.min(mn, pos.getY(i)); mx = Math.max(mx, pos.getY(i)); }
  const col = [], sw = [], hd = [];
  for (let i = 0; i < pos.count; i++) { pos.setY(i, pos.getY(i) - mn); const t = (pos.getY(i)) / Math.max(mx - mn, 1e-4), s = clamp((.72 + .3 * t + .14 * (nz3(pos.getX(i) * 9, pos.getY(i) * 9, pos.getZ(i) * 9) - .5)) * shade, 0, 1.2); col.push(s, s, s); sw.push(0); hd.push(1); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSw', new THREE.Float32BufferAttribute(sw, 1)); g.setAttribute('aHead', new THREE.Float32BufferAttribute(hd, 1));
  if (!smooth) g = g.toNonIndexed(); g.computeVertexNormals(); if (smooth) g = g.toNonIndexed(); g.computeBoundingSphere(); return g;
}
function mountGeo() { // đụn tuyết
  let g = new THREE.SphereGeometry(.5, 16, 10); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g); const pos = g.attributes.position, col = [], sw = [], hd = [];
  for (let i = 0; i < pos.count; i++) { let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const n = 1 + .22 * (vnz(x + 2, y, z + 2, 3.1) - .5) * 2; x *= n; z *= n; y = Math.max(y * .85 * n, -.03); pos.setXYZ(i, x, y + .03, z); const t = clamp(y / .4, 0, 1), c = .86 + .14 * t; col.push(c * .94, c * .97, c); sw.push(0); hd.push(1); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSw', new THREE.Float32BufferAttribute(sw, 1)); g.setAttribute('aHead', new THREE.Float32BufferAttribute(hd, 1));
  g.computeVertexNormals(); g = g.toNonIndexed(); g.computeBoundingSphere(); return g;
}
function bergGeo() { // tảng băng trôi: khối nhiều mặt, đáy phẳng, đỉnh nhọn
  let g = new THREE.IcosahedronGeometry(1, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); const pos = g.attributes.position, col = [], sw = [], hd = [];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const n = 1 + .3 * (vnz(x + 9, y + 9, z + 9, 1.7) - .5) * 2, up = Math.max(y, 0), spire = Math.pow(vnz(x * 1.3 + 1, y, z * 1.3 + 4, 2.4), 2.2);
    x *= 1.25 * n; z *= 1.25 * n; y = up * (.9 + 1.0 * spire) * n; if (y < .02) { const s = 1 - (.02 - y) * 0; x *= .98 * s; z *= .98 * s; y = 0; }
    pos.setXYZ(i, x, y, z);
  }
  let mx = 0; for (let i = 0; i < pos.count; i++) mx = Math.max(mx, pos.getY(i));
  for (let i = 0; i < pos.count; i++) { const t = pos.getY(i) / Math.max(mx, .01), k = clamp(t * 3, 0, 1), s = (.62 + .38 * k) * (.95 + .1 * nz3(pos.getX(i) * 7, pos.getY(i) * 7, pos.getZ(i) * 7)); col.push(s * .8, s * .93, s); sw.push(1); hd.push(1); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSw', new THREE.Float32BufferAttribute(sw, 1)); g.setAttribute('aHead', new THREE.Float32BufferAttribute(hd, 1));
  g = g.toNonIndexed(); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function floeGeo() {
  const b = Build(), N = 8, R = mul32(5), r = [], T = .1; for (let i = 0; i < N; i++) r.push(.36 + R() * .16);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, a = i / N * 6.283, a2 = j / N * 6.283, P1 = [Math.cos(a) * r[i], T, Math.sin(a) * r[i]], P2 = [Math.cos(a2) * r[j], T, Math.sin(a2) * r[j]], B1 = [P1[0] * .96, 0, P1[2] * .96], B2 = [P2[0] * .96, 0, P2[2] * .96], top = [0, T * 1.2, 0];
    b.tri(top, P2, P1, [1, 1, 1], 1, 1); b.tri(P1, P2, B2, [.58, .82, .98], 1, 1); b.tri(P1, B2, B1, [.58, .82, .98], 1, 1);
  }
  return b.done();
}
/* ---- Vật nổi trên nước: lá, cánh hoa, lá súng, hoa súng; và lau sậy ven bờ ---- */
function strip(b, rows, pt, col) { // dải lá: mỗi hàng có điểm giữa + hai mép; col(r, s) → màu
  for (let k = 0; k < rows.length - 1; k++) for (const sd of [-1, 1]) {
    const A = rows[k], B = rows[k + 1], a0 = pt(A, 0), a1 = pt(A, sd), b0 = pt(B, 0), b1 = pt(B, sd), c0 = col(A, 0), c1 = col(A, sd), d0 = col(B, 0), d1 = col(B, sd);
    b.v(...a0, c0, 0, 1); b.v(...a1, c1, 0, 1); b.v(...b1, d1, 0, 1); b.v(...a0, c0, 0, 1); b.v(...b1, d1, 0, 1); b.v(...b0, d0, 0, 1);
  }
}
function leafGeo() {
  const b = Build(), N = 8, Ln = .24, W = .082, rows = [];
  for (let k = 0; k <= N; k++) { const u = k / N; rows.push({x: (u - .35) * Ln, u, w: W * Math.pow(Math.sin(Math.PI * Math.pow(u, .75)), .85) * (1 - .15 * u)}); }
  strip(b, rows, (r, s) => [r.x, .006 + .02 * s * s * (r.w / W) + .014 * r.u * r.u, s * r.w], (r, s) => { const v = (.78 + .22 * (1 - Math.abs(s))) * (.88 + .12 * r.u); return [v, v, v]; });
  return b.done();
}
function petalGeo() {
  const b = Build(), N = 5, Ln = .052, W = .024, rows = [];
  for (let k = 0; k <= N; k++) { const u = k / N; rows.push({x: (u - .5) * Ln, u, w: W * Math.pow(Math.sin(Math.PI * Math.pow(u, .65)), .8)}); }
  strip(b, rows, (r, s) => [r.x, .004 + .011 * Math.pow(2 * r.u - 1, 2) + .012 * s * s * (r.w / W), s * r.w], (r, s) => { const v = (.8 + .2 * r.u) * (.9 + .1 * (1 - Math.abs(s))); return [v, v, v]; });
  return b.done();
}
function lilypadGeo() {
  const b = Build(), R = .17, N = 22, gap = .22, ang = i => gap / 2 + (i / N) * (6.2832 - gap);
  const P = (a, r) => [Math.cos(a) * R * r, .004 + .017 * Math.pow(r, 3), Math.sin(a) * R * r], C = (a, r) => { const v = (.8 + .2 * r) * (1 + .05 * Math.sin(a * 9)); return [v, v, v]; };
  for (let i = 0; i < N; i++) {
    const a = ang(i), a2 = ang(i + 1), m = .55;
    b.v(...P(a, 0), C(a, 0), 0, 1); b.v(...P(a, m), C(a, m), 0, 1); b.v(...P(a2, m), C(a2, m), 0, 1);
    b.v(...P(a, m), C(a, m), 0, 1); b.v(...P(a, 1), C(a, 1), 0, 1); b.v(...P(a2, 1), C(a2, 1), 0, 1);
    b.v(...P(a, m), C(a, m), 0, 1); b.v(...P(a2, 1), C(a2, 1), 0, 1); b.v(...P(a2, m), C(a2, m), 0, 1);
  }
  return b.done();
}
function lotusGeo() { // hoa sen / súng: ba vòng cánh (xoè → khum → khép) + đài nhuỵ vàng
  const b = Build(), Y0 = .008;
  const petal = (A, e, Lp, Wp, r0, cu, cin) => {
    const ax = [Math.cos(e) * Math.cos(A), Math.sin(e), Math.cos(e) * Math.sin(A)], la = [-Math.sin(A), 0, Math.cos(A)], inw = [-Math.cos(A), 0, -Math.sin(A)], rows = [];
    for (let k = 0; k <= 4; k++) { const u = k / 4; rows.push({u, w: Wp * Math.sin(Math.PI * Math.pow(Math.max(u, .001), .7)) * (1 - .2 * u), l: Lp * u}); }
    const pt = (r, s) => { const l2 = r.l * r.l / Lp; return [Math.cos(A) * r0 + ax[0] * r.l + la[0] * s * r.w + inw[0] * cin * l2, Y0 + ax[1] * r.l + cu * l2 + .012 * s * s * (r.w / Wp), Math.sin(A) * r0 + ax[2] * r.l + la[2] * s * r.w + inw[2] * cin * l2]; };
    strip(b, rows, pt, (r, s) => { const v = (.72 + .28 * r.u) * (.92 + .08 * (1 - Math.abs(s))); return [v, v, v]; });
  };
  const ring = (n, off, e, Lp, Wp, r0, cu, cin) => { for (let i = 0; i < n; i++) petal(off + i / n * 6.2832, e, Lp, Wp, r0, cu, cin); };
  ring(8, 0, .32, .13, .052, .03, .45, 0); ring(7, .4, .75, .115, .046, .02, .1, .12); ring(6, .2, 1.12, .09, .036, .012, 0, .22);
  const Rc = .03, yc = .05; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832, a2 = (i + 1) / 8 * 6.2832; b.v(0, yc + .008, 0, [1, .82, .16], 0, 0); b.v(Math.cos(a) * Rc, yc, Math.sin(a) * Rc, [.95, .7, .1], 0, 0); b.v(Math.cos(a2) * Rc, yc, Math.sin(a2) * Rc, [.95, .7, .1], 0, 0); }
  return b.done();
}
function reedGeo() { // bụi lau sậy: lá dài cong + vài bông dùi trống nâu
  const b = Build(), R = mul32(23), N = 10, SEG = 4, spikes = [];
  for (let i = 0; i < N; i++) {
    const a = R() * 6.283, r = Math.sqrt(R()) * .12, bx = Math.cos(a) * r, bz = Math.sin(a) * r, yaw = R() * 6.283, H = .75 + R() * .6, W = .016 + R() * .008, bend = .08 + R() * .28;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), px = -dz, pz = dx, rows = [];
    for (let k = 0; k <= SEG; k++) { const t = k / SEG, w = W * (1 - t * t * .9), off = bend * t * t, cx = bx + dx * off, cz = bz + dz * off; rows.push({L: [cx - px * w, H * t, cz - pz * w], R: [cx + px * w, H * t, cz + pz * w], t, c: [cx, H * t, cz]}); }
    for (let k = 0; k < SEG; k++) { const A = rows[k], B = rows[k + 1], c1 = .4 + .6 * A.t, c2 = .4 + .6 * B.t, v1 = [c1, c1, c1], v2 = [c2, c2, c2];
      b.v(...A.L, v1, A.t, 1); b.v(...A.R, v1, A.t, 1); b.v(...B.R, v2, B.t, 1); b.v(...A.L, v1, A.t, 1); b.v(...B.R, v2, B.t, 1); b.v(...B.L, v2, B.t, 1); }
    if (i < 2) spikes.push({p: rows[3].c, t: .75});
  }
  for (const sp of spikes) { const [cx, cy, cz] = sp.p, Rr = .017, Ls = .14, M = 6;
    for (let j = 0; j < M; j++) { const a = j / M * 6.2832, a2 = (j + 1) / M * 6.2832, p0 = [cx + Math.cos(a) * Rr, cy, cz + Math.sin(a) * Rr], p1 = [cx + Math.cos(a2) * Rr, cy, cz + Math.sin(a2) * Rr], q0 = [p0[0], cy + Ls, p0[2]], q1 = [p1[0], cy + Ls, p1[2]], br = [.36, .2, .1], tp = [.22, .12, .06];
      b.v(...p0, br, sp.t, 0); b.v(...p1, br, sp.t, 0); b.v(...q1, br, sp.t + .08, 0); b.v(...p0, br, sp.t, 0); b.v(...q1, br, sp.t + .08, 0); b.v(...q0, br, sp.t + .08, 0);
      b.v(cx, cy + Ls + .03, cz, tp, sp.t + .1, 0); b.v(...q0, tp, sp.t + .08, 0); b.v(...q1, tp, sp.t + .08, 0); }
  }
  return b.done();
}
function geoFor(kind) {
  switch (kind) {
    case 'grass': return grassGeo(); case 'flower': return flowerGeo(); case 'bush': return bushGeo();
    case 'rock': return rockGeo({r: .3, flat: .8, amp: .38, k: 2.1, detail: 1});
    case 'cobble': return rockGeo({r: .085, flat: .62, amp: .16, k: 2.5, detail: 2, smooth: true, bottomCut: .5});
    case 'pebble': return rockGeo({r: .03, flat: .6, amp: .18, k: 3, detail: 1, smooth: true, bottomCut: .5});
    case 'leaf': return leafGeo(); case 'petal': return petalGeo(); case 'lilypad': return lilypadGeo(); case 'lotus': return lotusGeo(); case 'reed': return reedGeo();
    case 'snow': return mountGeo(); case 'iceberg': return bergGeo(); case 'floe': return floeGeo();
  }
  return grassGeo();
}
/** Mô hình thư viện → các phần hình khối đã chuẩn hoá (cạnh lớn nhất = 1 m, đáy chạm y = 0, tâm ở giữa). */
function libParts(root) {
  root.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(root), sz = bx.getSize(new THREE.Vector3()), c = bx.getCenter(new THREE.Vector3()), mx = Math.max(sz.x, sz.y, sz.z);
  if (!isFinite(mx) || mx <= 0) throw Error('mô hình trống');
  const k = 1 / mx, norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -bx.min.y, -c.z)), parts = [];
  root.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const g = m.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, m.matrixWorld));
    const pos = g.attributes.position, sw = new Float32Array(pos.count), hd = new Float32Array(pos.count).fill(1);
    for (let i = 0; i < pos.count; i++) sw[i] = clamp(pos.getY(i), 0, 1);
    g.setAttribute('aSw', new THREE.BufferAttribute(sw, 1)); g.setAttribute('aHead', new THREE.BufferAttribute(hd, 1)); if (!g.attributes.normal) g.computeVertexNormals(); g.computeBoundingSphere();
    const ms = [].concat(m.material).map(x => x.clone()); parts.push({geo: g, mat: ms.length > 1 ? ms : ms[0]});
  });
  if (!parts.length) throw Error('mô hình không có hình khối');
  return parts;
}

/* ---------------- Vật liệu + shader vật lí (gió, đạp, rơi, nhấp nhô) ---------------- */
const VPARS = `
attribute float aSw; attribute float aHead;
uniform float uT,uAmp,uStiff,uBob,uDrop,uDropH,uBounce,uDelay,uPushK; uniform vec2 uWind; uniform vec4 uPush[8]; uniform int uPushN;
uniform float uTD,uDV,uWrap,uRock,uWK,uWDist,uWFar,uWCx,uPW,uPCurve,uIsW; uniform vec2 uDDir,uDC;
float wcxF(float z){return uWCx+(sin(z*.11)*2.2+sin(z*.04+1.)*3.)*uPCurve;}
float wsdV(vec2 p){   // khớp wsd() của env-kit
  if(uWK<.5){ float sh=-uWDist+3.*sin(p.x*.15)+1.5*sin(p.x*.41+2.), fs=-uWFar+6.*sin(p.x*.07+1.)+3.*sin(p.x*.23); return min(sh-p.y,p.y-fs); }
  if(uWK<2.5){ float w=uPW*(1.+.2*sin(p.y*.3)); return w-abs(p.x-wcxF(p.y)); }
  return -uWDist+2.2*sin(p.x*.12)+1.1*sin(p.x*.37+2.)-p.y;
}
float hsx(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float dropY(float tau){
  if(tau<0.) return uDropH;
  float g=9.8, T0=sqrt(2.*uDropH/g);
  if(tau<T0) return uDropH-.5*g*tau*tau;
  tau-=T0; float amp=uDropH;
  for(int n=0;n<6;n++){ amp*=uBounce*uBounce; float Tn=2.*sqrt(2.*max(amp,1e-5)/g); if(tau<Tn){ float u=tau-Tn*.5; return max(amp-.5*g*u*u,0.);} tau-=Tn; }
  return 0.;
}`;
const VCOLOR = `
#if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
  vColor = vec3(1.0);
  #ifdef USE_COLOR
    vColor *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor = mix(vColor, vColor * instanceColor.xyz, aHead);
  #endif
#endif`;
const VPROJ = `
vec4 mvPosition = vec4( transformed, 1.0 );
mvPosition = instanceMatrix * mvPosition;
{
  vec3 o = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
  float ph = hsx(o.xz*.37+3.1), hh = max(mvPosition.y - o.y, 0.), w2 = aSw*aSw;
  float tt = uT*(.9+.7*(1.-uStiff)) + ph*6.2831;
  vec2 sw = (vec2(sin(tt)+.4*sin(tt*2.3+1.), cos(tt*.83)+.4*sin(tt*1.9))*.22 + uWind*.18*(1.+.5*sin(tt*.6))) * uAmp * (1.-.75*uStiff);
  mvPosition.xz += sw*hh*w2; mvPosition.y -= dot(sw,sw)*hh*w2*w2*.5;
  for(int i=0;i<8;i++){ if(i>=uPushN) break; vec4 a=uPush[i]; vec2 dv=o.xz-a.xy; float dd=length(dv), f=smoothstep(a.z,0.,dd)*uPushK;
    vec2 dir=dv/max(dd,.001); mvPosition.xz += dir*f*hh*aSw*.9; mvPosition.y -= f*hh*aSw*.55; }
  if(uBob>0.){ vec2 rk=vec2(sin(uT*.55+ph*6.28),cos(uT*.47+ph*5.))*uBob*.07; mvPosition.xz += rk*hh; mvPosition.y += sin(uT*.8+ph*6.28)*uBob*.025*(1.+hh); }
  if(uRock>0.){ vec3 rel=mvPosition.xyz-o; float r1=sin(uT*1.1+ph*6.2831)*uRock, r2=cos(uT*.9+ph*5.1)*uRock; mvPosition.y += rel.x*r1+rel.z*r2; }   // bập bềnh nghiêng theo sóng
  if(uDV>0.){                                   // trôi theo dòng nước: cuộn vòng quanh vùng rải, thu nhỏ dần khi tới mép vùng / lên bờ
    vec2 dir=uDDir; float a=dot(o.xz-uDC,dir), a2=mod(a+uDV*uTD+uWrap*.5,uWrap)-uWrap*.5;
    vec2 np=o.xz+(a2-a)*dir;
    if(uIsW>.5&&uWK>.5&&uWK<2.5) np.x+=wcxF(np.y)-wcxF(o.z);                // sông / suối: trôi theo khúc uốn của dòng
    float kf=smoothstep(0.,uWrap*.06,uWrap*.5-abs(a2));
    if(uIsW>.5) kf*=smoothstep(.2,.7,wsdV(np));
    vec3 oc=vec3(np.x,o.y,np.y); mvPosition.xz += np-o.xz; mvPosition.xyz = oc+(mvPosition.xyz-oc)*kf;
  }
  if(uDrop>.5) mvPosition.y += dropY(uT - ph*uDelay);
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;
const mkUniforms = () => ({uT: {value: 0}, uAmp: {value: 0}, uStiff: {value: .5}, uBob: {value: 0}, uDrop: {value: 0}, uDropH: {value: 6}, uBounce: {value: .45}, uDelay: {value: 1.4}, uPushK: {value: 0}, uWind: {value: new THREE.Vector2()}, uPush: {value: Array.from({length: 8}, () => new THREE.Vector4())}, uPushN: {value: 0}, uTD: {value: 0}, uDV: {value: 0}, uWrap: {value: 60}, uRock: {value: 0}, uWK: {value: 0}, uWDist: {value: 24}, uWFar: {value: 70}, uWCx: {value: 6}, uPW: {value: 1}, uPCurve: {value: 1}, uIsW: {value: 0}, uDDir: {value: new THREE.Vector2(0, 1)}, uDC: {value: new THREE.Vector2()}});
function patch(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VPARS).replace('#include <color_vertex>', VCOLOR).replace('#include <project_vertex>', VPROJ);
  };
  mat.customProgramCacheKey = () => 'scatter-v2'; mat.needsUpdate = true;
}
function stdMat(kind) {
  const ice = kind === 'iceberg' || kind === 'floe', fl = kind === 'leaf' || kind === 'petal' || kind === 'lilypad' || kind === 'lotus';
  return new THREE.MeshStandardMaterial({vertexColors: true, roughness: ice ? .32 : fl ? .5 : kind === 'snow' ? .95 : .9, metalness: 0, side: THREE.DoubleSide, flatShading: kind === 'rock' || ice, emissive: ice ? new THREE.Color('#2a5a80') : new THREE.Color(0), emissiveIntensity: ice ? .12 : 0});
}

/* ---------------- Bộ máy ---------------- */
export function createScatter(scene) {
  const root = new THREE.Group(); root.name = 'env_scatter'; root.frustumCulled = false; scene.add(root);
  const recs = new Map(), pending = new Set(), dummy = new THREE.Object3D(), c1 = new THREE.Color(), c2 = new THREE.Color(), cc = new THREE.Color(), white = new THREE.Color(1, 1, 1);

  const drop = rec => { for (const m of rec.meshes || []) { m.removeFromParent(); m.dispose(); } rec.meshes = []; if (rec.parts) for (const p of rec.parts) { p.geo.dispose(); for (const m of [].concat(p.mat)) m.dispose(); } rec.parts = null; };

  function ensure(rec, n) {
    const need = Math.max(64, n);
    if (rec.meshes.length && rec.cap >= need) return;
    for (const m of rec.meshes) { m.removeFromParent(); m.dispose(); }
    rec.cap = Math.min(MAXN, Math.max(need, rec.cap ? rec.cap * 2 : 0));
    rec.meshes = rec.parts.map(p => { const m = new THREE.InstancedMesh(p.geo, p.mat, rec.cap); m.frustumCulled = false; m.count = 0; m.setColorAt(0, white); root.add(m); return m; });
  }

  function layout(rec, L, P) {
    const R = mul32(hstr(L.id) + (L.seed | 0) * 7919), ring = L.shape !== 'strip';
    const near = Math.min(L.near, L.far - .1), far = Math.max(L.far, .2), area = ring ? Math.PI * (far * far - near * near) : L.sw * L.sl;
    const K0 = LAYER_KINDS[L.kind] || LAYER_KINDS.grass, noFilter = !!(K0.f.drift && L.drift > 0 && L.where === 'water'), floating = !!K0.f.drift;   // vật trôi: rải khắp vùng, shader tự ẩn khi lên bờ
    const want = Math.max(0, Math.min(MAXN, Math.round(L.density * area / 100))); rec.capped = L.density * area / 100 > MAXN;
    let n = 0; const pts = [], tries = want * 24 + 300;
    const sample = () => ring ? (() => { const f = Math.pow(R(), 1 + L.falloff * 1.6), r = Math.sqrt(near * near + f * (far * far - near * near)), a = R() * 6.2832; return [L.cx + Math.cos(a) * r, L.cz + Math.sin(a) * r]; })() : [L.sx + (R() - .5) * L.sw, L.sz + (R() - .5) * L.sl];
    const nc = Math.max(1, Math.round(want / 25)), cl = Array.from({length: L.clump > 0 ? nc : 0}, sample), cr = (.8 + (L.size || 1) * .6);
    for (let i = 0; i < tries && n < want; i++) {
      let p; if (cl.length && R() < L.clump) { const q = cl[(R() * cl.length) | 0], a = R() * 6.2832, r = Math.abs(R() + R() + R() - 1.5) * cr * 1.6; p = [q[0] + Math.cos(a) * r, q[1] + Math.sin(a) * r]; } else p = sample();
      if (!noFilter && !okAt(L.where, p[0], p[1], P)) continue; pts.push(p); n++;
    }
    ensure(rec, n);
    c1.set(L.color); c2.set(L.color2 || L.color);
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i], s = Math.max(.02, L.size * (1 + (R() - .5) * 2 * L.sizeVar * .6)), tilt = (L.kind === 'rock' || L.kind === 'cobble' || L.kind === 'pebble') ? (R() - .5) * .5 : (L.kind === 'grass' || L.kind === 'flower') ? (R() - .5) * .22 : 0;
      const inW = (L.kind === 'rock' || L.kind === 'cobble' || L.kind === 'pebble') && groundInfo(x, z, P).water;
      dummy.position.set(x, floating ? .012 : inW ? -s * (L.kind === 'rock' ? .09 : .03) : 0, z); dummy.rotation.set(tilt, R() * 6.2832, tilt * (R() - .5) * 2); dummy.scale.set(s, s * (L.kind === 'grass' ? .8 + R() * .5 : 1), s); dummy.updateMatrix();
      const j = .92 + R() * .16;
      if (L.kind === 'lib') cc.copy(white).lerp(c1.set(L.color), L.tint).multiplyScalar(j); else cc.copy(c1).lerp(c2, R()).multiplyScalar(j);
      for (const m of rec.meshes) { m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, cc); }
    }
    for (const m of rec.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    rec.n = n; rec.sig = rec.nextSig;
  }

  return {
    group: root,
    update(list, P, t, ctx = {}) {
      root.visible = ctx.visible !== false;
      const ids = new Set();
      for (const L0 of list || []) {
        if (!L0 || L0.on === false) continue; const L = layerOf(L0), K = LAYER_KINDS[L.kind] || LAYER_KINDS.grass; ids.add(L.id);
        const sk = L.kind + '|' + (L.kind === 'lib' ? (L.src || '') + (L.ref || '') + (L.path || '') : '');
        let rec = recs.get(L.id);
        if (rec && rec.sk !== sk) { drop(rec); recs.delete(L.id); rec = null; }
        if (!rec) {
          rec = {sk, meshes: [], parts: null, sig: '', n: 0, U: mkUniforms(), cap: 0, err: '', loading: false}; recs.set(L.id, rec);
          if (L.kind === 'lib') {
            rec.loading = true;
            const pr = Promise.resolve().then(() => ctx.getModel && ctx.getModel(L)).then(o => { if (recs.get(L.id) !== rec) return; if (!o) throw Error('không đọc được mô hình'); rec.parts = libParts(o); for (const p of rec.parts) for (const m of [].concat(p.mat)) patch(m, rec.U); })
              .catch(e => { rec.err = e && e.message || String(e); }).finally(() => { rec.loading = false; pending.delete(pr); recs.get(L.id) === rec && (rec.sig = ''); ctx.refresh && ctx.refresh(); });
            pending.add(pr);
          } else { const g = geoFor(L.kind), m = stdMat(L.kind); patch(m, rec.U); rec.parts = [{geo: g, mat: m}]; }
        }
        if (!rec.parts) continue;
        const gs = [P.gnd, P.pw, P.pcurve, P.wdist, P.water, P.wk, P.wfar, P.wcx].join(',');
        rec.nextSig = JSON.stringify([L.kind, L.color, L.color2, L.tint, L.density, L.near, L.far, L.size, L.sizeVar, L.where, L.shape, L.cx, L.cz, L.sx, L.sz, L.sw, L.sl, L.clump, L.falloff, L.seed, !!(K.f.drift && L.drift > 0), gs]);
        if (rec.sig !== rec.nextSig) layout(rec, L, P);
        /* thông số sống: đổi mỗi khung hình, không dựng lại */
        const U = rec.U; U.uT.value = t;
        U.uTD.value = t * (P.speed ?? 1); U.uIsW.value = (P.gnd | 0) === 8 ? 1 : 0; U.uWK.value = P.wk || 0; U.uWDist.value = P.wdist; U.uWFar.value = P.wfar; U.uWCx.value = P.wcx; U.uPW.value = P.pw; U.uPCurve.value = P.pcurve;
        { const dr = K.f.drift && L.drift > 0, da = (L.ddir ?? 90) * Math.PI / 180, ringL = L.shape !== 'strip'; U.uDV.value = dr ? L.drift * .8 * (P.wflow ?? 1) : 0; U.uDDir.value.set(Math.cos(da), Math.sin(da)); U.uDC.value.set(ringL ? L.cx : L.sx, ringL ? L.cz : L.sz); U.uWrap.value = ringL ? Math.max(10, L.far * 2) : Math.max(10, L.sl, L.sw); U.uRock.value = K.f.drift ? .12 * L.bob : 0; }
        U.uAmp.value = K.f.sway ? L.wind : 0; U.uStiff.value = L.stiff; U.uBob.value = K.f.bob ? L.bob : 0;
        U.uDrop.value = L.drop ? 1 : 0; U.uDropH.value = L.dropH; U.uBounce.value = L.bounce;
        const w = ctx.wind || [0, 0]; U.uWind.value.set(w[0], w[1]);
        const ac = K.f.sway && L.push > 0 ? (ctx.actors || []).slice(0, 8) : []; U.uPushN.value = ac.length; U.uPushK.value = L.push;
        ac.forEach((a, i) => U.uPush.value[i].set(a.x, a.z, L.pushr + (a.r || .3), 0));
      }
      for (const [id, rec] of recs) if (!ids.has(id)) { drop(rec); recs.delete(id); }
    },
    stats() { const o = {}; for (const [id, r] of recs) o[id] = {n: r.n, err: r.err, loading: r.loading, capped: !!r.capped}; return o; },
    settle() { return Promise.all([...pending]); },
    dispose() { for (const r of recs.values()) drop(r); recs.clear(); root.removeFromParent(); }
  };
}
