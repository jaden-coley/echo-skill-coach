"use client";

import { useProgressSummary } from "@/lib/useProgressSummary";

/** Compact streak indicator for the page header. */
export default function StreakChip() {
  const summary = useProgressSummary();
  if (!summary || summary.streakDays === 0) return null;
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs ${
        summary.practicedToday
          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
          : "border-zinc-700 text-zinc-300"
      }`}
      title={
        summary.practicedToday
          ? "You've practiced today"
          : "Practice today to keep your streak"
      }
    >
      🔥 {summary.streakDays}-day streak
    </span>
  );
}
