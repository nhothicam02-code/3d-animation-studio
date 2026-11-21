# 3D Character Studio

A browser-based character creator built with HTML, CSS, JavaScript and Three.js.

## Character architecture
- One unified **Full Body Mesh** is the character base. Head, torso, arms and legs are not separate library slots.
- Upload the body GLB to **Cơ thể nền**. It should contain Blender Shape Keys exported as glTF morph targets.
- Hair, face details and each clothing layer are independent GLB assets: áo lót, quần lót, áo trong, áo ngoài, áo khoác, tay áo, quần, váy, vớ, shoes and accessories.
- The character root has its own unbounded X/Y/Z position. Each item has its own unbounded X/Y/Z offset, plus per-axis scale and rotation.
- Item transforms, character transform and body Shape Key values are stored per character and synced to GitHub/local backup.

## Body GLB / Shape Key contract
- Export one full-body character mesh (or multiple material meshes inside one GLB that together form the full body).
- Use a neutral A-pose or T-pose, Y-up, facing -Z, with origin at the character root.
- Export Shape Keys as glTF morph targets. Three.js GLTFLoader exposes morphTargetDictionary and morphTargetInfluences.
- Use stable names such as Head_Size, Eye_Size, Body_Width, Arm_Length, Leg_Length, Chest_Size, Belly_Size, Hip_Width and Butt_Size.
- The website discovers morph targets from the loaded GLB; it does not create missing Shape Keys. Create deformations in Blender first.
- The UI exposes values from -1 to 1. Use matching names across meshes when a deformation spans multiple mesh objects.

## Clothing compatibility
Clothing remains independent but must be fitted to the same neutral body. For reliable customization, add matching morph targets to garment meshes (using the same names as the body where possible), or prepare fitted clothing variants. Static clothing will not automatically follow arbitrary body deformations.

## GitHub persistence and safety
- Enter a fine-grained GitHub token in Settings; grant Contents: Read and write only for this repository.
- The token is held in current page memory and must be re-entered after reload. Never commit it or paste it into chat.
- Profiles under characters/<id>.json store asset IDs, item transforms, character root transform, Shape Key values and metadata.
- GLB uploads are limited to 20 MB. A browser-entered token is available to page JavaScript while the tab is open.

## Run locally
Serve the folder through HTTP (for example python -m http.server 8000) and open http://localhost:8000.

## Current limitation
The repository does not yet contain the final production Full Body GLB. Upload a full-body GLB with Blender Shape Keys to Cơ thể nền. Until then the Shape Key editor has no body morph targets to display.

## Clothing categories

| Category | Purpose |
|---|---|
| Áo lót | Undergarment top |
| Quần lót | Undergarment bottom |
| Áo trong | Inner top |
| Áo ngoài | Outer top layer; keeps the previous clothing assets for compatibility |
| Áo khoác | Jacket / hoodie / cardigan |
| Tay áo | Separate sleeve pieces |
| Quần | Pants and shorts |
| Váy | Skirts |
| Vớ | Socks and leg warmers |

Garments are independent GLBs, each with its own transform. Match garment morph targets to body Shape Keys or provide fitted variants to avoid clipping.
