/**
 * Public data contracts for the liveness SDK.
 *
 * These types are intentionally framework-agnostic and describe the payload
 * the backend receives for validation (ID match + liveness proof).
 */

export type ChallengeType =
  | "BLINK"
  | "SMILE"
  | "OPEN_MOUTH"
  | "TURN_LEFT"
  | "TURN_RIGHT";

/** Normalized [0..1] blendshape coefficients keyed by MediaPipe category name. */
export type Blendshapes = Record<string, number>;

export interface QualityMetrics {
  /** Laplacian response variance of the face crop (higher = sharper). */
  blurVariance: number;
  /** Mean RGB brightness of the face crop, 0..255. */
  brightness: number;
}

export interface LivenessEvent {
  challenge: ChallengeType;
  /** epoch ms at the moment the challenge passed */
  timestamp: number;
  /** blendshape coefficients captured at the passing frame */
  blendshapes: Blendshapes;
  /** Base64 (data-URL) image snapshot at the moment of passing */
  frameSnapshot: string;
}

export interface LivenessSessionPayload {
  sessionId: string;
  clientTimestamp: number;
  /** Base64 JPEG captured immediately upon centering (neutral, eyes open). */
  referenceImage: string;
  qualityMetrics: QualityMetrics;
  livenessEvents: LivenessEvent[];
  telemetry: {
    userAgent: string;
    totalDurationMs: number;
  };
}

/** Coarse lifecycle phases the host UI can react to. */
export type LivenessPhase =
  | "idle"
  | "initializing"
  | "aligning" // waiting for a centered, quality-passing face
  | "reference-captured"
  | "challenge" // running an active challenge
  | "completed"
  | "error";

export interface AlignmentState {
  faceDetected: boolean;
  centered: boolean;
  scaleOk: boolean; // face occupies ~30-60% of frame
  qualityOk: boolean; // blur + lighting
  /** Human-readable hint for the current blocker, e.g. "Move closer". */
  hint: string;
  metrics: QualityMetrics;
}

export type LivenessErrorCode =
  | "CAMERA_UNAVAILABLE"
  | "MODEL_LOAD_FAILED"
  | "NOT_STARTED"
  | "ABORTED"
  | "TIMEOUT"
  | "UNKNOWN";

export class LivenessError extends Error {
  code: LivenessErrorCode;
  constructor(code: LivenessErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LivenessError";
    this.code = code;
  }
}

/** Event map emitted by {@link LivenessDetector}. */
export interface LivenessEventMap {
  phase: LivenessPhase;
  alignment: AlignmentState;
  "reference-captured": { image: string; metrics: QualityMetrics };
  "challenge-start": { challenge: ChallengeType; index: number; total: number };
  "challenge-pass": LivenessEvent;
  completed: LivenessSessionPayload;
  error: LivenessError;
}

export type Unsubscribe = () => void;
