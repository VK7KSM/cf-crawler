# cf-crawler

`cf-crawler` 是一个外部抓取工具。

你可以把它理解成：
- 本地 EXE：负责发任务、收结果、保存结果
- Cloudflare Worker：负责真正去访问网页

这样做的目的很简单：
- 不用本地浏览器
- 抓取出口走 Cloudflare IP
- 本地电脑压力小

## 这个程序是干什么的

它现在主要做 4 件事：

1. 抓单个网页
- 命令：`scrape-page`
- 适合新闻正文、文章页、单个列表页

2. 抓站点里的多页内容
- 命令：`crawl-site`
- 适合首页、频道页、分页列表页

3. 检查 Cloudflare Worker 是否在线
- 命令：`health`

4. 检查 / 安装 / 更新 Agent-Reach
- 命令：`agent-reach-ensure`

## 现在已经开通了什么

当前项目已经接通：
- Cloudflare Workers
- Cloudflare Browser Rendering

也就是说：
- 普通页面先走 `fetch`
- 难抓页面可以走 `edge_browser`

只要 `health` 返回 `browser_rendering: true`，就说明浏览器模式已经可用。

## 你要分清楚的 2 种“密钥”

很多人第一次看这个项目会混乱，这里直接说清楚。

### 1. Cloudflare 登录授权

这个不是你自己随便写的。
这是 `wrangler login` 打开浏览器以后，Cloudflare 给本机命令行的授权。

作用：
- 允许你部署 Worker
- 允许你更新 Worker 配置和 secret

命令：
```bash
npx wrangler login
```

### 2. `CF_CRAWLER_TOKEN`

这个是 `cf-crawler` 自己的访问密钥。
是你自己定义的一串随机字符串。

作用：
- 防止别人直接调用你的 Worker 抓网页
- 本地 EXE 调 Worker 时，要带这个 token

命令：
```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

执行后，终端会让你输入一个值。
你可以自己输入一串随机字符串，例如：
```text
my-cf-crawler-secret-20260307
```

然后本地程序也要用同一个值。

## 部署到 Cloudflare 的步骤

### 第 1 步：进入 Worker 目录

```bash
cd C:\Dev\cf-crawler\worker
```

### 第 2 步：安装依赖

```bash
npm.cmd install
```

### 第 3 步：登录 Cloudflare

```bash
npx wrangler login
```

这一步会弹浏览器。
你只要在浏览器里登录 Cloudflare 并授权就行。

### 第 4 步：创建 `cf-crawler` 自己的访问密钥

```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

终端会提示你输入一个值。
这个值就是以后本地程序访问 Worker 的密码。

### 第 5 步：部署 Worker

```bash
npx wrangler deploy
```

部署成功后，终端会输出一个地址，例如：
```text
https://cf-crawler-worker.xxx.workers.dev
```

这个地址就是你的 Worker 地址。

## 本地程序怎么连接 Cloudflare Worker

本地 EXE 只需要 2 个环境变量：

- `CF_CRAWLER_ENDPOINT`
- `CF_CRAWLER_TOKEN`

例子：

```powershell
$env:CF_CRAWLER_ENDPOINT='https://cf-crawler-worker.xxx.workers.dev'
$env:CF_CRAWLER_TOKEN='你刚才设置的CF_CRAWLER_TOKEN'
```

然后就可以运行：

```powershell
cf-crawler-win-x64.exe health --pretty
```

如果返回正常 JSON，就说明已经连通。

## 最常用的 4 个命令

### 1. 检查 Worker 是否在线

```powershell
cf-crawler-win-x64.exe health --pretty
```

### 2. 检查 Agent-Reach

```powershell
cf-crawler-win-x64.exe agent-reach-ensure --pretty
```

### 3. 抓单个网页

```powershell
cf-crawler-win-x64.exe scrape-page --input .\examples\scrape-page.json --pretty
```

### 4. 抓站点多页

```powershell
cf-crawler-win-x64.exe crawl-site --input .\examples\crawl-site.json --pretty
```

## 如果要强制使用浏览器模式怎么写

你可以在 `scrape-page` 的输入 JSON 里这样写：

```json
{
  "url": "https://example.com",
  "goal": "抓正文",
  "mode": "article",
  "strategy": "edge_browser"
}
```

说明：
- `auto`：默认模式，先 fetch，不行再升级 browser
- `edge_fetch`：只用普通抓取
- `edge_browser`：直接用 Cloudflare Browser Rendering

## 输入文件在哪里

示例文件：
- [scrape-page.json](C:/Dev/cf-crawler/examples/scrape-page.json)
- [crawl-site.json](C:/Dev/cf-crawler/examples/crawl-site.json)

`scrape-page` 常用字段：
- `url`：要抓的网页
- `goal`：抓取目的
- `mode`：`article` / `listing` / `raw`
- `strategy`：`auto` / `edge_fetch` / `edge_browser`

`crawl-site` 常用字段：
- `seed_url`：起始页面
- `max_pages`：最多抓多少页
- `depth`：向下抓几层
- `scope`：抓取范围限制

## 输出结果是什么

输出统一是 JSON。

最重要的字段：
- `success`：成功还是失败
- `strategy_used`：最终用了哪种模式
- `final_url`：最后打开的 URL
- `title`：页面标题
- `markdown`：提取出的正文
- `items`：抓到的文章/链接列表
- `anti_bot_signals`：检测到的反爬信号
- `diagnostics`：耗时、重试次数等

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

所以正常情况下，你以后直接去 GitHub 的 Releases 页面下载就行。

## elfclaw 以后怎么用它

以后 elfclaw 不需要把抓取代码写进自己主程序里。
更简单的方式是：
- elfclaw 调用这个 EXE
- 给它传 JSON 输入
- 读取它返回的 JSON 结果

这样做的好处：
- elfclaw 主程序更干净
- 抓取模块可以单独升级
- Agent-Reach 继续独立存在

## 和 Agent-Reach 怎么分工

建议这样分：
- `cf-crawler`：普通网页、新闻站、文章页、列表页、分页页
- `Agent-Reach`：GitHub、YouTube、RSS、X 这类平台型来源

简单说：
- 普通网站交给 `cf-crawler`
- 平台来源交给 `Agent-Reach`

## 参考项目

- Agent-Reach: [https://github.com/Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)
- Crawlee: [https://github.com/apify/crawlee](https://github.com/apify/crawlee)
