# @netrilis/liveness-web-client

A framework-agnostic, client-side **liveness detection** SDK written in TypeScript/ESM.

It drives a `<video>` + `<canvas>` pair to:

1. **Align** the user's face (centered, ~30–60% of frame, lighting + blur checks).
2. **Capture a high-res reference photo** the *instant* the face is centered and quality-passing — a neutral, eyes-open shot intended for backend ID matching (e.g. against a driver's license).
3. Run **randomized active challenges** (`BLINK`, `SMILE`, `OPEN_MOUTH`, `TURN_LEFT`, `TURN_RIGHT`) using MediaPipe blendshapes + landmark geometry.
4. Resolve a structured **`LivenessSessionPayload`** with all evidence for backend validation.

The core (`LivenessDetector`) is **pure TypeScript + DOM APIs** — no Vue, no Nuxt, no framework coupling. Vue 2 / Vue 3 usage is just a thin wrapper that mounts the class onto DOM elements (examples below).

---

## Installation

```bash
npm install @netrilis/liveness-web-client @mediapipe/tasks-vision
```

`@mediapipe/tasks-vision` is a peer/runtime dependency; the host app controls its version and where the wasm + model assets are served from.

---

## Requirements & assets

- A **secure context** (HTTPS or `localhost`) — `getUserMedia` requires it.
- The MediaPipe **wasm bundle** and the **`face_landmarker.task`** model must be reachable. By default the SDK points at public CDN/Google Storage URLs (see `DEFAULT_ASSETS`). **For production, self-host these** and pass their paths via `landmarker` config to avoid third-party CDN dependency and CSP issues.

---

## Quick start (vanilla / any framework)

```ts
import { LivenessDetector, attachCamera, stopCamera } from "@netrilis/liveness-web-client";

const video = document.querySelector<HTMLVideoElement>("#cam")!;
const canvas = document.querySelector<HTMLCanvasElement>("#work")!; // can be hidden

const detector = new LivenessDetector(video, canvas, {
  challengeCount: 3, // how many randomized challenges to run
  // self-host these in production:
  landmarker: {
    wasmBasePath: "/mediapipe/wasm",
    modelAssetPath: "/mediapipe/face_landmarker.task",
  },
});

// React to lifecycle for your UI:
detector.on("phase", (p) => console.log("phase:", p));
detector.on("alignment", (a) => (statusEl.textContent = a.hint)); // "Move closer", etc.
detector.on("reference-captured", ({ image }) => showThumbnail(image));
detector.on("challenge-start", ({ challenge, index, total }) =>
  prompt.textContent = `Please ${challenge} (${index + 1}/${total})`,
);

const stream = await attachCamera(video);   // or manage getUserMedia yourself
await detector.init();                       // loads the MediaPipe model (once)

try {
  const payload = await detector.start();    // resolves when all challenges pass
  await fetch("/api/liveness/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
} catch (err) {
  // err is a LivenessError with a .code: TIMEOUT | ABORTED | CAMERA_UNAVAILABLE | ...
  console.error(err);
} finally {
  detector.dispose();
  stopCamera(stream);
}
```

> The `<canvas>` is a working surface for cropping/quality analysis and snapshots. It does not need to be visible — hide it with CSS (`display:none` is fine).

---

## Configuration

```ts
new LivenessDetector(video, canvas, {
  challengeCount: 3,
  challengePool: ["BLINK", "SMILE", "OPEN_MOUTH", "TURN_LEFT", "TURN_RIGHT"],
  timeoutMs: 60_000,                     // 0 disables the session timeout
  referenceImage: { type: "image/jpeg", quality: 0.92 },

  // When/how the reference photo is captured once alignment is stable, so the
  // capture isn't sudden and the user can prepare:
  referenceCapture: {
    mode: "auto",                        // "auto" = capture after delayMs; "manual" = wait for captureReference()
    delayMs: 2000,                       // countdown grace period (auto); default 0 = immediate
    requireHold: true,                   // losing alignment during the delay cancels it
  },

  // Gate the challenge flow behind an explicit user action:
  autoStartChallenges: true,             // false => wait for detector.beginChallenges()

  // Quality / framing thresholds (all optional; merged over defaults):
  thresholds: {
    blurVariance: 100,                   // Laplacian variance floor (higher = sharper)
    brightnessMin: 40,
    brightnessMax: 210,
    faceScaleMin: 0.3,                    // face bbox area / frame area
    faceScaleMax: 0.6,
    centerTolerance: 0.15,
    alignmentStableFrames: 8,            // frames a good face must persist before capture
  },

  // Challenge pass thresholds (blendshape scores + turn geometry):
  challengeThresholds: {
    blinkClosed: 0.5,
    smile: 0.5,
    jawOpen: 0.45,
    turnLeftMaxRatio: 0.35,
    turnRightMinRatio: 0.65,
  },

  landmarker: {
    wasmBasePath: "/mediapipe/wasm",
    modelAssetPath: "/mediapipe/face_landmarker.task",
    delegate: "GPU",                     // or "CPU"
  },
});
```

Defaults are conservative starting points — **tune against real device/lighting data.**

---

## Reference capture & challenge start

By default the reference photo is captured automatically the moment alignment is
stable, and challenges begin right after. To avoid a sudden capture and let the
user stay in control, use either strategy:

**Countdown (auto with delay)** — a grace period after alignment, with a
countdown UI:

```ts
new LivenessDetector(video, canvas, {
  referenceCapture: { mode: "auto", delayMs: 2000 },
});

detector.on("align-ready", () => showCountdownRing());
detector.on("capture-countdown", ({ remainingMs }) =>
  (ring.textContent = Math.ceil(remainingMs / 1000)),
);
```

**Manual capture** — the user presses a button when ready:

```ts
new LivenessDetector(video, canvas, {
  referenceCapture: { mode: "manual" },
  autoStartChallenges: false,
});

// Enable/disable the button as the face aligns:
detector.on("align-ready", () => (captureBtn.disabled = false));
detector.on("alignment", () => (captureBtn.disabled = !detector.isAligned()));

captureBtn.onclick = () => detector.captureReference();   // valid only while aligned
startBtn.onclick = () => detector.beginChallenges();      // after reference-captured
```

`captureReference()` also works during an auto countdown to capture early.
Both methods return `false` if called in the wrong phase, so they're safe to
wire directly to buttons.

---

## Events

Subscribe with `detector.on(event, handler)`; it returns an unsubscribe function.

| Event | Payload | Fires when |
| --- | --- | --- |
| `phase` | `LivenessPhase` | Lifecycle changes (`initializing` → `aligning` → `aligned` → `reference-captured` → [`awaiting-challenge-start`] → `challenge` → `completed`/`error`). |
| `alignment` | `AlignmentState` | Every processed frame during alignment — includes a `hint` string for UI. |
| `align-ready` | `{ mode, delayMs }` | Alignment became stable; an auto countdown started, or (manual mode) the user may now trigger capture. |
| `capture-countdown` | `{ remainingMs, totalMs }` | Each frame during an `auto` capture countdown — drive a countdown UI. |
| `reference-captured` | `{ image, metrics }` | Reference photo captured. |
| `awaiting-challenge-start` | `{ challenges }` | Only when `autoStartChallenges: false` — reference captured, waiting for `beginChallenges()`. |
| `challenge-start` | `{ challenge, index, total }` | A new challenge begins. |
| `challenge-pass` | `LivenessEvent` | The current challenge is satisfied. |
| `completed` | `LivenessSessionPayload` | All challenges passed (also the resolved value of `start()`). |
| `error` | `LivenessError` | Session failed/aborted/timed out (also rejects `start()`). |

---

## Output payload

`start()` resolves (and `completed` emits) this object — send it to your backend for validation:

```ts
interface LivenessSessionPayload {
  sessionId: string;
  clientTimestamp: number;
  referenceImage: string;          // Base64 JPEG (data URL), captured on centering
  qualityMetrics: {
    blurVariance: number;
    brightness: number;
  };
  livenessEvents: Array<{
    challenge: "BLINK" | "SMILE" | "OPEN_MOUTH" | "TURN_LEFT" | "TURN_RIGHT";
    timestamp: number;
    blendshapes: Record<string, number>;
    frameSnapshot: string;         // Base64 image at the moment of passing
  }>;
  telemetry: {
    userAgent: string;
    totalDurationMs: number;
  };
}
```

> **Security note:** client-side checks are anti-friction UX, not a security boundary. Always re-validate the reference image and liveness evidence server-side.

---

## Nuxt 2 / Vue 2 usage

The core class is the imperative wrapper — a Vue 2 component just gives it DOM nodes and forwards events. Because MediaPipe is browser-only, load it **client-side** (`process.client` / `<client-only>`).

```vue
<!-- components/LivenessCamera.vue -->
<template>
  <div class="liveness">
    <video ref="video" autoplay playsinline muted></video>
    <canvas ref="canvas" style="display: none"></canvas>
    <p class="hint">{{ hint }}</p>
  </div>
</template>

<script>
export default {
  name: "LivenessCamera",
  data() {
    return { hint: "", detector: null, stream: null, unsub: [] };
  },
  async mounted() {
    if (!process.client) return;
    // Dynamic import keeps MediaPipe out of the SSR bundle.
    const { LivenessDetector, attachCamera } = await import(
      "@netrilis/liveness-web-client"
    );

    this.detector = new LivenessDetector(this.$refs.video, this.$refs.canvas, {
      challengeCount: 3,
      landmarker: {
        wasmBasePath: "/mediapipe/wasm",
        modelAssetPath: "/mediapipe/face_landmarker.task",
      },
    });

    this.unsub.push(
      this.detector.on("alignment", (a) => (this.hint = a.hint)),
      this.detector.on("challenge-start", (c) =>
        (this.hint = `Please ${c.challenge}`),
      ),
    );

    this.stream = await attachCamera(this.$refs.video);
    await this.detector.init();

    try {
      const payload = await this.detector.start();
      this.$emit("complete", payload);
    } catch (err) {
      this.$emit("failed", err);
    }
  },
  beforeDestroy() {
    this.unsub.forEach((off) => off());
    this.detector && this.detector.dispose();
    this.stream && this.stream.getTracks().forEach((t) => t.stop());
  },
};
</script>
```

Usage in a page:

```vue
<client-only>
  <LivenessCamera @complete="onPayload" @failed="onError" />
</client-only>
```

Serve the MediaPipe assets from `static/mediapipe/` (Nuxt 2 serves `static/` at the web root).

---

## Nuxt 4 / Vue 3 usage

Same core, Composition API. No changes to SDK business logic.

```vue
<!-- components/LivenessCamera.vue -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import {
  LivenessDetector,
  attachCamera,
  stopCamera,
  type LivenessSessionPayload,
} from "@netrilis/liveness-web-client";

const emit = defineEmits<{
  complete: [payload: LivenessSessionPayload];
  failed: [error: unknown];
}>();

const video = ref<HTMLVideoElement>();
const canvas = ref<HTMLCanvasElement>();
const hint = ref("");

let detector: LivenessDetector | null = null;
let stream: MediaStream | null = null;

onMounted(async () => {
  if (!video.value || !canvas.value) return;

  detector = new LivenessDetector(video.value, canvas.value, {
    challengeCount: 3,
    landmarker: {
      wasmBasePath: "/mediapipe/wasm",
      modelAssetPath: "/mediapipe/face_landmarker.task",
    },
  });

  detector.on("alignment", (a) => (hint.value = a.hint));
  detector.on("challenge-start", (c) => (hint.value = `Please ${c.challenge}`));

  stream = await attachCamera(video.value);
  await detector.init();

  try {
    emit("complete", await detector.start());
  } catch (err) {
    emit("failed", err);
  }
});

onBeforeUnmount(() => {
  detector?.dispose();
  stopCamera(stream);
});
</script>

<template>
  <div class="liveness">
    <video ref="video" autoplay playsinline muted></video>
    <canvas ref="canvas" style="display: none"></canvas>
    <p class="hint">{{ hint }}</p>
  </div>
</template>
```

In Nuxt 4, wrap in `<ClientOnly>` and place the MediaPipe assets in `public/mediapipe/`.

---

## How detection works

- **Blur** — the face crop is converted to grayscale and convolved with the 3×3 discrete Laplacian kernel `[[0,1,0],[1,-4,1],[0,1,0]]`; the **variance** of the response is the sharpness score. Below `thresholds.blurVariance` → rejected.
- **Lighting** — mean RGB brightness of the crop must fall within `[brightnessMin, brightnessMax]`.
- **Framing** — face bounding box (from normalized landmarks) must occupy `[faceScaleMin, faceScaleMax]` of the frame, be centered within `centerTolerance`, and sit fully inside the frame.
- **Challenges** — evaluated on MediaPipe blendshape coefficients (`eyeBlinkLeft/Right`, `mouthSmileLeft/Right`, `jawOpen`) and a nose-to-cheek horizontal ratio for head turns.

> **Mirroring:** if you display the video mirrored (common for selfie UIs) via CSS `transform: scaleX(-1)`, that is display-only — landmark coordinates and turn ratios are computed in raw (un-mirrored) space. If turn directions feel inverted for your users, swap `TURN_LEFT`/`TURN_RIGHT` in `challengePool` or adjust the ratio thresholds.

---

## API surface

- `new LivenessDetector(video, canvas, config?)`
- `detector.init(): Promise<void>` — load the model (call once).
- `detector.start(): Promise<LivenessSessionPayload>` — run a session.
- `detector.captureReference(): boolean` — manually trigger the reference capture (valid in the `aligned` phase; also skips an auto countdown). Returns whether it was accepted.
- `detector.beginChallenges(): boolean` — start the challenge flow when `autoStartChallenges: false` (valid after the reference is captured).
- `detector.isAligned(): boolean` — whether the face is aligned right now (use to enable a "Capture" button).
- `detector.abort(): void` — cancel a running session.
- `detector.dispose(): void` — release the model + listeners.
- `detector.on(event, handler): () => void`
- `detector.getPhase(): LivenessPhase`
- Helpers: `attachCamera`, `stopCamera`.
- Exposed primitives for testing/tuning: `laplacianVariance`, `meanBrightness`, `computeFaceBox`, `evaluateFraming`, `evaluateChallenge`, `pickRandomChallenges`, `noseCheekRatio`.

---

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm run dev         # watch build
```
