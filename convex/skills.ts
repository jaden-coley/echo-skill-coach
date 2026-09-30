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
