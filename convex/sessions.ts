import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { gripValidator, metricsValidator } from "./schema";
import { viewerSessions } from "./progress";
import { queueRecap } from "./recap";
import { CHOPSTICKS } from "./skills";
import { summarizeStruggles } from "./struggles";

/*
 * Session lifecycle + everything the coach records while a learner practices.
 * A session belongs to the device that started it (learnerKey) and, once
 * signed in, to the account (userToken, derived server-side from the auth
 * token — never taken from arguments). Every function checks ownership, so
 * one learner can't read or write another's sessions by guessing an id.
 */

const sessionArgs = { sessionId: v.id("sessions"), learnerKey: v.string() };

async function viewerToken(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? null;
}

async function ownedSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
  learnerKey: string,
) {
  const session = await ctx.db.get("sessions", sessionId);
  const token = await viewerToken(ctx);
  const owns =
    session &&
    (session.userToken
      ? session.userToken === token
      : session.learnerKey === learnerKey);
  if (!session || !owns) {
    throw new Error("Session not found");
  }
  return session;
}

async function ensureChopsticksSkill(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", CHOPSTICKS.slug))
    .unique();
  if (existing) {
    // Keep the stored definition in sync with the code.
    await ctx.db.patch("skills", existing._id, CHOPSTICKS);
    return existing._id;
  }
  return await ctx.db.insert("skills", CHOPSTICKS);
}

export const start = mutation({
  args: { learnerKey: v.string(), tzOffsetMinutes: v.optional(v.number()) },
  returns: v.id("sessions"),
  handler: async (ctx, { learnerKey, tzOffsetMinutes }) => {
    const skillId = await ensureChopsticksSkill(ctx);
    const userToken = (await viewerToken(ctx)) ?? undefined;

    // One live session per learner: close any left open (e.g. a closed tab).
    const recent = await ctx.db
      .query("sessions")
      .withIndex("by_learnerKey", (q) => q.eq("learnerKey", learnerKey))
      .order("desc")
      .take(5);
    for (const session of recent) {
      if (session.status === "active") {
        await ctx.db.patch("sessions", session._id, {
          status: "ended",
          endedAt: Date.now(),
        });
      }
    }

    return await ctx.db.insert("sessions", {
      learnerKey,
      userToken,
      tzOffsetMinutes,
      skillId,
      status: "active",
      currentStep: 1,
      highestStep: 1,
      checksPassed: 0,
      checksFailed: 0,
      correctionsShown: 0,
      activeSeconds: 0,
    });
  },
});

export const end = mutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, { sessionId, learnerKey }) => {
    const session = await ownedSession(ctx, sessionId, learnerKey);
    if (session.status === "active") {
      await ctx.db.patch("sessions", sessionId, { status: "ended", endedAt: Date.now() });
      // Signed-in learners get a recap email, queued in this same transaction.
      if (session.userToken) await queueRecap(ctx, session);
    }
    return null;
  },
});

export const recordStep = mutation({
  args: {
    ...sessionArgs,
    step: v.number(),
    kind: v.union(v.literal("passed"), v.literal("sent-back")),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, learnerKey, step, kind }) => {
    const session = await ownedSession(ctx, sessionId, learnerKey);
    await ctx.db.insert("stepEvents", { sessionId, step, kind });
    const currentStep = kind === "passed" ? step + 1 : step;
    await ctx.db.patch("sessions", sessionId, {
      currentStep,
      highestStep: Math.max(session.highestStep, currentStep),
    });
    return null;
  },
});

