import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

/*
 * Long-term motivation: practice streaks and personal bests.
 *   streak       — consecutive local calendar days with real practice
 *   personal best — best *sustained* finger control (see recordSample)
 * Days are computed in the learner's own time zone, captured per session,
 * so practicing at 11pm counts for that evening.
 */

// A session counts toward a streak only with real practice in it.
const STREAK_MIN_ACTIVE_SECONDS = 20;

export function qualifiesForStreak(session: Doc<"sessions">) {
  return session.activeSeconds >= STREAK_MIN_ACTIVE_SECONDS || session.checksPassed > 0;
}

/** Local calendar day ("YYYY-MM-DD") of a timestamp, given getTimezoneOffset(). */
export function localDay(timestamp: number, tzOffsetMinutes = 0) {
  return new Date(timestamp - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Consecutive practice days ending today — or ending yesterday, since a
 * streak isn't broken until a whole day passes without practice.
 */
export function computeStreak(
  sessions: Doc<"sessions">[],
  today: string,
  // For sessions recorded before time zones were captured.
  fallbackTzOffsetMinutes = 0,
) {
  const days = new Set(
    sessions
      .filter(qualifiesForStreak)
      .map((s) => localDay(s._creationTime, s.tzOffsetMinutes ?? fallbackTzOffsetMinutes)),
  );
  const practicedToday = days.has(today);
  let cursor = practicedToday ? today : previousDay(today);
  let streakDays = 0;
  while (days.has(cursor)) {
    streakDays++;
    cursor = previousDay(cursor);
  }
  return { streakDays, practicedToday };
}

/** Best sustained finger control across sessions, optionally excluding one. */
export function bestFingerControl(
  sessions: Doc<"sessions">[],
  exclude?: Id<"sessions">,
) {
  const values = sessions
    // Only sessions measured the sustained way count as records. They're the
    // ones with a time zone: both shipped in the same release, and earlier
    // single-reading bests could spike unfairly high.
    .filter((s) => s._id !== exclude && s.bestIsolation !== undefined && s.tzOffsetMinutes !== undefined)
    .map((s) => s.bestIsolation!);
  return values.length ? Math.max(...values) : null;
}

/**
 * The viewer's recent sessions: the account's from any device when signed
 * in, otherwise this device's unclaimed ones.
 */
export async function viewerSessions(ctx: QueryCtx, learnerKey: string, limit: number) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    return await ctx.db
      .query("sessions")
      .withIndex("by_userToken", (q) => q.eq("userToken", identity.tokenIdentifier))
      .order("desc")
      .take(limit);
  }
  const deviceSessions = await ctx.db
    .query("sessions")
    .withIndex("by_learnerKey", (q) => q.eq("learnerKey", learnerKey))
    .order("desc")
    .take(limit);
  return deviceSessions.filter((s) => !s.userToken);
}

export const summary = query({
  args: {
    learnerKey: v.string(),
    // The client's local date; queries don't read the clock themselves.
    today: v.string(),
    tzOffsetMinutes: v.optional(v.number()),
    // The session being practiced right now, if any.
    currentSessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, { learnerKey, today, tzOffsetMinutes, currentSessionId }) => {
    const sessions = await viewerSessions(ctx, learnerKey, 100);
    const current = sessions.find((s) => s._id === currentSessionId) ?? null;
    return {
      ...computeStreak(sessions, today, tzOffsetMinutes),
      practiceSessions: sessions.filter(qualifiesForStreak).length,
      totalPracticeSeconds: sessions.reduce((sum, s) => sum + s.activeSeconds, 0),
      bestFingerControl: bestFingerControl(sessions),
      // For "new personal best" during practice: the record before this session.
      previousBestFingerControl: bestFingerControl(sessions, currentSessionId),
      currentBestFingerControl: current?.bestIsolation ?? null,
    };
  },
});
