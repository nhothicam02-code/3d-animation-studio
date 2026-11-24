import * as THREE from 'three';

/* ============================================================
   Gói nhân vật (character pack)
   ------------------------------------------------------------
   Upload 1 model gốc (glb/gltf/vrm/fbx/dae) → tách theo từng mesh:
     characters/<Tên>.character.json        ← xương + danh sách mesh (file này là "nhân vật")
     characters/<Tên>/<mesh>.glb            ← mỗi mesh 1 file (geometry, skin weight, shape key, material, texture)
     characters/<Tên>/animations.json       ← clip animation có sẵn trong model (nếu có)
   Mọi trang gọi nhân vật bằng tên "<Tên>.character.json"; loadPack() đọc json, dựng lại
   bộ xương, nạp từng mesh rồi gắn (bind) vào đúng xương theo TÊN XƯƠNG.
   ============================================================ */
export const PACK_FORMAT = '3DiS-CharacterPack-1.0';
export const PACK_RE = /\.character\.json$/i;
export const isPackName = n => PACK_RE.test(String(n || ''));
export const packBaseName = n => String(n || '').replace(PACK_RE, '');

const clean = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
export const packSlug = s => clean(s).slice(0, 60) || 'character';
const sanitize = n => THREE.PropertyBinding.sanitizeNodeName(n || '');   // GLTFLoader đổi tên node khi nạp lại → lưu sẵn tên đã chuẩn hoá
const arr = a => Array.from(a, v => +v.toFixed(6));

/* ---------------- Tách ---------------- */
async function loadGLTFExporter() { return (await import('three/addons/exporters/GLTFExporter.js')).GLTFExporter; }
const exportGLB = (Exp, input, opts) => new Promise((res, rej) => new Exp().parse(input, res, rej, {binary: true, onlyVisible: true, ...opts}));

/** Danh sách mesh "lá" của model (mỗi mesh = 1 phần cơ thể). */
function collectMeshes(model) {
  const out = [];
  model.traverse(o => { if (o.isMesh || o.isSkinnedMesh) out.push(o); });
  return out;
}

/**
 * Tách `model` (Object3D đã nạp) thành gói nhân vật.
 * @returns {{manifest:Object, files:{path:string, bytes:Uint8Array}[], folder:string, name:string}}
 *   `path` là đường dẫn tương đối so với thư mục characters/.
 */
export async function splitCharacter(model, {name, source = '', maxTexture = 2048, onProgress} = {}) {
  const Exp = await loadGLTFExporter();
  const nm = packSlug(name || packBaseName(source) || 'character'), folder = nm;
  model.updateMatrixWorld(true);

  // 1) xương
  const boneList = [];
  model.traverse(o => { if (o.isBone) boneList.push(o); });
  const idx = new Map(boneList.map((b, i) => [b, i]));
  const bones = boneList.map(b => ({
    name: sanitize(b.name), parent: b.parent && idx.has(b.parent) ? idx.get(b.parent) : -1,
    pos: arr(b.position.toArray()), quat: arr(b.quaternion.toArray()), scale: arr(b.scale.toArray())
  }));
  const top = boneList.find(b => !idx.has(b.parent));
  const armatureMatrix = top && top.parent ? arr(top.parent.matrixWorld.toArray()) : arr(new THREE.Matrix4().toArray());

  // 2) mesh
  const meshes = collectMeshes(model);
  if (!meshes.length) throw Error('Model không có mesh nào để tách.');
  const used = new Set(), parts = [], files = [];
  const saved = meshes.map(m => m.visible);
  try {
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      let base = packSlug(m.name || 'mesh' + (i + 1)) || 'mesh' + (i + 1), n = base, k = 2;
      while (used.has(n.toLowerCase())) n = base + '_' + k++;
      used.add(n.toLowerCase());
      onProgress && onProgress('Đang tách mesh ' + (i + 1) + '/' + meshes.length + ': ' + n);
      // chỉ giữ mesh này hiển thị → exporter (onlyVisible) bỏ qua các mesh còn lại, vẫn giữ nguyên xương + transform
      meshes.forEach((o, j) => { o.visible = j === i; });
      const buf = await exportGLB(Exp, model, {maxTextureSize: maxTexture});
      files.push({path: folder + '/' + n + '.glb', bytes: new Uint8Array(buf)});
      // vị trí mesh: gắn vào xương cha (mesh cứng như mắt/răng) hoặc đặt theo toạ độ thế giới (mesh skin)
      let pb = null; for (let p = m.parent; p; p = p.parent) if (p.isBone) { pb = p; break; }
      const rigid = !m.isSkinnedMesh && pb;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean).map(x => x.name || '');
      parts.push({
        name: n, label: m.name || n, file: n + '.glb', skinned: !!m.isSkinnedMesh,
        ...(rigid ? {parentBone: sanitize(pb.name), matrix: arr(m.matrix.toArray())} : {matrix: arr(m.matrixWorld.toArray())}),
        morphTargets: m.morphTargetDictionary ? Object.keys(m.morphTargetDictionary) : [],
        materials: mats, triangles: Math.round((m.geometry.index ? m.geometry.index.count : (m.geometry.attributes.position?.count || 0)) / 3),
        size: buf.byteLength, visible: true
      });
    }
  } finally { meshes.forEach((o, j) => { o.visible = saved[j]; }); }

  // 3) animation có sẵn trong model
  let animations = null;
  if (model.animations && model.animations.length) {
    const json = model.animations.map(c => THREE.AnimationClip.toJSON(c));
    files.push({path: folder + '/animations.json', bytes: new TextEncoder().encode(JSON.stringify(json))});
    animations = 'animations.json';
  }

  const manifest = {
    format: PACK_FORMAT, name: nm, source, folder, createdAt: new Date().toISOString(),
    armatureMatrix, bones, meshes: parts, animations
  };
  return {manifest, files, folder, name: nm};
}

