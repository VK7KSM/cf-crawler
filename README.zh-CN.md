# cf-crawler

给 `elfclaw / zeroclaw` 用的网页抓取工具。**版本 0.3.0**

---

## 它是干什么的

`cf-crawler` 是一个网页爬虫，核心机制是：

```
你的程序 → 本地 EXE → Cloudflare Worker（远程） → 目标网页
```

**本地不跑浏览器。** 抓取流量走 Cloudflare 边缘节点。

三种抓取策略：
- **edge_fetch**：普通 HTTP 请求，快，适合大多数页面
- **edge_browser**：启动真实浏览器（Cloudflare Browser Rendering），慢但能过反爬
- **paywall_bypass**：多策略级联突破软付费墙（Googlebot UA → AMP Cache → Wayback Machine → 标准兜底）

用 `auto` 策略时会自动判断：先试 fetch，碰到反爬（403、验证码、Turnstile）自动升级成 browser。

### v0.3.0 新功能一览

| 功能 | 说明 |
|------|------|
| KV 缓存 | Worker 端响应缓存（Cloudflare KV），TTL 内同 URL 秒回 |
| UA 轮换 | 内置 20 条 User-Agent（桌面 10 + 移动 10），按 session_id 哈希固定选取 |
| 设备类型 | `device_type` 参数控制桌面/移动端/自动 viewport |
| 批量抓取 | 通过 `/v1/batch-fetch` 并发抓取，`CF_CRAWLER_BATCH_SIZE` 可配置 |
| Sitemap 解析 | 给 crawl-site 传 `sitemap_url`，跳过 BFS 链接发现，直接用 sitemap URL 列表 |
| 付费墙突破 | 4 种策略级联尝试突破软付费墙 |
| D1 Session | Cookie 跨请求持久化（Cloudflare D1 SQLite） |
| 登录 | 通过 Playwright 自动化表单登录，Cookie 存入 D1 供后续复用 |
| 会话管理 | 查询/删除会话（`/v1/session/:id`） |
| 崩溃恢复 | 本地 SQLite 表（`crawl_runs`、`crawl_queue`）支持断点续爬 |

---

## 它和 Agent-Reach 是什么关系

这是两个独立工具，分工不同：

| 工具 | 用途 |
|------|------|
| `cf-crawler` | 抓普通网页（新闻、文章、列表、分页） |
| `Agent-Reach` | 抓平台型数据（GitHub、YouTube、RSS、Twitter/X 等） |

`cf-crawler` 里有一个 `agent-reach-ensure` 命令，但那不是抓取命令，只是帮你检查和安装 Agent-Reach 环境用的维护命令。

---

## 第一步：部署 Cloudflare Worker

你需要先把 Worker 部署到 Cloudflare，本地 EXE 才能工作。

### 前提条件

- Node.js 22+（用来跑 wrangler）
- Cloudflare 账号（免费账号就行）

### 部署步骤

在 `worker` 目录执行以下命令：

```bash
cd C:\Dev\cf-crawler\worker
npm.cmd install
npx wrangler login
```

登录后设置访问 token（这个 token 是你自己定义的任意字符串，用来保护你的 Worker 不被别人随意调用）：

```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

它会提示你输入 token 值，例如：

```
Enter a secret value: my-cf-crawler-secret-20260307
```

然后部署：

```bash
npx wrangler deploy
```

部署成功后会输出你的 Worker 地址：

```
https://cf-crawler-worker.你的账号名.workers.dev
```

### 部署时用到的 Cloudflare 服务

Worker 使用以下 Cloudflare 服务（全部在免费额度内）：

| 服务 | 绑定名 | 用途 | 创建方式 |
|------|--------|------|---------|
| KV | `CRAWLER_CACHE` | 响应缓存 | 已在 `wrangler.toml` 中配置 |
| D1 | `SESSION_DB` | Session/Cookie 存储 | 已在 `wrangler.toml` 中配置 |
| Browser Rendering | `BROWSER` | 无头浏览器（过反爬用） | 自动启用 |

如果你是第一次部署，KV 命名空间或 D1 数据库可能还不存在，需要手动创建：

```bash
# 创建 KV 命名空间（如果不存在）
npx wrangler kv namespace create CRAWLER_CACHE
# 把返回的 namespace_id 填入 wrangler.toml

