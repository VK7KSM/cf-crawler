# cf-crawler

`cf-crawler` is a web-scraping tool for `elfclaw / zeroclaw`.

Short version:
- `cf-crawler` handles normal website scraping
- `Agent-Reach` handles platform-specific sources
- they are two separate tools

## What is the relationship between Agent-Reach and cf-crawler?

### What `cf-crawler` is

`cf-crawler` handles normal web pages, for example:
- news articles
- article pages
- listing pages
- pagination pages

It uses Cloudflare Worker / Browser Rendering to access those pages.

### What `Agent-Reach` is

`Agent-Reach` is a platform integration tool.
It mainly handles:
- GitHub
- YouTube
- RSS
- X / Twitter
- and other platforms supported by Agent-Reach itself

### Are they one program?

No.

They are two separate modules:
- `cf-crawler`: separate EXE, separate commands
- `Agent-Reach`: separate Python CLI, separate commands

### Then why does `cf-crawler` have `agent-reach-ensure`?

That command is not a scraping command.
It is only a maintenance command that does 3 things:
- checks whether Agent-Reach is installed
- tries to install it if missing
- runs `doctor` to verify it works

That means:
- you do not need it for normal website scraping
- you do not use it for platform scraping itself
- it is only there to help maintain the Agent-Reach environment

If you later want stricter separation, this command can be removed.

## What is already enabled?

`cf-crawler` is already connected to:
- Cloudflare Workers
- Cloudflare Browser Rendering

That means:
- normal pages can use `fetch`
- harder pages can use `edge_browser`

If `health` returns `browser_rendering: true`, browser mode is working.

## There are 2 different kinds of credentials on the Cloudflare side

### 1. Cloudflare login authorization

Command:
```bash
npx wrangler login
```

Purpose:
- lets you deploy the Worker
- lets you update Worker config and secrets

### 2. `CF_CRAWLER_TOKEN`

