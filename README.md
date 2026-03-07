# cf-crawler

A web scraping tool for `elfclaw / zeroclaw`. **Version 0.3.0**

---

## What It Does

`cf-crawler` is a web crawler. The core flow:

```
Your program → Local EXE → Cloudflare Worker (remote) → Target webpage
```

**No local browser required.** All scraping traffic routes through Cloudflare edge nodes.

Three scraping modes:
- **edge_fetch**: Plain HTTP request. Fast, works for most pages.
- **edge_browser**: Launches a real browser (Cloudflare Browser Rendering). Slower, but bypasses anti-bot systems.
- **paywall_bypass**: Multi-strategy cascade to bypass soft paywalls (Googlebot UA → AMP Cache → Wayback Machine → standard fallback).

With `auto` strategy, the tool decides automatically: tries fetch first, upgrades to browser if it hits anti-bot (403, CAPTCHA, Turnstile).

### v0.3.0 Feature Summary

| Feature | Description |
|---------|-------------|
| KV Cache | Worker-side response caching via Cloudflare KV — same URL returns instantly within TTL |
| UA Rotation | 20 built-in User-Agents (10 desktop + 10 mobile), hash-selected per session_id |
| Device Type | `device_type` parameter for desktop/mobile/auto viewport matching |
| Batch Fetch | Concurrent URL fetching via `/v1/batch-fetch` — configurable `CF_CRAWLER_BATCH_SIZE` |
| Sitemap Parsing | Feed a `sitemap_url` to crawl-site — skips BFS discovery, uses sitemap URLs directly |
| Paywall Bypass | 4-strategy cascade for soft paywall articles |
| D1 Session | Cookie persistence across requests via Cloudflare D1 (SQLite) |
| Login | Automated form-based login via Playwright — stores cookies in D1 for later reuse |
| Session Management | Query/delete sessions via `/v1/session/:id` |
| Crash Recovery | Local SQLite tables (`crawl_runs`, `crawl_queue`) for resume-on-restart |

---

## How It Relates to Agent-Reach

These are two separate tools with different responsibilities:

| Tool | Purpose |
|------|---------|
| `cf-crawler` | Scrape normal websites (news, articles, listings, pagination) |
| `Agent-Reach` | Access platform-style sources (GitHub, YouTube, RSS, Twitter/X, etc.) |

`cf-crawler` includes an `agent-reach-ensure` command, but that is a maintenance command only — it checks and installs Agent-Reach. It does not do any scraping.

---

## Step 1: Deploy the Cloudflare Worker

The local EXE cannot work until you deploy the Worker to Cloudflare.

### Prerequisites

- Node.js 22+
- A Cloudflare account (free tier is fine)

### Deploy Steps

Run these commands in the `worker` directory:

```bash
cd C:\Dev\cf-crawler\worker
npm.cmd install
npx wrangler login
```

After login, set an access token. This token is just a random string you make up — it protects your Worker from being called by strangers:

```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

It will prompt you to type the token value, for example:

```
Enter a secret value: my-cf-crawler-secret-20260307
```

Then deploy:

```bash
npx wrangler deploy
```

On success, you get a URL like:

```
https://cf-crawler-worker.your-account.workers.dev
```

### Cloudflare Services Created During Deploy

The Worker uses these Cloudflare services (all free tier):

| Service | Binding | Purpose | Created How |
|---------|---------|---------|-------------|
| KV | `CRAWLER_CACHE` | Response caching | Already configured in `wrangler.toml` |
| D1 | `SESSION_DB` | Session/cookie storage | Already configured in `wrangler.toml` |
| Browser Rendering | `BROWSER` | Headless browser for anti-bot bypass | Auto-enabled |

If you're deploying for the first time and the KV namespace or D1 database doesn't exist yet, create them:

```bash
# Create KV namespace (if needed)
npx wrangler kv namespace create CRAWLER_CACHE
# Copy the returned namespace_id into wrangler.toml

