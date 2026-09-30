/**
 * Skill definitions, stored in the `skills` table when a session starts.
 * The rubric mirrors CHOPSTICK_RUBRIC in src/lib/chopstickFeatures.ts.
 */
export const CHOPSTICKS = {
  slug: "chopsticks",
  name: "Chopsticks",
  description: "Hold and use chopsticks with a steady bottom stick and a pencil-grip top stick.",
  steps: [
    { id: "pick-up", title: "Pick up the chopsticks" },
    { id: "grip", title: "Set up your grip" },
    { id: "motion", title: "Move only the top chopstick" },
    { id: "practice", title: "Practice" },
  ],
  rubric: {
    pivotRange: { good: 25, warn: 12, higherIsBetter: true },
    anchorMovement: { good: 10, warn: 20, higherIsBetter: false },
    isolation: { good: 70, warn: 55, higherIsBetter: true },
  },
};

/**
 * Plain-language name and practice drill for each fault the tracker detects,
 * used in the end-of-session recap ("focus for next time").
 */
export const FAULT_COACHING: Record<string, { label: string; tip: string }> = {
  anchor: {
    label: "Keeping the bottom chopstick still",
    tip: "Your ring finger kept moving the bottom stick. Drill: hold only the bottom chopstick — resting in the dip of your thumb and on the side of your ring finger — perfectly still for 5 seconds. Then add the top one like a pencil.",
  },
  wider: {
    label: "Opening the chopsticks wide enough",
    tip: "Straighten your pointer finger until the top tip lifts about an inch above the bottom tip, pause, then bend to close until the tips touch.",
  },
  isolate: {
    label: "Moving only your pointer and middle fingers",
    tip: "Rest your forearm on the table so your wrist can't help, then open and close using just your pointer and middle fingers.",
  },
  fist: {
    label: "Holding the chopsticks with your fingertips, not a fist",
    tip: "Pick up the bottom chopstick first and rest it in the dip of your thumb. Then hold the top one like a pencil, pinched between your thumb, pointer, and middle fingertips.",
  },
  loose: {
    label: "Pinching the top chopstick with your thumb",
    tip: "Press your thumb tip firmly against the top chopstick, with your pointer and middle fingertips on the other side.",
  },
  open: {
    label: "Curling your fingers around the chopsticks",
    tip: "Curl your fingers in so your thumb, pointer, and middle fingertips pinch the top chopstick.",
  },
  "two-hands": {
    label: "Using one hand",
    tip: "Hold both chopsticks in your writing hand only, and rest the other hand in your lap.",
  },
};
