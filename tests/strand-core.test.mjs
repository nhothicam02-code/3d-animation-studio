// Chạy: node tests/strand-core.test.mjs
import assert from 'node:assert/strict';
import {STRAND_K as K, fitStrand, makeStrand, setStiffness, resetStrand, refreshLen, substep, strandQuats, deformPoint} from '../js/strand-core.js';

const near = (a, b, e, m) => assert.ok(Math.abs(a - b) < e, (m || '') + ' ' + a + ' vs ' + b);

// ống dọc theo -y từ gốc xuống 0.5 m
function tube(len = 0.5, r = 0.03, ox = 0, oy = 0, oz = 0, dir = [0, -1, 0]) {
  const pts = [];
  for (let i = 0; i <= 60; i++) for (let j = 0; j < 12; j++) {
    const s = len * i / 60, a = j / 12 * Math.PI * 2, px = r * Math.cos(a), pz = r * Math.sin(a);
    pts.push(ox + dir[0] * s + px, oy + dir[1] * s, oz + dir[2] * s + pz);
  }
  return new Float32Array(pts);
}

// 1) dựng trục + chọn đầu gốc theo xương
{
  const p = tube(), n = p.length / 3;
  let f = fitStrand(p, n, {x: 0, y: 0.05, z: 0});
  near(f.dir[1], -1, 1e-3, 'dir.y'); near(f.L, 0.5, 2e-3, 'L'); near(f.rest[1], 0, 6e-3, 'rest0'); near(f.rest[3 * (K - 1) + 1], -0.5, 6e-3, 'restTip');
  assert.ok(f.aspect > 5, 'aspect ống dài');
  f = fitStrand(p, n, {x: 0, y: -0.6, z: 0});   // xương ở phía đầu kia → trục đảo
  near(f.dir[1], 1, 1e-3, 'dir đảo'); near(f.rest[1], -0.5, 6e-3, 'rest0 đảo');
  f = fitStrand(p, n, {x: 0, y: 0.05, z: 0}, K, true);   // flip thủ công
  near(f.dir[1], 1, 1e-3, 'flip');
  // mesh tròn (mũ tóc) → aspect thấp
  const sph = []; for (let i = 0; i < 2000; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u); sph.push(0.1 * r * Math.cos(a), 0.1 * u, 0.1 * r * Math.sin(a)); }
  assert.ok(fitStrand(new Float32Array(sph), 2000, {x: 0, y: 0, z: 0}).aspect < 1.25, 'cầu thì aspect thấp');
  assert.equal(fitStrand(new Float32Array(0), 0, {x: 0, y: 0, z: 0}), null);
}

// 2) uốn: khi chuỗi xoay cứng quanh gốc thì đỉnh phải xoay cứng theo (phần xa gốc); nghỉ thì giữ nguyên
{
  const p = tube(), n = p.length / 3, fit = fitStrand(p, n, {x: 0, y: 0.05, z: 0});
  const q = new Float64Array(4 * K), cur = new Float64Array(3 * K), a = 30 * Math.PI / 180;
  strandQuats(fit.rest, fit.rest, K, q);
  for (let i = 0; i < K; i++) near(q[4 * i + 3], 1, 1e-9, 'nghỉ → quaternion đơn vị');
  const out = [0, 0, 0];
  for (let k = 0; k < 50; k++) { const pt = [p[3 * k * 13], p[3 * k * 13 + 1], p[3 * k * 13 + 2]]; deformPoint(fit, fit.rest, q, K, pt, out); near(out[0], pt[0], 1e-9, 'nghỉ x'); near(out[1], pt[1], 1e-9, 'nghỉ y'); }
  // xoay quanh trục z qua hạt 0
  const R = v => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
  const r0 = [fit.rest[0], fit.rest[1], fit.rest[2]];
  for (let i = 0; i < K; i++) { const v = R([fit.rest[3 * i] - r0[0], fit.rest[3 * i + 1] - r0[1], fit.rest[3 * i + 2] - r0[2]]); cur[3 * i] = r0[0] + v[0]; cur[3 * i + 1] = r0[1] + v[1]; cur[3 * i + 2] = r0[2] + v[2]; }
  strandQuats(fit.rest, cur, K, q);
  near(q[3], 1, 1e-9, 'hạt gốc không xoay'); assert.ok(q[4 * 1 + 3] < 1 && q[4 * 1 + 3] > Math.cos(a / 2) - 1e-9, 'hạt 1 xoay một phần');
  let worst = 0, cnt = 0;
  for (let k = 0; k < p.length / 3; k += 2) {
    const pt = [p[3 * k], p[3 * k + 1], p[3 * k + 2]], u = -pt[1] / fit.L;
    if (u < 0.45) continue;   // vùng gốc được giảm xoay có chủ đích
    deformPoint(fit, cur, q, K, pt, out);
    const e = R([pt[0] - r0[0], pt[1] - r0[1], pt[2] - r0[2]]);
    worst = Math.max(worst, Math.hypot(out[0] - (r0[0] + e[0]), out[1] - (r0[1] + e[1]), out[2] - (r0[2] + e[2]))); cnt++;
  }
  assert.ok(cnt > 100 && worst < 5e-3, 'uốn ≈ xoay cứng, sai số tối đa ' + worst);
}

