import * as THREE from 'three';
import {auth, readJSON, repoRaw, ghPutText} from './character-kit.js';

/* ============================================================
   Biểu cảm ghép từ 7 bộ phận. Có 2 kiểu (2 tab trong trang Custom):
   • texture : mỗi bộ phận là một chuỗi ảnh PNG nền trong suốt (vẽ lên 1 mặt phẳng gắn vào đầu)
   • keyshape: mọi keyshape/morph target của model 3D có timeline riêng với keyframe giá trị 0→1
               (kiểu Blender); riêng MẶT NẠ vẫn là chuỗi texture (lớp nền)

   Cấu trúc thư mục trên git:   faces/<bộ phận>/<tên biểu cảm>/01.png, 02.png, …
     <bộ phận> ∈ browL, browR, eyeL, eyeR, nose, mouth, mask
   Mọi ảnh cùng một khung vuông (khuyên dùng 512×512), bộ phận vẽ đúng chỗ của nó
   trong khung → chồng các lớp lên nhau là ra khuôn mặt.

   Biểu cảm của nhân vật (lưu trong characters/custom/<id>.json → "expressions"):
   Texture : {id, name, mode:'texture', loop, parts: {mask: {set:'ma-hong', fps: 8}, eyeL: {...}, …}}
   Keyshape: {id, name, mode:'keyshape', loop, duration, ease:'linear'|'smooth'|'step',
              parts: {mask: {set, fps}},
              tracks: {'<tên keyshape/morph target>': {part?: 'eyeL', keys:[{t:0, v:0}, {t:0.2, v:1}, {t:0.4, v:0.5}]}, …}}
   (mỗi keyshape của model là một track riêng với timeline riêng; "part" chỉ để nhóm/lọc cho dễ tìm)
   (biểu cảm cũ không có "mode" được coi là texture)
   ============================================================ */

/** Thứ tự vẽ: từ dưới lên trên. Mặt nạ là lớp nền biểu cảm (đỏ mặt, đen mặt, giận…) nên nằm DƯỚI CÙNG. */
export const FACE_PARTS = [
  {id: 'mask', label: 'Mặt nạ (nền)'},
  {id: 'browL', label: 'Mày trái'}, {id: 'browR', label: 'Mày phải'},
  {id: 'eyeL', label: 'Mắt trái'}, {id: 'eyeR', label: 'Mắt phải'},
  {id: 'nose', label: 'Mũi'}, {id: 'mouth', label: 'Miệng'}
];
/** Các bộ phận điều khiển bằng keyshape (mặt nạ luôn là texture). */
export const SHAPE_PARTS = FACE_PARTS.filter(p => p.id !== 'mask');
export const DEFAULT_DURATION = 1.5;
export const FACES_DIR = 'faces';
export const FACE_FIT = {y: 0.45, z: 0.5, s: 0.9};   // độ cao / ra trước / cỡ mặt (× chiều cao đầu)
export const DEFAULT_FPS = 8;
export const FACE_SIZE = 512;

const enc = p => p.split('/').map(encodeURIComponent).join('/');
const natural = (a, b) => a.localeCompare(b, 'en', {numeric: true, sensitivity: 'base'});
export const emptyLib = () => Object.fromEntries(FACE_PARTS.map(p => [p.id, {}]));

/** Từ danh sách đường dẫn file → {bộ phận: {biểu cảm: [đường dẫn ảnh đã sắp xếp]}} */
export function libFromPaths(paths) {
  const lib = emptyLib(), byLower = Object.fromEntries(FACE_PARTS.map(p => [p.id.toLowerCase(), p.id]));
  for (const path of paths) {
    const m = path.match(/^faces\/([^/]+)\/([^/]+)\/([^/]+\.png)$/i);
    if (!m) continue;
    const part = byLower[m[1].toLowerCase()];
    if (!part) continue;
    (lib[part][m[2]] || (lib[part][m[2]] = [])).push(path);
  }
  for (const part of Object.keys(lib)) {
    const sorted = {};
    for (const type of Object.keys(lib[part]).sort(natural)) sorted[type] = lib[part][type].sort((a, b) => natural(a.split('/').pop(), b.split('/').pop()));
    lib[part] = sorted;
  }
  return lib;
}

