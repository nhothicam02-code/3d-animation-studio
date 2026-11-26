import * as THREE from 'three';
import * as K from './character-kit.js';
import * as F from './face-kit.js';
import * as FRG from './face-regions.js';

/* ============================================================
   Chạy biểu cảm của nhân vật Custom bên ngoài trang Custom (dùng trong Studio / xuất video).

   Dữ liệu đọc từ characters/custom/<id>.json:
     expressions : danh sách biểu cảm đã lưu ở trang Custom
       • texture v2 : {v:2, layers:{skin|browL|browR|eyeL|eyeR|nose|mouth:{frames|set, fps, loop, show, scale, pos, rot}}}
       • texture v1 : {mode:'texture', parts:{mask|browL…:{set, fps}}}
       • keyshape   : {mode:'keyshape', duration, ease, loop, parts:{mask}, tracks:{<tên>:{keys:[{t,v}]}}}
     face        : {y, z, s}  vị trí mặt trên đầu (độ cao / ra trước / cỡ, tính theo chiều cao đầu)
     faceRegions : 6 vùng mặt (tâm + bán kính) → shape key được dựng lại lúc nạp, chỉ những key mà biểu cảm thực sự dùng (js/face-regions.js)

   Dùng: const fx = createFaceRuntime({model, wrap, rig, doc});   // null nếu nhân vật không có biểu cảm
         fx.apply(fx.get(id), tGiâyKểTừLúcBắtĐầu, độĐậm 0..1)    // mỗi khung hình
         fx.apply(null)                                           // tắt mặt
   ============================================================ */

const D2R = Math.PI / 180;
const FPS0 = F.DEFAULT_FPS || 12;

/** 7 lớp của biểu cảm texture v2 (giống trang Custom). */
export const V2_PARTS = [
  {id: 'skin', folder: 'mask'},
  {id: 'browL', folder: 'browL'}, {id: 'browR', folder: 'browR'},
  {id: 'eyeL', folder: 'eyeL'}, {id: 'eyeR', folder: 'eyeR'},
  {id: 'nose', folder: 'nose'}, {id: 'mouth', folder: 'mouth'}
];

/** Giá trị `expr` của item biểu cảm trong Studio: 'c:<id biểu cảm Custom>' hoặc tên mẫu có sẵn ('happy'…). */
export const isCx = v => typeof v === 'string' && v.startsWith('c:');
export const cxId = v => String(v).slice(2);

/* ---------------- Thư viện ảnh faces/ (cho biểu cảm chỉ lưu tên bộ ảnh) ---------------- */
let LIB = null, LIBP = null;
export const faceLib = () => LIBP || (LIBP = F.scanFaces().then(r => (LIB = r.lib)).catch(() => (LIB = F.emptyLib())));

/* ---------------- Texture từ đường dẫn ảnh (dùng chung, có cache) ---------------- */
const TEX = new Map();
export function texOf(path) {
  let e = TEX.get(path);
  if (e) return e;
  e = {tex: null, aspect: 1, failed: false, ready: null};
  TEX.set(path, e);
  const im = new Image();
  im.crossOrigin = 'anonymous';
  e.ready = new Promise(res => {
    im.onload = () => {
      const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      e.tex = t; e.aspect = (im.naturalWidth || 1) / (im.naturalHeight || 1); res(true);
    };
    K.setSrc(im, path, () => { e.failed = true; res(false); });   // tương đối → raw.githubusercontent → báo lỗi
  });
  return e;
}

/** Danh sách đường dẫn khung hình của một lớp v2: ưu tiên `frames` đã lưu, không có thì tra theo tên bộ ảnh `set`. */
export function framesOf(partId, L, lib = LIB) {
  if (L && L.frames && L.frames.length) return L.frames;
  const part = V2_PARTS.find(p => p.id === partId), sets = (lib && part && lib[part.folder]) || {};
  return (L && sets[L.set]) || [];
}
/* ---------------- Nhép miệng theo mức mở ----------------
   Bộ miệng nhép = thư mục faces/mouth/<tên>/ có các ảnh xếp từ KHÉP → MỞ TO theo số thứ tự (01 khép, 02 hé, 03 mở vừa, 04 mở to…).
   Số khung bất kỳ (≥2) đều được; mức mở 0..1 được chia đều cho các khung (dưới LIP_CLOSED coi là khép). */
