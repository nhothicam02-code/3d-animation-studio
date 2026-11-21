import { CharacterStore } from "./character-store.js";
import { CharacterViewport } from "./viewport.js";
import { AssetLibrary } from "./asset-library.js";
import { createGLBThumbnail } from "./thumbnail.js";

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

let allAssets = [];
let assetCategories = [];
let selectedAssetCategory = "all";
let assetPage = 1;
const ASSETS_PER_PAGE = 12;

function renderAssetTabs() {
  const tabs = $("#asset-category-tabs");
  tabs.replaceChildren();
  const allButton = document.createElement("button");
  allButton.className = "asset-category-tab" + (selectedAssetCategory === "all" ? " active" : "");
  allButton.setAttribute("role", "tab");
  allButton.setAttribute("aria-selected", String(selectedAssetCategory === "all"));
  allButton.textContent = "Tất cả";
  const allCount = document.createElement("span");
  allCount.className = "tab-count";
  allCount.textContent = allAssets.length;
  allButton.append(allCount);
  allButton.addEventListener("click", () => { selectedAssetCategory = "all"; assetPage = 1; renderAssetBrowser(); });
  tabs.append(allButton);

  assetCategories.forEach((category) => {
    const button = document.createElement("button");
    const count = allAssets.filter((asset) => asset.category === category.id).length;
    button.className = "asset-category-tab" + (selectedAssetCategory === category.id ? " active" : "");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(selectedAssetCategory === category.id));
    button.append(document.createTextNode(categoryLabels[category.id] || category.label || category.id));
    const badge = document.createElement("span");
    badge.className = "tab-count";
    badge.textContent = count;
    button.append(badge);
    button.addEventListener("click", () => { selectedAssetCategory = category.id; assetPage = 1; renderAssetBrowser(); });
    tabs.append(button);
  });
}

function renderAssetBrowser() {
  renderAssetTabs();
  const query = $("#asset-search").value.trim().toLocaleLowerCase();
  const filtered = allAssets.filter((asset) => {
    const categoryMatch = selectedAssetCategory === "all" || asset.category === selectedAssetCategory;
    const text = [asset.name, asset.id, asset.category].filter(Boolean).join(" ").toLocaleLowerCase();
    return categoryMatch && (!query || text.includes(query));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / ASSETS_PER_PAGE));
  assetPage = Math.min(assetPage, totalPages);
  const start = (assetPage - 1) * ASSETS_PER_PAGE;
  const pageItems = filtered.slice(start, start + ASSETS_PER_PAGE);
  $("#asset-total").textContent = allAssets.length + " mô hình";
  $("#asset-results-label").textContent = selectedAssetCategory === "all"
    ? "Tất cả mô hình" : (categoryLabels[selectedAssetCategory] || selectedAssetCategory);
  $("#asset-page-label").textContent = filtered.length
    ? "Hiển thị " + (start + 1) + "–" + Math.min(start + ASSETS_PER_PAGE, filtered.length) + " / " + filtered.length
    : "Không có kết quả";

  const grid = $("#asset-grid");
  grid.replaceChildren();
  if (!pageItems.length) {
    const empty = document.createElement("div");
    empty.className = "asset-empty";
    empty.textContent = query ? "Không tìm thấy mô hình phù hợp." : "Danh mục này chưa có mô hình. Hãy thêm asset GLB vào manifest.";
    grid.append(empty);
  }
  pageItems.forEach((asset) => {
    const card = document.createElement("article");
    card.className = "asset-card";
    const preview = document.createElement("div");
    preview.className = "asset-preview";
    const thumbnail = asset.thumbnail || asset.preview || asset.image;
    if (thumbnail) {
      const image = document.createElement("img");
      image.src = thumbnail;
      image.alt = "Xem trước " + (asset.name || asset.id);
      image.loading = "lazy";
      image.onerror = () => { image.remove(); const fallback = document.createElement("span"); fallback.className = "asset-preview-fallback"; fallback.textContent = "◇"; preview.append(fallback); };
      preview.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "asset-preview-fallback";
      fallback.textContent = "◇";
      preview.append(fallback);
    }
    const title = document.createElement("h3");
    title.textContent = asset.name || asset.id;
    const meta = document.createElement("p");
    meta.textContent = (categoryLabels[asset.category] || asset.category || "Asset") + " · " + (asset.format || "glb");
    const path = document.createElement("span");
    path.className = "asset-count";
    path.textContent = asset.id || asset.path || "";
    const use = document.createElement("button");
    use.className = "button button-primary asset-use";
    use.textContent = "Dùng mô hình này";
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
    card.append(preview, title, meta, path, use);
    grid.append(card);
  });

  const pagination = $("#asset-pagination");
  pagination.replaceChildren();
  if (totalPages > 1) {
    const addPageButton = (label, page, disabled = false, active = false) => {
      const button = document.createElement("button");
      button.className = "asset-page-button" + (active ? " active" : "");
      button.textContent = label;
      button.disabled = disabled;
      if (active) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => { assetPage = page; renderAssetBrowser(); });
      pagination.append(button);
    };
    addPageButton("‹", assetPage - 1, assetPage === 1);
    const pages = new Set([1, totalPages, assetPage - 1, assetPage, assetPage + 1]);
    let previous = 0;
    [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a,b) => a-b).forEach((page) => {
      if (previous && page - previous > 1) {
        const dots = document.createElement("span"); dots.className = "asset-page-ellipsis"; dots.textContent = "…"; pagination.append(dots);
      }
      addPageButton(String(page), page, false, page === assetPage);
      previous = page;
    });
    addPageButton("›", assetPage + 1, assetPage === totalPages);
  }
}

