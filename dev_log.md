# cf-crawler 开发日志

## 2026-03-15 — v0.3.1: /crawl API 集成 + 截图功能

### 1. 集成 Cloudflare /crawl REST API（第三道反爬防线）

**背景**：Cloudflare 新推出 Browser Rendering REST API `/crawl` 端点，可通过 CF 自有基础设施路径爬取网页。对于被 edge_fetch 和 edge_browser 都拦截的站点，/crawl 走的是不同的网络路径，可能绕过部分反爬。

**架构**：/crawl 作为 cf-crawler 内部的第三道防线，不暴露新工具名。elfclaw 仍调用 `web_scrape`，内部自动决策。

```
auto 策略链：edge_fetch → edge_browser → cf_crawl_api
```

**改动文件**：
- `src/executors/cf_crawl_api.ts` — 新建，调用 Worker `/v1/crawl` 代理端点
- `worker/src/index.ts` — 新增 `POST /v1/crawl` 路由，Worker 代理转发到 CF REST API（job 创建 + 轮询）
- `src/executors/decision.ts` — 新增 `shouldTryCrawlApi()`
- `src/cli/commands/scrape-page.ts` — auto 策略 edge_browser 失败后尝试 /crawl
- `src/core/scheduler.ts` — crawl-site 同样加入 /crawl 回退
- `src/cli/index.ts` — 新增 help 命令

**Worker secrets**：
```bash
wrangler secret put CF_API_TOKEN    # CF API token（Browser Rendering Edit 权限）
wrangler secret put CF_ACCOUNT_ID   # CF Account ID
```

**提交**：`363a89b`

---

### 2. 实现截图功能（mode=screenshot）

**背景**：scrape-page 的 mode 枚举早已声明 `screenshot`，但后端未实现。SKILL.toml 也已暴露该选项。

**方案**：Worker 内 Playwright `page.screenshot()` 截图，返回 base64 PNG。CLI 解码后自动保存到 `homework/screenshots/` 目录。

**改动文件**：
- `worker/src/index.ts` — `doRender()` 中 mode=screenshot 时调用 `page.screenshot({ type: "png", fullPage: true })`
- `src/executors/types.ts` — RemoteResponse 新增 `screenshot_base64?`
- `src/types.ts` — ToolResult 新增 `screenshot_path?`
- `src/cli/commands/scrape-page.ts` — 解码 base64 写入 `homework/screenshots/{domain}_{timestamp}.png`
- `SKILL.md` — 新增截图调用示例

**elfclaw 调用**：
```
web_scrape(json_input='{"url":"https://example.com","goal":"网页截图","mode":"screenshot","strategy":"edge_browser"}')
```

**返回**：`screenshot_path: "homework/screenshots/example.com_2026-03-15T10-25-00.png"`

**测试**：BBC News 全页截图成功（2.3MB PNG）。

**提交**：`d53923b`

---

## 2026-03-08 — v0.3.0: 大版本更新

**提交**：`5c1fcbb`

主要特性：
- KV 缓存（120s TTL，去重/加速）
- UA 轮换（10 桌面 + 10 移动 UA）
- 批量抓取（`/v1/batch-fetch`，最多 20 URL 并行）
- Sitemap 解析（`/v1/sitemap`）
- 付费墙绕过（Googlebot UA / AMP Cache / Wayback Machine / 标准回退）
- D1 会话持久化（登录 cookie 跨请求复用）
- 登录自动化（`/v1/login`，Playwright 表单填写）
- 崩溃恢复（进度持久化到 SQLite）

---

## 2026-03-07 — v0.2.0: Browser Rendering + PowerShell 兼容

**提交**：`9924acb`, `57196da`

- 启用 Cloudflare Browser Rendering（Playwright binding）
- 策略自动升级：edge_fetch 遇 403/429/503 或 challenge_marker → edge_browser
- PowerShell stdin 管道兼容（echo prefix）
- SSRF 防护（阻止私有 IP 访问）

---

## 2026-03-06 — v0.1.0: 初始实现

**提交**：`617337b`

- CLI 架构：scrape-page / crawl-site / health 三个命令
- Cloudflare Worker 后端（edge_fetch）
- BFS 爬取调度器（限速、去重、深度控制）
- 提取器：article / listing / pagination
- Windows EXE 打包（pkg）
- GitHub CI