# 创建 D1 数据库（如果不存在）
npx wrangler d1 create cf-crawler-sessions
# 把返回的 database_id 填入 wrangler.toml
```

### Cloudflare 的两个授权不要混淆

| 概念 | 命令 | 作用 |
|------|------|------|
| Cloudflare 账号授权 | `npx wrangler login` | 让本机有权限部署 Worker |
| CF_CRAWLER_TOKEN | `npx wrangler secret put` | 保护 Worker 不被陌生人调用 |

这两个是完全不同的东西。`CF_CRAWLER_TOKEN` 就是一串你自己定的随机字符串，和你的 Cloudflare 账号密码没关系。

---

## 第二步：配置本地环境变量

本地 EXE 需要知道 Worker 在哪、token 是什么。

**PowerShell（临时，当前会话有效）：**

```powershell
$env:CF_CRAWLER_ENDPOINT = 'https://cf-crawler-worker.你的账号名.workers.dev'
$env:CF_CRAWLER_TOKEN = 'my-cf-crawler-secret-20260307'
```

**永久写入系统环境变量（Windows）：**

```powershell
[System.Environment]::SetEnvironmentVariable('CF_CRAWLER_ENDPOINT', 'https://cf-crawler-worker.你的账号名.workers.dev', 'User')
[System.Environment]::SetEnvironmentVariable('CF_CRAWLER_TOKEN', 'my-cf-crawler-secret-20260307', 'User')
```

---

## 第三步：下载 EXE

从 GitHub Releases 下载最新的 `cf-crawler-win-x64.exe`，放到你方便的路径，例如 `C:\tools\cf-crawler-win-x64.exe`。

也可以自己构建：

```bash
cd C:\Dev\cf-crawler
npm.cmd install
npm.cmd run build:exe
# 输出文件：release\cf-crawler-win-x64.exe
```

---

## 命令参考

EXE 的基本用法：

```
cf-crawler-win-x64.exe <命令> [选项]
```

可用命令：`health`、`scrape-page`、`crawl-site`、`login`、`agent-reach-ensure`

**CLI 参数：**

| 参数 | 说明 |
|------|------|
| `--input <文件路径>` | 从 JSON 文件读取输入 |
| `--json '<JSON字符串>'` | 直接传 JSON 字符串（仅限 bash/cmd；**PowerShell 5.1 下会损坏双引号**，改用 stdin 管道） |
| `--pretty` | 输出格式化后的 JSON（人类可读），不加则输出压缩 JSON（适合程序解析） |
| *stdin 管道* | 通过管道传 JSON：`echo '{"url":"..."}' \| cf-crawler scrape-page`。**PowerShell 推荐用法。** |

> **PowerShell 用户注意：** PowerShell 5.1 将包含双引号的参数传给 native exe 时存在[已知 bug](https://github.com/PowerShell/PowerShell/issues/1995)，会导致 JSON 被空格拆散。请用 `echo` 管道代替 `--json`：
> ```powershell
> echo '{"url":"https://example.com","goal":"test","mode":"article"}' | cf-crawler-win-x64.exe scrape-page --pretty
> ```

---

### 命令 1：`health` — 健康检查

**作用：** 检查 Worker 是否在线，Browser Rendering 是否可用，各服务状态是否正常。

**运行前先跑这个，确认一切正常。**

```powershell
cf-crawler-win-x64.exe health --pretty
```

**输出示例：**

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

**关键字段：**

| 字段 | 含义 |
|------|------|
| `ok` | Worker 是否能正常访问 |
| `remote.version` | Worker 版本（应该是 `0.3.0`） |
| `remote.browser_rendering` | `true` 表示浏览器模式可用 |
| `remote.cache_enabled` | `true` 表示 KV 响应缓存已启用 |
| `remote.session_db_enabled` | `true` 表示 D1 Session 数据库已启用 |
| `total_ms` | 本地到 Worker 的往返时间（毫秒） |

---

### 命令 2：`scrape-page` — 抓单个页面

**作用：** 抓取一个指定 URL 的页面内容。

#### 最简单的用法（stdin 管道——PowerShell 推荐）

```powershell
echo '{"url":"https://example.com","goal":"获取页面内容","mode":"article","strategy":"auto"}' | cf-crawler-win-x64.exe scrape-page --pretty
```

#### 用 --json 传参（仅限 bash/cmd——PowerShell 5.1 下会失败）

```bash
cf-crawler-win-x64.exe scrape-page --json '{"url":"https://example.com","goal":"获取页面内容","mode":"article","strategy":"auto"}' --pretty
```

#### 用文件传参（推荐，适合复杂配置）

新建文件 `my-task.json`：

```json
{
  "url": "https://news.ycombinator.com",
  "goal": "获取今日热门文章列表",
  "mode": "listing",
  "strategy": "auto"
}
```

然后运行：

```powershell
cf-crawler-win-x64.exe scrape-page --input my-task.json --pretty
```

#### 所有参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | ✅ | — | 要抓取的页面地址 |
| `goal` | string | ✅ | — | 描述你想要什么（供日志和调试用，不影响逻辑） |
| `mode` | string | — | `article` | 提取模式，见下表 |
| `strategy` | string | — | `auto` | 抓取策略，见下表 |
| `device_type` | string | — | — | `"desktop"`、`"mobile"` 或 `"auto"`，控制 UA 选择和 viewport 大小 |
| `selectors` | string[] | — | — | CSS 选择器列表，指定要提取的元素（高级用法） |
| `session_id` | string | — | — | 会话 ID，Cookie 跨请求持久化（存在 D1 中） |
| `persist_path` | string | — | — | 把结果 JSON 额外保存到指定文件路径 |

**mode 参数说明：**

| mode | 说明 | 适合场景 |
|------|------|----------|
| `article` | 提取正文（标题 + Markdown 内容） | 新闻文章、博客正文 |
| `listing` | 提取页面所有链接和文字 | 列表页、导航页、首页 |
| `feed` | 提取 RSS/Atom 格式内容 | RSS 订阅源页面 |
| `raw` | 返回原始 HTML，不做提取 | 需要自己解析 HTML 的场景 |
| `screenshot` | 截图（返回截图数据） | 需要视觉效果的场景 |

**strategy 参数说明：**

| strategy | 说明 |
|----------|------|
| `auto` | 先试 edge_fetch，遇到反爬自动升级 edge_browser（推荐） |
| `edge_fetch` | 只用普通 HTTP 请求，速度快 |
| `edge_browser` | 直接用浏览器渲染，慢但能绕过反爬 |
| `paywall_bypass` | 多策略级联突破软付费墙（详见[付费墙突破](#付费墙突破)章节） |

**反爬检测触发条件（`auto` 策略下会自动升级）：**
- HTTP 403、429、503
- 响应含 `turnstile`、`cf-challenge`、`captcha` 等关键词
- HTML 内容过短（< 300 字符）

#### 各场景示例

**抓文章正文，自动选策略：**
```json
{
  "url": "https://www.bbc.com/news/article-example",
  "goal": "获取新闻正文",
  "mode": "article",
  "strategy": "auto"
}
```

**抓列表页，强制浏览器模式（对付反爬）：**
```json
{
  "url": "https://news.ycombinator.com",
  "goal": "获取热门帖子列表",
  "mode": "listing",
  "strategy": "edge_browser"
}
```

**用移动端 UA 和 viewport 抓取：**
```json
{
  "url": "https://example.com",
  "goal": "获取移动端版本",
  "mode": "article",
  "strategy": "auto",
  "device_type": "mobile"
}
```

**带 Session 抓取（Cookie 在同 session_id 的请求间保持）：**
```json
{
  "url": "https://example.com/dashboard",
  "goal": "抓取登录后的页面",
  "mode": "article",
  "strategy": "auto",
  "session_id": "my-session-1"
}
```

**突破软付费墙：**
```json
{
  "url": "https://example.com/premium-article",
  "goal": "获取付费文章正文",
  "mode": "article",
  "strategy": "paywall_bypass"
}
```

**抓页面并保存结果到文件：**
```json
{
  "url": "https://example.com",
  "goal": "抓取并保存",
  "mode": "article",
  "strategy": "auto",
  "persist_path": "./data/result-2026-03-07.json"
}
```

**用 CSS 选择器提取特定元素：**
```json
{
  "url": "https://example.com",
  "goal": "只提取正文区域",
  "mode": "article",
  "strategy": "auto",
  "selectors": [".main-content", "article", "#post-body"]
}
```

#### 输出示例

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

**输出字段说明：**

| 字段 | 说明 |
|------|------|
| `success` | 是否成功 |
| `strategy_used` | 实际用了哪种策略（`edge_fetch` 或 `edge_browser`） |
| `final_url` | 最终落地 URL（可能有重定向） |
| `title` | 页面标题 |
| `markdown` | 正文内容（Markdown 格式） |
| `items` | 链接列表（listing 模式下最全） |
| `items[].url` | 链接地址 |
| `items[].title` | 链接文字 |
| `items[].summary` | 摘要（和 title 相同或更详细） |
| `anti_bot_signals` | 检测到的反爬信号，空数组表示没有 |
| `bypass_strategy_used` | （仅 paywall_bypass）生效的突破策略：`googlebot_ua`、`amp_cache`、`wayback` 或 `standard_fallback` |
| `diagnostics.status` | `ok`、`error` 或 `empty` |
| `diagnostics.timings.total_ms` | 本地总耗时（毫秒） |
| `diagnostics.timings.remote_ms` | Worker 端耗时（毫秒） |
| `diagnostics.retries` | 重试次数 |

---

### 命令 3：`crawl-site` — 多页爬取

**作用：** 从一个起始 URL 开始，自动发现并爬取多个页面。

#### 基本用法

```powershell
cf-crawler-win-x64.exe crawl-site --input .\examples\crawl-site.json --pretty
```

#### 直接传 JSON

```powershell
echo '{"seed_url":"https://example.com","goal":"收集所有文章","scope":"same_host","max_pages":10,"depth":2,"strategy":"auto"}' | cf-crawler-win-x64.exe crawl-site --pretty
```

#### 所有参数说明

| 参数 | 类型 | 必填 | 默认值 | 范围 | 说明 |
|------|------|------|--------|------|------|
| `seed_url` | string | ✅ | — | — | 起始 URL |
| `goal` | string | ✅ | — | — | 目标描述 |
| `scope` | string | — | `same_host` | — | 爬取范围，见下表 |
| `max_pages` | number | — | `20` | 1–200 | 最多爬几个页面 |
| `depth` | number | — | `2` | 0–6 | 最大爬取深度（0=只爬种子页） |
| `include_patterns` | string[] | — | — | — | URL 必须匹配其中一个正则才爬 |
| `exclude_patterns` | string[] | — | — | — | URL 匹配则跳过 |
| `strategy` | string | — | `auto` | — | 同 scrape-page（`auto`、`edge_fetch`、`edge_browser`） |
| `session_id` | string | — | — | — | 会话 ID，Cookie 持久化（配合 login 命令使用） |
| `sitemap_url` | string | — | — | — | Sitemap XML 地址。设置后跳过 BFS 链接发现，直接用 sitemap URL 列表作为爬取队列。 |
| `device_type` | string | — | — | — | `"desktop"`、`"mobile"` 或 `"auto"` |
| `persist_path` | string | — | — | — | 保存结果到文件 |

**scope 参数说明：**

| scope | 说明 |
|-------|------|
| `same_host` | 只爬同一域名下的链接（推荐，最常用） |
| `same_path` | 只爬同一路径前缀下的链接（更严格） |
| `custom` | 配合 `include_patterns` 自定义范围 |

**depth 的含义：**

```
depth=0：只爬 seed_url 本身，不跟进任何链接
depth=1：爬 seed_url，再爬它页面上发现的链接（共 2 层）
depth=2：在 depth=1 基础上再深一层（共 3 层）
```

#### 各场景示例

**抓新闻站首页和文章页（最多 20 页）：**
```json
{
  "seed_url": "https://news.ycombinator.com",
  "goal": "收集今日热门文章",
  "scope": "same_host",
  "max_pages": 20,
  "depth": 2,
  "strategy": "auto"
}
```

**用 sitemap 爬取（跳过链接发现，直接用 sitemap URL 列表）：**
```json
{
  "seed_url": "https://blog.cloudflare.com",
  "goal": "从 sitemap 收集所有博文",
  "scope": "same_host",
  "max_pages": 50,
  "depth": 0,
  "strategy": "auto",
  "sitemap_url": "https://blog.cloudflare.com/sitemap.xml"
}
```

**带 Session 爬取（登录后的内容）：**
```json
{
  "seed_url": "https://example.com/members",
  "goal": "收集会员专属文章",
  "scope": "same_path",
  "max_pages": 30,
  "depth": 2,
  "strategy": "auto",
  "session_id": "my-logged-in-session"
}
```

**只爬博客的 `/posts/` 路径下的内容：**
```json
{
  "seed_url": "https://example-blog.com/posts/",
  "goal": "收集所有博文",
  "scope": "same_path",
  "max_pages": 50,
  "depth": 3,
  "strategy": "auto"
}
```

**用正则过滤，只爬包含 `/article/` 的 URL，跳过评论和标签页：**
```json
{
  "seed_url": "https://example.com",
  "goal": "只收集文章页",
  "scope": "same_host",
  "max_pages": 30,
  "depth": 3,
  "include_patterns": ["/article/"],
  "exclude_patterns": ["/tag/", "/comment/", "\\?page="],
  "strategy": "auto"
}
```

**强制浏览器渲染，爬有反爬保护的站：**
```json
{
  "seed_url": "https://blog.cloudflare.com",
  "goal": "收集 Cloudflare 博客文章",
  "scope": "same_path",
  "max_pages": 10,
  "depth": 2,
  "strategy": "edge_browser"
}
```

**用移动端设备类型爬取：**
```json
{
  "seed_url": "https://example.com",
  "goal": "收集移动端版本页面",
  "scope": "same_host",
  "max_pages": 10,
  "depth": 1,
  "strategy": "auto",
  "device_type": "mobile"
}
```

#### 输出示例（精简版）

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
      "markdown": "正文内容...",
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

`crawl-site` 比 `scrape-page` 多一个 `pages` 数组，里面每个元素是一个被爬到的页面。

**批量抓取原理：** 当 `CF_CRAWLER_BATCH_SIZE > 1`（默认 3）时，调度器会在一次 `/v1/batch-fetch` 请求中发送多个 URL 给 Worker。Worker 通过 `Promise.allSettled()` 并发处理。如果批量端点失败，会自动退回到逐个串行抓取。

---

### 命令 4：`login` — 自动化登录

**作用：** 自动化完成网站表单登录，捕获 Cookie 存入 Cloudflare D1，供后续 `scrape-page` 和 `crawl-site` 复用。

#### 基本用法

```powershell
echo '{"session_id":"my-session","login_url":"https://example.com/login","credentials":{"username_field":"#email","username":"user@example.com","password_field":"#password","password":"secret"}}' | cf-crawler-win-x64.exe login --pretty
```

#### 所有参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `session_id` | string | ✅ | — | 会话名称，Cookie 存在这个 ID 下。后续 `scrape-page`/`crawl-site` 用同一 ID 即可复用。 |
| `login_url` | string | ✅ | — | 登录页面地址 |
| `credentials.username_field` | string | ✅ | — | 用户名/邮箱输入框的 CSS 选择器或 `name` 属性 |
| `credentials.username` | string | ✅ | — | 要填入的用户名或邮箱 |
| `credentials.password_field` | string | ✅ | — | 密码输入框的 CSS 选择器或 `name` 属性 |
| `credentials.password` | string | ✅ | — | 要填入的密码 |
| `submit_selector` | string | — | `[type=submit]` | 提交按钮的 CSS 选择器 |
| `success_url_contains` | string | — | — | 登录成功后 URL 应包含的字符串（用于验证登录是否成功） |

#### 工作原理

1. 在 Cloudflare Browser Rendering（Playwright）中打开 `login_url`
2. 用指定的选择器找到用户名和密码输入框，填入凭据
3. 点击提交按钮
4. 等待页面导航完成
5. 捕获浏览器所有 Cookie → 存入 D1，关联到 `session_id`
6. 返回成功状态和 Cookie 数量

#### 输出示例

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

#### 完整登录流程示例

**第一步：登录并捕获 Cookie**
```powershell
echo '{"session_id":"forum-session","login_url":"https://forum.example.com/login","credentials":{"username_field":"input[name=email]","username":"myemail@example.com","password_field":"input[name=password]","password":"mypassword123"},"submit_selector":"button.login-btn","success_url_contains":"/dashboard"}' | cf-crawler-win-x64.exe login --pretty
```

**第二步：用该 Session 抓取需要登录的内容**
```powershell
echo '{"url":"https://forum.example.com/members-only/article","goal":"获取会员专属文章","mode":"article","strategy":"auto","session_id":"forum-session"}' | cf-crawler-win-x64.exe scrape-page --pretty
```

**第三步：用该 Session 批量爬取登录后的页面**
```powershell
echo '{"seed_url":"https://forum.example.com/members-only/","goal":"收集所有会员文章","scope":"same_path","max_pages":20,"depth":2,"strategy":"auto","session_id":"forum-session"}' | cf-crawler-win-x64.exe crawl-site --pretty
```

`forum-session` 下存储的 Cookie 会自动注入每个请求，响应中的新 Cookie 也会自动保存回 D1。

---

### 命令 5：`agent-reach-ensure` — 维护 Agent-Reach 环境

**这不是抓取命令。** 这是一个维护命令，帮你检查和安装 Agent-Reach。

```powershell
cf-crawler-win-x64.exe agent-reach-ensure --pretty
```

它会按以下顺序查找 Agent-Reach：

1. 先看 `AGENT_REACH_COMMAND` 环境变量有没有指定路径
2. 在系统 PATH 里找 `xreach` 或 `agent-reach` 命令
3. 试试 `python -m agent_reach.cli` 和 `python -m agent_reach`

找到后检查版本，版本过低时自动更新（需要 `uv` 或 `pip`）。

**输出示例：**

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
    "output": "✅ GitHub 仓库和代码 — 完整可用\n❌ YouTube 视频和字幕 — yt-dlp 未安装\n..."
  },
  "details": []
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `installed` | 是否刚刚执行了安装（之前没有）|
| `updated` | 是否刚刚执行了升级 |
| `command` | 找到的可用命令 |
| `current_version` | 当前安装的版本 |
| `doctor.ok` | 健康检查是否通过 |
| `doctor.output` | `agent-reach doctor` 的完整输出 |

---

## 所有环境变量

| 变量名 | 必填 | 默认值 | 范围 | 说明 |
|--------|------|--------|------|------|
| `CF_CRAWLER_ENDPOINT` | ✅ | `http://127.0.0.1:8787` | — | Worker 地址 |
| `CF_CRAWLER_TOKEN` | — | 无 | — | Worker 访问 token（Worker 端也要设置才有效） |
| `CF_CRAWLER_TIMEOUT_MS` | — | `20000` | 1000–120000 | 单次请求超时（毫秒） |
| `CF_CRAWLER_BATCH_SIZE` | — | `3` | 1–10 | 每批次并发抓取 URL 数量。默认 3 与 Browser Rendering 免费版 3 并发上限对齐。 |
| `CF_CRAWLER_DB_PATH` | — | 无 | — | 本地 SQLite 数据库路径。设置后启用崩溃恢复（断点续爬）。 |
| `CF_CRAWLER_HOST_COOLDOWN_MS` | — | `1200` | 100–60000 | 同一域名两次请求的最小间隔（毫秒） |
| `CF_CRAWLER_MAX_RETRIES` | — | `2` | 0–8 | 单次请求失败后最大重试次数 |
| `CF_CRAWLER_ALLOWED_HOSTS` | — | 无 | — | 域名白名单，逗号分隔，设置后只允许抓这些域名 |
| `CF_CRAWLER_BLOCK_PRIVATE_IP` | — | `true` | — | 是否阻止抓取私有/内网 IP（防 SSRF 攻击） |
| `AGENT_REACH_COMMAND` | — | 无 | — | 手动指定 agent-reach 的命令路径 |
| `AGENT_REACH_MIN_VERSION` | — | 无 | — | 要求的最低版本号 |
| `AGENT_REACH_AUTO_UPDATE` | — | `true` | — | 是否自动更新 Agent-Reach |
| `AGENT_REACH_TIMEOUT_MS` | — | `90000` | 5000–600000 | Agent-Reach 操作超时（毫秒） |

