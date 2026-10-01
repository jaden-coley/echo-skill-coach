"use client";

import { useConvex, useConvexAuth } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import CoachingPanel from "@/components/CoachingPanel";
import {
  ChopstickLesson,
  type LessonView,
  type Verifier,
  type VisionVerdict,
} from "@/lib/chopstickCoaching";
import { ChopstickAnalyzer, type ChopstickSnapshot } from "@/lib/chopstickFeatures";
import {
  createHandLandmarker,
  drawHands,
  type HandLandmarker,
} from "@/lib/handTracking";
import { getLearnerKey } from "@/lib/learnerKey";
import { SessionRecorder } from "@/lib/sessionRecorder";
import { useProgressSummary } from "@/lib/useProgressSummary";
import type { Id } from "../../convex/_generated/dataModel";

type CameraStatus =
  | "idle"
  | "requesting"
  | "live"
  | "denied"
  | "unavailable"
  | "unsupported"
  | "finished";

type TrackingStatus = "off" | "loading" | "ready" | "error";

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const disposedRef = useRef(false);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [tracking, setTracking] = useState<TrackingStatus>("off");
  const [snapshot, setSnapshot] = useState<ChopstickSnapshot | null>(null);
  const [lesson, setLesson] = useState<LessonView | null>(null);
  const [fps, setFps] = useState(0);
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(null);
  const progress = useProgressSummary(sessionId);
  // A new record only counts against a previous one — not on your first session.
  const newPersonalBest =
    progress?.currentBestFingerControl != null &&
    progress.previousBestFingerControl != null &&
    progress.currentBestFingerControl > progress.previousBestFingerControl;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Stopping the camera ends the tracking loop, whose cleanup ends the Convex
  // session — which queues the recap email for signed-in learners.
  const finishSession = useCallback(() => {
    stopStream();
    setStatus("finished");
  }, [stopStream]);

  // Always release the camera when this component goes away, so the
  // camera indicator light doesn't stay on after the user navigates away.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      stopStream();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [stopStream]);

  const loadTracking = useCallback(async () => {
    setTracking("loading");
    try {
      const landmarker = await createHandLandmarker();
      if (disposedRef.current) {
        landmarker.close();
        return;
      }
      landmarkerRef.current = landmarker;
      setTracking("ready");
    } catch (error) {
      console.error("Hand tracking failed to load", error);
      if (!disposedRef.current) setTracking("error");
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");

    // Fetch the model while the permission prompt is open, so tracking is
    // usually ready by the time the feed appears.
    if (!landmarkerRef.current && tracking !== "loading") {
      void loadTracking();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus("live");
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError" || error.name === "SecurityError") {
          setStatus("denied");
          return;
        }
        if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
          setStatus("unavailable");
          return;
        }
      }
      setStatus("unavailable");
    }
  }, [loadTracking, tracking]);

  // Per-frame tracking loop, running for as long as the live feed is on.
  useEffect(() => {
    if (status !== "live" || tracking !== "ready") return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    const landmarker = landmarkerRef.current;
    const context = overlay?.getContext("2d");
    if (!video || !overlay || !landmarker || !context) return;

    const analyzer = new ChopstickAnalyzer();
    const recorder = new SessionRecorder(convex, getLearnerKey());
    recorder.sessionId.then(setSessionId, () => {});
    const motionFrames = new MotionFrames();
    const chopstickLesson = new ChopstickLesson(verifyWithAi(video, motionFrames), (event) =>
      recorder.record(event),
    );
    let lessonStep = 1;
    let frameId = 0;
    let lastVideoTime = -1;
    let lastSnapshotTime = 0;
    let framesSinceSample = 0;
    let sampleStart = performance.now();

    const tick = () => {
      frameId = requestAnimationFrame(tick);

      // Only run inference on new video frames; rAF can fire faster than
      // the camera delivers them.
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
      if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;

      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const hands = analyzer.update(
        result,
        now,
        video.videoWidth / video.videoHeight,
      );
      drawHands(context, hands);

      // Throttle React updates — the canvas redraws every frame, but the
      // numbers only need to refresh a few times a second to read smoothly.
      if (now - lastSnapshotTime >= 150) {
        const next = analyzer.snapshot(now);
        setSnapshot(next);
        const view = chopstickLesson.update(next, now);
        lessonStep = view.step;
        setLesson(view);
        recorder.sample(lessonStep, next, now);
        if (next.state === "active" && next.debug) {
          motionFrames.observe(next.debug.pivotBend, now, () => captureJpeg(video, 640));
        }
        lastSnapshotTime = now;
      }
      framesSinceSample++;
      if (now - sampleStart >= 500) {
        setFps(Math.round((framesSinceSample * 1000) / (now - sampleStart)));
        framesSinceSample = 0;
        sampleStart = now;
      }
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      context.clearRect(0, 0, overlay.width, overlay.height);
      recorder.end();
      setSnapshot(null);
      setLesson(null);
      setSessionId(null);
    };
  }, [status, tracking, convex]);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        {/* Always mounted so the ref exists when the stream arrives. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${
            status === "live" ? "block" : "hidden"
          }`}
        />

        {/* Same object-cover sizing as the video, so landmark coordinates
            (normalized to the video frame) line up with the visible feed. */}
        <canvas
          ref={overlayRef}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
            status === "live" ? "block" : "hidden"
          }`}
        />

        {status === "live" && (
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-zinc-200 backdrop-blur">
            {tracking === "loading" && "Loading hand tracking…"}
            {tracking === "error" && (
              <span className="text-red-400">Hand tracking unavailable</span>
            )}
            {tracking === "ready" &&
              (snapshot && snapshot.state !== "no-hand" ? (
                <span>
                  <span className="text-emerald-400">●</span> Tracking
                </span>
              ) : (
                "Looking for your hand"
              ))}
          </div>
        )}

        {status !== "live" && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
            {status === "idle" && (
              <>
                <p className="text-sm text-zinc-400">
                  E.C.H.O. needs camera access to watch your attempt.
                </p>
                <button
                  onClick={startCamera}
                  className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
                >
                  Enable Camera
                </button>
              </>
            )}

            {status === "finished" && (
              <>
                <p className="text-lg font-semibold text-white">Session saved ✓</p>
                <p className="max-w-sm text-sm text-zinc-400">
                  {isAuthenticated
                    ? "Your recap — with what to focus on next time — is on its way to your inbox."
                    : "Sign in next time and E.C.H.O. will email you a recap with what to focus on."}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={startCamera}
                    className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
                  >
                    Practice again
                  </button>
                  <Link
                    href="/dashboard"
                    className="rounded-full border border-zinc-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                  >
                    See your progress
                  </Link>
                </div>
              </>
            )}

            {status === "requesting" && (
              <p className="text-sm text-zinc-400">Requesting camera access…</p>
            )}

            {status === "denied" && (
              <>
                <p className="max-w-sm text-sm text-red-400">
                  Camera access was denied. E.C.H.O. can&apos;t see your attempt
                  without it — enable camera permission for this site in your
                  browser settings, then try again.
                </p>
                <button
                  onClick={startCamera}
                  className="rounded-full border border-zinc-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                >
                  Try Again
                </button>
              </>
            )}

            {status === "unavailable" && (
              <p className="max-w-sm text-sm text-red-400">
                No camera could be found or it&apos;s currently in use by
                another application. Connect a camera and try again.
              </p>
            )}

            {status === "unsupported" && (
              <p className="max-w-sm text-sm text-red-400">
                This browser doesn&apos;t support camera access, or this page
                isn&apos;t loaded over a secure connection (HTTPS or
                localhost).
              </p>
            )}
          </div>
        )}
      </div>

      {status === "live" && tracking === "ready" && (
        <CoachingPanel lesson={lesson} snapshot={snapshot} fps={fps} />
      )}

      {newPersonalBest && progress?.currentBestFingerControl != null && (
        <div
          aria-live="polite"
          className="w-full rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-center text-sm text-emerald-200"
        >
          🏆 <strong>New personal best!</strong> Finger control{" "}
          {Math.round(progress.currentBestFingerControl)}% — your previous best was{" "}
          {Math.round(progress.previousBestFingerControl!)}%.
        </div>
      )}

      {sessionId && (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={finishSession}
            className="rounded-full border border-zinc-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            {isAuthenticated ? "Finish session & email my recap" : "Finish session"}
          </button>
          <Link
            href="/dashboard"
            target="_blank"
            className="text-xs text-emerald-400/80 underline-offset-4 hover:underline"
          >
            ● Saving your progress live — open your dashboard ↗
          </Link>
        </div>
      )}

      <p className="max-w-md text-center text-xs text-zinc-500">
        Hand tracking runs in this browser tab and no video is recorded. When a
        step needs confirming, one still frame is sent to the AI coach to check
        your chopsticks, and your progress is saved to your dashboard.
      </p>
    </div>
  );
}

/** Sends frames to the AI coach's vision check. */
function verifyWithAi(video: HTMLVideoElement, motionFrames: MotionFrames): Verifier {
  return async (check, gripShape) => {
    if (check === "motion") {
      const images = motionFrames.pair();
      return images ? postCheck({ check, images, gripShape }) : null;
    }
    const image = captureJpeg(video, 640);
    return image ? postCheck({ check, image, gripShape }) : null;
  };
}

async function postCheck(payload: object): Promise<VisionVerdict | null> {
  const response = await fetch("/api/coach/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.warn("AI check unavailable", await response.text());
    return null;
  }
  return (await response.json()) as VisionVerdict;
}

/**
 * Keeps the most-open and most-closed frames of the last few seconds of
 * practice, so the AI can compare the two ends of one open–close motion.
 * Pointer + middle finger bend is lowest when the chopsticks are open.
 */
class MotionFrames {
  private open: { bend: number; time: number; image: string } | null = null;
  private closed: { bend: number; time: number; image: string } | null = null;
  private lastCapture = 0;

  observe(bend: number, now: number, capture: () => string | null) {
    const stale = (frame: { time: number } | null) => !frame || now - frame.time > 4000;
    const moreOpen = stale(this.open) || bend < this.open!.bend;
    const moreClosed = stale(this.closed) || bend > this.closed!.bend;
    // Capturing costs a canvas encode, so at most a few per second.
    if ((!moreOpen && !moreClosed) || now - this.lastCapture < 200) return;
    const image = capture();
    if (!image) return;
    this.lastCapture = now;
    if (moreOpen) this.open = { bend, time: now, image };
    if (moreClosed) this.closed = { bend, time: now, image };
  }

  /** [open, closed], or null if there isn't a real open–close to compare. */
  pair(): [string, string] | null {
    if (!this.open || !this.closed) return null;
    if (this.closed.bend - this.open.bend < 8) return null;
    return [this.open.image, this.closed.image];
  }
}

function captureJpeg(video: HTMLVideoElement, maxWidth: number) {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}
