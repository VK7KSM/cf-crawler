#!/usr/bin/env node
// elfClaw local browser fetcher.
//
// Runs the machine's own Chrome against a persistent profile, so pages that
// need JavaScript (venue calendars, shop rosters) and pages behind a login the
// OWNER established themselves can be read. The profile is the same one the
// owner uses in `login` mode, so whatever session they created by hand is
// reused here.
//
// Anti-detection (reversed an earlier "no stealth" decision, by owner request
// 2026-09-25): the automation flags Playwright normally sets are stripped and a
// tiny init script hides navigator.webdriver, so this real Chrome no longer
// announces itself as automated; a short burst of human-like mouse/scroll
// motion runs per page. Because it is a REAL headed Chrome, everything else
// (window.chrome, plugins, codecs, WebGL, languages, TLS) is already genuine and
// left untouched. Still NOT included: TLS-fingerprint spoofing, proxy rotation,
// CAPTCHA solving. If a site still challenges, we report `challenge` and leave it
// to `login` mode (owner clears it once, the session is reused from the profile).
//
// Protocol: one JSON request on stdin, one JSON object per line on stdout.
//   node index.mjs fetch  <<< '{"urls":["https://..."],"wait_ms":3000}'
//   node index.mjs login  <<< '{"url":"https://...","timeout_ms":600000}'

import { chromium } from "playwright-core";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = process.env.CF_BROWSER_PROFILE || join(HERE, "profile");
const CHROME_CANDIDATES = [
    process.env.CF_BROWSER_CHROME,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const DEFAULT_WAIT_MS = 3000;
const DEFAULT_NAV_TIMEOUT_MS = 45000;
/// How long to let the browser work through an interstitial on its own.
const CHALLENGE_WAIT_MS = 15000;
const CHALLENGE_POLL_MS = 1000;
const MAX_URLS = 20;

function chromePath() {
    for (const p of CHROME_CANDIDATES) {
        if (existsSync(p)) return p;
    }
    throw new Error("找不到 Chrome，可设置环境变量 CF_BROWSER_CHROME 指向 chrome.exe");
}

function out(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

async function readStdin() {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    return raw ? JSON.parse(raw) : {};
}

/// A Cloudflare / generic interstitial rather than the real page.
async function looksLikeChallenge(page) {
    const title = (await page.title().catch(() => "")) || "";
    if (/just a moment|one moment please|请稍候|attention required|checking your browser/i.test(title)) {
        return true;
    }
    return await page
        .evaluate(() => {
            const html = document.documentElement.innerHTML;
            return (
                /cdn-cgi\/challenge-platform|__cf_chl_|cf-turnstile|challenges\.cloudflare\.com/.test(html) &&
                document.body.innerText.trim().length < 400
            );
        })
        .catch(() => false);
}

async function launch({ headless, offscreen }) {
    mkdirSync(PROFILE_DIR, { recursive: true });
    const args = [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        // Layer 1: stop Blink from exposing navigator.webdriver.
        "--disable-blink-features=AutomationControlled",
    ];
    // Headed Chrome draws a real window. On the always-on box nobody is
    // watching it, so park it off the visible desktop instead of popping up
    // over the owner's screen. Purely a display choice.
    if (!headless && offscreen) args.push("--window-position=-32000,-32000");
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
        executablePath: chromePath(),
        headless,
        viewport: { width: 1366, height: 900 },
        // Layer 1: drop the "controlled by automated test software" flag
        // Playwright adds by default; it is the other half of the webdriver
        // tell. An array removes only this arg and keeps the rest of the
        // defaults intact.
        ignoreDefaultArgs: ["--enable-automation"],
        args,
    });
    // Layer 2: belt-and-suspenders. Even with the flags gone, blank the
    // webdriver getter before any page script runs. This is a REAL headed
    // Chrome, so window.chrome, plugins, codecs, WebGL vendor and languages
    // are already genuine and consistent with the HTTP headers — we touch
    // nothing else, because faking those would only create fresh mismatches
    // that a stock browser never has.
    await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    return ctx;
}

/// Small integer in [min, max).
function rand(min, max) {
    return Math.floor(min + Math.random() * (max - min));
}

/// Layer 3: a short burst of human-like motion — a few mouse moves and scrolls
/// with uneven pauses — so the visit does not read as an instant headless hit.
/// Pure local code, no model calls. Best-effort: any failure is swallowed so it
/// never blocks the fetch. Worst case adds ~4s per page, well inside the budget.
async function humanize(page) {
    try {
        for (let i = 0, n = rand(2, 5); i < n; i++) {
            await page.mouse.move(rand(80, 1200), rand(80, 700), { steps: rand(6, 16) });
            await page.waitForTimeout(rand(120, 480));
        }
        for (let i = 0, n = rand(1, 3); i < n; i++) {
            await page.mouse.wheel(0, rand(300, 900));
            await page.waitForTimeout(rand(350, 900));
        }
    } catch {
        // 行为模拟失败无所谓，继续抓取
    }
}