**PowerShell 设置示例：**

```powershell
# 必填
$env:CF_CRAWLER_ENDPOINT = 'https://cf-crawler-worker.xxx.workers.dev'
$env:CF_CRAWLER_TOKEN    = 'your-token-here'

# 可选调整
$env:CF_CRAWLER_TIMEOUT_MS       = '30000'   # 30 秒超时
$env:CF_CRAWLER_HOST_COOLDOWN_MS = '2000'    # 2 秒域名冷却
$env:CF_CRAWLER_MAX_RETRIES      = '3'       # 最多重试 3 次
$env:CF_CRAWLER_BATCH_SIZE       = '5'       # 每批次并发抓 5 个 URL

# 启用崩溃恢复
$env:CF_CRAWLER_DB_PATH = 'C:\data\cf-crawler.db'

# 只允许抓特定域名
$env:CF_CRAWLER_ALLOWED_HOSTS = 'example.com,news.ycombinator.com'
```

---

## 会话管理

Session 的 Cookie 存储在 Cloudflare D1 中，跨请求持久化。使用 `login` 命令或给 `scrape-page`/`crawl-site` 传 `session_id` 时会自动创建/更新 Session。

### 查询 Session

查看某个 Session 存储了哪些 Cookie，直接向 Worker 发 GET 请求：

