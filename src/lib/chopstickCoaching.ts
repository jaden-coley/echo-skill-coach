import type {
  ChopstickMetrics,
  ChopstickSnapshot,
  GripShape,
} from "./chopstickFeatures";

/*
 * Guided chopstick lesson. Walks a complete beginner through one step at a
 * time, and uses the measured snapshot to decide (a) when a step is done and
 * (b) which single, literal correction to show. The user never has to read
 * the numbers.
 *
 * The hand tracker can't see the chopsticks themselves, so steps that depend
 * on them end with a vision check: once the hand looks right, one frame goes
 * to the AI coach, and the step only passes if it confirms.
 */

export type VisionCheck = "holding" | "grip";

export interface VisionVerdict {
  pass: boolean;
  issue: string;
  correction: string;
  confidence: number;
}

/** Resolves to the AI's verdict, or null if the AI coach is unreachable. */
export type Verifier = (
  check: VisionCheck,
  gripShape: GripShape | null,
) => Promise<VisionVerdict | null>;

/** Everything worth recording about a lesson, as it happens. */
export type LessonEvent =
  | { type: "step"; step: number; kind: "passed" | "sent-back" }
  | {
      type: "check";
      step: number;
      check: VisionCheck;
      verdict: VisionVerdict;
      gripShape: GripShape | null;
      metrics: ChopstickMetrics | null;
      latencyMs: number;
    }
  | {
      type: "correction";
      step: number;
      source: "tracker" | "ai";
      faultId: string;
      message: string;
    };

export interface Feedback {
  id: string;
  tone: "good" | "fix" | "info";
  message: string;
}

export interface LessonView {
  step: number;
  totalSteps: number;
  title: string;
  instructions: string[];
  feedback: Feedback | null;
  /** 0–1 progress toward passing the current step; null on the last step. */
  progress: number | null;
}

type StepId = "pick-up" | "grip" | "motion" | "practice";

const STEPS: {
  id: StepId;
  title: string;
  instructions: string[];
  holdMs: number;
  verify?: VisionCheck;
  // Good time adds up across brief slips instead of restarting from zero —
  // for motion, where one noisy moment shouldn't erase real progress.
  cumulative?: boolean;
}[] = [
  {
    id: "pick-up",
    title: "Pick up the chopsticks",
    instructions: [
      "Pick up both chopsticks with your writing hand only.",
      "Put your other hand down in your lap, out of the camera's view.",
      "Hold your chopstick hand up, turned sideways, so the camera can see both sticks.",
    ],
    holdMs: 1500,
    verify: "holding",
  },
  {
    id: "grip",
    title: "Set up your grip",
    instructions: [
      "Bottom chopstick: lay it in the dip between your thumb and pointer finger.",
      "Let the lower part rest against the side of your ring finger, near the fingertip. This chopstick never moves.",
      "Top chopstick: hold it like a pencil — pinch it with the tips of your thumb, pointer finger, and middle finger.",
      "Line up the two tips so they're even.",
    ],
    holdMs: 2000,
    verify: "grip",
  },
  {
    id: "motion",
    title: "Move only the top chopstick",
    instructions: [
      "To close: bend your pointer and middle fingers down until the top tip touches the bottom tip.",
      "To open: straighten those two fingers back up.",
      "Your thumb, ring finger, and the bottom chopstick stay completely still.",
      "Go slowly — open, close, open, close.",
    ],
    holdMs: 4000,
    cumulative: true,
  },
  {
    id: "practice",
    title: "Practice",
    instructions: [
      "Keep opening and closing slowly.",
      "Only the top chopstick moves. The bottom one stays still.",
    ],
    holdMs: Infinity,
  },
];

