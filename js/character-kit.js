import * as THREE from 'three';
import {norm} from './retarget.js';
import {CHAR_EXTS, extRegex} from './model-loader.js';
import {PACK_RE, bindSkinnedItem} from './character-pack.js';
import {splitPair} from './pair-split.js';
export {splitPair};
export {CHAR_EXTS, CHAR_EXTS as CHARACTER_EXTS, extOf, stripExt, loadModelUrl, parseModel, acceptOf, listText} from './model-loader.js';
export const CHAR_RE = extRegex(CHAR_EXTS);

/* ============================================================
   GitHub (dùng chung token/repo đã lưu ở trang Cài đặt)
   ============================================================ */
export const TOKEN_KEY = '3dis.github.token', REPO_KEY = '3dis.github.repo';
export const DEFAULT_REPO = 'nhothicam02-code/3d-animation-studio';
export const auth = () => ({
  token: localStorage.getItem(TOKEN_KEY) || '',
  repo: localStorage.getItem(REPO_KEY) || DEFAULT_REPO
});
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

async function gh(path, {method = 'GET', body, raw = false} = {}) {
  const {token, repo} = auth();
  if (!token) throw Error('Chưa có GitHub token. Hãy nhập ở trang Cài đặt (index.html).');
  const res = await fetch('https://api.github.com/repos/' + repo + '/contents/' + encPath(path) + (method === 'GET' ? '?ref=main' : ''), {
    method, cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? {'Content-Type': 'application/json'} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw Error(d.message || ('GitHub API lỗi ' + res.status));
  }
  return raw ? res : res.json();
}
export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const textToB64 = s => bytesToB64(new TextEncoder().encode(s));
async function currentSha(path) {
  try { return (await gh(path)).sha; }
  catch (e) { if (/not found/i.test(e.message)) return undefined; throw e; }
}
export async function ghPutText(path, text, message) {
  const sha = await currentSha(path);
  return gh(path, {method: 'PUT', body: {message, content: textToB64(text), branch: 'main', ...(sha ? {sha} : {})}});
}
export async function ghPutBytes(path, bytes, message) {
  const sha = await currentSha(path);
  return gh(path, {method: 'PUT', body: {message, content: bytesToB64(bytes), branch: 'main', ...(sha ? {sha} : {})}});
}
export async function ghPutDataUrl(path, dataUrl, message) {
  const sha = await currentSha(path);
  return gh(path, {method: 'PUT', body: {message, content: dataUrl.split(',')[1], branch: 'main', ...(sha ? {sha} : {})}});
}
/** Đọc JSON mới nhất: ưu tiên API (khi có token, không bị cache), sau đó raw.githubusercontent, cuối cùng file tương đối. */
export async function readJSON(path, fallback = null) {
  const {token, repo} = auth();
  if (token) {
    try { const r = await gh(path, {raw: true}); return await r.json(); } catch (e) { /* thử nguồn khác */ }
  }
  for (const u of ['https://raw.githubusercontent.com/' + repo + '/main/' + encPath(path), './' + encPath(path)]) {
    try { const r = await fetch(u + '?v=' + Date.now(), {cache: 'no-store'}); if (r.ok) return await r.json(); } catch (e) { /* tiếp */ }
  }
  return fallback;
}
export async function listModels() {
  const {repo} = auth();
  try {
    const {token} = auth();
    const r = await fetch('https://api.github.com/repos/' + repo + '/contents/characters?ref=main', token ? {headers: {Authorization: 'Bearer ' + token}} : undefined);
    if (r.ok) return (await r.json()).filter(x => x.type === 'file' && (CHAR_RE.test(x.name) || PACK_RE.test(x.name))).map(x => x.name);
  } catch (e) { /* dùng manifest */ }
  const m = await readJSON('library/manifest.json', {characters: {}});
  return Object.keys(m.characters || {});
}
export const repoRaw = path => 'https://raw.githubusercontent.com/' + auth().repo + '/main/' + encPath(path);
/** Gán src cho img/video/audio: thử file tương đối (GitHub Pages) → raw.githubusercontent → gọi fail(). */
export function setSrc(el, path, fail) {
  let step = 0;
  el.onerror = () => { if (step++ === 0) el.src = repoRaw(path); else { el.onerror = null; if (fail) fail(); } };
  el.src = './' + encPath(path);
}
/** Tải byte của một file trong repo (tương đối → raw → API có token). */
export async function fetchRepoBytes(path) {
  for (const u of ['./' + encPath(path), repoRaw(path)]) {
    try { const r = await fetch(u + '?v=' + Date.now(), {cache: 'no-store'}); if (r.ok) return await r.arrayBuffer(); } catch (e) { /* thử nguồn khác */ }
  }
  if (auth().token) { const r = await gh(path, {raw: true}); return await r.arrayBuffer(); }
  throw Error('Không tải được ' + path + ' (GitHub Pages có thể chưa cập nhật, hãy thử lại sau ít phút)');
}
export const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

/* ============================================================
   Bộ khung xương
   ============================================================ */
const KEYS = {
  hips: ['hips', 'pelvis', 'hip'], spine: ['spine', 'spine0', 'spine01'], spine1: ['spine1', 'spine02', 'chest'], spine2: ['spine2', 'spine03', 'upperchest'],
  neck: ['neck', 'neck1'], head: ['head'], headTop: ['headtopend', 'headtop'],
  lSho: ['leftshoulder', 'leftclavicle', 'lshoulder', 'lclavicle'], rSho: ['rightshoulder', 'rightclavicle', 'rshoulder', 'rclavicle'],
  lArm: ['leftarm', 'leftupperarm', 'lupperarm', 'larm'], rArm: ['rightarm', 'rightupperarm', 'rupperarm', 'rarm'],
  lFore: ['leftforearm', 'leftlowerarm', 'lforearm', 'llowerarm'], rFore: ['rightforearm', 'rightlowerarm', 'rforearm', 'rlowerarm'],
  lHand: ['lefthand', 'lhand'], rHand: ['righthand', 'rhand'],
  lUp: ['leftupleg', 'leftthigh', 'leftupperleg', 'lthigh', 'lupleg', 'lupperleg'], rUp: ['rightupleg', 'rightthigh', 'rightupperleg', 'rthigh', 'rupleg', 'rupperleg'],
  lLeg: ['leftleg', 'leftlowerleg', 'leftcalf', 'leftshin', 'lcalf', 'lshin', 'llowerleg'], rLeg: ['rightleg', 'rightlowerleg', 'rightcalf', 'rightshin', 'rcalf', 'rshin', 'rlowerleg'],
  lFoot: ['leftfoot', 'lfoot'], rFoot: ['rightfoot', 'rfoot'],
  lToe: ['lefttoebase', 'lefttoe', 'ltoe', 'lefttoes'], rToe: ['righttoebase', 'righttoe', 'rtoe', 'righttoes']
};
export const BONE_LABELS = {
  hips: 'Hông', spine: 'Cột sống dưới', spine1: 'Cột sống giữa', spine2: 'Ngực', neck: 'Cổ', head: 'Đầu', headTop: 'Đỉnh đầu',
  lSho: 'Vai trái', rSho: 'Vai phải', lArm: 'Bắp tay trái', rArm: 'Bắp tay phải', lFore: 'Cẳng tay trái', rFore: 'Cẳng tay phải',
  lHand: 'Bàn tay trái', rHand: 'Bàn tay phải', lUp: 'Đùi trái', rUp: 'Đùi phải', lLeg: 'Cẳng chân trái', rLeg: 'Cẳng chân phải',
  lFoot: 'Bàn chân trái', rFoot: 'Bàn chân phải', lToe: 'Mũi chân trái', rToe: 'Mũi chân phải'
};
const ALIAS = new Map();
for (const [k, arr] of Object.entries(KEYS)) for (const a of arr) if (!ALIAS.has(a)) ALIAS.set(a, k);

/**
 * Chuẩn hoá model: cao 1.8 đơn vị (≈ mét), chân chạm y=0, đứng giữa gốc toạ độ, quay mặt về +Z.
 * Trả về `wrap` (Group). Model gốc không bị đổi scale để retarget animation vẫn đúng.
 */
export function normalizeModel(model, height = 1.8) {
  const wrap = new THREE.Group();
  wrap.add(model);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(height / Math.max(size.y, 1e-6));
  wrap.updateMatrixWorld(true);
  // quay mặt về +Z dựa theo hướng bàn chân → mũi chân
  const probe = {};
  model.traverse(o => { if (o.isBone) { const k = ALIAS.get(norm(o.name)); if (k && !probe[k]) probe[k] = o; } });
  const toe = probe.lToe || probe.rToe, foot = probe.lFoot || probe.rFoot;
  if (toe && foot) {
    const a = new THREE.Vector3().setFromMatrixPosition(foot.matrixWorld), b = new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);
    const d = b.sub(a); d.y = 0;
    if (d.length() > 1e-4) wrap.rotation.y = -Math.atan2(d.x, d.z);
  }
  wrap.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model), c = box2.getCenter(new THREE.Vector3());
  wrap.position.set(-c.x, -box2.min.y, -c.z);
  wrap.updateMatrixWorld(true);
  return wrap;
}