```bash
curl https://cf-crawler-worker.xxx.workers.dev/v1/session/my-session \
  -H "Authorization: Bearer your-token-here"
```

### 删除 Session（登出）

清除某个 Session 的所有 Cookie：

```bash
curl -X DELETE https://cf-crawler-worker.xxx.workers.dev/v1/session/my-session \
  -H "Authorization: Bearer your-token-here"
```

---

## 付费墙突破

对 `scrape-page` 使用 `strategy: "paywall_bypass"` 可针对软付费墙（soft paywall）站点尝试获取完整文章内容，通过多策略级联依次尝试直至成功。

### 策略列表（按顺序尝试）

| 优先级 | 策略 | 方法 |
|--------|------|------|
| 1 | Googlebot UA 伪装 | `User-Agent: Googlebot/2.1`——许多发布商对搜索爬虫豁免付费墙 |
| 2 | Google AMP Cache | 将 URL 转换为 `cdn.ampproject.org` 格式——AMP 启用的文章无付费墙 |
| 3 | Wayback Machine 快照 | 通过 `archive.org/wayback/available` API 获取最近存档版本 |
| 4 | 标准兜底 | 退回到普通的 `edge_fetch` / `edge_browser` 流程 |

### 使用方式

```json
{
  "url": "https://example.com/premium-article",
  "goal": "获取付费文章正文",
  "mode": "article",
  "strategy": "paywall_bypass"
}
```

