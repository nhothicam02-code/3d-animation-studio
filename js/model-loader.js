import * as THREE from 'three';

/* ============================================================
   Nạp model 3D dùng chung cho mọi trang.
   - Nhân vật (cần xương để gắn đồ / retarget animation): fbx, glb, gltf, vrm, dae
   - Item (mũ, tóc, trang phục, bối cảnh…): glb, gltf, fbx, obj, dae, stl, ply, vrm
   - Clip animation: fbx, glb, gltf, dae
   ============================================================ */
export const CHAR_EXTS = ['fbx', 'glb', 'gltf', 'vrm', 'dae'];
export const ITEM_EXTS = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'stl', 'ply', 'vrm'];
export const CLIP_EXTS = ['fbx', 'glb', 'gltf', 'dae'];

export const extOf = n => { const m = /\.([a-z0-9]+)$/i.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; };
export const stripExt = n => String(n || '').replace(/\.[a-z0-9]+$/i, '');
export const extRegex = list => new RegExp('\\.(' + list.join('|') + ')$', 'i');
export const acceptOf = list => list.map(e => '.' + e).join(',');
export const listText = (list, sep = ', ') => list.map(e => '.' + e).join(sep);
export const isCharFile = n => CHAR_EXTS.includes(extOf(n));
export const isItemFile = n => ITEM_EXTS.includes(extOf(n));
export const isClipFile = n => CLIP_EXTS.includes(extOf(n));
export const badgeOf = n => (extOf(n) || 'model').toUpperCase();

const LOADERS = {
  fbx: () => import('three/addons/loaders/FBXLoader.js').then(m => m.FBXLoader),
  gltf: () => import('three/addons/loaders/GLTFLoader.js').then(m => m.GLTFLoader),
  obj: () => import('three/addons/loaders/OBJLoader.js').then(m => m.OBJLoader),
  dae: () => import('three/addons/loaders/ColladaLoader.js').then(m => m.ColladaLoader),
  stl: () => import('three/addons/loaders/STLLoader.js').then(m => m.STLLoader),
  ply: () => import('three/addons/loaders/PLYLoader.js').then(m => m.PLYLoader)
};
const dec = buf => typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
const solid = geo => {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const vc = !!geo.attributes.color;
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: vc ? 0xffffff : 0xcfd2dc, vertexColors: vc, roughness: .6, metalness: .1, side: THREE.DoubleSide}));
};

/** Parse buffer → Object3D (kèm `.animations` nếu file có clip). `base` = thư mục chứa file (để tìm texture ngoài). */
export async function parseModel(ext, buf, base = '') {
  ext = String(ext || '').toLowerCase().replace(/^\./, '');
  switch (ext) {
    case 'glb': case 'vrm': case 'gltf': {
      const G = await LOADERS.gltf();
      let g;
      try { g = await new Promise((res, rej) => new G().parse(ext === 'gltf' ? dec(buf) : buf, base, res, rej)); }
      catch (e) {
        if (ext === 'gltf') throw Error('.gltf này tham chiếu file .bin/ảnh bên ngoài nên không đọc được khi chỉ chọn 1 file — hãy xuất lại dạng .glb (hoặc .gltf “embedded”). Chi tiết: ' + (e.message || e));
        throw e;
      }
      const o = g.scene || (g.scenes && g.scenes[0]);
      if (!o) throw Error('File glTF/GLB không có scene nào.');
      o.animations = g.animations || [];
      return o;
    }
    case 'fbx': { const F = await LOADERS.fbx(); return new F().parse(buf, base); }
    case 'obj': { const O = await LOADERS.obj(); return new O().parse(dec(buf)); }
    case 'dae': {
      const C = await LOADERS.dae(), c = new C().parse(dec(buf), base), o = c.scene;
      if (!o) throw Error('File Collada (.dae) không có scene.');
      o.animations = c.animations || [];
      return o;
    }
    case 'stl': { const S = await LOADERS.stl(); const o = new THREE.Group(); o.add(solid(new S().parse(buf))); return o; }
    case 'ply': { const P = await LOADERS.ply(); const o = new THREE.Group(); o.add(solid(new P().parse(buf))); return o; }
    default: throw Error('Định dạng .' + ext + ' chưa được hỗ trợ (dùng ' + listText(ITEM_EXTS, ' ') + ').');
  }
}
export const parseFile = async file => parseModel(extOf(file.name), await file.arrayBuffer());

/** Tải model từ URL; `name` (mặc định = url) quyết định định dạng. */
export async function loadModelUrl(url, name) {
  const ext = extOf(name || url.split('?')[0]);
  const r = await fetch(url);
  if (!r.ok) throw Error('Không tải được ' + (name || url) + ' (HTTP ' + r.status + ')');
  return parseModel(ext, await r.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
}
