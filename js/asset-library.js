export class AssetLibrary {
  constructor(manifestUrl) {
    this.manifestUrl = manifestUrl;
    this.manifest = null;
    this.pending = null;
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    if (!this.pending) {
      this.pending = fetch(this.manifestUrl, { cache: "no-cache" })
        .then((response) => {
          if (!response.ok) throw new Error("Không tải được manifest (HTTP " + response.status + ").");
          return response.json();
        })
        .then((manifest) => {
          if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.assets) ||
              !Array.isArray(manifest.categories)) {
            throw new Error("Cấu trúc asset manifest không hợp lệ.");
          }
          this.manifest = manifest;
          return manifest;
        })
        .catch((error) => {
          this.pending = null;
          throw error;
        });
    }
    return this.pending;
  }

  async load() {
    const manifest = await this.loadManifest();
    return manifest.assets;
  }

  async loadCategories() {
    const manifest = await this.loadManifest();
    return manifest.categories;
  }

  get categories() {
    return this.manifest?.categories || [];
  }
}
