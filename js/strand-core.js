/**
 * Lõi mô phỏng TÓC / ĐUÔI / DẢI: một chuỗi K hạt (Verlet) chạy dọc theo trục dài của mesh.
 * File này thuần toán học (không import three.js) nên chạy được cả trong Node để kiểm thử.
 *
 * Quy ước: vector là Float64Array phẳng [x0,y0,z0, x1,y1,z1, …]; điểm / capsule dùng {x,y,z}.
 *
 * Luồng dùng (xem StrandChain trong cloth-physics.js):
 *   1) fitStrand(điểm đỉnh trong không gian `center`, vị trí xương gắn) → trục + K điểm tâm lúc nghỉ (rest)
 *   2) mỗi khung: gán S.T (mục tiêu thế giới) → refreshLen → substep × n → đổi sang không gian center
 *   3) strandQuats(rest, cur) → góc xoay từng hạt; shader dùng (rest, cur, quat) để uốn mesh (deformPoint là bản JS của shader)
 */
export const STRAND_K = 10;
export const STRAND_H = 1 / 60;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/* ---------------- 1) Dựng đường tâm của mesh ---------------- */
/**
 * @param pts    Float32Array|Float64Array phẳng xyz (không gian center)
 * @param n      số điểm
 * @param anchor {x,y,z} vị trí xương gắn trong không gian center — đầu gần xương hơn là GỐC (hạt 0, ghim cứng)
 * @param flip   true = đảo đầu gốc
 * @returns {O:[x,y,z], dir:[x,y,z], L, rest:Float64Array(3K), aspect} hoặc null nếu mesh rỗng / suy biến
 *   aspect = chiều dài / đường kính trung bình: nhỏ (< ~1.25) nghĩa là mảnh gần tròn (mũ tóc ôm đầu, pompom) → không đáng mô phỏng.
 */
export function fitStrand(pts, n, anchor, K = STRAND_K, flip = false) {
  if (!n) return null;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pts[3 * i]; my += pts[3 * i + 1]; mz += pts[3 * i + 2]; }
  mx /= n; my /= n; mz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[3 * i] - mx, dy = pts[3 * i + 1] - my, dz = pts[3 * i + 2] - mz;
    xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }
  // trục chính (PCA) bằng power iteration; khởi đầu hơi lệch hướng "xuống" để kết quả ổn định
  let ax = 0.01, ay = -1, az = 0.02;
  for (let it = 0; it < 40; it++) {
    const nx = xx * ax + xy * ay + xz * az, ny = xy * ax + yy * ay + yz * az, nz = xz * ax + yz * ay + zz * az;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-18) break;
    ax = nx / l; ay = ny / l; az = nz / l;
  }
  const l0 = Math.hypot(ax, ay, az); ax /= l0; ay /= l0; az /= l0;
  let smin = Infinity, smax = -Infinity, rad2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[3 * i] - mx, dy = pts[3 * i + 1] - my, dz = pts[3 * i + 2] - mz, s = dx * ax + dy * ay + dz * az;
    if (s < smin) smin = s; if (s > smax) smax = s;
    rad2 += dx * dx + dy * dy + dz * dz - s * s;
  }
  let L = smax - smin;
  if (!(L > 1e-4)) return null;
  // gốc = đầu gần xương gắn hơn
  const tA = (anchor.x - mx) * ax + (anchor.y - my) * ay + (anchor.z - mz) * az;
  let rootIsLow = Math.abs(tA - smin) <= Math.abs(tA - smax);
  if (flip) rootIsLow = !rootIsLow;
  if (!rootIsLow) { ax = -ax; ay = -ay; az = -az; const t = smin; smin = -smax; smax = -t; }
  const O = [mx + ax * smin, my + ay * smin, mz + az * smin];
  // đường tâm: trung bình có trọng số "hình mũ" quanh từng hạt
  const sum = new Float64Array(3 * K), w = new Float64Array(K);
  for (let i = 0; i < n; i++) {
    const px = pts[3 * i], py = pts[3 * i + 1], pz = pts[3 * i + 2];
    const u = clamp(((px - O[0]) * ax + (py - O[1]) * ay + (pz - O[2]) * az) / L, 0, 1), f = u * (K - 1);
    const i0 = Math.min(Math.floor(f), K - 2), t = f - i0;
    sum[3 * i0] += px * (1 - t); sum[3 * i0 + 1] += py * (1 - t); sum[3 * i0 + 2] += pz * (1 - t); w[i0] += 1 - t;
    const i1 = i0 + 1;
    sum[3 * i1] += px * t; sum[3 * i1 + 1] += py * t; sum[3 * i1 + 2] += pz * t; w[i1] += t;
  }
  const rest = new Float64Array(3 * K);
  for (let i = 0; i < K; i++) {
    const s = L * i / (K - 1);   // vị trí dọc trục của hạt i là cố định; chỉ lấy độ lệch NGANG từ trọng tâm (tránh lệch ở hai đầu vì trọng số một phía)
    let cx = O[0] + ax * s, cy = O[1] + ay * s, cz = O[2] + az * s;
    if (w[i] > 1e-9) {
      const gx = sum[3 * i] / w[i], gy = sum[3 * i + 1] / w[i], gz = sum[3 * i + 2] / w[i], ga = (gx - O[0]) * ax + (gy - O[1]) * ay + (gz - O[2]) * az;
      cx = gx + ax * (s - ga); cy = gy + ay * (s - ga); cz = gz + az * (s - ga);
    }
    rest[3 * i] = cx; rest[3 * i + 1] = cy; rest[3 * i + 2] = cz;
  }
  return {O, dir: [ax, ay, az], L, rest, aspect: L / (2 * Math.sqrt(rad2 / n) + 1e-9)};
}

