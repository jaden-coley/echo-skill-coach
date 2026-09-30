import { Resend } from "@convex-dev/resend";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { FAULT_COACHING } from "./skills";

/*
 * End-of-session recap email. Queued through the Resend component (durable,
 * batched, exactly-once) in the same transaction that ends the session, so a
 * finished session always gets exactly one recap. The recap is meant to be
 * useful the next time the learner practices: what they achieved, the mistake
 * that came up most, and a specific drill for it.
 */

export const resend = new Resend(components.resend, {
  // Deliver to real addresses. Note: until a sending domain is verified in
  // Resend, the default onboarding@resend.dev sender only delivers to the
  // Resend account owner's own email address.
  testMode: false,
});

const FROM = process.env.RESEND_FROM ?? "E.C.H.O. Coach <onboarding@resend.dev>";

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

  const struggle = topStruggle(corrections);
  const stepsTotal = skill?.steps.length ?? 4;
  const reached = Math.min(session.highestStep, stepsTotal);
  const reachedTitle = skill?.steps[reached - 1]?.title ?? `Step ${reached}`;
  const dashboardUrl = `${process.env.SITE_URL ?? ""}/dashboard`;

  await resend.sendEmail(ctx, {
    from: FROM,
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
    }),
  });
  await ctx.db.patch("sessions", session._id, { recapQueuedAt: Date.now() });
}

/** The mistake corrected most often this session, with what to practice. */
function topStruggle(corrections: Doc<"corrections">[]) {
  const counts = new Map<string, number>();
  for (const c of corrections) {
    // Tracker faults escalate as "anchor#2" etc. — count them together.
    const key = c.source === "tracker" ? c.faultId.split("#")[0] : "ai";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [key, count] =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!key || !count) return null;
  const coaching = FAULT_COACHING[key];
  if (coaching) return { ...coaching, count };

  // The AI's own words, for faults only it can see (e.g. crossed tips).
  const latestAi = corrections.find((c) => c.source === "ai");
  return latestAi
    ? { label: "Getting the grip the AI coach could confirm", tip: latestAi.message, count }
    : null;
}

function recapHtml(data: {
  name: string;
  reached: number;
  stepsTotal: number;
  reachedTitle: string;
  session: Doc<"sessions">;
  struggle: { label: string; tip: string; count: number } | null;
  dashboardUrl: string;
}) {
  const { session, struggle } = data;
  const minutes = Math.max(1, Math.round(session.activeSeconds / 60));
  const checks = session.checksPassed + session.checksFailed;
  const stat = (label: string, value: string) =>
    `<td style="padding:12px;border:1px solid #27272a;border-radius:8px;">
       <div style="font-size:12px;color:#a1a1aa;">${label}</div>
       <div style="font-size:22px;font-weight:600;color:#fafafa;margin-top:4px;">${value}</div>
     </td>`;

  return `<!doctype html>
<html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e4e4e7;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:13px;letter-spacing:.08em;color:#71717a;margin:0 0 8px;">E.C.H.O. · CHOPSTICKS</p>
    <h1 style="font-size:22px;color:#fafafa;margin:0 0 8px;">Nice work, ${escapeHtml(data.name || "there")}.</h1>
    <p style="margin:0 0 20px;line-height:1.5;">
      You reached <strong style="color:#fafafa;">step ${data.reached} of ${data.stepsTotal}: ${escapeHtml(data.reachedTitle)}</strong>.
    </p>
    <table role="presentation" cellspacing="8" style="width:100%;margin:0 -8px 20px;"><tr>
      ${stat("Practice time", `${minutes} min`)}
      ${stat("AI checks passed", checks ? `${session.checksPassed} of ${checks}` : "—")}
      ${stat("Best isolation", session.bestIsolation === undefined ? "—" : `${Math.round(session.bestIsolation)}%`)}
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
