interface Env {
    CF_CRAWLER_TOKEN?: string;
    CF_CRAWLER_VERSION?: string;
    BROWSER_RENDERING_API_URL?: string;
    BROWSER_RENDERING_TOKEN?: string;
    CRAWLER_CACHE?: KVNamespace;
    CACHE_TTL_SECONDS?: string;
}

interface FetchPayload {
    url: string;
    timeout_ms?: number;
    mode?: string;
    session_id?: string;
    selectors?: string[];
}

const defaultHeaders: Record<string, string> = {
    "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
};

const challengeMarkers = ["turnstile", "cf-challenge", "attention required", "captcha", "verify you are human"];

function json(status: number, data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
        },
    });
}

function isAuthorized(req: Request, env: Env): boolean {
    if (!env.CF_CRAWLER_TOKEN) {
        return true;
    }
    const auth = req.headers.get("authorization") ?? "";
    return auth === `Bearer ${env.CF_CRAWLER_TOKEN}`;
}

function buildSignals(status: number, body: string, contentType: string): string[] {
    const signals = new Set<string>();
    const lowerBody = body.toLowerCase();

    if ([403, 429, 503].includes(status)) {
        signals.add(`http_${status}`);
    }

    if (contentType.includes("text/html") && body.length < 300) {
        signals.add("html_too_short");
    }

    if (challengeMarkers.some((marker) => lowerBody.includes(marker))) {
        signals.add("challenge_marker");
    }

    return Array.from(signals);
}

function getCacheTtlSeconds(env: Env): number {
    const raw = Number(env.CACHE_TTL_SECONDS ?? "120");
    if (!Number.isFinite(raw)) {
        return 120;
    }
    const normalized = Math.trunc(raw);
    if (normalized < 10) {
        return 10;
    }
    if (normalized > 600) {
        return 600;
    }
    return normalized;
}

async function doFetch(payload: FetchPayload, env: Env): Promise<Response> {
    const cacheKey = `fetch:${payload.url}`;
    if (env.CRAWLER_CACHE) {
        const cached = await env.CRAWLER_CACHE.get(cacheKey, "json");
        if (cached) {
            return json(200, {
                ...(cached as Record<string, unknown>),
                cache_hit: true,
            });
        }
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), payload.timeout_ms ?? 15000);

    try {
        const resp = await fetch(payload.url, {
            method: "GET",
            headers: defaultHeaders,
            redirect: "follow",
            signal: controller.signal,
        });

        const body = await resp.text();
        const contentType = resp.headers.get("content-type") ?? "";
        const antiBotSignals = buildSignals(resp.status, body, contentType);

        const result = {
            ok: resp.ok,
            url: payload.url,
            final_url: resp.url,
            status: resp.status,
            content_type: contentType,
            body,
            anti_bot_signals: antiBotSignals,
            timings: {
                total_ms: Date.now() - started,
            },
        };

        if (env.CRAWLER_CACHE && result.ok && body.length > 0 && body.length <= 900_000) {
            await env.CRAWLER_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: getCacheTtlSeconds(env) });
        }

        return json(200, result);
    } catch (error) {
        return json(200, {
            ok: false,
            url: payload.url,
            final_url: payload.url,
            status: 599,
            error: String(error),
            anti_bot_signals: ["fetch_error"],
            timings: {
                total_ms: Date.now() - started,
            },
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function doRender(payload: FetchPayload, env: Env): Promise<Response> {
    if (!env.BROWSER_RENDERING_API_URL || !env.BROWSER_RENDERING_TOKEN) {
        return json(200, {
            ok: false,
            url: payload.url,
            final_url: payload.url,
            status: 501,
            error: "browser rendering is not configured",
            anti_bot_signals: ["render_not_configured"],
        });
    }

    const started = Date.now();
    try {
        const resp = await fetch(env.BROWSER_RENDERING_API_URL, {
            method: "POST",
            headers: {
                authorization: `Bearer ${env.BROWSER_RENDERING_TOKEN}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                url: payload.url,
            }),
        });

        const text = await resp.text();
        return json(200, {
            ok: resp.ok,
            url: payload.url,
            final_url: payload.url,
            status: resp.status,
            markdown: text,
            anti_bot_signals: [],
            timings: {
                total_ms: Date.now() - started,
            },
        });
    } catch (error) {
        return json(200, {
            ok: false,
            url: payload.url,
            final_url: payload.url,
            status: 599,
            error: String(error),
            anti_bot_signals: ["render_error"],
            timings: {
                total_ms: Date.now() - started,
            },
        });
    }
}

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        if (!isAuthorized(req, env)) {
            return json(401, { ok: false, error: "unauthorized" });
        }

        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/v1/health") {
            return json(200, {
                ok: true,
                version: env.CF_CRAWLER_VERSION ?? "0.1.0",
                browser_rendering: Boolean(env.BROWSER_RENDERING_API_URL && env.BROWSER_RENDERING_TOKEN),
                cache_enabled: Boolean(env.CRAWLER_CACHE),
                now: new Date().toISOString(),
            });
        }

        if (req.method !== "POST") {
            return json(405, { ok: false, error: "method not allowed" });
        }

        let payload: FetchPayload;
        try {
            payload = (await req.json()) as FetchPayload;
        } catch {
            return json(400, { ok: false, error: "invalid json" });
        }

        if (!payload.url) {
            return json(400, { ok: false, error: "url is required" });
        }

        if (url.pathname === "/v1/fetch") {
            return doFetch(payload, env);
        }

        if (url.pathname === "/v1/render") {
            return doRender(payload, env);
        }

        return json(404, { ok: false, error: "not found" });
    },
};
