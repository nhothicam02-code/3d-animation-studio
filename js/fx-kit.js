import * as THREE from 'three';

/* ============================================================
   Hiệu ứng phim (FX) cho Studio.
   ------------------------------------------------------------
   Mỗi hiệu ứng là một khối `{type:'fx', fx:'<id>', start, dur, …}` trên timeline.
   Mọi thứ được tính từ thời gian t (KHÔNG giữ trạng thái mô phỏng) → tua / xuất video
   cho kết quả giống hệt lúc xem trực tiếp.

   Ba loại (theo cách chạy):
   • space  : hiệu ứng trong không gian 3D (mưa, tuyết, lửa, nổ, sét, đá rơi, sương, mây…)
              có vị trí / xoay / scale X Y Z + gizmo (giống mô hình).
   • camera : rung lắc, đung đưa, lia, dolly, orbit, zoom, nghiêng — tác động lên camera.
   • screen : vẽ lên toàn khung. Gồm 2 tầng, luôn theo thứ tự:
       1) hậu kỳ (post: glow / distort) — chạy lên cả nền + nhân vật, bởi env-kit.render
       2) lớp phủ (vignette, nhiễu hạt, chớp, viền đen, phủ màu) — vẽ SAU hậu kỳ nên không bị méo / nhòe.

   Quy ước: Nền (env-kit) = địa điểm, mỗi cảnh một cái. Hiệu ứng (file này) = thứ xảy ra trong địa điểm,
   nhiều khối, có start / dur / hiện dần / tắt dần. Sương mù, mờ ảo, biến dạng không khí… đều ở đây
   và dùng được với mọi loại nền (màu, gradient, ảnh, video, môi trường 3D, ảnh 360°).

   API chính:
     const eng = createFxEngine(scene, camera)
     eng.sync(items)            // tạo / xoá runtime theo danh sách item fx của cảnh
     eng.update(items, t, ctx)  // mỗi khung hình (ctx = {view:{w,h}, exporting}); cập nhật eng.post + scene.fog
   eng.post                   // {amp, type, glow, speed, t} → đưa cho env.update để chạy hậu kỳ
   eng.overlay(renderer)      // vẽ lớp phủ màn hình SAU hậu kỳ (env.render gọi giúp)
     eng.camBegin(items, t, target) / eng.camEnd()   // bao quanh renderer.render
     eng.clear() / eng.dispose()
   ============================================================ */

export const FX_GROUPS = [['weather', 'Thời tiết & hạt'], ['air', 'Không khí & ánh sáng'], ['fire', 'Lửa · nổ · sét · đá'], ['camera', 'Camera'], ['screen', 'Màn hình (điện ảnh)']];
/** Thứ tự kiểu biến dạng — phải khớp POST_FS trong env-kit.js (heat 0, wave 1, ripple 2, lens 3). */
export const DISTORT_KINDS = [['heat', 'Hơi nóng (gợn dọc)'], ['wave', 'Sóng nước'], ['ripple', 'Gợn tròn'], ['lens', 'Méo ống kính']];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const sstep = (a, b, x) => { const u = clamp((x - a) / ((b - a) || 1e-9), 0, 1); return u * u * (3 - 2 * u); };
/** Số hoá giá trị tuỳ chọn: undefined / null / '' / NaN → mặc định (khác `+v ?? d`, vốn cho NaN). */
export const nz = (v, d) => { if (v === undefined || v === null || v === '') return d; const n = +v; return Number.isFinite(n) ? n : d; };

/* ---------------- Số ngẫu nhiên có hạt giống ---------------- */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash01 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** Nhiễu 1D mượt, giá trị −1..1, cố định theo seed. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash01(i + seed * 17.13), hash01(i + 1 + seed * 17.13), u) * 2 - 1;
}
const fbm1 = (x, seed) => noise1(x, seed) * .6 + noise1(x * 2.3 + 7.1, seed + 3) * .3 + noise1(x * 5.1 + 3.3, seed + 9) * .1;

/* ---------------- Danh mục hiệu ứng ----------------
   ps = tham số riêng: [khoá, nhãn, kiểu, …]
     'r' thanh trượt [.., min, max, step, mặc định]   'n' số [.., min, max, step, mặc định]
     'c' màu [.., mặc định]   'b' bật/tắt [.., mặc định]   's' lựa chọn [.., [[giá trị,nhãn],…], mặc định]
   Mọi hiệu ứng đều có: intensity (cường độ), speed (tốc độ), fi / fo (hiện dần / tắt dần), seed. */