/* ---------------- 2) Mô phỏng ---------------- */
export function makeStrand(K = STRAND_K) {
  return {K, P: new Float64Array(3 * K), Q: new Float64Array(3 * K), T: new Float64Array(3 * K), k: new Float64Array(K), len: new Float64Array(K - 1)};
}
/** Lò xo kéo về dáng gốc: sát gốc cứng, ngọn mềm. stiff ∈ [0,1]. */
export function setStiffness(s, stiff) {
  const K = s.K, st = clamp(stiff, 0, 1), kRoot = 0.12 + 0.5 * st, kTip = 0.01 + 0.18 * st;
  s.k[0] = 1;
  for (let i = 1; i < K; i++) s.k[i] = kRoot + (kTip - kRoot) * (i - 1) / Math.max(K - 2, 1);
}
export function resetStrand(s) { s.P.set(s.T); s.Q.set(s.T); }
/** Độ dài từng đoạn lấy theo mục tiêu hiện tại (mesh cứng → độ dài không đổi). */
export function refreshLen(s) {
  const {K, T, len} = s;
  for (let i = 0; i < K - 1; i++) len[i] = Math.hypot(T[3 * i + 3] - T[3 * i], T[3 * i + 4] - T[3 * i + 1], T[3 * i + 5] - T[3 * i + 2]);
}
function constrain(P, a, b, L, wa, wb) {
  const ia = 3 * a, ib = 3 * b, dx = P[ib] - P[ia], dy = P[ib + 1] - P[ia + 1], dz = P[ib + 2] - P[ia + 2], len = Math.hypot(dx, dy, dz), w = wa + wb;
  if (len < 1e-12 || !w) return;
  const f = (len - L) / len;
  P[ia] += dx * f * wa / w; P[ia + 1] += dy * f * wa / w; P[ia + 2] += dz * f * wa / w;
  P[ib] -= dx * f * wb / w; P[ib + 1] -= dy * f * wb / w; P[ib + 2] -= dz * f * wb / w;
}
const _c = [0, 0, 0];
function closest(c, px, py, pz, out) {
  const ax = c.a.x, ay = c.a.y, az = c.a.z, bx = c.b.x - ax, by = c.b.y - ay, bz = c.b.z - az, l2 = bx * bx + by * by + bz * bz;
  const t = l2 > 1e-12 ? clamp(((px - ax) * bx + (py - ay) * by + (pz - az) * bz) / l2, 0, 1) : 0;
  out[0] = ax + bx * t; out[1] = ay + by * t; out[2] = az + bz * t;
}
/** Đẩy hạt i ra khỏi các capsule {a,b,rw}. Nếu vị trí đích (rest) đã nằm trong capsule thì bỏ qua capsule đó (đồ ôm sát cơ thể). */
function pushOut(s, i, caps, margin) {
  const {P, T} = s, o = 3 * i;
  for (const c of caps) {
    const r = c.rw + margin;
    closest(c, T[o], T[o + 1], T[o + 2], _c);
    if (Math.hypot(T[o] - _c[0], T[o + 1] - _c[1], T[o + 2] - _c[2]) < r * 1.02) continue;
    closest(c, P[o], P[o + 1], P[o + 2], _c);
    let dx = P[o] - _c[0], dy = P[o + 1] - _c[1], dz = P[o + 2] - _c[2], len = Math.hypot(dx, dy, dz);
    if (len < r) {
      if (len < 1e-7) { dx = P[o] - T[o]; dy = P[o + 1] - T[o + 1]; dz = P[o + 2] - T[o + 2]; len = Math.hypot(dx, dy, dz); if (len < 1e-7) { dx = 0; dy = 0; dz = 1; len = 1; } }
      P[o] = _c[0] + dx / len * r; P[o + 1] = _c[1] + dy / len * r; P[o + 2] = _c[2] + dz / len * r;
    }
  }
}
/**
 * Một bước con (1/60 s). o = {
 *   g: độ rơi mỗi bước (đơn vị thế giới), drag: 0..0.9, reach: biên độ tối đa ở ngọn (đơn vị thế giới),
 *   caps: [{a,b,rw}] | null, margin,
 *   sway: null | {amp, dir:[x,y,z], ph, lag}  — lực ngang theo sin (vẫy đuôi / tóc bay nhẹ)
 * }
 */
