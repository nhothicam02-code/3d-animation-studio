import * as THREE from 'three';
import {STRAND_K, makeStrand, setStiffness, resetStrand, refreshLen, substep, strandQuats, fitStrand} from './strand-core.js';

/**
 * Vật lý vải / tóc / đuôi cho đồ mặc (chạy trên CPU, rất nhẹ, hiển thị bằng vertex shader):
 *  - Đồ CỨNG (không skin: váy, áo choàng, khăn, mũ…): lưới hạt hình trụ 16×6 bám vào eo/khớp, mô phỏng Verlet
 *    (lò xo về dáng gốc + ràng buộc khoảng cách + va chạm chân/hông). Độ lệch của các hạt được nội suy lên toàn bộ
 *    đỉnh của mesh trong vertex shader → mesh triệu đỉnh vẫn mượt.
 *  - Đồ SKIN có xương riêng (vạt váy, dây, đuôi áo…): spring-bone (kiểu VRM) trên chính các xương đó.
 *  - Đồ SKIN không có xương riêng: chưa có gì để mô phỏng (cần thêm xương vạt trong Blender).
 *  - TÓC / ĐUÔI / DẢI (danh mục hair, tail hoặc chọn kiểu "Chuỗi"): đồ CỨNG được uốn theo một chuỗi 10 hạt chạy dọc trục dài của mesh
 *    (gốc ghim vào xương, ngọn mềm dần, giữ độ dài, va chạm đầu/thân/tay/chân, có thể vẫy tự nhiên). Vertex shader xoay + dời từng đỉnh
 *    theo hạt gần nó nên mesh nặng vẫn mượt. Đồ SKIN có xương riêng dùng spring-bone, ngọn mềm hơn gốc.
 * Gọi stepPhysics(dt) mỗi khung hình (sau khi cập nhật animation, trước khi render).
 */
export const CLOTH_N = 16, CLOTH_M = 6;
export const PHYS_DEFAULT = {on: false, stiff: 0.4, weight: 1, drag: 0.12, reach: 0.3, collide: true};
/** Mặc định cho tóc / đuôi / dải: mềm hơn, cản ít hơn, biên độ lớn hơn; sway = vẫy / bay nhẹ tự nhiên (0 = tắt); flip = đảo đầu gốc. */
export const PHYS_STRAND_DEFAULT = {on: false, stiff: 0.3, weight: 1, drag: 0.06, reach: 0.5, collide: true, sway: 0, flip: false};
export const STRAND_SLOTS = new Set(['hair', 'tail']);
const SWAY_HZ = {tail: 1.3, hair: 0.7};
/** Kiểu mô phỏng của một bộ: 'strand' (tóc, đuôi, dải) hoặc 'cloth' (váy, áo choàng). group.phys.mode = 'auto' | 'cloth' | 'strand'. */
export function resolveMode(group) {
  const m = group && group.phys && group.phys.mode;
  if (m === 'cloth' || m === 'strand') return m;
  return group && STRAND_SLOTS.has(group.slot) ? 'strand' : 'cloth';
}
export const physDefaults = group => (resolveMode(group) === 'strand' ? PHYS_STRAND_DEFAULT : PHYS_DEFAULT);

const H = 1 / 60, MAX_STEPS = 4, TELEPORT = 0.35;   // bước cố định; quá TELEPORT mét/khung = nhảy cảnh → thả lại
const ACTIVE = new Set();
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const params = p => ({...PHYS_DEFAULT, ...(p || {})});
const V = () => new THREE.Vector3();

/* ---------------- tiện ích dùng chung ---------------- */
function unitsPerMeter(rig) {
  const h = rig.bone('head'), f = rig.bone('lFoot') || rig.bone('rFoot');
  if (!h || !f) return 1;
  const a = V().setFromMatrixPosition(h.matrixWorld), b = V().setFromMatrixPosition(f.matrixWorld);
  const d = a.distanceTo(b);
  return d > 1e-4 ? d / 1.5 : 1;   // đầu ↔ cổ chân ≈ 1,5 m
}
/** Hình trụ va chạm (capsule) bám theo xương: đùi, cẳng chân, hông. Bán kính tính bằng mét. */
const COLLIDERS = [['lUp', 'lLeg', 0.095], ['lLeg', 'lFoot', 0.06], ['rUp', 'rLeg', 0.095], ['rLeg', 'rFoot', 0.06], ['hips', 'spine', 0.14]];
/** Tóc / đuôi cần thêm đầu, cổ, thân và tay để không xuyên vào người. */
const STRAND_COLLIDERS = [['hips', 'spine', 0.14], ['spine', 'spine1', 0.14], ['spine1', 'spine2', 0.145], ['spine2', 'neck', 0.15], ['neck', 'head', 0.06], ['head', 'headTop', 0.1],
  ['lArm', 'lFore', 0.05], ['rArm', 'rFore', 0.05], ['lUp', 'lLeg', 0.095], ['lLeg', 'lFoot', 0.06], ['rUp', 'rLeg', 0.095], ['rLeg', 'rFoot', 0.06]];