# Create D1 database (if needed)
npx wrangler d1 create cf-crawler-sessions
# Copy the returned database_id into wrangler.toml
```

### Two Cloudflare Authorizations — Do Not Confuse Them

| Concept | Command | Purpose |
|---------|---------|---------|
| Cloudflare account auth | `npx wrangler login` | Lets this machine deploy Workers |
| CF_CRAWLER_TOKEN | `npx wrangler secret put` | Protects your Worker from unauthorized calls |

These are completely different things. `CF_CRAWLER_TOKEN` is just a string you define yourself. It has nothing to do with your Cloudflare account password.

---

## Step 2: Set Local Environment Variables

The local EXE needs to know where the Worker is and what token to use.

**PowerShell (temporary, current session only):**

```powershell
$env:CF_CRAWLER_ENDPOINT = 'https://cf-crawler-worker.your-account.workers.dev'
$env:CF_CRAWLER_TOKEN    = 'my-cf-crawler-secret-20260307'
```

**Permanent (Windows system environment variables):**

```powershell
[System.Environment]::SetEnvironmentVariable('CF_CRAWLER_ENDPOINT', 'https://cf-crawler-worker.your-account.workers.dev', 'User')
[System.Environment]::SetEnvironmentVariable('CF_CRAWLER_TOKEN', 'my-cf-crawler-secret-20260307', 'User')
```

---

## Step 3: Get the EXE

Download the latest `cf-crawler-win-x64.exe` from GitHub Releases and place it somewhere convenient, e.g. `C:\tools\cf-crawler-win-x64.exe`.

Or build it yourself:

```bash
cd C:\Dev\cf-crawler
npm.cmd install
npm.cmd run build:exe
# Output: release\cf-crawler-win-x64.exe
```

---

## Command Reference

Basic usage:

```
cf-crawler-win-x64.exe <command> [options]
```

Available commands: `health`, `scrape-page`, `crawl-site`, `login`, `agent-reach-ensure`

**CLI flags:**

| Flag | Description |
|------|-------------|
| `--input <file path>` | Read input from a JSON file |
| `--json '<json string>'` | Pass JSON directly as a string (good for scripting) |
| `--pretty` | Pretty-print the output JSON (human-readable). Without this flag, output is compact (machine-readable). |

---

### Command 1: `health` — Health Check

**Purpose:** Check whether the Worker is online, Browser Rendering is available, and all services are working.

**Run this before anything else to confirm everything works.**

```powershell
cf-crawler-win-x64.exe health --pretty
```

**Example output:**

```json
{
  "ok": true,
  "command": "health",
  "endpoint": "https://cf-crawler-worker.xxx.workers.dev",
  "status_code": 200,
  "total_ms": 238,
  "remote": {
    "ok": true,
    "version": "0.3.0",
    "browser_rendering": true,
    "cache_enabled": true,
    "session_db_enabled": true,
    "now": "2026-03-07T12:00:00.000Z"
  },
  "timestamp": "2026-03-07T12:00:00.500Z"
}
```

**Key fields:**

| Field | Meaning |
|-------|---------|
| `ok` | Whether the Worker is reachable |
| `remote.version` | Worker version (should be `0.3.0`) |
| `remote.browser_rendering` | `true` means browser mode is available |
| `remote.cache_enabled` | `true` means KV response caching is active |
| `remote.session_db_enabled` | `true` means D1 session/cookie storage is active |
| `total_ms` | Round-trip time from local to Worker (milliseconds) |

---

### Command 2: `scrape-page` — Scrape One Page

**Purpose:** Fetch and extract content from a single URL.

#### Simplest usage (JSON string directly)

```powershell
cf-crawler-win-x64.exe scrape-page --json '{"url":"https://example.com","goal":"get page content","mode":"article","strategy":"auto"}' --pretty
```

#### Using a file (recommended for complex configs)

Create `my-task.json`:

```json
{
  "url": "https://news.ycombinator.com",
  "goal": "Get today's top article list",
  "mode": "listing",
  "strategy": "auto"
}
```

Then run:

```powershell
cf-crawler-win-x64.exe scrape-page --input my-task.json --pretty
```

#### All parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | — | URL to scrape |
| `goal` | string | ✅ | — | Describe what you want (used for logging, does not affect behavior) |
| `mode` | string | — | `article` | Extraction mode, see table below |
| `strategy` | string | — | `auto` | Scraping strategy, see table below |
| `device_type` | string | — | — | `"desktop"`, `"mobile"`, or `"auto"`. Controls UA selection and viewport size. |
| `selectors` | string[] | — | — | CSS selectors to target specific elements (advanced) |
| `session_id` | string | — | — | Session ID for cookie persistence across requests. Cookies are stored in D1. |
| `persist_path` | string | — | — | Save the result JSON to this file path |

**`mode` options:**

| mode | Description | Best for |
|------|-------------|----------|
| `article` | Extract main article content (title + Markdown body) | News articles, blog posts |
| `listing` | Extract all links and their text from the page | Index pages, list pages, homepages |
| `feed` | Parse RSS/Atom feed content | RSS feed pages |
| `raw` | Return the raw HTML, no extraction | When you need to parse HTML yourself |
| `screenshot` | Take a screenshot (returns image data) | Visual captures |

**`strategy` options:**

| strategy | Description |
|----------|-------------|
| `auto` | Try edge_fetch first, upgrade to edge_browser if anti-bot is detected (recommended) |
| `edge_fetch` | Plain HTTP only, fastest |
| `edge_browser` | Full browser rendering, slower but bypasses anti-bot |
| `paywall_bypass` | Multi-strategy cascade for soft paywalls (see [Paywall Bypass](#paywall-bypass) section) |

**Auto-upgrade triggers (what makes `auto` switch to `edge_browser`):**
- HTTP 403, 429, or 503
- Response body contains `turnstile`, `cf-challenge`, `captcha`, or similar keywords
- Suspiciously short HTML (under 300 characters)

#### Examples for different scenarios

**Scrape an article, let the tool pick the strategy:**
```json
{
  "url": "https://www.bbc.com/news/some-article",
  "goal": "Get the news article body",
  "mode": "article",
  "strategy": "auto"
}
```

**Scrape a listing page, force browser mode to bypass anti-bot:**
```json
{
  "url": "https://news.ycombinator.com",
  "goal": "Get the list of top posts",
  "mode": "listing",
  "strategy": "edge_browser"
}
```

**Scrape with mobile UA and viewport:**
```json
{
  "url": "https://example.com",
  "goal": "Get mobile version of the page",
  "mode": "article",
  "strategy": "auto",
  "device_type": "mobile"
}
```

**Scrape using a session (cookies persist across calls with same session_id):**
```json
{
  "url": "https://example.com/dashboard",
  "goal": "Scrape authenticated page",
  "mode": "article",
  "strategy": "auto",
  "session_id": "my-session-1"
}
```

**Bypass a soft paywall:**
```json
{
  "url": "https://example.com/premium-article",
  "goal": "Get full article behind paywall",
  "mode": "article",
  "strategy": "paywall_bypass"
}
```

**Scrape and save the result to a file:**
```json
{
  "url": "https://example.com",
  "goal": "Scrape and persist",
  "mode": "article",
  "strategy": "auto",
  "persist_path": "./data/result-2026-03-07.json"
}
```

**Use CSS selectors to extract specific elements:**
```json
{
  "url": "https://example.com",
  "goal": "Extract only the main content area",
  "mode": "article",
  "strategy": "auto",
  "selectors": [".main-content", "article", "#post-body"]
}
```

#### Example output

```json
{
  "success": true,
  "strategy_used": "edge_fetch",
  "final_url": "https://example.com/",
  "title": "Example Domain",
  "markdown": "This domain is for use in documentation examples without needing permission.",
  "items": [
    {
      "url": "https://iana.org/domains/example",
      "title": "Learn more",
      "summary": "Learn more"
    }
  ],
  "anti_bot_signals": [],
  "diagnostics": {
    "status": "ok",
    "timings": {
      "total_ms": 84,
      "remote_ms": 11
    },
    "retries": 0,
    "cache_hit": false
  }
}
```

**Output field reference:**

| Field | Description |
|-------|-------------|
| `success` | Whether the scrape succeeded |
| `strategy_used` | Which strategy was actually used (`edge_fetch` or `edge_browser`) |
| `final_url` | Final URL after redirects |
| `title` | Page title |
| `markdown` | Extracted body content in Markdown format |
| `items` | List of links found on the page |
| `items[].url` | Link URL |
| `items[].title` | Link text |
| `items[].summary` | Summary (same as title or more detailed) |
| `anti_bot_signals` | Anti-bot signals detected. Empty array means none. |
| `bypass_strategy_used` | (paywall_bypass only) Which bypass strategy succeeded: `googlebot_ua`, `amp_cache`, `wayback`, or `standard_fallback` |
| `diagnostics.status` | `ok`, `error`, or `empty` |
| `diagnostics.timings.total_ms` | Total local-side elapsed time (ms) |
| `diagnostics.timings.remote_ms` | Worker-side elapsed time (ms) |
| `diagnostics.retries` | Number of retries performed |

---

### Command 3: `crawl-site` — Crawl Multiple Pages

**Purpose:** Start from a seed URL and automatically discover and crawl multiple pages.

#### Basic usage

```powershell
cf-crawler-win-x64.exe crawl-site --input .\examples\crawl-site.json --pretty
```

#### Passing JSON directly

```powershell
cf-crawler-win-x64.exe crawl-site --json '{"seed_url":"https://example.com","goal":"collect all articles","scope":"same_host","max_pages":10,"depth":2,"strategy":"auto"}' --pretty
```

#### All parameters

| Parameter | Type | Required | Default | Range | Description |
|-----------|------|----------|---------|-------|-------------|
| `seed_url` | string | ✅ | — | — | Starting URL |
| `goal` | string | ✅ | — | — | Goal description |
| `scope` | string | — | `same_host` | — | Crawl boundary, see table below |
| `max_pages` | number | — | `20` | 1–200 | Maximum number of pages to crawl |
| `depth` | number | — | `2` | 0–6 | Maximum crawl depth (0 = seed page only) |
| `include_patterns` | string[] | — | — | — | URL must match at least one pattern to be crawled |
| `exclude_patterns` | string[] | — | — | — | URLs matching these patterns are skipped |
| `strategy` | string | — | `auto` | — | Same as scrape-page (`auto`, `edge_fetch`, `edge_browser`) |
| `session_id` | string | — | — | — | Session ID for cookie persistence (shared with login) |
| `sitemap_url` | string | — | — | — | Sitemap XML URL. When set, skips BFS link discovery and uses sitemap URLs as the crawl queue. |
| `device_type` | string | — | — | — | `"desktop"`, `"mobile"`, or `"auto"` |
| `persist_path` | string | — | — | — | Save result to this file |

**`scope` options:**

| scope | Description |
|-------|-------------|
| `same_host` | Only crawl links on the same domain (recommended, most common) |
| `same_path` | Only crawl links under the same path prefix (more restrictive) |
| `custom` | Use `include_patterns` to define the boundary |

**Understanding `depth`:**

```
depth=0  →  Crawl only the seed_url, follow no links
depth=1  →  Crawl the seed_url + links found on it (2 levels total)
depth=2  →  One level deeper than depth=1 (3 levels total)
```

#### Examples for different scenarios

**Crawl a news site, collect up to 20 pages:**
```json
{
  "seed_url": "https://news.ycombinator.com",
  "goal": "Collect today's top articles",
  "scope": "same_host",
  "max_pages": 20,
  "depth": 2,
  "strategy": "auto"
}
```

**Crawl using a sitemap (skip link discovery, use sitemap URLs directly):**
```json
{
  "seed_url": "https://blog.cloudflare.com",
  "goal": "Collect all blog posts from sitemap",
  "scope": "same_host",
  "max_pages": 50,
  "depth": 0,
  "strategy": "auto",
  "sitemap_url": "https://blog.cloudflare.com/sitemap.xml"
}
```

**Crawl with session (authenticated content):**
```json
{
  "seed_url": "https://example.com/members",
  "goal": "Collect member-only articles",
  "scope": "same_path",
  "max_pages": 30,
  "depth": 2,
  "strategy": "auto",
  "session_id": "my-logged-in-session"
}
```

**Only crawl blog posts under `/posts/`:**
```json
{
  "seed_url": "https://example-blog.com/posts/",
  "goal": "Collect all blog posts",
  "scope": "same_path",
  "max_pages": 50,
  "depth": 3,
  "strategy": "auto"
}
```

**Use regex patterns to include only article pages and skip tags/comments:**
```json
{
  "seed_url": "https://example.com",
  "goal": "Collect article pages only",
  "scope": "same_host",
  "max_pages": 30,
  "depth": 3,
  "include_patterns": ["/article/"],
  "exclude_patterns": ["/tag/", "/comment/", "\\?page="],
  "strategy": "auto"
}
```

**Force browser rendering for an anti-bot protected site:**
```json
{
  "seed_url": "https://blog.cloudflare.com",
  "goal": "Collect Cloudflare blog posts",
  "scope": "same_path",
  "max_pages": 10,
  "depth": 2,
  "strategy": "edge_browser"
}
```

**Crawl with mobile device type:**
```json
{
  "seed_url": "https://example.com",
  "goal": "Collect mobile versions of pages",
  "scope": "same_host",
  "max_pages": 10,
  "depth": 1,
  "strategy": "auto",
  "device_type": "mobile"
}
```

#### Example output (condensed)

```json
{
  "success": true,
  "strategy_used": "edge_fetch",
  "final_url": "https://example.com/",
  "title": "Example Domain",
  "markdown": "...",
  "items": [...],
  "anti_bot_signals": [],
  "diagnostics": {
    "status": "ok",
    "timings": {
      "total_ms": 5200,
      "pages": 5
    },
    "retries": 0,
    "cache_hit": false
  },
  "pages": [
    {
      "url": "https://example.com/",
      "final_url": "https://example.com/",
      "status": 200,
      "strategy_used": "edge_fetch",
      "title": "Page Title",
      "markdown": "Body content...",
      "anti_bot_signals": []
    },
    {
      "url": "https://example.com/page2",
      "final_url": "https://example.com/page2",
      "status": 200,
      "strategy_used": "edge_fetch",
      "title": "Page 2 Title",
      "markdown": "...",
      "anti_bot_signals": []
    }
  ]
}
```

`crawl-site` adds a `pages` array to the output. Each element is one crawled page.

**How batch fetching works:** When `CF_CRAWLER_BATCH_SIZE > 1` (default: 3), the scheduler sends multiple URLs to the Worker in a single `/v1/batch-fetch` request. The Worker processes them concurrently via `Promise.allSettled()`. If the batch endpoint fails, it falls back to sequential one-at-a-time fetching automatically.

---

### Command 4: `login` — Automated Login

**Purpose:** Automate form-based login on a website, capture cookies, and store them in Cloudflare D1 for reuse by `scrape-page` and `crawl-site`.

#### Basic usage

```powershell
cf-crawler-win-x64.exe login --json '{
  "session_id": "my-session",
  "login_url": "https://example.com/login",
  "credentials": {
    "username_field": "#email",
    "username": "user@example.com",
    "password_field": "#password",
    "password": "secret"
  }
}' --pretty
```

#### All parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | ✅ | — | Session name to store cookies under. Use this same ID later in `scrape-page` or `crawl-site`. |
| `login_url` | string | ✅ | — | URL of the login page |
| `credentials.username_field` | string | ✅ | — | CSS selector or `name` attribute of the username/email input field |
| `credentials.username` | string | ✅ | — | Username or email to fill in |
| `credentials.password_field` | string | ✅ | — | CSS selector or `name` attribute of the password input field |
| `credentials.password` | string | ✅ | — | Password to fill in |
| `submit_selector` | string | — | `[type=submit]` | CSS selector of the submit button |
| `success_url_contains` | string | — | — | String that the post-login URL should contain (used to verify login succeeded) |

#### How it works

1. Opens `login_url` in Cloudflare Browser Rendering (Playwright)
2. Fills in the username and password fields using the specified selectors
3. Clicks the submit button
4. Waits for navigation to complete
5. Captures all browser cookies → stores in D1 under `session_id`
6. Returns success status and cookie count

#### Example output

```json
{
  "success": true,
  "ok": true,
  "session_id": "my-session",
  "final_url": "https://example.com/dashboard",
  "cookies_count": 5,
  "diagnostics": {
    "status": "ok",
    "timings": {
      "total_ms": 3500,
      "remote_ms": 3200
    },
    "retries": 0,
    "cache_hit": false
  }
}
```

#### Full login workflow example

**Step 1: Login and capture cookies**
```powershell
cf-crawler-win-x64.exe login --json '{
  "session_id": "forum-session",
  "login_url": "https://forum.example.com/login",
  "credentials": {
    "username_field": "input[name=email]",
    "username": "myemail@example.com",
    "password_field": "input[name=password]",
    "password": "mypassword123"
  },
  "submit_selector": "button.login-btn",
  "success_url_contains": "/dashboard"
}' --pretty
```

**Step 2: Scrape authenticated content using the session**
```powershell
cf-crawler-win-x64.exe scrape-page --json '{
  "url": "https://forum.example.com/members-only/article",
  "goal": "Get member-only article",
  "mode": "article",
  "strategy": "auto",
  "session_id": "forum-session"
}' --pretty
```

**Step 3: Crawl authenticated pages**
```powershell
cf-crawler-win-x64.exe crawl-site --json '{
  "seed_url": "https://forum.example.com/members-only/",
  "goal": "Collect all member articles",
  "scope": "same_path",
  "max_pages": 20,
  "depth": 2,
  "strategy": "auto",
  "session_id": "forum-session"
}' --pretty
```

The cookies stored under `forum-session` are automatically injected into every request. New cookies from responses are also saved back to D1.

---

### Command 5: `agent-reach-ensure` — Maintain the Agent-Reach Environment

**This is not a scraping command.** It checks and installs Agent-Reach.

```powershell
cf-crawler-win-x64.exe agent-reach-ensure --pretty
```

The command searches for Agent-Reach in this order:

1. Checks the `AGENT_REACH_COMMAND` environment variable first
2. Looks for `xreach` or `agent-reach` on system PATH
3. Tries `python -m agent_reach.cli` and `python -m agent_reach`

If found, it checks the version and auto-updates if needed (requires `uv` or `pip`).

**Example output:**

```json
{
  "success": true,
  "installed": false,
  "updated": false,
  "command": "python -m agent_reach.cli",
  "current_version": "1.3.0",
  "actions": [],
  "doctor": {
    "ok": true,
    "output": "✅ GitHub — fully available\n❌ YouTube — yt-dlp not installed\n..."
  },
  "details": []
}
```

**Output fields:**

| Field | Description |
|-------|-------------|
| `installed` | Whether an installation was just performed (it was missing before) |
| `updated` | Whether an upgrade was just performed |
| `command` | The working command that was found |
| `current_version` | Currently installed version |
| `doctor.ok` | Whether the health check passed |
| `doctor.output` | Full output of `agent-reach doctor` |

---

## All Environment Variables

| Variable | Required | Default | Range | Description |
|----------|----------|---------|-------|-------------|
| `CF_CRAWLER_ENDPOINT` | ✅ | `http://127.0.0.1:8787` | — | Worker URL |
| `CF_CRAWLER_TOKEN` | — | none | — | Worker access token (must also be set in Worker via wrangler) |
| `CF_CRAWLER_TIMEOUT_MS` | — | `20000` | 1000–120000 | Per-request timeout (milliseconds) |
| `CF_CRAWLER_BATCH_SIZE` | — | `3` | 1–10 | Number of URLs to fetch concurrently per batch. Default 3 aligns with Browser Rendering's free-tier 3-concurrent limit. |
| `CF_CRAWLER_DB_PATH` | — | none | — | Local SQLite database path. When set, enables crash recovery (crawl resume on restart). |
| `CF_CRAWLER_HOST_COOLDOWN_MS` | — | `1200` | 100–60000 | Minimum interval between requests to the same domain (ms) |
| `CF_CRAWLER_MAX_RETRIES` | — | `2` | 0–8 | Max retry attempts per request |
| `CF_CRAWLER_ALLOWED_HOSTS` | — | none | — | Domain whitelist (comma-separated). When set, only these domains can be scraped. |
| `CF_CRAWLER_BLOCK_PRIVATE_IP` | — | `true` | — | Block scraping private/local IPs (prevents SSRF attacks) |
| `AGENT_REACH_COMMAND` | — | none | — | Manually specify the agent-reach executable path |
| `AGENT_REACH_MIN_VERSION` | — | none | — | Minimum required Agent-Reach version |
| `AGENT_REACH_AUTO_UPDATE` | — | `true` | — | Auto-update Agent-Reach if outdated |
| `AGENT_REACH_TIMEOUT_MS` | — | `90000` | 5000–600000 | Agent-Reach operation timeout (ms) |

