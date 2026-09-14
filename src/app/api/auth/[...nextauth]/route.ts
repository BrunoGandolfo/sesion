import { handlers } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

export const { GET, POST } = handlers;
