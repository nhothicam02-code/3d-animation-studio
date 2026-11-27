import * as THREE from 'three';
import {createScatter, layerDefaults} from './scatter-kit.js';
export {LAYER_KINDS, layerDefaults, layerFields, layerOf, groundInfo} from './scatter-kit.js';

/* ============================================================
   Nền cảnh cho Studio — MỘT đường ống hình ảnh duy nhất.
   ------------------------------------------------------------
   Nguyên tắc:  NỀN = địa điểm (mỗi cảnh một cái)   ·   HIỆU ỨNG = thứ xảy ra trong địa điểm (fx-kit.js).

   Các loại nền (s.bgt):
     'color' 'grad' 'img' 'vid'   nền phẳng — vẽ BÊN TRONG WebGL (không còn lớp HTML riêng),
                                  nên sương mù, mờ ảo, biến dạng không khí… áp được lên ảnh / video.
     'env'                        môi trường 3D: bầu trời / đêm sao / studio / nhà / lớp học / bóng râm / nắng gắt / sa mạc / rừng rậm / trên mây / dưới nước.
     'pano'                       ảnh 360° (equirectangular 2:1), xoay được, tuỳ chọn làm ánh sáng phản chiếu.

   Thứ tự vẽ mỗi khung hình (render):
     nền → cảnh 3D (nhân vật, mô hình, hạt) → hậu kỳ [mờ ảo + biến dạng] → lớp phủ màn hình [viền tối, nhiễu, viền đen…]
   Hậu kỳ + lớp phủ + sương mù lấy từ fx-kit (khối hiệu ứng trên timeline), nên bật / tắt / hiện dần theo thời gian.

   Sương mù: fx 'fog' ghi vào scene.fog → vật thể + phòng (nhà / lớp học) mờ theo khoảng cách;
   bầu trời, ảnh 360° và nền phẳng được phủ một lớp sương (haze) cùng màu, nên nền KHÔNG còn nét hơn nhân vật.

   Mọi thứ tính từ thời gian t → tua / xuất video cho kết quả giống hệt lúc xem.

   API:
     const env = createEnvEngine(scene, camera, renderer)
     env.setLights(hemiLight, dirLight)                // đèn mặc định của Studio
     env.update(sceneData, t, {url, custom, aspect, bg, post})
         url    : ảnh 360° (khi bgt='pano')
         custom : true nếu cảnh có đèn riêng (không ghi đè đèn)
         bg     : mô tả nền phẳng {type:'color'|'grad'|'img'|'vid', c1, c2, ang, fit, z, x, y, url, el, force}
                  (force = khối "nền màu" trên timeline đang phủ lên mọi loại nền)
         post   : fxEngine.post  ({amp, type, glow, speed, t})
     env.render(renderer, scene, camera, fxEngine)     // thay cho renderer.render
     env.preload(url)                                  // chờ ảnh tải xong (xuất video)
     env.refresh()                                     // báo có tài nguyên mới (video sẵn sàng…)
   ============================================================ */

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sh = (c, k) => { const o = new THREE.Color(c); o.multiplyScalar(k); return '#' + o.getHexString(); };

/** Chỉ còn các ĐỊA ĐIỂM. Sương mù / mờ ảo / hơi nóng / sóng nước chuyển sang tab Hiệu ứng (xem ENV_BUNDLES). */
export const ENV_PRESETS = [
  ['sky', '☀️ Bầu trời'], ['night', '🌙 Đêm sao'], ['studio', '🎬 Studio'], ['house', '🏠 Trong nhà'],
  ['classroom', '🏫 Lớp học'], ['shade', '🌳 Bóng râm'], ['sun', '🔆 Nắng gắt'], ['desert', '🏜 Sa mạc'], ['jungle', '🌴 Rừng rậm'], ['cloudsea', '☁️ Trên mây'], ['underwater', '🌊 Dưới nước'],
  ['meadow', '🌿 Đồng cỏ'], ['trail', '🥾 Đường mòn'], ['plains', '🌾 Đồng bằng'], ['street', '🛣 Đường phố'],
  ['arctic', '❄️ Bắc cực'], ['arcticnight', '🌌 Bắc cực đêm (cực quang)'], ['cobble', '🪨 Đường đá cuội'], ['gravel', '⚪ Đường sỏi'],
  ['lake', '🏞 Mặt hồ sương sớm'], ['river', '🛶 Dòng sông'], ['stream', '💦 Con suối'], ['sea', '🏖 Biển gợn sóng']
];
const BASE = {c1: '#2f7fe0', c2: '#cfe6ff', c3: '#7d8f6a', sc: '#fff4e0', light: 1, hk: 1, lk: 1, hc: '#ffffff', hg: '#666070', lc: '#ffffff', speed: 1,
  sun: 0, az: 120, el: 24, sl: false, stars: 0, clouds: 0, rays: 0, rc: '#bff5ff', canopy: 0, dunes: 0, sea: 0, rot: 0, exp: 1, ibl: false, plock: true, pzoom: 1, pgh: 0, room: '', gnd: 0, gc2: '#c9a86a', hills: 0, bld: 0, gdens: 1, gsize: 1, fdens: .035, pw: 1.15, pcurve: 1, gfar: 90, gh: 1.3, bdens: 22, wdist: 24, water: 1, bergs: 0, aurora: 0, anchor: false,
  wk: 0, wfar: 70, wcx: 6, wamp: 1, wflow: 1, wclear: .6, mist: 0, beam: 0};
