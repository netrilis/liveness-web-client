import type { Blendshapes, ChallengeType } from "../types.js";
import type { NormalizedLandmark } from "../quality/framing.js";
import { CHALLENGE_THRESHOLDS, LANDMARK } from "../constants.js";

/**
 * Challenge evaluation against MediaPipe blendshape coefficients and landmark
 * geometry. Each evaluator is a pure predicate: given the current frame's
 * blendshapes + landmarks, has the gesture been performed?
 */

export interface ChallengeInput {
  blendshapes: Blendshapes;
  landmarks: NormalizedLandmark[];
}

export type ChallengeThresholds = typeof CHALLENGE_THRESHOLDS;

/** Convert MediaPipe categories array to a name->score record. */
export function blendshapesToRecord(
  categories: Array<{ categoryName?: string; displayName?: string; score: number }>,
): Blendshapes {
  const out: Blendshapes = {};
  for (const c of categories) {
    const key = c.categoryName || c.displayName;
    if (key) out[key] = c.score;
  }
  return out;
}

function bs(input: ChallengeInput, name: string): number {
  return input.blendshapes[name] ?? 0;
}

/**
 * Head-turn ratio in raw (un-mirrored) landmark space:
 * (nose.x - leftCheek.x) / (rightCheek.x - leftCheek.x); ~0.5 when centered.
 */
export function noseCheekRatio(landmarks: NormalizedLandmark[]): number | null {
  const nose = landmarks[LANDMARK.noseTip];
  const left = landmarks[LANDMARK.leftCheek];
  const right = landmarks[LANDMARK.rightCheek];
  if (!nose || !left || !right) return null;
  const span = right.x - left.x;
  if (Math.abs(span) < 1e-6) return null;
  return (nose.x - left.x) / span;
}

export type ChallengeEvaluator = (
  input: ChallengeInput,
  t: ChallengeThresholds,
) => boolean;

export const EVALUATORS: Record<ChallengeType, ChallengeEvaluator> = {
  BLINK: (input, t) =>
    bs(input, "eyeBlinkLeft") >= t.blinkClosed &&
    bs(input, "eyeBlinkRight") >= t.blinkClosed,

  SMILE: (input, t) =>
    (bs(input, "mouthSmileLeft") + bs(input, "mouthSmileRight")) / 2 >= t.smile,

  OPEN_MOUTH: (input, t) => bs(input, "jawOpen") >= t.jawOpen,

  TURN_RIGHT: (input, t) => {
    const ratio = noseCheekRatio(input.landmarks);
    return ratio !== null && ratio <= t.turnLeftMaxRatio;
  },

  TURN_LEFT: (input, t) => {
    const ratio = noseCheekRatio(input.landmarks);
    return ratio !== null && ratio >= t.turnRightMinRatio;
  },
};

export function evaluateChallenge(
  challenge: ChallengeType,
  input: ChallengeInput,
  thresholds: ChallengeThresholds = CHALLENGE_THRESHOLDS,
): boolean {
  return EVALUATORS[challenge](input, thresholds);
}

/** Fisher-Yates shuffle + slice to pick `count` distinct challenges. */
export function pickRandomChallenges(
  pool: ChallengeType[],
  count: number,
): ChallengeType[] {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, Math.min(count, arr.length));
}