async function renderAssets() {
  const grid = $("#asset-grid");
  grid.replaceChildren();
  try {
    [allAssets, assetCategories] = await Promise.all([assetLibrary.load(), assetLibrary.loadCategories()]);
    renderAssetBrowser();
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
$("#asset-search").addEventListener("input", () => { assetPage = 1; renderAssetBrowser(); });
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
$("#test-token").addEventListener("click", async () => {
  const token = $("#service-token").value.trim();
  if (!token) { $("#token-feedback").textContent = "Bạn chưa nhập GitHub token."; return; }
  $("#token-feedback").textContent = "Đang kiểm tra quyền truy cập repository...";
  try {
    await githubContents("data/asset-manifest.json", token);
    $("#token-feedback").textContent = "Kết nối thành công. Token có thể đọc manifest; quyền ghi sẽ được kiểm tra khi upload.";
  } catch (error) {
    $("#token-feedback").textContent = "Kết nối thất bại: " + error.message;
  }
});
$("#service-token").addEventListener("input", () => { $("#token-feedback").textContent = ""; });
const GITHUB_OWNER = "nhothicam02-code";
const GITHUB_REPO = "3d-animation-studio";
const GITHUB_BRANCH = "main";
const GITHUB_API = "https://api.github.com";
const slugify = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

function githubHeaders(token) {
  return { Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28" };
}
async function githubContents(path, token) {
  const response = await fetch(GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path,
    { headers: githubHeaders(token) });
  if (!response.ok) throw new Error("GitHub không đọc được " + path + " (HTTP " + response.status + ").");
  return response.json();
}
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
async function putGitHubFile(path, content, token, message, existingSha) {
  const body = { message, content: typeof content === "string" ? content : toBase64(await content.arrayBuffer()), branch: GITHUB_BRANCH };
  if (existingSha) body.sha = existingSha;
  const response = await fetch(GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path, {
    method: "PUT", headers: { ...githubHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error("Không ghi được " + path + " (HTTP " + response.status + "): " + (detail.message || "Lỗi GitHub API"));
  }
  return response.json();
}
async function readManifestForWrite(token) {
  const response = await githubContents("data/asset-manifest.json", token);
  const bytes = Uint8Array.from(atob(response.content.replace(/\s/g, "")), (char) => char.charCodeAt(0));
  return { manifest: JSON.parse(new TextDecoder().decode(bytes)), sha: response.sha };
}

$("#asset-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  $("#asset-file-name").textContent = file ? file.name + " · " + (file.size / 1048576).toFixed(1) + " MB" : "Chưa chọn tệp";
  if (file && !$("#asset-name").value.trim()) $("#asset-name").value = file.name.replace(/\.glb$/i, "").replace(/[_-]+/g, " ");
});

$("#save-asset-github").addEventListener("click", async () => {
  const file = $("#asset-file").files?.[0];
  const name = $("#asset-name").value.trim();
  const category = $("#asset-category").value;
  const token = $("#service-token").value.trim();
  if (!file || !/\.glb$/i.test(file.name)) return toast("Hãy chọn một file .glb hợp lệ.");
  if (!name) return toast("Hãy nhập tên mô hình.");
  if (!token) return toast("Hãy nhập GitHub token trong Cài đặt.");
  if (file.size > 50 * 1024 * 1024) return toast("File vượt quá giới hạn 50 MB cho trình tải trên web.");
  const id = category + "_" + (slugify(name) || "model");
  if (allAssets.some((asset) => asset.id === id)) return toast("ID này đã tồn tại. Hãy đổi tên mô hình.");
  const button = $("#save-asset-github");
  button.disabled = true;
  button.textContent = "Đang xử lý...";
  try {
    $("#asset-feedback").textContent = "Đang tạo ảnh thumbnail 3D...";
    const thumbnailBlob = await createGLBThumbnail(file);
    const modelPath = "assets/" + category + "/" + id + ".glb";
    const thumbnailPath = "thumbnails/" + category + "/" + id + ".webp";
    $("#asset-feedback").textContent = "Đang tải mô hình GLB lên GitHub...";
    await putGitHubFile(modelPath, file, token, "Add 3D asset " + id);
    $("#asset-feedback").textContent = "Đang tải thumbnail và cập nhật manifest...";
    await putGitHubFile(thumbnailPath, thumbnailBlob, token, "Add thumbnail " + id);
    const { manifest, sha } = await readManifestForWrite(token);
    manifest.assets ||= [];
    if (manifest.assets.some((asset) => asset.id === id)) throw new Error("Asset ID đã tồn tại trong manifest.");
    manifest.assets.push({ id, name, category, path: modelPath, thumbnail: thumbnailPath, format: "glb" });
    await putGitHubFile("data/asset-manifest.json", JSON.stringify(manifest, null, 2) + "\n",
      token, "Register 3D asset " + id, sha);
    assetLibrary.manifest = null;
    assetLibrary.pending = null;
    await renderAssets();
    $("#asset-feedback").textContent = "Đã lưu thành công " + name + " lên GitHub và đăng ký trong manifest.";
    $("#asset-name").value = "";
    $("#asset-file").value = "";
    $("#asset-file-name").textContent = "Chưa chọn tệp";
    toast("Đã thêm mô hình vào thư viện!");
  } catch (error) {
    $("#asset-feedback").textContent = "Chưa hoàn tất: " + error.message + " Nếu file đã upload nhưng manifest chưa cập nhật, kiểm tra thư mục assets/thumbnails trên GitHub trước khi thử lại.";
    toast("Không thể hoàn tất lưu mô hình.");
  } finally {
    button.disabled = false;
    button.textContent = "Lưu lên GitHub";
  }
});