function makeColliders(rig, defs = COLLIDERS) {
  const out = [];
  for (const [a, b, r] of defs) { const A = rig.bone(a), B = rig.bone(b); if (A && B) out.push({A, B, r, a: V(), b: V(), rw: r}); }
  return out;
}
function updateColliders(list, uPM) {
  for (const c of list) { c.a.setFromMatrixPosition(c.A.matrixWorld); c.b.setFromMatrixPosition(c.B.matrixWorld); c.rw = c.r * uPM; }
}
const _ab = V(), _c = V(), _d = V();
function closest(cap, p, out) {
  _ab.subVectors(cap.b, cap.a);
  const l2 = _ab.lengthSq(), t = l2 > 1e-12 ? clamp(_d.subVectors(p, cap.a).dot(_ab) / l2, 0, 1) : 0;
  return out.copy(cap.a).addScaledVector(_ab, t);
}
/** Đẩy điểm p ra khỏi các capsule. Nếu chính vị trí đích (rest) đã nằm trong capsule thì bỏ qua capsule đó (đồ ôm sát). */
function pushOut(p, target, caps, margin) {
  for (const c of caps) {
    const r = c.rw + margin;
    if (closest(c, target, _c).distanceTo(target) < r * 1.02) continue;
    closest(c, p, _c);
    _d.subVectors(p, _c);
    const len = _d.length();
    if (len < r) { if (len < 1e-7) _d.subVectors(p, target); if (_d.lengthSq() < 1e-14) _d.set(0, 0, 1); p.copy(_c).addScaledVector(_d.normalize(), r); }
  }
}

/* ---------------- 1) Lưới hạt cho đồ cứng ---------------- */
const GLSL_DECL = `
#define CLOTH_N ${CLOTH_N}
#define CLOTH_M ${CLOTH_M}
uniform mat4 uCenterW;
uniform mat4 uCenterInv;
uniform vec4 uGrid;
uniform vec3 uOff[${CLOTH_N * CLOTH_M}];
vec3 clothDisp(vec3 p) {
  vec3 g = (uCenterInv * modelMatrix * vec4(p, 1.0)).xyz;
  float h = clamp((uGrid.w - g.y) / max(uGrid.w - uGrid.z, 1e-5), 0.0, 1.0);
  float rf = h * float(CLOTH_M - 1);
  int r0 = int(min(floor(rf), float(CLOTH_M - 2)));
  float fr = rf - float(r0);
  float ang = atan(g.z - uGrid.y, g.x - uGrid.x);
  float cf = (ang + 3.14159265) / 6.28318531 * float(CLOTH_N);
  int c0 = int(floor(cf));
  float fc = cf - float(c0);
  c0 = c0 - (c0 / CLOTH_N) * CLOTH_N;
  int c1 = c0 + 1; c1 = c1 - (c1 / CLOTH_N) * CLOTH_N;
  vec3 a = mix(uOff[r0 * CLOTH_N + c0], uOff[r0 * CLOTH_N + c1], fc);
  vec3 b = mix(uOff[(r0 + 1) * CLOTH_N + c0], uOff[(r0 + 1) * CLOTH_N + c1], fc);
  vec3 w = (uCenterW * vec4(mix(a, b, fr), 0.0)).xyz;
  return inverse(mat3(modelMatrix)) * w;
}
`;

