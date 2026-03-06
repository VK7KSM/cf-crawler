# cf-crawler

A lightweight external crawler sidecar for `zeroclaw/elfclaw`.

## Why this project exists

`zeroclaw/elfclaw` needs stronger web data collection, but the host machine is low-power (Windows Server 2025, 8 GB RAM). Running local browsers continuously is expensive and unstable. This project keeps heavy browser work on Cloudflare and keeps local processing small and stable.

## References

This project is inspired by:
- Crawlee architecture and crawler patterns
- Agent-Reach platform connectors and operational workflow

## Core advantages

- External tool, not coupled to elfclaw binary
- No local browser process required
- Cloudflare egress IP as scraping exit
- Low local memory/CPU footprint
- Deterministic JSON input/output for easy orchestration

## Cloudflare free resources used

- Workers Free
- Browser Rendering Free
- KV Free (optional cache)
- D1 Free (optional metadata store)

### Free limits (as of 2026-03-06)

| Service | Free limit | Practical meaning |
|---|---:|---|
| Workers | 100,000 requests/day, 1000 req/min, 10 ms CPU/request | Plenty for orchestration and fetch proxy |
| Browser Rendering | 10 minutes/day, 3 concurrent browsers, REST 6 req/min, 60s timeout | Best for high-value pages only |
| KV | 100,000 reads/day, 1,000 writes/day, 1 GB | Small cache + dedupe markers |
| D1 | 5,000,000 rows read/day, 100,000 rows written/day, 5 GB | Crawl metadata and run logs |

### Estimated daily Browser Rendering call budget

| Avg render time per page | Approx pages/day |
|---:|---:|
| 5s | ~120 |
| 8s | ~75 |
| 10s | ~60 |
| 15s | ~40 |

Policy: use `fetch` first, upgrade to rendering only when needed.

## How it works

Local sidecar runs queue/scheduling/extraction, then calls Cloudflare:
- `POST /v1/fetch` for normal pages
- `POST /v1/render` for JS/challenge pages
- `GET /v1/health` for readiness and quota probes

## Program layout (planned)

```text
cf-crawler/
  README.md
  README.zh-CN.md
  package.json
  src/
    cli/
      index.ts
      commands/
        scrape-page.ts
        crawl-site.ts
    core/
      scheduler.ts
      queue.ts
      dedupe.ts
      retry.ts
      rate_limit.ts
    executors/
      cf_fetch.ts
      cf_render.ts
      cf_health.ts
    extractors/
      article.ts
      listing.ts
      pagination.ts
    storage/
      sqlite.ts
      files.ts
    agent_reach/
      bridge.ts
  worker/
    src/index.ts
    wrangler.toml
  data/
    runs/
    cache/
    db/
```

## Data model (planned)

- `runs`
  - `run_id`, `kind(scrape|crawl)`, `seed_url`, `status`, `started_at`, `finished_at`
- `pages`
  - `run_id`, `url`, `final_url`, `http_status`, `strategy(fetch|render)`, `title`, `content_hash`
- `items`
  - `run_id`, `source_url`, `item_type(article|listing)`, `title`, `summary`, `published_at`
- `events`
  - `run_id`, `level`, `code`, `message`, `ts`

## Capabilities for zeroclaw/elfclaw

- Single-page extraction (`scrape-page`)
- Multi-page recursive crawl (`crawl-site`)
- Challenge-aware fallback (`fetch -> render`)
- Structured outputs for downstream summarization
- Stable run logs and replayable artifacts

## What zeroclaw/elfclaw must change to use this tool

### Code-side changes

1. Add external tool adapter to invoke `workspace/tools/cf-crawler`.
2. Add tool definitions:
   - `cf_scrape_page`
   - `cf_crawl_site`
3. Parse returned JSON and map into existing response pipeline.
4. Add config entries:
   - local binary path
   - Cloudflare endpoint + token
   - quota/fallback policy

### Workflow prompt changes

- Route generic web tasks to `cf-crawler` first.
- Route platform-native tasks to Agent-Reach first.
- Enforce anti-abuse rules:
  - low concurrency
  - host cooldown
  - retry budget
  - avoid hammering one domain

## How to use with Agent-Reach

Recommended split:
- `cf-crawler`: generic websites, article/listing crawl, pagination
- `Agent-Reach`: platform-specific connectors (X/Twitter, YouTube, GitHub, etc.)

Combined effect for zeroclaw/elfclaw:
- Wider source coverage
- Better anti-block behavior
- Lower local resource usage
- Cleaner operational separation

## Deployment to Cloudflare (high-level)

1. Create Worker project in `worker/`.
2. Enable Browser Rendering binding in `wrangler.toml`.
3. Configure secret token and endpoint.
4. Deploy Worker.
5. Point local sidecar config to deployed endpoint.
6. Run health check and quota check.

## Expected local resource usage

Target profile on low-power host (no local browser):
- Idle: ~80-150 MB RAM
- Active crawl (low concurrency): ~150-350 MB RAM
- CPU mostly network/parse bound; keep concurrency low for stability

## Acknowledgements

Thanks to these projects:
- Agent-Reach: https://github.com/Panniantong/Agent-Reach
- Crawlee: https://github.com/apify/crawlee

## Local quick start

```bash
npm.cmd install
npm.cmd run build
node dist/index.js health --pretty
node dist/index.js agent-reach-ensure --pretty
node dist/index.js scrape-page --input ./examples/scrape-page.json --pretty
node dist/index.js crawl-site --input ./examples/crawl-site.json --pretty
```

## Worker quick start

```bash
cd worker
npm.cmd install
npm.cmd run build
# deploy with wrangler after setting secrets/vars
```



## Build Windows executable

```bash
npm.cmd install
npm.cmd run build:exe
# output: release/cf-crawler-win-x64.exe
```

## GitHub CI for executable

The workflow is at `.github/workflows/build-windows-exe.yml`.

After you push to GitHub:
- It runs on `push`, `pull_request`, and manual dispatch.
- It compiles the project on `windows-latest`.
- It uploads `release/cf-crawler-win-x64.exe` as an artifact (`cf-crawler-win-x64`).
