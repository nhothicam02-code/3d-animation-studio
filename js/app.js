import { CharacterStore } from "./character-store.js";
import { CharacterViewport } from "./viewport.js";
import { AssetLibrary } from "./asset-library.js";

const $ = (selector) => document.querySelector(selector);
const store = new CharacterStore();
const viewport = new CharacterViewport($("#character-canvas"));
const assetLibrary = new AssetLibrary("./data/asset-manifest.json");

const options = {
  face: ["face_basic_01", "face_round_02", "face_soft_03"],
  eyes: ["eyes_round_01", "eyes_sparkle_02", "eyes_anime_03"],
  eyebrows: ["brows_soft_01", "brows_straight_02", "brows_arch_03"],
  nose: ["nose_small_01", "nose_button_02"],
  mouth: ["mouth_smile_01", "mouth_neutral_02", "mouth_open_03"],
  hair: ["hair_bob_01", "hair_long_02", "hair_twin_03", "hair_short_04"],
  outfit: ["outfit_simple_01", "dress_02", "hoodie_03", "jacket_04"],
  accessory: ["none", "glasses_01", "bow_02", "hat_03"],
  shoes: ["shoes_basic_01", "boots_02", "sneakers_03"]
};
const labels = {
  face: "Khuôn mặt", faces: "Khuôn mặt", eyes: "Mắt", eyebrows: "Lông mày",
  nose: "Mũi", noses: "Mũi", mouth: "Miệng", mouths: "Miệng", hair: "Tóc",
  outfit: "Trang phục", clothes: "Trang phục", body: "Cơ thể", arms: "Tay",
  legs: "Chân", accessory: "Phụ kiện", accessories: "Phụ kiện",
  shoes: "Giày", footwear: "Giày"
};
const categoryLabels = {
  faces: "Khuôn mặt", eyes: "Mắt", eyebrows: "Lông mày", noses: "Mũi",
  mouths: "Miệng", hair: "Tóc", body: "Cơ thể", arms: "Tay", legs: "Chân",
  clothes: "Trang phục", accessories: "Phụ kiện", footwear: "Giày"
};

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

function listCharacters() {
  const query = $("#character-search").value.trim().toLocaleLowerCase();
  const container = $("#character-list");
  container.replaceChildren();
  store.characters
    .filter((character) => character.name.toLocaleLowerCase().includes(query))
    .forEach((character) => {
      const button = document.createElement("button");
      button.className = "character-item" + (character.id === store.activeId ? " active" : "");
      button.innerHTML = '<span class="avatar">✦</span><span class="character-meta"><strong></strong><span></span></span>';
      button.querySelector("strong").textContent = character.name;
      button.querySelector(".character-meta span").textContent = character.id;
      button.addEventListener("click", () => {
        store.select(character.id);
        render();
      });
      container.append(button);
    });
}

function buildControls() {
  const container = $("#part-controls");
  container.replaceChildren();
  Object.entries(options).forEach(([key, values]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "part-control";
    const label = document.createElement("label");
    label.textContent = labels[key];
    label.htmlFor = "part-" + key;
    const select = document.createElement("select");
    select.id = "part-" + key;
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    select.addEventListener("change", () => {
      store.update({ parts: { ...store.active.parts, [key]: select.value } });
      $("#save-status").textContent = "Đã cập nhật";
    });
    wrapper.append(label, select);
    container.append(wrapper);
  });
}

function syncCharacter() {
  const character = store.active;
  if (!character) return;
  $("#current-breadcrumb").textContent = character.name;
  $("#stage-title").textContent = character.name;
  $("#character-name").value = character.name;
  $("#character-description").value = character.description || "";
  $("#character-id").textContent = character.id;
  Object.entries(options).forEach(([key, values]) => {
    $("#part-" + key).value = character.parts[key] || values[0];
  });
  $("#hair-color").value = character.colors.hair;
  $("#eye-color").value = character.colors.eyes;
  $("#outfit-color").value = character.colors.outfit;
  viewport.updateColors(character.colors);
}

function render() {
  listCharacters();
  syncCharacter();
}

function setView(name) {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".workspace-view").forEach((section) => {
    section.classList.toggle("active", section.id === "view-" + name);
  });
}

function setTab(name) {
  document.querySelectorAll(".inspector-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".inspector-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === "tab-" + name);
  });
}

function saveCharacter() {
  const name = $("#character-name").value.trim();
  if (!name) return toast("Hãy nhập tên nhân vật.");
  store.update({ name, description: $("#character-description").value });
  render();
  $("#save-status").textContent = "Đã lưu trên thiết bị";
  toast("Đã lưu hồ sơ.");
}