**PowerShell example:**

```powershell
# Required
$env:CF_CRAWLER_ENDPOINT = 'https://cf-crawler-worker.xxx.workers.dev'
$env:CF_CRAWLER_TOKEN    = 'your-token-here'

# Optional tuning
$env:CF_CRAWLER_TIMEOUT_MS       = '30000'   # 30 second timeout
$env:CF_CRAWLER_HOST_COOLDOWN_MS = '2000'    # 2 second per-domain cooldown
$env:CF_CRAWLER_MAX_RETRIES      = '3'       # retry up to 3 times
$env:CF_CRAWLER_BATCH_SIZE       = '5'       # fetch 5 URLs concurrently per batch

# Enable crash recovery
$env:CF_CRAWLER_DB_PATH = 'C:\data\cf-crawler.db'

# Restrict to specific domains only
$env:CF_CRAWLER_ALLOWED_HOSTS = 'example.com,news.ycombinator.com'
```

---

## Session Management

Sessions store cookies in Cloudflare D1, persisted across requests. Sessions are created automatically when you use `login` or when a `session_id` is passed to `scrape-page`/`crawl-site`.

### Querying a Session

To check what cookies are stored in a session, send a GET request directly to the Worker:

```bash
curl https://cf-crawler-worker.xxx.workers.dev/v1/session/my-session \
  -H "Authorization: Bearer your-token-here"
```

