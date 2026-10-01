"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import AccountMenu from "@/components/AccountMenu";
import IsolationChart from "@/components/IsolationChart";
import { getLearnerKey } from "@/lib/learnerKey";
import { useProgressSummary } from "@/lib/useProgressSummary";

/*
 * Live progress dashboard. Every panel is a Convex query subscription, so it
 * updates the moment the coach records something — no refresh, no polling.
 * Open it next to (or on a phone beside) a practice session to watch it move.
 */

const noSubscribe = () => () => {};

export default function Dashboard() {
  const learnerKey = useSyncExternalStore(noSubscribe, getLearnerKey, () => null);
  const sessions = useQuery(
    api.sessions.listForLearner,
    learnerKey ? { learnerKey } : "skip",
  );
  const [selectedId, setSelectedId] = useState<Id<"sessions"> | null>(null);
  const sessionId = selectedId ?? sessions?.[0]?._id ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 text-white sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your progress</h1>
          <p className="text-sm text-zinc-400">Chopsticks · updates live as you practice</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
          <Link href="/" className="text-zinc-400 hover:text-white">
            ← Back to practice
          </Link>
          <AccountMenu />
        </div>
      </header>

      {sessions === undefined ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : sessions.length === 0 || !learnerKey || !sessionId ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
          <p className="text-zinc-300">No practice sessions yet.</p>
          <Link href="/" className="mt-2 inline-block text-sm text-emerald-400 hover:underline">
            Start your first lesson →
          </Link>
        </div>
      ) : (
        <>
          <ProgressBanner />
          <SessionDetail sessionId={sessionId} learnerKey={learnerKey} />
          <SessionList
            sessions={sessions}
            selectedId={sessionId}
            onSelect={setSelectedId}
          />
        </>
      )}
    </div>
  );
}