class ClothGrid {
  constructor(rt, rig) {
    this.kind = 'grid'; this.rt = rt; this.rig = rig; this.p = params();
    this.meshes = [];
    rt.content.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && o.geometry && o.geometry.attributes.position) this.meshes.push({mesh: o, rel: new THREE.Matrix4(), sig: ''}); });
    if (!this.meshes.length) { this.ok = false; return; }
    const n = CLOTH_N * CLOTH_M;
    this.off = Array.from({length: n}, V);
    this.U = {uCenterW: {value: new THREE.Matrix4()}, uCenterInv: {value: new THREE.Matrix4()}, uGrid: {value: new THREE.Vector4(0, 0, 0, 1)}, uOff: {value: this.off}};
    this.rest = Array.from({length: n}, V); this.P = Array.from({length: n}, V); this.Q = Array.from({length: n}, V); this.T = Array.from({length: n}, V);
    this.k = new Array(CLOTH_M).fill(0); this.caps = makeColliders(rig);
    this.acc = 0; this.fresh = true; this.anchor = V(); this.ready = false; this.dirtyAt = 0; this.ok = true;
    this.relUpdate(true);
    this.scan();
    this.install();
  }
  setParams(p) {
    this.p = params(p);
    const kb = 0.12 + 0.6 * clamp(this.p.stiff, 0, 1);
    for (let j = 1; j < CLOTH_M; j++) this.k[j] = kb * (1 - 0.8 * (j - 1) / (CLOTH_M - 2));
  }
  /** Ma trận mesh → không gian `center` (tính theo chuỗi node cục bộ, không phụ thuộc xương). Trả về true nếu đổi. */
  relUpdate(force) {
    let changed = false;
    for (const e of this.meshes) {
      const m = new THREE.Matrix4();
      for (let o = e.mesh; o && o !== this.rt.center; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
      const sig = m.elements.map(x => x.toPrecision(6)).join(',');
      if (sig !== e.sig) { e.sig = sig; e.rel.copy(m); changed = true; }
    }
    return changed || !!force;
  }
  /** Quét đỉnh (lấy mẫu ≤ 80k) → hộp bao + bán kính theo (góc, hàng) để dựng lưới hạt. */
  scan() {
    const N = CLOTH_N, M = CLOTH_M, v = V();
    const lo = V().set(Infinity, Infinity, Infinity), hi = V().set(-Infinity, -Infinity, -Infinity);
    const each = fn => {
      for (const {mesh, rel} of this.meshes) {
        const pos = mesh.geometry.attributes.position, st = Math.max(1, Math.floor(pos.count / 80000));
        for (let i = 0; i < pos.count; i += st) { v.fromBufferAttribute(pos, i).applyMatrix4(rel); fn(v); }
      }
    };
    each(p => { lo.min(p); hi.max(p); });
    if (!Number.isFinite(lo.x) || hi.y - lo.y < 1e-6) { this.ready = false; return; }
    const cx = (lo.x + hi.x) / 2, cz = (lo.z + hi.z) / 2, yMax = hi.y, yMin = lo.y, hgt = yMax - yMin;
    const R = new Float32Array(N * M);
    each(p => {
      const h = clamp((yMax - p.y) / hgt, 0, 1), j = Math.round(h * (M - 1));
      const ang = Math.atan2(p.z - cz, p.x - cx), i = Math.round(((ang + Math.PI) / (2 * Math.PI)) * N) % N;
      const r = Math.hypot(p.x - cx, p.z - cz), idx = j * N + i;
      if (r > R[idx]) R[idx] = r;
    });
    const fallback = Math.max(hi.x - lo.x, hi.z - lo.z) / 2;
    let prevAvg = fallback;
    for (let j = 0; j < M; j++) {
      let s = 0, c = 0; for (let i = 0; i < N; i++) if (R[j * N + i] > 0) { s += R[j * N + i]; c++; }
      const avg = c ? s / c : prevAvg; prevAvg = avg;
      for (let i = 0; i < N; i++) if (!(R[j * N + i] > 0)) R[j * N + i] = avg;
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const ang = -Math.PI + i * 2 * Math.PI / N, r = Math.max(R[j * N + i], 1e-3);
      this.rest[j * N + i].set(cx + r * Math.cos(ang), yMax - j * hgt / (M - 1), cz + r * Math.sin(ang));
    }
    this.U.uGrid.value.set(cx, cz, yMin, yMax);
    this.ready = true; this.fresh = true; this.setParams(this.p);
  }
  install() {
    const U = this.U, seen = new Set();   // vật liệu có thể dùng chung giữa nhiều mesh: chỉ gắn shader một lần
    this.saved = [];
    for (const e of this.meshes) {
      const mesh = e.mesh, mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const prevR = Object.prototype.hasOwnProperty.call(mesh, 'onBeforeRender') ? mesh.onBeforeRender : null;
      mesh.onBeforeRender = (...a) => {
        U.uCenterW.value.copy(this.rt.center.matrixWorld);
        U.uCenterInv.value.copy(this.rt.center.matrixWorld).invert();
        if (prevR) prevR(...a);
      };
      this.saved.push({kind: 'mesh', o: mesh, prevR});
      for (const m of mats) {
        if (!m || seen.has(m)) continue; seen.add(m);
        const sv = {kind: 'mat', o: m, own: Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile'), obc: m.onBeforeCompile, ownK: Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey'), key: m.customProgramCacheKey};
        this.saved.push(sv);
        m.onBeforeCompile = (shader, r) => {
          if (sv.obc) sv.obc.call(m, shader, r);
          Object.assign(shader.uniforms, U);
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + GLSL_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += clothDisp(position);');
        };
        m.customProgramCacheKey = () => 'clothgrid' + CLOTH_N + 'x' + CLOTH_M;
        m.needsUpdate = true;
      }
    }
  }
  alive() { let o = this.rt.holder; while (o.parent) o = o.parent; return !!o.isScene; }
  reset() { this.fresh = true; }
  step(dt) {
    if (!this.ok) return;
    const now = performance.now();
    if (this.relUpdate()) this.dirtyAt = now || 1;
    if (this.dirtyAt && now - this.dirtyAt > 250) { this.dirtyAt = 0; this.scan(); }
    if (!this.ready) return;
    const N = CLOTH_N, M = CLOTH_M, {rest, P, Q, T, rt, p} = this;
    const cw = rt.center.matrixWorld, uPM = unitsPerMeter(this.rig);
    for (let i = 0; i < N * M; i++) T[i].copy(rest[i]).applyMatrix4(cw);
    // nhảy cảnh (kéo thanh thời gian, đổi cảnh…) → đặt lại thay vì kéo vải bay theo
    if (!this.fresh && this.anchor.distanceTo(T[0]) > TELEPORT * uPM) this.fresh = true;
    this.anchor.copy(T[0]);
    if (this.fresh) { for (let i = 0; i < N * M; i++) { P[i].copy(T[i]); Q[i].copy(T[i]); } this.fresh = false; this.acc = 0; }
    else {
      this.acc += dt;
      const n = Math.min(MAX_STEPS, Math.floor(this.acc / H)); this.acc = n === MAX_STEPS ? 0 : this.acc - n * H;
      if (n) { if (p.collide) updateColliders(this.caps, uPM); for (let s = 0; s < n; s++) this.sub(uPM); }
    }
    // độ lệch (thế giới) → không gian center → uniform cho shader
    const inv = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(cw).invert());
    for (let i = 0; i < N; i++) this.off[i].set(0, 0, 0);
    for (let i = N; i < N * M; i++) this.off[i].subVectors(P[i], T[i]).applyMatrix3(inv);
  }
  sub(uPM) {
    const N = CLOTH_N, M = CLOTH_M, {P, Q, T, k, p, caps} = this;
    const g = 9.8 * uPM * clamp(p.weight, 0, 4) * 0.6 * H * H, drag = clamp(p.drag, 0, 0.9), maxR = Math.max(p.reach, 0.02) * uPM;
    for (let j = 1; j < M; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i, a = P[idx], q = Q[idx];
      const vx = (a.x - q.x) * (1 - drag), vy = (a.y - q.y) * (1 - drag), vz = (a.z - q.z) * (1 - drag);
      q.copy(a); a.x += vx; a.y += vy - g; a.z += vz;
      a.lerp(T[idx], k[j]);   // lò xo kéo về dáng gốc: đáy mềm hơn, sát eo cứng hơn
    }
    for (let i = 0; i < N; i++) { P[i].copy(T[i]); Q[i].copy(T[i]); }   // hàng trên cùng ghim vào eo
    for (let it = 0; it < 3; it++) {
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
        this.link(j * N + i, j * N + (i + 1) % N);                // vòng ngang
        if (j < M - 1) this.link(j * N + i, (j + 1) * N + i);     // dọc
      }
    }
    for (let j = 1; j < M; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i, a = P[idx];
      if (p.collide && caps.length) pushOut(a, T[idx], caps, 0.012 * uPM);
      _d.subVectors(a, T[idx]); const l = _d.length();   // biên độ tối đa
      if (l > maxR) a.copy(T[idx]).addScaledVector(_d, maxR / l);
    }
  }
  /** Ràng buộc không giãn quá 4% độ dài gốc (độ dài gốc lấy theo vị trí đích hiện tại). */
  link(a, b) {
    const {P, T} = this, A = P[a], B = P[b];
    const L = T[a].distanceTo(T[b]) * 1.04;
    _d.subVectors(B, A); const len = _d.length();
    if (len <= L || len < 1e-9) return;
    const wa = a < CLOTH_N ? 0 : 1, wb = b < CLOTH_N ? 0 : 1, s = wa + wb;
    if (!s) return;
    const f = (len - L) / len * 0.8;
    A.addScaledVector(_d, f * wa / s); B.addScaledVector(_d, -f * wb / s);
  }
  dispose() {
    ACTIVE.delete(this);
    for (const s of this.saved || []) {
      if (s.kind === 'mesh') { if (s.prevR) s.o.onBeforeRender = s.prevR; else delete s.o.onBeforeRender; }
      else {
        if (s.own) s.o.onBeforeCompile = s.obc; else delete s.o.onBeforeCompile;
        if (s.ownK) s.o.customProgramCacheKey = s.key; else delete s.o.customProgramCacheKey;
        s.o.needsUpdate = true;
      }
    }
    this.saved = [];
  }
}