### Deleting a Session

To log out / clear a session:

```bash
curl -X DELETE https://cf-crawler-worker.xxx.workers.dev/v1/session/my-session \
  -H "Authorization: Bearer your-token-here"
```

---

## Paywall Bypass

`scrape-page` with `strategy: "paywall_bypass"` attempts to retrieve full article content from sites with soft paywalls using a multi-strategy cascade.

### Strategies (tried in order until one succeeds)

| Priority | Strategy | Method |
|----------|---------|--------|
| 1 | Googlebot impersonation | `User-Agent: Googlebot/2.1` — many publishers grant search crawlers full access |
| 2 | Google AMP Cache | Converts URL to `cdn.ampproject.org` format — serves AMP-enabled articles without paywall |
| 3 | Wayback Machine snapshot | Fetches the most recent archived copy via `archive.org/wayback/available` API |
| 4 | Standard fallback | Falls back to the normal `edge_fetch` / `edge_browser` pipeline |

### Usage

```json
{
  "url": "https://example.com/premium-article",
  "goal": "Get full article body",
  "mode": "article",
  "strategy": "paywall_bypass"
}
```

The output includes a `bypass_strategy_used` field indicating which strategy succeeded (e.g. `"googlebot_ua"`, `"amp_cache"`, `"wayback"`, or `"standard_fallback"`).