// 3) mô phỏng
const T0 = i => [0, -0.05 * i, 0];
function mk(stiff = 0.3) { const s = makeStrand(K); setStiffness(s, stiff); for (let i = 0; i < K; i++) { const t = T0(i); s.T.set(t, 3 * i); } refreshLen(s); resetStrand(s); return s; }
const O = (extra = {}) => ({g: 9.8 * 0.6 / 3600, drag: 0.06, reach: 0.5, caps: null, margin: 0, sway: null, ...extra});
const segErr = s => { let m = 0; for (let i = 0; i < K - 1; i++) m = Math.max(m, Math.abs(Math.hypot(s.P[3 * i + 3] - s.P[3 * i], s.P[3 * i + 4] - s.P[3 * i + 1], s.P[3 * i + 5] - s.P[3 * i + 2]) - s.len[i])); return m; };
{
  // đứng yên: chỉ võng nhẹ vì trọng lực, đoạn giữ độ dài
  const s = mk(); for (let k = 0; k < 600; k++) substep(s, O());
  assert.ok(segErr(s) < 2e-3, 'độ dài đoạn ' + segErr(s));
  const sag = Math.hypot(s.P[3 * (K - 1)] - s.T[3 * (K - 1)], s.P[3 * (K - 1) + 1] - s.T[3 * (K - 1) + 1], s.P[3 * (K - 1) + 2] - s.T[3 * (K - 1) + 2]);
  assert.ok(sag < 0.05, 'võng ' + sag);
  // gốc chạy sang ngang: ngọn phải trễ rồi đuổi kịp
  const tip = i => s.P[3 * (K - 1) + i];
  let maxLag = 0;
  for (let k = 0; k < 90; k++) { const dx = Math.min(k, 30) * 0.01; for (let i = 0; i < K; i++) s.T[3 * i] = T0(i)[0] + dx; refreshLen(s); substep(s, O()); maxLag = Math.max(maxLag, s.T[3 * (K - 1)] - tip(0)); }
  assert.ok(maxLag > 0.03, 'ngọn phải trễ khi gốc chạy, lag=' + maxLag);
  for (let k = 0; k < 300; k++) substep(s, O());
  near(tip(0), 0.3, 0.03, 'ngọn đuổi kịp');
  assert.ok(Number.isFinite(tip(1)) && segErr(s) < 3e-3, 'không NaN / độ dài ổn định');
  // reach
  const s2 = mk(0); for (let k = 0; k < 40; k++) { for (let i = 0; i < K; i++) s2.T[3 * i] = k * 0.05; refreshLen(s2); substep(s2, O({reach: 0.1})); }
  for (let i = 1; i < K; i++) assert.ok(Math.hypot(s2.P[3 * i] - s2.T[3 * i], s2.P[3 * i + 1] - s2.T[3 * i + 1], s2.P[3 * i + 2] - s2.T[3 * i + 2]) <= 0.1 + 1e-9, 'reach hạt ' + i);
  // vẫy: có biên độ, đối xứng quanh dáng gốc
  const s3 = mk(0.3); let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 600; k++) { substep(s3, O({sway: {amp: 0.012, dir: [1, 0, 0], ph: 2 * Math.PI * 1.3 * k / 60, lag: 0.55}})); if (k > 120) { const x = s3.P[3 * (K - 1)]; lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  assert.ok(hi > 0.03 && lo < -0.03 && Math.abs(hi + lo) < 0.5 * (hi - lo), 'vẫy hai phía lo=' + lo + ' hi=' + hi);
  // va chạm: capsule thẳng đứng chắn đường quét ngang
  const s4 = mk(0.1), cap = {a: {x: 0.2, y: -0.6, z: 0}, b: {x: 0.2, y: 0.2, z: 0}, rw: 0.06};
  for (let k = 0; k < 200; k++) { for (let i = 0; i < K; i++) s4.T[3 * i] = Math.min(k, 100) * 0.006; refreshLen(s4); substep(s4, O({caps: [cap], reach: 1})); }
  for (let i = 1; i < K; i++) { if (Math.abs(s4.T[3 * i] - 0.2) < 1) { const d = Math.hypot(s4.P[3 * i] - 0.2, s4.P[3 * i + 2]); assert.ok(d > 0.06 - 5e-3 || s4.T[3 * i] > 0.2, 'xuyên capsule hạt ' + i + ' d=' + d); } }
}
console.log('strand-core: tất cả kiểm thử đạt');