const FEEDBACK = {
  noHand: {
    id: "no-hand",
    tone: "info",
    message: "I can't see your hand. Hold it up in front of the camera, about an arm's length away.",
  },
  twoHands: {
    id: "two-hands",
    tone: "fix",
    message: "I see two hands. Use just one — your writing hand — and put the other one down.",
  },
  reading: {
    id: "reading",
    tone: "info",
    message: "Hold still for a second while I read your hand…",
  },
  fist: {
    id: "fist",
    tone: "fix",
    message:
      "Your hand is closed in a fist, like holding a popsicle. Loosen up: hold the top chopstick like a pencil, with just your fingertips.",
  },
  open: {
    id: "open",
    tone: "fix",
    message:
      "Your fingers are straight, so nothing is holding the chopsticks. Curl them in so your thumb, pointer, and middle fingertips pinch the top stick.",
  },
  loose: {
    id: "loose",
    tone: "fix",
    message:
      "Bring your thumb tip in so it presses the top chopstick against your pointer and middle fingers.",
  },
  still: {
    id: "still",
    tone: "info",
    message:
      "Nothing is moving yet. Slowly bend your pointer and middle fingers to close the tips, then straighten them to open.",
  },
  anchor: {
    id: "anchor",
    tone: "fix",
    message:
      "Your ring finger is moving too, which moves the bottom chopstick. Press the bottom stick into the dip of your thumb and keep your ring finger frozen.",
  },
  wider: {
    id: "wider",
    tone: "fix",
    message:
      "Open a little wider — straighten your pointer and middle fingers more before closing again.",
  },
  isolate: {
    id: "isolate",
    tone: "fix",
    message: "Let only your pointer and middle fingers do the work. Keep the rest of your hand still.",
  },
  pickUpGood: {
    id: "pick-up-good",
    tone: "good",
    message: "Good — one hand. Hold it there…",
  },
  checking: {
    id: "checking",
    tone: "info",
    message: "Hold still — checking your chopsticks…",
  },
  aiUnavailable: {
    id: "ai-unavailable",
    tone: "info",
    message:
      "I can't reach the AI coach right now, so I can't confirm your chopsticks yet. Retrying in a few seconds…",
  },
  gripGood: {
    id: "grip-good",
    tone: "good",
    message: "That's the grip. Hold it there…",
  },
  motionGood: {
    id: "motion-good",
    tone: "good",
    message: "That's it — only the top chopstick is moving. Keep going.",
  },
} satisfies Record<string, Feedback>;

// A grip that falls apart this long during the motion steps sends the user
// back to the grip step.
const REGRESS_MS = 1500;
// After the AI rejects a step, the next check waits until its correction has
// been on screen long enough to read, plus this long to actually adjust.
const ADJUST_MS = 3000;
const AI_PRAISE_MS = 6000;

type Verdict = ({ stepIndex: number } & VisionVerdict) | "unavailable";

export class ChopstickLesson {
  private stepIndex = 0;
  private passingSince: number | null = null;
  private goodMs = 0;
  private lastUpdate: number | null = null;
  private failingSince: number | null = null;
  private feedback = new FeedbackStabilizer();
  private checking = false;
  private verdict: Verdict | null = null;
  private recheckAt = 0;
  // The AI's latest message: a correction stays until the step changes or
  // the next verdict; praise fades after a few seconds.
  private aiFeedback: Feedback | null = null;
  private aiFeedbackUntil = 0;
  private aiMessages = 0;
  private lastShownId: string | null = null;

  constructor(
    private readonly verify: Verifier,
    private readonly onEvent: (event: LessonEvent) => void = () => {},
  ) {}