### Notes on Effectiveness

- **Googlebot UA**: Effective for many traditional publishers. Reliability has decreased as publishers add secondary verification checks.
- **AMP Cache**: Effective for AMP-enabled articles. Coverage is shrinking as Google phases out AMP.
- **Wayback Machine**: Most reliable source for archived content. May not have today's article yet.
- **12ft.io**: Was a popular bypass proxy but was shut down in July 2025 under pressure from the News Media Alliance. Not used.

### Legal Notice

Bypassing paywalls may violate a target site's Terms of Service. All methods used here (Googlebot UA, Google AMP Cache, Wayback Machine API) rely on publicly available interfaces. Users are responsible for ensuring their use complies with applicable laws and terms of service.

---

## Crash Recovery

When `CF_CRAWLER_DB_PATH` is set, `crawl-site` persists crawl progress to a local SQLite database.

### How it works

1. When a crawl starts, it creates a record in the `crawl_runs` table with status `running`
2. Each URL's status (`pending`, `done`, `error`) is tracked in the `crawl_queue` table
3. If the process crashes or is interrupted (Ctrl+C), the run stays in `running` state
4. On restart with the same `seed_url` and config, the scheduler detects the incomplete run and resumes from `pending` URLs only — already-completed URLs are skipped

### Enable crash recovery

