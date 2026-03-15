import { launch } from "@cloudflare/playwright";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Env {
    BROWSER: Fetcher;
    CF_CRAWLER_TOKEN?: string;
    CF_CRAWLER_VERSION?: string;
    CRAWLER_CACHE?: KVNamespace;
    CACHE_TTL_SECONDS?: string;
    SESSION_DB?: D1Database;
    CF_API_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
}

interface FetchPayload {
    url: string;
    timeout_ms?: number;
    mode?: string;
    session_id?: string;
    selectors?: string[];
    device_type?: "desktop" | "mobile" | "auto";
}

interface BatchPayload {
    urls: string[];
    mode?: string;
    strategy?: string;
    timeout_ms?: number;
    session_id?: string;
    device_type?: "desktop" | "mobile" | "auto";
}

interface SitemapPayload {
    url: string;
    timeout_ms?: number;
}

interface BypassPayload {
    url: string;
    goal?: string;
    mode?: string;
    timeout_ms?: number;
    session_id?: string;
}

interface LoginPayload {
    session_id: string;
    login_url: string;
    credentials: {
        username_field: string;
        username: string;
        password_field: string;
        password: string;
    };
    submit_selector?: string;
    success_url_contains?: string;
    timeout_ms?: number;
    device_type?: "desktop" | "mobile" | "auto";
}

interface SessionRow {
    session_id: string;
    domain: string;
    cookies: string;
    headers: string | null;
    updated_at: number;
}

interface CrawlProxyPayload {
    url: string;
    formats?: string[];
    render?: boolean;
    max_age?: number;
    timeout_ms?: number;
}

/* ------------------------------------------------------------------ */
/*  UA Pool (20 entries: desktop + mobile)                             */
/* ------------------------------------------------------------------ */

const UA_DESKTOP = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

const UA_MOBILE = [
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
];

const VIEWPORT_DESKTOP = { width: 1920, height: 1080 };
const VIEWPORT_MOBILE = { width: 412, height: 915 };

function hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function pickUA(sessionId: string | undefined, deviceType: "desktop" | "mobile" | "auto" = "auto"): {
    ua: string;
    viewport: { width: number; height: number };
    isMobile: boolean;
} {
    const seed = sessionId ?? crypto.randomUUID();
    const hash = hashString(seed);

    let useMobile: boolean;
    if (deviceType === "mobile") {
        useMobile = true;
    } else if (deviceType === "desktop") {
        useMobile = false;
    } else {
        useMobile = hash % 5 === 0; // 20% chance mobile in auto mode
    }

    const pool = useMobile ? UA_MOBILE : UA_DESKTOP;
    const ua = pool[hash % pool.length];
    const viewport = useMobile ? VIEWPORT_MOBILE : VIEWPORT_DESKTOP;
    return { ua, viewport, isMobile: useMobile };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const challengeMarkers = ["turnstile", "cf-challenge", "attention required", "captcha", "verify you are human"];

function json(status: number, data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

function isAuthorized(req: Request, env: Env): boolean {
    if (!env.CF_CRAWLER_TOKEN) return true;
    const auth = req.headers.get("authorization") ?? "";
    return auth === `Bearer ${env.CF_CRAWLER_TOKEN}`;
}

function buildSignals(status: number, body: string, contentType: string): string[] {
    const signals = new Set<string>();
    const lowerBody = body.toLowerCase();
    if ([403, 429, 503].includes(status)) signals.add(`http_${status}`);
    if (contentType.includes("text/html") && body.length < 300) signals.add("html_too_short");
    if (challengeMarkers.some((m) => lowerBody.includes(m))) signals.add("challenge_marker");
    return Array.from(signals);
}

function getCacheTtlSeconds(env: Env): number {
    const raw = Number(env.CACHE_TTL_SECONDS ?? "120");
    if (!Number.isFinite(raw)) return 120;
    const n = Math.trunc(raw);
    return n < 10 ? 10 : n > 600 ? 600 : n;
}

/* ------------------------------------------------------------------ */
/*  D1 Session helpers                                                 */
/* ------------------------------------------------------------------ */

async function ensureSessionTable(db: D1Database): Promise<void> {
    await db.prepare(
        `CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT NOT NULL,
            domain     TEXT NOT NULL,
            cookies    TEXT NOT NULL DEFAULT '[]',
            headers    TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, domain)
        )`
    ).run();
}

let sessionTableReady = false;
async function ensureSessionTableOnce(db: D1Database): Promise<void> {
    if (sessionTableReady) return;
    await ensureSessionTable(db);
    sessionTableReady = true;
}

async function loadSessionCookies(
    db: D1Database | undefined,
    sessionId: string | undefined,
    domain: string,
): Promise<string | null> {
    if (!db || !sessionId) return null;
    try {
        await ensureSessionTableOnce(db);
        const row = await db
            .prepare("SELECT cookies FROM sessions WHERE session_id = ? AND domain = ?")
            .bind(sessionId, domain)
            .first<{ cookies: string }>();
        return row?.cookies ?? null;
    } catch {
        return null;
    }
}

async function saveSessionCookies(
    db: D1Database | undefined,
    sessionId: string | undefined,
    domain: string,
    cookies: string,
): Promise<void> {
    if (!db || !sessionId) return;
    try {
        await ensureSessionTableOnce(db);
        await db
            .prepare(
                `INSERT INTO sessions (session_id, domain, cookies, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id, domain) DO UPDATE SET cookies = excluded.cookies, updated_at = excluded.updated_at`
            )
            .bind(sessionId, domain, cookies, Date.now())
            .run();
    } catch { /* ignore save failures */ }
}

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function parseCookieHeader(cookiesJson: string): string {
    try {
        const cookies: Array<{ name: string; value: string }> = JSON.parse(cookiesJson);
        if (!Array.isArray(cookies) || cookies.length === 0) return "";
        return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    } catch {
        return "";
    }
}

function mergeSetCookies(
    existingJson: string | null,
    setCookieHeaders: string[],
): string {
    const existing: Array<{ name: string; value: string; [k: string]: unknown }> = existingJson
        ? (() => {
              try { return JSON.parse(existingJson); } catch { return []; }
          })()
        : [];

    const map = new Map<string, { name: string; value: string }>();
    for (const c of existing) {
        map.set(c.name, { name: c.name, value: c.value });
    }
    for (const header of setCookieHeaders) {
        const parts = header.split(";")[0]?.trim();
        if (!parts) continue;
        const eqIdx = parts.indexOf("=");
        if (eqIdx < 1) continue;
        const name = parts.slice(0, eqIdx).trim();
        const value = parts.slice(eqIdx + 1).trim();
        map.set(name, { name, value });
    }
    return JSON.stringify(Array.from(map.values()));
}

/* ------------------------------------------------------------------ */
/*  doFetch — with UA rotation + D1 session cookies                    */
/* ------------------------------------------------------------------ */

async function doFetch(payload: FetchPayload, env: Env): Promise<Response> {
    const cacheKey = `fetch:${payload.url}`;
    if (env.CRAWLER_CACHE) {
        const cached = await env.CRAWLER_CACHE.get(cacheKey, "json");
        if (cached) {
            return json(200, { ...(cached as Record<string, unknown>), cache_hit: true });
        }
    }

    const started = Date.now();
    const { ua } = pickUA(payload.session_id, payload.device_type);
    const domain = extractDomain(payload.url);

    const headers: Record<string, string> = {
        "user-agent": ua,
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    };

    // Inject session cookies
    const existingCookiesJson = await loadSessionCookies(env.SESSION_DB, payload.session_id, domain);
    const cookieHeader = existingCookiesJson ? parseCookieHeader(existingCookiesJson) : "";
    if (cookieHeader) {
        headers.cookie = cookieHeader;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), payload.timeout_ms ?? 15000);

    try {
        const resp = await fetch(payload.url, {
            method: "GET",
            headers,
            redirect: "follow",
            signal: controller.signal,
        });

        const body = await resp.text();
        const contentType = resp.headers.get("content-type") ?? "";
        const antiBotSignals = buildSignals(resp.status, body, contentType);

        // Persist Set-Cookie back to D1
        const setCookieHeader = resp.headers.get("set-cookie") ?? "";
        const setCookies = setCookieHeader ? setCookieHeader.split(/,(?=\s*\w+=)/) : [];
        if (setCookies.length > 0 && payload.session_id) {
            const merged = mergeSetCookies(existingCookiesJson, setCookies);
            await saveSessionCookies(env.SESSION_DB, payload.session_id, domain, merged);
        }

        const result = {
            ok: resp.ok,
            url: payload.url,
            final_url: resp.url,
            status: resp.status,
            content_type: contentType,
            body,
            anti_bot_signals: antiBotSignals,
            timings: { total_ms: Date.now() - started },
        };

        if (env.CRAWLER_CACHE && result.ok && body.length > 0 && body.length <= 900_000) {
            await env.CRAWLER_CACHE.put(cacheKey, JSON.stringify(result), {
                expirationTtl: getCacheTtlSeconds(env),
            });
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
            timings: { total_ms: Date.now() - started },
        });
    } finally {
        clearTimeout(timeout);
    }
}