/** Quét xương. Gọi khi model đang ở rest pose (chưa phát animation) và spin = 0. */
export function buildRig(model) {
  model.updateMatrixWorld(true);
  const bones = [], byKey = {}, byName = new Map();
  model.traverse(o => {
    if (!o.isBone) return;
    bones.push(o);
    byName.set(o.name, o);
    const k = ALIAS.get(norm(o.name));
    if (k && !byKey[k]) byKey[k] = o;
  });
  const rest = new Map(); // bone -> {pos, holder: Matrix4}
  for (const b of bones) {
    const m = b.matrixWorld.clone(), pos = new THREE.Vector3().setFromMatrixPosition(m);
    rest.set(b, {pos, holder: m.clone().invert().multiply(new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z))});
  }
  const rig = {
    model, bones, byKey, byName, rest,
    lsign: 1,
    bone(spec) { return spec && spec.startsWith('n:') ? byName.get(spec.slice(2)) : byKey[spec]; },
    /** Vị trí rest (không gian thế giới) của một key/xương; có giá trị dự phòng cho đỉnh đầu & mũi chân. */
    pos(spec) {
      const b = rig.bone(spec);
      if (b) return rest.get(b).pos.clone();
      if (spec === 'headTop' && byKey.head) return rest.get(byKey.head).pos.clone().add(new THREE.Vector3(0, 0.2, 0));
      if (spec === 'lToe' && byKey.lFoot) return rest.get(byKey.lFoot).pos.clone().add(new THREE.Vector3(0, -0.05, 0.12));
      if (spec === 'rToe' && byKey.rFoot) return rest.get(byKey.rFoot).pos.clone().add(new THREE.Vector3(0, -0.05, 0.12));
      return null;
    }
  };
  if (byKey.lArm && byKey.rArm) rig.lsign = rest.get(byKey.lArm).pos.x >= rest.get(byKey.rArm).pos.x ? 1 : -1;
  rig.missing = Object.keys(BONE_LABELS).filter(k => !rig.bone(k) && !['headTop'].includes(k));
  return rig;
}
export function boneOptions(rig) {
  const major = Object.keys(BONE_LABELS).filter(k => rig.byKey[k]).map(k => ({value: k, label: BONE_LABELS[k] + ' · ' + rig.byKey[k].name}));
  const used = new Set(Object.values(rig.byKey));
  const other = rig.bones.filter(b => !used.has(b)).map(b => ({value: 'n:' + b.name, label: 'Khác · ' + b.name}));
  return {major, other};
}

/* ============================================================
   Catalog đồ: mọi đơn vị là mét, trục theo nhân vật ở T-pose
   (X = ngang, Y = lên, Z = phía trước). Hình khối tự co theo độ dài xương.
   ============================================================ */
export const SLOTS = [
  {id: 'hat', label: 'Mũ', icon: '🎩'}, {id: 'hair', label: 'Tóc', icon: '💇'}, {id: 'mask', label: 'Mặt nạ', icon: '🎭'}, {id: 'scarf', label: 'Khăn choàng', icon: '🧣'}, {id: 'jacket', label: 'Áo khoác', icon: '🧥'},
  {id: 'sleeves', label: 'Tay áo', icon: '💪'}, {id: 'gloves', label: 'Bao tay', icon: '🧤'}, {id: 'outer', label: 'Áo ngoài', icon: '👕'},
  {id: 'under', label: 'Áo lót', icon: '🎽'}, {id: 'brief', label: 'Quần lót', icon: '🩲'}, {id: 'shorts', label: 'Quần ngắn', icon: '🩳'},
  {id: 'pants', label: 'Quần dài', icon: '👖'}, {id: 'skirt', label: 'Váy', icon: '👗'}, {id: 'socks', label: 'Vớ', icon: '🧦'},
  {id: 'shoes', label: 'Giày', icon: '👟'}, {id: 'belt', label: 'Thắt lưng', icon: '🥋'}, {id: 'tail', label: 'Đuôi', icon: '🦊'},
  {id: 'acc', label: 'Phụ kiện', icon: '👓'}, {id: 'ear', label: 'Hoa tai', icon: '💎'}
];
/** Xương gắn mặc định cho từng danh mục (dùng chung cho Custom, Studio…). */
export const DEFAULT_BONE = {hat: 'head', scarf: 'neck', jacket: 'spine2', outer: 'spine2', under: 'spine2', sleeves: 'lArm', gloves: 'lHand', hair: 'head', mask: 'head', brief: 'hips', shorts: 'hips', pants: 'hips', skirt: 'hips', socks: 'lFoot', shoes: 'lFoot', belt: 'hips', tail: 'hips', acc: 'head', ear: 'head'};

const P = (part, label, bone, prims, side) => ({part, label, bone, prims, side});
const LR = fn => [fn('l', 'trái'), fn('r', 'phải')];
// Thân người
const torsoLow = (r, sz = 0.7, extra = {}) => P('torsoLow', 'Thân dưới', 'hips', [{t: 'tube', to: 'spine2', r0: r * 1.03, r1: r * 0.95, sx: 1.1, sz, ...extra}]);
const torsoUp = (r, sz = 0.72, extra = {}) => P('torsoUp', 'Thân trên', 'spine2', [{t: 'tube', to: 'neck', r0: r, r1: r * 1.04, sx: 1.28, sz, ...extra}]);
const arm = (r, upto = 1, key = 'Arm') => s => P('arm' + s, 'Tay áo ' + (s === 'l' ? 'trái' : 'phải'), s + 'Arm', [{t: 'tube', to: s + 'Fore', r0: r * 1.05, r1: r * 0.95, upto}], s);
const fore = r => s => P('fore' + s, 'Cổ tay áo ' + (s === 'l' ? 'trái' : 'phải'), s + 'Fore', [{t: 'tube', to: s + 'Hand', r0: r * 0.95, r1: r * 0.85}], s);
const thigh = (r, upto = 1) => s => P('thigh' + s, 'Ống quần đùi ' + (s === 'l' ? 'trái' : 'phải'), s + 'Up', [{t: 'tube', to: s + 'Leg', r0: r * 1.08, r1: r * 0.84, upto}], s);
const calf = r => s => P('calf' + s, 'Ống quần cẳng ' + (s === 'l' ? 'trái' : 'phải'), s + 'Leg', [{t: 'tube', to: s + 'Foot', r0: r * 0.88, r1: r * 0.68}], s);
const pelvis = (h = 0.2, y = 0.03, r = 0.16) => P('pelvis', 'Hông', 'hips', [{t: 'cyl', rt: r, rb: r * 0.95, h, c: [0, y, 0], s: [1.08, 1, 0.78]}]);