async function grab(page, url, waitMs) {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_NAV_TIMEOUT_MS });
    let status = resp ? resp.status() : 0;
    await page.waitForTimeout(waitMs);
    // Layer 3: move like a person before we read or check for a wall. Some
    // JS challenges watch for real interaction, so this runs first.
    await humanize(page);

    // Let the browser resolve an interstitial by itself; we solve nothing.
    let challenged = await looksLikeChallenge(page);
    if (challenged) {
        const deadline = Date.now() + CHALLENGE_WAIT_MS;
        while (Date.now() < deadline) {
            await page.waitForTimeout(CHALLENGE_POLL_MS);
            challenged = await looksLikeChallenge(page);
            if (!challenged) break;
        }
        if (!challenged) {
            await page.waitForTimeout(waitMs);
            status = 200;
        }
    }

    const html = await page.content().catch(() => "");
    const title = (await page.title().catch(() => "")) || "";
    const finalUrl = page.url();
    if (challenged) {
        return {
            ok: false,
            url,
            final_url: finalUrl,
            status,
            title,
            error: "challenge",
            message: "被网站的人机验证页挡住；请用 login 模式在这台机器上手动通过一次，之后会复用该会话",
        };
    }
    return { ok: true, url, final_url: finalUrl, status, title, html };
}

async function cmdFetch(req) {
    const urls = Array.isArray(req.urls) ? req.urls.slice(0, MAX_URLS) : [];
    if (urls.length === 0) throw new Error("fetch 需要 urls 数组");
    const waitMs = Number.isFinite(req.wait_ms) ? Math.max(0, Math.min(req.wait_ms, 30000)) : DEFAULT_WAIT_MS;
    // Headed by default: measured 2026-09-25, headless Chrome is refused by
    // sites that serve the same stock Chrome fine when it has a real window.
    // The window is parked off-desktop (see `launch`).
    const headless = req.headless === true;

    const ctx = await launch({ headless, offscreen: req.offscreen !== false });
    try {
        const page = await ctx.newPage();
        for (const url of urls) {
            try {
                out(await grab(page, url, waitMs));
            } catch (e) {
                out({ ok: false, url, status: 0, error: "fetch_error", message: String(e && e.message ? e.message : e) });
            }
        }
    } finally {
        await ctx.close().catch(() => { });
    }
}

// Headed browser the owner drives themselves: they pass whatever check or
// login the site asks for, close the window, and the session stays in the
// profile for later `fetch` runs.
async function cmdLogin(req) {
    const urls = Array.isArray(req.urls) ? req.urls.slice(0, MAX_URLS) : req.url ? [req.url] : [];
    if (urls.length === 0) throw new Error("login 需要 url 或 urls");
    const timeoutMs = Number.isFinite(req.timeout_ms) ? req.timeout_ms : 900000;

    const ctx = await launch({ headless: false, offscreen: false });
    // One tab per site, so every check can be cleared in a single sitting.
    const first = ctx.pages()[0] || (await ctx.newPage());
    for (let i = 0; i < urls.length; i++) {
        const page = i === 0 ? first : await ctx.newPage();
        await page.goto(urls[i], { waitUntil: "domcontentloaded", timeout: DEFAULT_NAV_TIMEOUT_MS }).catch(() => { });
    }
    out({
        ok: true,
        event: "opened",
        urls,
        profile: PROFILE_DIR,
        message: "浏览器已在本机桌面打开，请逐个标签页完成人机验证或登录，全部做完后关闭整个浏览器窗口",
    });

    const deadline = Date.now() + timeoutMs;
    let closed = false;
    ctx.on("close", () => { closed = true; });
    while (!closed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        if (ctx.pages().length === 0) break;
    }
    const finalUrls = ctx.pages().map((p) => { try { return p.url(); } catch { return ""; } });
    await ctx.close().catch(() => { });
    out({ ok: true, event: "saved", final_urls: finalUrls, profile: PROFILE_DIR, timed_out: !closed && Date.now() >= deadline });
}

const command = process.argv[2];
try {
    const req = await readStdin();
    if (command === "fetch") await cmdFetch(req);
    else if (command === "login") await cmdLogin(req);
    else {
        out({ ok: false, error: "bad_command", message: "用法: index.mjs fetch|login （请求 JSON 从标准输入读入）" });
        process.exit(2);
    }
    process.exit(0);
} catch (e) {
    out({ ok: false, error: "fatal", message: String(e && e.message ? e.message : e) });
    process.exit(1);
}