/* ------------------------------------------------------------------ */
/*  doRender — with UA rotation + viewport + D1 session cookies        */
/* ------------------------------------------------------------------ */

async function doRender(payload: FetchPayload, env: Env): Promise<Response> {
    if (!env.BROWSER) {
        return json(200, {
            ok: false,
            url: payload.url,
            final_url: payload.url,
            status: 501,
            error: "browser rendering binding is not configured",
            anti_bot_signals: ["render_not_configured"],
        });
    }

    const started = Date.now();
    const { ua, viewport, isMobile } = pickUA(payload.session_id, payload.device_type);
    const domain = extractDomain(payload.url);
    let browser: Awaited<ReturnType<typeof launch>> | undefined;

    try {
        browser = await launch(env.BROWSER);
        const contextOpts: Record<string, unknown> = {
            userAgent: ua,
            viewport,
            isMobile,
            extraHTTPHeaders: {
                "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        };
        const context = await browser.newContext(contextOpts);

        // Inject session cookies from D1
        const existingCookiesJson = await loadSessionCookies(env.SESSION_DB, payload.session_id, domain);
        if (existingCookiesJson) {
            try {
                const cookies: Array<{ name: string; value: string }> = JSON.parse(existingCookiesJson);
                if (Array.isArray(cookies) && cookies.length > 0) {
                    await context.addCookies(
                        cookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" })),
                    );
                }
            } catch { /* ignore bad json */ }
        }

        const page = await context.newPage();
        await page.goto(payload.url, {
            waitUntil: "domcontentloaded",
            timeout: payload.timeout_ms ?? 30000,
        });
        await page.waitForTimeout(1500);

        const title = await page.title();
        const html = await page.content();
        const finalUrl = page.url();
        const antiBotSignals = buildSignals(200, html, "text/html");

        // Screenshot capture (mode=screenshot)
        let screenshotBase64: string | undefined;
        if (payload.mode === "screenshot") {
            const buffer = await page.screenshot({ type: "png", fullPage: true });
            const bytes = new Uint8Array(buffer);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            screenshotBase64 = btoa(binary);
        }

        // Export cookies and save to D1
        const browserCookies = await context.cookies();
        if (browserCookies.length > 0 && payload.session_id) {
            const cookiesJson = JSON.stringify(
                browserCookies.map((c: { name: string; value: string }) => ({ name: c.name, value: c.value })),
            );
            await saveSessionCookies(env.SESSION_DB, payload.session_id, domain, cookiesJson);
        }

        await context.close();
        await browser.close();
        browser = undefined;

        return json(200, {
            ok: true,
            url: payload.url,
            final_url: finalUrl,
            status: 200,
            title,
            html,
            screenshot_base64: screenshotBase64,
            content_type: "text/html; charset=utf-8",
            anti_bot_signals: antiBotSignals,
            timings: { total_ms: Date.now() - started },
        });
    } catch (error) {
        if (browser) await browser.close();
        return json(200, {
            ok: false,
            url: payload.url,
            final_url: payload.url,
            status: 599,
            error: String(error),
            anti_bot_signals: ["render_error"],
            timings: { total_ms: Date.now() - started },
        });
    }
}

/* ------------------------------------------------------------------ */
/*  POST /v1/batch-fetch                                               */
/* ------------------------------------------------------------------ */

async function doBatchFetch(payload: BatchPayload, env: Env): Promise<Response> {
    const started = Date.now();
    const urls = (payload.urls ?? []).slice(0, 20); // hard cap
    if (urls.length === 0) {
        return json(400, { ok: false, error: "urls array is required and must not be empty" });
    }

    const results = await Promise.allSettled(
        urls.map((url) =>
            doFetch(
                {
                    url,
                    timeout_ms: payload.timeout_ms,
                    mode: payload.mode,
                    session_id: payload.session_id,
                    device_type: payload.device_type,
                },
                env,
            ).then(async (r) => r.json()),
        ),
    );

    const output = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return {
            ok: false,
            url: urls[i],
            status: 599,
            error: String(r.reason),
            anti_bot_signals: ["batch_error"],
        };
    });

    return json(200, {
        ok: true,
        results: output,
        timings: { total_ms: Date.now() - started, count: urls.length },
    });
}