/**
 * Dựng một chuỗi ống nối tiếp (đuôi, tóc buộc…) từ điểm start, mỗi đoạn [hướng, độ dài].
 * Bán kính nội suy r0 → r1; tip='tip' thêm quả cầu màu phụ ở đầu mút; mid = bán kính phình giữa (tuỳ chọn).
 */
function chain(start, segs, r0, r1, tip, bulge = 0, at) {
  const out = [], cur = new THREE.Vector3(...start), n = segs.length;
  segs.forEach(([d, len], i) => {
    const dir = new THREE.Vector3(...d).normalize(), a = i / n, b = (i + 1) / n;
    const ra = r0 + (r1 - r0) * a + bulge * Math.sin(Math.PI * a), rb = r0 + (r1 - r0) * b + bulge * Math.sin(Math.PI * b);
    out.push({t: 'tube', dir: dir.toArray(), len, r0: ra, r1: rb, c: cur.toArray(), ...(at ? {at} : {})});
    cur.addScaledVector(dir, len);
    out.push({t: 'sph', r: rb * 1.02, c: cur.toArray(), ...(at ? {at} : {})});
  });
  if (tip) out.push({t: 'sph', r: r1 * 1.25, s: [1, 1, 1.5], c: cur.toArray(), col: 2});
  return out;
}