/* ---------------- 1b) Chuỗi hạt cho TÓC / ĐUÔI / DẢI (đồ cứng) ---------------- */
const SK = STRAND_K;
const STRAND_DECL = `
#define STR_K ${SK}
uniform mat4 uCenterW;
uniform mat4 uCenterInv;
uniform vec4 uOrigin;
uniform vec3 uDir;
uniform vec3 uRest[STR_K];
uniform vec3 uCur[STR_K];
uniform vec4 uQ[STR_K];
vec3 strandRot(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
vec3 strandDisp(vec3 p) {
  vec3 g = (uCenterInv * modelMatrix * vec4(p, 1.0)).xyz;
  float u = clamp(dot(g - uOrigin.xyz, uDir) * uOrigin.w, 0.0, 1.0);
  float f = u * float(STR_K - 1);
  int i0 = int(min(floor(f), float(STR_K - 2)));
  float t = f - float(i0);
  vec3 c = mix(uRest[i0], uRest[i0 + 1], t);
  vec3 pc = mix(uCur[i0], uCur[i0 + 1], t);
  vec4 q = normalize(mix(uQ[i0], uQ[i0 + 1], t));
  vec3 w = (uCenterW * vec4(pc + strandRot(q, g - c) - g, 0.0)).xyz;
  return inverse(mat3(modelMatrix)) * w;
}
`;
const _sv = V(), _sInv = new THREE.Matrix4(), _sSide = V();
class StrandChain {
  constructor(rt, rig, hz = 0.9) {
    this.kind = 'strand'; this.rt = rt; this.rig = rig; this.hz = hz; this.p = {...PHYS_STRAND_DEFAULT};
    this.meshes = [];
    rt.content.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && o.geometry && o.geometry.attributes.position) this.meshes.push({mesh: o, rel: new THREE.Matrix4(), sig: ''}); });
    if (!this.meshes.length) { this.ok = false; return; }
    this.S = makeStrand(SK); this.cur = new Float64Array(3 * SK); this.quats = new Float64Array(4 * SK);
    this.U = {
      uCenterW: {value: new THREE.Matrix4()}, uCenterInv: {value: new THREE.Matrix4()}, uOrigin: {value: new THREE.Vector4(0, 0, 0, 1)}, uDir: {value: new THREE.Vector3(0, -1, 0)},
      uRest: {value: Array.from({length: SK}, V)}, uCur: {value: Array.from({length: SK}, V)}, uQ: {value: Array.from({length: SK}, () => new THREE.Vector4(0, 0, 0, 1))}
    };
    this.caps = makeColliders(rig, STRAND_COLLIDERS);
    this.o = {g: 0, drag: 0, reach: 0, caps: null, margin: 0, sway: {amp: 0, dir: [1, 0, 0], ph: 0, lag: 0.55}};
    this.acc = 0; this.time = 0; this.fresh = true; this.anchor = V(); this.ready = false; this.compact = false; this.dirtyAt = 0; this.flip = false; this.ok = true;
    this.relUpdate(true);
    this.scan();
    this.install();
  }
  setParams(p) {
    this.p = {...PHYS_STRAND_DEFAULT, ...(p || {})};
    setStiffness(this.S, this.p.stiff);
    if (!!this.p.flip !== this.flip) { this.flip = !!this.p.flip; if (this.ok) this.scan(); }
  }
  relUpdate(force) {   // ma trận mesh → không gian center (giống ClothGrid)
    let changed = false;
    for (const e of this.meshes) {
      const m = new THREE.Matrix4();
      for (let o = e.mesh; o && o !== this.rt.center; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
      const sig = m.elements.map(x => x.toPrecision(6)).join(',');
      if (sig !== e.sig) { e.sig = sig; e.rel.copy(m); changed = true; }
    }
    return changed || !!force;
  }
  /** Lấy mẫu đỉnh (≤ 60k) → fitStrand → trục, đường tâm lúc nghỉ, uniform cho shader. */
  scan() {
    let total = 0; for (const {mesh} of this.meshes) total += mesh.geometry.attributes.position.count;
    const st = Math.max(1, Math.floor(total / 60000)), arr = new Float32Array(3 * Math.ceil(total / st) + 3), v = V();
    let n = 0;
    for (const {mesh, rel} of this.meshes) {
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += st) { v.fromBufferAttribute(pos, i).applyMatrix4(rel); arr[3 * n] = v.x; arr[3 * n + 1] = v.y; arr[3 * n + 2] = v.z; n++; }
    }
    const cp = this.rt.center.position;   // xương gắn nằm ở −center.position trong không gian center
    const fit = fitStrand(arr, n, {x: -cp.x, y: -cp.y, z: -cp.z}, SK, this.flip);
    this.compact = !!fit && fit.aspect < 1.25;   // mảnh gần tròn (mũ tóc ôm đầu, pompom): uốn dọc trục chẳng có nghĩa
    if (!fit || this.compact) { this.ready = false; return; }
    this.fit = fit;
    const U = this.U;
    U.uOrigin.value.set(fit.O[0], fit.O[1], fit.O[2], 1 / fit.L); U.uDir.value.set(fit.dir[0], fit.dir[1], fit.dir[2]);
    for (let i = 0; i < SK; i++) { U.uRest.value[i].set(fit.rest[3 * i], fit.rest[3 * i + 1], fit.rest[3 * i + 2]); U.uCur.value[i].copy(U.uRest.value[i]); U.uQ.value[i].set(0, 0, 0, 1); }
    this.ready = true; this.fresh = true; this.setParamsKeep();
  }
  setParamsKeep() { setStiffness(this.S, this.p.stiff); }
  install() {   // gắn shader vào vật liệu (giống ClothGrid, khác hàm uốn)
    const U = this.U, seen = new Set();
    this.saved = [];
    for (const e of this.meshes) {
      const mesh = e.mesh, mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const prevR = Object.prototype.hasOwnProperty.call(mesh, 'onBeforeRender') ? mesh.onBeforeRender : null;
      mesh.onBeforeRender = (...a) => {
        U.uCenterW.value.copy(this.rt.center.matrixWorld);
        U.uCenterInv.value.copy(this.rt.center.matrixWorld).invert();
        if (prevR) prevR(...a);
      };
      this.saved.push({kind: 'mesh', o: mesh, prevR});
      for (const m of mats) {
        if (!m || seen.has(m)) continue; seen.add(m);
        const sv = {kind: 'mat', o: m, own: Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile'), obc: m.onBeforeCompile, ownK: Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey'), key: m.customProgramCacheKey};
        this.saved.push(sv);
        m.onBeforeCompile = (shader, r) => {
          if (sv.obc) sv.obc.call(m, shader, r);
          Object.assign(shader.uniforms, U);
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + STRAND_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += strandDisp(position);');
        };
        m.customProgramCacheKey = () => 'strandchain' + SK;
        m.needsUpdate = true;
      }
    }
  }
  alive() { let o = this.rt.holder; while (o.parent) o = o.parent; return !!o.isScene; }
  reset() { this.fresh = true; this.time = 0; }
  step(dt) {
    if (!this.ok) return;
    const now = performance.now();
    if (this.relUpdate()) this.dirtyAt = now || 1;
    if (this.dirtyAt && now - this.dirtyAt > 250) { this.dirtyAt = 0; this.scan(); }
    if (!this.ready) return;
    const S = this.S, {T, P} = S, rest = this.fit.rest, cw = this.rt.center.matrixWorld, uPM = unitsPerMeter(this.rig), p = this.p;
    for (let i = 0; i < SK; i++) { _sv.set(rest[3 * i], rest[3 * i + 1], rest[3 * i + 2]).applyMatrix4(cw); T[3 * i] = _sv.x; T[3 * i + 1] = _sv.y; T[3 * i + 2] = _sv.z; }
    _sv.set(T[0], T[1], T[2]);
    if (!this.fresh && this.anchor.distanceTo(_sv) > TELEPORT * uPM) this.fresh = true;   // nhảy cảnh → thả lại
    this.anchor.copy(_sv);
    if (this.fresh) { resetStrand(S); this.fresh = false; this.acc = 0; }
    else {
      this.acc += dt;
      const n = Math.min(MAX_STEPS, Math.floor(this.acc / H)); this.acc = n === MAX_STEPS ? 0 : this.acc - n * H;
      if (n) {
        if (p.collide) updateColliders(this.caps, uPM);
        refreshLen(S);
        const o = this.o, sw = o.sway;
        o.g = 9.8 * uPM * clamp(p.weight, 0, 4) * 0.6 * H * H; o.drag = clamp(p.drag, 0, 0.9); o.reach = Math.max(p.reach, 0.02) * uPM;
        o.caps = p.collide ? this.caps : null; o.margin = 0.012 * uPM;
        sw.amp = clamp(p.sway, 0, 1) * 0.012 * uPM;
        if (sw.amp) { _sSide.setFromMatrixColumn(cw, 0).normalize(); sw.dir[0] = _sSide.x; sw.dir[1] = _sSide.y; sw.dir[2] = _sSide.z; }
        for (let k = 0; k < n; k++) { this.time += H; sw.ph = 2 * Math.PI * this.hz * this.time; substep(S, o); }
        if (!Number.isFinite(P[3 * SK - 1] + P[0])) { resetStrand(S); this.time = 0; }
      }
    }
    // vị trí hạt (thế giới) → không gian center → uniform cho shader
    _sInv.copy(cw).invert();
    for (let i = 0; i < SK; i++) {
      _sv.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).applyMatrix4(_sInv);
      this.cur[3 * i] = _sv.x; this.cur[3 * i + 1] = _sv.y; this.cur[3 * i + 2] = _sv.z;
      this.U.uCur.value[i].copy(_sv);
    }
    strandQuats(rest, this.cur, SK, this.quats);
    for (let i = 0; i < SK; i++) this.U.uQ.value[i].set(this.quats[4 * i], this.quats[4 * i + 1], this.quats[4 * i + 2], this.quats[4 * i + 3]);
  }
  dispose() {
    ACTIVE.delete(this);
    for (const s of this.saved || []) {
      if (s.kind === 'mesh') { if (s.prevR) s.o.onBeforeRender = s.prevR; else delete s.o.onBeforeRender; }
      else {
        if (s.own) s.o.onBeforeCompile = s.obc; else delete s.o.onBeforeCompile;
        if (s.ownK) s.o.customProgramCacheKey = s.key; else delete s.o.customProgramCacheKey;
        s.o.needsUpdate = true;
      }
    }
    this.saved = [];
  }
}