/* ------------------------------------------------------------------ */
/*  POST /v1/sitemap                                                   */
/* ------------------------------------------------------------------ */

async function doSitemap(payload: SitemapPayload, env: Env): Promise<Response> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), payload.timeout_ms ?? 15000);

    try {
        const resp = await fetch(payload.url, {
            headers: { "user-agent": UA_DESKTOP[0] },
            signal: controller.signal,
        });
        const text = await resp.text();
        clearTimeout(timeout);

        const isSitemapIndex = text.includes("<sitemapindex");
        let urls: string[] = [];

        if (isSitemapIndex) {
            // Extract child sitemap URLs and fetch each
            const childUrls = extractLocsFromXml(text);
            const childResults = await Promise.allSettled(
                childUrls.slice(0, 10).map(async (childUrl) => {
                    const childResp = await fetch(childUrl, {
                        headers: { "user-agent": UA_DESKTOP[0] },
                    });
                    const childText = await childResp.text();
                    return extractLocsFromXml(childText);
                }),
            );
            for (const r of childResults) {
                if (r.status === "fulfilled") urls.push(...r.value);
            }
        } else {
            urls = extractLocsFromXml(text);
        }

        // Deduplicate
        urls = Array.from(new Set(urls));

        return json(200, {
            ok: true,
            urls,
            count: urls.length,
            is_index: isSitemapIndex,
            timings: { total_ms: Date.now() - started },
        });
    } catch (error) {
        clearTimeout(timeout);
        return json(200, {
            ok: false,
            urls: [],
            count: 0,
            is_index: false,
            error: String(error),
            timings: { total_ms: Date.now() - started },
        });
    }
}

function extractLocsFromXml(xml: string): string[] {
    const urls: string[] = [];
    const regex = /<loc>\s*(.*?)\s*<\/loc>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        const url = match[1].trim();
        if (url) urls.push(url);
    }
    return urls;
}

/* ------------------------------------------------------------------ */
/*  POST /v1/bypass — paywall bypass multi-strategy cascade            */
/* ------------------------------------------------------------------ */

