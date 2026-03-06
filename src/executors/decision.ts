import type { RemoteResponse } from "./types.js";

const challengeMarkers = [
    "turnstile",
    "cf-challenge",
    "captcha",
    "attention required",
    "cloudflare",
];

export function shouldUpgradeToRender(resp: RemoteResponse): boolean {
    if (!resp.ok) {
        return true;
    }
    if ([403, 429, 503].includes(resp.status)) {
        return true;
    }

    const body = (resp.body ?? "").toLowerCase();
    if (challengeMarkers.some((marker) => body.includes(marker))) {
        return true;
    }

    if ((resp.body?.length ?? 0) < 300 && resp.content_type?.includes("text/html")) {
        return true;
    }

    return false;
}
