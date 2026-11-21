const STORAGE_KEY = "character-studio.profiles.v1";
const VERSION = 1;
const clone = (value) => typeof structuredClone === "function"
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));
const makeId = () => "char_" + (
  globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12)
  ?? Math.random().toString(36).slice(2, 14)
);

export function createCharacter(name = "Nhân vật mới") {
  const now = new Date().toISOString();
  return {
    schemaVersion: VERSION,
    id: makeId(),
    name,
    description: "",
    parts: {
      face: "face_basic_01", eyes: "eyes_round_01", eyebrows: "brows_soft_01",
      nose: "nose_small_01", mouth: "mouth_smile_01", hair: "hair_bob_01",
      body: "body_chibi_01", arms: "arms_basic_01", legs: "legs_basic_01",
      outfit: "outfit_simple_01", shoes: "shoes_basic_01", accessory: "none"
    },
    colors: { hair: "#302b3d", eyes: "#8c6be8", outfit: "#ed9fbe" },
    rigProfile: "chibi_humanoid_v1",
    animation: { defaultClip: "idle", clips: [] },
    createdAt: now,
    updatedAt: now
  };
}

function validate(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("Hồ sơ nhân vật không hợp lệ.");
  }
  if (typeof profile.id !== "string" || !profile.id.startsWith("char_")) {
    throw new Error("ID nhân vật không hợp lệ.");
  }
  if (typeof profile.name !== "string" || !profile.parts || typeof profile.parts !== "object" ||
      !profile.colors || typeof profile.colors !== "object") {
    throw new Error("Thiếu tên, bộ phận hoặc màu sắc của nhân vật.");
  }
  const defaults = createCharacter(profile.name);
  return {
    ...defaults,
    ...profile,
    schemaVersion: VERSION,
    description: typeof profile.description === "string" ? profile.description : "",
    parts: { ...defaults.parts, ...profile.parts },
    colors: { ...defaults.colors, ...profile.colors },
    animation: { ...defaults.animation, ...(profile.animation || {}) }
  };
}

export class CharacterStore {
  constructor() {
    this.characters = [];
    this.activeId = null;
    this.storageAvailable = true;
    this.load();
  }

  load() {
    let data = [];
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) throw new Error("Dữ liệu lưu phải là một danh sách.");
      this.characters = data.map(validate);
    } catch (error) {
      console.warn("Không thể đọc hồ sơ đã lưu:", error);
      this.characters = [];
    }
    if (!this.characters.length) this.characters = [createCharacter()];
    this.activeId = this.characters[0].id;
    this.persist();
  }

  persist() {
    try {
      if (!globalThis.localStorage) throw new Error("Trình duyệt không hỗ trợ localStorage.");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.characters));
      this.storageAvailable = true;
    } catch (error) {
      this.storageAvailable = false;
      console.warn("Không thể lưu hồ sơ; dữ liệu chỉ còn trong phiên này:", error);
    }
  }

  get active() {
    return this.characters.find((character) => character.id === this.activeId) || null;
  }

  select(id) {
    if (!this.characters.some((character) => character.id === id)) return false;
    this.activeId = id;
    return true;
  }

  add(name) {
    const character = createCharacter(name);
    this.characters.push(character);
    this.activeId = character.id;
    this.persist();
    return character;
  }

  update(patch) {
    if (!this.active) return null;
    const safePatch = { ...patch };
    if (patch.parts) safePatch.parts = { ...this.active.parts, ...patch.parts };
    if (patch.colors) safePatch.colors = { ...this.active.colors, ...patch.colors };
    Object.assign(this.active, safePatch, { updatedAt: new Date().toISOString() });
    this.persist();
    return this.active;
  }

  duplicate() {
    if (!this.active) return null;
    const character = clone(this.active);
    character.id = makeId();
    character.name += " (bản sao)";
    character.createdAt = new Date().toISOString();
    character.updatedAt = character.createdAt;
    this.characters.push(character);
    this.activeId = character.id;
    this.persist();
    return character;
  }

  remove(id) {
    if (this.characters.length < 2) throw new Error("Cần giữ lại ít nhất một nhân vật.");
    if (!this.characters.some((character) => character.id === id)) return false;
    this.characters = this.characters.filter((character) => character.id !== id);
    if (this.activeId === id) this.activeId = this.characters[0].id;
    this.persist();
    return true;
  }

  import(profile) {
    const character = validate(profile);
    if (this.characters.some((item) => item.id === character.id)) character.id = makeId();
    character.updatedAt = new Date().toISOString();
    this.characters.push(character);
    this.activeId = character.id;
    this.persist();
    return character;
  }

  exportActive() {
    if (!this.active) throw new Error("Chưa chọn nhân vật.");
    return JSON.stringify(this.active, null, 2);
  }
}
