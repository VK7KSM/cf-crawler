# cf-crawler

`cf-crawler` 是给 `elfclaw / zeroclaw` 用的网页抓取工具。

一句话说明：
- `cf-crawler` 负责普通网页抓取
- `Agent-Reach` 负责平台型来源抓取
- 它们是两个独立工具

## Agent-Reach 和 cf-crawler 是什么关系

### `cf-crawler` 是什么

`cf-crawler` 负责抓普通网页，例如：
- 新闻正文
- 文章页
- 列表页
- 分页页

它通过 Cloudflare Worker / Browser Rendering 去访问网页。

### `Agent-Reach` 是什么

`Agent-Reach` 是平台接入工具。
它主要处理：
- GitHub
- YouTube
- RSS
- X / Twitter
- 以及它自己支持的其他平台

### 它们是不是一个程序

不是。

它们是两个独立模块：
- `cf-crawler`：独立 EXE，独立命令
- `Agent-Reach`：独立 Python CLI，独立命令

### 那为什么 `cf-crawler` 里还有 `agent-reach-ensure`

这个命令不是抓取命令。
它只是一个“维护命令”，作用只有 3 个：
- 检查 Agent-Reach 有没有安装
- 没安装时尝试安装
- 运行 `doctor` 看它是否可用

也就是说：
- 平时抓网页，不需要这个命令
- 平时抓平台数据，也不靠这个命令
- 它只是帮你维护 Agent-Reach 环境

如果以后你想让两者彻底分离，这个命令也可以删掉。

## 当前已经开通了什么

当前 `cf-crawler` 已经接通：
- Cloudflare Workers
- Cloudflare Browser Rendering

也就是说：
- 普通页面可以走 `fetch`
- 难抓页面可以走 `edge_browser`

只要 `health` 返回 `browser_rendering: true`，就说明浏览器模式已经可用。

## Cloudflare 这边有两类东西，不要搞混

### 1. Cloudflare 登录授权

命令：
```bash
npx wrangler login
```

作用：
- 允许你部署 Worker
- 允许你更新 Worker 配置和 secret

### 2. `CF_CRAWLER_TOKEN`