const PRE = {
  sky: {c1: '#2f7fe0', c2: '#cfe6ff', c3: '#7d8f6a', sun: .7, clouds: .5, lc: '#fff4e0', lk: 1.05, hc: '#bcd8ff', hg: '#6a6a58'},
  night: {c1: '#04081c', c2: '#1b2a52', c3: '#0a0f1e', sc: '#dfe8ff', sun: .8, az: 200, el: 30, stars: .9, clouds: .2, lc: '#8fa8ff', lk: .45, hc: '#4660a8', hg: '#101830', hk: .6},
  studio: {c1: '#4a4f5c', c2: '#8a90a0', c3: '#2a2d36', light: 1.1, hk: 1.1, lk: .9},
  house: {room: 'house', c1: '#f1e9dc', c2: '#e8d5b5', c3: '#a8794a', hc: '#ffe9c8', hg: '#7a5a3a', hk: 1.1, lc: '#ffd9a8', lk: .8},
  classroom: {room: 'classroom', c1: '#f2f2ee', c2: '#e9e4cf', c3: '#b7a98f', hc: '#f4f8ff', hg: '#8a8a80', hk: 1.2, lc: '#ffffff', lk: .8},
  shade: {c1: '#5d8f86', c2: '#a9c4bd', c3: '#3b5a3d', canopy: .55, sun: 0, lc: '#bcd4ff', lk: .5, hc: '#a6c8c0', hg: '#30463a', hk: .9},
  sun: {c1: '#6ab2ff', c2: '#fff7e0', c3: '#c9b27a', sc: '#fff3cf', sun: 1.2, el: 38, clouds: .1, lc: '#fff1c8', lk: 1.8, hc: '#ffffff', hg: '#c9a86a', hk: .8},
  desert: {c1: '#3f86d6', c2: '#ffe2b8', c3: '#d9b072', sc: '#fff1cc', sun: 1.1, el: 42, az: 140, clouds: .08, dunes: 1, lc: '#fff0cc', lk: 1.7, hc: '#ffeccc', hg: '#c9a266', hk: .9},
  jungle: {c1: '#2d6a3f', c2: '#9fc77a', c3: '#1b3a22', sc: '#fff0b0', sun: .3, el: 55, az: 100, canopy: .8, rays: .5, rc: '#fff0a8', lc: '#d9f0b0', lk: .55, hc: '#8fc08a', hg: '#22381f', hk: .85},
  cloudsea: {c1: '#1e5fc0', c2: '#bfe0ff', c3: '#a9c3e6', sc: '#fff6dc', sun: 1.2, el: 30, az: 120, clouds: .15, sea: 1, lc: '#fff4dc', lk: 1.6, hc: '#cfe6ff', hg: '#dfeaff', hk: 1.1},
  underwater: {c1: '#06385a', c2: '#1b8aa6', c3: '#0a3a4a', rays: .8, el: 80, lc: '#9fe6ff', lk: .9, hc: '#5fc3dc', hg: '#0b3346', hk: .9},
  meadow: {c1: '#3a8ee8', c2: '#dff0ff', c3: '#5fa83e', gc2: '#ffd84a', gnd: 1, hills: .5, sun: .7, el: 35, clouds: .45, lc: '#fff4dc', lk: 1.2, hc: '#c8e4ff', hg: '#5a7a3a'},
  trail: {c1: '#3a86d8', c2: '#d6ebff', c3: '#4f9438', gc2: '#b89868', gnd: 2, hills: .7, sun: .7, el: 32, clouds: .4, lc: '#fff2d6', lk: 1.15, hc: '#c4e0ff', hg: '#4a6a32'},
  plains: {c1: '#2f7fe0', c2: '#e4efff', c3: '#8aa84a', gc2: '#d6c060', gnd: 3, hills: .15, sun: .8, el: 40, clouds: .6, lc: '#fff4dc', lk: 1.3, hc: '#d2e6ff', hg: '#8a9a50'},
  street: {c1: '#4a8ad8', c2: '#cfe0f0', c3: '#8a8e96', gc2: '#3a3d44', gnd: 4, bld: 1, pw: 3.25, sun: .6, el: 35, clouds: .3, lc: '#fff6e6', lk: 1.1, hc: '#d0e0f4', hg: '#6a6e76'},
  arctic: {c1: '#5b8cc4', c2: '#dcebf7', c3: '#eef4fa', sc: '#fff1de', sun: .55, az: 140, el: 9, clouds: .35, gnd: 5, gc2: '#0f5a7d', gfar: 150, gh: 1.5, gdens: 1, gsize: 1, wdist: 26, water: 1, bergs: .75, anchor: true, hills: 0, lc: '#fff0dc', lk: 1.05, hc: '#cfe3f7', hg: '#a9bfd6', hk: 1.05},
  arcticnight: {c1: '#02050f', c2: '#0b2240', c3: '#6a82a0', sc: '#dfe8ff', sun: .5, az: 200, el: 24, stars: .9, aurora: 1, clouds: .1, gnd: 5, gc2: '#04182a', gfar: 150, gh: 1.5, wdist: 26, water: 1, bergs: .6, anchor: true, lc: '#9fb8ff', lk: .55, hc: '#4a64a8', hg: '#2a3a58', hk: .75},
  cobble: {c1: '#3a86d8', c2: '#d6ebff', c3: '#5a8a3a', sc: '#fff4dc', gc2: '#8e8982', gnd: 6, pw: 2.2, pcurve: .6, hills: .6, sun: .7, el: 32, clouds: .4, gh: 1.4, gfar: 110, anchor: true, lc: '#fff2d6', lk: 1.15, hc: '#c4e0ff', hg: '#4a6a32'},
  gravel: {c1: '#3a86d8', c2: '#d6ebff', c3: '#6f7a4a', sc: '#fff4dc', gc2: '#b9ad99', gnd: 7, pw: 2.4, pcurve: .9, hills: .6, sun: .75, el: 36, clouds: .35, gh: 1.4, gfar: 110, anchor: true, lc: '#fff2d6', lk: 1.2, hc: '#c4e0ff', hg: '#5a6a3a'},
  /* ---- địa điểm có NƯỚC (gnd 8): wk 0 hồ · 1 sông · 2 suối · 3 biển ---- */
  lake: {c1: '#5b9be0', c2: '#f6e9d2', c3: '#5f8f46', sc: '#ffe2b0', gc2: '#2d6f78', gnd: 8, wk: 0, wdist: 5, wfar: 75, wamp: .7, wflow: .3, wclear: .5, hills: .85, sun: .7, az: 105, el: 12, clouds: .3, rays: .4, rc: '#ffe9b8', mist: .5, beam: .4, gh: 1.2, gfar: 160, anchor: true, lc: '#ffe3bd', lk: 1.1, hc: '#cfe0f3', hg: '#5a7a3a', hk: 1},
  river: {c1: '#4a95e0', c2: '#e8f2ff', c3: '#5d9a3b', sc: '#fff4d6', gc2: '#2a7f88', gnd: 8, wk: 1, wcx: 4, pw: 6, pcurve: .9, wamp: 1, wflow: 1.2, wclear: .55, hills: .5, sun: .95, az: 120, el: 36, clouds: .4, mist: .12, beam: .15, gh: 1.5, gfar: 150, anchor: true, lc: '#fff3d6', lk: 1.3, hc: '#c8e0ff', hg: '#4f7a38', hk: 1},
  stream: {c1: '#5d8f86', c2: '#cfe3c8', c3: '#46803a', sc: '#fff0b8', gc2: '#3b8c86', gnd: 8, wk: 2, wcx: 1.8, pw: 1.8, pcurve: 1.5, wamp: .8, wflow: 1.8, wclear: .9, hills: .15, sun: .35, az: 110, el: 48, canopy: .28, rays: .65, rc: '#fff1b0', mist: .2, beam: .45, gh: 1, gfar: 70, anchor: true, lc: '#e6f2c8', lk: .8, hc: '#a6c8b0', hg: '#2e4a30', hk: .9},
  sea: {c1: '#2f86e8', c2: '#dff1ff', c3: '#e6d3a4', sc: '#fff3d2', gc2: '#0d6c9a', gnd: 8, wk: 3, wdist: 8, wamp: 1.2, wflow: .9, wclear: .7, hills: 0, sun: 1, az: 125, el: 26, clouds: .3, mist: .18, beam: .2, gh: 1.5, gfar: 220, anchor: true, lc: '#fff1d4', lk: 1.45, hc: '#cfe6ff', hg: '#c9b88a', hk: 1},
  pano: {}
};
/** "Thêm hiệu ứng đi kèm": mỗi địa điểm gợi ý vài khối hiệu ứng — thêm vào timeline để sửa / xoá tuỳ ý (không còn ẩn trong thanh trượt của nền). */
export const ENV_BUNDLES = {
  sky: [],
  night: [{fx: 'fog', color: '#1b2a52', density: .12}],
  studio: [{fx: 'glow', intensity: .12}],
  house: [{fx: 'dust'}],
  classroom: [{fx: 'dust'}],
  shade: [{fx: 'fog', color: '#a9c4bd', density: .15}, {fx: 'glow', intensity: .2}],
  sun: [{fx: 'distort', kind: 'heat', intensity: .3}, {fx: 'glow', intensity: .35}],
  desert: [{fx: 'distort', kind: 'heat', intensity: .35}, {fx: 'dust', color: '#e8c98a'}, {fx: 'fog', color: '#f0d8a8', density: .1}, {fx: 'glow', intensity: .3}],
  jungle: [{fx: 'fog', color: '#a8c98a', density: .22}, {fx: 'leaves'}, {fx: 'dust', color: '#fff2b0'}, {fx: 'glow', intensity: .15}],
  cloudsea: [{fx: 'glow', intensity: .25}],
  meadow: [{fx: 'wind'}, {fx: 'glow', intensity: .15}],
  trail: [{fx: 'leaves'}, {fx: 'dust', color: '#e8d9a8'}],
  plains: [{fx: 'wind'}, {fx: 'glow', intensity: .15}],
  street: [{fx: 'dust'}, {fx: 'glow', intensity: .12}],
  arctic: [{fx: 'snow', intensity: .5}, {fx: 'fog', color: '#dcebf7', density: .07}, {fx: 'glow', intensity: .2}],
  arcticnight: [{fx: 'snow', intensity: .35}, {fx: 'fog', color: '#0b2240', density: .06}, {fx: 'glow', intensity: .3}],
  cobble: [{fx: 'dust', color: '#e8d9a8'}, {fx: 'leaves'}],
  gravel: [{fx: 'dust', color: '#e8d9a8'}, {fx: 'wind'}],
  lake: [{fx: 'fog', color: '#eef0ee', density: .1}, {fx: 'petals', intensity: .3}, {fx: 'glow', intensity: .3}],
  river: [{fx: 'wind'}, {fx: 'leaves', color: '#9cc24a', color2: '#e0c04a', intensity: .35}, {fx: 'glow', intensity: .2}],
  stream: [{fx: 'fog', color: '#d9e8d2', density: .12}, {fx: 'dust', color: '#fff2b0'}, {fx: 'leaves', color: '#8fbf3f', color2: '#c9b04a', intensity: .25}, {fx: 'glow', intensity: .3}],
  sea: [{fx: 'wind'}, {fx: 'glow', intensity: .25}, {fx: 'fog', color: '#e8f2fa', density: .05}],
  underwater: [{fx: 'fog', color: '#1b8aa6', density: .5}, {fx: 'distort', kind: 'wave', intensity: .35}, {fx: 'glow', intensity: .25}]
};
export const envBundle = k => ENV_BUNDLES[k] || [];
/** Cảnh vật rải sẵn cho từng địa điểm có nước (bấm chọn địa điểm → tự thêm vào các lớp rải; sửa / xoá tuỳ ý trong khung “Rải cây cối”). */
const ENV_LAYERS = {
  lake: [
    ['grass', {density: 420, near: .3, far: 13, seed: 3}], ['flower', {density: 70, near: .6, far: 11, color: '#ff8fbd', color2: '#fff2a8', seed: 5}],
    ['reed', {density: 55, near: .4, far: 30, size: 1.15, seed: 7}], ['bush', {density: 3, near: 3, far: 24, size: 1.5, seed: 4}],
    ['rock', {density: 2.6, near: 2.5, far: 30, size: .95, where: 'any', seed: 9}], ['pebble', {density: 520, near: .3, far: 12, where: 'shore', seed: 2}],
    ['lilypad', {density: 22, near: 5, far: 38, seed: 11}], ['lotus', {density: 5, near: 6, far: 34, seed: 12}],
    ['leaf', {density: 10, near: 2, far: 34, seed: 13}], ['petal', {density: 55, near: 1.5, far: 28, seed: 14}]],
  river: [
    ['grass', {density: 380, near: .3, far: 12, seed: 3}], ['flower', {density: 60, near: .6, far: 11, color: '#fff6d0', color2: '#ffd23f', seed: 5}],
    ['reed', {density: 45, near: .4, far: 30, seed: 7}], ['bush', {density: 3, near: 3, far: 26, size: 1.5, seed: 4}],
    ['rock', {density: 3, near: 2.5, far: 30, size: .9, where: 'any', seed: 9}], ['cobble', {density: 120, near: .4, far: 12, where: 'shore', seed: 2}],
    ['leaf', {density: 16, near: 1.5, far: 34, seed: 13}], ['petal', {density: 60, near: 1.5, far: 30, seed: 14}]],
  stream: [
    ['grass', {density: 520, near: .3, far: 11, seed: 3}], ['flower', {density: 80, near: .5, far: 9, color: '#c9a6ff', color2: '#fff4a0', seed: 5}],
    ['bush', {density: 4, near: 2.5, far: 18, size: 1.3, color: '#2c6a3a', seed: 4}], ['rock', {density: 7, near: 1.2, far: 22, size: .8, where: 'any', seed: 9}],
    ['cobble', {density: 260, near: .3, far: 10, where: 'any', seed: 2}], ['pebble', {density: 900, near: .3, far: 9, where: 'shore', seed: 6}],
    ['leaf', {density: 14, near: 1, far: 22, size: .9, seed: 13}], ['petal', {density: 40, near: 1, far: 20, seed: 14}]],
  sea: [
    ['grass', {density: 140, near: 3, far: 22, color: '#8aa84a', color2: '#d6d27a', where: 'off', seed: 3}], ['rock', {density: 3.2, near: 3, far: 34, size: 1.1, where: 'any', seed: 9}],
    ['cobble', {density: 90, near: .4, far: 14, where: 'shore', color: '#a89f90', seed: 2}], ['petal', {density: 22, near: 2, far: 26, seed: 14}],
    ['bush', {density: 2.2, near: 5, far: 28, size: 1.2, color: '#4f7f3a', color2: '#9ab45a', where: 'off', seed: 4}]]
};
export const presetLayers = k => (ENV_LAYERS[k] || []).map(([kind, o]) => ({...layerDefaults(kind), ...o}));
export const envDefaults = k => { k = PRE[k] ? k : 'sky'; return {preset: k, ...BASE, ...PRE[k]}; };
export const envParams = s => { const e = s && s.env, k = e && PRE[e.preset] ? e.preset : 'sky'; return {...envDefaults(k), ...(e || {}), preset: k}; };

/** Danh sách trường chỉnh: [khoá, nhãn, kiểu('r' thanh trượt | 'c' màu | 'b' bật tắt), min, max, step].
 *  kind: 'env' (môi trường 3D) | 'pano' (ảnh 360°). Mờ ảo / biến dạng / sương mù KHÔNG còn ở đây — chúng là hiệu ứng. */
