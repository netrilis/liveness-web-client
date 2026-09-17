/**
 * @netrilis/liveness-web-client
 *
 * Framework-agnostic client-side liveness detection SDK.
 * Import the core `LivenessDetector` and mount it on a <video> + <canvas>.
 */

export { LivenessDetector } from "./core/LivenessDetector.js";
export type { LivenessDetectorConfig } from "./core/LivenessDetector.js";

export { FaceLandmarkerService } from "./core/FaceLandmarkerService.js";
export type { FaceLandmarkerOptions } from "./core/FaceLandmarkerService.js";

export { attachCamera, stopCamera } from "./core/camera.js";
export type { CameraOptions } from "./core/camera.js";

export {
  DEFAULT_THRESHOLDS,
  CHALLENGE_THRESHOLDS,
  DEFAULT_CHALLENGE_POOL,
  DEFAULT_ASSETS,
} from "./core/constants.js";

// Quality primitives (exported for testing / advanced tuning).
export {
  blurVarianceFromRGBA,
  laplacianVariance,
  toGrayscale,
  meanBrightness,
  brightnessInRange,
  computeFaceBox,
  evaluateFraming,
} from "./core/quality/index.js";
export type { FaceBox, NormalizedLandmark, FramingResult } from "./core/quality/index.js";

// Challenge primitives.
export {
  evaluateChallenge,
  pickRandomChallenges,
  noseCheekRatio,
  blendshapesToRecord,
} from "./core/challenges/index.js";
export type { ChallengeInput } from "./core/challenges/index.js";

// Public data contracts.
export { LivenessError } from "./core/types.js";
export type {
  ChallengeType,
  CaptureMode,
  Blendshapes,
  QualityMetrics,
  LivenessEvent,
  LivenessSessionPayload,
  LivenessPhase,
  AlignmentState,
  LivenessErrorCode,
  LivenessEventMap,
  Unsubscribe,
} from "./core/types.js";
