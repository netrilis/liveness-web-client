import { Emitter } from "./emitter.js";
import { FaceLandmarkerService, type FaceLandmarkerOptions } from "./FaceLandmarkerService.js";
import {
  CHALLENGE_THRESHOLDS,
  DEFAULT_CHALLENGE_POOL,
  DEFAULT_THRESHOLDS,
} from "./constants.js";
import {
  blendshapesToRecord,
  evaluateChallenge,
  pickRandomChallenges,
} from "./challenges/index.js";
import {
  blurVarianceFromRGBA,
  brightnessInRange,
  computeFaceBox,
  evaluateFraming,
  meanBrightness,
  type NormalizedLandmark,
} from "./quality/index.js";
import {
  drawVideoToCanvas,
  getFaceImageData,
  snapshot,
  videoSize,
} from "./utils/canvas.js";
import { createSessionId } from "./utils/id.js";
import {
  LivenessError,
  type AlignmentState,
  type CaptureMode,
  type ChallengeType,
  type LivenessEvent,
  type LivenessEventMap,
  type LivenessPhase,
  type LivenessSessionPayload,
  type QualityMetrics,
  type Unsubscribe,
} from "./types.js";

export interface LivenessDetectorConfig {
  /** How many randomized challenges to run (from the pool). Default 3. */
  challengeCount?: number;
  /** Pool of allowed challenges. Default: all five. */
  challengePool?: ChallengeType[];
  /** Quality / framing thresholds (partial override of defaults). */
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  /** Challenge blendshape/geometry thresholds (partial override). */
  challengeThresholds?: Partial<typeof CHALLENGE_THRESHOLDS>;
  /** MediaPipe asset locations / delegate. */
  landmarker?: FaceLandmarkerOptions;
  /** Overall session timeout in ms (0 = disabled). Default 60000. */
  timeoutMs?: number;
  /** Reference image encoding. */
  referenceImage?: { type?: string; quality?: number };
  /**
   * Controls when the reference photo is taken once alignment is stable —
   * so the capture isn't sudden and the user can prepare.
   */
  referenceCapture?: {
    /**
     * "auto" (default): capture automatically after `delayMs`.
     * "manual": wait until {@link LivenessDetector.captureReference} is called.
     */
    mode?: CaptureMode;
    /**
     * Grace period (ms) between reaching stable alignment and the auto capture,
     * surfaced via `align-ready` + `capture-countdown` events so the UI can show
     * a countdown. Default 0 (immediate). Ignored in "manual" mode except that
     * a manual capture is still only accepted once alignment is stable.
     */
    delayMs?: number;
    /**
     * When true (default), losing alignment during the delay cancels it and
     * returns to aligning. When false, the countdown proceeds regardless.
     */
    requireHold?: boolean;
  };
  /**
   * When true (default), challenges start automatically after the reference is
   * captured. When false, the detector enters `awaiting-challenge-start` and
   * waits for {@link LivenessDetector.beginChallenges} — letting the user start
   * the challenge flow when ready.
   */
  autoStartChallenges?: boolean;
}

/**
 * Framework-agnostic liveness detection engine.
 *
 * Lifecycle: construct with a <video> + <canvas>, `await init()`, then
 * `start()`. The detector drives an rAF loop: it aligns the face, captures the
 * reference photo (immediately, after a countdown, or on a manual trigger —
 * see `referenceCapture`), runs the randomized challenge sequence (auto or
 * gated behind {@link beginChallenges}), and resolves a
 * {@link LivenessSessionPayload}.
 *
 * The host is responsible for acquiring the camera stream and assigning it to
 * the video element (see README). This keeps the core free of any UI concern.
 */
export class LivenessDetector {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly emitter = new Emitter<LivenessEventMap>();
  private readonly service = new FaceLandmarkerService();

  private readonly thresholds: typeof DEFAULT_THRESHOLDS;
  private readonly challengeThresholds: typeof CHALLENGE_THRESHOLDS;
  private readonly config: Required<Pick<
    LivenessDetectorConfig,
    "challengeCount" | "challengePool" | "timeoutMs" | "autoStartChallenges"
  >> & {
    referenceImage: { type: string; quality: number };
    capture: { mode: CaptureMode; delayMs: number; requireHold: boolean };
  };

  private phase: LivenessPhase = "idle";
  private rafId: number | null = null;
  private lastVideoTime = -1;

