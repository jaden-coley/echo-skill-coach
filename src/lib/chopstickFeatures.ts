import type {
  HandLandmarkerResult,
  Landmark,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { OneEuroFilter } from "./oneEuroFilter";

/*
 * Chopstick feature engine: turns raw hand landmarks into measured technique
 * numbers. Correct technique: the bottom stick rests still against the ring
 * finger, and only the top stick moves, driven by the index + middle fingers
 * like a pen. So we measure
 *   - grip shape:      pencil-style grip vs. a fist ("popsicle") or open hand
 *   - pivot range:     how much the index/middle fingers bend and straighten
 *   - anchor movement: how much the ring finger (bottom stick) bends
 *   - isolation:       how much of the bending comes from the pivot fingers
 *
 * Everything is a finger *bend angle* computed from MediaPipe's 3D world
 * landmarks. Angles use the whole finger chain rather than just the tip, so
 * they hold up when a chopstick hides a fingertip, and they don't change
 * with camera distance, hand position, or rotation.
 */

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const MIDDLE_MCP = 9;

// Joint chains per finger: knuckle → middle joint → top joint → tip.
const INDEX = [5, 6, 7, 8];
const MIDDLE = [9, 10, 11, 12];
const RING = [13, 14, 15, 16];
// Where the thumb presses the top stick in a pencil grip.
const PENCIL_CONTACTS = [6, 7, 10, 11];

const WINDOW_MS = 1500;
const MIN_SAMPLES = 12;
const HAND_LOST_MS = 400;
// A palm that suddenly changes size by more than this is a mis-tracked frame
// (usually the sticks hiding fingers), not the hand actually moving. Judged
// against the median of recent frames, so glitches can never become the
// baseline, and a hand that really moves closer is followed within a few
// frames.
const PALM_GLITCH_RATIO = 0.35;
const PALM_HISTORY = 15;
const MIN_PALM_HISTORY = 5;
// Below this pivot range (degrees), the user isn't really working the sticks.
const ACTIVE_PIVOT_RANGE = 8;

// Grip-shape thresholds (average index+middle bend, degrees; thumb gap in
// palm lengths). Provisional — tune against real attempts.
const FIST_BEND = 160;
const OPEN_BEND = 35;
const PENCIL_THUMB_GAP = 0.6;

export type MetricStatus = "good" | "warn" | "bad" | "neutral";

export interface MetricReading {
  value: number;
  status: MetricStatus;
}

/**
 *   pencil: thumb pinching against index/middle, fingers partly bent — correct
 *   fist:   every finger curled tight around the sticks ("popsicle" grip)
 *   open:   fingers straight, nothing being held
 *   loose:  somewhere in between — no clear grip
 */
export type GripShape = "pencil" | "fist" | "open" | "loose";

export interface ChopstickMetrics {
  /** How far the index + middle fingers bend open/closed, degrees. */
  pivotRange: MetricReading;
  /** How far the ring finger (bottom-stick anchor) bends, degrees. */
  anchorMovement: MetricReading;
  /** Share of bending that comes from the pivot fingers, %. */
  isolation: MetricReading;
}

export interface ChopstickSnapshot {
  state: "no-hand" | "warming-up" | "idle" | "active";
  /** Share of recent frames with a usable hand, 0–100. */
  trackingQuality: number;
  /** More than one hand has been in view for most of the window. */
  twoHands: boolean;
  /** The grip shape seen most often in the window. */
  grip: GripShape | null;
  metrics: ChopstickMetrics | null;
  /** Raw grip readings, for the details panel and threshold tuning. */
  debug: { pivotBend: number; anchorBend: number; thumbGap: number } | null;
}

/**
 * Pass/warn thresholds per metric. Provisional — tune against real attempts.
 * Will move into the Convex skills/rubrics table.
 */
export const CHOPSTICK_RUBRIC = {
  pivotRange: { good: 25, warn: 12, higherIsBetter: true },
  anchorMovement: { good: 10, warn: 20, higherIsBetter: false },
  isolation: { good: 70, warn: 55, higherIsBetter: true },
} as const;

type Vec3 = { x: number; y: number; z: number };
type Sample = {
  time: number;
  pivotBend: number;
  anchorBend: number;
  thumbGap: number;
  grip: GripShape;
};

export class ChopstickAnalyzer {
  private pointFilters = Array.from(
    { length: 21 * 2 },
    () => new OneEuroFilter(1.2, 8),
  );
  private pivotFilter = new OneEuroFilter(1.5, 0.02);
  private anchorFilter = new OneEuroFilter(1.5, 0.02);
  private samples: Sample[] = [];
  private frames: { time: number; usable: boolean; hands: number }[] = [];
  private palmHistory: number[] = [];
  private lastHandTime = -Infinity;

  /**
   * Feeds one video frame. Returns smoothed landmarks for each hand to draw
   * (the analyzed hand first), or an empty list when there's no usable hand.
   */
  update(
    result: HandLandmarkerResult,
    time: number,
    aspectRatio: number,
  ): NormalizedLandmark[][] {
    const [landmarks, ...otherHands] = result.landmarks;
    const worldLandmarks = result.worldLandmarks[0];
    const usable =
      landmarks && worldLandmarks ? this.accept(landmarks, aspectRatio) : false;
    this.frames.push({ time, usable, hands: result.landmarks.length });
    if (!landmarks || !worldLandmarks || !usable) return [];

    // After a dropout, start the filters fresh instead of gliding across the gap.
    if (time - this.lastHandTime > HAND_LOST_MS) {
      this.pointFilters.forEach((f) => f.reset());
      this.pivotFilter.reset();
      this.anchorFilter.reset();
    }
    this.lastHandTime = time;

    const rawPivot =
      (fingerBend(worldLandmarks, INDEX) + fingerBend(worldLandmarks, MIDDLE)) / 2;
    const rawAnchor = fingerBend(worldLandmarks, RING);
    const thumbGap = thumbToPencilContact(worldLandmarks);

    this.samples.push({
      time,
      pivotBend: this.pivotFilter.filter(rawPivot, time),
      anchorBend: this.anchorFilter.filter(rawAnchor, time),
      thumbGap,
      grip: classifyGrip(rawPivot, rawAnchor, thumbGap),
    });

    const smoothed = landmarks.map((point, i) => ({
      ...point,
      x: this.pointFilters[i * 2].filter(point.x, time),
      y: this.pointFilters[i * 2 + 1].filter(point.y, time),
    }));
    return [smoothed, ...otherHands];
  }

  snapshot(now: number): ChopstickSnapshot {
    const cutoff = now - WINDOW_MS;
    this.samples = this.samples.filter((s) => s.time >= cutoff);
    this.frames = this.frames.filter((f) => f.time >= cutoff);

    const trackingQuality = this.frames.length
      ? Math.round(
          (100 * this.frames.filter((f) => f.usable).length) / this.frames.length,
        )
      : 0;
    const twoHands =
      this.frames.filter((f) => f.hands >= 2).length > this.frames.length / 2;
    const empty = { trackingQuality, twoHands, grip: null, metrics: null, debug: null };

    if (now - this.lastHandTime > HAND_LOST_MS) {
      return { state: "no-hand", ...empty };
    }
    if (this.samples.length < MIN_SAMPLES) {
      return { state: "warming-up", ...empty };
    }

    const pivotRange = spread(this.samples.map((s) => s.pivotBend));
    const anchorMovement = spread(this.samples.map((s) => s.anchorBend));
    const isolation =
      (100 * pivotRange) / Math.max(pivotRange + anchorMovement, 1e-6);
    const active = pivotRange >= ACTIVE_PIVOT_RANGE;
    const latest = this.samples[this.samples.length - 1];

    return {
      state: active ? "active" : "idle",
      trackingQuality,
      twoHands,
      grip: mostCommon(this.samples.map((s) => s.grip)),
      metrics: {
        pivotRange: grade("pivotRange", pivotRange),
        anchorMovement: grade("anchorMovement", anchorMovement),
        // Isolation is meaningless when nothing is moving.
        isolation: active
          ? grade("isolation", isolation)
          : { value: isolation, status: "neutral" },
      },
      debug: {
        pivotBend: latest.pivotBend,
        anchorBend: latest.anchorBend,
        thumbGap: latest.thumbGap,
      },
    };
  }

  private accept(landmarks: NormalizedLandmark[], aspectRatio: number) {
    const wrist = landmarks[WRIST];
    const knuckle = landmarks[MIDDLE_MCP];
    const palm = Math.hypot((wrist.x - knuckle.x) * aspectRatio, wrist.y - knuckle.y);

    this.palmHistory.push(palm);
    if (this.palmHistory.length > PALM_HISTORY) this.palmHistory.shift();
    if (this.palmHistory.length < MIN_PALM_HISTORY) return true;

    const typical = percentile(this.palmHistory, 0.5);
    return Math.abs(palm / typical - 1) <= PALM_GLITCH_RATIO;
  }
}

function classifyGrip(pivotBend: number, anchorBend: number, thumbGap: number): GripShape {
  if (pivotBend >= FIST_BEND) return "fist";
  if (pivotBend <= OPEN_BEND && anchorBend <= OPEN_BEND) return "open";
  if (thumbGap <= PENCIL_THUMB_GAP) return "pencil";
  return "loose";
}

function grade(metric: keyof typeof CHOPSTICK_RUBRIC, value: number): MetricReading {
  const { good, warn, higherIsBetter } = CHOPSTICK_RUBRIC[metric];
  const beats = (threshold: number) =>
    higherIsBetter ? value >= threshold : value <= threshold;
  return { value, status: beats(good) ? "good" : beats(warn) ? "warn" : "bad" };
}

/**
 * Total bend of a finger in degrees: the sum of how far each joint (knuckle,
 * middle, top) deviates from straight. 0 = fully straight.
 */
function fingerBend(points: Landmark[], chain: number[]) {
  const [mcp, pip, dip, tip] = chain.map((i) => points[i]);
  return (
    jointBend(points[WRIST], mcp, pip) +
    jointBend(mcp, pip, dip) +
    jointBend(pip, dip, tip)
  );
}

/** Degrees the segment b→c turns away from the straight line a→b. */
function jointBend(a: Vec3, b: Vec3, c: Vec3) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const cos =
    (u.x * v.x + u.y * v.y + u.z * v.z) /
    (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Thumb tip's distance to the nearest pencil-grip contact, in palm lengths. */
function thumbToPencilContact(points: Landmark[]) {
  const palm = distance3(points[WRIST], points[MIDDLE_MCP]) || 1;
  const thumb = points[THUMB_TIP];
  return Math.min(...PENCIL_CONTACTS.map((i) => distance3(thumb, points[i]))) / palm;
}

function distance3(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** p90 − p10: the working range of a signal, ignoring outlier frames. */
function spread(values: number[]) {
  return percentile(values, 0.9) - percentile(values, 0.1);
}

function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  )[0];
}
