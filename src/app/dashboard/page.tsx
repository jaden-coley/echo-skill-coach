import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard";

export const metadata: Metadata = {
  title: "Your progress · E.C.H.O.",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col bg-black">
      <Dashboard />
    </div>
  );
}
