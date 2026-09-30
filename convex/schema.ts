import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/*
 * E.C.H.O. data model. A learner practices a skill in sessions; everything
 * the coach does during a session is recorded against it:
 *   stepEvents     – lesson steps passed / sent back
 *   checks         – AI vision verdicts, with the measured numbers at that moment
 *   corrections    – every correction shown, from the tracker or the AI
 *   metricSamples  – the measured technique over time
 * Sessions carry denormalized counters so the dashboard never has to count rows.
 */

export const metricsValidator = v.object({
  pivotRange: v.number(),
  anchorMovement: v.number(),
  isolation: v.number(),
});

export const gripValidator = v.union(
  v.literal("pencil"),
  v.literal("fist"),
  v.literal("open"),
  v.literal("loose"),
);

export default defineSchema({
  skills: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    steps: v.array(v.object({ id: v.string(), title: v.string() })),
    // Pass/warn thresholds for each measured metric.
    rubric: v.record(
      v.string(),
      v.object({ good: v.number(), warn: v.number(), higherIsBetter: v.boolean() }),
    ),
  }).index("by_slug", ["slug"]),

  sessions: defineTable({
    // Who practiced: the anonymous per-device key always, plus the signed-in
    // account (Convex tokenIdentifier) once the learner signs in. Signing in
    // claims the device's earlier sessions, so progress follows the account.
    learnerKey: v.string(),
    userToken: v.optional(v.string()),
    skillId: v.id("skills"),
    status: v.union(v.literal("active"), v.literal("ended")),
    endedAt: v.optional(v.number()),
    currentStep: v.number(),
    highestStep: v.number(),
    checksPassed: v.number(),
    checksFailed: v.number(),
    correctionsShown: v.number(),
    activeSeconds: v.number(),
    bestIsolation: v.optional(v.number()),
    lastMetrics: v.optional(metricsValidator),
  })
    .index("by_learnerKey", ["learnerKey"])
    .index("by_userToken", ["userToken"]),

  stepEvents: defineTable({
    sessionId: v.id("sessions"),
    step: v.number(),
    kind: v.union(v.literal("passed"), v.literal("sent-back")),
  }).index("by_sessionId", ["sessionId"]),

  checks: defineTable({
    sessionId: v.id("sessions"),
    step: v.number(),
    check: v.union(v.literal("holding"), v.literal("grip")),
    pass: v.boolean(),
    issue: v.string(),
    correction: v.string(),
    confidence: v.number(),
    // What the hand tracker measured when the frame was sent.
    gripShape: v.optional(gripValidator),
    metrics: v.optional(metricsValidator),
    latencyMs: v.number(),
  }).index("by_sessionId", ["sessionId"]),

  corrections: defineTable({
    sessionId: v.id("sessions"),
    step: v.number(),
    source: v.union(v.literal("tracker"), v.literal("ai")),
    faultId: v.string(),
    message: v.string(),
  }).index("by_sessionId", ["sessionId"]),

  metricSamples: defineTable({
    sessionId: v.id("sessions"),
    step: v.number(),
    metrics: metricsValidator,
    grip: v.optional(gripValidator),
  }).index("by_sessionId", ["sessionId"]),
});