const EASE = [['smooth', 'Mượt'], ['lin', 'Đều'], ['in', 'Chậm → nhanh'], ['out', 'Nhanh → chậm']];
const HOLD = ['b', 'hold', 'Giữ nguyên vị trí cuối sau khi kết thúc'];
export const FX = {
  /* ---- thiên nhiên ---- */
  rain: {g: 'weather', ic: '🌧', name: 'Mưa', box: [14, 10, 14], pos: [0, 5, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#bcd2ff'}, ps: [['len', 'Độ dài vệt mưa', 'r', .1, 1.5, .01, .55], ['slant', 'Độ xiên (m / s)', 'r', -6, 6, .1, 0], ['thick', 'Độ dày giọt', 'r', .2, 3, .05, 1]]},
  snow: {g: 'weather', ic: '❄️', name: 'Tuyết', box: [14, 9, 14], pos: [0, 4.5, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#ffffff'}, ps: [['size', 'Cỡ bông tuyết', 'r', .3, 3, .05, 1], ['drift', 'Độ lắc ngang', 'r', 0, 3, .05, 1]]},
  petals: {g: 'weather', ic: '🌸', name: 'Hoa rơi', box: [10, 7, 10], pos: [0, 3.5, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#ffb7d0'}, ps: [['size', 'Cỡ cánh hoa', 'r', .3, 3, .05, 1], ['color2', 'Màu phụ', 'c', '#ffe3ee'], ['drift', 'Độ lắc ngang', 'r', 0, 3, .05, 1]]},
  leaves: {g: 'weather', ic: '🍂', name: 'Lá rơi', box: [10, 7, 10], pos: [0, 3.5, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#d9822b'}, ps: [['size', 'Cỡ lá', 'r', .3, 3, .05, 1], ['color2', 'Màu phụ', 'c', '#8aa832'], ['drift', 'Độ lắc ngang', 'r', 0, 3, .05, 1]]},
  fireflies: {g: 'weather', ic: '✨', name: 'Đom đóm', box: [14, 5, 14], pos: [0, 2.5, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#d6ff6a'}, ps: [['size', 'Cỡ chấm sáng', 'r', .3, 3, .05, 1], ['blink', 'Nhịp nhấp nháy', 'r', 0, 3, .05, 1]]},
  dust: {g: 'air', ic: '🌫', name: 'Bụi lơ lửng', box: [8, 4, 8], pos: [0, 2, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#fff2cf'}, ps: [['size', 'Cỡ hạt', 'r', .3, 3, .05, 1]]},
  fog: {g: 'air', ic: '🌁', name: 'Sương mù', box: [16, 3, 16], pos: [0, 1.5, 0], fill: 1, fi: 1.5, fo: 1.5, def: {intensity: 1, speed: 1, color: '#c9d3df'}, ps: [['density', 'Độ đặc (cả mảng sương và màn sương phủ vật thể)', 'r', 0, 1, .01, .35], ['size', 'Cỡ mảng sương', 'r', .3, 3, .05, 1]]},
  clouds: {g: 'air', ic: '☁️', name: 'Mây', box: [30, 4, 20], pos: [0, 9, -8], fill: 1, fi: 1.5, fo: 1.5, def: {intensity: 1, speed: 1, color: '#ffffff'}, ps: [['size', 'Cỡ đám mây', 'r', .3, 3, .05, 1], ['shade', 'Độ tối chân mây', 'r', 0, 1, .01, .35]]},
  sky: {g: 'air', hidden: true, ic: '🌅', name: 'Bầu trời (sky) — cũ', box: [1, 1, 1], pos: [0, 0, 0], noGizmo: true, fill: 1, fi: 1, fo: 1, def: {intensity: 1, speed: 1, color: '#2f7fe0'}, ps: [['preset', 'Kiểu trời', 's', [['day', 'Ban ngày'], ['sunset', 'Hoàng hôn'], ['night', 'Đêm sao'], ['storm', 'Giông bão'], ['custom', 'Tự chọn màu']], 'day'], ['horizon', 'Màu chân trời (kiểu tự chọn)', 'c', '#cfe6ff'], ['clouds', 'Lượng mây', 'r', 0, 1, .01, .5], ['sun', 'Hướng mặt trời / trăng (độ)', 'r', 0, 360, 1, 35], ['elev', 'Độ cao mặt trời (độ)', 'r', -10, 85, 1, 25]], note: 'Bầu trời phủ kín nền phía sau (thay cho màu / ảnh nền) trong lúc hiệu ứng chạy.'},
  /* ---- không khí: hậu kỳ lên cả nền + nhân vật ---- */
  glow: {g: 'air', ic: '💭', name: 'Mờ ảo / phát sáng', screen: true, post: true, fill: 1, fi: 1, fo: 1, def: {intensity: .5, speed: 1}, ps: [], note: 'Làm mềm và tỏa sáng vùng sáng của toàn khung (nền + nhân vật). Chạy trước viền đen / nhiễu hạt nên các lớp đó vẫn nét.'},
  distort: {g: 'air', ic: '♨️', name: 'Biến dạng không khí', screen: true, post: true, fill: 1, fi: 1, fo: 1, def: {intensity: .5, speed: 1}, ps: [['kind', 'Kiểu biến dạng', 's', DISTORT_KINDS, 'heat']], note: 'Hơi nóng, sóng nước, gợn tròn, méo ống kính — áp lên cả nền (ảnh, video, môi trường, ảnh 360°) lẫn nhân vật. Viền đen / nhiễu hạt không bị méo theo.'},
  wind: {g: 'weather', ic: '🌬', name: 'Gió', box: [14, 6, 14], pos: [0, 3, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#ffffff'}, ps: [['dir', 'Hướng gió (độ: 0 = +X, 90 = −Z)', 'r', 0, 360, 1, 0], ['streaks', 'Hiện vệt gió', 'b', true], ['gust', 'Giật từng cơn', 'r', 0, 1, .01, .5]], note: 'Gió thổi lên mọi hiệu ứng hạt đang chạy cùng lúc (mưa, tuyết, lá, hoa, khói, lửa…).'},
  /* ---- lửa / nổ / sét ---- */
  fire: {g: 'fire', ic: '🔥', name: 'Cháy', box: [.8, .2, .8], pos: [0, .1, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#ff8a1f'}, ps: [['height', 'Chiều cao lửa (m)', 'r', .3, 5, .05, 1.6], ['smoke', 'Khói bên trên', 'r', 0, 1, .01, .35], ['sparks', 'Tàn lửa', 'r', 0, 1, .01, .4]]},
  smokefire: {g: 'fire', ic: '🔥', name: 'Khói lửa', box: [1.6, .3, 1.6], pos: [0, .15, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#ff7a14'}, ps: [['height', 'Chiều cao lửa (m)', 'r', .3, 6, .05, 2.2], ['smoke', 'Lượng khói', 'r', 0, 1, .01, .9], ['sparks', 'Tàn lửa', 'r', 0, 1, .01, .7], ['smokeColor', 'Màu khói', 'c', '#2b2b2f']]},
  smoke: {g: 'fire', ic: '💨', name: 'Khói', box: [.7, .2, .7], pos: [0, .1, 0], fill: 1, def: {intensity: 1, speed: 1, color: '#6b6b72'}, ps: [['height', 'Độ cao khói bay (m)', 'r', .5, 10, .1, 3.5], ['size', 'Cỡ cụm khói', 'r', .3, 3, .05, 1]]},
  explosion: {g: 'fire', ic: '💥', name: 'Nổ', box: [1, 1, 1], pos: [0, .6, 0], dur: 4, fi: 0, fo: .4, def: {intensity: 1, speed: 1, color: '#ffa21a'}, ps: [['radius', 'Bán kính nổ (m)', 'r', .5, 12, .1, 3], ['loop', 'Nổ lặp lại', 'b', false], ['period', 'Chu kỳ lặp (s)', 'n', .5, 30, .1, 3], ['debris', 'Mảnh vụn bắn ra', 'r', 0, 1, .01, .6], ['shock', 'Sóng xung kích', 'r', 0, 1, .01, .7], ['smokeColor', 'Màu khói sau nổ', 'c', '#2c2c30']], note: 'Nổ xảy ra ngay lúc khối bắt đầu. Đặt khối ngắn (2–4 s) hoặc bật “Nổ lặp lại”.'},
  lightning: {g: 'fire', ic: '⚡', name: 'Sấm sét', box: [10, 10, 4], pos: [0, 5, -6], dur: 6, fi: 0, fo: .3, def: {intensity: 1, speed: 1, color: '#cfe0ff'}, ps: [['rate', 'Số lần sét mỗi 10 giây', 'r', .5, 20, .5, 4], ['branches', 'Nhánh rẽ', 'r', 0, 1, .01, .6], ['width', 'Độ dày tia', 'r', .3, 3, .05, 1], ['flash', 'Chớp sáng toàn khung', 'r', 0, 1, .01, .6]], note: 'Tia sét đánh từ mép trên xuống mép dưới của khung vùng. Đổi “hạt giống” để ra kiểu tia khác.'},
  rocks: {g: 'fire', ic: '🪨', name: 'Đá rơi', box: [8, 1, 8], pos: [0, 9, 0], dur: 6, fi: 0, fo: 1, def: {intensity: 1, speed: 1, color: '#7b756d'}, ps: [['size', 'Cỡ đá', 'r', .2, 3, .05, 1], ['bounce', 'Độ nảy', 'r', 0, .8, .01, .35], ['floor', 'Độ cao mặt đất (m)', 'n', -5, 20, .1, 0], ['dust', 'Bụi khi chạm đất', 'r', 0, 1, .01, .5]], note: 'Đá rơi từ mép trên của khung vùng xuống mặt đất. Chỉ góc xoay quanh trục Y có tác dụng.'},
  /* ---- camera ---- */
  shake: {g: 'camera', ic: '📳', name: 'Rung lắc camera', cam: true, dur: 2, fi: .1, fo: .5, def: {intensity: 1, speed: 1}, ps: [['pos', 'Rung vị trí (m)', 'r', 0, .5, .005, .06], ['rot', 'Rung góc (độ)', 'r', 0, 6, .05, .8], ['roll', 'Rung nghiêng (độ)', 'r', 0, 6, .05, .6], ['freq', 'Tần số (Hz)', 'r', .5, 30, .5, 9], ['decay', 'Tắt dần (kiểu nổ / va chạm)', 'b', false]]},
  handheld: {g: 'camera', ic: '🎥', name: 'Cầm tay (handheld)', cam: true, fill: 1, fi: .6, fo: .6, def: {intensity: 1, speed: 1}, ps: [['pos', 'Dao động vị trí (m)', 'r', 0, .2, .002, .02], ['rot', 'Dao động góc (độ)', 'r', 0, 3, .02, .35], ['roll', 'Nghiêng (độ)', 'r', 0, 3, .02, .25]]},
  sway: {g: 'camera', ic: '🌊', name: 'Đung đưa', cam: true, fill: 1, fi: 1, fo: 1, def: {intensity: 1, speed: 1}, ps: [['side', 'Lắc ngang (m)', 'r', 0, 2, .01, .25], ['bob', 'Nhấp nhô lên xuống (m)', 'r', 0, 2, .01, .12], ['roll', 'Nghiêng lắc (độ)', 'r', 0, 15, .1, 2.5], ['period', 'Chu kỳ (s)', 'r', .5, 12, .1, 4]]},
  pan: {g: 'camera', ic: '↔', name: 'Lia ngang (pan)', cam: true, dur: 3, fi: 0, fo: 0, hold: 1, def: {intensity: 1, speed: 1}, ps: [['deg', 'Góc lia (độ, + sang phải)', 'r', -180, 180, 1, 30], ['ease', 'Chuyển động', 's', EASE, 'smooth'], HOLD.concat([true])]},
  tilt: {g: 'camera', ic: '↕', name: 'Lia dọc (tilt)', cam: true, dur: 3, fi: 0, fo: 0, hold: 1, def: {intensity: 1, speed: 1}, ps: [['deg', 'Góc ngước (độ, + lên)', 'r', -80, 80, 1, 20], ['ease', 'Chuyển động', 's', EASE, 'smooth'], HOLD.concat([true])]},
  dolly: {g: 'camera', ic: '🎬', name: 'Tiến / lùi (dolly)', cam: true, dur: 3, fi: 0, fo: 0, hold: 1, def: {intensity: 1, speed: 1}, ps: [['dist', 'Quãng đường (m, + tiến tới)', 'r', -20, 20, .1, 3], ['ease', 'Chuyển động', 's', EASE, 'smooth'], HOLD.concat([true])]},
  orbit: {g: 'camera', ic: '🔄', name: 'Quay quanh (orbit)', cam: true, dur: 4, fi: 0, fo: 0, hold: 1, def: {intensity: 1, speed: 1}, ps: [['deg', 'Góc quay quanh điểm nhìn (độ)', 'r', -360, 360, 1, 90], ['ease', 'Chuyển động', 's', EASE, 'smooth'], HOLD.concat([true])]},
  zoom: {g: 'camera', ic: '🔍', name: 'Zoom (FOV)', cam: true, dur: 3, fi: 0, fo: 0, hold: 1, def: {intensity: 1, speed: 1}, ps: [['fov', 'Đổi góc nhìn (độ, − = zoom vào)', 'r', -30, 60, .5, -15], ['ease', 'Chuyển động', 's', EASE, 'smooth'], HOLD.concat([true])]},
  roll: {g: 'camera', ic: '🌀', name: 'Nghiêng camera (roll)', cam: true, dur: 3, fi: 0, fo: 0, hold: 1, def: {intensity: 1, speed: 1}, ps: [['deg', 'Góc nghiêng (độ)', 'r', -180, 180, 1, 15], ['ease', 'Chuyển động', 's', EASE, 'smooth'], HOLD.concat([true])]},
  /* ---- màn hình ---- */
  vignette: {g: 'screen', ic: '◉', name: 'Tối viền (vignette)', screen: true, fill: 1, def: {intensity: 1, speed: 1, color: '#000000'}, ps: [['size', 'Độ rộng vùng sáng', 'r', .2, 1.4, .01, .75]]},
  grain: {g: 'screen', ic: '▒', name: 'Nhiễu hạt phim', screen: true, fill: 1, def: {intensity: .6, speed: 1}, ps: [['size', 'Cỡ hạt', 'r', .5, 4, .1, 1.5]]},
  flash: {g: 'screen', ic: '⚪', name: 'Chớp sáng', screen: true, dur: 1, fi: 0, fo: 0, def: {intensity: 1, speed: 1, color: '#ffffff'}, ps: [['times', 'Số lần chớp', 'r', 1, 12, 1, 1], ['curve', 'Kiểu', 's', [['pulse', 'Chớp rồi tắt'], ['hold', 'Sáng dần rồi giữ'], ['strobe', 'Nhấp nháy']], 'pulse']]},
  letterbox: {g: 'screen', ic: '▬', name: 'Viền đen điện ảnh', screen: true, fill: 1, fi: 1, fo: 1, def: {intensity: 1, speed: 1, color: '#000000'}, ps: [['ratio', 'Tỉ lệ khung (rộng / cao)', 'r', 1.4, 3, .01, 2.39]]},
  tint: {g: 'screen', ic: '🎨', name: 'Phủ màu (color grade)', screen: true, fill: 1, def: {intensity: .35, speed: 1, color: '#ff9a3c'}, ps: []}
};
export const FX_IDS = Object.keys(FX);
export const isCamFx = id => !!(FX[id] && FX[id].cam);
export const isScreenFx = id => !!(FX[id] && FX[id].screen);
export const isSpaceFx = id => !!(FX[id] && !FX[id].cam && !FX[id].screen);
export const hasGizmo = id => isSpaceFx(id) && !(FX[id] && FX[id].noGizmo);
const MOVES = new Set(['pan', 'tilt', 'dolly', 'orbit', 'zoom', 'roll']);

/** Giá trị mặc định của một khối fx mới (chưa gồm id / start / dur). */
export function fxDefaults(id) {
  const d = FX[id], o = {fx: id, name: d.ic + ' ' + d.name, ...d.def, fi: nz(d.fi, .6), fo: nz(d.fo, .8), seed: 1, on: true};
  for (const p of d.ps) o[p[1 - 1]] = p[2] === 'c' ? p[3] : p[2] === 's' ? p[4] : p[2] === 'b' ? p[3] : p[6];
  if (isSpaceFx(id) && !d.noGizmo) Object.assign(o, {x: d.pos[0], y: d.pos[1], z: d.pos[2], rx: 0, rot: 0, rz: 0, sx: 1, sy: 1, sz: 1, lock: true, fixed: false, helper: true});
  return o;
}
/** Danh sách trường panel: mỗi phần tử [khoá, nhãn, kiểu, …] — kiểu 'fxr' (thanh trượt + số), 'fxs' (chọn), còn lại như field() của Studio. */
export function fxFields(it) {
  const d = FX[it.fx]; if (!d) return [];
  const f = [['name', 'Tên', 't'], ['on', 'Bật hiệu ứng', 'b'], ['intensity', 'Cường độ', 'fxr', 0, 3, .01], ['speed', 'Tốc độ', 'fxr', .1, 4, .01]];
  if (d.def.color !== undefined) f.push(['color', it.fx === 'sky' ? 'Màu bầu trời (đỉnh trời)' : it.fx === 'tint' ? 'Màu phủ' : 'Màu', 'c']);
  for (const p of d.ps) {
    if (p[2] === 'r') f.push([p[0], p[1], 'fxr', p[3], p[4], p[5]]);
    else if (p[2] === 's') f.push([p[0], p[1], 'fxs', p[3]]);
    else f.push([p[0], p[1], p[2]]);
  }
  f.push(['fi', 'Hiện dần (s)', 'n'], ['fo', 'Tắt dần (s)', 'n'], ['seed', 'Hạt giống ngẫu nhiên (đổi để ra kiểu khác)', 'n'], ['start', 'Bắt đầu (s)', 'n'], ['dur', 'Độ dài (s)', 'n']);
  if (hasGizmo(it.fx)) f.push(['fixed', '🔒 Khóa kéo thả (không di chuyển / xoay / đổi cỡ bằng chuột)', 'b'], ['helper', 'Hiện khung vùng hiệu ứng trong khung', 'b'],
    ['x', 'Vị trí X (m)', 'n'], ['y', 'Vị trí Y (m)', 'n'], ['z', 'Vị trí Z (m)', 'n'],
    ['rx', 'Xoay X (độ)', 'n'], ['rot', 'Xoay Y (độ)', 'n'], ['rz', 'Xoay Z (độ)', 'n'],
    ['lock', 'Khóa tỉ lệ', 'b'], ['sx', 'Scale X', 'n'], ['sy', 'Scale Y', 'n'], ['sz', 'Scale Z', 'n']);
  return f;
}
/** Độ dài mặc định của khối mới. */
export function defaultDur(id, sceneDur, start) {
  const d = FX[id]; if (!d) return 3;
  return d.fill ? Math.max(3, Math.ceil(sceneDur - start)) : (d.dur || 3);
}

/* ---------------- Envelope: hiện dần / tắt dần theo khối trên timeline ---------------- */
export function envelope(it, t) {
  const a = t - (+it.start || 0), D = Math.max(1e-3, nz(it.dur, 1));
  if (a < 0 || a > D) return 0;
  const fi = Math.max(0, nz(it.fi, 0)), fo = Math.max(0, nz(it.fo, 0));
  return (fi > 0 ? sstep(0, fi, a) : 1) * (fo > 0 ? sstep(0, fo, D - a) : 1);
}
const EASEF = {smooth: u => u * u * (3 - 2 * u), lin: u => u, in: u => u * u, out: u => 1 - (1 - u) * (1 - u)};
const prog = (it, t, ease) => { const D = Math.max(1e-3, nz(it.dur, 1)); return (EASEF[ease] || EASEF.smooth)(clamp((t - (+it.start || 0)) / D, 0, 1)); };

/** Vector gió thế giới [x, z] tại thời điểm t, cộng từ mọi khối 'wind'. */
export function windAt(items, t) {
  let x = 0, z = 0;
  for (const it of items) {
    if (it.fx !== 'wind' || it.on === false) continue;
    const e = envelope(it, t); if (!e) continue;
    const a = nz(it.dir, 0) * Math.PI / 180, g = nz(it.gust, .5), k = nz(it.speed, 1);
    const gust = 1 + g * (.9 * Math.sin(t * k * .9 + nz(it.seed, 1)) + .6 * Math.sin(t * k * 2.3 + 1.7) - .3);
    const m = 3.2 * nz(it.intensity, 1) * e * Math.max(0, gust);
    x += Math.cos(a) * m; z += -Math.sin(a) * m;
  }
  return [x, z];
}

/* ============================================================
   Camera: độ lệch cộng dồn từ mọi khối camera đang chạy
   ============================================================ */
export function camOffsets(items, t) {
  const o = {dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, roll: 0, fov: 0, orbit: 0, dolly: 0, any: false};
  const R = Math.PI / 180;
  for (const it of items) {
    const d = FX[it.fx];
    if (!d || !d.cam || it.on === false) continue;
    const hold = MOVES.has(it.fx) && it.hold !== false;           // chuyển động lia: giữ góc cuối sau khi kết thúc
    const e = hold ? (t >= (+it.start || 0) ? 1 : 0) : envelope(it, t);
    if (!e) continue;
    const I = nz(it.intensity, 1) * e, sp = nz(it.speed, 1), sd = nz(it.seed, 1), a = (t - (+it.start || 0)) * sp;
    o.any = true;
    switch (it.fx) {
      case 'shake': {
        const f = nz(it.freq, 9), dec = it.decay ? Math.exp(-(t - (+it.start || 0)) * 2.2 / Math.max(.2, nz(it.dur, 1) * .5)) : 1, k = I * dec, x = t * f * sp;
        const P = nz(it.pos, .06), A = nz(it.rot, .8) * R, Z = nz(it.roll, .6) * R;
        o.dx += fbm1(x, sd) * P * k; o.dy += fbm1(x + 41.3, sd + 1) * P * k; o.dz += fbm1(x + 83.9, sd + 2) * P * .5 * k;
        o.yaw += fbm1(x + 11.7, sd + 3) * A * k; o.pitch += fbm1(x + 27.1, sd + 4) * A * k; o.roll += fbm1(x + 61.9, sd + 5) * Z * k;
        break;
      }
      case 'handheld': {
        const x = t * .55 * sp, P = nz(it.pos, .02), A = nz(it.rot, .35) * R, Z = nz(it.roll, .25) * R;
        o.dx += fbm1(x, sd) * P * I; o.dy += fbm1(x + 5.5, sd + 1) * P * I;
        o.yaw += fbm1(x + 9.1, sd + 2) * A * I; o.pitch += fbm1(x + 13.7, sd + 3) * A * I; o.roll += fbm1(x + 21.3, sd + 4) * Z * I;
        break;
      }
      case 'sway': {
        const w = 2 * Math.PI / Math.max(.3, nz(it.period, 4)), s = Math.sin(a * w);
        o.dx += s * nz(it.side, .25) * I; o.dy += Math.sin(a * w * 2 + 1) * nz(it.bob, .12) * I; o.roll += s * nz(it.roll, 2.5) * R * I;
        break;
      }
      case 'pan': o.yaw += -nz(it.deg, 0) * R * I * prog(it, t, it.ease); break;
      case 'tilt': o.pitch += nz(it.deg, 0) * R * I * prog(it, t, it.ease); break;
      case 'dolly': o.dolly += nz(it.dist, 0) * I * prog(it, t, it.ease); break;
      case 'orbit': o.orbit += nz(it.deg, 0) * R * I * prog(it, t, it.ease); break;
      case 'zoom': o.fov += nz(it.fov, 0) * I * prog(it, t, it.ease); break;
      case 'roll': o.roll += nz(it.deg, 0) * R * I * prog(it, t, it.ease); break;
    }
  }
  return o;
}

/* ============================================================
   Shader hạt (GPU) — mọi vị trí là hàm của thời gian
   ============================================================ */
const PART_VS = /* glsl */`
attribute vec4 aR;
uniform float uT, uInt, uSpeed, uScale, uSize, uSeed, uLife;
uniform vec3 uBox, uVel, uAcc, uWind, uSway;
uniform float uMode, uShape, uStretch, uGrow, uSpin, uTurb, uWindK, uFadeEdge, uPeriod, uBurstSpread, uDrag;
uniform vec3 uTint1, uTint2;
varying vec2 vUv; varying float vA; varying float vAge; varying vec3 vTint; varying float vR;
float h11(float n){ return fract(sin(n*127.1+311.7)*43758.5453); }
vec3 h31(float n){ return vec3(h11(n), h11(n+17.3), h11(n+41.9)); }
mat2 rot2(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
void main(){
  vUv = uv; vR = aR.w;
  float on = step(aR.x, clamp(uInt*0.5, 0., 1.)) * step(0.0001, uInt);
  float life = uLife * (0.7 + 0.6*aR.y);
  float alpha = 1.;
  float age = 0.;
  vec3 L; vec3 vel;
  vec3 msc = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  float fallT = 0.;
  if (uMode < 0.5) {
    // WRAP: hạt trôi trong hộp, ra mép này thì vào lại mép kia (tốc độ theo mét thật, không phụ thuộc scale)
    vec3 b = h31(aR.w*131.3 + aR.z*17.7 + 3.1);
    vec3 v = uVel * uSpeed;
    vec3 u = fract(b + v*uT/max(uBox*msc, vec3(0.001)));
    L = (u-0.5)*uBox;
    float ph = aR.w*6.2831 + uT*uSpeed*(0.6+aR.z);
    L += uSway * vec3(sin(ph), 0.35*sin(ph*1.7+1.), cos(ph*0.8+2.));
    vec3 e = min(u, 1.-u)*uBox*msc;
    alpha *= smoothstep(0., uFadeEdge, e.y) * smoothstep(0., uFadeEdge*1.5, min(e.x,e.z));
    vel = v;
    fallT = clamp(u.y*uBox.y*msc.y/max(abs(v.y),0.2), 0., 3.);
    age = fract(aR.w*7.0);
  } else {
    float tt = uT*uSpeed, cyc = 0.;
    if (uMode < 1.5) { float x = tt/life + aR.z; cyc = floor(x); age = fract(x)*life; }
    else {
      float T = uPeriod > 0. ? mod(tt, uPeriod) : tt;
      cyc = uPeriod > 0. ? floor(tt/uPeriod) : 0.;
      age = T - aR.z*uBurstSpread;
      if (age < 0. || age > life) on = 0.;
    }
    vec3 s = h31(aR.w*91.7 + cyc*13.1 + uSeed*3.1);
    vec3 base = (s-0.5)*uBox;
    vec3 v = uVel + (h31(aR.x*53.3 + cyc*7.7 + uSeed) - 0.5)*uTurb*2.;
    float k = max(uDrag, 0.0001);
    vec3 dis = uDrag > 0.0001 ? v*(1.-exp(-k*age))/k : v*age;
    L = base + dis + 0.5*uAcc*age*age;
    L += uSway * vec3(sin(age*3.1+aR.w*6.2831), 0., cos(age*2.7+aR.z*6.2831)) * (age/life);
    vel = (v + uAcc*age) * uSpeed;
    float u = clamp(age/life, 0., 1.);
    alpha *= uMode > 1.5 ? smoothstep(0., 0.03, u) * (1.-smoothstep(0.45,1.,u)) : smoothstep(0., 0.08, u) * (1.-smoothstep(0.55,1.,u));
    fallT = age;
    age = u;
  }
  vAge = uMode < 0.5 ? age : clamp(age, 0., 1.);
  vec4 wp = modelMatrix * vec4(L, 1.);
  wp.xyz += uWind * uWindK * fallT * (uMode < 0.5 ? 0.6 : 0.6);
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float sz = uSize * uScale * (0.65 + 0.7*aR.z);
  sz *= mix(1., uGrow, vAge);
  vec2 q = position.xy * sz;
  float ang = aR.y*6.2831 + uSpin*(aR.w-0.5)*(uMode < 0.5 ? uT*uSpeed : age*life);
  if (uShape > 3.5 && uShape < 5.5) { q.x *= (0.35 + 0.65*abs(cos(ang*1.7 + aR.w*9.))); }
  if (uStretch > 0.) {
    vec3 wv = (modelMatrix*vec4(vel,0.)).xyz + uWind*uWindK*0.5;
    vec3 vv = (viewMatrix*vec4(wv,0.)).xyz;
    vec2 d2 = normalize(vv.xy + vec2(0.00001,0.0));
    float ln = min(length(wv)*uStretch*0.06, 3.0);
    vec2 qq = q;
    q = d2*(qq.y*(0.2+ln)) + vec2(-d2.y,d2.x)*qq.x*0.35;
  } else { q = rot2(ang)*q; }
  vec3 pos = wp.xyz + camR*q.x + camU*q.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos,1.);
  vA = alpha * on;
  vTint = mix(uTint1, uTint2, h11(aR.w*37.7+aR.y*11.3));
  if (on < 0.5) gl_Position = vec4(2.,2.,2.,1.);
}`;
const PART_FS = /* glsl */`
precision highp float;
uniform float uShape, uBright, uOpacity, uT, uBlink;
uniform vec3 uHot, uMid, uCool;
varying vec2 vUv; varying float vA; varying float vAge; varying vec3 vTint; varying float vR;
float ss(float a, float b, float x){ return a < b ? smoothstep(a,b,x) : 1.-smoothstep(b,a,x); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ return vn(p)*.5 + vn(p*2.03+3.1)*.25 + vn(p*4.1+7.7)*.125 + vn(p*8.3+1.3)*.0625; }
void main(){
  vec2 p = vUv*2.-1.; float r = length(p);
  float a = 1.; vec3 col = vTint * uBright;
  if (uShape < 0.5) {                 // 0: chấm sáng mềm (đom đóm, bụi)
    a = pow(max(0., 1.-r), 2.2);
  } else if (uShape < 1.5) {          // 1: bông tuyết / hạt tròn
    a = ss(1., .55, r);
  } else if (uShape < 2.5) {          // 2: vệt dài (mưa, tia lửa) — dọc theo trục y
    a = ss(1., .15, abs(p.x)*1.6) * ss(1., .0, abs(p.y));
  } else if (uShape < 3.5) {          // 3: lửa
    float n = fbm(p*2.2 + vec2(vR*17., -uT*1.4*(1.+vR)));
    a = ss(1., .15, r + (n-.5)*.7);
    float k = clamp(vAge + (n-.5)*.25, 0., 1.);
    col = (k < .35 ? mix(uHot, uMid, k/.35) : mix(uMid, uCool, (k-.35)/.65)) * uBright;
  } else if (uShape < 4.5) {          // 4: lá cây
    vec2 q = vec2(p.x*1.9, p.y);
    a = 1. - smoothstep(.55, 1., abs(q.x) + abs(q.y)*.55 + q.y*q.y*.4);
    col *= 1. - .35*ss(.06, .0, abs(p.x));
  } else if (uShape < 5.5) {          // 5: cánh hoa
    float d = length(vec2(p.x*1.25, p.y + .18*p.y*p.y - .1));
    a = ss(1., .72, d); col *= mix(1.12, 1., smoothstep(-.8,.8,p.y));
  } else if (uShape < 6.5) {          // 6: khói / sương / mây
    float n = fbm(p*1.7 + vec2(vR*31., vR*13. + uT*.05));
    a = ss(1., .1, r + (n-.5)*.9) * .85; col *= (.82 + .3*n);
  } else if (uShape < 7.5) {          // 7: lấp lánh
    a = pow(max(0., 1.-r), 3.) + .6*pow(max(0.,1.-abs(p.x)*6.),2.)*pow(max(0.,1.-abs(p.y)),2.) + .6*pow(max(0.,1.-abs(p.y)*6.),2.)*pow(max(0.,1.-abs(p.x)),2.);
  } else {                            // 8: vệt gió — dọc theo trục y
    a = (1. - smoothstep(0., .35, abs(p.x))) * (1. - smoothstep(.2, 1., abs(p.y))) * .7;
  }
  if (uBlink > 0.) a *= .2 + .8*(.5+.5*sin(uT*uBlink*(1.2+vR*2.5) + vR*40.));
  float al = a * vA * uOpacity;
  if (al < 0.003) discard;
  gl_FragColor = vec4(col, al);
  #include <colorspace_fragment>
}`;

function partGeometry(n, seed) {
  const g = new THREE.InstancedBufferGeometry(), q = new THREE.PlaneGeometry(1, 1);
  g.setIndex(q.index); g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
  const R = rng(seed * 9301 + 49297), a = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) a[i] = R();
  g.setAttribute('aR', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = n;
  return g;
}
const c3 = (hex, k = 1) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r * k, c.g * k, c.b * k); };
const setC = (u, hex, k = 1) => { const c = new THREE.Color(hex); u.value.set(c.r * k, c.g * k, c.b * k); };

/** Một lớp hạt: cfg = {n, mode(0 wrap/1 vòng đời/2 nổ), shape, blend, life, vel, acc, size, …} */
function layer(parent, cfg) {
  const U = {
    uT: {value: 0}, uInt: {value: 1}, uSpeed: {value: 1}, uScale: {value: 1}, uSize: {value: cfg.size || .1}, uSeed: {value: 0}, uLife: {value: cfg.life || 3},
    uBox: {value: new THREE.Vector3(1, 1, 1)}, uVel: {value: new THREE.Vector3(...(cfg.vel || [0, 0, 0]))}, uAcc: {value: new THREE.Vector3(...(cfg.acc || [0, 0, 0]))},
    uWind: {value: new THREE.Vector3()}, uSway: {value: new THREE.Vector3(...(cfg.sway || [0, 0, 0]))},
    uMode: {value: cfg.mode || 0}, uShape: {value: cfg.shape || 0}, uStretch: {value: cfg.stretch || 0}, uGrow: {value: cfg.grow ?? 1}, uSpin: {value: cfg.spin || 0},
    uTurb: {value: cfg.turb || 0}, uWindK: {value: cfg.windK ?? 1}, uFadeEdge: {value: cfg.fadeEdge ?? .6}, uPeriod: {value: 0}, uBurstSpread: {value: cfg.burstSpread ?? .15}, uDrag: {value: cfg.drag || 0},
    uTint1: {value: c3('#ffffff')}, uTint2: {value: c3('#ffffff')}, uHot: {value: c3('#fff3b0')}, uMid: {value: c3('#ff8a1f')}, uCool: {value: c3('#3a0d05')},
    uBright: {value: cfg.bright ?? 1}, uOpacity: {value: cfg.opacity ?? 1}, uBlink: {value: 0}
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthWrite: false, depthTest: true,
    blending: cfg.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(partGeometry(cfg.n, cfg.seed || 1), mat);
  mesh.frustumCulled = false; mesh.renderOrder = cfg.order ?? 30;
  parent.add(mesh);
  return {mesh, U, dispose() { mesh.geometry.dispose(); mat.dispose(); mesh.removeFromParent(); }};
}

/* ============================================================
   Từng loại hiệu ứng → runtime
   upd(it, I, t, wind, k, spd, lt):  I = cường độ × envelope · k = scale trung bình · lt = giây kể từ lúc khối bắt đầu
   ============================================================ */
const DEG = Math.PI / 180;

function makeRuntime(it, scene) {
  const id = it.fx, d = FX[id], g = new THREE.Group(); g.name = 'fx_' + id;
  const L = [], roots = [];                       // roots: đối tượng đặt thẳng vào scene (ngoài nhóm) cần gỡ khi dispose
  const add = cfg => { const l = layer(g, {...cfg, seed: nz(it.seed, 1) * 31 + L.length * 7}); L.push(l); return l; };
  const S = {isFx: true, kind: id, g, L, fit: 1, mats: [], hp: null, upd: null, box: d.box || [1, 1, 1], im: null, bolts: null, sky: null, flashV: 0, worldTop: 0, xf: new THREE.Matrix4()};
  let cleanup = null;

  switch (id) {
    case 'rain': {
      const l = add({n: 7000, mode: 0, shape: 2, stretch: 1, size: .16, vel: [0, -16, 0], blend: 'norm', windK: 1, fadeEdge: .5, opacity: .55});
      S.upd = it => {
        const len = nz(it.len, .55), th = nz(it.thick, 1);
        l.U.uSize.value = .13 * th * (.7 + len); l.U.uVel.value.set(nz(it.slant, 0), -16, 0); l.U.uStretch.value = .6 + len * 2.6;
        setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, .8);
      };
      break;
    }
    case 'snow': {
      const l = add({n: 5000, mode: 0, shape: 1, size: .07, vel: [0, -1.15, 0], sway: [.35, 0, .35], spin: 1.5, blend: 'norm', windK: 1, fadeEdge: .8});
      S.upd = it => { const dr = nz(it.drift, 1); l.U.uSize.value = .06 * nz(it.size, 1); l.U.uSway.value.set(.38 * dr, 0, .38 * dr); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, .9); };
      break;
    }
    case 'petals': case 'leaves': {
      const leaf = id === 'leaves';
      const l = add({n: 900, mode: 0, shape: leaf ? 4 : 5, size: leaf ? .2 : .14, vel: [0, leaf ? -.85 : -.6, 0], sway: [.9, 0, .9], spin: leaf ? 3 : 2.4, blend: 'norm', windK: 1.6, fadeEdge: .8});
      S.upd = it => { const dr = nz(it.drift, 1); l.U.uSize.value = (leaf ? .2 : .14) * nz(it.size, 1); l.U.uSway.value.set(.9 * dr, 0, .9 * dr); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color2 || it.color); };
      break;
    }
    case 'fireflies': {
      const l = add({n: 500, mode: 0, shape: 0, size: .16, vel: [.05, .04, .03], sway: [.9, .5, .9], blend: 'add', windK: .35, fadeEdge: 1.2, bright: 1.3});
      S.upd = it => { l.U.uSize.value = .16 * nz(it.size, 1); l.U.uBlink.value = nz(it.blink, 1); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, .8); };
      break;
    }
    case 'dust': {
      const l = add({n: 700, mode: 0, shape: 0, size: .05, vel: [.02, .015, .01], sway: [.4, .3, .4], blend: 'add', windK: 1, fadeEdge: 1, bright: .8, opacity: .55});
      S.upd = it => { l.U.uSize.value = .05 * nz(it.size, 1); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, .8); };
      break;
    }
    case 'fog': {
      const l = add({n: 120, mode: 0, shape: 6, size: 3.4, vel: [.12, 0, .06], sway: [.5, .1, .5], blend: 'norm', windK: .6, fadeEdge: 1.4, opacity: .5, spin: .08, order: 25});
      S.upd = it => { l.U.uSize.value = 3.4 * nz(it.size, 1); l.U.uOpacity.value = clamp(.35 + nz(it.density, .35) * .9, 0, 1) * .55; setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, .93); };
      break;
    }
    case 'clouds': {
      const l = add({n: 70, mode: 0, shape: 6, size: 6, vel: [.25, 0, 0], sway: [.8, .15, .4], blend: 'norm', windK: .25, fadeEdge: 2.5, opacity: .9, order: 22});
      S.upd = it => { const sh = nz(it.shade, .35); l.U.uSize.value = 6 * nz(it.size, 1); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, 1 - sh * .6); };
      break;
    }
    case 'wind': {
      const l = add({n: 260, mode: 0, shape: 8, stretch: 1.4, size: 1, vel: [6, 0, 0], sway: [.2, .35, .2], blend: 'norm', windK: 0, fadeEdge: 1.6, opacity: .45});
      S.upd = (it, I) => {
        const a = nz(it.dir, 0) * DEG;
        l.U.uVel.value.set(Math.cos(a) * 6, 0, -Math.sin(a) * 6); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, .9);
        l.U.uInt.value = it.streaks === false ? 0 : I; l.U.uOpacity.value = .4 * clamp(I, 0, 1.5);
      };
      break;
    }
    case 'fire': case 'smokefire': {
      const big = id === 'smokefire';
      const fl = add({n: big ? 700 : 450, mode: 1, shape: 3, life: 1.05, size: .55, vel: [0, 1.5, 0], turb: .12, sway: [.25, 0, .25], blend: 'add', windK: 1, grow: .55, bright: 1.15, order: 31});
      const sm = add({n: big ? 260 : 160, mode: 1, shape: 6, life: 3.2, size: .9, vel: [0, 1.4, 0], acc: [0, .25, 0], turb: .1, sway: [.5, 0, .5], blend: 'norm', windK: 1.4, grow: 2.2, opacity: .55, order: 29});
      const sp = add({n: 140, mode: 1, shape: 2, stretch: .5, life: 1.8, size: .05, vel: [0, 2.8, 0], acc: [0, -1.2, 0], turb: 1.1, blend: 'add', windK: 1.2, drag: .4, bright: 1.4, order: 32});
      sm.mesh.position.y = .35;
      S.upd = (it, I) => {
        const H = nz(it.height, 1.6), sa = nz(it.smoke, .35), sk = nz(it.sparks, .4), smc = big ? (it.smokeColor || '#2b2b2f') : '#3a3a3e';
        fl.U.uVel.value.set(0, H * .9, 0); fl.U.uSize.value = (.3 + H * .16) * (big ? 1.2 : 1);
        setC(fl.U.uHot, '#fff6c8'); setC(fl.U.uMid, it.color); setC(fl.U.uCool, '#3a0904');
        sm.U.uVel.value.set(0, H * .75, 0); sm.U.uLife.value = 2.6 + H * .5; sm.U.uSize.value = .55 + H * .22; setC(sm.U.uTint1, smc); setC(sm.U.uTint2, smc, 1.7);
        sm.U.uInt.value = sa > 0 ? I * sa * 2 : 0;
        sp.U.uVel.value.set(0, H * 1.5, 0); setC(sp.U.uTint1, '#ffd27a'); setC(sp.U.uTint2, '#ff8a1f'); sp.U.uInt.value = sk > 0 ? I * sk * 2 : 0;
      };
      break;
    }
    case 'smoke': {
      const l = add({n: 320, mode: 1, shape: 6, life: 4.5, size: .8, vel: [0, 1, 0], acc: [0, .15, 0], turb: .12, sway: [.6, 0, .6], blend: 'norm', windK: 1.6, grow: 2.6, opacity: .6, order: 29});
      S.upd = it => { l.U.uVel.value.set(0, nz(it.height, 3.5) / 4, 0); l.U.uSize.value = .55 * nz(it.size, 1); setC(l.U.uTint1, it.color); setC(l.U.uTint2, it.color, 1.6); };
      break;
    }
    case 'explosion': {
      const ball = add({n: 160, mode: 2, shape: 3, life: 1.1, size: 1.4, turb: 3, drag: 1.6, blend: 'add', grow: 1.6, bright: 1.3, burstSpread: .12, order: 33});
      const smk = add({n: 160, mode: 2, shape: 6, life: 3.8, size: 1.8, acc: [0, .5, 0], turb: 2.2, drag: 1.2, blend: 'norm', grow: 2.2, opacity: .65, burstSpread: .35, order: 30});
      const spk = add({n: 180, mode: 2, shape: 2, stretch: .6, life: 1.8, size: .06, acc: [0, -9, 0], turb: 7, drag: .35, blend: 'add', bright: 1.5, burstSpread: .05, order: 34});
      const dbr = add({n: 90, mode: 2, shape: 1, life: 2.6, size: .12, acc: [0, -9.5, 0], turb: 6, drag: .15, blend: 'norm', burstSpread: .04, order: 28});
      const ring = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 64), new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending}));
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 35; g.add(ring);
      cleanup = () => { ring.geometry.dispose(); ring.material.dispose(); };
      S.upd = (it, I, t, w, k, spd, lt) => {
        const Rr = nz(it.radius, 3), per = it.loop ? Math.max(.5, nz(it.period, 3)) : 0, db = nz(it.debris, .6), sh = nz(it.shock, .7), smc = it.smokeColor || '#2c2c30';
        for (const l of [ball, smk, spk, dbr]) { l.U.uPeriod.value = per; l.U.uBox.value.set(.3, .3, .3); }
        ball.U.uVel.value.set(0, Rr * .6, 0); ball.U.uTurb.value = Rr * 1.1; ball.U.uSize.value = Rr * .42; setC(ball.U.uHot, '#fffbe0'); setC(ball.U.uMid, it.color); setC(ball.U.uCool, '#401006');
        smk.U.uVel.value.set(0, Rr * .5, 0); smk.U.uTurb.value = Rr * .9; smk.U.uSize.value = Rr * .5; setC(smk.U.uTint1, smc); setC(smk.U.uTint2, smc, 1.8);
        spk.U.uVel.value.set(0, Rr * 1.6, 0); spk.U.uTurb.value = Rr * 3.2; setC(spk.U.uTint1, '#ffe8a8'); setC(spk.U.uTint2, '#ffb03a'); spk.U.uInt.value = I * 1.2;
        dbr.U.uVel.value.set(0, Rr * 1.2, 0); dbr.U.uTurb.value = Rr * 2.6; setC(dbr.U.uTint1, '#3d3833'); setC(dbr.U.uTint2, '#6a6258'); dbr.U.uInt.value = db > 0 ? I * db * 2 : 0;
        const tt = lt * spd, Tm = per > 0 ? tt % per : tt, u = clamp(Tm / .9, 0, 1);
        ring.visible = sh > 0 && u < 1; ring.scale.setScalar(Math.max(.01, Rr * (.15 + 2.6 * (1 - (1 - u) * (1 - u)))));
        ring.material.opacity = sh * .7 * (1 - u) * (1 - u) * clamp(I, 0, 1.5); ring.material.color.set(it.color).lerp(new THREE.Color('#ffffff'), .6);
      };
      break;
    }
    case 'lightning': {
      const BN = 10, mat = new THREE.ShaderMaterial({
        uniforms: {uCol: {value: new THREE.Color('#cfe0ff')}, uA: {value: 0}, uW: {value: 1}},
        vertexShader: `attribute vec3 aB; attribute vec2 aS; attribute float aWd; uniform float uW; varying float vE;
          void main(){
            vec3 a = (modelMatrix*vec4(position,1.)).xyz, b = (modelMatrix*vec4(aB,1.)).xyz;
            vec3 d = normalize(b-a+vec3(1e-5)); vec3 toC = normalize(cameraPosition-(a+b)*.5);
            vec3 side = normalize(cross(d,toC)+vec3(1e-6));
            vec3 p = (aS.x < .5 ? a : b) + side*aS.y*aWd*uW; vE = aS.y;
            gl_Position = projectionMatrix*viewMatrix*vec4(p,1.);
          }`,
        fragmentShader: `precision highp float; uniform vec3 uCol; uniform float uA; varying float vE;
          void main(){ float c = 1.-smoothstep(0.,1.,abs(vE)); float core = pow(c,6.); vec3 col = mix(uCol, vec3(1.), core);
            gl_FragColor = vec4(col*(.6+core*1.6), c*.9*uA);
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      S.bolts = [];
      const build = (seed, box, branches) => {
        const R = rng(seed), seg = [];
        const top = new THREE.Vector3((R() - .5) * box[0], box[1] / 2, (R() - .5) * box[2]);
        const bot = new THREE.Vector3(top.x + (R() - .5) * box[0] * .5, -box[1] / 2, top.z + (R() - .5) * box[2] * .5);
        const bolt = (A, B, depth, wd) => {
          const n = depth ? 9 : 16, pts = [A.clone()], len = A.distanceTo(B), nd = B.clone().sub(A).normalize();
          const t1 = new THREE.Vector3().crossVectors(nd, new THREE.Vector3(0, 1, 0)); if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0); t1.normalize();
          const t2 = new THREE.Vector3().crossVectors(nd, t1).normalize(), jit = len * (depth ? .09 : .075);
          for (let i = 1; i < n; i++) pts.push(A.clone().lerp(B, i / n).addScaledVector(t1, (R() - .5) * 2 * jit).addScaledVector(t2, (R() - .5) * 2 * jit));
          pts.push(B.clone());
          for (let i = 0; i < pts.length - 1; i++) {
            seg.push([...pts[i].toArray(), ...pts[i + 1].toArray(), wd * (1 - .4 * i / pts.length)]);
            if (depth < 2 && i > 1 && i < pts.length - 3 && R() < branches * (depth ? .25 : .5)) {
              const e = pts[i + 1].clone().add(new THREE.Vector3((R() - .5) * len * .7, -R() * len * .55 - len * .15, (R() - .5) * len * .7));
              bolt(pts[i + 1], e, depth + 1, wd * .55);
            }
          }
        };
        bolt(top, bot, 0, .09);
        return seg;
      };
      const rebuild = it => {
        for (const b of S.bolts) { b.geometry.dispose(); b.removeFromParent(); }
        S.bolts = [];
        for (let k = 0; k < BN; k++) {
          const sg = build(nz(it.seed, 1) * 977 + k * 131, S.box, nz(it.branches, .6)), n = sg.length;
          const pos = new Float32Array(n * 12), aB = new Float32Array(n * 12), aS = new Float32Array(n * 8), wd = new Float32Array(n * 4), idx = [];
          sg.forEach((s, i) => {
            const o = i * 4;
            for (let v = 0; v < 4; v++) {
              pos.set(s.slice(0, 3), (o + v) * 3); aB.set(s.slice(3, 6), (o + v) * 3);
              aS[(o + v) * 2] = v < 2 ? 0 : 1; aS[(o + v) * 2 + 1] = v % 2 ? 1 : -1; wd[o + v] = s[6];
            }
            idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
          });
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aB', new THREE.BufferAttribute(aB, 3));
          geo.setAttribute('aS', new THREE.BufferAttribute(aS, 2)); geo.setAttribute('aWd', new THREE.BufferAttribute(wd, 1)); geo.setIndex(idx);
          const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 36; m.visible = false; g.add(m); S.bolts.push(m);
        }
        S.lseed = it.seed; S.lbr = it.branches;
      };
      rebuild(it);
      cleanup = () => { for (const b of S.bolts) b.geometry.dispose(); mat.dispose(); };
      S.upd = (it, I, t, w, k, spd, lt) => {
        if (S.lseed !== it.seed || S.lbr !== it.branches) rebuild(it);
        const a = lt * spd, period = 10 / Math.max(.5, nz(it.rate, 4)), ci = Math.floor(a / period), seed = nz(it.seed, 1);
        let best = 0, pick = 0;
        for (let c = Math.max(0, ci - 1); c <= ci; c++) {          // mỗi chu kỳ một lần sét, vào lúc ngẫu nhiên trong chu kỳ
          const u = a - (c + .15 + hash01(c * 3.7 + seed) * .7) * period;
          if (u < 0 || u > .6) continue;
          const f = Math.max(Math.exp(-u * 14), .65 * Math.exp(-Math.abs(u - .16) * 40), .35 * Math.exp(-Math.abs(u - .3) * 30));   // đánh chính + dư chấn
          if (f > best) { best = f; pick = Math.floor(hash01(c * 7.3 + seed * 1.7) * BN) % BN; }
        }
        S.flashV = best * I * nz(it.flash, .6);
        S.bolts.forEach((b, i) => { b.visible = best > .02 && i === pick; });
        mat.uniforms.uA.value = clamp(best * 1.4 * I, 0, 1.3); mat.uniforms.uW.value = nz(it.width, 1) * (1 + best * .6);
        mat.uniforms.uCol.value.set(it.color);
      };
      break;
    }
    case 'rocks': {
      const N = 60, geo = new THREE.IcosahedronGeometry(.5, 0), mat = new THREE.MeshStandardMaterial({color: it.color || '#7b756d', roughness: .95, metalness: 0, flatShading: true});
      const pa = geo.attributes.position, R0 = rng(7);
      for (let i = 0; i < pa.count; i += 3) { const k = .78 + R0() * .44; for (let j = 0; j < 3; j++) pa.setXYZ(i + j, pa.getX(i + j) * k, pa.getY(i + j) * k * .85, pa.getZ(i + j) * k); }
      geo.computeVertexNormals();
      const im = new THREE.InstancedMesh(geo, mat, N); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      scene.add(im); roots.push(im); S.im = im;
      const rk = Array.from({length: N}, (_, i) => { const R = rng(nz(it.seed, 1) * 4421 + i * 97); return {x: R(), z: R(), s: R(), d: R(), ax: R() * 6.28, ay: R() * 6.28, az: R() * 6.28, w: R() + .3, rx: R(), rz: R()}; });
      const dust = add({n: 220, mode: 1, shape: 6, life: 1.8, size: .6, vel: [0, .6, 0], turb: 1.2, blend: 'norm', windK: 1, grow: 2.4, opacity: .35, order: 24, sway: [.3, 0, .3]});
      cleanup = () => { geo.dispose(); mat.dispose(); im.dispose(); };
      const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P3 = new THREE.Vector3(), S3 = new THREE.Vector3(), V3 = new THREE.Vector3(), Eu = new THREE.Euler(), M0 = new THREE.Matrix4().makeScale(0, 0, 0);
      S.upd = (it, I, t, w, k, spd, lt) => {
        const box = S.box, a = lt * spd, gv = 9.8, bn = nz(it.bounce, .35), sz = nz(it.size, 1), cnt = Math.round(N * clamp(I / 2, 0, 1)), dur = Math.max(1, nz(it.dur, 6));
        const floorY = nz(it.floor, 0), top = Math.max(S.worldTop, floorY + 1);
        mat.color.set(it.color);
        for (let i = 0; i < N; i++) {
          const r = rk[i], delay = r.d * Math.max(.5, dur * .6), tt = a - delay;
          if (i >= cnt || tt < 0) { im.setMatrixAt(i, M0); continue; }
          const rad = (.12 + r.s * .38) * sz * k, H = Math.max(rad + .5, top - floorY), Tf = Math.sqrt(2 * (H - rad) / gv);
          let h;
          if (tt < Tf) h = H - .5 * gv * tt * tt;
          else {
            let v = gv * Tf * bn, tb = tt - Tf; h = rad;
            for (let b = 0; b < 4 && bn > 0; b++) { const T = 2 * v / gv; if (tb < T) { h = rad + v * tb - .5 * gv * tb * tb; break; } tb -= T; v *= bn; }
          }
          const ang = r.w * 4 * Math.min(tt, Tf + .6);
          Eu.set(r.ax + ang * (r.rx + .3), r.ay + ang * .6, r.az + ang * (r.rz - .3)); Q.setFromEuler(Eu);
          V3.set((r.x - .5) * box[0], 0, (r.z - .5) * box[2]).applyMatrix4(S.xf);
          P3.set(V3.x, floorY + h, V3.z); S3.setScalar(rad * 2); M4.compose(P3, Q, S3); im.setMatrixAt(i, M4);
        }
        im.instanceMatrix.needsUpdate = true;
        const dd = nz(it.dust, .5);
        dust.U.uBox.value.set(box[0], .2, box[2]); dust.mesh.position.y = (floorY - g.position.y) / (g.scale.y || 1) + .1;
        dust.U.uInt.value = dd > 0 ? I * dd * 2 * (cnt / N) : 0; setC(dust.U.uTint1, '#9a8f80'); setC(dust.U.uTint2, '#b8ad9c'); dust.U.uSize.value = .55 * sz;
      };
      break;
    }
    case 'sky': {
      const mat = new THREE.ShaderMaterial({
        uniforms: {uTop: {value: new THREE.Color('#2f7fe0')}, uHor: {value: new THREE.Color('#cfe6ff')}, uBot: {value: new THREE.Color('#9cb6c9')}, uSun: {value: new THREE.Vector3(0, .4, -1)}, uSunC: {value: new THREE.Color('#fff3c4')}, uT: {value: 0}, uCloud: {value: .5}, uStars: {value: 0}, uDark: {value: 1}, uStorm: {value: 0}},
        vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.); gl_Position = p.xyww; }`,
        fragmentShader: `precision highp float; varying vec3 vD; uniform vec3 uTop,uHor,uBot,uSunC,uSun; uniform float uT,uCloud,uStars,uDark,uStorm;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.02+vec2(3.1,1.7); a*=.5; } return s; }
          void main(){
            vec3 d = normalize(vD); float y = d.y;
            vec3 col = mix(uHor, uTop, pow(clamp(y,0.,1.), .55));
            if (y < 0.) col = mix(uHor, uBot, clamp(-y*4.,0.,1.));
            float sd = max(dot(d, normalize(uSun)), 0.);
            col += uSunC * (pow(sd, 900.)*2.5 + pow(sd, 22.)*.35 + pow(sd,4.)*.12) * uDark;
            if (uStars > 0.) { vec2 sp = d.xz/(abs(d.y)+.35)*60.; vec2 ci = floor(sp); float r = h21(ci); float tw = .6+.4*sin(uT*2.+r*50.);
              float st = step(.985, r) * (1.-smoothstep(0.,.35,length(fract(sp)-.5))) * tw; col += vec3(st) * uStars * smoothstep(0.02,.25,y); }
            if (y > 0.005) { vec2 cp = d.xz/(y+.22)*1.6 + vec2(uT*.015, uT*.006); float n = fbm(cp);
              float cov = smoothstep(1.-uCloud*.75-.08, 1.-uCloud*.75+.28, n + uStorm*.12) * smoothstep(0., .12, y);
              vec3 cc = mix(vec3(1.), vec3(.35,.37,.42), uStorm) * mix(1., .55, smoothstep(.55,.9,n)*(.6+.4*uStorm)) * (.35+.65*uDark);
              col = mix(col, cc, cov*(.55+.4*uStorm)); }
            gl_FragColor = vec4(col, 1.);
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: false
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat); m.frustumCulled = false; m.renderOrder = -1000; g.add(m);
      S.sky = {mat, mesh: m};
      cleanup = () => { mat.dispose(); m.geometry.dispose(); };
      S.upd = (it, I, t) => {
        const pr = it.preset || 'day', u = mat.uniforms, el = nz(it.elev, 25) * DEG, az = nz(it.sun, 35) * DEG;
        const P = {day: ['#2f7fe0', '#cfe6ff', '#9cb6c9', 1, 0, 0], sunset: ['#3d4a9c', '#ff9a52', '#4a3a52', 1, 0, 0], night: ['#05071a', '#111a3a', '#05060f', .08, 1, 0], storm: ['#2a2f3a', '#59606b', '#2f343c', .15, 0, 1]}[pr];
        if (!P) { u.uTop.value.set(it.color); u.uHor.value.set(it.horizon || '#cfe6ff'); u.uBot.value.copy(u.uHor.value).multiplyScalar(.75); u.uDark.value = 1; u.uStars.value = 0; u.uStorm.value = 0; }
        else { u.uTop.value.set(P[0]); u.uHor.value.set(P[1]); u.uBot.value.set(P[2]); u.uDark.value = P[3]; u.uStars.value = P[4]; u.uStorm.value = P[5]; }
        u.uSunC.value.set(pr === 'night' ? '#e8eeff' : pr === 'sunset' ? '#ffb15c' : '#fff3c4');
        const e2 = pr === 'sunset' ? Math.min(el, 12 * DEG) : el;
        u.uSun.value.set(Math.cos(az) * Math.cos(e2), Math.sin(e2), -Math.sin(az) * Math.cos(e2));
        u.uCloud.value = clamp(nz(it.clouds, .5), 0, 1) * clamp(I, 0, 1.5); u.uT.value = t * nz(it.speed, 1);
      };
      break;
    }
  }
  if (hasGizmo(id)) {      // khung vùng hiệu ứng + chấm chọn (dùng để bấm chọn bằng chuột)
    const hp = new THREE.Group();
    const bx = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({color: 0x9a83ff, depthTest: false, transparent: true, opacity: .8}));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 8), new THREE.MeshBasicMaterial({color: 0x9a83ff, depthTest: false, transparent: true, opacity: .9}));
    hp.add(bx, dot); hp.traverse(o => { o.renderOrder = 997; });
    g.add(hp); S.hp = hp; S.hpBox = bx; S.hpDot = dot;
  }
  scene.add(g);
  S.dispose = () => {
    for (const l of L) l.dispose();
    if (cleanup) cleanup();
    if (S.hp) { S.hpBox.geometry.dispose(); S.hpBox.material.dispose(); S.hpDot.geometry.dispose(); S.hpDot.material.dispose(); }
    for (const o of roots) o.removeFromParent();
    g.removeFromParent();
  };
  return S;
}

/* ============================================================
   Lớp phủ toàn khung: viền tối, nhiễu hạt, chớp sáng, viền đen, phủ màu — một quad duy nhất
   ============================================================ */
function makeScreenQuad(scene) {
  const U = {uVig: {value: 0}, uVigS: {value: .75}, uVigC: {value: new THREE.Color('#000000')}, uGrain: {value: 0}, uGrainS: {value: 1.5}, uT: {value: 0}, uFlash: {value: 0}, uFlashC: {value: new THREE.Color('#ffffff')}, uBars: {value: 0}, uBarC: {value: new THREE.Color('#000000')}, uTint: {value: 0}, uTintC: {value: new THREE.Color('#ff9a3c')}, uAsp: {value: 16 / 9}, uRatio: {value: 2.39}, uRes: {value: new THREE.Vector2(1280, 720)}};
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform float uVig,uVigS,uGrain,uGrainS,uT,uFlash,uBars,uAsp,uRatio,uTint; uniform vec3 uVigC,uFlashC,uBarC,uTintC; uniform vec2 uRes;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 rgb = vec3(0.); float a = 0.;
        if (uTint > 0.) { rgb = uTintC; a = uTint*.55; }
        if (uVig > 0.) { vec2 p = (vUv-.5)*vec2(uAsp,1.)*1.15; float va = smoothstep(uVigS*.55, uVigS*1.25, length(p))*uVig*.92;
          rgb = mix(rgb, uVigC, clamp(va/max(a+va,1e-4),0.,1.)); a = a + va*(1.-a); }
        if (uGrain > 0.) { float cell = max(1., uGrainS*uRes.y/720.); vec2 g = floor(vUv*uRes/cell) + floor(uT*24.)*vec2(37.,17.); float n = h21(g)-.5;
          float ga = abs(n)*uGrain*.55; rgb = mix(rgb, n > 0. ? vec3(1.) : vec3(0.), clamp(ga/max(a+ga,1e-4),0.,1.)); a = a + ga*(1.-a); }
        if (uFlash > 0.) { float fa = clamp(uFlash,0.,1.); rgb = mix(rgb, uFlashC, clamp(fa/max(a+fa,1e-4),0.,1.)); a = a + fa*(1.-a); }
        if (uBars > 0.) { float bar = max((1.-uAsp/uRatio)*.5, 0.)*uBars; float m = step(vUv.y, bar) + step(1.-bar, vUv.y); rgb = mix(rgb, uBarC, m); a = max(a, m); }
        if (a < .002) discard;
        gl_FragColor = vec4(rgb, clamp(a,0.,1.));
        #include <colorspace_fragment>
      }`
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false; m.renderOrder = 990; m.visible = false;
  // Lớp phủ nằm trong scene riêng, vẽ sau hậu kỳ (glow / biến dạng) → không bị méo hay nhòe theo.
  const ov = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); ov.add(m);
  return {m, U, scene: ov, cam, dispose() { m.geometry.dispose(); mat.dispose(); m.removeFromParent(); }};
}

/* ============================================================
   Bộ máy
   ============================================================ */
export function createFxEngine(scene, camera) {
  const rt = new Map(), screen = makeScreenQuad(scene), post = {amp: 0, type: 0, glow: 0, speed: 1, t: 0};
  const fog = new THREE.FogExp2(0xc9d3df, 0); scene.fog = fog;     // luôn có sương (mật độ 0) để vật liệu không phải biên dịch lại khi bật / tắt
  const saved = {p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 35, on: false};
  const tmp = new THREE.Vector3(), tmpq = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), target = new THREE.Vector3();

  return {
    rt, screen, post,
    /** Tạo / xoá runtime cho khớp danh sách item. Trả true nếu có thay đổi. */
    sync(items) {
      let ch = false; const live = new Set();
      for (const it of items) {
        if (!hasGizmo(it.fx) && !(FX[it.fx] && FX[it.fx].noGizmo)) continue;
        live.add(it.id);
        let r = rt.get(it.id);
        if (r && r.kind !== it.fx) { r.dispose(); rt.delete(it.id); r = null; ch = true; }
        if (!r) { try { r = makeRuntime(it, scene); rt.set(it.id, r); ch = true; } catch (e) { console.warn('FX lỗi', it.fx, e); } }
      }
      for (const [id, r] of rt) if (!live.has(id)) { r.dispose(); rt.delete(id); ch = true; }
      return ch;
    },
    clear() { for (const r of rt.values()) r.dispose(); rt.clear(); },
    /** Tính trạng thái ở thời điểm t (gọi mỗi khung hình, sau sync). */
    update(items, t, ctx = {}) {
      const wind = windAt(items, t), sc = screen.U;
      let fogD = 0, fogC = null, flash = 0;
      sc.uVig.value = 0; sc.uGrain.value = 0; sc.uBars.value = 0; sc.uTint.value = 0; sc.uT.value = t;
      post.amp = 0; post.glow = 0; post.type = 0; post.speed = 1; post.t = t;
      if (ctx.view && ctx.view.w > 0 && ctx.view.h > 0) { sc.uAsp.value = ctx.view.w / ctx.view.h; sc.uRes.value.set(ctx.view.w, ctx.view.h); }
      for (const it of items) {
        const d = FX[it.fx]; if (!d) continue;
        const e = it.on === false ? 0 : envelope(it, t);
        if (d.screen) {
          if (!e) continue;
          const I = nz(it.intensity, 1) * e, a = t - (+it.start || 0), D = Math.max(.01, nz(it.dur, 1)), sp = nz(it.speed, 1);
          if (it.fx === 'glow') { post.glow = Math.max(post.glow, clamp(I, 0, 1)); }
          else if (it.fx === 'distort') { const am = clamp(I, 0, 1.5); if (am > post.amp) { post.amp = am; post.type = Math.max(0, DISTORT_KINDS.findIndex(x => x[0] === it.kind)); post.speed = sp; } }
          else if (it.fx === 'vignette') { sc.uVig.value = Math.max(sc.uVig.value, clamp(I, 0, 1.5)); sc.uVigS.value = nz(it.size, .75); sc.uVigC.value.set(it.color || '#000000'); }
          else if (it.fx === 'grain') { sc.uGrain.value = Math.max(sc.uGrain.value, clamp(I, 0, 2)); sc.uGrainS.value = nz(it.size, 1.5); }
          else if (it.fx === 'flash') {
            const n = Math.max(1, Math.round(nz(it.times, 1))), u = clamp(a * sp / D, 0, 1); let f;
            if (it.curve === 'hold') f = sstep(0, .25, u);
            else if (it.curve === 'strobe') f = Math.floor(u * n * 2) % 2 === 0 ? 1 : 0;
            else { const k = u * n, fr = k - Math.floor(k); f = Math.exp(-fr * 7) * (fr < .02 ? fr / .02 : 1); }
            flash = Math.max(flash, f * clamp(I, 0, 1.5)); sc.uFlashC.value.set(it.color || '#ffffff');
          }
          else if (it.fx === 'letterbox') { sc.uBars.value = Math.max(sc.uBars.value, clamp(I, 0, 1)); sc.uRatio.value = nz(it.ratio, 2.39); sc.uBarC.value.set(it.color || '#000000'); }
          else if (it.fx === 'tint') { sc.uTint.value = Math.max(sc.uTint.value, clamp(I, 0, 1.5)); sc.uTintC.value.set(it.color || '#ff9a3c'); }
          continue;
        }
        if (d.cam) continue;
        const r = rt.get(it.id); if (!r) continue;
        const inten = nz(it.intensity, 1), I = inten * e, spd = nz(it.speed, 1), lt = Math.max(0, t - (+it.start || 0));
        const active = e > 0 && inten > 0, showHp = !!r.hp && it.helper !== false && !ctx.exporting;
        r.g.visible = active || showHp;
        for (const l of r.L) l.mesh.visible = active;
        if (r.im) r.im.visible = active;
        if (r.sky) r.sky.mesh.visible = active;
        if (r.bolts && !active) { for (const b of r.bolts) b.visible = false; r.flashV = 0; }
        if (r.hp) r.hp.visible = showHp;
        const bx = r.box;
        if (r.sky) { r.g.position.set(0, 0, 0); r.g.rotation.set(0, 0, 0); r.g.scale.set(1, 1, 1); }
        else {
          r.g.position.set(nz(it.x, 0), nz(it.y, 0), nz(it.z, 0)); r.g.rotation.order = 'YXZ';
          r.g.rotation.set(nz(it.rx, 0) * DEG, nz(it.rot, 0) * DEG, nz(it.rz, 0) * DEG); r.g.scale.set(nz(it.sx, 1), nz(it.sy, 1), nz(it.sz, 1));
          r.g.updateMatrix(); r.xf.copy(r.g.matrix);
        }
        const kscale = (Math.abs(r.g.scale.x) + Math.abs(r.g.scale.y) + Math.abs(r.g.scale.z)) / 3;
        r.worldTop = r.g.position.y + bx[1] * Math.abs(r.g.scale.y) / 2;
        if (r.hp) { r.hpBox.scale.set(bx[0], bx[1], bx[2]); r.hpDot.scale.set(1 / (r.g.scale.x || 1), 1 / (r.g.scale.y || 1), 1 / (r.g.scale.z || 1)); }
        if (!active) continue;
        for (const l of r.L) {
          const U = l.U;
          U.uBox.value.set(bx[0], bx[1], bx[2]); U.uT.value = lt; U.uSpeed.value = spd; U.uScale.value = kscale; U.uSeed.value = nz(it.seed, 1);
          U.uWind.value.set(wind[0], 0, wind[1]); U.uInt.value = I;
        }
        if (r.upd) r.upd(it, I, t, wind, kscale, spd, lt);
        if (it.fx === 'fog') { const dn = nz(it.density, .35) * I; if (dn > fogD) { fogD = dn; fogC = it.color; } }
        if (it.fx === 'lightning' && r.flashV) flash = Math.max(flash, clamp(r.flashV, 0, 1) * .55);
      }
      fog.density = fogD * .06; if (fogC) fog.color.set(fogC);
      sc.uFlash.value = flash;
      screen.m.visible = sc.uVig.value > 0 || sc.uGrain.value > 0 || flash > 0 || sc.uBars.value > 0 || sc.uTint.value > 0;
    },
    /** Áp độ lệch camera ngay trước khi vẽ / chọn. Luôn gọi camEnd() sau đó để trả camera về (OrbitControls không bị ảnh hưởng). */
    camBegin(items, t, target0) {
      const o = camOffsets(items, t);
      if (!o.any) return false;
      saved.on = true; saved.p.copy(camera.position); saved.q.copy(camera.quaternion); saved.fov = camera.fov;
      const tgt = target0 || target;
      if (o.orbit) {
        tmp.copy(camera.position).sub(tgt); const c = Math.cos(o.orbit), s = Math.sin(o.orbit);
        camera.position.set(tgt.x + tmp.x * c + tmp.z * s, camera.position.y, tgt.z - tmp.x * s + tmp.z * c); camera.lookAt(tgt);
      }
      if (o.dolly) { tmpv.copy(tgt).sub(camera.position); const Ln = tmpv.length(); if (Ln > 1e-3) camera.position.addScaledVector(tmpv.normalize(), clamp(o.dolly, -50, Math.max(0, Ln - .3))); }
      if (o.yaw) { tmpq.setFromAxisAngle(up, o.yaw); camera.quaternion.premultiply(tmpq); }        // lia quanh trục đứng của thế giới (như chân máy)
      if (o.pitch || o.roll) { tmpE.set(o.pitch, 0, o.roll, 'YXZ'); tmpq.setFromEuler(tmpE); camera.quaternion.multiply(tmpq); }
      if (o.dx || o.dy || o.dz) { tmp.set(o.dx, o.dy, o.dz).applyQuaternion(camera.quaternion); camera.position.add(tmp); }
      if (o.fov) { camera.fov = clamp(saved.fov + o.fov, 5, 120); camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld(true);
      return true;
    },
    camEnd() {
      if (!saved.on) return; saved.on = false;
      camera.position.copy(saved.p); camera.quaternion.copy(saved.q);
      if (camera.fov !== saved.fov) { camera.fov = saved.fov; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld(true);
    },
    setTarget(v) { target.copy(v); },
    /** Vẽ lớp phủ màn hình (vignette, nhiễu, chớp, viền đen, phủ màu) lên khung vừa vẽ xong. Gọi SAU hậu kỳ. */
    overlay(r) {
      if (!screen.m.visible) return;
      const ac = r.autoClear; r.autoClear = false; r.render(screen.scene, screen.cam); r.autoClear = ac;
    },
    hideHelpers() { for (const r of rt.values()) if (r.hp) r.hp.visible = false; },
    dispose() { for (const r of rt.values()) r.dispose(); rt.clear(); screen.dispose(); scene.fog = null; }
  };
}