const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const PAYWALL_MARKERS = [
    "subscribe to continue",
    "subscription required",
    "create a free account",
    "sign in to read",
    "paywall",
    "premium content",
    "members only",
    "for subscribers",
    "register to read",
    "unlock this article",
];

async function doBypass(payload: BypassPayload, env: Env): Promise<Response> {
    const started = Date.now();
    const timeoutMs = payload.timeout_ms ?? 15000;

    // Strategy 1: Googlebot UA impersonation
    try {
        const controller1 = new AbortController();
        const t1 = setTimeout(() => controller1.abort(), timeoutMs);
        const resp1 = await fetch(payload.url, {
            headers: {
                "user-agent": GOOGLEBOT_UA,
                "accept-language": "en-US,en;q=0.9",
            },
            redirect: "follow",
            signal: controller1.signal,
        });
        clearTimeout(t1);
        const body1 = await resp1.text();

        if (resp1.ok && body1.length > 500) {
            const lower = body1.toLowerCase();
            const hasPaywallMarker = PAYWALL_MARKERS.some((m) => lower.includes(m));
            if (!hasPaywallMarker) {
                return json(200, {
                    ok: true,
                    url: payload.url,
                    final_url: resp1.url,
                    status: resp1.status,
                    content_type: resp1.headers.get("content-type") ?? "",
                    body: body1,
                    bypass_strategy_used: "googlebot_ua",
                    anti_bot_signals: [],
                    timings: { total_ms: Date.now() - started },
                });
            }
        }
    } catch { /* continue to next strategy */ }

    // Strategy 2: Google AMP Cache
    try {
        const parsed = new URL(payload.url);
        const ampUrl = `https://${parsed.hostname.replace(/\./g, "-")}.cdn.ampproject.org/c/s/${parsed.hostname}${parsed.pathname}`;
        const controller2 = new AbortController();
        const t2 = setTimeout(() => controller2.abort(), timeoutMs);
        const resp2 = await fetch(ampUrl, {
            headers: { "user-agent": UA_DESKTOP[0] },
            redirect: "follow",
            signal: controller2.signal,
        });
        clearTimeout(t2);
        const body2 = await resp2.text();

        if (resp2.ok && (body2.includes("<html amp") || body2.includes("<html ⚡"))) {
            return json(200, {
                ok: true,
                url: payload.url,
                final_url: resp2.url,
                status: resp2.status,
                content_type: resp2.headers.get("content-type") ?? "",
                body: body2,
                bypass_strategy_used: "google_amp_cache",
                anti_bot_signals: [],
                timings: { total_ms: Date.now() - started },
            });
        }
    } catch { /* continue */ }

    // Strategy 3: Wayback Machine latest snapshot
    try {
        const controller3 = new AbortController();
        const t3 = setTimeout(() => controller3.abort(), timeoutMs);
        const wbResp = await fetch(
            `https://archive.org/wayback/available?url=${encodeURIComponent(payload.url)}`,
            { signal: controller3.signal },
        );
        clearTimeout(t3);
        const wbJson = (await wbResp.json()) as {
            archived_snapshots?: { closest?: { url?: string; available?: boolean } };
        };

        const snapshot = wbJson?.archived_snapshots?.closest;
        if (snapshot?.available && snapshot?.url) {
            const controller3b = new AbortController();
            const t3b = setTimeout(() => controller3b.abort(), timeoutMs);
            const snapResp = await fetch(snapshot.url, {
                headers: { "user-agent": UA_DESKTOP[0] },
                redirect: "follow",
                signal: controller3b.signal,
            });
            clearTimeout(t3b);
            const snapBody = await snapResp.text();

            if (snapResp.ok && snapBody.length > 500) {
                return json(200, {
                    ok: true,
                    url: payload.url,
                    final_url: snapshot.url,
                    status: snapResp.status,
                    content_type: snapResp.headers.get("content-type") ?? "",
                    body: snapBody,
                    bypass_strategy_used: "wayback_machine",
                    anti_bot_signals: [],
                    timings: { total_ms: Date.now() - started },
                });
            }
        }
    } catch { /* continue */ }

    // Strategy 4: Standard fallback (normal doFetch)
    const fallback = await doFetch(
        { url: payload.url, timeout_ms: timeoutMs, mode: payload.mode, session_id: payload.session_id },
        env,
    );
    const fallbackData = (await fallback.json()) as Record<string, unknown>;
    return json(200, {
        ...fallbackData,
        bypass_strategy_used: "standard_fallback",
    });
}