/** Streak + all-time stats: the reason to come back tomorrow. */
function ProgressBanner() {
  const summary = useProgressSummary();
  if (!summary) return null;
  const { streakDays, practicedToday } = summary;

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent p-5">
      <div>
        <p className="text-2xl font-semibold text-white">
          {streakDays > 0 ? `🔥 ${streakDays}-day streak` : "Start a streak today"}
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {streakDays === 0
            ? "Practice for at least 20 seconds to light your first day."
            : practicedToday
              ? "You've practiced today ✓ — come back tomorrow to keep it going."
              : "Practice today to keep your streak alive."}
        </p>
      </div>
      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Practice sessions</dt>
          <dd className="font-mono text-lg text-white">{summary.practiceSessions}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Total practice</dt>
          <dd className="font-mono text-lg text-white">
            {formatDuration(summary.totalPracticeSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">🏆 Best finger control</dt>
          <dd className="font-mono text-lg text-white">
            {summary.bestFingerControl === null
              ? "—"
              : `${Math.round(summary.bestFingerControl)}%`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function SessionDetail({
  sessionId,
  learnerKey,
}: {
  sessionId: Id<"sessions">;
  learnerKey: string;
}) {
  const data = useQuery(api.sessions.get, { sessionId, learnerKey });
  if (!data) return <p className="text-sm text-zinc-500">Loading session…</p>;

  const { session, skill, samples } = data;
  const steps = skill?.steps ?? [];
  const goodIsolation = skill?.rubric.isolation?.good ?? 70;

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">
            {session.status === "active" ? "Current session" : "Session"} ·{" "}
            <span className="font-normal text-zinc-400">
              {new Date(session._creationTime).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </h2>
          {session.status === "active" && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
              In progress
            </span>
          )}
        </div>

        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((step, i) => {
            const number = i + 1;
            const done = number < session.highestStep;
            const current = number === session.currentStep;
            return (
              <li
                key={step.id}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : current
                      ? "border-zinc-500 bg-zinc-900 text-white"
                      : "border-zinc-800 text-zinc-500"
                }`}
              >
                <span className="block text-[11px] uppercase tracking-wider opacity-70">
                  {done ? "✓ Done" : current ? "Now" : `Step ${number}`}
                </span>
                {step.title}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Grip checks"
          value={`${session.checksPassed}`}
          sub={`of ${session.checksPassed + session.checksFailed}`}
          explain="Times the AI coach looked and confirmed you had it right"
        />
        <Stat
          label="Corrections given"
          value={`${session.correctionsShown}`}
          explain="Tips the coach gave you along the way"
        />
        <Stat
          label="Practice time"
          value={formatDuration(session.activeSeconds)}
          explain="Time spent actively opening and closing"
        />
        <Stat
          label="Finger control"
          value={session.bestIsolation === undefined ? "—" : `${Math.round(session.bestIsolation)}%`}
          explain="Best share of motion from your pointer + middle fingers (70%+ is great)"
        />
      </div>

      <WhatToWorkOn struggles={data.struggles} />

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <h3 className="font-semibold">Finger control over this session</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Share of the motion coming from your pointer + middle fingers — higher means a
          steadier bottom chopstick.
        </p>
        <IsolationChart
          goodThreshold={goodIsolation}
          points={samples.map((s) => ({ time: s._creationTime, isolation: s.metrics.isolation }))}
        />
      </div>

      <Timeline data={data} />
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  explain,
}: {
  label: string;
  value: string;
  sub?: string;
  explain: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums text-white">
        {value}
        {sub && <span className="ml-1 text-xs text-zinc-500">{sub}</span>}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-zinc-500">{explain}</p>
    </div>
  );
}

type SessionData = FunctionReturnType<typeof api.sessions.get>;

const CHECK_LABELS = {
  holding: "holding the chopsticks",
  grip: "grip",
  motion: "bottom chopstick staying still",
} as const;

/** The session's most frequent mistakes, each with the drill that fixes it. */
function WhatToWorkOn({ struggles }: { struggles: SessionData["struggles"] }) {
  const most = struggles[0]?.count ?? 1;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <h3 className="font-semibold">What to work on</h3>
      <p className="mb-3 text-xs text-zinc-500">
        Your most frequent corrections this session, and how to fix each one.
      </p>
      {struggles.length === 0 ? (
        <p className="text-sm text-zinc-500">No corrections yet — keep practicing.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {struggles.map((s, i) => (
            <li key={s.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className={`text-sm font-medium ${i === 0 ? "text-amber-200" : "text-zinc-200"}`}>
                  {i === 0 && <span className="mr-1.5 text-xs text-amber-400">Top focus ·</span>}
                  {s.label}
                </p>
                <span className="shrink-0 font-mono text-xs text-zinc-400">{s.count}×</span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-400"
                  style={{ width: `${Math.round((s.count / most) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{s.tip}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Timeline({ data }: { data: SessionData }) {
  const stepTitle = (step: number) => data.skill?.steps[step - 1]?.title ?? `Step ${step}`;

  const items = [
    ...data.stepEvents.map((e) => ({
      id: e._id,
      time: e._creationTime,
      icon: e.kind === "passed" ? "✓" : "↩",
      tone: e.kind === "passed" ? "text-emerald-300" : "text-amber-300",
      title: e.kind === "passed" ? `Passed: ${stepTitle(e.step)}` : `Back to: ${stepTitle(e.step)}`,
      detail: null as string | null,
    })),
    ...data.checks.map((c) => ({
      id: c._id,
      time: c._creationTime,
      icon: "◎",
      tone: c.pass ? "text-emerald-300" : "text-amber-300",
      title: `AI check ${c.pass ? "passed" : "not yet"} — ${CHECK_LABELS[c.check]}${
        c.issue ? ` (${c.issue})` : ""
      }`,
      detail: `${c.correction} · ${Math.round(c.confidence * 100)}% sure · ${(c.latencyMs / 1000).toFixed(1)}s`,
    })),
    ...data.corrections
      .filter((c) => c.source === "tracker")
      .map((c) => ({
        id: c._id,
        time: c._creationTime,
        icon: "→",
        tone: "text-zinc-300",
        title: `Correction on ${stepTitle(c.step)}`,
        detail: c.message,
      })),
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, 25);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <h3 className="mb-3 font-semibold">What the coach saw</h3>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing yet — pick up your chopsticks to begin.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 text-sm">
              <span aria-hidden className={`w-4 shrink-0 text-center ${item.tone}`}>
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-zinc-100">{item.title}</p>
                {item.detail && <p className="text-xs text-zinc-500">{item.detail}</p>}
              </div>
              <time className="shrink-0 font-mono text-xs text-zinc-600">
                {new Date(item.time).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: Doc<"sessions">[];
  selectedId: Id<"sessions">;
  onSelect: (id: Id<"sessions">) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <h3 className="mb-3 font-semibold">All sessions</h3>
      <ul className="flex flex-col divide-y divide-zinc-800">
        {sessions.map((s) => (
          <li key={s._id}>
            <button
              onClick={() => onSelect(s._id)}
              className={`flex w-full items-center justify-between gap-3 py-2 text-left text-sm ${
                s._id === selectedId ? "text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>
                {new Date(s._creationTime).toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {s.status === "active" && <span className="ml-2 text-emerald-400">● live</span>}
              </span>
              <span className="font-mono text-xs">
                reached step {s.highestStep} · {formatDuration(s.activeSeconds)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
