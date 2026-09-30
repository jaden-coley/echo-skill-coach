"use client";

import { useState } from "react";
import {
  minimumShowMs,
  type Feedback,
  type LessonView,
} from "@/lib/chopstickCoaching";
import type {
  ChopstickMetrics,
  ChopstickSnapshot,
  MetricStatus,
} from "@/lib/chopstickFeatures";

const FEEDBACK_STYLES: Record<Feedback["tone"], { box: string; icon: string }> = {
  good: { box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: "✓" },
  fix: { box: "border-amber-500/40 bg-amber-500/10 text-amber-200", icon: "→" },
  info: { box: "border-zinc-700 bg-zinc-900 text-zinc-200", icon: "•" },
};

const DETAILS: { key: keyof ChopstickMetrics; label: string; unit: string; hint: string }[] = [
  {
    key: "pivotRange",
    label: "Pivot range",
    unit: "°",
    hint: "Index + middle finger bend while opening/closing",
  },
  {
    key: "anchorMovement",
    label: "Anchor movement",
    unit: "°",
    hint: "Ring finger bend — lower means a steadier bottom stick",
  },
  {
    key: "isolation",
    label: "Isolation",
    unit: "%",
    hint: "Share of motion from the index + middle fingers",
  },
];

const STATUS_TEXT: Record<MetricStatus, string> = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
  neutral: "text-zinc-500",
};

export default function CoachingPanel({
  lesson,
  snapshot,
  fps,
}: {
  lesson: LessonView | null;
  snapshot: ChopstickSnapshot | null;
  fps: number;
}) {
  const [showDetails, setShowDetails] = useState(false);
  if (!lesson) return null;

  const feedback = lesson.feedback;
  const style = FEEDBACK_STYLES[feedback?.tone ?? "info"];

  return (
    <section className="flex w-full flex-col items-center gap-3">
      <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Step {lesson.step} of {lesson.totalSteps}
          </p>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: lesson.totalSteps }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-full ${
                  i < lesson.step ? "bg-emerald-400" : "bg-zinc-800"
                }`}
              />
            ))}
          </div>
        </div>
        <h2 className="text-lg font-semibold">{lesson.title}</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-300">
          {lesson.instructions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>

      {feedback && (
        <div
          aria-live="polite"
          className={`relative w-full overflow-hidden rounded-2xl border px-5 py-4 ${style.box}`}
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-xl leading-6">
              {style.icon}
            </span>
            <p className="text-base font-medium leading-6">{feedback.message}</p>
          </div>
          {feedback.tone === "fix" && (
            // Drains over the correction's guaranteed reading time, so the
            // user can see it won't vanish mid-sentence. Keyed so it restarts
            // for each new correction.
            <span
              key={feedback.id}
              aria-hidden
              className="reading-timer absolute bottom-0 left-0 h-1 bg-amber-400/50"
              style={{ animationDuration: `${minimumShowMs(feedback)}ms` }}
            />
          )}
        </div>
      )}

      <button
        onClick={() => setShowDetails((open) => !open)}
        aria-expanded={showDetails}
        className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>

      {showDetails && (
        <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {DETAILS.map(({ key, label, unit, hint }) => {
              const reading = snapshot?.metrics?.[key];
              return (
                <div key={key}>
                  <p className="text-xs text-zinc-400">{label}</p>
                  <p
                    className={`font-mono text-xl tabular-nums ${
                      STATUS_TEXT[reading?.status ?? "neutral"]
                    }`}
                  >
                    {reading ? reading.value.toFixed(1) : "—"}
                    <span className="ml-0.5 text-xs text-zinc-500">{unit}</span>
                  </p>
                  <p className="text-[11px] leading-snug text-zinc-500">{hint}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 border-t border-zinc-800 pt-2 font-mono text-[11px] leading-relaxed text-zinc-500">
            grip {snapshot?.grip ?? "—"} · {snapshot?.twoHands ? "2 hands" : "1 hand"}
            {snapshot?.debug &&
              ` · pivot bend ${snapshot.debug.pivotBend.toFixed(0)}° · ring bend ${snapshot.debug.anchorBend.toFixed(0)}° · thumb gap ${snapshot.debug.thumbGap.toFixed(2)}`}
            <br />
            {fps} fps · tracking quality {snapshot?.trackingQuality ?? 0}% · measured
            over the last 1.5 s
          </p>
        </div>
      )}
    </section>
  );
}