export function substep(s, o) {
  const {K, P, Q, T, k, len} = s, keep = 1 - o.drag, sw = o.sway && o.sway.amp ? o.sway : null;
  for (let i = 1; i < K; i++) {
    const b = 3 * i, vx = (P[b] - Q[b]) * keep, vy = (P[b + 1] - Q[b + 1]) * keep, vz = (P[b + 2] - Q[b + 2]) * keep;
    Q[b] = P[b]; Q[b + 1] = P[b + 1]; Q[b + 2] = P[b + 2];
    P[b] += vx; P[b + 1] += vy - o.g; P[b + 2] += vz;
    if (sw) { const f = sw.amp * Math.sin(sw.ph - i * sw.lag) * (i / (K - 1)); P[b] += sw.dir[0] * f; P[b + 1] += sw.dir[1] * f; P[b + 2] += sw.dir[2] * f; }
    P[b] += (T[b] - P[b]) * k[i]; P[b + 1] += (T[b + 1] - P[b + 1]) * k[i]; P[b + 2] += (T[b + 2] - P[b + 2]) * k[i];
  }
  const pin = () => { for (let j = 0; j < 3; j++) { P[j] = T[j]; Q[j] = T[j]; } };
  pin();
  const rods = n => { for (let it = 0; it < n; it++) for (let i = 0; i < K - 1; i++) constrain(P, i, i + 1, len[i], i === 0 ? 0 : 1, 1); };
  rods(6);
  if (o.caps && o.caps.length) { for (let i = 1; i < K; i++) pushOut(s, i, o.caps, o.margin || 0); rods(3); }
  for (let i = 1; i < K; i++) {   // biên độ tối đa: nhỏ ở gốc, lớn dần về ngọn
    const b = 3 * i, lim = o.reach * (0.3 + 0.7 * i / (K - 1)), dx = P[b] - T[b], dy = P[b + 1] - T[b + 1], dz = P[b + 2] - T[b + 2], l = Math.hypot(dx, dy, dz);
    if (l > lim) { const f = lim / l; P[b] = T[b] + dx * f; P[b + 1] = T[b + 1] + dy * f; P[b + 2] = T[b + 2] + dz * f; }
  }
  pin();
}