输出中会有 `bypass_strategy_used` 字段，标明哪个策略生效（如 `"googlebot_ua"`、`"amp_cache"`、`"wayback"` 或 `"standard_fallback"`）。

### 各策略效果说明

- **Googlebot UA**：对许多传统媒体有效，但随着发布商增加二次验证，可靠性有所下降。
- **AMP Cache**：对启用 AMP 的文章有效，随着 Google 逐步淡出 AMP，覆盖范围收窄。
- **Wayback Machine**：存档内容最可靠，但可能没有今天刚发布的文章。
- **12ft.io**：曾是流行的付费墙绕过代理，已于 2025 年 7 月在新闻媒体联盟压力下关闭，本工具不使用。

### 法律声明

绕过付费墙可能违反目标网站的服务条款。本工具使用的所有方法（Googlebot UA、Google AMP Cache、Wayback Machine API）均依赖公开可用的接口。用户需自行确保使用方式符合适用法律和相关服务条款，并承担相应责任。

---

## 崩溃恢复

设置 `CF_CRAWLER_DB_PATH` 后，`crawl-site` 会将爬取进度持久化到本地 SQLite 数据库。

### 工作原理

1. 爬取开始时，在 `crawl_runs` 表中创建一条 `running` 状态的记录
2. 每个 URL 的处理状态（`pending`、`done`、`error`）记录在 `crawl_queue` 表中
3. 如果进程崩溃或被中断（Ctrl+C），该次运行保持 `running` 状态
4. 用相同的 `seed_url` 和配置重新启动时，调度器检测到未完成的运行，只从 `pending` 的 URL 继续——已完成的 URL 会被跳过