/**
 * Quét thư mục faces/ trên GitHub bằng 1 lần gọi git-tree (không cần token với repo công khai).
 * Nếu API không dùng được thì đọc faces/manifest.json.
 */
export async function scanFaces() {
  const {repo, token} = auth();
  try {
    const r = await fetch('https://api.github.com/repos/' + repo + '/git/trees/main?recursive=1', {
      cache: 'no-store', headers: {Accept: 'application/vnd.github+json', ...(token ? {Authorization: 'Bearer ' + token} : {})}
    });
    if (r.ok) {
      const j = await r.json();
      return {lib: libFromPaths((j.tree || []).filter(x => x.type === 'blob').map(x => x.path)), source: 'git', truncated: !!j.truncated};
    }
  } catch (e) { /* thử manifest */ }
  const m = await readJSON(FACES_DIR + '/manifest.json', null);
  if (m && m.parts) {
    const lib = emptyLib();
    for (const p of FACE_PARTS) lib[p.id] = m.parts[p.id] || {};
    return {lib, source: 'manifest'};
  }
  return {lib: emptyLib(), source: 'none'};
}
/** Ghi faces/manifest.json (chỉ khi nội dung đổi) để trang chạy được cả khi API GitHub bị giới hạn. */
export async function syncManifest(lib) {
  const old = await readJSON(FACES_DIR + '/manifest.json', null);
  if (old && JSON.stringify(old.parts) === JSON.stringify(lib)) return false;
  await ghPutText(FACES_DIR + '/manifest.json', JSON.stringify({version: 1, updatedAt: new Date().toISOString(), parts: lib}, null, 2), 'Update face manifest');
  return true;
}
export const libCount = lib => Object.values(lib).reduce((n, sets) => n + Object.keys(sets).length, 0);

/* ---------------- Ảnh ---------------- */
const IMG = new Map();
let onLoad = null;
export const onFaceImage = fn => { onLoad = fn; };
export const clearFaceCache = () => IMG.clear();
/** Trả về {img, ok, fail}. Lần đầu sẽ bắt đầu tải (file tương đối → raw.githubusercontent). */
export function faceImage(path) {
  let e = IMG.get(path);
  if (e) return e;
  e = {img: null, ok: false, fail: false};
  IMG.set(path, e);
  const im = new Image(), tries = ['./' + enc(path), repoRaw(path)];
  let i = 0;
  im.crossOrigin = 'anonymous';
  im.onload = () => { e.img = im; e.ok = true; if (onLoad) onLoad(path); };
  im.onerror = () => { if (++i < tries.length) im.src = tries[i] + '?v=' + Date.now(); else e.fail = true; };
  im.src = tries[0];
  return e;
}

/* ---------------- Ghép khuôn mặt ---------------- */
export function frameIndex(n, t, fps, loop) {
  if (n <= 1) return 0;
  const i = Math.floor(Math.max(0, t) * Math.max(0.5, +fps || DEFAULT_FPS));
  return loop === false ? Math.min(i, n - 1) : i % n;
}
/** Các lớp (đường dẫn ảnh) cần vẽ tại thời điểm t, theo thứ tự từ dưới lên. */
export function layersAt(expr, lib, t) {
  const out = [];
  if (!expr) return out;
  const ks = exprMode(expr) === 'keyshape';          // keyshape: chỉ còn mặt nạ là texture
  for (const p of FACE_PARTS) {
    if (ks && p.id !== 'mask') continue;
    const cfg = expr.parts && expr.parts[p.id];
    const frames = cfg && cfg.set && lib[p.id] && lib[p.id][cfg.set];
    if (frames && frames.length) out.push(frames[frameIndex(frames.length, t, cfg.fps, expr.loop)]);
  }
  return out;
}
/**
 * Vẽ biểu cảm lên canvas. Trả về chữ ký các lớp đã vẽ; nếu truyền `prevSig` trùng thì bỏ qua (không vẽ lại).
 * Ảnh được căn giữa, giữ tỉ lệ, trong khung vuông.
 */
