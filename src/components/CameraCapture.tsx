"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createHandLandmarker,
  drawHands,
  type HandLandmarker,
} from "@/lib/handTracking";

type CameraStatus =
  | "idle"
  | "requesting"
  | "live"
  | "denied"
  | "unavailable"
  | "unsupported";

type TrackingStatus = "off" | "loading" | "ready" | "error";

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const disposedRef = useRef(false);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingStatus>("off");
  const [handCount, setHandCount] = useState(0);
  const [fps, setFps] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

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

  // Per-frame tracking loop. Runs only while the live feed is visible, and
  // restarts cleanly after a retake.
  useEffect(() => {
    if (status !== "live" || tracking !== "ready" || capturedFrame) return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    const landmarker = landmarkerRef.current;
    const context = overlay?.getContext("2d");
    if (!video || !overlay || !landmarker || !context) return;

    let frameId = 0;
    let lastVideoTime = -1;
    let lastHandCount = -1;
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
      drawHands(context, result);

      // Throttle React updates — the canvas redraws every frame, but the
      // HUD text only needs to change when its value does.
      if (result.landmarks.length !== lastHandCount) {
        lastHandCount = result.landmarks.length;
        setHandCount(lastHandCount);
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
    };
  }, [status, tracking, capturedFrame]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedFrame(canvas.toDataURL("image/png"));
  }, []);

  const retake = useCallback(() => {
    setCapturedFrame(null);
  }, []);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        {/* Live feed stays mounted (just hidden) once granted, so the
            stream doesn't have to be re-requested after a retake. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${
            status === "live" && !capturedFrame ? "block" : "hidden"
          }`}
        />

        {/* Same object-cover sizing as the video, so landmark coordinates
            (normalized to the video frame) line up with the visible feed. */}
        <canvas
          ref={overlayRef}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
            status === "live" && !capturedFrame ? "block" : "hidden"
          }`}
        />

        {status === "live" && !capturedFrame && (
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-zinc-200 backdrop-blur">
            {tracking === "loading" && "Loading hand tracking…"}
            {tracking === "error" && (
              <span className="text-red-400">Hand tracking unavailable</span>
            )}
            {tracking === "ready" &&
              (handCount === 0 ? (
                "Show your hand to the camera"
              ) : (
                <span>
                  <span className="text-emerald-400">●</span> Tracking{" "}
                  {handCount} {handCount === 1 ? "hand" : "hands"} · {fps} fps
                </span>
              ))}
          </div>
        )}

        {capturedFrame && (
          // eslint-disable-next-line @next/next/no-img-element -- local data URL, not an optimizable remote asset
          <img
            src={capturedFrame}
            alt="Captured frame"
            className="h-full w-full object-cover"
          />
        )}

        {!capturedFrame && status !== "live" && (
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

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-3">
        {status === "live" && !capturedFrame && (
          <button
            onClick={captureFrame}
            className="rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
          >
            Capture Frame
          </button>
        )}

        {capturedFrame && (
          <button
            onClick={retake}
            className="rounded-full border border-zinc-700 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Retake
          </button>
        )}
      </div>

      <p className="max-w-md text-center text-xs text-zinc-500">
        Your camera feed and hand tracking stay in this browser tab. Nothing is
        uploaded, recorded, or sent anywhere.
      </p>
    </div>
  );
}