export const LIP_SET = 'nhep';
const LIP_CLOSED = 0.1;
export function lipFrame(n, open) {
  if (n <= 1) return 0;
  const o = Math.max(0, Math.min(1, +open || 0));
  return o < LIP_CLOSED ? 0 : Math.min(n - 1, 1 + Math.floor((o - LIP_CLOSED) / ((1 - LIP_CLOSED) / (n - 1))));
}
/** Tên keyshape “mở miệng” thường gặp (ARKit / VRM / Blender tự đặt) — dùng khi biểu cảm là keyshape. */
export const LIP_MORPHS = ['jawOpen', 'mouthOpen', 'MouthOpen', 'viseme_aa', 'aa', 'A', 'Fcl_MTH_A', 'mouth_open'];

/** Chỉ số khung hình tại thời điểm t (giây kể từ lúc biểu cảm bắt đầu). */
export function frameIdx(L, n, t) {
  if (n <= 1) return 0;
  const k = Math.floor(Math.max(0, t) * (+L.fps || FPS0));
  return L.loop === false ? Math.min(n - 1, k) : k % n;
}
const waitImg = p => new Promise(res => {
  const e = F.faceImage(p); let n = 0;
  const tick = () => { if (e.ok || e.fail || ++n > 80) res(); else setTimeout(tick, 50); };
  tick();
});

/* ---------------- Biểu cảm texture v2: mỗi lớp là một tấm phẳng gắn vào xương đầu ---------------- */
function mountPlanes(head, wrap, fit) {
  wrap.updateMatrixWorld(true);
  const bw = head.matrixWorld.clone(), bp = new THREE.Vector3().setFromMatrixPosition(bw);
  let H = 0.24;   // chiều cao đầu: tới xương “HeadTop” nếu có, không thì ước lượng theo mô hình đã chuẩn hoá 1.8 m
  head.traverse(o => {
    if (o !== head && o.isBone && /top|end/i.test(o.name)) {
      const h = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y - bp.y;
      if (h > 0.1 && h < 0.5) H = h;
    }
  });
  // holder: gốc tại xương đầu, trục & tỉ lệ khớp thế giới lúc rest pose → 1 đơn vị = 1 mét, X ngang, Y lên, Z ra trước
  const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
  wrap.matrixWorld.decompose(wp, wq, ws);
  const desired = new THREE.Matrix4().compose(bp, wq, new THREE.Vector3(1, 1, 1));
  const local = bw.clone().invert().multiply(desired);
  const group = new THREE.Group(); group.name = 'holder_face';
  local.decompose(group.position, group.quaternion, group.scale);
  const anchor = new THREE.Group(); group.add(anchor); head.add(group);
  const meshes = V2_PARTS.map((p, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));
    m.renderOrder = 20 + i; m.visible = false; m.rotation.order = 'YXZ'; anchor.add(m); return m;
  });
  const o = {
    setFit(f) { anchor.position.set(0, (+f.y || 0) * H, (+f.z || 0) * H); anchor.scale.setScalar(Math.max(0.01, (+f.s || 0.9) * H)); },
    update(e, t, alpha, lip) {
      const layers = e && e.v === 2 ? e.layers : null;
      group.visible = !!layers;
      if (!layers) return;
      V2_PARTS.forEach((p, i) => {
        const m = meshes[i], L = layers[p.id];
        let fr = L && L.show !== false ? framesOf(p.id, L) : [], k = fr.length ? frameIdx(L, fr.length, t) : 0;
        if (lip && p.id === 'mouth' && fr.length) {      // đang nói: chọn khung theo mức mở của tiếng
          if (fr.length < 2) fr = (LIB && LIB.mouth && LIB.mouth[lip.set || LIP_SET]) || fr;   // miệng 1 khung → dùng bộ nhép mặc định
          k = lipFrame(fr.length, lip.open);
        }
        if (!fr.length) { m.visible = false; return; }
        const te = texOf(fr[k]);
        if (!te.tex) { if (te.failed) m.visible = false; return; }   // ảnh chưa tải xong: giữ khung cũ
        if (m.material.map !== te.tex) { m.material.map = te.tex; m.material.needsUpdate = true; }
        const sc = L.scale || 1, P = L.pos || {x: 0, y: 0, z: 0}, R = L.rot || {x: 0, y: 0, z: 0};
        m.scale.set(sc, sc / te.aspect, 1);
        m.position.set(P.x || 0, P.y || 0, P.z || 0);
        m.rotation.set((R.x || 0) * D2R, (R.y || 0) * D2R, (R.z || 0) * D2R);
        m.material.opacity = alpha; m.visible = true;
      });
    },
    dispose() { head.remove(group); for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); } }
  };
  o.setFit(fit);
  return o;
}