function exportCharacter() {
  const blob = new Blob([store.exportActive()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = store.active.id + ".json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderAssets() {
  const grid = $("#asset-grid");
  grid.replaceChildren();
  try {
    const [assets, categories] = await Promise.all([
      assetLibrary.load(),
      assetLibrary.loadCategories()
    ]);
    categories.forEach((category) => {
      const card = document.createElement("article");
      card.className = "asset-card";
      const title = document.createElement("h3");
      title.textContent = categoryLabels[category.id] || category.id;
      const description = document.createElement("p");
      description.textContent = "Thư mục: " + (category.path || ("assets/" + category.id + "/"));
      const count = document.createElement("span");
      count.className = "asset-count";
      count.textContent = assets.filter((asset) => asset.category === category.id).length + " asset";
      card.append(title, description, count);
      grid.append(card);
    });
    assets.forEach((asset) => {
      const card = document.createElement("article");
      card.className = "asset-card";
      const title = document.createElement("h3");
      title.textContent = asset.name || asset.id;
      const meta = document.createElement("p");
      meta.textContent = (categoryLabels[asset.category] || asset.category || "Asset") + " · " + (asset.format || "glb");
      const path = document.createElement("code");
      path.className = "asset-count";
      path.textContent = asset.path || "";
      const use = document.createElement("button");
      use.className = "button button-primary asset-use";
      use.textContent = "Dùng trong viewport";
      use.addEventListener("click", async () => {
        try {
          await viewport.loadGLB(asset);
          $("#asset-feedback").textContent = "Đã tải: " + (asset.name || asset.id);
          toast("Đã tải mô hình GLB.");
        } catch (error) {
          $("#asset-feedback").textContent = "Lỗi tải GLB: " + error.message;
          toast("Không tải được GLB.");
        }
      });
      card.append(title, meta, path, use);
      grid.append(card);
    });
    if (!categories.length && !assets.length) {
      const empty = document.createElement("div");
      empty.className = "asset-empty";
      empty.textContent = "Manifest chưa có danh mục hoặc asset nào.";
      grid.append(empty);
    }
  } catch (error) {
    const message = document.createElement("div");
    message.className = "asset-empty";
    message.textContent = "Không đọc được asset manifest: " + error.message;
    grid.append(message);
  }
}

buildControls();
render();
renderAssets();
$("#viewport-loading").hidden = true;
viewport.onSelect = (name) => {
  const label = labels[name] || name;
  $("#selected-part-badge").textContent = "Đang chọn: " + label;
  $("#selection-label").textContent = "Đã chọn bộ phận: " + label;
  setTab("appearance");
};

document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll(".inspector-tab").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
$("#new-character").addEventListener("click", () => { store.add(); render(); setView("characters"); toast("Đã tạo nhân vật."); });
$("#save-character").addEventListener("click", saveCharacter);
$("#character-name").addEventListener("change", () => {
  store.update({ name: $("#character-name").value.trim() || "Nhân vật mới" });
  render();
});
$("#character-description").addEventListener("change", () => store.update({ description: $("#character-description").value }));
$("#character-search").addEventListener("input", listCharacters);
$("#duplicate-character").addEventListener("click", () => { store.duplicate(); render(); toast("Đã nhân bản."); });
$("#delete-character").addEventListener("click", () => {
  if (!confirm("Xóa hồ sơ nhân vật này?")) return;
  try { store.remove(store.activeId); render(); toast("Đã xóa."); }
  catch (error) { toast(error.message); }
});
$("#export-character").addEventListener("click", exportCharacter);
$("#import-character").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { store.import(JSON.parse(await file.text())); render(); toast("Đã nhập hồ sơ nhân vật."); }
  catch (error) { toast("Không thể nhập: " + error.message); }
  event.target.value = "";
});
$("#reset-camera").addEventListener("click", () => viewport.resetCamera());
let gridVisible = true;
$("#toggle-grid").addEventListener("click", () => { gridVisible = !gridVisible; viewport.grid.visible = gridVisible; });
$("#fullscreen-stage").addEventListener("click", () => $("#viewport-wrap").requestFullscreen?.());
document.querySelectorAll(".motion-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".motion-button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  viewport.setMotion(button.dataset.motion);
  $("#motion-preview strong").textContent = "Đang xem: " + button.dataset.motion;
}));
$("#stop-motion").addEventListener("click", () => {
  viewport.setMotion("idle");
  document.querySelectorAll(".motion-button").forEach((button) => button.classList.remove("active"));
  $("#motion-preview strong").textContent = "Đã dừng chuyển động";
});
[["hair-color", "hair"], ["eye-color", "eyes"], ["outfit-color", "outfit"]].forEach(([id, key]) => {
  $("#" + id).addEventListener("input", (event) => {
    store.update({ colors: { ...store.active.colors, [key]: event.target.value } });
    viewport.updateColors(store.active.colors);
  });
});
$("#test-token").addEventListener("click", () => {
  $("#token-feedback").textContent = $("#service-token").value.trim()
    ? "Đã nhận trong phiên này, chưa gửi đi xác thực."
    : "Bạn chưa nhập key hoặc token.";
});
$("#service-token").addEventListener("input", () => { $("#token-feedback").textContent = ""; });
$("#load-glb").addEventListener("click", async () => {
  const path = $("#asset-url").value.trim();
  if (!path) return toast("Nhập đường dẫn GLB trước.");
  const asset = {
    id: "custom_" + Date.now(),
    name: $("#asset-name").value.trim() || "GLB tùy chỉnh",
    category: $("#asset-category").value,
    path,
    format: "glb"
  };
  try {
    await viewport.loadGLB(asset);
    $("#asset-feedback").textContent = "Đã tải thành công: " + asset.name + " (phiên này).";
    toast("Đã tải mô hình vào viewport.");
  } catch (error) {
    $("#asset-feedback").textContent = "Không tải được: " + error.message;
    toast("Lỗi tải GLB.");
  }
});
