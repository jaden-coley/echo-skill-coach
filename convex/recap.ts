import { Resend } from "@convex-dev/resend";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { bestFingerControl, computeStreak, localDay } from "./progress";
import { summarizeStruggles } from "./struggles";

/*
 * End-of-session recap email. Queued through the Resend component (durable,
 * batched, exactly-once) in the same transaction that ends the session, so a
 * finished session always gets exactly one recap. The recap is meant to be
 * useful the next time the learner practices: what they achieved, the mistake
 * that came up most, and a specific drill for it.
 */

export const resend = new Resend(components.resend, {
  // Deliver to real addresses. Recaps go out from RESEND_FROM (a verified
  // domain); the onboarding@resend.dev fallback only delivers to the Resend
  // account owner's own email address.
  testMode: false,
});

export async function queueRecap(ctx: MutationCtx, session: Doc<"sessions">) {
  if (session.recapQueuedAt) return;
  // Only sessions with real practice in them are worth an email.
  if (session.activeSeconds < 5 && session.checksPassed + session.checksFailed === 0) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set; skipping session recap email");
    return;
  }

  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user?.email) return;

  const skill = await ctx.db.get("skills", session.skillId);
  const corrections = await ctx.db
    .query("corrections")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
    .take(300);

  const struggle = summarizeStruggles(corrections)[0] ?? null;

  // Streak and personal best across the learner's account.
  const history = session.userToken
    ? await ctx.db
        .query("sessions")
        .withIndex("by_userToken", (q) => q.eq("userToken", session.userToken))
        .order("desc")
        .take(100)
    : [session];
  const { streakDays } = computeStreak(
    history,
    localDay(Date.now(), session.tzOffsetMinutes),
    session.tzOffsetMinutes,
  );
  const previousBest = bestFingerControl(history, session._id);
  const newPersonalBest =
    session.bestIsolation !== undefined &&
    previousBest !== null &&
    session.bestIsolation > previousBest;
  const stepsTotal = skill?.steps.length ?? 4;
  const reached = Math.min(session.highestStep, stepsTotal);
  const reachedTitle = skill?.steps[reached - 1]?.title ?? `Step ${reached}`;
  const dashboardUrl = `${process.env.SITE_URL ?? ""}/dashboard`;

  await resend.sendEmail(ctx, {
    // Read per send, so a changed sender setting applies right away.
    from: process.env.RESEND_FROM ?? "E.C.H.O. Coach <onboarding@resend.dev>",
    to: user.email,
    subject: `Your chopsticks session: step ${reached} of ${stepsTotal}`,
    html: recapHtml({
      name: user.name,
      reached,
      stepsTotal,
      reachedTitle,
      session,
      struggle,
      dashboardUrl,
      streakDays,
      newPersonalBest,
    }),
  });
  await ctx.db.patch("sessions", session._id, { recapQueuedAt: Date.now() });
}

function recapHtml(data: {
  name: string;
  reached: number;
  stepsTotal: number;
  reachedTitle: string;
  session: Doc<"sessions">;
  struggle: { label: string; tip: string; count: number } | null;
  dashboardUrl: string;
  streakDays: number;
  newPersonalBest: boolean;
}) {
  const { session, struggle } = data;
  const minutes = Math.max(1, Math.round(session.activeSeconds / 60));
  const checks = session.checksPassed + session.checksFailed;
  const stat = (label: string, value: string, explain: string) =>
    `<td style="padding:12px;border:1px solid #27272a;border-radius:8px;vertical-align:top;">
       <div style="font-size:12px;color:#a1a1aa;">${label}</div>
       <div style="font-size:22px;font-weight:600;color:#fafafa;margin-top:4px;">${value}</div>
       <div style="font-size:11px;line-height:1.4;color:#71717a;margin-top:6px;">${explain}</div>
     </td>`;

  return `<!doctype html>
<html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e4e4e7;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:13px;letter-spacing:.08em;color:#71717a;margin:0 0 8px;">E.C.H.O. · CHOPSTICKS</p>
    <h1 style="font-size:22px;color:#fafafa;margin:0 0 8px;">Nice work, ${escapeHtml(data.name || "there")}.</h1>
    <p style="margin:0 0 ${data.streakDays ? "8px" : "20px"};line-height:1.5;">
      You reached <strong style="color:#fafafa;">step ${data.reached} of ${data.stepsTotal}: ${escapeHtml(data.reachedTitle)}</strong>.
    </p>
    ${
      data.streakDays
        ? `<p style="margin:0 0 20px;line-height:1.5;color:#fbbf24;">🔥 <strong>${data.streakDays}-day practice streak</strong> — practice tomorrow to keep it going.</p>`
        : ""
    }
    <table role="presentation" cellspacing="8" style="width:100%;margin:0 -8px 20px;"><tr>
      ${stat("Practice time", `${minutes} min`, "Time spent actively opening and closing.")}
      ${stat(
        "Grip checks",
        checks ? `${session.checksPassed} of ${checks}` : "—",
        "Times the AI coach looked at your chopsticks and confirmed you had it right.",
      )}
      ${stat(
        data.newPersonalBest ? "Finger control · 🏆 new best" : "Finger control",
        session.bestIsolation === undefined ? "—" : `${Math.round(session.bestIsolation)}%`,
        "Your best share of the motion coming from your pointer + middle fingers, held steady. 70%+ is great.",
      )}
    </tr></table>
    ${
      struggle
        ? `<div style="border:1px solid #78350f;background:#1c1406;border-radius:12px;padding:16px;margin-bottom:20px;">
             <p style="margin:0 0 6px;font-size:13px;color:#fbbf24;">Focus for next time · came up ${struggle.count}×</p>
             <p style="margin:0 0 8px;color:#fafafa;font-weight:600;">${escapeHtml(struggle.label)}</p>
             <p style="margin:0;line-height:1.5;">${escapeHtml(struggle.tip)}</p>
           </div>`
        : ""
    }
    <a href="${data.dashboardUrl}" style="display:inline-block;background:#fafafa;color:#09090b;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:999px;">See your full progress</a>
    <p style="margin:24px 0 0;font-size:12px;color:#71717a;">You're getting this because you finished a practice session while signed in to E.C.H.O.</p>
  </div>
</body></html>`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