  update(snapshot: ChopstickSnapshot, now: number): LessonView {
    const step = STEPS[this.stepIndex];
    const fault = findFault(snapshot, step.id);

    this.applyVerdict(now);

    // Cap each frame gap so a stalled tab can't bank a big chunk of "good" time.
    const dt = this.lastUpdate === null ? 0 : Math.min(now - this.lastUpdate, 300);
    this.lastUpdate = now;

    // Advance once the step's goal has held steadily (and, for steps the
    // tracker can't fully judge, the AI coach has confirmed it).
    if (!fault) {
      this.passingSince ??= now;
      this.goodMs += dt;
      const held = step.cumulative
        ? this.goodMs >= step.holdMs
        : now - this.passingSince >= step.holdMs;
      if (held && this.stepIndex < STEPS.length - 1) {
        if (!step.verify) {
          this.goTo(this.stepIndex + 1);
        } else if (!this.checking && now >= this.recheckAt) {
          this.startCheck(step.verify, snapshot);
        }
      }
    } else {
      this.passingSince = null;
    }

    // Fall back to the grip step if the grip itself breaks down mid-motion.
    const gripBroken = fault?.id === "fist" || fault?.id === "open";
    if (this.stepIndex >= 2 && gripBroken) {
      this.failingSince ??= now;
      if (now - this.failingSince >= REGRESS_MS) {
        this.goTo(1);
      }
    } else {
      this.failingSince = null;
    }

    if (now > this.aiFeedbackUntil) this.aiFeedback = null;

    const current = STEPS[this.stepIndex];
    const message =
      fault ??
      (this.checking ? FEEDBACK.checking : null) ??
      this.aiFeedback ??
      praise(current.id);

    const shown = this.feedback.update(message, now);
    if (shown.id !== this.lastShownId) {
      this.lastShownId = shown.id;
      if (shown.tone === "fix") {
        this.onEvent({
          type: "correction",
          step: this.stepIndex + 1,
          source: shown.id.startsWith("ai-") ? "ai" : "tracker",
          faultId: shown.id,
          message: shown.message,
        });
      }
    }

    return {
      step: this.stepIndex + 1,
      totalSteps: STEPS.length,
      title: current.title,
      instructions: current.instructions,
      feedback: shown,
      progress: this.progress(now),
    };
  }

  private progress(now: number) {
    const step = STEPS[this.stepIndex];
    if (!Number.isFinite(step.holdMs)) return null;
    const held = step.cumulative
      ? this.goodMs
      : this.passingSince === null
        ? 0
        : now - this.passingSince;
    return Math.min(1, held / step.holdMs);
  }

  private startCheck(check: VisionCheck, snapshot: ChopstickSnapshot) {
    const stepIndex = this.stepIndex;
    const startedAt = performance.now();
    this.checking = true;
    this.verify(check, snapshot.grip)
      .then((result) => {
        this.verdict = result ? { stepIndex, ...result } : "unavailable";
        if (result) {
          this.onEvent({
            type: "check",
            step: stepIndex + 1,
            check,
            verdict: result,
            gripShape: snapshot.grip,
            metrics: snapshot.metrics,
            latencyMs: Math.round(performance.now() - startedAt),
          });
        }
      })
      .catch(() => {
        this.verdict = "unavailable";
      })
      .finally(() => {
        this.checking = false;
      });
  }

  private applyVerdict(now: number) {
    const verdict = this.verdict;
    if (!verdict) return;
    this.verdict = null;

    // Never pass a step the AI couldn't confirm — the hand tracker alone
    // would hand out passes to an empty hand. Retry instead.
    if (verdict === "unavailable") {
      this.passingSince = null;
      this.recheckAt = now + minimumShowMs(FEEDBACK.aiUnavailable) + ADJUST_MS;
      this.aiFeedback = FEEDBACK.aiUnavailable;
      this.aiFeedbackUntil = this.recheckAt;
      return;
    }
    // Ignore a verdict for a step the user has already left.
    if (verdict.stepIndex !== this.stepIndex) return;

    const feedback: Feedback = {
      id: `ai-${verdict.issue || "check"}-${++this.aiMessages}`,
      tone: verdict.pass ? "good" : "fix",
      message: verdict.correction,
    };
    if (verdict.pass) {
      this.goTo(this.stepIndex + 1);
    } else {
      // Make them hold the corrected position again before the next check.
      this.passingSince = null;
      this.recheckAt = now + minimumShowMs(feedback) + ADJUST_MS;
    }
    this.aiFeedback = feedback;
    this.aiFeedbackUntil = verdict.pass ? now + AI_PRAISE_MS : Infinity;
  }

