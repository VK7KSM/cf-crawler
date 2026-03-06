# cf-crawler

`zeroclaw/elfclaw` 的轻量级外部抓取侧车工具。

## 为什么要创建这个项目

`zeroclaw/elfclaw` 需要更强抓取能力，但运行机器配置较低（Windows Server 2025，8GB 内存）。本项目把重浏览器执行放到 Cloudflare，避免本地常驻浏览器带来的资源压力和不稳定。

## 参考项目

本项目主要参考：
- Crawlee 的抓取架构与调度思路
- Agent-Reach 的平台连接与运行方式

## 项目优势

- 独立工具，不耦合 elfclaw 主程序
- 完全不依赖本地浏览器
- 抓取出口使用 Cloudflare IP
- 本地资源占用低、稳定性高
- 输入输出统一为 JSON，便于编排和重试

## 使用了 Cloudflare 的哪些免费资源

- Workers Free
- Browser Rendering Free
- KV Free（可选缓存）
- D1 Free（可选元数据）

### 免费额度（截至 2026-03-06）

| 服务 | 免费额度 | 实际含义 |
|---|---:|---|
| Workers | 100,000 请求/天，1000 请求/分钟，10ms CPU/请求 | 适合调度与抓取网关 |
| Browser Rendering | 10 分钟/天，3 并发浏览器，REST 6 请求/分钟，60s 超时 | 只用于高价值页面 |
| KV | 100,000 读/天，1,000 写/天，1 GB | 小型缓存和去重标记 |
| D1 | 5,000,000 行读/天，100,000 行写/天，5 GB | 任务元数据与运行日志 |

### Browser Rendering 每天大约可调用次数

| 单页平均渲染时长 | 每天大约可渲染页面数 |
|---:|---:|
| 5 秒 | 约 120 页 |
| 8 秒 | 约 75 页 |
| 10 秒 | 约 60 页 |
| 15 秒 | 约 40 页 |

策略：默认先 `fetch`，必要时再升级 `render`。

## 工作方式

本地侧车负责队列、调度、提取，然后调用 Cloudflare：
- `POST /v1/fetch`：普通页面
- `POST /v1/render`：JS/挑战页
- `GET /v1/health`：可用性与额度探测

## 程序目录（计划）

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

## 数据结构（计划）

- `runs`
  - `run_id`, `kind(scrape|crawl)`, `seed_url`, `status`, `started_at`, `finished_at`
- `pages`
  - `run_id`, `url`, `final_url`, `http_status`, `strategy(fetch|render)`, `title`, `content_hash`
- `items`
  - `run_id`, `source_url`, `item_type(article|listing)`, `title`, `summary`, `published_at`
- `events`
  - `run_id`, `level`, `code`, `message`, `ts`

## 能给 zeroclaw/elfclaw 提供什么能力

- 单页提取（`scrape-page`）
- 多页递进抓取（`crawl-site`）
- 自动降级与升级（`fetch -> render`）
- 结构化输出，便于后续总结与推送
- 可追踪的运行日志和结果归档

## zeroclaw/elfclaw 还需要改哪些代码与工作流提示词

### 代码改动

1. 增加外部工具适配层，调用 `workspace/tools/cf-crawler`。
2. 增加两个工具定义：
   - `cf_scrape_page`
   - `cf_crawl_site`
3. 解析侧车返回 JSON，并接入现有回复流水线。
4. 增加配置项：
   - 本地二进制路径
   - Cloudflare endpoint 与 token
   - 额度与降级策略

### 工作流提示词改动

- 普通网页抓取任务优先走 `cf-crawler`。
- 平台型任务优先走 Agent-Reach。
- 强制反封禁策略：
  - 低并发
  - 按域名冷却
  - 重试预算
  - 禁止短时间猛打同一站点

## 与 Agent-Reach 配合后的效果

建议分工：
- `cf-crawler`：通用网页、文章页、列表页、分页抓取
- `Agent-Reach`：平台专用连接器（X/Twitter、YouTube、GitHub 等）

组合效果：
- 数据来源更全
- 抗封禁能力更强
- 本地资源占用更低
- 工程边界更清晰

## 如何部署到 Cloudflare（高层步骤）

1. 在 `worker/` 目录初始化 Worker 项目。
2. 在 `wrangler.toml` 绑定 Browser Rendering。
3. 配置密钥和 endpoint。
4. 部署 Worker。
5. 本地侧车指向已部署 endpoint。
6. 执行 health 与额度检查。

## 资源使用率（本地侧车预期）

低配主机目标（无本地浏览器）：
- 空闲：约 80-150 MB 内存
- 低并发抓取：约 150-350 MB 内存
- CPU 主要用于网络等待与解析，低并发下稳定性优先

## 致谢

感谢以下项目：
- Agent-Reach: https://github.com/Panniantong/Agent-Reach
- Crawlee: https://github.com/apify/crawlee

## 本地快速运行

```bash
npm.cmd install
npm.cmd run build
node dist/index.js health --pretty
node dist/index.js agent-reach-ensure --pretty
node dist/index.js scrape-page --input ./examples/scrape-page.json --pretty
node dist/index.js crawl-site --input ./examples/crawl-site.json --pretty
```

## Worker 快速运行

```bash
cd worker
npm.cmd install
npm.cmd run build
# 配好 wrangler 密钥和变量后再部署
```



## 生成 Windows 可执行文件

```bash
npm.cmd install
npm.cmd run build:exe
# 输出: release/cf-crawler-win-x64.exe
```

## GitHub 自动编译可执行文件

工作流文件：`.github/workflows/build-windows-exe.yml`

推送到 GitHub 后：
- 在 `push`、`pull_request`、手动触发时运行。
- 在 `windows-latest` 上编译项目。
- 上传 `release/cf-crawler-win-x64.exe` 为构建产物（`cf-crawler-win-x64`）。
