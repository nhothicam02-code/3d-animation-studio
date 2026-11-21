# 3D Character Studio

A modular browser-based character creation workspace built with HTML, CSS, JavaScript and Three.js.

## Current foundation
- Responsive studio shell with character list, 3D viewport and inspector.
- Procedural placeholder character with selectable meshes.
- Drag-to-rotate, wheel zoom, grid toggle and camera reset.
- Versioned JSON profiles with stable IDs.
- Local browser persistence, duplicate, delete, import and export.
- Asset taxonomy and manifest contract.
- Starter motion previews.
- Session-only API key/token field placeholder.

## Run locally
Serve this folder through an HTTP server because ES modules and import maps may not work from a file URL. Example: python -m http.server 8000, then open http://localhost:8000.

## Asset contract
Production models should use GLB/glTF and share a documented scale, Y-up / -Z-forward convention, pivots, attachment socket names, material naming, rig profile and stable asset IDs. The data/asset-manifest.json file defines the catalog categories.

## Character data
A profile stores asset IDs, colors, rig profile, animation references and metadata. It should not duplicate the underlying model files. The schema is versioned to allow future migrations.

## GitHub connection (browser session)
- Open **Settings**, enter a fine-grained GitHub token, then use **Kiểm tra kết nối**.
- Required repository permission: **Contents: Read and write** for this repository.
- The token is held only in the current JavaScript page memory. It is not written to Local Storage, downloaded profile files, or committed source code. Reloading the page clears it.
- **Lưu nhân vật** exports a JSON backup and, when connected, writes one JSON profile per character under `characters/`.
- **Tải hồ sơ** reads the saved profile JSON files from GitHub.
- Adding a GLB while connected uploads it under `assets/<category>/` and updates `data/asset-manifest.json`. Browser upload is limited to 20 MB per GLB.
- Important: a public static website cannot provide the same secret isolation as a trusted backend. A token entered into the page is available to the page's JavaScript while the tab is open. Use a fine-grained token limited to this one repository, set an expiry, and revoke it if exposed. Never paste the token into chat or commit it.

## Remaining production milestones
1. Complete robust restore of each character's selected GLB parts and per-character XYZ transforms from GitHub.
2. Add real attachment sockets and compatible modular assembly for all categories.
3. Add rig profiles, skinning validation and animation retargeting.
4. Build reusable clips and a timeline/keyframe editor.
5. Add a trusted backend or GitHub App flow for stronger credential isolation.
6. Add assembled character GLB and animation export.

## Prototype limitations
The base model is still procedural placeholder geometry. GLB assets can be uploaded to the repository manifest and loaded into the preview, but attachment points and fit remain approximate. Character JSON sync stores part IDs; complete reconstruction of all selected GLB meshes and per-character transforms is still in progress. Motion previews are not a production rig or keyframe system.

## GLB Asset Library (prototype)

The Asset page can load a public `.glb` file into the 3D viewport:
1. Put GLB files in the repository under the matching folder, for example `assets/hair/hair_bob_01.glb`.
2. Open Asset and paste the public/raw URL or a relative path such as `assets/hair/hair_bob_01.glb`.
3. Choose the category and select **Tải vào viewport**.
4. To make an asset appear in the reusable library, add an entry to `data/asset-manifest.json` under `assets`, for example:

```json
{
  "id": "hair_bob_01",
  "name": "Tóc bob 01",
  "category": "hair",
  "path": "assets/hair/hair_bob_01.glb",
  "format": "glb"
}
```

The GLB loader uses Three.js GLTFLoader. A loaded category replaces its corresponding procedural placeholder part. Current attachment positions and target sizes are approximate prototype defaults in `js/viewport.js`; production assets still need consistent pivots, scale, orientation and attachment points. The loader currently replaces one asset per category, and does not yet perform true bone/socket binding, outfit fitting, rig retargeting, or persistent GitHub writes from the browser. Public cross-origin URLs must permit browser CORS access.