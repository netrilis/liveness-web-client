# TASK PROMPT: Web Client Liveness Detection SDK Module

## 1. Project Overview & Target Architecture
I need to build an isolated, standalone client-side Liveness Detection Web SDK module written in **TypeScript / ESM**. 
- **Current Integration:** Must be usable in a legacy **Nuxt 2 (Vue 2)** project via an imperative JS class/wrapper.
- **Future Integration:** Must seamlessly port to **Nuxt 4 / Vue 3** without modifying core SDK business logic.
- **Architectural Requirement:** Keep the core SDK framework-agnostic (pure TypeScript + DOM APIs). Vue/Nuxt dynamic wrappers or plugins will simply mount the core class onto a HTML `<video>` and `<canvas>` element.

---

## 2. Core Functional Requirements

### A. Immediate Centered Reference Capture
- Upon starting the liveness flow, the SDK must continuously evaluate face bounding boxes.
- As soon as the face is centered, properly scaled (occupies ~30%–60% of frame), and satisfies quality thresholds (lighting + blur), the SDK **immediately captures the High-Res Reference Photo** (intended for backend ID matching against a driver's license).
- Capture must occur *before* active challenges begin to ensure a neutral face with open eyes.

### B. Image Quality Checks (Client-Side Pre-filtering)
Implement pre-capture image filtering on the canvas stream:
1. **Blur Checking (Laplacian Variance):** Convert the face crop to a 1D grayscale byte array, apply a 3x3 discrete Laplacian operator kernel (`[0, 1, 0], [1, -4, 1], [0, 1, 0]`), and compute the variance of the response values. If `variance < THRESHOLD` (e.g., 100), reject frame as blurry.
2. **Lighting Check:** Calculate average RGB pixel brightness (ensure it's within a 40–210 range).
3. **Face Bounding Box:** Check framing boundaries to prevent cut-offs.

### C. Active Challenge & Gesture Verification
- Use `@mediapipe/tasks-vision` (`FaceLandmarker` with `outputFaceBlendshapes: true`).
- Support randomized dynamic challenges: `BLINK`, `SMILE`, `OPEN_MOUTH`, and `TURN_LEFT/RIGHT`.
- Challenge evaluation must run against normalized **Blendshape Coefficients** (`eyeBlinkLeft`/`Right`, `mouthSmileLeft`/`Right`, `jawOpen`) and nose-to-cheek $X$-ratio bounding for head turns.

### D. Final Output Payload Schema
The SDK must resolve/emit a structured JSON object containing all session evidence for backend validation:

```typescript
interface LivenessSessionPayload {
  sessionId: string;
  clientTimestamp: number;
  referenceImage: string; // Base64 JPEG captured *immediately* upon centering
  qualityMetrics: {
    blurVariance: number;
    brightness: number;
  };
  livenessEvents: Array<{
    challenge: 'BLINK' | 'SMILE' | 'OPEN_MOUTH' | 'TURN_LEFT' | 'TURN_RIGHT';
    timestamp: number;
    blendshapes: Record<string, number>;
    frameSnapshot: string; // Base64 image snapshot at moment of passing
  }>;
  telemetry: {
    userAgent: string;
    totalDurationMs: number;
  };
}
