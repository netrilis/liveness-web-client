import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { DEFAULT_ASSETS } from "./constants.js";
import { LivenessError } from "./types.js";

export interface FaceLandmarkerOptions {
  /** Directory serving the tasks-vision wasm bundle. */
  wasmBasePath?: string;
  /** URL of the .task face_landmarker model. */
  modelAssetPath?: string;
  /** "GPU" (default) or "CPU". */
  delegate?: "GPU" | "CPU";
}

/**
 * Thin async wrapper around the MediaPipe FaceLandmarker configured for
 * VIDEO running mode with blendshape output enabled.
 */
export class FaceLandmarkerService {
  private landmarker: FaceLandmarker | null = null;

  async load(opts: FaceLandmarkerOptions = {}): Promise<void> {
    try {
      const resolver = await FilesetResolver.forVisionTasks(
        opts.wasmBasePath ?? DEFAULT_ASSETS.wasmBasePath,
      );
      this.landmarker = await FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath:
            opts.modelAssetPath ?? DEFAULT_ASSETS.faceLandmarkerModelUrl,
          delegate: opts.delegate ?? "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
    } catch (err) {
      throw new LivenessError(
        "MODEL_LOAD_FAILED",
        "Failed to initialize MediaPipe FaceLandmarker.",
        { cause: err },
      );
    }
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** Run detection for a single video frame at the given timestamp (ms). */
  detect(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult {
    if (!this.landmarker) {
      throw new LivenessError("NOT_STARTED", "FaceLandmarker not loaded.");
    }
    return this.landmarker.detectForVideo(video, timestampMs);
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