/* ---------------- 3) Góc xoay từng hạt + bản JS của shader ---------------- */
function unitArc(out, o, ax, ay, az, bx, by, bz) {   // quaternion xoay ngắn nhất a → b (a, b đã chuẩn hoá)
  const d = ax * bx + ay * by + az * bz;
  let x, y, z, w;
  if (d < -0.999999) {   // ngược hướng: xoay 180° quanh một trục vuông góc
    if (Math.abs(ax) < 0.9) { x = 0; y = az; z = -ay; } else { x = -az; y = 0; z = ax; }
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l; w = 0;
  } else {
    x = ay * bz - az * by; y = az * bx - ax * bz; z = ax * by - ay * bx; w = 1 + d;
    const l = Math.hypot(x, y, z, w); x /= l; y /= l; z /= l; w /= l;
  }
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
}
const unit = (out, x, y, z) => { const l = Math.hypot(x, y, z) || 1; out[0] = x / l; out[1] = y / l; out[2] = z / l; };
/**
 * quats[4i..] = xoay từ hướng tiếp tuyến lúc nghỉ → hướng hiện tại tại hạt i (cả hai trong không gian center).
 * Gần gốc xoay được giảm dần về 0 để phần mũ tóc / chỗ buộc không bị bong khỏi đầu.
 */
export function strandQuats(rest, cur, K, quats) {
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let i = 0; i < K; i++) {
    const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, K - 1);
    unit(a, rest[3 * i1] - rest[3 * i0], rest[3 * i1 + 1] - rest[3 * i0 + 1], rest[3 * i1 + 2] - rest[3 * i0 + 2]);
    unit(b, cur[3 * i1] - cur[3 * i0], cur[3 * i1 + 1] - cur[3 * i0 + 1], cur[3 * i1 + 2] - cur[3 * i0 + 2]);
    unitArc(quats, 4 * i, a[0], a[1], a[2], b[0], b[1], b[2]);
    const m = clamp(i / (0.25 * (K - 1)), 0, 1), o = 4 * i;   // nlerp với quaternion đơn vị
    const x = quats[o] * m, y = quats[o + 1] * m, z = quats[o + 2] * m, w = 1 - m + quats[o + 3] * m, l = Math.hypot(x, y, z, w);
    quats[o] = x / l; quats[o + 1] = y / l; quats[o + 2] = z / l; quats[o + 3] = w / l;
  }
}
function qrot(q, v, out) {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  out[0] = v[0] + q[3] * tx + (q[1] * tz - q[2] * ty); out[1] = v[1] + q[3] * ty + (q[2] * tx - q[0] * tz); out[2] = v[2] + q[3] * tz + (q[0] * ty - q[1] * tx);
}
/** Bản JS của strandDisp trong shader: đỉnh p (không gian center) → vị trí sau khi uốn theo chuỗi hạt. */
export function deformPoint(fit, cur, quats, K, p, out = [0, 0, 0]) {
  const {O, dir, L, rest} = fit;
  const u = clamp(((p[0] - O[0]) * dir[0] + (p[1] - O[1]) * dir[1] + (p[2] - O[2]) * dir[2]) / L, 0, 1), f = u * (K - 1);
  const i0 = Math.min(Math.floor(f), K - 2), t = f - i0, i1 = i0 + 1;
  const c = [0, 0, 0], pc = [0, 0, 0], q = [0, 0, 0, 0], r = [0, 0, 0];
  for (let j = 0; j < 3; j++) { c[j] = rest[3 * i0 + j] * (1 - t) + rest[3 * i1 + j] * t; pc[j] = cur[3 * i0 + j] * (1 - t) + cur[3 * i1 + j] * t; }
  for (let j = 0; j < 4; j++) q[j] = quats[4 * i0 + j] * (1 - t) + quats[4 * i1 + j] * t;
  const ql = Math.hypot(q[0], q[1], q[2], q[3]); for (let j = 0; j < 4; j++) q[j] /= ql;
  qrot(q, [p[0] - c[0], p[1] - c[1], p[2] - c[2]], r);
  out[0] = pc[0] + r[0]; out[1] = pc[1] + r[1]; out[2] = pc[2] + r[2];
  return out;
}
