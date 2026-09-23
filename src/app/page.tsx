import CameraCapture from "@/components/CameraCapture";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-black px-6 py-16 text-white">
      <header className="mb-10 flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">E.C.H.O.</h1>
        <p className="text-sm text-zinc-400">AI Skill Coach — webcam setup</p>
      </header>

      <main className="flex w-full flex-1 flex-col items-center">
        <CameraCapture />
      </main>
    </div>
  );
}
