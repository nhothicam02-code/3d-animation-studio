import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

export async function createGLBThumbnail(file) {
  const loader = new GLTFLoader();
  const buffer = await file.arrayBuffer();
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, "", resolve, reject));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#242333");
  const model = gltf.scene;
  scene.add(model);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxSize) || maxSize <= 0) throw new Error("GLB không có kích thước hợp lệ để tạo thumbnail.");
  model.position.sub(center);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
  camera.position.set(maxSize * 2.2, maxSize * 1.45, maxSize * 2.8);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777188, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(maxSize * 3, maxSize * 5, maxSize * 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8baff, 1.1);
  fill.position.set(-maxSize * 3, maxSize * 2, -maxSize * 2);
  scene.add(fill);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(384, 384);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor("#242333", 1);
  renderer.render(scene, camera);
  const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/webp", 0.88));
  renderer.dispose();
  if (!blob) throw new Error("Trình duyệt không tạo được ảnh thumbnail WebP.");
  return blob;
}