/* ------------------------------------------------------------------ */
/*  POST /v1/login — automated form-based login via Playwright         */
/* ------------------------------------------------------------------ */

async function doLogin(payload: LoginPayload, env: Env): Promise<Response> {
    if (!env.BROWSER) {
        return json(200, { ok: false, error: "browser rendering binding is not configured" });
    }
    if (!env.SESSION_DB) {
        return json(200, { ok: false, error: "SESSION_DB (D1) binding is not configured" });
    }

    await ensureSessionTable(env.SESSION_DB);

    const started = Date.now();
    const { ua, viewport, isMobile } = pickUA(payload.session_id, payload.device_type);
    const domain = extractDomain(payload.login_url);
    let browser: Awaited<ReturnType<typeof launch>> | undefined;

    try {
        browser = await launch(env.BROWSER);
        const context = await browser.newContext({
            userAgent: ua,
            viewport,
            isMobile,
            extraHTTPHeaders: {
                "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        });

        const page = await context.newPage();
        await page.goto(payload.login_url, {
            waitUntil: "domcontentloaded",
            timeout: payload.timeout_ms ?? 30000,
        });
        await page.waitForTimeout(1000);

        // Fill credentials
        await page.fill(payload.credentials.username_field, payload.credentials.username);
        await page.fill(payload.credentials.password_field, payload.credentials.password);

        // Submit
        const submitSelector = payload.submit_selector ?? '[type="submit"]';
        await page.click(submitSelector);

        // Wait for navigation
        await page.waitForLoadState("domcontentloaded", { timeout: payload.timeout_ms ?? 30000 });
        await page.waitForTimeout(2000);

        const finalUrl = page.url();

        // Check success
        if (payload.success_url_contains && !finalUrl.includes(payload.success_url_contains)) {
            await context.close();
            await browser.close();
            return json(200, {
                ok: false,
                session_id: payload.session_id,
                final_url: finalUrl,
                error: `login may have failed: final URL does not contain "${payload.success_url_contains}"`,
                timings: { total_ms: Date.now() - started },
            });
        }

        // Export cookies and save to D1
        const cookies = await context.cookies();
        const cookiesJson = JSON.stringify(
            cookies.map((c: { name: string; value: string }) => ({ name: c.name, value: c.value })),
        );
        await saveSessionCookies(env.SESSION_DB, payload.session_id, domain, cookiesJson);

        await context.close();
        await browser.close();
        browser = undefined;

        return json(200, {
            ok: true,
            session_id: payload.session_id,
            final_url: finalUrl,
            cookies_count: cookies.length,
            timings: { total_ms: Date.now() - started },
        });
    } catch (error) {
        if (browser) await browser.close();
        return json(200, {
            ok: false,
            session_id: payload.session_id,
            error: String(error),
            timings: { total_ms: Date.now() - started },
        });
    }
}

/* ------------------------------------------------------------------ */
/*  POST /v1/crawl — proxy to CF Browser Rendering /crawl REST API     */
/* ------------------------------------------------------------------ */

async function doCrawlProxy(payload: CrawlProxyPayload, env: Env): Promise<Response> {
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
        return json(200, {
            ok: false,
            url: payload.url,
            status: 501,
            error: "CF_API_TOKEN or CF_ACCOUNT_ID not configured",
        });
    }

    const started = Date.now();
    const apiBase = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/crawl`;
    const pollTimeout = payload.timeout_ms ?? 30_000;
    const formats = payload.formats ?? ["markdown", "html"];

    // Step 1: Create crawl job (limit:1 for single page)
    let jobId: string;
    try {
        const createResp = await fetch(apiBase, {
            method: "POST",
            headers: {
                "authorization": `Bearer ${env.CF_API_TOKEN}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                url: payload.url,
                limit: 1,
                formats,
                render: payload.render ?? true,
                maxAge: payload.max_age ?? 86400,
            }),
        });

        if (!createResp.ok) {
            const errText = await createResp.text();
            return json(200, {
                ok: false,
                url: payload.url,
                status: createResp.status,
                error: `crawl job creation failed: ${createResp.status} ${errText}`,
                timings: { total_ms: Date.now() - started },
            });
        }

        const createData = (await createResp.json()) as { result?: { id?: string } };
        jobId = createData?.result?.id ?? "";
        if (!jobId) {
            return json(200, {
                ok: false,
                url: payload.url,
                status: 500,
                error: "crawl job created but no job ID returned",
                timings: { total_ms: Date.now() - started },
            });
        }
    } catch (err) {
        return json(200, {
            ok: false,
            url: payload.url,
            status: 0,
            error: `crawl job creation error: ${err instanceof Error ? err.message : String(err)}`,
            timings: { total_ms: Date.now() - started },
        });
    }

    // Step 2: Poll for completion
    const pollStart = Date.now();
    const pollInterval = 2_000;

    while (Date.now() - pollStart < pollTimeout) {
        await new Promise((r) => setTimeout(r, pollInterval));

        try {
            const statusResp = await fetch(`${apiBase}/${jobId}`, {
                headers: { "authorization": `Bearer ${env.CF_API_TOKEN}` },
            });

            if (!statusResp.ok) continue;

            const statusData = (await statusResp.json()) as {
                result?: {
                    status?: string;
                    records?: Array<{
                        url: string;
                        status: string;
                        html?: string;
                        markdown?: string;
                        metadata?: { status?: number; title?: string; url?: string };
                    }>;
                };
            };

            const jobStatus = statusData?.result?.status;
            if (jobStatus === "completed" || jobStatus === "errored") {
                const records = statusData?.result?.records ?? [];
                const record = records[0];

                if (!record || record.status !== "completed") {
                    return json(200, {
                        ok: false,
                        url: payload.url,
                        status: record?.metadata?.status ?? 0,
                        error: `crawl page status: ${record?.status ?? jobStatus}`,
                        anti_bot_signals: ["crawl_api_failed"],
                        timings: { total_ms: Date.now() - started },
                    });
                }

                return json(200, {
                    ok: true,
                    url: payload.url,
                    final_url: record.metadata?.url ?? record.url,
                    status: record.metadata?.status ?? 200,
                    title: record.metadata?.title,
                    html: record.html,
                    markdown: record.markdown,
                    content_type: "text/html",
                    anti_bot_signals: [],
                    timings: { total_ms: Date.now() - started },
                    crawl_api: true,
                });
            }

            // cancelled states
            if (jobStatus && jobStatus.startsWith("cancelled")) {
                return json(200, {
                    ok: false,
                    url: payload.url,
                    status: 0,
                    error: `crawl job ${jobStatus}`,
                    anti_bot_signals: ["crawl_api_cancelled"],
                    timings: { total_ms: Date.now() - started },
                });
            }
        } catch {
            // poll error, retry
        }
    }

    // Timeout
    return json(200, {
        ok: false,
        url: payload.url,
        status: 0,
        error: `crawl job polling timed out after ${pollTimeout}ms`,
        anti_bot_signals: ["crawl_api_timeout"],
        timings: { total_ms: Date.now() - started },
    });
}

