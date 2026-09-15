import type { FaceBox } from "../quality/framing.js";

/**
 * DOM/canvas helpers. Kept separate so the pure quality math stays testable
 * without a browser.
 */

export interface Size {
  width: number;
  height: number;
}

/** The intrinsic pixel size of a playing <video> element. */
export function videoSize(video: HTMLVideoElement): Size {
  return { width: video.videoWidth, height: video.videoHeight };
}

/**
 * Draw the current video frame onto a canvas at the video's intrinsic size and
 * return its 2D context. The canvas is resized to match if needed.
 */
export function drawVideoToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const { width, height } = videoSize(video);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(video, 0, 0, width, height);
  return ctx;
}

/**
 * Extract RGBA ImageData for the face region described by a normalized bbox.
 * The box is expanded by `pad` (fraction of box size) and clamped to the frame.
 */
export function getFaceImageData(
  ctx: CanvasRenderingContext2D,
  box: FaceBox,
  frame: Size,
  pad = 0.1,
): ImageData {
  const padX = box.width * pad;
  const padY = box.height * pad;

  const x0 = Math.max(0, Math.floor((box.minX - padX) * frame.width));
  const y0 = Math.max(0, Math.floor((box.minY - padY) * frame.height));
  const x1 = Math.min(frame.width, Math.ceil((box.maxX + padX) * frame.width));
  const y1 = Math.min(frame.height, Math.ceil((box.maxY + padY) * frame.height));

  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return ctx.getImageData(x0, y0, w, h);
}

/** Encode the full canvas as a base64 data URL (default JPEG). */
export function snapshot(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.92,
): string {
  return canvas.toDataURL(type, quality);
}
