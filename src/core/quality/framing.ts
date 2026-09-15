/**
 * Face framing analysis from normalized [0..1] landmarks.
 * Produces a bounding box, its scale relative to the frame, centering offset,
 * and whether the face is fully inside the frame (no cut-off).
 */

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface FaceBox {
  /** All values normalized 0..1 relative to frame dimensions. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /** bbox area as a fraction of the frame area (0..1). */
  areaFraction: number;
}

export function computeFaceBox(landmarks: NormalizedLandmark[]): FaceBox | null {
  if (!landmarks || landmarks.length === 0) return null;

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    areaFraction: width * height,
  };
}

export interface FramingResult {
  scaleOk: boolean;
  centered: boolean;
  /** true if the whole bbox sits inside the frame with a small margin. */
  insideFrame: boolean;
  offsetX: number;
  offsetY: number;
}

export function evaluateFraming(
  box: FaceBox,
  opts: {
    faceScaleMin: number;
    faceScaleMax: number;
    centerTolerance: number;
    /** minimum normalized margin from each edge to count as not cut off. */
    edgeMargin?: number;
  },
): FramingResult {
  const edgeMargin = opts.edgeMargin ?? 0.02;

  const scaleOk =
    box.areaFraction >= opts.faceScaleMin &&
    box.areaFraction <= opts.faceScaleMax;

  const offsetX = Math.abs(box.centerX - 0.5);
  const offsetY = Math.abs(box.centerY - 0.5);
  const centered =
    offsetX <= opts.centerTolerance && offsetY <= opts.centerTolerance;

  const insideFrame =
    box.minX >= edgeMargin &&
    box.minY >= edgeMargin &&
    box.maxX <= 1 - edgeMargin &&
    box.maxY <= 1 - edgeMargin;

  return { scaleOk, centered, insideFrame, offsetX, offsetY };
}
