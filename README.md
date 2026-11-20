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

## Security
Never commit personal access tokens or API keys. Never store long-lived credentials in localStorage or public client-side JavaScript. A public static site cannot safely hold a private GitHub token. Use GitHub OAuth or a GitHub App through a trusted backend for repository writes. The current Settings field is a non-persistent placeholder and makes no network requests.

## Next milestones
1. Load real GLB assets from the manifest.
2. Implement attachment sockets and modular assembly.
3. Add rig profiles, skinning validation and animation retargeting.
4. Build reusable clips and a timeline/keyframe editor.
5. Add secure GitHub authentication and profile sync.
6. Add character and animation export.

## Prototype limitations
The current model is procedural placeholder geometry. Asset selectors save IDs but do not yet load corresponding GLB files. Motion controls are preview-only, not a production rig or keyframe system.