/* ---------------- Ghép ---------------- */
const lcache = {};
const GL = () => lcache.g || (lcache.g = import('three/addons/loaders/GLTFLoader.js').then(m => m.GLTFLoader));

function repoRawBase() {
  let repo = 'nhothicam02-code/3d-animation-studio';
  try { repo = localStorage.getItem('3dis.github.repo') || repo; } catch (e) { /* bỏ qua */ }
  return 'https://raw.githubusercontent.com/' + repo + '/main/characters/';
}
async function fetchFirst(rel, bases, as) {
  let last;
  for (const b of bases) {
    try {
      const r = await fetch(b + rel.split('/').map(encodeURIComponent).join('/') + (b.startsWith('http') ? '' : '?v=' + Date.now()), {cache: 'no-store'});
      if (r.ok) return as === 'json' ? r.json() : r.arrayBuffer();
      last = Error('HTTP ' + r.status);
    } catch (e) { last = e; }
  }
  throw Error('Không tải được ' + rel + (last ? ' (' + last.message + ')' : ''));
}

/** Dựng bộ xương từ json: trả về {root, arm, bones, byName}. */
export function buildSkeleton(manifest) {
  const root = new THREE.Group(); root.name = packBaseName(manifest.name) || 'character';
  const arm = new THREE.Group(); arm.name = 'Armature';
  new THREE.Matrix4().fromArray(manifest.armatureMatrix || new THREE.Matrix4().toArray()).decompose(arm.position, arm.quaternion, arm.scale);
  root.add(arm);
  const bones = manifest.bones.map(b => {
    const o = new THREE.Bone(); o.name = b.name;
    o.position.fromArray(b.pos); o.quaternion.fromArray(b.quat); o.scale.fromArray(b.scale);
    return o;
  });
  manifest.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent] : arm).add(bones[i]));
  const byName = new Map(); bones.forEach(b => { if (!byName.has(b.name)) byName.set(b.name, b); });
  return {root, arm, bones, byName};
}

/** Nạp 1 file mesh .glb: trả về mọi mesh (mesh nhiều material sẽ thành nhiều primitive) trong file. */
async function readPart(buf, part) {
  const G = await GL();
  const gltf = await new Promise((res, rej) => new G().parse(buf, '', res, rej));
  const sc = gltf.scene; sc.updateMatrixWorld(true);
  const out = []; sc.traverse(o => { if (o.isMesh || o.isSkinnedMesh) out.push(o); });
  if (!out.length) throw Error('Không thấy mesh trong ' + part.file);
  return out;
}

/**
 * Dựng nhân vật từ json. Trả về Object3D giống kết quả parseModel của file model thường
 * (có .animations, có xương, SkinnedMesh bind sẵn).
 * `bases`: danh sách thư mục characters/ để thử (tương đối trước, GitHub raw sau).
 */
