import OpenAI from "openai";

/*
 * Vision gate for the chopstick lesson. The in-browser hand tracker sees the
 * hand but not the chopsticks, so before a step passes, one webcam frame is
 * checked here for what landmarks can't prove: are there really chopsticks,
 * in one hand, held the right way? Returns structured JSON, not prose.
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const MAX_IMAGE_BYTES = 2_000_000;

type Check = "holding" | "grip";

const CRITERIA: Record<Check, string> = {
  holding: `PASS only if you can clearly see TWO chopsticks held in ONE hand.
FAIL if: no chopsticks are visible; the hand is empty; only one chopstick is
visible; or the chopsticks are held with two hands.`,
  grip: `The correct beginner grip:
- Bottom chopstick rests in the dip between thumb and index finger, and is
  supported by the side of the ring finger near its tip.
- Top chopstick is held like a pencil, pinched between the tips of the
  thumb, index, and middle fingers.
- The tips of the two chopsticks are roughly even.
PASS if the grip is mostly right — this is a beginner, so small imperfections
are fine. FAIL if the chopsticks are gripped in a fist (like a popsicle),
held like a single stick, crossed into an X, clearly uneven, or not visible.`,
};

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    chopsticks_visible: {
      type: "integer",
      description: "How many chopsticks are visible in the frame (0, 1, or 2).",
    },
    hands_holding: {
      type: "integer",
      description: "How many hands are holding chopsticks (0, 1, or 2).",
    },
    pass: { type: "boolean" },
    issue: {
      type: "string",
      description:
        'Short label for the main problem, e.g. "fist grip", "no chopsticks", "two hands", "crossed tips". Empty string if pass.',
    },
    correction: {
      type: "string",
      description:
        "One literal instruction for a complete beginner, in second person, max 30 words. Say exactly which finger goes where. If pass, a short encouraging line.",
    },
    confidence: {
      type: "number",
      description: "0–1 confidence in the verdict given the image quality.",
    },
  },
  required: [
    "chopsticks_visible",
    "hands_holding",
    "pass",
    "issue",
    "correction",
    "confidence",
  ],
} as const;

export interface CheckResult {
  pass: boolean;
  issue: string;
  correction: string;
  confidence: number;
  chopsticksVisible: number;
  handsHolding: number;
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set in .env.local" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    check?: string;
    image?: string;
    gripShape?: string;
  } | null;

  const check = body?.check;
  const image = body?.image;
  if (check !== "holding" && check !== "grip") {
    return Response.json({ error: "check must be 'holding' or 'grip'" }, { status: 400 });
  }
  if (
    typeof image !== "string" ||
    !image.startsWith("data:image/jpeg;base64,") ||
    image.length > MAX_IMAGE_BYTES
  ) {
    return Response.json({ error: "image must be a JPEG data URL under 2MB" }, { status: 400 });
  }

  const client = new OpenAI();
  try {
    const response = await client.responses.create({
      model: MODEL,
      reasoning: { effort: "low" },
      instructions: `You are E.C.H.O., a patient chopstick coach for complete beginners.
You are shown one webcam frame of a learner. The camera is not mirrored.
Judge ONLY what you can actually see; if the chopsticks or fingers aren't
visible enough to judge, fail and tell them how to hold their hand so the
camera can see it.`,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Check: ${check}\n${CRITERIA[check]}${
                body?.gripShape
                  ? `\n\nFor context, the hand-landmark tracker classifies the hand shape as: "${body.gripShape}".`
                  : ""
              }`,
            },
            { type: "input_image", image_url: image, detail: "low" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "chopstick_check",
          schema: RESULT_SCHEMA,
          strict: true,
        },
      },
    });

    const raw = JSON.parse(response.output_text) as {
      chopsticks_visible: number;
      hands_holding: number;
      pass: boolean;
      issue: string;
      correction: string;
      confidence: number;
    };

    // The hard facts gate the verdict, not just the model's own "pass".
    const factsOk =
      raw.chopsticks_visible === 2 && raw.hands_holding === 1 && raw.confidence >= 0.5;

    const pass = raw.pass && factsOk;
    const result: CheckResult = {
      pass,
      issue: raw.issue,
      // If the model said "pass" but the facts overruled it, its encouraging
      // line would contradict the verdict — replace it with the actual fix.
      correction: raw.pass && !pass ? factsCorrection(raw) : raw.correction,
      confidence: raw.confidence,
      chopsticksVisible: raw.chopsticks_visible,
      handsHolding: raw.hands_holding,
    };
    return Response.json(result);
  } catch (error) {
    console.error("Chopstick check failed", error);
    return Response.json({ error: "Vision check failed" }, { status: 502 });
  }
}

function factsCorrection(raw: {
  chopsticks_visible: number;
  hands_holding: number;
}) {
  if (raw.hands_holding >= 2) {
    return "Use just one hand — your writing hand — and put the other one down.";
  }
  if (raw.chopsticks_visible < 2) {
    return "I can't see both chopsticks. Turn your hand sideways so the camera can see both sticks clearly.";
  }
  return "Hold still for a second, a little closer to the camera, so I can see your grip clearly.";
}
