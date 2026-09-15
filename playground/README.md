# Playground

A local test harness for `@netrilis/liveness-web-client`. It loads the **built**
SDK from `../dist` and resolves MediaPipe from a CDN via an import map, so it
runs under any static server.

## Prerequisites

The playground imports `../dist/index.js`, so build the SDK first:

```bash
npm install
npm run build      # or: npm run dev  (watch mode, rebuilds on change)
```

## Run it

Any static server works — the only requirement is a **secure context**
(`localhost` or HTTPS), which the camera needs.

**Option A — npm script (zero setup):**

```bash
npm run playground        # serves the repo root at http://localhost:3000
# then open http://localhost:3000/playground/
```

`npm run playground:dev` builds first, then serves.

**Option B — VS Code Live Server:**

Right-click `playground/index.html` → **Open with Live Server**. Live Server
serves the workspace root, so `../dist/index.js` resolves correctly.

**Option C — anything else:** `python3 -m http.server 3000` from the repo root,
then open `http://localhost:3000/playground/`.

## Using it

1. Click **Start** → grant camera permission.
2. Align your face until the reference photo is captured automatically.
3. Perform each prompted challenge (blink, smile, open mouth, turn).
4. The trimmed session payload (base64 blobs shortened) appears on completion.

Tune **challenge count**, **timeout**, and the **blur variance floor** live from
the config panel before pressing Start.

## Notes

- Uses public CDN assets (`DEFAULT_ASSETS`) for the MediaPipe wasm + model. Fine
  for local testing; **self-host for production.**
- The preview `<video>` is mirrored (CSS `scaleX(-1)`) for a natural selfie feel;
  this is display-only and does not affect landmark math or turn direction.
- After editing SDK source, re-run `npm run build` (or keep `npm run dev`
  running) and refresh the page.