export async function loadPack(manifest, bases = []) {
  if (!manifest || manifest.format !== PACK_FORMAT) throw Error('File json không phải gói nhân vật (' + PACK_FORMAT + ').');
  const list = [...new Set([...bases.filter(Boolean), './characters/', repoRawBase()])];
  const sk = buildSkeleton(manifest);
  const dir = manifest.folder + '/';
  const bufs = await Promise.all(manifest.meshes.map(p => fetchFirst(dir + p.file, list, 'buf')));
  for (let i = 0; i < manifest.meshes.length; i++) {
    const part = manifest.meshes[i], found = await readPart(bufs[i], part);
    for (let k = 0; k < found.length; k++) {
      const mesh = found[k];
      mesh.name = (part.label || part.name) + (found.length > 1 ? '_' + (k + 1) : '');
      mesh.userData.packPart = part.name;
      mesh.removeFromParent();
      mesh.matrix.fromArray(part.matrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
      if (mesh.isSkinnedMesh) {
        const s = mesh.skeleton, bindM = mesh.bindMatrix.clone();
        // map xương của file con → xương của bộ xương chung theo TÊN
        const mapped = s.bones.map(b => sk.byName.get(b.name) || sk.byName.get(sanitize(b.name)));
        const miss = mapped.findIndex(b => !b);
        if (miss >= 0) throw Error('Mesh “' + part.name + '” dùng xương “' + s.bones[miss].name + '” không có trong json.');
        sk.root.add(mesh);
        mesh.updateMatrixWorld(true);
        mesh.bind(new THREE.Skeleton(mapped, s.boneInverses.map(m => m.clone())), bindM);
        mesh.frustumCulled = false;
      } else {
        (part.parentBone && sk.byName.get(part.parentBone) || sk.root).add(mesh);
      }
      mesh.visible = part.visible !== false;
    }
  }
  sk.root.animations = [];
  if (manifest.animations) {
    try { sk.root.animations = (await fetchFirst(dir + manifest.animations, list, 'json')).map(j => THREE.AnimationClip.parse(j)); }
    catch (e) { console.warn('Không đọc được animations của gói nhân vật:', e); }
  }
  sk.root.updateMatrixWorld(true);
  sk.root.userData.pack = {name: manifest.name, meshes: manifest.meshes.map(m => m.name)};
  return sk.root;
}

/** Dùng từ model-loader: buf = nội dung file .character.json, base = thư mục chứa nó. */
export async function loadPackFromBuffer(buf, base = '') {
  const text = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
  return loadPack(JSON.parse(text), [base]);
}

/* ---------------- Đồ có skin (áo, quần, váy…) bám theo xương nhân vật ---------------- */
const normName = s => String(s || '').toLowerCase().replace(/^.*:/, '').replace(/^mixamorig/, '').replace(/[^a-z0-9]/g, '');

/**
 * Nếu `obj` chứa SkinnedMesh có xương trùng (theo TÊN) với bộ xương nhân vật (`rig.bones`) thì bind lại
 * chúng vào xương nhân vật → đồ (áo, quần, váy…) biến dạng theo cơ thể. Làm tại chỗ, gọi lại nhiều lần được
 * (khi đổi nhân vật gốc). Trả về {content, matched, total}, hoặc null nếu không phải đồ skin phù hợp
 * (khi đó không sửa gì, đồ sẽ được gắn cứng vào 1 xương như trước).
 */
export function bindSkinnedItem(obj, rig) {
  const meshes = []; obj.updateMatrixWorld(true);
  obj.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) return null;
  const exact = new Map(), canon = new Map();
  for (const b of rig.bones) { if (!exact.has(b.name)) exact.set(b.name, b); const k = normName(b.name); if (k && !canon.has(k)) canon.set(k, b); }
  const find = n => exact.get(n) || exact.get(sanitize(n)) || canon.get(normName(n));
  const hips = rig.bone ? rig.bone('hips') : null;
  const namesOf = m => (m.userData._skin ? m.userData._skin.names : m.skeleton.bones.map(b => b.name));
  let matched = 0, total = 0;
  for (const m of meshes) for (const n of namesOf(m)) { total++; if (find(n)) matched++; }
  if (!total || matched / total < 0.5) return null;
  // lưu dữ liệu skin gốc một lần (để bind lại được sau này)
  for (const m of meshes) if (!m.userData._skin) {
    const bs = m.skeleton.bones;
    m.userData._skin = {bones: bs.slice(), local: bs.map(b => ({p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone()})), names: bs.map(b => b.name), inv: m.skeleton.boneInverses.map(x => x.clone()), bind: m.bindMatrix.clone(), parents: bs.map(b => (b.parent && b.parent.isBone ? bs.indexOf(b.parent) : -1))};
  }
  // fitImported đã dời đồ về tâm hộp bao → trả lại vị trí gốc để mesh thường đi kèm (nút, khoá…) không bị lệch
  const inner = obj.userData && obj.userData.fitInner;
  if (inner && !obj.userData.fitUndone) { inner.position.add(obj.userData.fitCenter); obj.userData.fitUndone = true; }
  const extra = [];
  for (const m of meshes) {
    const d = m.userData._skin, map = d.names.map(n => find(n) || null);
    // xương riêng của item mà nhân vật không có (vạt áo, dây, tóc…): giữ lại, gắn dưới xương cha đã map → chạy theo xương cha
    const resolve = i => {
      if (map[i]) return map[i];
      const b = d.bones[i], pi = d.parents[i], par = pi >= 0 ? resolve(pi) : (hips || rig.bones[0]), l = d.local[i];
      b.position.copy(l.p); b.quaternion.copy(l.q); b.scale.copy(l.s);
      par.add(b); extra.push(b); map[i] = b; return b;
    };
    d.names.forEach((n, i) => resolve(i));
    m.bind(new THREE.Skeleton(map, d.inv.map(x => x.clone())), d.bind.clone());
    m.frustumCulled = false;
  }
  // bỏ bộ xương riêng của file đồ (đã bind sang xương nhân vật) để animation không bắt nhầm xương trùng tên
  const roots = []; obj.traverse(o => { if (o.isBone && !(o.parent && o.parent.isBone)) roots.push(o); });
  for (const b of roots) { let hasMesh = false; b.traverse(o => { if (o.isMesh) hasMesh = true; }); if (!hasMesh) b.removeFromParent(); }
  return {content: obj, matched, total, extra};
}