/* ---------------- Chớp mắt tự nhiên ----------------
   Nhịp không đều (khoảng 1–7 giây một lần, thỉnh thoảng chớp đúp), mỗi nhân vật một nhịp riêng.
   Chỉ phụ thuộc thời điểm trên timeline + seed, không dùng Math.random → xem trước và xuất video giống hệt nhau. */
const BLINK_SLOT = 4, BLINK_LEN = 0.23;
export const BLINK_MORPHS = ['eyeBlinkLeft', 'eyeBlinkRight', 'eyeBlink', 'Blink', 'blink'];
const rand = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 13), 0x297a2d39); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const ease = x => x * x * (3 - 2 * x);
/** Một lần chớp: nhắm nhanh (0.07 s), giữ rất ngắn (0.03 s), mở chậm hơn (0.13 s). */
const pulse = x => (x <= 0 || x >= BLINK_LEN) ? 0 : x < 0.07 ? ease(x / 0.07) : x < 0.1 ? 1 : ease((BLINK_LEN - x) / 0.13);
/** Mức nhắm mắt 0..1 tại giây t. seed = chuỗi riêng của nhân vật. */
export function autoBlink(t, seed = '') {
  let n = 5381; for (const ch of String(seed)) n = ((n << 5) + n + ch.charCodeAt(0)) | 0;
  const k = Math.floor(t / BLINK_SLOT), start = k * BLINK_SLOT + 0.3 + rand(n, k) * 2.9, x = t - start;
  return Math.max(pulse(x), rand(n ^ 0x51ed, k) < 0.15 ? pulse(x - 0.32) : 0);
}
/** Dữ liệu “Mặt tự nhiên” của trang Custom có sẵn nhịp chớp cố định 3 giây → bỏ, dùng chớp tự nhiên để không chớp chồng hai nhịp. */
const dropFixedBlink = e => (e.id !== 'du-lieu-vung-mat' || !e.tracks) ? e
  : {...e, tracks: Object.fromEntries(Object.entries(e.tracks).map(([n, tr]) => [n, n.startsWith('eyeBlink') ? {...tr, keys: [{t: 0, v: 0}]} : tr]))};