export const PRESETS = [
  // ---- Mũ
  {id: 'hat-cap', slot: 'hat', name: 'Mũ lưỡi trai', color: '#c0392b', color2: '#7f1d1d', pieces: [P('main', 'Mũ', 'head', [
    {t: 'sph', r: 0.105, s: [1, 0.85, 1.06], at: 'headTop', c: [0, -0.075, 0]},
    {t: 'box', s: [0.16, 0.012, 0.13], at: 'headTop', c: [0, -0.108, 0.13], col: 2}])]},
  {id: 'hat-beanie', slot: 'hat', name: 'Mũ len', color: '#2c5aa0', color2: '#f2f2f2', pieces: [P('main', 'Mũ', 'head', [
    {t: 'sph', r: 0.108, s: [1, 0.92, 1.04], at: 'headTop', c: [0, -0.078, 0]},
    {t: 'sph', r: 0.03, at: 'headTop', c: [0, 0.03, 0], col: 2}])]},
  {id: 'hat-fedora', slot: 'hat', name: 'Mũ phớt', color: '#4a3b32', color2: '#1f1a17', pieces: [P('main', 'Mũ', 'head', [
    {t: 'cyl', rt: 0.17, rb: 0.17, h: 0.008, at: 'headTop', c: [0, -0.1, 0]},
    {t: 'cyl', rt: 0.088, rb: 0.105, h: 0.1, at: 'headTop', c: [0, -0.048, 0]},
    {t: 'cyl', rt: 0.107, rb: 0.107, h: 0.022, at: 'headTop', c: [0, -0.088, 0], col: 2}])]},
  {id: 'hat-party', slot: 'hat', name: 'Mũ chóp', color: '#e84393', color2: '#ffeaa7', pieces: [P('main', 'Mũ', 'head', [
    {t: 'cone', r: 0.09, h: 0.24, at: 'headTop', c: [0, 0.03, 0]}, {t: 'sph', r: 0.022, at: 'headTop', c: [0, 0.16, 0], col: 2}])]},
  {id: 'hat-helmet', slot: 'hat', name: 'Mũ bảo hiểm', color: '#f1c40f', color2: '#2d3436', pieces: [P('main', 'Mũ', 'head', [
    {t: 'sph', r: 0.128, s: [1, 0.95, 1.08], at: 'headTop', c: [0, -0.07, 0]},
    {t: 'box', s: [0.2, 0.014, 0.09], at: 'headTop', c: [0, -0.125, 0.12], col: 2}])]},
  // ---- Khăn choàng
  {id: 'scarf-long', slot: 'scarf', name: 'Khăn quàng cổ', color: '#d63031', color2: '#fab1a0', pieces: [P('main', 'Khăn', 'neck', [
    {t: 'tor', R: 0.085, r: 0.035, rot: [90, 0, 0], c: [0, 0.02, 0.005]},
    {t: 'box', s: [0.075, 0.34, 0.03], c: [0.07, -0.16, 0.1], rot: [0, 0, 4], col: 2}])]},
  {id: 'scarf-snood', slot: 'scarf', name: 'Khăn ống', color: '#636e72', color2: '#b2bec3', pieces: [P('main', 'Khăn', 'neck', [
    {t: 'cyl', rt: 0.092, rb: 0.105, h: 0.1, c: [0, 0.035, 0.005], open: true}])]},
  // ---- Áo khoác
  {id: 'jacket-zip', slot: 'jacket', name: 'Áo khoác dài tay', color: '#2d3436', color2: '#b2bec3', pieces: [
    torsoLow(0.17, 0.74), torsoUp(0.165, 0.74),
    P('collar', 'Cổ áo', 'neck', [{t: 'cyl', rt: 0.07, rb: 0.092, h: 0.07, c: [0, 0.03, 0], open: true, col: 2}]),
    ...LR(arm(0.066)), ...LR(fore(0.062))]},
  {id: 'jacket-vest', slot: 'jacket', name: 'Áo gile', color: '#6c5ce7', color2: '#dfe6e9', pieces: [torsoLow(0.165, 0.72), torsoUp(0.16, 0.72)]},
  {id: 'jacket-hoodie', slot: 'jacket', name: 'Áo hoodie', color: '#00b894', color2: '#55efc4', pieces: [
    torsoLow(0.175, 0.76), torsoUp(0.17, 0.76),
    P('hood', 'Mũ trùm', 'neck', [{t: 'tor', R: 0.095, r: 0.04, rot: [70, 0, 0], c: [0, 0.01, -0.03], col: 2}]),
    ...LR(arm(0.068)), ...LR(fore(0.064))]},
  // ---- Tay áo
  {id: 'sleeve-long', slot: 'sleeves', name: 'Tay áo dài', color: '#0984e3', color2: '#74b9ff', pieces: [...LR(arm(0.058)), ...LR(fore(0.052))]},
  {id: 'sleeve-short', slot: 'sleeves', name: 'Tay áo ngắn', color: '#e17055', color2: '#fab1a0', pieces: LR(arm(0.06, 0.55))},
  {id: 'sleeve-cuff', slot: 'sleeves', name: 'Bó cổ tay', color: '#2d3436', color2: '#636e72', pieces: LR(s => P('cuff' + s, 'Bó tay ' + (s === 'l' ? 'trái' : 'phải'), s + 'Fore', [{t: 'tube', to: s + 'Hand', r0: 0.046, r1: 0.044, from: 0.55, upto: 1}], s))},
  // ---- Bao tay
  {id: 'glove-mitten', slot: 'gloves', name: 'Bao tay', color: '#2d3436', color2: '#636e72', pieces: LR(s => P('hand' + s, 'Bao tay ' + (s === 'l' ? 'trái' : 'phải'), s + 'Hand', [{t: 'tube', along: s + 'Fore', len: 0.17, r0: 0.042, r1: 0.038, sz: 0.6}], s))},
  {id: 'glove-long', slot: 'gloves', name: 'Bao tay dài', color: '#6d214f', color2: '#b33771', pieces: LR(s => P('handlong' + s, 'Bao tay dài ' + (s === 'l' ? 'trái' : 'phải'), s + 'Hand', [
    {t: 'tube', along: s + 'Fore', len: 0.17, r0: 0.042, r1: 0.038, sz: 0.6}], s)).concat(LR(fore(0.05)))},
  // ---- Áo ngoài
  {id: 'shirt-tee', slot: 'outer', name: 'Áo thun', color: '#ffffff', color2: '#dfe6e9', pieces: [torsoLow(0.155, 0.7), torsoUp(0.152, 0.7), ...LR(arm(0.062, 0.5))]},
  {id: 'shirt-long', slot: 'outer', name: 'Áo sơ mi dài tay', color: '#74b9ff', color2: '#ffffff', pieces: [torsoLow(0.157, 0.7), torsoUp(0.154, 0.7), P('collar', 'Cổ áo', 'neck', [{t: 'cyl', rt: 0.062, rb: 0.078, h: 0.05, c: [0, 0.025, 0], open: true, col: 2}]), ...LR(arm(0.06)), ...LR(fore(0.052))]},
  {id: 'shirt-tank', slot: 'outer', name: 'Áo ba lỗ', color: '#fdcb6e', color2: '#e17055', pieces: [torsoLow(0.152, 0.68), torsoUp(0.148, 0.68, {sx: 1.05})]},
  // ---- Áo lót
  {id: 'under-tank', slot: 'under', name: 'Áo lót ba lỗ', color: '#dfe6e9', color2: '#b2bec3', pieces: [torsoLow(0.146, 0.66), torsoUp(0.142, 0.66, {sx: 1.0})]},
  {id: 'under-bra', slot: 'under', name: 'Áo lót ngực', color: '#fd79a8', color2: '#e84393', pieces: [
    P('cups', 'Cúp ngực', 'spine2', [{t: 'sph', r: 0.062, s: [1, 1, 0.85], c: [0.065, 0.045, 0.085]}, {t: 'sph', r: 0.062, s: [1, 1, 0.85], c: [-0.065, 0.045, 0.085]}]),
    P('band', 'Dây quanh ngực', 'spine2', [{t: 'cyl', rt: 0.15, rb: 0.15, h: 0.03, c: [0, 0.0, 0], s: [1.08, 1, 0.74], open: true, col: 2}])]},
  // ---- Quần lót
  {id: 'brief-basic', slot: 'brief', name: 'Quần lót', color: '#ecf0f1', color2: '#b2bec3', pieces: [pelvis(0.15, -0.03, 0.155), ...LR(thigh(0.1, 0.18))]},
  {id: 'brief-boxer', slot: 'brief', name: 'Quần boxer', color: '#0984e3', color2: '#74b9ff', pieces: [pelvis(0.17, -0.02, 0.157), ...LR(thigh(0.102, 0.4))]},
  // ---- Quần ngắn
  {id: 'shorts-basic', slot: 'shorts', name: 'Quần short', color: '#3d5a80', color2: '#98c1d9', pieces: [pelvis(0.2, 0.0, 0.16), ...LR(thigh(0.105, 0.62))]},
  {id: 'shorts-hot', slot: 'shorts', name: 'Quần đùi ngắn', color: '#ff7675', color2: '#fab1a0', pieces: [pelvis(0.17, -0.02, 0.158), ...LR(thigh(0.103, 0.32))]},
  // ---- Quần dài
  {id: 'pants-jeans', slot: 'pants', name: 'Quần jean', color: '#34495e', color2: '#2c3e50', pieces: [pelvis(0.22, 0.02, 0.16), ...LR(thigh(0.105)), ...LR(calf(0.082))]},
  {id: 'pants-slim', slot: 'pants', name: 'Quần ôm', color: '#2d3436', color2: '#636e72', pieces: [pelvis(0.22, 0.02, 0.158), ...LR(thigh(0.098)), ...LR(calf(0.07))]},
  // ---- Váy
  {id: 'skirt-mini', slot: 'skirt', name: 'Váy ngắn', color: '#e84393', color2: '#fd79a8', pieces: [P('main', 'Váy', 'hips', [
    {t: 'cyl', rt: 0.16, rb: 0.27, h: 0.26, c: [0, -0.1, 0], s: [1.05, 1, 0.9], open: true}, {t: 'cyl', rt: 0.16, rb: 0.16, h: 0.03, c: [0, 0.04, 0], s: [1.05, 1, 0.9], open: true, col: 2}])]},
  {id: 'skirt-midi', slot: 'skirt', name: 'Váy dài đến gối', color: '#6c5ce7', color2: '#a29bfe', pieces: [P('main', 'Váy', 'hips', [
    {t: 'cyl', rt: 0.16, rb: 0.32, h: 0.5, c: [0, -0.21, 0], s: [1.05, 1, 0.92], open: true}, {t: 'cyl', rt: 0.16, rb: 0.16, h: 0.03, c: [0, 0.04, 0], s: [1.05, 1, 0.9], open: true, col: 2}])]},
  {id: 'skirt-long', slot: 'skirt', name: 'Váy dài', color: '#00cec9', color2: '#81ecec', pieces: [P('main', 'Váy', 'hips', [
    {t: 'cyl', rt: 0.16, rb: 0.38, h: 0.85, c: [0, -0.385, 0], s: [1.05, 1, 0.95], open: true}, {t: 'cyl', rt: 0.16, rb: 0.16, h: 0.03, c: [0, 0.04, 0], s: [1.05, 1, 0.9], open: true, col: 2}])]},
  // ---- Vớ
  {id: 'socks-ankle', slot: 'socks', name: 'Vớ ngắn', color: '#ffffff', color2: '#dfe6e9', pieces: LR(s => P('sock' + s, 'Vớ ' + (s === 'l' ? 'trái' : 'phải'), s + 'Foot', [
    {t: 'tube', to: s + 'Toe', r0: 0.052, r1: 0.05, from: -0.1, upto: 1.1, sx: 1, sz: 1.0}, {t: 'tube', along: s + 'Leg', len: 0.1, r0: 0.05, r1: 0.05, from: -1, upto: 0, col: 2}], s))},
  {id: 'socks-knee', slot: 'socks', name: 'Vớ cao', color: '#2d3436', color2: '#b2bec3', pieces: LR(s => P('sockh' + s, 'Vớ cao ' + (s === 'l' ? 'trái' : 'phải'), s + 'Leg', [
    {t: 'tube', to: s + 'Foot', r0: 0.072, r1: 0.055}], s)).concat(LR(s => P('sockf' + s, 'Bàn vớ ' + (s === 'l' ? 'trái' : 'phải'), s + 'Foot', [
    {t: 'tube', to: s + 'Toe', r0: 0.054, r1: 0.05, from: -0.1, upto: 1.1}], s)))},
  // ---- Giày
  {id: 'shoes-sneaker', slot: 'shoes', name: 'Giày thể thao', color: '#ffffff', color2: '#d63031', pieces: LR(s => P('shoe' + s, 'Giày ' + (s === 'l' ? 'trái' : 'phải'), s + 'Foot', [
    {t: 'box', s: [0.105, 0.085, 0.27], at: [s + 'Toe', 0.5], c: [0, 0.0, -0.01]}, {t: 'box', s: [0.11, 0.025, 0.28], at: [s + 'Toe', 0.5], c: [0, -0.052, -0.01], col: 2}], s))},
  {id: 'shoes-boot', slot: 'shoes', name: 'Bốt cao cổ', color: '#5d4037', color2: '#2d1f1a', pieces: LR(s => P('boot' + s, 'Bốt ' + (s === 'l' ? 'trái' : 'phải'), s + 'Foot', [
    {t: 'box', s: [0.108, 0.09, 0.28], at: [s + 'Toe', 0.5], c: [0, 0.0, -0.01]}, {t: 'tube', along: s + 'Leg', len: 0.2, r0: 0.068, r1: 0.075, from: -1, upto: 0}, {t: 'box', s: [0.114, 0.028, 0.29], at: [s + 'Toe', 0.5], c: [0, -0.054, -0.01], col: 2}], s))},
  // ---- Phụ kiện
  {id: 'acc-glasses', slot: 'acc', name: 'Kính mắt', color: '#2d3436', color2: '#74b9ff', pieces: [P('main', 'Kính', 'head', [
    {t: 'tor', R: 0.03, r: 0.004, at: 'headTop', c: [0.04, -0.09, 0.098]}, {t: 'tor', R: 0.03, r: 0.004, at: 'headTop', c: [-0.04, -0.09, 0.098]},
    {t: 'box', s: [0.025, 0.004, 0.004], at: 'headTop', c: [0, -0.085, 0.1]}, {t: 'box', s: [0.004, 0.004, 0.16], at: 'headTop', c: [0.075, -0.09, 0.02]}, {t: 'box', s: [0.004, 0.004, 0.16], at: 'headTop', c: [-0.075, -0.09, 0.02]}])]},
  {id: 'acc-backpack', slot: 'acc', name: 'Ba lô', color: '#e17055', color2: '#2d3436', pieces: [P('main', 'Ba lô', 'spine2', [
    {t: 'box', s: [0.28, 0.38, 0.12], c: [0, -0.02, -0.15]}, {t: 'box', s: [0.2, 0.14, 0.05], c: [0, -0.1, -0.23], col: 2}])]},
  {id: 'acc-belt', slot: 'belt', name: 'Thắt lưng', color: '#2d3436', color2: '#f1c40f', pieces: [P('main', 'Thắt lưng', 'hips', [
    {t: 'cyl', rt: 0.165, rb: 0.165, h: 0.035, c: [0, 0.07, 0], s: [1.08, 1, 0.8], open: true}, {t: 'box', s: [0.04, 0.036, 0.012], c: [0, 0.07, 0.133], col: 2}])]},
  {id: 'acc-watch', slot: 'acc', name: 'Đồng hồ (tay trái)', color: '#2d3436', color2: '#dfe6e9', pieces: [P('main', 'Đồng hồ', 'lFore', [
    {t: 'tube', to: 'lHand', r0: 0.05, r1: 0.05, from: 0.8, upto: 1}, {t: 'box', s: [0.03, 0.03, 0.012], at: ['lHand', 0], c: [0, 0.05, 0], col: 2}])]},
  {id: 'acc-necklace', slot: 'acc', name: 'Vòng cổ', color: '#f1c40f', color2: '#e84393', pieces: [P('main', 'Vòng cổ', 'neck', [
    {t: 'tor', R: 0.08, r: 0.007, rot: [75, 0, 0], c: [0, -0.03, 0.025]}, {t: 'sph', r: 0.02, c: [0, -0.08, 0.1], col: 2}])]},
  {id: 'acc-headband', slot: 'acc', name: 'Băng đô', color: '#e84393', color2: '#fd79a8', pieces: [P('main', 'Băng đô', 'head', [
    {t: 'tor', R: 0.103, r: 0.01, rot: [90, 0, 0], at: 'headTop', c: [0, -0.07, 0.0], s: [1, 1, 1]}])]},
  // ---- Thắt lưng (thêm)
  {id: 'belt-wide', slot: 'belt', name: 'Thắt lưng bản to', color: '#5d4037', color2: '#d4af37', pieces: [P('main', 'Thắt lưng', 'hips', [
    {t: 'cyl', rt: 0.168, rb: 0.168, h: 0.06, c: [0, 0.065, 0], s: [1.08, 1, 0.8], open: true}, {t: 'box', s: [0.07, 0.055, 0.014], c: [0, 0.065, 0.135], col: 2}])]},
  {id: 'belt-sash', slot: 'belt', name: 'Dải thắt eo (đai)', color: '#c0392b', color2: '#7f1d1d', pieces: [P('main', 'Đai', 'hips', [
    {t: 'cyl', rt: 0.166, rb: 0.166, h: 0.07, c: [0, 0.07, 0], s: [1.08, 1, 0.8], open: true},
    {t: 'box', s: [0.06, 0.22, 0.012], c: [0.05, -0.05, 0.135], rot: [0, 0, 6], col: 2}, {t: 'box', s: [0.06, 0.18, 0.012], c: [-0.02, -0.03, 0.138], rot: [0, 0, -8], col: 2}])]},
  {id: 'belt-chain', slot: 'belt', name: 'Dây xích eo', color: '#b2bec3', color2: '#f1c40f', pieces: [P('main', 'Dây xích', 'hips', [
    {t: 'tor', R: 0.162, r: 0.006, rot: [90, 0, 0], c: [0, 0.07, 0], s: [1.08, 0.8, 1]}, {t: 'sph', r: 0.018, c: [0.11, 0.06, 0.12], col: 2}])]},
  // ---- Đuôi
  {id: 'tail-cat', slot: 'tail', name: 'Đuôi mèo', color: '#e17055', color2: '#ffeaa7', pieces: [P('main', 'Đuôi', 'hips', chain([0, -0.02, -0.11], [
    [[0, -0.4, -1], 0.16], [[0, 0, -1], 0.14], [[0, 0.7, -0.7], 0.14], [[0, 1, -0.2], 0.12]], 0.032, 0.022, 'tip'))]},
  {id: 'tail-fox', slot: 'tail', name: 'Đuôi cáo (xù)', color: '#e67e22', color2: '#ffffff', pieces: [P('main', 'Đuôi', 'hips', chain([0, -0.02, -0.11], [
    [[0, -0.2, -1], 0.17], [[0, -0.6, -0.8], 0.17], [[0, -1, -0.3], 0.15]], 0.05, 0.075, 'tip', 0.04))]},
  {id: 'tail-bunny', slot: 'tail', name: 'Đuôi thỏ', color: '#ffffff', color2: '#fab1a0', pieces: [P('main', 'Đuôi', 'hips', [
    {t: 'sph', r: 0.065, c: [0, 0.0, -0.15]}, {t: 'sph', r: 0.025, c: [0, 0.0, -0.205], col: 2}])]},
  {id: 'tail-devil', slot: 'tail', name: 'Đuôi quỷ', color: '#c0392b', color2: '#7f1d1d', pieces: [P('main', 'Đuôi', 'hips', [
    ...chain([0, -0.02, -0.11], [[[0, -0.6, -1], 0.16], [[0, -0.1, -1], 0.14], [[0, 0.8, -0.6], 0.14]], 0.02, 0.014),
    {t: 'cone', r: 0.04, h: 0.09, c: [0, 0.26, -0.36], rot: [-30, 0, 0], col: 2}])]},
  // ---- Mặt nạ
  {id: 'mask-domino', slot: 'mask', name: 'Mặt nạ che mắt', color: '#2d3436', color2: '#f1c40f', pieces: [P('main', 'Mặt nạ', 'head', [
    {t: 'sph', r: 0.1, s: [1.0, 0.3, 0.45], at: 'headTop', c: [0, -0.092, 0.062]}, {t: 'box', s: [0.004, 0.012, 0.15], at: 'headTop', c: [0.098, -0.092, 0.0], col: 2}, {t: 'box', s: [0.004, 0.012, 0.15], at: 'headTop', c: [-0.098, -0.092, 0.0], col: 2}])]},
  {id: 'mask-full', slot: 'mask', name: 'Mặt nạ che mặt', color: '#f5f6fa', color2: '#e84393', pieces: [P('main', 'Mặt nạ', 'head', [
    {t: 'sph', r: 0.105, s: [0.98, 1.1, 0.5], at: 'headTop', c: [0, -0.105, 0.068]}, {t: 'box', s: [0.05, 0.012, 0.01], at: 'headTop', c: [0.038, -0.095, 0.116], col: 2}, {t: 'box', s: [0.05, 0.012, 0.01], at: 'headTop', c: [-0.038, -0.095, 0.116], col: 2}])]},
  {id: 'mask-surgical', slot: 'mask', name: 'Khẩu trang', color: '#a8e6cf', color2: '#dfe6e9', pieces: [P('main', 'Khẩu trang', 'head', [
    {t: 'sph', r: 0.09, s: [1.0, 0.55, 0.55], at: 'headTop', c: [0, -0.155, 0.062]}, {t: 'box', s: [0.004, 0.008, 0.1], at: 'headTop', c: [0.088, -0.15, 0.0], col: 2}, {t: 'box', s: [0.004, 0.008, 0.1], at: 'headTop', c: [-0.088, -0.15, 0.0], col: 2}])]},
  {id: 'mask-half', slot: 'mask', name: 'Mặt nạ nửa trên', color: '#6c5ce7', color2: '#ffeaa7', pieces: [P('main', 'Mặt nạ', 'head', [
    {t: 'sph', r: 0.102, s: [1.0, 0.55, 0.5], at: 'headTop', c: [0, -0.085, 0.064]}, {t: 'cone', r: 0.012, h: 0.05, at: 'headTop', c: [0, -0.03, 0.115], rot: [90, 0, 0], col: 2}])]},
  // ---- Tóc (dựng sẵn)
  {id: 'hair-short', slot: 'hair', name: 'Tóc ngắn', color: '#3b2a20', color2: '#5d4037', pieces: [P('main', 'Tóc', 'head', [
    {t: 'sph', r: 0.108, s: [1, 0.95, 1.06], th: 0.5, at: 'headTop', c: [0, -0.075, -0.005]}, {t: 'box', s: [0.17, 0.03, 0.03], at: 'headTop', c: [0, -0.04, 0.095], col: 2}])]},
  {id: 'hair-long', slot: 'hair', name: 'Tóc dài', color: '#2d1f1a', color2: '#4e342e', pieces: [P('main', 'Tóc', 'head', [
    {t: 'sph', r: 0.108, s: [1, 0.95, 1.06], th: 0.5, at: 'headTop', c: [0, -0.075, -0.005]},
    {t: 'box', s: [0.215, 0.34, 0.07], at: 'headTop', c: [0, -0.23, -0.075]}, {t: 'box', s: [0.03, 0.26, 0.1], at: 'headTop', c: [0.1, -0.2, -0.03]}, {t: 'box', s: [0.03, 0.26, 0.1], at: 'headTop', c: [-0.1, -0.2, -0.03]}])]},
  {id: 'hair-bun', slot: 'hair', name: 'Tóc búi', color: '#6d4c41', color2: '#e84393', pieces: [P('main', 'Tóc', 'head', [
    {t: 'sph', r: 0.108, s: [1, 0.95, 1.06], th: 0.5, at: 'headTop', c: [0, -0.075, -0.005]}, {t: 'sph', r: 0.05, at: 'headTop', c: [0, 0.045, -0.035]}, {t: 'tor', R: 0.045, r: 0.008, rot: [90, 0, 0], at: 'headTop', c: [0, 0.012, -0.035], col: 2}])]},
  {id: 'hair-ponytail', slot: 'hair', name: 'Tóc đuôi ngựa', color: '#f9a825', color2: '#d63031', pieces: [P('main', 'Tóc', 'head', [
    {t: 'sph', r: 0.108, s: [1, 0.95, 1.06], th: 0.5, at: 'headTop', c: [0, -0.075, -0.005]},
    ...chain([0, -0.05, -0.1], [[[0, -0.2, -1], 0.1], [[0, -1, -0.3], 0.2]], 0.04, 0.03, null, 0, 'headTop'), {t: 'sph', r: 0.022, at: 'headTop', c: [0, -0.05, -0.1], col: 2}])]},
  // ---- Hoa tai
  {id: 'ear-stud', slot: 'ear', name: 'Hoa tai tròn', color: '#f1c40f', color2: '#dfe6e9', pieces: [P('main', 'Hoa tai', 'head', [
    {t: 'sph', r: 0.012, at: 'headTop', c: [0.083, -0.115, 0]}, {t: 'sph', r: 0.012, at: 'headTop', c: [-0.083, -0.115, 0]}])]},
  {id: 'ear-drop', slot: 'ear', name: 'Hoa tai thả', color: '#dfe6e9', color2: '#74b9ff', pieces: [P('main', 'Hoa tai', 'head', [
    {t: 'sph', r: 0.01, at: 'headTop', c: [0.083, -0.112, 0]}, {t: 'sph', r: 0.01, at: 'headTop', c: [-0.083, -0.112, 0]},
    {t: 'cyl', rt: 0.003, rb: 0.003, h: 0.05, at: 'headTop', c: [0.083, -0.14, 0]}, {t: 'cyl', rt: 0.003, rb: 0.003, h: 0.05, at: 'headTop', c: [-0.083, -0.14, 0]},
    {t: 'sph', r: 0.014, at: 'headTop', c: [0.083, -0.17, 0], col: 2}, {t: 'sph', r: 0.014, at: 'headTop', c: [-0.083, -0.17, 0], col: 2}])]}
];
export const presetById = id => PRESETS.find(p => p.id === id);