```powershell
$env:CF_CRAWLER_DB_PATH = 'C:\data\cf-crawler.db'
```

The database file and tables are created automatically on first use.

---

## Agent-Reach Command Reference

If `agent-reach` is not on your PATH, use:

```bash
python -m agent_reach.cli <command>
```

These two forms are identical:

```bash
agent-reach doctor
python -m agent_reach.cli doctor
```

### `setup` — Interactive setup wizard

```bash
agent-reach setup
```

Run this after first install. Guides you through configuration.

### `install` — Install dependencies

```bash
# Auto-detect environment and install appropriate dependencies
agent-reach install --env auto

# Server mode (no desktop environment)
agent-reach install --env server

# Safe mode: install minimal required dependencies only
agent-reach install --env auto --safe

# Dry run: show what would be installed without doing it
agent-reach install --env auto --dry-run

# Use a proxy
agent-reach install --env server --proxy http://user:pass@ip:port
```

### `configure` — Write config or extract browser cookies

```bash
# Set GitHub token (for private repos or higher API rate limits)
agent-reach configure github-token ghp_xxxxxxxxxxxxxxxxxxxx

# Set proxy
agent-reach configure proxy http://user:pass@ip:port

# Extract cookies from your local browser (for platforms requiring login)
agent-reach configure --from-browser chrome
agent-reach configure --from-browser firefox
```

