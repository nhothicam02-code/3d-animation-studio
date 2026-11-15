# Mixamo Motion API (Cloudflare Worker)

This Worker keeps the Gemini API key on the server. Do not paste the key into the website or commit it to GitHub.

## Deploy

1. Install Node.js, then open a terminal in this folder (`worker`).
2. Run:

```bash
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

3. When prompted for the secret, paste your Gemini API key into the terminal.
4. Copy the deployed Worker URL (for example, `https://mixamo-motion-api.<your-account>.workers.dev`).
5. Open the 3D Animation Studio website, paste that URL into **Gemini Worker URL**, then press Enter.

The website calls `POST <Worker URL>/animate`. The Worker uses Gemini Interactions API with the `gemini-3.8-flash` model and returns structured bone keyframes.

## Notes

- The first version targets Mixamo-style FBX skeletons and generates in-place bone rotations.
- The Worker CORS policy is restricted to this GitHub Pages origin: `https://nhothicam02-code.github.io`.
- Add Cloudflare rate limiting before sharing the Worker publicly; CORS is not authentication and does not prevent direct scripted requests.