### 启用崩溃恢复

```powershell
$env:CF_CRAWLER_DB_PATH = 'C:\data\cf-crawler.db'
```

数据库文件和表会在首次使用时自动创建。

---

## Agent-Reach 命令参考

如果系统 PATH 里没有 `agent-reach`，用：

```bash
python -m agent_reach.cli <命令>
```

这两种写法完全等价：

```bash
agent-reach doctor
python -m agent_reach.cli doctor
```

### `setup` — 交互式配置向导

```bash
agent-reach setup
```

首次安装后运行，引导你完成所有配置。

### `install` — 安装依赖

```bash
# 自动检测环境，安装合适的依赖
agent-reach install --env auto

# 服务器模式（无桌面环境）
agent-reach install --env server

# 安全模式：不安装任何可选依赖
agent-reach install --env auto --safe

# 预演模式：只显示会做什么，不真正安装
agent-reach install --env auto --dry-run

# 指定代理
agent-reach install --env server --proxy http://user:pass@ip:port
```

### `configure` — 写配置

```bash
# 配置 GitHub token（用于 GitHub 私有仓库或提高 API 限额）
agent-reach configure github-token ghp_xxxxxxxxxxxxxxxxxxxx

# 配置代理
agent-reach configure proxy http://user:pass@ip:port

# 从本地浏览器提取 cookie（用于需要登录的平台）
agent-reach configure --from-browser chrome
agent-reach configure --from-browser firefox
```