/* ============================================================
   Dựng hình khối
   ============================================================ */
const Y = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;

function anchorVec(rig, key, at) {
  if (!at) return new THREE.Vector3();
  const [k, t] = Array.isArray(at) ? at : [at, 1];
  const a = rig.pos(k), b = rig.pos(key);
  return a && b ? a.sub(b).multiplyScalar(t) : new THREE.Vector3();
}

function makePrim(p, rig, key, side, m1, m2) {
  let geo, quat = new THREE.Quaternion(), pos = new THREE.Vector3();
  switch (p.t) {
    case 'box': geo = new THREE.BoxGeometry(...p.s); break;
    case 'sph': geo = new THREE.SphereGeometry(p.r, 24, 16, 0, Math.PI * 2, 0, p.th ? Math.PI * p.th : Math.PI); if (p.s) geo.scale(...p.s); break;
    case 'cyl': geo = new THREE.CylinderGeometry(p.rt, p.rb, p.h, 28, 1, !!p.open); if (p.s) geo.scale(p.s[0], 1, p.s[2]); break;
    case 'cone': geo = new THREE.CylinderGeometry(0, p.r, p.h, 28); break;
    case 'tor': geo = new THREE.TorusGeometry(p.R, p.r, 12, 44); if (p.s) geo.scale(...p.s); break;
    case 'tube': {
      const a = rig.pos(key);
      let dir, len;
      if (p.to) { const b = rig.pos(p.to); if (!a || !b) return null; dir = b.sub(a); len = dir.length(); }
      else if (p.along) { const b = rig.pos(p.along); if (!a || !b) return null; dir = a.clone().sub(b); len = p.len; }
      else { dir = p.dir ? new THREE.Vector3(...p.dir) : new THREE.Vector3(0, -1, 0); len = p.len || 0.3; }
      if (len < 1e-5) return null;
      dir.normalize();
      const f = p.from ?? 0, u = p.upto ?? 1;
      geo = new THREE.CylinderGeometry(p.r1, p.r0, len * (u - f), 28, 1, !!p.open);
      if (p.sx || p.sz) geo.scale(p.sx ?? 1, 1, p.sz ?? 1);
      quat.setFromUnitVectors(Y, dir);
      pos.copy(dir).multiplyScalar(len * (f + u) / 2);
      break;
    }
    default: return null;
  }
  if (p.t !== 'tube' && p.rot) quat.setFromEuler(new THREE.Euler(p.rot[0] * D2R, p.rot[1] * D2R, p.rot[2] * D2R));
  const c = p.c ? [...p.c] : [0, 0, 0];
  if (side === 'r' && p.mx) c[0] = -c[0];
  pos.add(anchorVec(rig, key, p.at)).add(new THREE.Vector3(c[0], c[1], c[2]));
  const mesh = new THREE.Mesh(geo, p.col === 2 ? m2 : m1);
  mesh.position.copy(pos);
  mesh.quaternion.copy(quat);
  return mesh;
}

