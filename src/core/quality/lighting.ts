/**
 * Lighting check: mean RGB brightness of an RGBA buffer, 0..255.
 * Callers compare against a [min, max] window (default 40..210) to reject
 * frames that are too dark or blown out.
 */
export function meanBrightness(data: Uint8ClampedArray): number {
  if (data.length === 0) return 0;
  let sum = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    sum += (r + g + b) / 3;
  }
  return sum / pixels;
}

export function brightnessInRange(
  brightness: number,
  min: number,
  max: number,
): boolean {
  return brightness >= min && brightness <= max;
}