### `doctor` — 健康检查

```bash
agent-reach doctor
```

显示当前哪些平台可用，哪些需要额外配置。

**输出示例：**

```
✅ GitHub 仓库和代码 — 完整可用
❌ YouTube 视频和字幕 — yt-dlp 未安装。安装：pip install yt-dlp
✅ RSS/Atom 订阅源 — 可读取 RSS/Atom 源
✅ 任意网页 — 通过 Jina Reader 读取任意网页

状态：3/13 个渠道可用
运行 `agent-reach setup` 解锁更多渠道
```

### `check-update` — 检查更新

```bash
agent-reach check-update
```

### `watch` — 快速健康检查（适合定时任务）

```bash
agent-reach watch
```

同时做健康检查 + 更新检查，一条命令搞定。

### `uninstall` — 卸载

```bash
# 完整卸载
agent-reach uninstall

# 预演，只显示会删什么
agent-reach uninstall --dry-run

# 保留配置文件，只删 skill 文件
agent-reach uninstall --keep-config
```

### `version` — 查看版本

```bash
agent-reach version
```

---

## 结果如何保存

有两种方式保存抓取结果：

### 1. 写到 JSON 文件（推荐）

在输入里加 `persist_path`：

```json
{
  "url": "https://example.com",
  "goal": "测试",
  "mode": "article",
  "strategy": "auto",
  "persist_path": "./data/runs/result-2026-03-07.json"
}
```

### 2. 重定向标准输出

```powershell
cf-crawler-win-x64.exe scrape-page --input task.json > result.json
```

注意：日志（`level`, `time`, `msg` 之类的字段）输出到 `stderr`，结果 JSON 输出到 `stdout`，管道重定向不会把日志混入结果。

---

## elfclaw / zeroclaw 的调用规则

**选哪个工具：**

```
普通网页（新闻、文章、列表、分页）  →  cf-crawler
平台型来源（GitHub、YouTube、RSS、Twitter）  →  Agent-Reach
```

**每次任务开始前先健康检查：**

```powershell
cf-crawler-win-x64.exe health --pretty
agent-reach watch
```

**cron job 模板：**

```
# 每小时健康检查
0 * * * *   cf-crawler-win-x64.exe health --pretty && agent-reach watch

# 每 30 分钟抓一次新闻列表
*/30 * * * *   cf-crawler-win-x64.exe crawl-site --input C:\tasks\news-list.json

# 每天 08:00 抓重点文章
0 8 * * *   cf-crawler-win-x64.exe scrape-page --input C:\tasks\article.json

# 每天 03:00 检查 Agent-Reach 更新
0 3 * * *   agent-reach check-update
```

---

## 自己编译 EXE

```bash
cd C:\Dev\cf-crawler
npm.cmd install
npm.cmd run build:exe
```

输出文件：`release\cf-crawler-win-x64.exe`

GitHub Actions 会在每次推送 `main` 分支时自动构建并更新 `latest` Release。打 `v1.0.0` 这样的 tag 会创建正式版本 Release。

---

## 与 Crawlee 的功能对比分析

cf-crawler 参考了 Crawlee 的设计思路，但定位不同：Crawlee 是本地运行的爬虫**框架**，cf-crawler 是 Cloudflare 驱动的爬虫**工具**。以下是详细对比。

### cf-crawler 已实现的 Crawlee 核心功能

| 功能 | Crawlee 实现 | cf-crawler 实现 | 说明 |
|------|-------------|----------------|------|
| URL 队列 | `RequestQueue`（BFS/DFS） | `queue.ts`（BFS FIFO） | cf-crawler 只有广度优先 |
| 请求去重 | 基于 `uniqueKey` | URL 精确匹配 + 内容 SHA256 哈希 | cf-crawler 额外做了内容去重 |
| 限速控制 | `AutoscaledPool` 动态并发 | `rate_limit.ts` 每域名冷却时间 | 实现方式不同 |
| 重试逻辑 | 指数退避 + 多种错误类型 | `retry.ts` 指数退避 | cf-crawler 只有一种重试类型 |
| 反爬检测升级 | 无内置（需手动处理） | `decision.ts` 自动从 fetch 升级到 browser | cf-crawler 有独特优势 |
| 内容提取 | Cheerio/JSDOM 集成 | `extractors/`（article、listing、pagination） | cf-crawler 有更高层的提取抽象 |
| URL 过滤 | glob + 正则 + 变换函数 | `include_patterns` / `exclude_patterns` 正则 | Crawlee 更灵活 |
| 结果持久化 | `Dataset` + `KeyValueStore` | JSON 文件 + 可选 SQLite | 功能相近 |
| 安全防护 | 无 | `url_policy.ts`（SSRF 防护、私有 IP 过滤） | cf-crawler 独有 |
| **并发请求** | `AutoscaledPool`（1–200） | **`/v1/batch-fetch` + `Promise.allSettled()`** | ✅ v0.3.0 已实现。默认 3 并发，`CF_CRAWLER_BATCH_SIZE`（1–10） |
| **Session/Cookie** | `SessionPool`（独立 cookie jar） | **D1 sessions 表 + Cookie 持久化** | ✅ v0.3.0 已实现。按 `session_id` 跨请求保持 Cookie |
| **登录自动化** | 手动（用户自己写登录代码） | **`login` 命令（Playwright 表单填写）** | ✅ v0.3.0 已实现。自动化表单登录 |
| **浏览器指纹** | `fingerprint-generator`（Canvas、WebGL、字体） | **UA 池（20 条）+ Viewport 匹配** | ✅ 部分实现。覆盖 UA、Viewport、设备类型。Canvas/WebGL 不可自定义。 |
| **崩溃恢复** | 定期持久化队列状态 | **本地 SQLite `crawl_runs`/`crawl_queue`** | ✅ v0.3.0 已实现 |
| **Sitemap 解析** | `SitemapRequestList` | **`/v1/sitemap` 端点 + `sitemap_url` 参数** | ✅ v0.3.0 已实现 |
| **响应缓存** | `KeyValueStore` | **Cloudflare KV + TTL** | ✅ v0.3.0 已实现 |