const mkMat = c => new THREE.MeshStandardMaterial({color: c, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide});

/** Dựng nội dung một mảnh (piece). Trả về {content, worldCenter, mats} hoặc null. */
export function buildPieceContent(group, piece, rig) {
  const preset = presetById(group.preset);
  const def = preset && preset.pieces.find(x => x.part === piece.part);
  if (!def) return null;
  const m1 = mkMat(group.color), m2 = mkMat(group.color2 || group.color);
  const tmp = new THREE.Group();
  for (const pr of def.prims) { const m = makePrim(pr, rig, def.bone, def.side, m1, m2); if (m) tmp.add(m); }
  if (!tmp.children.length) return null;
  const box = new THREE.Box3().setFromObject(tmp), center = box.getCenter(new THREE.Vector3());
  for (const m of tmp.children) m.position.sub(center);
  const defPos = rig.pos(def.bone) || new THREE.Vector3();
  return {content: tmp, worldCenter: defPos.add(center), mats: [m1, m2], defBone: def.bone};
}

/**
 * Gắn mảnh vào xương. Cây node:
 * xương → holder (căn theo trục thế giới ở rest pose) → centerNode (vị trí mặc định) → offsetNode (pos/rot/scale của người dùng) → nội dung
 */
/** Gắn đồ đã bind skin: không gắn vào xương nào, mesh tự chạy theo xương nhân vật. */
function mountSkinned(group, piece, rig, content, extra) {
  const tint = [];
  content.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const a = Array.isArray(o.material) ? o.material : [o.material];
    const nm = a.map(m => { if (!m.color || m._tintClone) return m; const c = m.clone(); c._base = m.color.clone(); c._tintClone = true; return c; });
    o.material = Array.isArray(o.material) ? nm : nm[0];
    nm.forEach(m => { if (m._tintClone) tint.push(m); });
  });
  const holder = new THREE.Group(); holder.name = 'holder_' + piece.uid;
  const center = new THREE.Group(), offset = new THREE.Group();
  holder.add(center); center.add(offset); offset.add(content);
  (rig.model || (rig.bones[0] && rig.bones[0].parent) || new THREE.Group()).add(holder);
  content.traverse(o => { if (o.isMesh) { o.userData.pieceUid = piece.uid; o.frustumCulled = false; } });
  piece._rt = {holder, center, offset, content, mats: [], tint, group, skinned: true, extra: extra || []};
  // Trước đây đồ skin không chỉnh được nên piece.scale lưu autoScale (0.01 với file tính bằng cm). Với đồ skin, scale là hệ số so với bản gốc: 1 = nguyên bản.
  const as = (piece._obj && piece._obj.userData && piece._obj.userData.autoScale) || 1;
  if (as !== 1 && Math.abs(piece.scale - as) < 1e-9) piece.scale = 1;
  applyPiece(group, piece);
  return piece._rt;
}
const _skE = new THREE.Euler(), _skQ = new THREE.Quaternion(), _skP = new THREE.Vector3(), _skS = new THREE.Vector3(), _skA = new THREE.Matrix4(), _skB = new THREE.Matrix4();
/** Các SkinnedMesh của đồ skin, bindMatrix gốc của từng mesh và tâm (pivot) hộp bao ở pose gốc. Tính một lần. */
function skinParts(rt) {
  if (rt.skinList) return rt.skinList;
  const list = [], box = new THREE.Box3();
  rt.content.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const d = o.userData._skin, base = d ? d.bind.clone() : o.bindMatrix.clone();
    const g = o.geometry;
    if (g) { if (!g.boundingBox) g.computeBoundingBox(); if (g.boundingBox && !g.boundingBox.isEmpty()) box.union(g.boundingBox.clone().applyMatrix4(base)); }
    list.push({mesh: o, base});
  });
  rt.skinList = list;
  rt.pivot = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return list;
}
/**
 * Dời/xoay/co giãn đồ skin: biến đổi đỉnh ở pose gốc TRƯỚC khi skin (bindMatrix' = T · bindMatrix) nên đồ vẫn chạy theo xương.
 * T = tịnh tiến(pivot + pos) · xoay · co giãn · tịnh tiến(−pivot): xoay/co giãn quanh tâm của đồ, pos tính theo trục thế giới ở pose gốc (như đồ gắn cứng).
 */