  // session state
  private sessionId = "";
  private startedAt = 0;
  private stableFrames = 0;
  /** performance.now() when the "aligned" phase was entered (capture gating). */
  private alignedAt = 0;
  /** Whether the current frame still satisfies alignment (manual-capture gate). */
  private currentlyAligned = false;
  /** Metrics from the most recent alignment evaluation (used at capture time). */
  private lastAlignmentMetrics: QualityMetrics = { blurVariance: 0, brightness: 0 };
  private referenceImage = "";
  private referenceMetrics: QualityMetrics = { blurVariance: 0, brightness: 0 };
  private challengeQueue: ChallengeType[] = [];
  private currentChallengeIndex = 0;
  private readonly events: LivenessEvent[] = [];
  private resolveSession: ((p: LivenessSessionPayload) => void) | null = null;
  private rejectSession: ((e: LivenessError) => void) | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    config: LivenessDetectorConfig = {},
  ) {
    this.video = video;
    this.canvas = canvas;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    this.challengeThresholds = {
      ...CHALLENGE_THRESHOLDS,
      ...config.challengeThresholds,
    };
    this.config = {
      challengeCount: config.challengeCount ?? 3,
      challengePool: config.challengePool ?? DEFAULT_CHALLENGE_POOL,
      timeoutMs: config.timeoutMs ?? 60_000,
      autoStartChallenges: config.autoStartChallenges ?? true,
      referenceImage: {
        type: config.referenceImage?.type ?? "image/jpeg",
        quality: config.referenceImage?.quality ?? 0.92,
      },
      capture: {
        mode: config.referenceCapture?.mode ?? "auto",
        delayMs: Math.max(0, config.referenceCapture?.delayMs ?? 0),
        requireHold: config.referenceCapture?.requireHold ?? true,
      },
    };
    this.landmarkerOptions = config.landmarker;
  }

  private landmarkerOptions?: FaceLandmarkerOptions;

  /** Subscribe to a lifecycle event. Returns an unsubscribe function. */
  on<K extends keyof LivenessEventMap>(
    event: K,
    handler: (payload: LivenessEventMap[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  getPhase(): LivenessPhase {
    return this.phase;
  }

  /** Load the MediaPipe model. Call once before {@link start}. */
  async init(): Promise<void> {
    this.setPhase("initializing");
    await this.service.load(this.landmarkerOptions);
  }

  /**
   * Begin a liveness session. Resolves with the evidence payload when all
   * challenges pass, or rejects with a {@link LivenessError}.
   */
  start(): Promise<LivenessSessionPayload> {
    const activePhases: LivenessPhase[] = [
      "aligning",
      "aligned",
      "reference-captured",
      "awaiting-challenge-start",
      "challenge",
    ];
    if (activePhases.includes(this.phase)) {
      return Promise.reject(
        new LivenessError("UNKNOWN", "A session is already running."),
      );
    }
    if (!this.service.ready) {
      return Promise.reject(
        new LivenessError("NOT_STARTED", "Call init() before start()."),
      );
    }

    this.resetSessionState();
    this.sessionId = createSessionId();
    this.startedAt = Date.now();
    this.challengeQueue = pickRandomChallenges(
      this.config.challengePool,
      this.config.challengeCount,
    );
    this.setPhase("aligning");

    if (this.config.timeoutMs > 0) {
      this.timeoutHandle = setTimeout(() => {
        this.fail(
          new LivenessError("TIMEOUT", "Liveness session timed out."),
        );
      }, this.config.timeoutMs);
    }

    const promise = new Promise<LivenessSessionPayload>((resolve, reject) => {
      this.resolveSession = resolve;
      this.rejectSession = reject;
    });

    this.loop();
    return promise;
  }

  /** Abort a running session and stop the loop. */
  abort(): void {
    if (this.phase === "completed" || this.phase === "error") return;
    this.fail(new LivenessError("ABORTED", "Liveness session aborted."));
  }

  /** Release the model and all listeners. */
  dispose(): void {
    this.stopLoop();
    this.clearTimeout();
    this.service.close();
    this.emitter.clear();
    this.setPhase("idle");
  }

  // ---- internals -------------------------------------------------------

  private resetSessionState(): void {
    this.stableFrames = 0;
    this.alignedAt = 0;
    this.currentlyAligned = false;
    this.lastAlignmentMetrics = { blurVariance: 0, brightness: 0 };
    this.referenceImage = "";
    this.referenceMetrics = { blurVariance: 0, brightness: 0 };
    this.currentChallengeIndex = 0;
    this.events.length = 0;
    this.lastVideoTime = -1;
  }

  private setPhase(phase: LivenessPhase): void {
    this.phase = phase;
    this.emitter.emit("phase", phase);
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    // Only process new frames.
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) {
      return;
    }
    this.lastVideoTime = this.video.currentTime;

    try {
      this.processFrame();
    } catch (err) {
      this.fail(
        err instanceof LivenessError
          ? err
          : new LivenessError("UNKNOWN", "Frame processing failed.", {
              cause: err,
            }),
      );
    }
  };

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private processFrame(): void {
    const nowMs = performance.now();
    const result = this.service.detect(this.video, nowMs);

    const landmarks = (result.faceLandmarks?.[0] ?? []) as NormalizedLandmark[];
    const blendshapes = result.faceBlendshapes?.[0]?.categories
      ? blendshapesToRecord(result.faceBlendshapes[0].categories)
      : {};

    const ctx = drawVideoToCanvas(this.video, this.canvas);
    const frame = videoSize(this.video);

    if (this.phase === "aligning") {
      this.handleAligning(ctx, frame, landmarks);
    } else if (this.phase === "aligned") {
      this.handleAligned(ctx, frame, landmarks);
    } else if (this.phase === "challenge") {
      this.handleChallenge(landmarks, blendshapes);
    }
  }

  /**
   * Evaluate framing + quality for the current frame, emit an `alignment`
   * event, and report whether the face is fully aligned along with its metrics.
   */
  private computeAlignment(
    ctx: CanvasRenderingContext2D,
    frame: { width: number; height: number },
    landmarks: NormalizedLandmark[],
  ): { aligned: boolean; metrics: QualityMetrics } {
    const box = computeFaceBox(landmarks);

    if (!box) {
      const metrics: QualityMetrics = { blurVariance: 0, brightness: 0 };
      this.emitAlignment({
        faceDetected: false,
        centered: false,
        scaleOk: false,
        qualityOk: false,
        hint: "Position your face in the frame",
        metrics,
      });
      return { aligned: false, metrics };
    }

    const framing = evaluateFraming(box, this.thresholds);
    const faceData = getFaceImageData(ctx, box, frame);
    const blurVariance = blurVarianceFromRGBA(
      faceData.data,
      faceData.width,
      faceData.height,
    );
    const brightness = meanBrightness(faceData.data);
    const metrics: QualityMetrics = { blurVariance, brightness };

    const brightOk = brightnessInRange(
      brightness,
      this.thresholds.brightnessMin,
      this.thresholds.brightnessMax,
    );
    const sharpOk = blurVariance >= this.thresholds.blurVariance;
    const qualityOk = brightOk && sharpOk;

    const hint = this.alignmentHint(box, framing, brightOk, sharpOk);
    const aligned =
      framing.scaleOk && framing.centered && framing.insideFrame && qualityOk;

    this.emitAlignment({
      faceDetected: true,
      centered: framing.centered,
      scaleOk: framing.scaleOk,
      qualityOk,
      hint,
      metrics,
    });

    return { aligned, metrics };
  }

  private handleAligning(
    ctx: CanvasRenderingContext2D,
    frame: { width: number; height: number },
    landmarks: NormalizedLandmark[],
  ): void {
    const { aligned, metrics } = this.computeAlignment(ctx, frame, landmarks);
    this.lastAlignmentMetrics = metrics;
    this.currentlyAligned = aligned;

    if (aligned) {
      this.stableFrames++;
      if (this.stableFrames >= this.thresholds.alignmentStableFrames) {
        this.enterAligned();
      }
    } else {
      this.stableFrames = 0;
    }
  }

  /** Stable alignment reached: begin the capture delay or await a manual trigger. */
  private enterAligned(): void {
    this.alignedAt = performance.now();
    this.setPhase("aligned");
    this.emitter.emit("align-ready", {
      mode: this.config.capture.mode,
      delayMs: this.config.capture.delayMs,
    });
  }

  /**
   * "aligned" phase: keep verifying the face is still aligned, then either
   * count down to an auto capture or wait for a manual `captureReference()`.
   */
  private handleAligned(
    ctx: CanvasRenderingContext2D,
    frame: { width: number; height: number },
    landmarks: NormalizedLandmark[],
  ): void {
    const { aligned, metrics } = this.computeAlignment(ctx, frame, landmarks);
    this.lastAlignmentMetrics = metrics;
    this.currentlyAligned = aligned;

    // Lost alignment while holding -> restart the align/hold cycle.
    if (!aligned && this.config.capture.requireHold) {
      this.stableFrames = 0;
      this.setPhase("aligning");
      return;
    }

    if (this.config.capture.mode === "manual") {
      // Host drives capture via captureReference(); nothing to do here.
      return;
    }

    const remainingMs = Math.max(
      0,
      this.config.capture.delayMs - (performance.now() - this.alignedAt),
    );
    this.emitter.emit("capture-countdown", {
      remainingMs,
      totalMs: this.config.capture.delayMs,
    });
    if (remainingMs <= 0) {
      this.doCaptureReference(metrics);
    }
  }

  private alignmentHint(
    box: { areaFraction: number },
    framing: { scaleOk: boolean; centered: boolean; insideFrame: boolean },
    brightOk: boolean,
    sharpOk: boolean,
  ): string {
    if (!framing.insideFrame) return "Keep your whole face in frame";
    if (!framing.scaleOk) {
      return box.areaFraction < this.thresholds.faceScaleMin
        ? "Move closer"
        : "Move back";
    }
    if (!framing.centered) return "Center your face";
    if (!brightOk) return "Adjust lighting";
    if (!sharpOk) return "Hold still";
    return "Hold steady";
  }

  private emitAlignment(state: AlignmentState): void {
    this.emitter.emit("alignment", state);
  }

  private doCaptureReference(metrics: QualityMetrics): void {
    this.referenceImage = snapshot(
      this.canvas,
      this.config.referenceImage.type,
      this.config.referenceImage.quality,
    );
    this.referenceMetrics = metrics;
    this.setPhase("reference-captured");
    this.emitter.emit("reference-captured", {
      image: this.referenceImage,
      metrics,
    });

    if (this.config.autoStartChallenges) {
      this.beginChallenges();
    } else {
      this.setPhase("awaiting-challenge-start");
      this.emitter.emit("awaiting-challenge-start", {
        challenges: [...this.challengeQueue],
      });
    }
  }

  /**
   * Trigger the reference capture manually. Valid only while in the `aligned`
   * phase (works in both "auto" and "manual" modes, e.g. to skip a countdown).
   * Returns false if not currently ready — when `requireHold` is set, the face
   * must still be aligned at the moment of the call.
   *
   * @returns whether the capture was accepted.
   */
  captureReference(): boolean {
    if (this.phase !== "aligned") return false;
    if (this.config.capture.requireHold && !this.currentlyAligned) return false;
    this.doCaptureReference(this.lastAlignmentMetrics);
    return true;
  }

  /**
   * Begin the challenge sequence. Called automatically when
   * `autoStartChallenges` is true; otherwise the host calls this once the user
   * is ready (valid in the `reference-captured` / `awaiting-challenge-start`
   * phases).
   *
   * @returns whether the challenge flow was started.
   */
  beginChallenges(): boolean {
    if (
      this.phase !== "reference-captured" &&
      this.phase !== "awaiting-challenge-start"
    ) {
      return false;
    }
    this.currentChallengeIndex = 0;
    this.setPhase("challenge");
    this.announceChallenge();
    return true;
  }

  /** Whether the face is currently aligned (useful to gate a "Capture" button). */
  isAligned(): boolean {
    return this.currentlyAligned;
  }

  private announceChallenge(): void {
    const challenge = this.challengeQueue[this.currentChallengeIndex];
    if (!challenge) return;
    this.emitter.emit("challenge-start", {
      challenge,
      index: this.currentChallengeIndex,
      total: this.challengeQueue.length,
    });
  }

  private handleChallenge(
    landmarks: NormalizedLandmark[],
    blendshapes: Record<string, number>,
  ): void {
    const challenge = this.challengeQueue[this.currentChallengeIndex];
    if (!challenge) return;
    if (landmarks.length === 0) return;

    const passed = evaluateChallenge(
      challenge,
      { blendshapes, landmarks },
      this.challengeThresholds,
    );
    if (!passed) return;

    const event: LivenessEvent = {
      challenge,
      timestamp: Date.now(),
      blendshapes,
      frameSnapshot: snapshot(this.canvas, "image/jpeg", 0.8),
    };
    this.events.push(event);
    this.emitter.emit("challenge-pass", event);

    this.currentChallengeIndex++;
    if (this.currentChallengeIndex >= this.challengeQueue.length) {
      this.complete();
    } else {
      this.announceChallenge();
    }
  }

  private complete(): void {
    this.stopLoop();
    this.clearTimeout();
    const payload: LivenessSessionPayload = {
      sessionId: this.sessionId,
      clientTimestamp: this.startedAt,
      referenceImage: this.referenceImage,
      qualityMetrics: this.referenceMetrics,
      livenessEvents: [...this.events],
      telemetry: {
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
        totalDurationMs: Date.now() - this.startedAt,
      },
    };
    this.setPhase("completed");
    this.emitter.emit("completed", payload);
    this.resolveSession?.(payload);
    this.resolveSession = null;
    this.rejectSession = null;
  }

  private fail(error: LivenessError): void {
    this.stopLoop();
    this.clearTimeout();
    this.setPhase("error");
    this.emitter.emit("error", error);
    this.rejectSession?.(error);
    this.resolveSession = null;
    this.rejectSession = null;
  }
}