export function renderFace(canvas, expr, lib, t, prevSig) {
  const layers = layersAt(expr, lib, t);
  const sig = layers.map(p => p + (faceImage(p).ok ? '' : '?')).join('|');
  if (sig === prevSig) return sig;
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  for (const p of layers) {
    const im = faceImage(p).img;
    if (!im) continue;
    const k = Math.min(W / im.naturalWidth, H / im.naturalHeight);
    g.drawImage(im, (W - im.naturalWidth * k) / 2, (H - im.naturalHeight * k) / 2, im.naturalWidth * k, im.naturalHeight * k);
  }
  return sig;
}

/* ---------------- Keyshape: timeline keyframe 0→1 cho từng keyshape ---------------- */
export const exprMode = e => (e && e.mode === 'keyshape') ? 'keyshape' : 'texture';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Nâng cấp biểu cảm keyshape bản cũ (shapes theo bộ phận) lên dạng tracks theo tên keyshape. */
export function upgradeExpr(e) {
  if (!e || exprMode(e) !== 'keyshape') return e;
  if (!e.tracks) e.tracks = {};
  if (!e.parts) e.parts = {};
  if (e.shapes) {
    for (const [part, s] of Object.entries(e.shapes)) {
      if (!s || !s.shape) continue;
      const tr = e.tracks[s.shape] || (e.tracks[s.shape] = {keys: []});
      if (!tr.part) tr.part = part;
      tr.keys.push(...(s.keys || []));
    }
    delete e.shapes;
  }
  return e;
}
/** Đoán bộ phận từ tên keyshape (eyeBlinkLeft, brow_L, mouthSmile…). Trả '' nếu không chắc. */
export function guessPart(name) {
  const tok = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const has = (...w) => tok.some(t => w.includes(t)), starts = re => tok.some(t => re.test(t));
  const side = has('l', 'left') ? 'L' : has('r', 'right') ? 'R' : '';
  if (starts(/^(brow|eyebrow)/)) return side ? 'brow' + side : '';
  if (starts(/^(eye|eyelid|blink|lid|pupil|iris)/)) return side ? 'eye' + side : '';
  if (starts(/^(nose|nostril|sneer)/)) return 'nose';
  if (starts(/^(mouth|lip|lips|jaw|smile|tongue|viseme|teeth|chin|cheek)/)) return 'mouth';
  return '';
}
/** Thời lượng của biểu cảm keyshape (không bao giờ ngắn hơn keyframe cuối). */
export function exprDuration(e) {
  let d = Math.max(0.1, +e.duration || DEFAULT_DURATION);
  if (e.tracks) for (const tr of Object.values(e.tracks)) if (tr && tr.keys) for (const k of tr.keys) if (k.t > d) d = +k.t;
  return d;
}
/** Thời điểm t (giây, chạy mãi) → thời điểm trong biểu cảm: lặp vòng nếu loop, ngược lại giữ ở cuối. */
export function localTime(e, t) {
  const D = exprDuration(e);
  return e.loop === false ? clamp(t, 0, D) : (((t % D) + D) % D);
}
/** Giá trị keyshape tại thời điểm t (đã nằm trong [0, D]). keys có thể chưa sắp xếp. */
export function evalKeys(keys, t, ease) {
  if (!keys || !keys.length) return null;
  const k = keys.length === 1 ? keys : keys.slice().sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b.t) {
      if (ease === 'step') return a.v;
      let u = (t - a.t) / Math.max(1e-9, b.t - a.t);
      if (ease === 'smooth') u = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * u;
    }
  }
  return last.v;
}
/** {tên keyshape: giá trị} tại thời điểm t, chỉ gồm keyshape có keyframe. */
export function shapeValues(expr, t) {
  const out = {};
  if (!expr || exprMode(expr) !== 'keyshape' || !expr.tracks) return out;
  const tt = localTime(expr, t);
  for (const [name, tr] of Object.entries(expr.tracks)) if (tr && tr.keys && tr.keys.length) out[name] = evalKeys(tr.keys, tt, expr.ease);
  return out;
}
/**
 * Bộ điều khiển keyshape (morph target) của model. setModel(root) quét mọi mesh có morphTargetDictionary
 * và trả về danh sách tên; apply({tên: giá trị}) ghi morphTargetInfluences; release() trả các keyshape đã chạm về 0.
 */