/* ---------------- Bộ chạy biểu cảm của một nhân vật ---------------- */
export function createFaceRuntime({model, wrap, rig, doc}) {
  const list = (Array.isArray(doc && doc.expressions) ? doc.expressions : [])
    .filter(Boolean).map(x => (x.v === 2 ? x : F.upgradeExpr(x))).filter(x => x && x.id).map(dropFixedBlink);
  if (!list.length) return null;
  const fit = {...F.FACE_FIT, ...((doc && doc.face) || {})}, byId = new Map(list.map(e => [e.id, e]));
  const isV2 = e => !!e && e.v === 2, isKs = e => !!e && !isV2(e) && F.exprMode(e) === 'keyshape';

  let head = null;
  try { head = rig.bone('head'); } catch (err) { /* thử cách khác */ }
  if (head && !head.isObject3D) head = head.bone || head.node || head.object || null;
  if (!head) model.traverse(o => { if (!head && o.isBone && /head/i.test(o.name) && !/top|end|nub/i.test(o.name)) head = o; });

  // chỉ nạp thư viện faces/ khi có biểu cảm không lưu sẵn đường dẫn ảnh
  const needLib = list.some(e => isV2(e)
    ? Object.values(e.layers || {}).some(L => L && !(L.frames && L.frames.length) && L.set)
    : !isKs(e) || !!(e.parts && e.parts.mask));
  if (needLib) faceLib();

  const planes = head && list.some(isV2) ? mountPlanes(head, wrap, fit) : null;
  let overlay = null;
  if (list.some(e => !isV2(e))) { try { overlay = F.mountFaceOverlay(rig, fit); } catch (err) { overlay = null; } }
  const SH = list.some(isKs) ? F.createShapeDriver() : null;
  if (SH) {
    // dựng shape key từ vùng mặt TRƯỚC khi quét keyshape của model; chỉ dựng đúng những key các biểu cảm dùng (nhẹ bộ nhớ GPU)
    if (doc && doc.faceRegions) { try { FRG.applyRegions(model, doc.faceRegions, list); } catch (err) { console.warn('Vùng mặt:', err); } }
    SH.setModel(model);
  }

  return {
    list,
    has: id => byId.has(id),
    get: id => byId.get(id) || null,
    setFit(f) { Object.assign(fit, f); if (planes) planes.setFit(fit); if (overlay) overlay.setFit(fit); },
    /** e = biểu cảm (hoặc null để tắt) · t = giây kể từ lúc biểu cảm bắt đầu · alpha 0..1 (vào/ra mượt, độ đậm)
     *  lip = null | {open: 0..1, set?: tên bộ miệng nhép} — mức mở miệng khi nhân vật đang nói. */
    apply(e, t = 0, alpha = 1, lip = null) {
      if (lip && !LIB) faceLib();      // cần danh sách bộ ảnh để tìm bộ nhép
      const v2 = isV2(e), ks = isKs(e), a = Math.max(0, Math.min(1, alpha));
      if (planes) planes.update(v2 ? e : null, t, a, lip);
      if (overlay) {
        overlay.update(e && !v2 ? e : null, LIB || F.emptyLib(), t);
        if (e && !v2) overlay.mesh.material.opacity = a;
      }
      if (SH) {
        if (ks) {
          const vals = F.shapeValues(e, t); for (const k in vals) vals[k] *= a;
          if (lip) { const mn = LIP_MORPHS.find(n => SH.has(n)); if (mn) vals[mn] = Math.max(vals[mn] || 0, Math.min(1, lip.open) * a); }
          SH.apply(vals);
        }
        else SH.release();
      }
    },
    /** Tải trước toàn bộ ảnh của một biểu cảm (gọi trước khi xuất video để không thiếu khung). */
    async preload(id) {
      const e = byId.get(id); if (!e) return;
      if (needLib) await faceLib();
      if (isV2(e)) {
        const ps = [];
        for (const [pid, L] of Object.entries(e.layers || {})) {
          if (!L || L.show === false) continue;
          for (const p of framesOf(pid, L)) ps.push(texOf(p).ready);
        }
        await Promise.all(ps);
      } else {
        const ps = [];
        for (const part of F.FACE_PARTS) {
          if (isKs(e) && part.id !== 'mask') continue;
          const cfg = e.parts && e.parts[part.id], fr = cfg && cfg.set && LIB && LIB[part.id] && LIB[part.id][cfg.set];
          if (fr) for (const p of fr) ps.push(waitImg(p));
        }
        await Promise.all(ps);
      }
    },
    dispose() {
      if (planes) planes.dispose();
      if (overlay) overlay.dispose();
      if (SH) SH.release();
    }
  };
}
