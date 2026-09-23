"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CameraStatus =
  | "idle"
  | "requesting"
  | "live"
  | "denied"
  | "unavailable"
  | "unsupported";

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Always release the camera when this component goes away, so the
  // camera indicator light doesn't stay on after the user navigates away.
  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");

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
  }, []);

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
        Your camera feed stays in this browser tab. Nothing is uploaded,
        recorded, or sent anywhere.
      </p>
    </div>
  );
}