### cf-crawler 不需要的 Crawlee 功能

| 功能 | 为何 cf-crawler 不需要 |
|------|----------------------|
| 代理轮换（`ProxyConfiguration`） | CF Workers 出站经由 Cloudflare 边缘（AS13335），互联网上最受信任的 IP 段之一。没有网站封 CF IP 不怕断自己 CDN。这是架构优势，不是缺陷。 |
| 路由/Handler 系统（`Router`） | cf-crawler 是工具不是框架，输入输出固定 |
| 多种爬虫类型（Cheerio/JSDOM/Playwright/Puppeteer） | cf-crawler 把渲染委托给 Cloudflare，不在本地运行浏览器 |
| 生命周期钩子（pre/post navigation hooks） | 当前无扩展需求 |
| 事件系统（`AsyncEventEmitter`） | 当前无订阅需求 |
| 统计监控仪表盘 | 只需 per-request diagnostics |
| 链接变换函数（`requestTransform`） | 当前 include/exclude 正则已够用 |

### 浏览器指纹详情

cf-crawler 使用 20 条 UA 池（桌面 10 + 移动 10），按 `session_id` 哈希固定选取：

| cf-crawler 能控制的 | cf-crawler 不能控制的 |
|--------------------|---------------------|
| User-Agent（20 条真实 UA） | Canvas 指纹 |
| Viewport 大小（匹配设备类型） | WebGL 指纹 |
| 设备类型（desktop/mobile） | 字体枚举 |
| Language 请求头 | Audio context 指纹 |

**按目标网站类型的实际影响：**

| 目标网站类型 | 深度指纹重要性 | cf-crawler 效果 |
|------------|--------------|----------------|
| 普通新闻/文章/列表页 | 低 | ✅ UA + Cookie 足够 |
| 使用 CF Bot Management 的站 | 中 | ⚠️ 被识别为 bot，但 CF IP 可信度有帮助 |
| DataDome / PerimeterX / Akamai | 高 | ❌ 深度指纹检测，难以绕过 |

cf-crawler 的目标场景（新闻、文章、公开列表）基本不使用企业级 bot 检测，可控指纹覆盖 80–90% 的实际反爬情况。

### 总结

| 能力 | 状态 |
|------|------|
| 核心爬取（队列、去重、重试、提取） | ✅ 已实现 |
| 反爬自动升级（fetch → browser） | ✅ 已实现 |
| 安全防护（SSRF） | ✅ 已实现 |
| 并发批量抓取 | ✅ v0.3.0 已实现 |
| Session/Cookie 持久化 | ✅ v0.3.0 已实现 |
| 登录自动化 | ✅ v0.3.0 已实现 |
| 崩溃恢复 | ✅ v0.3.0 已实现 |
| Sitemap 解析 | ✅ v0.3.0 已实现 |
| 响应缓存（KV） | ✅ v0.3.0 已实现 |
| UA 轮换 + Viewport | ✅ v0.3.0 已实现 |
| 付费墙突破 | ✅ v0.3.0 已实现 |
| 代理轮换 | ✅ 不需要（CF IP 优势） |
| 深度浏览器指纹 | ⚠️ 部分（仅 UA/Viewport，对目标场景已足够） |

---

## Cloudflare 免费额度使用情况

cf-crawler 使用的所有 Cloudflare 服务均在免费额度内：

| CF 服务 | 免费额度 | cf-crawler 用途 |
|---------|---------|----------------|
| Workers | 100K 请求/天，10ms CPU（I/O 不计） | 所有 API 端点 |
| KV | 100K 读/天，1K 写/天，1GB | 响应缓存（写入偏紧） |
| D1（SQLite） | 5M 读/天，100K 写/天，5GB | Session/Cookie 存储 |
| Browser Rendering | **10 分钟/天**，3 并发 | ~120–300 页/天（每页 2–5s） |

---

## 参考项目

- [Agent-Reach](https://github.com/Panniantong/Agent-Reach) — 平台型数据抓取工具
- [Crawlee](https://github.com/apify/crawlee) — Node.js 网页爬虫与浏览器自动化框架