function applySkinOffset(rt, piece) {
  const list = skinParts(rt), pos = piece.pos || [0, 0, 0], rot = piece.rot || [0, 0, 0];
  const k = Number.isFinite(piece.scale) && piece.scale > 0 ? piece.scale : 1;
  const none = !pos[0] && !pos[1] && !pos[2] && !rot[0] && !rot[1] && !rot[2] && Math.abs(k - 1) < 1e-9;
  if (!none) {
    _skQ.setFromEuler(_skE.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R));
    _skP.set(pos[0], pos[1], pos[2]).add(rt.pivot);
    _skA.compose(_skP, _skQ, _skS.setScalar(k));
    _skA.multiply(_skB.makeTranslation(-rt.pivot.x, -rt.pivot.y, -rt.pivot.z));
  }
  for (const {mesh, base} of list) {
    if (mesh.bindMode !== 'attached') continue;   // chế độ detached dùng nghịch đảo bindMatrix nên không áp được kiểu này
    if (none) mesh.bindMatrix.copy(base); else mesh.bindMatrix.multiplyMatrices(_skA, base);
  }
}
const PAIR_ANCHOR_MAX = 0.5;   // mét: nửa tách ra cách xương xa hơn mức này thì coi như file không cùng hệ trục với nhân vật
/** Nửa trái/phải của piece.split, tính một lần cho mỗi _obj (nhớ trong piece._half). null nếu file không còn tách được. */
function halfOf(piece, rig) {
  if (piece._halfSrc !== piece._obj) { const sp = splitPair(piece._obj, rig); piece._half = sp ? sp[piece.split] : null; piece._halfSrc = piece._obj; }
  return piece._half;
}
/** Danh mục có đồ dạng cặp, kèm xương của chiếc trái / phải. */
export const PAIR_SLOTS = {shoes: ['lFoot', 'rFoot'], socks: ['lFoot', 'rFoot']};
/**
 * Thử tách đồ cặp thành 2 piece (trái/phải) gắn vào hai xương bàn chân. `fit` = kết quả fitImported; `label` ví dụ 'Giày'.
 * Trả về [pieceTrái, pieceMặt] (kèm .mode = 'gap'|'plane') hoặc null nếu không phải đồ cặp / nhân vật thiếu xương chân.
 */