### `doctor` — Health check

```bash
agent-reach doctor
```

Shows which platforms are working and what needs to be configured.

**Example output:**

```
✅ GitHub repositories — fully available
❌ YouTube videos — yt-dlp not installed. Install: pip install yt-dlp
✅ RSS/Atom feeds — readable
✅ Any webpage — readable via Jina Reader

Status: 3/13 channels available
Run `agent-reach setup` to unlock more channels
```

### `check-update` — Check for updates

```bash
agent-reach check-update
```

### `watch` — Quick health + update check (good for scheduled tasks)

```bash
agent-reach watch
```

Runs health check and update check in one command.

### `uninstall` — Uninstall

```bash
# Full uninstall
agent-reach uninstall

# Dry run: show what would be removed
agent-reach uninstall --dry-run

# Keep config files, remove only skill files
agent-reach uninstall --keep-config
```

### `version` — Show version

```bash
agent-reach version
```

---

## How to Save Results

Two ways to persist scraping output:

### 1. Write to a JSON file (recommended)

Add `persist_path` to your input:

```json
{
  "url": "https://example.com",
  "goal": "test",
  "mode": "article",
  "strategy": "auto",
  "persist_path": "./data/runs/result-2026-03-07.json"
}
```

### 2. Redirect stdout

```powershell
cf-crawler-win-x64.exe scrape-page --input task.json > result.json
```

Note: Log lines (`level`, `time`, `msg` fields) go to `stderr`. The result JSON goes to `stdout`. Redirecting `>` won't mix log output into the result file.

---

## Rules for elfclaw / zeroclaw

**Which tool to use:**

```
Normal websites (news, articles, listings, pagination)  →  cf-crawler
Platform sources (GitHub, YouTube, RSS, Twitter)         →  Agent-Reach
```

**Always run a health check before starting tasks:**

```powershell
cf-crawler-win-x64.exe health --pretty
agent-reach watch
```

**Cron job templates:**

```
# Hourly health check
0 * * * *    cf-crawler-win-x64.exe health --pretty && agent-reach watch

# Crawl news listing every 30 minutes
*/30 * * * * cf-crawler-win-x64.exe crawl-site --input C:\tasks\news-list.json

# Scrape key article pages at 08:00 every day
0 8 * * *    cf-crawler-win-x64.exe scrape-page --input C:\tasks\article.json

# Check Agent-Reach for updates at 03:00 every day
0 3 * * *    agent-reach check-update
```

---

## Building the EXE Yourself

```bash
cd C:\Dev\cf-crawler
npm.cmd install
npm.cmd run build:exe
```

Output: `release\cf-crawler-win-x64.exe`

GitHub Actions automatically builds the EXE on every push to `main` and updates the `latest` Release. Tagging a commit as `v1.0.0` creates a versioned Release.

---

## Comparison with Crawlee

cf-crawler draws on Crawlee's design ideas but serves a different purpose: Crawlee is a local-run crawler **framework**, cf-crawler is a Cloudflare-backed crawler **tool**. Here is a detailed comparison.

### Crawlee Core Features That cf-crawler Has Implemented

| Feature | Crawlee Implementation | cf-crawler Implementation | Notes |
|---------|----------------------|--------------------------|-------|
| URL queue | `RequestQueue` (BFS/DFS) | `queue.ts` (BFS FIFO) | cf-crawler is breadth-first only |
| Request deduplication | `uniqueKey`-based | URL exact match + content SHA256 hash | cf-crawler adds content-level dedup |
| Rate limiting | `AutoscaledPool` dynamic concurrency | `rate_limit.ts` per-host cooldown | Different approaches |
| Retry logic | Exponential backoff + multiple error types | `retry.ts` exponential backoff | cf-crawler has one retry type only |
| Anti-bot upgrade | None built-in (manual) | `decision.ts` auto-upgrades fetch → browser | cf-crawler has a unique advantage here |
| Content extraction | Cheerio/JSDOM integration | `extractors/` (article, listing, pagination) | cf-crawler has higher-level extraction |
| URL filtering | globs + regex + transform functions | `include_patterns` / `exclude_patterns` regex | Crawlee is more flexible |
| Result persistence | `Dataset` (structured) + `KeyValueStore` | JSON files + optional SQLite | Comparable |
| Security | None | `url_policy.ts` (SSRF protection, private IP blocking) | cf-crawler unique |
| **Concurrent requests** | `AutoscaledPool` (1–200) | **`/v1/batch-fetch` + `Promise.allSettled()`** | ✅ Implemented in v0.3.0. Default batch size: 3, configurable via `CF_CRAWLER_BATCH_SIZE` (1–10) |
| **Session/Cookie** | `SessionPool` (independent cookie jars) | **D1 sessions table + cookie persistence** | ✅ Implemented in v0.3.0. Cookies persist per `session_id` across requests |
| **Login automation** | Manual (user writes login code) | **`login` command (Playwright form fill)** | ✅ Implemented in v0.3.0. Automated form-based login |
| **Browser fingerprinting** | `fingerprint-generator` (Canvas, WebGL, fonts) | **UA pool (20 entries) + viewport matching** | ✅ Partially implemented. Covers UA, viewport, device type. Canvas/WebGL not customizable. |
| **Crash recovery** | Periodic state persistence | **Local SQLite `crawl_runs`/`crawl_queue`** | ✅ Implemented in v0.3.0 |
| **Sitemap parsing** | `SitemapRequestList` | **`/v1/sitemap` endpoint + `sitemap_url` param** | ✅ Implemented in v0.3.0 |
| **Response caching** | `KeyValueStore` | **Cloudflare KV with TTL** | ✅ Implemented in v0.3.0 |

