# 3D Character Studio

A modular browser-based character creation workspace built with HTML, CSS, JavaScript and Three.js.

## Current foundation

- Responsive studio shell with character list, 3D viewport and inspector.
- Procedural placeholder character with selectable meshes.
- Drag-to-rotate, wheel zoom, grid toggle and camera reset.
- Versioned JSON character profiles with stable IDs.
- Local browser persistence with an in-memory fallback when browser storage is unavailable.
- Duplicate, delete, import and export character profiles.
- Asset taxonomy and a validated JSON manifest loader.
- Public GLB loading with category-based placeholder visibility and replacement.
- Idle, bounce and simple wave motion previews.
- Session-only API key/token field placeholder.

## Run locally

Serve this folder through an HTTP server because ES modules and import maps may not work from a file URL.

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Asset contract

Production models should use GLB/glTF and share a documented scale, Y-up / -Z-forward convention, pivots, attachment socket names, material naming, rig profile and stable asset IDs.

The `data/asset-manifest.json` file defines the catalog categories. Each asset entry should contain a unique `id`, `name`, `category`, `path` and `format`, for example:

```json
{
  "id": "hair_bob_01",
  "name": "Tóc bob 01",
  "category": "hair",
  "path": "assets/hair/hair_bob_01.glb",
  "format": "glb"
}
```

Use a category ID declared in the manifest (such as `faces`, `hair`, `clothes` or `footwear`). The Asset page can also load a public `.glb` URL or a relative path for the current session. Public cross-origin URLs must permit browser CORS access.

## Character data

A profile stores asset IDs, colors, rig profile, animation references and metadata. It does not duplicate the underlying model files. The schema is versioned to allow future migrations.

Profiles are stored in the current browser when localStorage is available. If storage is blocked or full, the studio remains usable for the current page session but changes cannot persist after the page is closed.

## Security

Never commit personal access tokens or API keys. Never store long-lived credentials in localStorage or public client-side JavaScript. A public static site cannot safely hold a private GitHub token. Use GitHub OAuth or a GitHub App through a trusted backend for repository writes. The current Settings field is a non-persistent placeholder and makes no network requests.

## Known prototype limitations

- Character part selectors currently save profile asset IDs; they do not yet assemble those selected IDs into the 3D model automatically.
- GLB placement uses approximate category anchors and normalized bounds. It is not a production socket/pivot fitting system.
- One GLB is displayed per category at a time.
- The procedural fallback is a demonstration model, not the final reusable character base.
- Motion previews are simple procedural transforms. There is no production skeleton, skinning workflow, facial rig, timeline, keyframe editor or audio lip-sync yet.
- The project does not yet render or export a finished video.
- The browser does not write assets or profiles back to GitHub. Secure repository sync needs a trusted authentication/backend flow.

## Next milestones

1. Define and validate the modular asset naming, pivot and attachment-socket standard.
2. Connect character profile selections to actual GLB asset assembly.
3. Add reusable base bodies, outfit fitting and rig profiles.
4. Add facial expressions, audio lip-sync and animation clips.
5. Build a timeline/keyframe editor and script-to-scene workflow.
6. Add secure GitHub asset/profile sync through a trusted backend.
7. Add video rendering/export.