export const recordCheck = mutation({
  args: {
    ...sessionArgs,
    step: v.number(),
    check: v.union(v.literal("holding"), v.literal("grip"), v.literal("motion")),
    pass: v.boolean(),
    issue: v.string(),
    correction: v.string(),
    confidence: v.number(),
    gripShape: v.optional(gripValidator),
    metrics: v.optional(metricsValidator),
    latencyMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { learnerKey, ...check }) => {
    const session = await ownedSession(ctx, check.sessionId, learnerKey);
    await ctx.db.insert("checks", check);
    await ctx.db.patch(
      "sessions",
      check.sessionId,
      check.pass
        ? { checksPassed: session.checksPassed + 1 }
        : { checksFailed: session.checksFailed + 1 },
    );
    return null;
  },
});

export const recordCorrection = mutation({
  args: {
    ...sessionArgs,
    step: v.number(),
    source: v.union(v.literal("tracker"), v.literal("ai")),
    faultId: v.string(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { learnerKey, ...correction }) => {
    const session = await ownedSession(ctx, correction.sessionId, learnerKey);
    await ctx.db.insert("corrections", correction);
    await ctx.db.patch("sessions", correction.sessionId, {
      correctionsShown: session.correctionsShown + 1,
    });
    return null;
  },
});

export const recordSample = mutation({
  args: {
    ...sessionArgs,
    step: v.number(),
    metrics: metricsValidator,
    grip: v.optional(gripValidator),
    // Seconds of active practice since the previous sample.
    activeSeconds: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, learnerKey, step, metrics, grip, activeSeconds }) => {
    const session = await ownedSession(ctx, sessionId, learnerKey);
    await ctx.db.insert("metricSamples", { sessionId, step, metrics, grip });
    // A personal best has to be *sustained*: it counts the lower of this and
    // the previous reading (~4 s apart), so a one-frame spike can't set it.
    const sustained = Math.min(metrics.isolation, session.lastMetrics?.isolation ?? 0);
    await ctx.db.patch("sessions", sessionId, {
      lastMetrics: metrics,
      activeSeconds: session.activeSeconds + Math.max(0, Math.min(activeSeconds, 10)),
      bestIsolation: Math.max(session.bestIsolation ?? 0, sustained),
    });
    return null;
  },
});

/** Everything the live dashboard shows for one session. */
export const get = query({
  args: sessionArgs,
  handler: async (ctx, { sessionId, learnerKey }) => {
    const session = await ownedSession(ctx, sessionId, learnerKey);
    const skill = await ctx.db.get("skills", session.skillId);
    const [stepEvents, checks, corrections, samples] = await Promise.all([
      ctx.db
        .query("stepEvents")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .take(50),
      ctx.db
        .query("checks")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .take(20),
      ctx.db
        .query("corrections")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .take(300),
      ctx.db
        .query("metricSamples")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .take(120),
    ]);

    return {
      session,
      skill,
      stepEvents: stepEvents.reverse(),
      checks,
      corrections: corrections.slice(0, 20),
      struggles: summarizeStruggles(corrections).slice(0, 3),
      // Oldest first, for charting.
      samples: samples.reverse(),
    };
  },
});

/**
 * The viewer's recent sessions, newest first: the account's sessions from any
 * device when signed in, otherwise this device's unclaimed sessions.
 */
export const listForLearner = query({
  args: { learnerKey: v.string() },
  handler: async (ctx, { learnerKey }) => viewerSessions(ctx, learnerKey, 20),
});

/**
 * On sign-in, attach this device's earlier (anonymous) sessions to the
 * account, so practice done before signing up isn't lost.
 */
export const claimDeviceSessions = mutation({
  args: { learnerKey: v.string() },
  returns: v.number(),
  handler: async (ctx, { learnerKey }) => {
    const token = await viewerToken(ctx);
    if (!token) throw new Error("Sign in to save your progress");

    const deviceSessions = await ctx.db
      .query("sessions")
      .withIndex("by_learnerKey", (q) => q.eq("learnerKey", learnerKey))
      .take(100);
    let claimed = 0;
    for (const session of deviceSessions) {
      if (!session.userToken) {
        await ctx.db.patch("sessions", session._id, { userToken: token });
        claimed++;
      }
    }
    return claimed;
  },
});
