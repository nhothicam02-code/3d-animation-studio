import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export class StudioScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x191c25);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(5, 3.5, 7);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 1, 0);
    this.grid = new THREE.GridHelper(20, 20, 0x55516d, 0x343744);
    this.scene.add(this.grid);
    this.ambient = new THREE.HemisphereLight(0xffffff, 0x55516f, 1.2);
    this.scene.add(this.ambient);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLight.position.set(5, 9, 6);
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.DirectionalLight(0xa7a0ff, 0.7);
    this.fillLight.position.set(-5, 3, -4);
    this.scene.add(this.fillLight);
    this.models = [];
    this.mixers = [];
    this.clock = new THREE.Clock();
    this.loaderGLTF = new GLTFLoader();
    this.loaderFBX = new FBXLoader();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }
  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
  render() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.mixers.forEach(m => m.update(delta));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  async loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const url = URL.createObjectURL(file);
    try {
      let object, animations = [];
      if (ext === 'glb' || ext === 'gltf') {
        const gltf = await this.loaderGLTF.loadAsync(url);
        object = gltf.scene;
        animations = gltf.animations || [];
      } else if (ext === 'fbx') {
        object = await this.loaderFBX.loadAsync(url);
        animations = object.animations || [];
      } else throw new Error('Unsupported file type');
      object.name = file.name.replace(/\.[^.]+$/, '');
      object.userData.studioFile = file.name;
      object.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material) {
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach(m => { if (m.map) m.map.colorSpace = THREE.SRGBColorSpace; });
          }
        }
      });
      this.scene.add(object);
      this.models.push(object);
      if (animations.length) {
        const mixer = new THREE.AnimationMixer(object);
        this.mixers.push(mixer);
        object.userData.mixer = mixer;
        object.userData.clips = animations;
      }
      this.frameObject(object);
      return { object, animations };
    } finally { URL.revokeObjectURL(url); }
  }
  addPrimitive() {
    const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const material = new THREE.MeshStandardMaterial({ color: 0x9b83e8, roughness: 0.45, metalness: 0.12 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Cube';
    mesh.position.y = 0.75;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.models.push(mesh);
    return mesh;
  }
  frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(maxDim * 1.45, maxDim * 0.9, maxDim * 1.8));
    this.camera.near = Math.max(0.01, maxDim / 1000);
    this.camera.far = Math.max(2000, maxDim * 100);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  setView(view) {
    const target = this.controls.target.clone();
    const distance = this.camera.position.distanceTo(target) || 8;
    const directions = { front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), top: new THREE.Vector3(0, 1, 0) };
    this.camera.position.copy(target).add(directions[view].multiplyScalar(distance));
    if (view === 'top') this.camera.up.set(0, 0, -1); else this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.controls.update();
  }
  setEnvironment(file) {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, texture => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = texture;
        this.scene.environment = texture;
        URL.revokeObjectURL(url);
        resolve();
      }, undefined, error => { URL.revokeObjectURL(url); reject(error); });
    });
  }
  remove(object) {
    this.scene.remove(object);
    this.models = this.models.filter(item => item !== object);
    if (object.userData.mixer) this.mixers = this.mixers.filter(m => m !== object.userData.mixer);
    object.traverse?.(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m.dispose());
    });
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}