export function createShapeDriver() {
  let map = new Map(), driven = new Set();
  const put = (name, v) => { const l = map.get(name); if (l) for (const [m, i] of l) m.morphTargetInfluences[i] = v; };
  const names = () => [...map.keys()].sort(natural);
  return {
    names,
    setModel(root) {
      map = new Map(); driven = new Set();
      if (root) root.traverse(o => {
        const d = o.morphTargetDictionary;
        if (!o.isMesh || !d || !o.morphTargetInfluences) return;
        for (const [n, i] of Object.entries(d)) { if (!map.has(n)) map.set(n, []); map.get(n).push([o, i]); }
      });
      return names();
    },
    clear() { map = new Map(); driven = new Set(); },
    apply(vals) {
      const now = new Set();
      for (const name in vals) {
        if (!map.has(name)) continue;
        put(name, vals[name]); now.add(name);
      }
      for (const n of driven) if (!now.has(n)) put(n, 0);
      driven = now;
    },
    release() { if (!driven.size) return; for (const n of driven) put(n, 0); driven = new Set(); }
  };
}

/* ---------------- Gắn lên đầu nhân vật ---------------- */
/**
 * Tạo mặt phẳng hiển thị khuôn mặt, gắn vào xương đầu (cùng cách gắn đồ của Custom).
 * Gọi khi model đang ở rest pose. Trả về null nếu model không có xương đầu.
 */
export function mountFaceOverlay(rig, fit = FACE_FIT) {
  const bone = rig && rig.bone('head');
  if (!bone) return null;
  const info = rig.rest.get(bone), top = rig.pos('headTop'), head = rig.pos('head');
  const hh = top && head ? Math.min(0.5, Math.max(0.05, top.distanceTo(head))) : 0.2;
  const holder = new THREE.Group();
  holder.name = 'holder_face';
  info.holder.decompose(holder.position, holder.quaternion, holder.scale);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FACE_SIZE;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));
  mesh.renderOrder = 20; mesh.frustumCulled = false; mesh.visible = false;
  holder.add(mesh); bone.add(holder);
  const o = {
    holder, mesh, canvas, sig: null, hh,
    setFit(f) { mesh.position.set(0, hh * (+f.y || 0), hh * (+f.z || 0)); mesh.scale.setScalar(hh * (+f.s || 0.9)); },
    /** expr = null → ẩn. */
    update(expr, lib, t) {
      mesh.visible = !!expr;
      if (!expr) { o.sig = null; return; }
      // texture: mặt phẳng luôn nằm trên cùng. keyshape: mặt phẳng chỉ chứa mặt nạ nền → để bị che bởi các bộ phận 3D phía trước nó.
      mesh.material.depthTest = exprMode(expr) === 'keyshape';
      const sig = renderFace(canvas, expr, lib, t, o.sig);
      if (sig !== o.sig) { o.sig = sig; tex.needsUpdate = true; }
    },
    dispose() { holder.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); }
  };
  o.setFit(fit);
  return o;
}
