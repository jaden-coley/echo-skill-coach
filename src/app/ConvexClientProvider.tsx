"use client";

import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// @convex-dev/better-auth 0.12.5's AuthClient type was written against
// better-auth 1.6.15 and resolves useSession() to `never` on later 1.6.x
// releases. We stay on a patched 1.6.x (GHSA-qq9h-g4jm-xgf3 affects <1.6.22),
// which the component supports at runtime, so only the type needs bridging.
const convexAuthClient = authClient as unknown as AuthClient;

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={convexAuthClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
