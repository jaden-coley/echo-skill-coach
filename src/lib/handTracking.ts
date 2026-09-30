import type {
  HandLandmarker,
  HandLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// Keep the WASM runtime in lockstep with the installed JS package — a
// mismatched runtime fails at load time with an opaque error.
const TASKS_VISION_VERSION = "1.0.1";
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type { HandLandmarker, HandLandmarkerResult, NormalizedLandmark };

/**
 * Loads the MediaPipe hand landmarker. The library is imported dynamically so
 * its ~1MB bundle is only fetched once the user actually turns on the camera.
 */
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker } = await import(
    "@mediapipe/tasks-vision"
  );
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

  const options = {
    runningMode: "VIDEO" as const,
    // Track two so we can catch a beginner using both hands; only one is
    // analyzed.
    numHands: 2,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
    });
  } catch {
    // Some browsers/devices lack WebGL2 support for the GPU delegate.
    return HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
    });
  }
}

// Pairs of landmark indices forming the hand skeleton (wrist → each finger,
// plus the palm knuckle line). Mirrors HandLandmarker.HAND_CONNECTIONS, kept
// local so drawing doesn't depend on the lazily loaded module.
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

/** Draws each hand's skeleton onto a canvas sized to the video. */
export function drawHands(
  context: CanvasRenderingContext2D,
  hands: NormalizedLandmark[][],
) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);

  // Scale strokes with the video resolution so the overlay reads the same
  // at 480p and 1080p.
  const unit = Math.max(width, height) / 640;

  for (const hand of hands) {
    context.strokeStyle = "rgba(52, 211, 153, 0.9)";
    context.lineWidth = 3 * unit;
    context.lineCap = "round";
    context.beginPath();
    for (const [start, end] of HAND_CONNECTIONS) {
      context.moveTo(hand[start].x * width, hand[start].y * height);
      context.lineTo(hand[end].x * width, hand[end].y * height);
    }
    context.stroke();

    hand.forEach((point, index) => {
      context.fillStyle = FINGERTIPS.has(index) ? "#f472b6" : "#ffffff";
      context.beginPath();
      context.arc(
        point.x * width,
        point.y * height,
        (FINGERTIPS.has(index) ? 5 : 3.5) * unit,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
  }
}
