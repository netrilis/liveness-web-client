import { LivenessError } from "./types.js";

export interface CameraOptions {
  facingMode?: "user" | "environment";
  width?: number;
  height?: number;
}

/**
 * Convenience helper: request the camera and attach the stream to a video
 * element, resolving once metadata is loaded and the element is playing.
 * Optional — hosts may manage getUserMedia themselves.
 */
export async function attachCamera(
  video: HTMLVideoElement,
  opts: CameraOptions = {},
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new LivenessError(
      "CAMERA_UNAVAILABLE",
      "getUserMedia is not supported in this environment.",
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: opts.facingMode ?? "user",
        width: { ideal: opts.width ?? 1280 },
        height: { ideal: opts.height ?? 720 },
      },
    });
  } catch (err) {
    throw new LivenessError(
      "CAMERA_UNAVAILABLE",
      "Camera permission denied or no device available.",
      { cause: err },
    );
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;

  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.addEventListener("loadeddata", () => resolve(), { once: true });
  });
  await video.play().catch(() => {
    /* autoplay may be resumed by a user gesture; loop tolerates not-yet-playing */
  });

  return stream;
}

/** Stop all tracks of a stream (call on teardown). */
export function stopCamera(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