Command:
```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

Purpose:
- stops other people from calling your Worker directly
- the local EXE must send this token when calling the Worker

This value is your own random string.
Example:
```text
my-cf-crawler-secret-20260307
```

## How to deploy to Cloudflare

```bash
cd C:\Dev\cf-crawler\worker
npm.cmd install
npx wrangler login
npx wrangler secret put CF_CRAWLER_TOKEN
npx wrangler deploy
```

After deployment, you will get a URL like:
```text
https://cf-crawler-worker.xxx.workers.dev
```

## How the local program connects to the Cloudflare Worker

The local EXE needs two environment variables:
- `CF_CRAWLER_ENDPOINT`
- `CF_CRAWLER_TOKEN`

Example:
```powershell
$env:CF_CRAWLER_ENDPOINT='https://cf-crawler-worker.xxx.workers.dev'
$env:CF_CRAWLER_TOKEN='the same token you set with wrangler secret put'
```

## Main cf-crawler commands

These are the 3 commands used for real scraping.

### 1. `health`

Purpose:
- checks whether the Worker is online
- checks whether Browser Rendering is enabled

Example:
```powershell
cf-crawler-win-x64.exe health --pretty
```

### 2. `scrape-page`

Purpose:
- scrape one page

Example:
```powershell
cf-crawler-win-x64.exe scrape-page --input .\examples\scrape-page.json --pretty
```

Example JSON:
```json
{
  "url": "https://example.com",
  "goal": "extract article",
  "mode": "article",
  "strategy": "auto"
}
```

Forced browser mode:
```json
{
  "url": "https://example.com",
  "goal": "extract article",
  "mode": "article",
  "strategy": "edge_browser"
}
```

### 3. `crawl-site`

Purpose:
- crawl multiple pages starting from a seed page

Example:
```powershell
cf-crawler-win-x64.exe crawl-site --input .\examples\crawl-site.json --pretty
```

Example JSON:
```json
{
  "seed_url": "https://example.com",
  "goal": "collect article list",
  "scope": "same_host",
  "max_pages": 5,
  "depth": 2,
  "strategy": "auto"
}
```

## cf-crawler maintenance command

### `agent-reach-ensure`

Purpose:
- check whether Agent-Reach is installed
- install it if missing
- run `doctor`

This is not a website-scraping command.
It is only a maintenance helper.

Example:
```powershell
cf-crawler-win-x64.exe agent-reach-ensure --pretty
```

## All Agent-Reach commands and examples

If `agent-reach` is not available on PATH, use:
```bash
python -m agent_reach.cli
```

Equivalent commands:
```bash
agent-reach doctor
python -m agent_reach.cli doctor
```

### 1. `setup`

Purpose:
- start the interactive setup flow

Example:
```bash
agent-reach setup
```

### 2. `install`

Purpose:
- install Agent-Reach dependencies

Examples:
```bash
agent-reach install --env auto
agent-reach install --env server
agent-reach install --env auto --safe
agent-reach install --env auto --dry-run
agent-reach install --env server --proxy http://user:pass@ip:port
```

### 3. `configure`

Purpose:
- write config values
- or extract cookies from a browser

Examples:
```bash
agent-reach configure github-token ghp_xxxxxxxxxxxx
agent-reach configure proxy http://user:pass@ip:port
agent-reach configure --from-browser chrome
```

### 4. `doctor`

Purpose:
- show which platforms are working

Example:
```bash
agent-reach doctor
```

### 5. `uninstall`

Purpose:
- remove Agent-Reach config and skill files

Examples:
```bash
agent-reach uninstall
agent-reach uninstall --dry-run
agent-reach uninstall --keep-config
```

### 6. `check-update`

Purpose:
- check for a new version

Example:
```bash
agent-reach check-update
```

### 7. `watch`

Purpose:
- run a quick health check + update check
- useful for scheduled tasks

Example:
```bash
agent-reach watch
```

### 8. `version`

Purpose:
- show the current version

Example:
```bash
agent-reach version
```

## Example input files

- [scrape-page.json](C:/Dev/cf-crawler/examples/scrape-page.json)
- [crawl-site.json](C:/Dev/cf-crawler/examples/crawl-site.json)

## Output format

`cf-crawler` always returns JSON.
Important fields:
- `success`
- `strategy_used`
- `final_url`
- `title`
- `markdown`
- `items`
- `anti_bot_signals`
- `diagnostics`

## How to build the Windows EXE

```bash
npm.cmd install
npm.cmd run build:exe
```

Output file:
- [cf-crawler-win-x64.exe](C:/Dev/cf-crawler/release/cf-crawler-win-x64.exe)

## How elfclaw should use these tools

- normal websites, news sites, article pages, listings, pagination: use `cf-crawler`
- GitHub, YouTube, RSS, X and other platform sources: use `Agent-Reach`
- before scheduled runs:
  - `cf-crawler-win-x64.exe health --pretty`
  - `agent-reach watch`

## Cron templates for elfclaw

### Hourly health check

cron:
```text
0 * * * *
```

command:
```powershell
cf-crawler-win-x64.exe health --pretty
agent-reach watch
```

### Crawl a news listing every 30 minutes

cron:
```text
*/30 * * * *
```

command:
```powershell
cf-crawler-win-x64.exe crawl-site --input C:\path\to\news-list.json --pretty
```

### Scrape key article pages every day at 08:00

cron:
```text
0 8 * * *
```

command:
```powershell
cf-crawler-win-x64.exe scrape-page --input C:\path\to\article.json --pretty
```

### Check Agent-Reach updates every day at 03:00

cron:
```text
0 3 * * *
```

command:
```powershell
agent-reach check-update
```

## References

- Agent-Reach: [https://github.com/Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)
- Crawlee: [https://github.com/apify/crawlee](https://github.com/apify/crawlee)