/* ---------------- 2) Spring-bone cho xương riêng của đồ skin ---------------- */
class SpringBones {
  /** strand = true (tóc, đuôi, dải): ngọn mềm hơn gốc, thêm va chạm đầu/thân/tay và vẫy tự nhiên. */
  constructor(rt, rig, strand = false, hz = 0.9) {
    this.kind = 'bones'; this.rt = rt; this.rig = rig; this.p = params(); this.strand = strand; this.hz = hz; this.time = 0; this.side = V().set(1, 0, 0);
    this.caps = makeColliders(rig, strand ? STRAND_COLLIDERS : COLLIDERS);
    this.acc = 0; this.ok = true;
    const ex = rt.extra || [];
    const depthOf = b => { let d = 0; for (let o = b.parent; o && ex.includes(o); o = o.parent) d++; return d; };
    const maxD = Math.max(1, ...ex.map(depthOf));
    this.joints = ex.map(b => {
      const child = ex.find(c => c.parent === b), restQ = b.quaternion.clone();
      let tail;
      if (child && child.position.lengthSq() > 1e-12) tail = child.position.clone();
      else {   // xương cuối: kéo dài theo hướng từ xương cha tới nó
        const dir = b.position.lengthSq() > 1e-12 ? b.position.clone().normalize() : V().set(0, -1, 0);
        tail = dir.applyQuaternion(restQ.clone().invert()).multiplyScalar(Math.max(b.position.length(), 1e-3));
      }
      const depth = depthOf(b);
      return {b, restQ, tail, cur: V(), prev: V(), len: 0, init: false, depth, f: depth / maxD};
    });
    this.fresh = true;
  }
  setParams(p) { this.p = params(p); }
  alive() { let o = this.rt.holder; while (o.parent) o = o.parent; return !!o.isScene; }
  reset() { this.fresh = true; }
  step(dt) {
    if (!this.joints.length) return;
    const uPM = unitsPerMeter(this.rig), p = this.p;
    if (this.fresh) { for (const j of this.joints) { j.b.quaternion.copy(j.restQ); j.b.updateMatrixWorld(true); j.init = false; } this.fresh = false; this.acc = 0; }
    this.acc += dt;
    const n = Math.min(MAX_STEPS, Math.floor(this.acc / H)); this.acc = n === MAX_STEPS ? 0 : this.acc - n * H;
    const steps = Math.max(n, this.joints.some(j => !j.init) ? 1 : 0);
    if (!steps) return;
    if (p.collide) updateColliders(this.caps, uPM);
    if (this.strand) { this.time += n * H; this.side.setFromMatrixColumn(this.rig.model.matrixWorld, 0).normalize(); }
    for (let s = 0; s < steps; s++) for (const j of this.joints) this.joint(j, uPM, s < n);
  }
  joint(j, uPM, simulate) {
    const b = j.b, par = b.parent, p = this.p;
    if (!par) return;
    const pq = new THREE.Quaternion(), ps = V(), pp = V();
    par.matrixWorld.decompose(pp, pq, ps);
    const head = V().setFromMatrixPosition(b.matrixWorld);
    const rest = j.tail.clone().applyQuaternion(j.restQ).applyQuaternion(pq);   // hướng đuôi ở pose gốc (thế giới)
    const restLen = rest.length();
    rest.normalize();
    if (!j.init) { j.len = restLen * ps.x; j.cur.copy(head).addScaledVector(rest, j.len); j.prev.copy(j.cur); j.init = true; }
    if (!simulate) return;
    const stiffN = (0.3 + 3 * clamp(p.stiff, 0, 1)) * H * uPM * 0.5 * (this.strand ? 1 - 0.65 * j.f : 1), grav = 0.15 * clamp(p.weight, 0, 4) * H * uPM * 0.5;
    const drag = clamp(p.drag, 0, 0.9), next = V();
    next.copy(j.cur).addScaledVector(V().subVectors(j.cur, j.prev), 1 - drag).addScaledVector(rest, stiffN);
    next.y -= grav;
    if (this.strand && p.sway > 0) next.addScaledVector(this.side, clamp(p.sway, 0, 1) * 0.5 * stiffN * Math.sin(2 * Math.PI * this.hz * this.time - j.depth * 0.6));   // vẫy: lực ngang theo sin, tỉ lệ với độ cứng nên góc vẫy ~ 25° ở sway = 100%
    const fix = () => { _d.subVectors(next, head); if (_d.lengthSq() < 1e-14) _d.copy(rest); next.copy(head).addScaledVector(_d.normalize(), j.len); };
    fix();
    if (p.collide && this.caps.length) { pushOut(next, V().copy(head).addScaledVector(rest, j.len), this.caps, 0.01 * uPM); fix(); }
    j.prev.copy(j.cur); j.cur.copy(next);
    // áp góc quay: xoay hướng đuôi pose gốc → hướng mới (trong không gian xương cha)
    const dirP = V().subVectors(next, head).normalize().applyQuaternion(pq.clone().invert());
    const restP = j.tail.clone().normalize().applyQuaternion(j.restQ);
    b.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(restP, dirP)).multiply(j.restQ);
    b.updateMatrixWorld(true);
  }
  dispose() {
    ACTIVE.delete(this);
    for (const j of this.joints) { j.b.quaternion.copy(j.restQ); j.b.updateMatrixWorld(true); }
  }
}