export function pairPieces(slot, fit, rig, label, file) {
  const bones = PAIR_SLOTS[slot];
  if (!bones || !rig || !bones.every(b => rig.bone(b))) return null;
  const sp = splitPair(fit.obj, rig);
  if (!sp) return null;
  const out = ['l', 'r'].map((s, i) => {
    const p = {...newPiece('file', label + (s === 'l' ? ' trái' : ' phải'), bones[i]), file: {...file}, split: s, scale: fit.autoScale};
    p._obj = fit.obj; p._autoScale = fit.autoScale; p._half = sp[s]; p._halfSrc = fit.obj;
    return p;
  });
  out.mode = sp.mode;
  return out;
}
export function mountPiece(group, piece, rig, parent) {
  unmountPiece(piece);
  let built, bone = rig.bone(piece.bone);
  if (piece.file) {
    if (!piece._obj) return null;
    let obj = piece._obj, anchor = null;
    // Đồ cặp (giày, tất…) đã được tách trái/phải: mỗi piece chỉ dựng nửa của mình. Tính lại khi nạp từ file đã lưu (cùng thuật toán → cùng kết quả).
    const half = piece.split ? halfOf(piece, rig) : null;
    if (piece.split && !half) return null;   // file không còn tách được: bỏ qua thay vì gắn cả đôi vào một chân
    if (half) { obj = half.obj; anchor = half.anchor; }
    else {
      // Đồ có skin trùng tên xương với nhân vật (áo, quần, váy…) → bind vào xương nhân vật, biến dạng theo cơ thể
      const sk = bindSkinnedItem(obj, rig);
      if (sk) return mountSkinned(group, piece, rig, sk.content, sk.extra);
    }
    // nhân bản vật liệu để có thể pha màu (blend) mà không làm hỏng bản gốc
    const tint = [];
    obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      const nm = arr.map(m => { if (!m.color || m._tintClone) return m; const c = m.clone(); c._base = m.color.clone(); c._tintClone = true; return c; });
      o.material = Array.isArray(o.material) ? nm : nm[0];
      nm.forEach(m => { if (m._tintClone) tint.push(m); });
    });
    built = {content: obj, worldCenter: bone ? rig.rest.get(bone).pos.clone() : new THREE.Vector3(), mats: [], tint};
    // Nửa tách ra từ file xuất cùng hệ trục với nhân vật → giữ đúng chỗ gốc (gần xương); lệch xa thì căn tâm vào xương như đồ thường
    if (anchor && bone && anchor.distanceTo(built.worldCenter) < PAIR_ANCHOR_MAX) built.worldCenter = anchor.clone();
  } else {
    built = buildPieceContent(group, piece, rig);
    if (!built) return null;
  }
  if (!bone) return null;
  const info = rig.rest.get(bone);
  const holder = new THREE.Group();
  holder.name = 'holder_' + piece.uid;
  info.holder.decompose(holder.position, holder.quaternion, holder.scale);
  const center = new THREE.Group();
  center.position.copy(built.worldCenter).sub(info.pos);
  const offset = new THREE.Group();
  holder.add(center); center.add(offset); offset.add(built.content);
  bone.add(holder);
  built.content.traverse(o => { if (o.isMesh) { o.userData.pieceUid = piece.uid; o.frustumCulled = false; } });
  piece._rt = {holder, center, offset, content: built.content, mats: built.mats, tint: built.tint || [], group};
  applyPiece(group, piece);
  return piece._rt;
}
export function unmountPiece(piece) {
  const rt = piece._rt;
  if (!rt) return;
  rt.holder.removeFromParent();
  if (rt.extra) rt.extra.forEach(b => b.removeFromParent());   // xương riêng của đồ skin đang gắn dưới xương nhân vật
  if (!piece.file) rt.content.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  rt.mats.forEach(m => m.dispose());
  piece._rt = null;
}
export function applyPiece(group, piece) {
  const rt = piece._rt;
  if (!rt) return;
  if (rt.skinned) applySkinOffset(rt, piece);   // đồ skin: chỉnh trên pose gốc trước khi skin
  else {
    rt.offset.position.set(...piece.pos);
    rt.offset.rotation.set(piece.rot[0] * D2R, piece.rot[1] * D2R, piece.rot[2] * D2R);
    rt.offset.scale.setScalar(piece.scale);
  }
  rt.holder.visible = group.visible !== false && piece.visible !== false;
  if (rt.mats.length) { rt.mats[0].color.set(group.color); rt.mats[1].color.set(group.color2 || group.color); }
  if (rt.tint && rt.tint.length) { // đồ nhập/thư viện: pha màu với màu gốc của mô hình
    const t = new THREE.Color(group.color || '#ffffff'), b = Math.min(Math.max(group.blend || 0, 0), 1), mul = group.blendMode === 'multiply';
    for (const m of rt.tint) { m.color.copy(m._base); if (b > 0) m.color.lerp(mul ? m._base.clone().multiply(t) : t, b); }
  }
}
export function newPiece(part, label, bone) {
  return {uid: 'p' + Math.random().toString(36).slice(2, 9), part, label, bone, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, visible: true};
}
export function groupFromPreset(preset) {
  return {
    id: 'g' + Math.random().toString(36).slice(2, 9), slot: preset.slot, preset: preset.id, name: preset.name,
    color: preset.color, color2: preset.color2, visible: true,
    pieces: preset.pieces.map(d => newPiece(d.part, d.label, d.bone))
  };
}

/** Chuyển một object đã nạp (GLB/FBX/OBJ) về đơn vị mét hợp lý. */
export function fitImported(obj) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  const m = Math.max(size.x, size.y, size.z);
  const c = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  obj.position.sub(c);
  wrap.add(obj);
  wrap.userData.fitInner = obj; wrap.userData.fitCenter = c.clone();   // để đồ skin trả lại vị trí gốc (xem bindSkinnedItem)
  const autoScale = m > 3 ? 0.01 : 1;
  wrap.userData.autoScale = autoScale;   // để đồ cặp tách ra tính được vị trí gốc (mét)
  return {obj: wrap, autoScale};
}

/** Xuất JSON lưu trữ (bỏ trường runtime bắt đầu bằng _). */
export function serializeOutfit(groups) {
  return JSON.parse(JSON.stringify(groups, (k, v) => (k.startsWith('_') ? undefined : v)));
}