### Crawlee Features That cf-crawler Does Not Need

| Feature | Why cf-crawler doesn't need it |
|---------|-------------------------------|
| Proxy rotation (`ProxyConfiguration`) | CF Workers route through Cloudflare edge (AS13335) — among the most trusted IPs on the internet. No website blocks CF IPs without breaking their own CDN. This is an architectural advantage, not a limitation. |
| Router / Handler system | cf-crawler is a tool, not a framework — input/output is fixed |
| Multiple crawler types (Cheerio/JSDOM/Playwright/Puppeteer) | cf-crawler delegates rendering to Cloudflare, no local browser |
| Lifecycle hooks (pre/post navigation) | No extension use case currently |
| Event system (`AsyncEventEmitter`) | No subscription use case currently |
| Statistics dashboard | Per-request diagnostics are sufficient |
| Link transform functions (`requestTransform`) | include/exclude regex is sufficient |

### Browser Fingerprinting Details

cf-crawler uses a 20-entry UA pool (10 desktop + 10 mobile) with hash-based selection per `session_id`:

| What cf-crawler controls | What it cannot control |
|--------------------------|----------------------|
| User-Agent (20 realistic UAs) | Canvas fingerprint |
| Viewport size (matched to device type) | WebGL fingerprint |
| Device type (desktop/mobile) | Font enumeration |
| Language headers | Audio context fingerprint |

**Practical impact by target site type:**

| Target site type | Deep fingerprint importance | cf-crawler effectiveness |
|-----------------|--------------------------|--------------------------|
| News / articles / listings | Low | ✅ UA + cookies sufficient |
| Sites using CF Bot Management | Medium | ⚠️ Flagged as bot, but CF IP credibility helps |
| DataDome / PerimeterX / Akamai | High | ❌ Deep fingerprint detection, hard to bypass |

For cf-crawler's target use cases (news, articles, public listings), the controllable fingerprint attributes cover 80–90% of real-world anti-bot scenarios.

### Summary

| Capability | Status |
|-----------|--------|
| Core crawling (queue, dedup, retry, extraction) | ✅ Implemented |
| Anti-bot auto-upgrade (fetch → browser) | ✅ Implemented |
| Security (SSRF protection) | ✅ Implemented |
| Concurrent batch fetching | ✅ Implemented (v0.3.0) |
| Session/Cookie persistence | ✅ Implemented (v0.3.0) |
| Login automation | ✅ Implemented (v0.3.0) |
| Crash recovery | ✅ Implemented (v0.3.0) |
| Sitemap parsing | ✅ Implemented (v0.3.0) |
| Response caching (KV) | ✅ Implemented (v0.3.0) |
| UA rotation + viewport | ✅ Implemented (v0.3.0) |
| Paywall bypass | ✅ Implemented (v0.3.0) |
| Proxy rotation | ✅ Not needed (CF IP advantage) |
| Deep browser fingerprinting | ⚠️ Partial (UA/viewport only, sufficient for target use cases) |

---

## Cloudflare Free Tier Usage

All Cloudflare services used by cf-crawler are within the free tier:

| CF Service | Free Quota | How cf-crawler Uses It |
|------------|-----------|----------------------|
| Workers | 100K req/day, 10ms CPU (I/O free) | All API endpoints |
| KV | 100K reads/day, 1K writes/day, 1GB | Response caching (write quota is tight) |
| D1 (SQLite) | 5M reads/day, 100K writes/day, 5GB | Session/cookie storage |
| Browser Rendering | **10 min/day**, 3 concurrent | ~120–300 pages/day (2–5s each) |

---

## References

- [Agent-Reach](https://github.com/Panniantong/Agent-Reach) — Platform-specific data access tool
- [Crawlee](https://github.com/apify/crawlee) — Web scraping and browser automation library for Node.js