export function envFields(P, kind) {
  if (kind === 'pano') return [['rot', 'Xoay ảnh 360° (độ)', 'r', -180, 180, 1], ['exp', 'Độ sáng ảnh', 'r', 0, 3, .01], ['ibl', 'Dùng ảnh làm ánh sáng phản chiếu cho nhân vật', 'b'], ['plock', 'Khoá nền 360° — kích thước nền không đổi khi camera tiến / lùi (tắt thì mới dùng “gắn sàn” bên dưới)', 'b'], ['pzoom', 'Thu phóng nền 360° (1 = gốc, >1 phóng to, <1 thu nhỏ) — chỉ đổi nền, không đổi nhân vật', 'r', .5, 3, .01], ['pgh', 'Gắn sàn ảnh vào sàn nhân vật — độ cao máy chụp (m), 0 = tắt. Khoảng 1.5: nhân vật khớp tỉ lệ khi quay toàn cảnh', 'r', 0, 4, .05]];
  const f = P.room ? [['c1', 'Màu trần', 'c'], ['c2', 'Màu tường', 'c'], ['c3', 'Màu sàn', 'c']] : [['c1', 'Màu đỉnh trời', 'c'], ['c2', 'Màu chân trời', 'c'], ['c3', 'Màu mặt đất', 'c']];
  f.push(['light', 'Cường độ ánh sáng', 'r', 0, 3, .01]);
  if (!P.room && P.gnd) {
    f.push(['gc2', ({1: 'Màu hoa', 2: 'Màu đường mòn', 4: 'Màu mặt đường', 5: 'Màu nước biển', 6: 'Màu đá cuội', 7: 'Màu sỏi', 8: 'Màu nước (nơi sâu)'})[P.gnd] || 'Màu ruộng', 'c'],
      ['gh', 'Độ cao mắt nhìn (m) — thấp: mặt đất kéo dài, cao: nhìn từ trên xuống', 'r', .3, 6, .05],
      ['gfar', 'Tầm nhìn xa (m) — mặt đất hòa vào chân trời', 'r', 15, 400, 1],
      ['gdens', 'Mật độ chi tiết mặt đất (cỏ, đá, hạt)', 'r', .2, 3, .01],
      ['gsize', 'Kích thước chi tiết mặt đất', 'r', .3, 3, .01],
      ['hills', 'Đồi xa ở chân trời', 'r', 0, 1, .01]);
    if (P.gnd === 1) f.push(['fdens', 'Mật độ hoa', 'r', 0, .3, .002]);
    if (P.gnd === 2) f.push(['pw', 'Độ rộng đường mòn (m)', 'r', .3, 4, .05], ['pcurve', 'Độ uốn đường mòn', 'r', 0, 3, .05]);
    if (P.gnd === 4) f.push(['pw', 'Độ rộng lòng đường (m)', 'r', 1, 8, .05], ['bld', 'Chiều cao dãy nhà', 'r', 0, 2, .01], ['bdens', 'Mật độ nhà (số toà quanh tầm nhìn)', 'r', 6, 60, 1]);
    if (P.gnd === 5) f.push(['water', 'Lượng nước biển (0 = toàn tuyết)', 'r', 0, 1, .01], ['wdist', 'Biển bắt đầu cách (m)', 'r', 4, 120, .5], ['bergs', 'Núi băng xa ở chân trời', 'r', 0, 1, .01]);
    if (P.gnd === 6 || P.gnd === 7) f.push(['pw', 'Độ rộng con đường (m)', 'r', .5, 12, .05], ['pcurve', 'Độ uốn con đường', 'r', 0, 3, .05]);
    if (P.gnd === 8) {
      f.push(['wamp', 'Độ gợn sóng', 'r', 0, 3, .01], ['wflow', P.wk === 3 ? 'Nhịp sóng vỗ bờ' : 'Tốc độ nước chảy / trôi', 'r', 0, 3, .01], ['wclear', 'Độ trong (thấy đáy ở chỗ nông)', 'r', 0, 1, .01]);
      if (P.wk === 0) f.push(['wdist', 'Bờ gần cách camera (m)', 'r', 1, 40, .1], ['wfar', 'Bờ đối diện cách (m)', 'r', 20, 300, 1]);
      if (P.wk === 3) f.push(['wdist', 'Mép nước cách camera (m)', 'r', 1, 60, .1]);
      if (P.wk === 1 || P.wk === 2) f.push(['wcx', 'Tim dòng chảy lệch ngang (m, + sang phải)', 'r', -20, 20, .1], ['pw', P.wk === 1 ? 'Nửa bề rộng sông (m)' : 'Nửa bề rộng suối (m)', 'r', .4, 14, .05], ['pcurve', 'Độ uốn khúc', 'r', 0, 3, .05]);
    }
    f.push(['anchor', 'Mặt đất bám theo thế giới 3D (khớp cỏ / hoa / đá rải & nhân vật; khi bật, bỏ qua “độ cao mắt nhìn”)', 'b']);
  }
  if (!P.room) f.push(['sun', 'Mặt trời / trăng (độ sáng)', 'r', 0, 2, .01], ['az', 'Hướng mặt trời (độ)', 'r', 0, 360, 1], ['el', 'Độ cao mặt trời (độ)', 'r', -10, 89, 1], ['sl', 'Ánh sáng lên nhân vật theo hướng mặt trời', 'b'],
    ['clouds', 'Mây', 'r', 0, 1, .01], ['stars', 'Sao', 'r', 0, 1, .01], ['aurora', 'Cực quang', 'r', 0, 1, .01], ['rays', 'Tia sáng (dưới nước, xuyên lá)', 'r', 0, 1, .01], ['rc', 'Màu tia sáng', 'c'], ['canopy', 'Tán lá che nắng', 'r', 0, 1, .01],
    ['dunes', 'Đụn cát ở chân trời', 'r', 0, 1, .01], ['sea', 'Biển mây bên dưới', 'r', 0, 1, .01],
    ['mist', 'Sương mờ sát mặt đất / mặt nước', 'r', 0, 1, .01], ['beam', 'Tia nắng xuyên sương (quanh mặt trời)', 'r', 0, 1, .01],
    ['speed', 'Tốc độ chuyển động (mây, tia sáng, sóng nước, sương)', 'r', 0, 4, .05]);
  return f;
}