/* ------------------------------------------------------------------ */
/*  Main router                                                        */
/* ------------------------------------------------------------------ */

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url = new URL(req.url);

        // Health check — no auth required
        if (req.method === "GET" && url.pathname === "/v1/health") {
            return json(200, {
                ok: true,
                version: env.CF_CRAWLER_VERSION ?? "0.3.0",
                browser_rendering: Boolean(env.BROWSER),
                cache_enabled: Boolean(env.CRAWLER_CACHE),
                session_db_enabled: Boolean(env.SESSION_DB),
                now: new Date().toISOString(),
            });
        }

        if (!isAuthorized(req, env)) {
            return json(401, { ok: false, error: "unauthorized" });
        }

        // GET /v1/session/:id — query session status
        if (req.method === "GET" && url.pathname.startsWith("/v1/session/")) {
            const sessionId = decodeURIComponent(url.pathname.slice("/v1/session/".length));
            if (!sessionId) return json(400, { ok: false, error: "session_id is required" });
            if (!env.SESSION_DB) return json(200, { ok: false, error: "SESSION_DB not configured" });

            const rows = await env.SESSION_DB
                .prepare("SELECT session_id, domain, cookies, updated_at FROM sessions WHERE session_id = ?")
                .bind(sessionId)
                .all<SessionRow>();

            return json(200, {
                ok: true,
                session_id: sessionId,
                domains: (rows.results ?? []).map((r) => ({
                    domain: r.domain,
                    cookies_count: (() => {
                        try { return JSON.parse(r.cookies).length; } catch { return 0; }
                    })(),
                    updated_at: r.updated_at,
                })),
            });
        }

        // DELETE /v1/session/:id — clear session
        if (req.method === "DELETE" && url.pathname.startsWith("/v1/session/")) {
            const sessionId = decodeURIComponent(url.pathname.slice("/v1/session/".length));
            if (!sessionId) return json(400, { ok: false, error: "session_id is required" });
            if (!env.SESSION_DB) return json(200, { ok: false, error: "SESSION_DB not configured" });

            await env.SESSION_DB
                .prepare("DELETE FROM sessions WHERE session_id = ?")
                .bind(sessionId)
                .run();

            return json(200, { ok: true, session_id: sessionId, deleted: true });
        }

        if (req.method !== "POST") {
            return json(405, { ok: false, error: "method not allowed" });
        }

        // Parse body for POST endpoints
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return json(400, { ok: false, error: "invalid json" });
        }

        // Ensure D1 session table exists (lazy, handled by helpers)

        if (url.pathname === "/v1/fetch") {
            const payload = body as FetchPayload;
            if (!payload.url) return json(400, { ok: false, error: "url is required" });
            return doFetch(payload, env);
        }

        if (url.pathname === "/v1/render") {
            const payload = body as FetchPayload;
            if (!payload.url) return json(400, { ok: false, error: "url is required" });
            return doRender(payload, env);
        }

        if (url.pathname === "/v1/batch-fetch") {
            return doBatchFetch(body as BatchPayload, env);
        }

        if (url.pathname === "/v1/sitemap") {
            const payload = body as SitemapPayload;
            if (!payload.url) return json(400, { ok: false, error: "url is required" });
            return doSitemap(payload, env);
        }

        if (url.pathname === "/v1/bypass") {
            const payload = body as BypassPayload;
            if (!payload.url) return json(400, { ok: false, error: "url is required" });
            return doBypass(payload, env);
        }

        if (url.pathname === "/v1/login") {
            const payload = body as LoginPayload;
            if (!payload.session_id) return json(400, { ok: false, error: "session_id is required" });
            if (!payload.login_url) return json(400, { ok: false, error: "login_url is required" });
            if (!payload.credentials) return json(400, { ok: false, error: "credentials is required" });
            return doLogin(payload, env);
        }

        if (url.pathname === "/v1/crawl") {
            const payload = body as CrawlProxyPayload;
            if (!payload.url) return json(400, { ok: false, error: "url is required" });
            return doCrawlProxy(payload, env);
        }

        return json(404, { ok: false, error: "not found" });
    },
};
