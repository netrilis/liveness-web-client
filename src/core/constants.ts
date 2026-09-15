import type { ChallengeType } from "./types.js";

/**
 * Default, tunable thresholds. All are overridable via LivenessDetectorConfig.
 * Values chosen as conservative starting points; tune against real device data.
 */
export const DEFAULT_THRESHOLDS = {
  /** Laplacian variance below this => rejected as blurry. */
  blurVariance: 100,
  /** Mean brightness must fall within [min, max] (0..255). */
  brightnessMin: 40,
  brightnessMax: 210,
  /** Face bbox area as a fraction of the frame area. */
  faceScaleMin: 0.3,
  faceScaleMax: 0.6,
  /** Max allowed offset of the face center from frame center (fraction of dim). */
  centerTolerance: 0.15,
  /** Frames a quality-passing centered face must persist before reference capture. */
  alignmentStableFrames: 8,
} as const;

/** Blendshape / geometry thresholds for challenge pass detection. */
export const CHALLENGE_THRESHOLDS = {
  /** eyeBlinkLeft/Right score to consider an eye closed. */
  blinkClosed: 0.5,
  /** mouthSmileLeft/Right averaged score to consider a smile. */
  smile: 0.5,
  /** jawOpen score to consider the mouth open. */
  jawOpen: 0.45,
  /**
   * Nose-to-cheek horizontal ratio bounds for head turns.
   * ratio = (nose.x - leftCheek.x) / (rightCheek.x - leftCheek.x); ~0.5 centered.
   * Ratios are computed in raw (un-mirrored) landmark space.
   */
  turnLeftMaxRatio: 0.35,
  turnRightMinRatio: 0.65,
} as const;

export const DEFAULT_CHALLENGE_POOL: ChallengeType[] = [
  "BLINK",
  "SMILE",
  "OPEN_MOUTH",
  "TURN_LEFT",
  "TURN_RIGHT",
];

/** MediaPipe landmark indices (Face Mesh 468-point topology). */
export const LANDMARK = {
  noseTip: 1,
  leftCheek: 234, // subject's right side in un-mirrored image
  rightCheek: 454,
} as const;

/** Default hosted asset locations for @mediapipe/tasks-vision. */
export const DEFAULT_ASSETS = {
  wasmBasePath:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  faceLandmarkerModelUrl:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
} as const;