/* ---------------- Bầu trời bằng shader (có sương phủ về phía chân trời) ---------------- */
const DOME_FS = `precision highp float; varying vec3 vD;
uniform vec3 uTop,uHor,uBot,uSunC,uSunD,uFogC,uRayC; uniform float uT,uSun,uStars,uClouds,uRays,uCanopy,uFogK,uDunes,uSea,uGnd,uHills,uBld,uGDens,uGSize,uFDens,uPW,uPCurve,uGFar,uGH,uBDens; uniform vec3 uGc2; uniform float uWDist,uWater,uBergs,uAurora; uniform vec2 uCam;
uniform float uWK,uWFar,uWCx,uWAmp,uWFlow,uWClear,uMist,uBeam;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(7.1,3.3);a*=.5;}return s;}
/* ---- nước: bản đồ bờ (khớp groundInfo trong scatter-kit.js) + độ dốc mặt sóng ---- */
float wsd(vec2 p){                     // > 0 trong nước (khoảng cách tới bờ, m), < 0 trên đất liền
  if(uWK<.5){ float sh=-uWDist+3.*sin(p.x*.15)+1.5*sin(p.x*.41+2.), fs=-uWFar+6.*sin(p.x*.07+1.)+3.*sin(p.x*.23); return min(sh-p.y,p.y-fs); }
  if(uWK<2.5){ float cx=uWCx+(sin(p.y*.11)*2.2+sin(p.y*.04+1.)*3.)*uPCurve, w=uPW*(1.+.2*sin(p.y*.3)); return w-abs(p.x-cx); }
  return -uWDist+2.2*sin(p.x*.12)+1.1*sin(p.x*.37+2.)-p.y;
}
vec2 wgrad(vec2 pp,float t,float lod){ // tổng các sóng sin nhiều hướng + gợn nhiễu nhỏ (lod: chi tiết mịn mờ dần theo khoảng cách)
  vec2 gr=vec2(.1,.99)*cos(dot(pp,vec2(.1,.99))*.45+t*.9)*.12;
  gr+=vec2(.8,.6)*cos(dot(pp,vec2(.8,.6))*.9+t*1.1)*.30;
  gr+=vec2(-.6,.8)*cos(dot(pp,vec2(-.6,.8))*1.7+t*1.5+1.3)*.22;
  gr+=vec2(.2,.98)*cos(dot(pp,vec2(.2,.98))*3.1+t*2.0+2.1)*.16*lod;
  gr+=vec2(.95,-.3)*cos(dot(pp,vec2(.95,-.3))*5.3+t*2.6+.7)*.11*lod;
  gr+=vec2(-.4,-.9)*cos(dot(pp,vec2(-.4,-.9))*8.9+t*3.4+4.)*.07*lod;
  vec2 q2=pp*3.2+vec2(0.,-t*.6); float e=.07, a=n2(q2);
  gr+=vec2(n2(q2+vec2(e,0.))-a,n2(q2+vec2(0.,e))-a)/e*.05*lod;
  return gr;
}
void main(){
  vec3 d=normalize(vD); float h=d.y;
  vec3 col=mix(uHor,uTop,pow(clamp(h,0.,1.),.55));
  col=mix(col,uBot,smoothstep(.02,-.25,h));
  float sd=max(dot(d,uSunD),0.);
  if(uDunes>0.){                       // hai lớp đụn cát: xa (nhạt, mờ) và gần
    float az=atan(d.z,d.x);
    float r0=uDunes*(.014+.016*sin(az*3.+1.)+.008*sin(az*8.+.5)), r1=uDunes*(-.012+.022*sin(az*2.+4.)+.010*sin(az*5.+2.));
    vec3 sandF=mix(uBot,uHor,.45)*(.9+.2*sd), sandN=uBot*(.8+.35*sd)*(.94+.06*sin(az*40.+h*200.));
    col=mix(col,sandF,smoothstep(.003,-.003,h-r0));
    col=mix(col,sandN,smoothstep(.003,-.003,h-r1));
  }
  if(uHills>0.){                       // đồi xa
    float az=atan(d.z,d.x);
    float r0=uHills*(.012+.05*fbm(vec2(az*2.2,3.))), r1=uHills*(.004+.028*fbm(vec2(az*3.7+9.,5.)));
    col=mix(col,mix(uBot,uHor,.6)*(.95+.1*sd),smoothstep(.003,-.003,h-r0));
    col=mix(col,mix(uBot,uHor,.3)*(.9+.15*sd),smoothstep(.003,-.003,h-r1));
  }
  if(uBergs>0.){                       // núi băng / tảng băng xa ngoài biển (hai lớp)
    float az=atan(d.z,d.x);
    float c0=floor(az*5.),u0=fract(az*5.),c1=floor(az*9.+2.),u1=fract(az*9.+2.);
    float r0=uBergs*step(.35,h21(vec2(c0,3.)))*(.014+.055*h21(vec2(c0,8.)))*smoothstep(0.,.3,1.-abs(u0*2.-1.))*(.72+.28*fbm(vec2(az*30.,c0)));
    float r1=uBergs*step(.4,h21(vec2(c1,13.)))*(.008+.03*h21(vec2(c1,18.)))*smoothstep(0.,.3,1.-abs(u1*2.-1.))*(.72+.28*fbm(vec2(az*44.,c1)));
    vec3 bf=mix(mix(vec3(.5,.72,.9),vec3(.95,.98,1.),smoothstep(0.,max(r0,.001),h)),uHor,.32)*(.9+.15*sd);
    vec3 bn=mix(mix(vec3(.45,.68,.88),vec3(.97,.99,1.),smoothstep(0.,max(r1,.001),h)),uHor,.12)*(.92+.15*sd);
    col=mix(col,bf,smoothstep(.002,-.002,h-r0)*step(.001,r0)*step(-.02,h));
    col=mix(col,bn,smoothstep(.002,-.002,h-r1)*step(.001,r1)*step(-.02,h));
  }
  if(uBld>0.){                         // dãy nhà dọc phố
    float az=atan(d.z,d.x); float cols=uBDens; float ci=floor(az*cols);
    float bh=uBld*(.03+.16*h21(vec2(ci,4.))); float fdist=h21(vec2(ci,9.))*.3;
    if(h<bh&&h>-.02){
      vec3 bc=mix(vec3(.55,.58,.64),uHor,.35+fdist)*(.8+.4*h21(vec2(ci,2.)));
      vec2 wg=vec2(fract(az*cols*4.),fract(h*60.));
      float lit=step(.55,h21(floor(vec2(az*cols*4.,h*60.))))*step(.2,wg.x)*step(wg.x,.8)*step(.25,wg.y)*step(wg.y,.75);
      bc=mix(bc,vec3(.75,.85,1.)*(.9+.3*sd),lit*.55*step(.01,h));
      col=mix(col,bc,.95);
    }
  }
  if(uGnd>0.&&h<-.002){                // mặt đất theo phối cảnh (camera cao ~1.3 m)
    float k=uGH/max(-h,.004); vec2 p=d.xz*k+uCam; vec2 q=p/uGSize; vec3 g=uBot;
    float nz=fbm(q*.9);
    if(uGnd<2.5){                      // đồng cỏ / đường mòn
      g=mix(uBot*.72,uBot*1.28,nz)*(.92+.16*fbm(q*5.*uGDens)); g*=1.-.12*step(.62,h21(floor(q*7.*uGDens)))*smoothstep(60.,6.,k);
      if(uGnd<1.5){ vec2 cell=floor(q*4.); float fh=h21(cell); vec2 fp=fract(q*4.)-.5; g=mix(g,uGc2,step(1.-uFDens,fh)*smoothstep(.22,.1,length(fp))*smoothstep(40.,8.,k)); }
      else{
        float cx=(sin(p.y*.11)*2.2+sin(p.y*.04+1.)*3.)*uPCurve; float dx=abs(p.x-cx);
        float w=uPW*(1.+.2*sin(p.y*.3));
        float pm=smoothstep(w+.35,w-.2,dx+(nz-.5)*.5);
        vec3 pc=uGc2*(.8+.35*fbm(q*3.5));
        g=mix(g,pc,pm);
        g=mix(g,uBot*.55,smoothstep(w+.55,w+.25,dx)*smoothstep(w-.05,w+.25,dx)*.5); // mép cỏ đậm
      }
    } else if(uGnd<3.5){               // đồng bằng: ruộng ô vuông
      vec2 fc=floor(q*.07+vec2(3.,7.)); float v=h21(fc);
      g=mix(uBot,uGc2,step(.45,v)*.8)*(.78+.4*v)*(.9+.2*nz);
      vec2 fr=abs(fract(q*.07+vec2(3.,7.))-.5); g=mix(g,uBot*.55,smoothstep(.47,.5,max(fr.x,fr.y))*.6);
      g*=.95+.1*fbm(q*6.*uGDens);
    } else if(uGnd<4.5){               // đường phố
      float ax=abs(p.x); g=uBot*(.9+.15*fbm(p*3.));
      float road=smoothstep(uPW,uPW-.1,ax);
      vec3 asp=uGc2*(.85+.3*fbm(q*8.*uGDens));
      g=mix(g,asp,road);
      float dash=step(.5,fract(p.y*.2));
      g=mix(g,vec3(.95,.85,.3),smoothstep(.1,.06,ax)*dash*road);
      g=mix(g,vec3(.92),smoothstep(.07,.03,abs(ax-(uPW-.3)))*road);
      float side=smoothstep(uPW,uPW+.15,ax)*smoothstep(uPW+2.35,uPW+2.2,ax);   // vỉa hè
      vec2 tl=abs(fract(vec2(p.x*.9,p.y*.9))-.5); g=mix(g,g*.82,side*smoothstep(.46,.5,max(tl.x,tl.y)));
      g=mix(g,vec3(.62,.62,.6),smoothstep(uPW+.05,uPW-.05,ax)*step(uPW-.05,ax)*.6);
    } else if(uGnd<5.5){               // Bắc cực: tuyết + biển + mảng băng trôi
      vec3 sn=uBot*(.92+.14*nz);
      float rg=fbm(vec2(q.x*.5+q.y*.07,q.y*2.6)); sn*=.93+.12*rg;                            // gợn tuyết do gió thổi
      sn=mix(sn,sn*vec3(.80,.9,1.06),smoothstep(.6,.25,fbm(q*.35+4.)));                       // bóng xanh lạnh
      vec2 sq=floor(q*(26.*uGDens)); float sp=step(.988,h21(sq))*(.5+.5*sin(uT*3.+h21(sq)*40.));
      sn+=vec3(.9,.95,1.)*sp*smoothstep(22.,4.,k);                                           // lấp lánh tinh thể băng
      float shore=-uWDist+3.*sin(p.x*.15)+1.5*sin(p.x*.41+2.);
      float wm=smoothstep(shore+.35,shore-.9,p.y)*uWater;
      vec3 wc=uGc2*(.8+.4*fbm(q*.25+vec2(uT*.02,0.)));
      vec2 fq=p*.11/max(uGSize,.2); vec2 fi=floor(fq),ff=fract(fq); float fl=0.,fe=0.;        // mảng băng trôi (ô Voronoi thô)
      for(int j=-1;j<=1;j++)for(int i2=-1;i2<=1;i2++){
        vec2 gg=vec2(float(i2),float(j)); vec2 o=vec2(h21(fi+gg),h21(fi+gg+5.7)); float on=step(.45,h21(fi+gg+2.2));
        vec2 r=gg+.2+.6*o-ff; float rad=.14+.26*h21(fi+gg+9.1); float dd=length(r*vec2(1.,1.25))/rad;
        fl=max(fl,on*smoothstep(1.,.82,dd)); fe=max(fe,on*smoothstep(.82,.55,dd));
      }
      wc=mix(wc,mix(vec3(.62,.8,.92),vec3(.96,.99,1.),fe),fl*.95);
      wc+=vec3(1.,.95,.85)*pow(sd,6.)*smoothstep(0.,.5,fbm(q*2.+uT*.1))*(1.-fl)*.6;          // ánh mặt trời trên sóng
      g=mix(sn,wc,wm);
      g=mix(g,vec3(.93,.97,1.),smoothstep(.9,.1,abs(p.y-shore))*.45*uWater);                 // bọt băng ven bờ
    } else if(uGnd<6.5){               // đường đá cuội (lát so le, đá tròn cạnh, mạch sẫm)
      float cxp=(sin(p.y*.11)*2.2+sin(p.y*.04+1.)*3.)*uPCurve, dx=abs(p.x-cxp), w=uPW*(1.+.2*sin(p.y*.3));
      vec3 sur=uBot*(.75+.5*nz)*(.92+.16*fbm(q*5.*uGDens));
      float pm=smoothstep(w+.15,w-.1,dx+(nz-.5)*.25);
      vec2 cq=vec2(p.x-cxp,p.y)/(.34*uGSize); float row=floor(cq.y); vec2 cc=vec2(cq.x+.5*mod(row,2.),cq.y); vec2 id=floor(cc),f=fract(cc)-.5;
      float r1=h21(id),r2=h21(id+7.3),r3=h21(id+2.9);
      vec2 hs=vec2(.40+.07*r1,.38+.08*r2); vec2 e=abs(f+(vec2(r1,r2)-.5)*.08)-hs+.13;
      float sdf=length(max(e,0.))+min(max(e.x,e.y),0.)-.13;
      float inside=smoothstep(.025,-.03,sdf), dome=smoothstep(-.02,-.2,sdf);
      vec3 sc=uGc2*(.7+.6*r1); sc=mix(sc,sc*vec3(1.12,.96,.82),r3*.7); sc*=.8+.3*dome+.12*(fbm(cc*6.)-.5);
      vec3 st=mix(uGc2*vec3(.24,.26,.22),sc,inside);
      st=mix(uGc2*.62,st,smoothstep(60.,9.,k));                                              // xa thì hòa về màu trung bình (chống nhiễu)
      g=mix(sur,st,pm);
      g=mix(g,sur*.55,smoothstep(w+.55,w+.2,dx)*smoothstep(w-.05,w+.2,dx)*.45);             // viền đất ẩm
    } else if(uGnd<7.5){                           // đường sỏi (hai lớp hạt sỏi, vệt bánh xe, sỏi văng ven đường)
      float cxp=(sin(p.y*.11)*2.2+sin(p.y*.04+1.)*3.)*uPCurve, dx=abs(p.x-cxp), w=uPW*(1.+.2*sin(p.y*.3));
      vec3 sur=uBot*(.75+.5*nz)*(.92+.16*fbm(q*5.*uGDens));
      float pm=smoothstep(w+.4,w-.25,dx+(nz-.5)*.7), lod=smoothstep(55.,8.,k);
      vec3 base=uGc2, gv=base*(.62+.3*fbm(p*2.));
      for(int li=0;li<2;li++){
        float fl2=float(li); vec2 s2=p*(li==0?5.:11.)*uGDens/uGSize; vec2 id=floor(s2),f=fract(s2);
        for(int j=-1;j<=1;j++)for(int i2=-1;i2<=1;i2++){
          vec2 g2=vec2(float(i2),float(j)); vec2 o=vec2(h21(id+g2+fl2*13.),h21(id+g2+3.1+fl2*13.)); vec2 r=g2+o-f;
          float rad=.3+.2*h21(id+g2+9.+fl2*13.), dd=length(r)/rad;
          if(dd<1.){ float sh=1.-dd*dd; vec3 pc=base*(.45+1.*h21(id+g2+5.)); pc=mix(pc,pc*vec3(1.1,.95,.8),h21(id+g2+1.2)); pc*=.65+.55*sh+.15*(r.x-r.y); gv=mix(gv,pc,smoothstep(1.,.88,dd)); }
        }
      }
      gv=mix(base*.7,gv,lod*.85+.15);
      gv*=1.-.12*smoothstep(.2,0.,abs(dx-w*.42));                                            // hai vệt bánh xe
      g=mix(sur,gv,pm);
      float sc2=step(.93,h21(floor(q*9.*uGDens)))*smoothstep(w+1.2,w+.2,dx)*(1.-pm)*lod;    // sỏi văng ra ven đường
      g=mix(g,base*(.7+.4*h21(floor(q*9.))),sc2*.8);
    } else {                           // nước: hồ · sông · suối · biển (phản chiếu trời, sóng, bọt, đáy nông, nắng lấp lánh)
      float sdp=wsd(p), lodW=smoothstep(90.,10.,k), seaK=step(2.5,uWK);
      vec2 pa=p-vec2(0.,uT*.8*uWFlow);                       // toạ độ trôi theo dòng nước
      float sdw=sdp; if(seaK>.5) sdw+=.5*sin(uT*.8*uWFlow+p.x*.05+p.y*.1)+.22*sin(uT*1.9*uWFlow+p.x*.17+1.);   // sóng vỗ làm mép nước tiến / lùi
      float dscale=4.5; if(uWK>.5)dscale=3.2; if(uWK>1.5)dscale=.9; if(uWK>2.5)dscale=7.;
      vec3 ld=uBot, wc=uGc2;
      if(sdw<.4){                                           // đất liền / cát ven bờ
        ld=uBot*(.8+.4*nz)*(.92+.16*fbm(q*5.*uGDens));
        if(seaK>.5){ ld=uBot*(.92+.14*nz)*(.96+.08*fbm(p*7.)); ld*=1.-.07*smoothstep(.45,.6,fbm(vec2(p.x*.9,p.y*5.)))*lodW; ld*=1.-.30*smoothstep(-3.2,0.,sdw)-.12*smoothstep(-.7,0.,sdw); }
        else { ld=mix(ld,mix(uBot*.5,vec3(.42,.33,.22),.45)*(.8+.4*nz),smoothstep(-.6,-.05,sdw)); ld*=1.-.18*smoothstep(-2.2,0.,sdw); }
      }
      if(sdw>-.4){                                          // mặt nước
        vec2 gr=wgrad(pa,uT*(.5+.5*uWFlow),lodW)*uWAmp*(uWK>2.5?1.3:(uWK>1.5?1.25:1.))*(.3+.5*lodW);
        vec3 nr=normalize(vec3(-gr.x,1.,-gr.y));
        vec3 rd=reflect(d,nr); rd.y=abs(rd.y)+.004; rd=normalize(rd);
        vec3 sk=mix(uHor,uTop,pow(clamp(rd.y,0.,1.),.55)); float sdr=max(dot(rd,uSunD),0.);
        if(uClouds>0.){ vec2 qc=rd.xz/(rd.y+.25)*1.4+vec2(uT*.012,0.); float cc=fbm(qc*1.6); float cm=smoothstep(.62-.3*uClouds,.95-.2*uClouds,cc)*smoothstep(0.,.12,rd.y); sk=mix(sk,mix(uHor,vec3(1.),.6)*(.8+.4*pow(sdr,2.)),cm*.85); }
        if(uHills>0.){ float az2=atan(rd.z,rd.x); float h0=uHills*(.012+.05*fbm(vec2(az2*2.2,3.))), h1=uHills*(.004+.028*fbm(vec2(az2*3.7+9.,5.)));   // bóng đồi xa in trên mặt nước
          float hf=smoothstep(.16,.0,rd.y)*smoothstep(.12,.04,-h); sk=mix(sk,mix(uBot,uHor,.6)*(.95+.1*sdr),smoothstep(.02,-.02,rd.y-h0)*hf); sk=mix(sk,mix(uBot,uHor,.3)*(.9+.15*sdr),smoothstep(.02,-.02,rd.y-h1)*hf); }
        float cs=clamp(dot(nr,-d),0.,1.), fr=clamp(.03+.97*pow(1.-cs,5.),0.,1.); fr=clamp(fr*1.1+.05,0.,1.);
        float dep=clamp(max(sdw,0.)/dscale,0.,1.);
        vec3 shal=clamp(uGc2*1.55+vec3(.03,.1,.08),0.,1.), body=mix(shal,uGc2*.62,smoothstep(0.,1.,dep));
        vec3 bed=mix(uBot*.8,vec3(.38,.34,.26),.4);
        if(uWK>1.5&&uWK<2.5) bed=mix(vec3(.28,.26,.22),vec3(.66,.62,.52),smoothstep(.35,.7,fbm(p*5.)));   // sỏi lòng suối
        if(seaK>.5) bed=uBot*.95;
        float cau=pow(1.-abs(n2(pa*2.4+vec2(uT*.35,uT*.2))*2.-1.),5.);                                       // vân sáng dưới đáy nông
        body=mix(body,bed*shal*1.6*(.7+.7*cau*lodW),clamp(pow(1.-dep,1.6)*uWClear*.85,0.,1.));
        wc=mix(body,sk,fr);
        wc+=uSunC*(pow(sdr,420.)*5.+pow(sdr,60.)*.35)*uSun*(.35+.65*lodW);                                  // nắng lấp lánh trên sóng
        if(lodW>.01&&uWK<2.5){                                                                                  // gợn tròn lan toả (cá đớp mồi, giọt nước)
          vec2 rq=pa/1.4, ri=floor(rq); float rg=0.;
          for(int j=-1;j<=1;j++)for(int i2=-1;i2<=1;i2++){
            vec2 id=ri+vec2(float(i2),float(j)); float on=step(.62,h21(id+4.4)), per=2.5+3.*h21(id+1.7), tt=fract((uT+h21(id)*60.)/per);
            vec2 c=id+vec2(.2+.6*h21(id+2.2),.2+.6*h21(id+7.7)); float dd=length(rq-c)*1.4, rad=tt*1.3;
            rg+=on*(smoothstep(.07,0.,abs(dd-rad))+.5*smoothstep(.05,0.,abs(dd-rad*.62)))*(1.-tt)*(1.-tt);
          }
          wc=mix(wc,wc*.82+vec3(.85,.95,1.)*.22,clamp(rg,0.,1.)*lodW);
        }
        float foam=0.;                                                                                          // bọt trắng
        if(seaK>.5){
          float ln=.55+.45*fbm(vec2(p.x*1.2,p.y*2.6));
          foam=smoothstep(.45,0.,abs(sdw-.1))*ln;                                                              // bọt ở mép nước tràn lên cát
          foam+=smoothstep(0.,.9,sdw)*smoothstep(2.6,.9,sdw)*(.2+.3*fbm(vec2(p.x*3.,p.y*4.)))*step(.45,fbm(vec2(p.x*.7,p.y*1.6+uT*.3)));
          float br=3.4+1.5*sin(uT*.6*uWFlow+p.x*.03);                                                            // sóng vỡ phía ngoài
          foam+=smoothstep(.5,0.,abs(sdw-br))*(.35+.5*fbm(vec2(p.x*1.8,p.y*3.)))*.8;
          foam+=smoothstep(.66,.9,fbm(vec2(pa.x*.35,pa.y*.55)*1.1+vec2(0.,-uT*.15)))*smoothstep(4.,9.,sdw)*lodW*.5*uWAmp;   // bạc đầu
        } else if(uWK>.5){
          float rp=uWK>1.5?1.:.28;
          foam=smoothstep(.5,0.,sdw)*(.4+.6*fbm(vec2(p.x*3.,pa.y*3.)));
          foam+=smoothstep(.62,.85,fbm(vec2(p.x*(uWK>1.5?1.6:.7),pa.y*(uWK>1.5?.9:.35))))*.75*rp*smoothstep(.1,.45,sdw);   // ghềnh nước trắng
        } else { foam=smoothstep(.3,0.,sdw)*(.25+.35*fbm(p*3.)); }                                             // hồ: viền lăn tăn
        wc=mix(wc,vec3(.94,.97,1.)*(.8+.25*clamp(uSunD.y+.3,0.,1.)),clamp(foam,0.,1.)*(.55+.45*lodW)*.85);
      }
      g=mix(ld,wc,smoothstep(-.04,.05,sdw));
    }
    g*=.9+.2*sd;
    col=mix(col,mix(g,uHor,smoothstep(10.,uGFar,k)),smoothstep(-.0005,-.006,h));
  }
  if(uSea>0.&&h<.03){                  // biển mây bên dưới tầm mắt
    float hh=max(-h,0.); vec2 q=d.xz/(hh+.16)*1.3+vec2(uT*.01,0.);
    float cm=smoothstep(.32,.72,fbm(q*1.4));
    vec3 cc=mix(uBot*.9,mix(vec3(1.),uHor,.25)*(.88+.3*pow(sd,2.)),cm);
    cc=mix(uHor,cc,smoothstep(0.,.1,hh));
    col=mix(col,cc,smoothstep(.03,-.03,h)*uSea);
  }
  if(uAurora>0.&&h>.03){               // cực quang: ba tấm rèm sáng uốn lượn
    float az=atan(d.z,d.x); vec3 au=vec3(0.);
    for(int i=0;i<3;i++){ float fi=float(i);
      float y0=.2+.13*fi+.05*sin(az*(2.+fi)+uT*.12*(1.+fi*.4))+.03*sin(az*7.+uT*.2+fi*3.);
      float v=smoothstep(y0-.015,y0,h)*exp(-(h-y0)*9.);
      float rv=.5+.5*sin(az*(24.+8.*fi)+uT*.5+fbm(vec2(az*3.+fi,uT*.05))*6.);
      au+=mix(vec3(.15,1.,.55),vec3(.6,.3,1.),clamp((h-y0)*5.,0.,1.))*v*rv*(.62-.14*fi);
    }
    col+=au*uAurora*smoothstep(.03,.15,h);
  }
  if(uStars>0.&&h>-.05){
    vec3 p=d*95.,ip=floor(p),f=fract(p)-.5; float r=h21(ip.xy+ip.z*13.7);
    float st=smoothstep(.2,0.,length(f))*step(.975,r)*(.55+.45*sin(uT*2.+r*60.));
    col+=vec3(st)*uStars*smoothstep(0.,.25,h);
  }
  if(uClouds>0.&&h>0.){
    vec2 q=d.xz/(h+.25)*1.4+vec2(uT*.012,0.); float c=fbm(q*1.6);
    float m=smoothstep(.62-.3*uClouds,.95-.2*uClouds,c)*smoothstep(0.,.12,h);
    vec3 cc=mix(uHor,vec3(1.),.6)*(.8+.4*pow(sd,2.)); col=mix(col,cc,m*.85);
  }
  if(uRays>0.){
    float ray=pow(clamp(fbm(vec2(d.x/(h+.4)*3.+uT*.07,d.z/(h+.4)*.6))*1.8-.45,0.,1.),2.);
    col+=uRayC*ray*uRays*smoothstep(0.,.5,h)*.5;
  }
  if(uCanopy>0.&&h>.15){
    vec2 q=d.xz/(h+.1)*2.2; float l=smoothstep(.45,.55,fbm(q*3.+vec2(uT*.03)));
    float w=smoothstep(.15,.45,h);
    col=mix(col,vec3(.05,.16,.08)*(.6+.8*fbm(q*9.)),l*uCanopy*w); col+=(1.-l)*uSunC*.3*uCanopy*w;
  }
  if(uMist>0.){                          // sương mờ: dày nhất sát chân trời, cuộn từng mảng, ngả màu nắng về phía mặt trời
    vec2 mq=d.xz/(abs(h)+.08)*.55+vec2(uT*.02,0.); float wisp=fbm(mq*1.8);
    float mb=uMist*exp(-abs(h)*(h<0.?10.:26.));
    vec3 mc=mix(uHor,vec3(1.),.55)*(.92+.2*pow(sd,3.))+uSunC*pow(sd,6.)*.35*uSun;
    col=mix(col,mc,clamp(mb*(.45+.9*wisp),0.,.92));
  }
  if(uBeam>0.&&sd>0.){                   // tia nắng toả quanh mặt trời, xuyên qua sương / tán lá
    vec3 sr=normalize(cross(uSunD,vec3(0.,1.,.001))), su=cross(sr,uSunD);
    float an=atan(dot(d,su),dot(d,sr)), rdl=acos(clamp(sd,0.,1.));
    float b1=.5+.5*sin(an*13.+fbm(vec2(an*2.,uT*.04))*5.), b2=.5+.5*sin(an*29.+uT*.05+2.);
    float bm=pow(b1,3.)*(.6+.4*b2)*exp(-rdl*2.4)*(.65+.5*fbm(vec2(an*3.,rdl*4.-uT*.02)));
    col+=uSunC*bm*uBeam*.55*min(uSun,1.2)*smoothstep(-.3,.1,h);
  }
  float disc=smoothstep(.9985,.9995,sd), glow=pow(sd,64.)*.6+pow(sd,8.)*.25;
  col+=uSunC*(disc*1.5+glow)*uSun;
  col=mix(col,uFogC,uFogK*(1.-.7*smoothstep(0.,.6,max(h,0.))));   // sương: dày nhất ở chân trời
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;

/* ---------------- Nền phẳng (màu / gradient / ảnh / video) vẽ trong WebGL ----------------
   Màu truyền dạng sRGB thô để gradient trộn giống CSS (trộn trong sRGB), rồi đổi sang tuyến tính. */
const FLAT_FS = `precision highp float; varying vec2 vUv; uniform sampler2D tMap;
uniform vec3 uC1,uC2,uFogC; uniform float uMode,uAng,uAsp,uImgAsp,uFit,uZ,uFogK; uniform vec2 uOff;
vec3 s2l(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
void main(){
  vec2 p=(vUv-.5)*vec2(uAsp,1.);
  vec3 col=uC1;
  if(uMode>.5&&uMode<1.5){
    vec2 d=vec2(sin(uAng),cos(uAng)); float len=abs(uAsp*d.x)+abs(d.y);
    col=mix(uC1,uC2,clamp(dot(p,d)/len+.5,0.,1.));
  }
  vec3 lin=s2l(col);
  vec4 tx=texture2D(tMap,vec2(.5));
  if(uMode>1.5){
    float hi=uFit<.5?max(1.,uAsp/uImgAsp):(uFit<1.5?min(1.,uAsp/uImgAsp):1.);
    vec2 sz=(uFit<1.5?vec2(uImgAsp*hi,hi):vec2(uAsp,1.))*uZ;
    vec2 q=(p-vec2(uOff.x*uAsp,-uOff.y))/sz+.5;
    tx=texture2D(tMap,q);
    float inside=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);
    lin=mix(lin,tx.rgb,tx.a*inside);
  }
  lin=mix(lin,uFogC,uFogK*.7);
  gl_FragColor=vec4(lin,1.);
  #include <colorspace_fragment>
}`;

/* ---------------- Ảnh 360° ---------------- */
const PANO_FS = `precision highp float; varying vec2 vUv; varying float vH; uniform sampler2D tMap; uniform vec3 uFogC; uniform float uExp,uFogK;
void main(){
  vec3 c=texture2D(tMap,vUv).rgb*uExp;
  c=mix(c,uFogC,uFogK*(.85-.35*smoothstep(0.,.6,abs(vH))));
  gl_FragColor=vec4(c,1.);
  #include <colorspace_fragment>
}`;

/* ---------------- Hậu kỳ: biến dạng + mờ ảo (tham số lấy từ fx-kit) ---------------- */
const POST_FS = `precision highp float; varying vec2 vUv; uniform sampler2D tMap; uniform float uT,uAmp,uType,uGlow,uAsp; uniform vec2 uRes;
vec2 warp(vec2 uv){
  float a=uAmp;
  if(a<=0.) return uv;
  if(uType<.5){ float w=1.-uv.y*.7; uv.x+=(sin(uv.y*46.+uT*3.1)*.0045+sin(uv.y*19.-uT*2.2)*.0035)*a*w; uv.y+=sin(uv.x*33.+uT*2.3)*.0022*a*w; }
  else if(uType<1.5){ uv+=a*.0065*vec2(sin(uv.y*21.+uT*1.7)+.5*sin(uv.y*43.-uT*1.2),cos(uv.x*25.+uT*1.5)+.5*cos(uv.x*51.-uT*1.1)); }
  else if(uType<2.5){ vec2 p=uv-.5; float d=length(p*vec2(uAsp,1.)); uv+=normalize(p+1e-5)*sin(d*46.-uT*4.)*a*.008*smoothstep(0.,.3,d); }
  else { vec2 p=(uv-.5)*vec2(uAsp,1.); uv=.5+p*(1.+a*.9*dot(p,p))/vec2(uAsp,1.); }
  return clamp(uv,.001,.999);
}
void main(){
  vec2 uv=warp(vUv); vec4 c=texture2D(tMap,uv);
  if(uGlow>0.){
    float rad=uGlow*12.*uRes.y/720.; vec4 b=c; float n=1.;
    for(int i=0;i<12;i++){ float an=float(i)*.5236; for(int j=1;j<=2;j++){ vec2 o=vec2(cos(an),sin(an))*rad*float(j)*.5/uRes; b+=texture2D(tMap,uv+o); n+=1.; } }
    b/=n; c=mix(c,b,uGlow*.55); c.rgb+=max(b.rgb-.55,0.)*uGlow*.9;
  }
  gl_FragColor=c;
  #include <colorspace_fragment>
}`;

/* ---------------- Phòng (nhà / lớp học) dựng bằng canvas + hộp ---------------- */
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function mk(w, h, ppm, fn, rep) {
  const c = document.createElement('canvas'); c.width = Math.round(w * ppm); c.height = Math.round(h * ppm);
  const g = c.getContext('2d'), R = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x * ppm, (h - y - hh) * ppm, ww * ppm, hh * ppm); };
  fn(g, R, ppm, h, w);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
const RH = 3.4, RW = 14, RD = 18, RZ = 3;     // phòng: x ±7, z −6…12, cao 3.4 m
function windowRect(g, R, ppm, H, x, y, w, h) {
  R(x - .06, y - .06, w + .12, h + .12, '#f4f1ea');
  const gr = g.createLinearGradient(0, (H - y - h) * ppm, 0, (H - y) * ppm); gr.addColorStop(0, '#9fd0ff'); gr.addColorStop(1, '#eaf6ff');
  g.fillStyle = gr; g.fillRect(x * ppm, (H - y - h) * ppm, w * ppm, h * ppm);
  R(x + w / 2 - .025, y, .05, h, '#f4f1ea'); R(x, y + h / 2 - .025, w, .05, '#f4f1ea');
}
function wallTex(kind, P, side) {
  const W = side ? RD : RW;
  return mk(W, RH, 90, (g, R, ppm, H) => {
    R(0, 0, W, H, P.c2);
    const gr = g.createLinearGradient(0, 0, 0, H * ppm); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.16)'); g.fillStyle = gr; g.fillRect(0, 0, W * ppm, H * ppm);
    R(0, 0, W, .14, sh(P.c2, .65));
    if (kind === 'house') {
      if (!side) { windowRect(g, R, ppm, H, 2.4, 1.0, 2.2, 1.6); windowRect(g, R, ppm, H, 9.4, 1.0, 2.2, 1.6); R(6.3, 1.5, 1.4, .95, '#6b4a2e'); R(6.38, 1.58, 1.24, .79, '#9fc3d6'); }
      else { windowRect(g, R, ppm, H, 3.5, 1.0, 2.0, 1.6); windowRect(g, R, ppm, H, 12.5, 1.0, 2.0, 1.6); R(8.1, .14, .95, 2.1, '#7a5230'); R(8.9, 1.1, .08, .08, '#d9c27a'); R(5.8, 1.6, .9, .7, '#6b4a2e'); R(5.86, 1.66, .78, .58, '#d9b99a'); }
    } else {
      if (!side) {
        R(0, 0, W, 1.05, sh(P.c2, .86));
        R(3.9, 1.0, 6.2, 1.4, '#8a6a43'); R(4.0, 1.1, 6.0, 1.2, '#2f4a3c'); R(4.0, 1.04, 6.0, .06, '#b8b2a4');
        g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { g.beginPath(); const x = (4.1 + rnd() * 5.6) * ppm, y = (H - 1.2 - rnd() * 1) * ppm; g.moveTo(x, y); g.quadraticCurveTo(x + 30 * rnd(), y - 12, x + 60 * rnd(), y + 6); g.stroke(); }
        R(6.78, 2.85, .44, .44, '#f4f1ea'); g.fillStyle = '#222'; g.beginPath(); g.arc(7 * ppm, (H - 3.07) * ppm, .17 * ppm, 0, 7); g.fill();
      } else if (side === 1) { for (let i = 0; i < 4; i++) windowRect(g, R, ppm, H, 1.6 + i * 4.2, 1.1, 1.8, 1.4); }
      else { R(2.5, 1.3, 5.5, 1.2, '#b98b57'); for (let i = 0; i < 9; i++) R(2.7 + i * .6, 1.4 + rnd() * .5, .45, .5, ['#ff8a8a', '#ffd36b', '#8ad1ff', '#a5e08a'][i % 4]); R(11.0, .14, .95, 2.1, '#7a5230'); }
    }
  });
}
function floorTex(kind, P) {
  seed = 7;
  return mk(2.5, 2.5, 160, (g, R, ppm) => {
    if (kind === 'house') { for (let i = 0; i < 5; i++) { R(0, i * .5, 2.5, .5, sh(P.c3, .85 + rnd() * .3)); R(0, i * .5, 2.5, .012, 'rgba(0,0,0,.35)'); R((i * .9) % 2.5, i * .5, .012, .5, 'rgba(0,0,0,.3)'); } }
    else { for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) R(i * .5, j * .5, .5, .5, (i + j) % 2 ? P.c3 : sh(P.c3, .86)); }
  }, [RW / 2.5, RD / 2.5]);
}
function ceilTex(kind, P) {
  return mk(RW, RD, 40, (g, R) => { R(0, 0, RW, RD, P.c1); if (kind === 'classroom') for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { R(1.4 + i * 4.4, 1.2 + j * 4.2, 3, .5, '#9a9a94'); R(1.45 + i * 4.4, 1.25 + j * 4.2, 2.9, .4, '#ffffff'); } });
}
function buildRoom(kind, P) {
  seed = 3;
  const grp = new THREE.Group(), geo = new THREE.BoxGeometry(RW, RH, RD), B = t => new THREE.MeshBasicMaterial({map: t, side: THREE.BackSide});
  const wb = wallTex(kind, P, 0), ws1 = wallTex(kind, P, 1), ws2 = kind === 'classroom' ? wallTex(kind, P, 2) : ws1;
  const room = new THREE.Mesh(geo, [B(ws1), B(ws2), B(ceilTex(kind, P)), B(floorTex(kind, P)), B(wb), B(wb)]);
  room.position.set(0, RH / 2, RZ); grp.add(room);
  const L = c => new THREE.MeshLambertMaterial({color: c}), box = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), L(c)); m.position.set(x, y, z); grp.add(m); return m; };
  if (kind === 'house') {
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), L('#a45a4a')); rug.rotation.x = -Math.PI / 2; rug.position.set(0, .012, -3); grp.add(rug);
    box(2.4, .45, .95, 0, .225, -4.8, '#6f7f9a'); box(2.4, .6, .22, 0, .75, -5.2, '#6f7f9a'); box(.22, .6, .95, -1.31, .4, -4.8, '#5f6f8a'); box(.22, .6, .95, 1.31, .4, -4.8, '#5f6f8a');
    box(1.2, .38, .7, 0, .19, -2.9, '#8a5a34'); box(.4, .4, .4, -1.8, .2, -4.6, '#d9a85a');
    box(2.4, 2.2, .35, -6.8, 1.1, -3.5, '#7a5230'); for (let i = 0; i < 12; i++) box(.16, .35, .03, -6.62, .55 + (i % 4) * .5, -4.4 + Math.floor(i / 4) * .8 + rnd() * .05, ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e'][i % 4]);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.22, .17, .4, 12), L('#b0693e')); pot.position.set(5.6, .2, -5); grp.add(pot);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(.45, 12, 10), L('#3f8f4a')); bush.position.set(5.6, .8, -5); grp.add(bush);
  } else {
    box(2.0, .08, .8, -4.5, .78, -5.2, '#a8794a'); box(2.0, .7, .1, -4.5, .4, -5.5, '#8a6a43');
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
      const x = -3.75 + c * 1.5 + (c > 2 ? .5 : 0), z = -2.6 - r * 1.3;
      box(1.1, .06, .6, x, .72, z, '#d2b48c'); box(.05, .7, .05, x - .5, .35, z - .25, '#666'); box(.05, .7, .05, x + .5, .35, z - .25, '#666'); box(.05, .7, .05, x - .5, .35, z + .25, '#666'); box(.05, .7, .05, x + .5, .35, z + .25, '#666');
      box(.45, .05, .42, x, .44, z + .62, '#3b6ea8'); box(.45, .42, .05, x, .68, z + .82, '#3b6ea8');
    }
  }
  return grp;
}
function disposeGroup(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) for (const m of [].concat(n.material)) { if (m.map) m.map.dispose(); m.dispose(); } }); o.removeFromParent(); }

/* ============================================================
   Bộ máy
   ============================================================ */
export function createEnvEngine(scene, camera, renderer) {
  const C = h => new THREE.Color(h);
  const raw = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')), n = m ? parseInt(m[1], 16) : 0; return new THREE.Vector3((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const fogC = new THREE.Color(1, 1, 1);

  /* --- bầu trời môi trường --- */
  const U = {uTop: {value: C('#2f7fe0')}, uHor: {value: C('#cfe6ff')}, uBot: {value: C('#7d8f6a')}, uSunC: {value: C('#fff4e0')}, uSunD: {value: new THREE.Vector3(0, 1, 0)}, uT: {value: 0}, uSun: {value: 0}, uStars: {value: 0}, uClouds: {value: 0}, uRays: {value: 0}, uCanopy: {value: 0}, uRayC: {value: C('#bff5ff')}, uDunes: {value: 0}, uSea: {value: 0}, uGnd: {value: 0}, uHills: {value: 0}, uBld: {value: 0}, uGDens: {value: 1}, uGSize: {value: 1}, uFDens: {value: .035}, uPW: {value: 1.15}, uPCurve: {value: 1}, uGFar: {value: 90}, uGH: {value: 1.3}, uBDens: {value: 22}, uGc2: {value: C('#c9a86a')}, uFogC: {value: new THREE.Color(1, 1, 1)}, uFogK: {value: 0}};
  Object.assign(U, {uWDist: {value: 24}, uWater: {value: 1}, uBergs: {value: 0}, uAurora: {value: 0}, uCam: {value: new THREE.Vector2()}});
  Object.assign(U, {uWK: {value: 0}, uWFar: {value: 70}, uWCx: {value: 6}, uWAmp: {value: 1}, uWFlow: {value: 1}, uWClear: {value: .6}, uMist: {value: 0}, uBeam: {value: 0}});
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({uniforms: U, vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: DOME_FS, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false}));
  dome.renderOrder = -1001; dome.frustumCulled = false; dome.visible = false; dome.name = 'env_dome';

  /* --- ảnh 360° --- */
  const PA = {uZoom: {value: 1}, tMap: {value: null}, uFogC: {value: new THREE.Color(1, 1, 1)}, uExp: {value: 1}, uFogK: {value: 0}};
  const pg = new THREE.SphereGeometry(100, 64, 40); pg.scale(-1, 1, 1);
  /* Ảnh 360° "gắn sàn" (kiểu GroundedSkybox): nửa dưới ảnh được chiếu xuống mặt phẳng y=0 → sàn trong ảnh trùng sàn nhân vật, tỉ lệ + thị sai đúng khi camera đứng xa / dịch chuyển. */
  let panoH = 0;
  const groundedPano = h => {
    const g = new THREE.SphereGeometry(100, 64, 40), pos = g.getAttribute('position'), y1 = -h * 1.5;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0) { const f = y < y1 ? -h / y : 1 - y * y / (3 * y1 * y1); pos.setXYZ(i, pos.getX(i) * f, y * f, pos.getZ(i) * f); }
    }
    pos.needsUpdate = true; g.scale(-1, 1, 1); return g;
  };
  const panoM = new THREE.Mesh(pg, new THREE.ShaderMaterial({uniforms: PA, vertexShader: 'uniform float uZoom; varying vec2 vUv; varying float vH; void main(){ vUv=uv; vH=normalize(position).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.xy*=uZoom; }', fragmentShader: PANO_FS, depthTest: false, depthWrite: false, fog: false}));
  panoM.renderOrder = -1001; panoM.frustumCulled = false; panoM.visible = false; panoM.name = 'env_pano';

  /* --- nền phẳng --- */
  const FU = {tMap: {value: null}, uC1: {value: new THREE.Vector3()}, uC2: {value: new THREE.Vector3()}, uFogC: {value: new THREE.Color(1, 1, 1)}, uMode: {value: 0}, uAng: {value: 2.36}, uAsp: {value: 1}, uImgAsp: {value: 1}, uFit: {value: 0}, uZ: {value: 1}, uFogK: {value: 0}, uOff: {value: new THREE.Vector2()}};
  const flatM = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({uniforms: FU, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }', fragmentShader: FLAT_FS, depthTest: false, depthWrite: false, fog: false}));
  flatM.renderOrder = -1001; flatM.frustumCulled = false; flatM.visible = true; flatM.name = 'env_flat';
  scene.add(dome, panoM, flatM);
  const scat = createScatter(scene);

  /* --- hậu kỳ --- */
  const PU = {tMap: {value: null}, uT: {value: 0}, uAmp: {value: 0}, uType: {value: 0}, uGlow: {value: 0}, uAsp: {value: 1}, uRes: {value: new THREE.Vector2(1, 1)}};
  const postMat = new THREE.ShaderMaterial({uniforms: PU, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }', fragmentShader: POST_FS, depthTest: false, depthWrite: false, blending: THREE.NoBlending});
  const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), pq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); pq.frustumCulled = false; postScene.add(pq);
  let rt = null; const v2 = new THREE.Vector2();

  const S = {post: false, vid: null, vidT: -1, anchor: false, gh: 1.3}, L = {h: null, d: null}, cache = new Map(), ibl = {url: '', rt: null, pm: null};
  let room = null, roomKey = '', last = null, dirty = false, vtex = {el: null, tex: null};

  const load = url => {
    let o = cache.get(url); if (o) return o.p;
    o = {tex: null, err: false};
    o.p = new Promise((res, rej) => {
      const ld = new THREE.TextureLoader(); ld.setCrossOrigin('anonymous');
      ld.load(url, t => {
        const mx = renderer.capabilities.maxTextureSize, im = t.image;
        if (im && im.width > mx) { const k = mx / im.width, c = document.createElement('canvas'); c.width = mx; c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); t.image = c; }
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; o.tex = t; dirty = true; res(t);
      }, undefined, e => { o.err = true; rej(e); });
    });
    o.p.catch(() => {}); cache.set(url, o); return o.p;
  };
  const readyTex = url => { if (!url) return null; load(url); const o = cache.get(url); return o && o.tex || null; };
  const restoreLights = () => { if (!L.h) return; L.h.color.copy(L.hc); L.h.groundColor.copy(L.hg); L.h.intensity = L.hi; L.d.color.copy(L.dc); L.d.intensity = L.di; L.d.position.copy(L.dp); };

  const api = {
    setLights(h, d) { L.h = h; L.d = d; L.hc = h.color.clone(); L.hg = h.groundColor.clone(); L.hi = h.intensity; L.dc = d.color.clone(); L.di = d.intensity; L.dp = d.position.clone(); },
    preload(url) { return url ? load(url) : Promise.resolve(); },
    refresh() { dirty = true; },
    /** Cập nhật theo dữ liệu cảnh s tại thời điểm t. ctx = {url, custom, aspect, bg, post}. */
    update(s, t, ctx = {}) {
      last = [s, t, ctx];
      const bg = ctx.bg || {type: 'color', c1: (s && s.bg) || '#171923'};
      const bt = bg.force ? 'flat' : (s.bgt || 'color'), isEnv = bt === 'env';
      const P = envParams(s), tt = t * P.speed;
      const panoTex = bt === 'pano' ? readyTex(ctx.url) : null, pano = !!panoTex, flat = !isEnv && !pano;
      dome.visible = isEnv && !P.room; panoM.visible = pano; flatM.visible = flat;

      /* sương phủ nền: lấy từ scene.fog do fx 'fog' ghi (khoảng cách tham chiếu 40 m) */
      const fg = scene.fog, K = fg && fg.density > 0 ? 1 - Math.exp(-Math.pow(fg.density * 40, 2)) : 0;
      if (fg) fogC.copy(fg.color);

      if (isEnv && P.room) {
        const key = P.room + '|' + P.c1 + '|' + P.c2 + '|' + P.c3;
        if (key !== roomKey) { if (room) disposeGroup(room); room = buildRoom(P.room, P); scene.add(room); roomKey = key; }
      }
      if (room) room.visible = isEnv && !!P.room;

      if (dome.visible) {
        U.uTop.value.set(P.c1); U.uHor.value.set(P.c2); U.uBot.value.set(P.c3); U.uSunC.value.set(P.sc); U.uT.value = tt;
        const el = P.el * DEG, az = P.az * DEG; U.uSunD.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az));
        U.uSun.value = P.sun; U.uStars.value = P.stars; U.uClouds.value = P.clouds; U.uRays.value = P.rays; U.uCanopy.value = P.canopy; U.uRayC.value.set(P.rc); U.uDunes.value = P.dunes; U.uSea.value = P.sea; U.uGnd.value = P.gnd; U.uHills.value = P.hills; U.uBld.value = P.bld; U.uGc2.value.set(P.gc2);
        U.uGDens.value = P.gdens; U.uGSize.value = P.gsize; U.uFDens.value = P.fdens; U.uPW.value = P.pw; U.uPCurve.value = P.pcurve; U.uGFar.value = P.gfar; U.uGH.value = P.gh; U.uBDens.value = P.bdens;
        U.uWDist.value = P.wdist; U.uWater.value = P.water; U.uBergs.value = P.bergs; U.uAurora.value = P.aurora; U.uWK.value = P.wk; U.uWFar.value = P.wfar; U.uWCx.value = P.wcx; U.uWAmp.value = P.wamp; U.uWFlow.value = P.wflow; U.uWClear.value = P.wclear; U.uMist.value = P.mist; U.uBeam.value = P.beam; S.anchor = !!(P.anchor && P.gnd); S.gh = P.gh;
        U.uFogK.value = K; U.uFogC.value.copy(fogC);
      }

      let env = null;
      if (pano) {
        PA.tMap.value = panoTex; PA.uZoom.value = Math.min(4, Math.max(.2, +P.pzoom || 1)); PA.uExp.value = P.exp; PA.uFogK.value = K; PA.uFogC.value.copy(fogC);
        panoM.rotation.y = -Math.PI / 2 + P.rot * DEG;
        const gh = P.plock === false ? Math.max(0, +P.pgh || 0) : 0;   // khoá nền (mặc định): luôn là bầu trời vô cực đặt tại camera → không to/bé theo khoảng cách
        if (gh !== panoH) { if (panoH > 0) panoM.geometry.dispose(); panoM.geometry = gh > 0 ? groundedPano(gh) : pg; panoH = gh; }
        if (P.ibl) {
          if (ibl.url !== ctx.url) { if (!ibl.pm) ibl.pm = new THREE.PMREMGenerator(renderer); if (ibl.rt) ibl.rt.dispose(); ibl.rt = ibl.pm.fromEquirectangular(panoTex); ibl.url = ctx.url; }
          env = ibl.rt.texture;
        }
      }
      scene.environment = env;

      S.vid = null;
      if (flat) {
        let mode = 0, tex = null, asp = 1;
        if (bg.type === 'grad') mode = 1;
        else if (bg.type === 'img') { tex = readyTex(bg.url); if (tex) { const im = tex.image; asp = (im.naturalWidth || im.width) / Math.max(1, im.naturalHeight || im.height); } }
        else if (bg.type === 'vid' && bg.el && bg.el.readyState >= 2 && bg.el.videoWidth > 0) {
          if (vtex.el !== bg.el) {
            if (vtex.tex) vtex.tex.dispose();
            const vt = new THREE.VideoTexture(bg.el); vt.colorSpace = THREE.SRGBColorSpace;   // VideoTexture: three đọc đúng videoWidth / videoHeight
            vtex = {el: bg.el, tex: vt}; S.vidT = -1;
          }
          tex = vtex.tex; asp = bg.el.videoWidth / Math.max(1, bg.el.videoHeight); S.vid = tex;
        }
        if (tex) mode = 2;
        FU.uMode.value = mode; FU.uC1.value.copy(raw(bg.c1)); FU.uC2.value.copy(raw(bg.c2 || bg.c1)); FU.uAng.value = (bg.ang ?? 135) * DEG;
        FU.tMap.value = tex; FU.uImgAsp.value = asp; FU.uFit.value = bg.fit === 'contain' ? 1 : bg.fit === 'fill' ? 2 : 0;
        FU.uZ.value = (bg.z ?? 100) / 100; FU.uOff.value.set((bg.x || 0) / 100, (bg.y || 0) / 100);
        FU.uFogK.value = K; FU.uFogC.value.copy(fogC);
      }

      /* hậu kỳ: tham số lấy từ khối hiệu ứng (fx-kit) */
      const pp = ctx.post || {amp: 0, type: 0, glow: 0, speed: 1};
      S.post = pp.amp > .001 || pp.glow > .001;
      PU.uT.value = t * (pp.speed || 1); PU.uAmp.value = pp.amp; PU.uGlow.value = pp.glow; PU.uType.value = pp.type || 0; PU.uAsp.value = ctx.aspect || 1;

      if (L.h) {
        if (isEnv && !ctx.custom) {
          L.h.color.set(P.hc); L.h.groundColor.set(P.hg); L.h.intensity = L.hi * P.light * P.hk; L.d.color.set(P.lc); L.d.intensity = L.di * P.light * P.lk;
          if (P.sl && !P.room) L.d.position.copy(U.uSunD.value).multiplyScalar(10); else L.d.position.copy(L.dp);
        } else restoreLights();
      }
      /* lớp rải (cỏ, hoa, bụi, đá, băng trôi, mô hình thư viện…) */
      scat.update(isEnv && !P.room ? P.layers : [], P, t, {visible: isEnv && !P.room, actors: ctx.actors, wind: ctx.wind, getModel: ctx.getModel, refresh: () => { dirty = true; }});
    },
    /** Chờ các mô hình thư viện của lớp rải tải xong (xuất video). */
    settle: () => scat.settle(),
    layerStats: () => scat.stats(),
    /** Thay cho renderer.render: nền → cảnh → hậu kỳ → lớp phủ màn hình (fxEngine.overlay). */
    render(r, sc, cam, fxe) {
      if (dirty && last) { dirty = false; api.update(...last); }
      dome.position.copy(cam.position); if (panoH > 0) panoM.position.set(0, panoH, 0); else panoM.position.copy(cam.position);
      if (S.anchor) { U.uGH.value = Math.max(.12, cam.position.y); U.uCam.value.set(cam.position.x, cam.position.z); } else { U.uGH.value = S.gh; U.uCam.value.set(0, 0); }
      r.getDrawingBufferSize(v2); FU.uAsp.value = v2.x / Math.max(1, v2.y);
      if (S.vid && vtex.el && vtex.el.currentTime !== S.vidT) { S.vidT = vtex.el.currentTime; S.vid.needsUpdate = true; }
      if (!S.post) r.render(sc, cam);
      else {
        if (!rt) rt = new THREE.WebGLRenderTarget(v2.x, v2.y, {type: THREE.HalfFloatType, samples: 4});
        else if (rt.width !== v2.x || rt.height !== v2.y) rt.setSize(v2.x, v2.y);
        r.setRenderTarget(rt); r.render(sc, cam); r.setRenderTarget(null);
        PU.tMap.value = rt.texture; PU.uRes.value.copy(v2); r.render(postScene, postCam);
      }
      if (fxe && fxe.overlay) fxe.overlay(r);
    },
    dispose() {
      scat.dispose(); if (room) disposeGroup(room);
      pg.dispose(); for (const m of [dome, panoM, flatM]) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent(); }
      if (rt) rt.dispose(); if (vtex.tex) vtex.tex.dispose(); if (ibl.rt) ibl.rt.dispose();
      for (const o of cache.values()) if (o.tex) o.tex.dispose();
      scene.environment = null; restoreLights();
    }
  };
  return api;
}
