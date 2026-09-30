import { handler } from "@/lib/auth-server";

// Proxies Better Auth requests to the Convex deployment, keeping auth cookies
// on this app's own domain.
export const { GET, POST } = handler;
