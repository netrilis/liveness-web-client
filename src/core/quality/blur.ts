/**
 * Blur detection via Laplacian variance.
 *
 * We convert the (already-cropped) RGBA image data to a 1D grayscale byte
 * array, convolve it with the 3x3 discrete Laplacian kernel
 * [[0, 1, 0], [1, -4, 1], [0, 1, 0]], and return the variance of the response.
 * Sharp images produce high-variance edge responses; blurry images do not.
 */

/** Rec. 601 luma. Returns a Uint8-range grayscale array. */
export function toGrayscale(data: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    const r = data[i] ?? 0;
    const grn = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    gray[g] = 0.299 * r + 0.587 * grn + 0.114 * b;
  }
  return gray;
}

/**
 * Compute Laplacian-response variance for a grayscale buffer.
 * Border pixels are skipped (kernel does not fit).
 */
export function laplacianVariance(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;

  const n = (width - 2) * (height - 2);
  if (n <= 0) return 0;

  let sum = 0;
  let sumSq = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const center = gray[i] ?? 0;
      const up = gray[i - width] ?? 0;
      const down = gray[i + width] ?? 0;
      const left = gray[i - 1] ?? 0;
      const right = gray[i + 1] ?? 0;

      // [0 1 0; 1 -4 1; 0 1 0]
      const response = up + down + left + right - 4 * center;
      sum += response;
      sumSq += response * response;
    }
  }

  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Convenience: variance directly from RGBA ImageData bytes. */
export function blurVarianceFromRGBA(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  return laplacianVariance(toGrayscale(data), width, height);
}