  private goTo(stepIndex: number) {
    const from = this.stepIndex;
    this.stepIndex = Math.min(stepIndex, STEPS.length - 1);
    if (this.stepIndex > from) {
      this.onEvent({ type: "step", step: from + 1, kind: "passed" });
    } else if (this.stepIndex < from) {
      this.onEvent({ type: "step", step: this.stepIndex + 1, kind: "sent-back" });
    }
    // A new step starts with a clean slate — no lingering message from the
    // step the user just left.
    this.feedback.reset();
    this.passingSince = null;
    this.goodMs = 0;
    this.failingSince = null;
    this.aiFeedback = null;
  }
}

/** The single most important problem for this step, or null if it's going well. */
function findFault(snapshot: ChopstickSnapshot, step: StepId): Feedback | null {
  const { state, twoHands, grip, metrics } = snapshot;
  if (state === "no-hand") return FEEDBACK.noHand;
  if (twoHands) return FEEDBACK.twoHands;
  if (state === "warming-up" || !metrics) return FEEDBACK.reading;
  if (step === "pick-up") return null;

  if (grip === "fist") return FEEDBACK.fist;
  if (grip === "open") return FEEDBACK.open;
  if (grip === "loose") return FEEDBACK.loose;
  if (step === "grip") return null;

  if (state === "idle") return FEEDBACK.still;
  // Only blame the ring finger when it moves *more* than the pivot fingers —
  // a ring finger hidden under the bottom stick gets estimated with a lot of
  // sympathetic motion even when the user is doing it right.
  if (metrics.anchorMovement.status !== "good" && metrics.isolation.value < 50) {
    return FEEDBACK.anchor;
  }
  if (metrics.pivotRange.status !== "good") return FEEDBACK.wider;
  if (metrics.isolation.status === "bad") return FEEDBACK.isolate;
  return null;
}

function praise(step: StepId): Feedback {
  if (step === "pick-up") return FEEDBACK.pickUpGood;
  if (step === "grip") return FEEDBACK.gripGood;
  return FEEDBACK.motionGood;
}

// A replacement message has to persist this long before it's shown, so a
// metric hovering around a threshold doesn't cause flicker.
const CANDIDATE_MS = 700;

/**
 * The pace should feel calm, not stressful. Corrections stay on screen long
 * enough to read them slowly *and* try the fix (6–12 s); praise lingers long
 * enough to enjoy (5 s). Status messages don't hold — once "I can't see your
 * hand" is no longer true, it shouldn't linger.
 */
export function minimumShowMs(feedback: Feedback) {
  if (feedback.tone === "good") return 5000;
  if (feedback.tone !== "fix") return 0;
  const words = feedback.message.split(/\s+/).length;
  return Math.min(12000, Math.max(6000, 4000 + words * 450));
}

class FeedbackStabilizer {
  private current: Feedback | null = null;
  private shownAt = 0;
  private candidate: Feedback | null = null;
  private candidateSince = 0;

  reset() {
    this.current = null;
    this.candidate = null;
  }

  update(next: Feedback, now: number): Feedback {
    if (!this.current || next.id === this.current.id) {
      if (!this.current) this.shownAt = now;
      this.current = next;
      this.candidate = null;
      return next;
    }

    if (next.id !== this.candidate?.id) {
      this.candidate = next;
      this.candidateSince = now;
    }

    const readLongEnough = now - this.shownAt >= minimumShowMs(this.current);
    const candidateSettled = now - this.candidateSince >= CANDIDATE_MS;
    if (readLongEnough && candidateSettled) {
      this.current = next;
      this.shownAt = now;
      this.candidate = null;
    }
    return this.current;
  }
}