/* ---------------- API ---------------- */
function create(rt, rig, group) {
  if (!rt || !rig) return null;
  const strand = resolveMode(group) === 'strand', hz = SWAY_HZ[group && group.slot] || 0.9;
  if (rt.skinned) return (rt.extra && rt.extra.length) ? new SpringBones(rt, rig, strand, hz) : null;
  const o = strand ? new StrandChain(rt, rig, hz) : new ClothGrid(rt, rig);
  return o.ok ? o : null;
}
/** Bật/tắt/cập nhật vật lý cho một piece theo group.phys. Gọi từ applyPiece. */
export function syncPhysics(group, piece) {
  const rt = piece._rt;
  if (!rt) return;
  const want = !!(group.phys && group.phys.on);
  if (!want) { if (rt.phys) { rt.phys.dispose(); rt.phys = null; } return; }
  const mode = resolveMode(group);
  if (rt.phys && rt.phys.mode !== mode) { rt.phys.dispose(); rt.phys = null; }   // đổi kiểu mô phỏng → dựng lại
  if (!rt.phys) { rt.phys = create(rt, rt.rig, group); if (rt.phys) { rt.phys.mode = mode; ACTIVE.add(rt.phys); } }
  if (rt.phys) rt.phys.setParams({...physDefaults(group), ...group.phys});
}
export function disposePhysics(rt) { if (rt && rt.phys) { rt.phys.dispose(); rt.phys = null; } }
/** Mô tả cho giao diện: cách mô phỏng của các mảnh trong bộ (grid = lưới vải, strand = chuỗi tóc/đuôi, bones = xương riêng, compact = mảnh quá tròn/ngắn nên đứng yên). */
export function physInfo(group) {
  const info = {grid: 0, strand: 0, bones: 0, none: 0, boneCount: 0, compact: 0}, strand = resolveMode(group) === 'strand';
  for (const p of group.pieces || []) {
    const rt = p._rt; if (!rt) continue;
    if (!rt.skinned) { if (strand) { info.strand++; if (rt.phys && rt.phys.compact) info.compact++; } else info.grid++; }
    else if (rt.extra && rt.extra.length) { info.bones++; info.boneCount += rt.extra.length; }
    else info.none++;
  }
  return info;
}
/** Thả lại vải (đặt về dáng gốc) cho mọi mảnh của bộ. */
export function resetPhysics(group) { for (const p of group.pieces || []) if (p._rt && p._rt.phys) p._rt.phys.reset(); }
/** Mỗi khung hình: dt = giây trôi qua (0 khi tạm dừng — vẫn cập nhật hiển thị theo tư thế hiện tại). */
export function stepPhysics(dt = 0) {
  dt = clamp(dt || 0, 0, 0.1);
  const models = new Set();
  for (const s of [...ACTIVE]) { if (!s.alive()) { s.dispose(); continue; } if (s.rt.holder.visible) models.add(s.rig.model); }
  for (const m of models) m.updateWorldMatrix(true, true);
  for (const s of ACTIVE) if (s.rt.holder.visible) s.step(dt);
}
