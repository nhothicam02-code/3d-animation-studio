import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

const CATEGORY_ALIASES = {
  face: "faces", nose: "noses", mouth: "mouths", outfit: "clothes",
  shoes: "footwear", accessory: "accessories"
};
const FALLBACK_PARTS = {
  faces: ["face"], hair: ["hair"], eyes: ["eye-white", "eye-iris"],
  eyebrows: ["eyebrows"], noses: ["nose"], mouths: ["mouth"],
  clothes: ["outfit"], footwear: ["shoes"], body: ["outfit"],
  arms: ["arms"], legs: ["legs"], accessories: []
};
const ANCHORS = {
  body: [0, 1, 0], faces: [0, 2.05, 0.02], hair: [0, 2.28, -0.02],
  eyes: [0, 2.05, 0.68], eyebrows: [0, 2.25, 0.68], noses: [0, 1.94, 0.72],
  mouths: [0, 1.78, 0.7], clothes: [0, 1, 0], accessories: [0, 2.15, 0],
  footwear: [0, 0.08, 0], arms: [0, 1, 0], legs: [0, 0.25, 0]
};

export class CharacterViewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#1b1d29");
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(4.2, 3.2, 7.2);
    this.camera.lookAt(0, 1.2, 0);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x656078, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 7, 5);
    light.castShadow = true;
    this.scene.add(light);
    this.grid = new THREE.GridHelper(10, 20, 0x55516b, 0x343342);
    this.grid.position.y = -0.02;
    this.scene.add(this.grid);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4, 64),
      new THREE.MeshStandardMaterial({ color: 0x252735, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.035;
    this.scene.add(floor);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.gltfLoader = new GLTFLoader();
    this.loadedAssets = new Map();
    this.fallbackVisibility = new Map();
    this.motion = "idle";
    this.dragging = false;
    this.dragMoved = false;
    this.parts = {};
    this.build();
    this.bind();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    this.resize();
    this.animate();
  }

  material(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  }

  part(name, geometry, material, position, scale = [1, 1, 1]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    this.root.add(mesh);
    (this.parts[name] ||= []).push(mesh);
    return mesh;
  }

  build() {
    const skin = this.material("#f5c9b7");
    const hair = this.material("#302b3d");
    const outfit = this.material("#ed9fbe");
    const white = this.material("#fff8f2");
    const iris = this.material("#8c6be8");
    const dark = this.material("#493b48");
    this.part("outfit", new THREE.SphereGeometry(0.62, 32, 24), outfit, [0, 0.95, 0], [0.78, 0.9, 0.55]);
    this.part("face", new THREE.SphereGeometry(0.67, 40, 32), skin, [0, 2.02, 0], [0.94, 1.02, 0.78]);
    this.part("hair", new THREE.SphereGeometry(0.7, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.65), hair, [0, 2.23, -0.02], [1.02, 1.05, 0.86]);
    for (const side of [-1, 1]) {
      this.part("eye-white", new THREE.SphereGeometry(0.095, 20, 16), white, [side * 0.25, 2.08, 0.67], [1, 1.15, 0.45]);
      this.part("eye-iris", new THREE.SphereGeometry(0.052, 16, 12), iris, [side * 0.25, 2.075, 0.714], [1, 1, 0.5]);
      const arm = this.part("arms", new THREE.CapsuleGeometry(0.13, 0.62, 4, 10), skin, [side * 0.68, 0.98, 0]);
      arm.rotation.z = side * -0.45;
      this.part("legs", new THREE.CapsuleGeometry(0.15, 0.55, 4, 10), skin, [side * 0.25, 0.25, 0]);
      this.part("shoes", new THREE.SphereGeometry(0.19, 20, 16), dark, [side * 0.25, -0.05, 0.09], [1.2, 0.65, 1.5]);
    }
    this.part("mouth", new THREE.TorusGeometry(0.105, 0.025, 8, 20, Math.PI), dark, [0, 1.78, 0.68], [1, 0.8, 1]);
    this.part("nose", new THREE.SphereGeometry(0.045, 12, 10), skin, [0, 1.93, 0.72], [1, 0.7, 0.55]);
    for (const side of [-1, 1]) {
      this.part("eyebrows", new THREE.BoxGeometry(0.22, 0.035, 0.035), hair, [side * 0.25, 2.24, 0.68]);
    }
  }

  canonicalCategory(category) {
    return CATEGORY_ALIASES[category] || category || "body";
  }

  disposeObject(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach((material) => material.dispose());
    });
  }

  async loadGLB(asset) {
    if (!asset || typeof asset.path !== "string" || !asset.path.trim()) {
      throw new Error("Asset cần có đường dẫn GLB hợp lệ.");
    }
    const category = this.canonicalCategory(asset.category);
    const url = new URL(asset.path, document.baseURI).href;
    const gltf = await this.gltfLoader.loadAsync(url);
    const group = new THREE.Group();
    group.name = "asset_" + category;
    group.add(gltf.scene);

    const bounds = new THREE.Box3().setFromObject(group);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      this.disposeObject(group);
      throw new Error("Mô hình GLB không có kích thước hợp lệ.");
    }

    const target = category === "body" ? 2.1
      : category === "hair" || category === "faces" ? 1.25
      : category === "footwear" ? 0.45 : 0.7;
    group.scale.setScalar(target / maxDimension);
    group.position.copy(center).multiplyScalar(-group.scale.x);
    group.position.add(new THREE.Vector3(...(ANCHORS[category] || [0, 1, 0])));
    group.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.assetCategory = category;
      }
    });

    const old = this.loadedAssets.get(category);
    if (old) {
      this.root.remove(old);
      this.disposeObject(old);
    }
    this.root.add(group);
    this.loadedAssets.set(category, group);

    for (const partName of FALLBACK_PARTS[category] || []) {
      for (const fallback of this.parts[partName] || []) fallback.visible = false;
    }
    this.onSelect?.(category);
    return group;
  }

  updateColors(colors) {
    if (!colors) return;
    for (const mesh of this.parts.hair || []) mesh.material.color.set(colors.hair || "#302b3d");
    for (const mesh of this.parts["eye-iris"] || []) mesh.material.color.set(colors.eyes || "#8c6be8");
    for (const mesh of this.parts.outfit || []) mesh.material.color.set(colors.outfit || "#ed9fbe");
  }

  bind() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.dragMoved = false;
      this.prev = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.prev.x;
      const dy = event.clientY - this.prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
      this.root.rotation.y += dx * 0.009;
      this.prev = { x: event.clientX, y: event.clientY };
    });
    const finishPointer = (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.dragMoved || event.type === "pointercancel") return;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.root.children, true);
      if (hits.length) {
        let selected = hits[0].object;
        while (selected.parent && selected.parent !== this.root && !selected.userData.assetCategory) selected = selected.parent;
        this.onSelect?.(selected.userData.assetCategory || selected.name);
      }
    };
    this.canvas.addEventListener("pointerup", finishPointer);
    this.canvas.addEventListener("pointercancel", finishPointer);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.camera.position.multiplyScalar(event.deltaY > 0 ? 1.07 : 0.93).clampLength(3.5, 15);
    }, { passive: false });
  }

  resize() {
    const width = this.canvas.clientWidth || 640;
    const height = this.canvas.clientHeight || 480;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  resetCamera() {
    this.camera.position.set(4.2, 3.2, 7.2);
    this.camera.lookAt(0, 1.2, 0);
    this.root.rotation.y = 0;
  }

  setMotion(motion) {
    this.motion = ["idle", "bounce", "wave"].includes(motion) ? motion : "idle";
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const time = this.clock.getElapsedTime();
    this.root.position.y = this.motion === "bounce" ? Math.abs(Math.sin(time * 4)) * 0.22
      : this.motion === "idle" ? Math.sin(time * 1.7) * 0.025 : 0;
    this.root.rotation.z = this.motion === "idle" ? Math.sin(time * 1.2) * 0.018 : 0;
    const arms = this.parts.arms || [];
    arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      arm.rotation.z = this.motion === "wave" && side === 1
        ? -0.45 + Math.sin(time * 7) * 0.45
        : side * -0.45;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
