import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import CameraCapture from "@/components/CameraCapture";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-black px-4 pb-16 pt-4 text-white sm:px-6">
      <nav className="mb-8 flex w-full max-w-3xl items-center justify-between">
        <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
          Your progress
        </Link>
        <AccountMenu />
      </nav>

      <header className="mb-10 flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">E.C.H.O.</h1>
        <p className="text-sm text-zinc-400">Learn to use chopsticks, one step at a time</p>
      </header>

      <main className="flex w-full flex-1 flex-col items-center">
        <CameraCapture />
      </main>
    </div>
  );
}