命令：
```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

作用：
- 防止别人直接调用你的 Worker
- 本地 EXE 访问 Worker 时必须带这个 token

这个值是你自己定义的一串随机字符串。
例如：
```text
my-cf-crawler-secret-20260307
```

## 部署到 Cloudflare 的步骤

```bash
cd C:\Dev\cf-crawler\worker
npm.cmd install
npx wrangler login
npx wrangler secret put CF_CRAWLER_TOKEN
npx wrangler deploy
```

部署成功后，你会得到一个地址，例如：
```text
https://cf-crawler-worker.xxx.workers.dev
```

## 本地怎么连接 Cloudflare Worker

本地 EXE 需要两个环境变量：
- `CF_CRAWLER_ENDPOINT`
- `CF_CRAWLER_TOKEN`

例子：
```powershell
$env:CF_CRAWLER_ENDPOINT='https://cf-crawler-worker.xxx.workers.dev'
$env:CF_CRAWLER_TOKEN='你自己设置的CF_CRAWLER_TOKEN'
```

## cf-crawler 的业务命令

这 3 个才是平时真正抓取要用的命令。

### 1. `health`

作用：
- 检查 Worker 是否在线
- 检查 Browser Rendering 是否已开启

示例：
```powershell
cf-crawler-win-x64.exe health --pretty
```

### 2. `scrape-page`

作用：
- 抓单个页面

示例：
```powershell
cf-crawler-win-x64.exe scrape-page --input .\examples\scrape-page.json --pretty
```

示例 JSON：
```json
{
  "url": "https://example.com",
  "goal": "抓正文",
  "mode": "article",
  "strategy": "auto"
}
```

强制浏览器模式：
```json
{
  "url": "https://example.com",
  "goal": "抓正文",
  "mode": "article",
  "strategy": "edge_browser"
}
```

### 3. `crawl-site`

作用：
- 从起始页面往下抓多个页面

示例：
```powershell
cf-crawler-win-x64.exe crawl-site --input .\examples\crawl-site.json --pretty
```

示例 JSON：
```json
{
  "seed_url": "https://example.com",
  "goal": "抓站点文章列表",
  "scope": "same_host",
  "max_pages": 5,
  "depth": 2,
  "strategy": "auto"
}
```

## cf-crawler 的维护命令

### `agent-reach-ensure`

作用：
- 检查 Agent-Reach 是否安装
- 没安装就尝试安装
- 安装后运行 `doctor`

这个命令不是网页抓取命令。
它只是给你省事用的环境维护命令。

示例：
```powershell
cf-crawler-win-x64.exe agent-reach-ensure --pretty
```

## Agent-Reach 的所有命令和示例

注意：
- 如果系统里没有 `agent-reach` 命令
- 就用 `python -m agent_reach.cli`

等价写法：
```bash
agent-reach doctor
python -m agent_reach.cli doctor
```

### 1. `setup`

作用：
- 进入交互式配置流程

示例：
```bash
agent-reach setup
```

### 2. `install`

作用：
- 安装 Agent-Reach 依赖

示例：
```bash
agent-reach install --env auto
agent-reach install --env server
agent-reach install --env auto --safe
agent-reach install --env auto --dry-run
agent-reach install --env server --proxy http://user:pass@ip:port
```

### 3. `configure`

作用：
- 写配置
- 或从浏览器提取 cookie

示例：
```bash
agent-reach configure github-token ghp_xxxxxxxxxxxx
agent-reach configure proxy http://user:pass@ip:port
agent-reach configure --from-browser chrome
```

### 4. `doctor`

作用：
- 查看当前哪些平台可用

示例：
```bash
agent-reach doctor
```

### 5. `uninstall`

作用：
- 卸载 Agent-Reach 配置和 skill 文件

示例：
```bash
agent-reach uninstall
agent-reach uninstall --dry-run
agent-reach uninstall --keep-config
```

### 6. `check-update`

作用：
- 检查新版本

示例：
```bash
agent-reach check-update
```

### 7. `watch`

作用：
- 健康检查 + 更新检查
- 很适合定时任务

示例：
```bash
agent-reach watch
```

### 8. `version`

作用：
- 查看当前版本

示例：
```bash
agent-reach version
```

## 示例输入文件

- [scrape-page.json](C:/Dev/cf-crawler/examples/scrape-page.json)
- [crawl-site.json](C:/Dev/cf-crawler/examples/crawl-site.json)

## 输出结果是什么

`cf-crawler` 输出统一是 JSON。
主要字段：
- `success`
- `strategy_used`
- `final_url`
- `title`
- `markdown`
- `items`
- `anti_bot_signals`
- `diagnostics`

## 怎么生成 Windows EXE

```bash
npm.cmd install
npm.cmd run build:exe
```

输出文件：
- [cf-crawler-win-x64.exe](C:/Dev/cf-crawler/release/cf-crawler-win-x64.exe)

## GitHub 上怎么拿到 EXE

仓库已经有自动构建流程：
- 推送到 `main` 后，会自动编译 EXE
- 会自动更新 `latest` Release
- 打 `v1.0.0` 这种 tag 后，会自动创建正式版本 Release

## 给 elfclaw 的调用规则

- 普通网页、新闻站、文章页、列表页、分页页：调用 `cf-crawler`
- GitHub、YouTube、RSS、X 等平台型来源：调用 `Agent-Reach`
- 抓取前先健康检查：
  - `cf-crawler-win-x64.exe health --pretty`
  - `agent-reach watch`

## 给 elfclaw 的 cron job 模板

### 每小时做一次健康检查

cron：
```text
0 * * * *
```

执行内容：
```powershell
cf-crawler-win-x64.exe health --pretty
agent-reach watch
```

### 每 30 分钟抓一次新闻列表页

cron：
```text
*/30 * * * *
```

执行内容：
```powershell
cf-crawler-win-x64.exe crawl-site --input C:\path\to\news-list.json --pretty
```

### 每天早上 8 点抓一次重点文章页

cron：
```text
0 8 * * *
```

执行内容：
```powershell
cf-crawler-win-x64.exe scrape-page --input C:\path\to\article.json --pretty
```

### 每天凌晨 3 点检查 Agent-Reach 更新

cron：
```text
0 3 * * *
```

执行内容：
```powershell
agent-reach check-update
```

## 参考项目

- Agent-Reach: [https://github.com/Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)
- Crawlee: [https://github.com/apify/crawlee](https://github.com/apify/crawlee)
