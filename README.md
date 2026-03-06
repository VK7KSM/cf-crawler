# cf-crawler

`cf-crawler` 是一个给 `elfclaw / zeroclaw` 用的外部抓取工具。

它的设计目标只有两个：
- 本地机器尽量省资源
- 抓取请求尽量从 Cloudflare 出去，而不是从你自己的电脑 IP 出去

所以它的工作方式是：
- 本地程序负责下发任务、接收结果、保存结果
- Cloudflare Worker 负责真正去访问目标网页
- 遇到普通页面先用 `fetch`
- 遇到需要 JS 或疑似反爬页面再升级到 `render`

## 这个程序现在能干什么

现在已经实现了 4 个核心能力：

1. 抓单个网页
- 命令：`scrape-page`
- 适合抓新闻正文、文章页、单个列表页

2. 抓整个站点的一部分页面
- 命令：`crawl-site`
- 适合从首页、频道页、列表页继续往下抓

3. 检查 Cloudflare 端是否可用
- 命令：`health`

4. 检查/安装/更新 Agent-Reach
- 命令：`agent-reach-ensure`
- 如果本机没有 Agent-Reach，程序会尝试自动安装
- 如果本机已经有 Agent-Reach，程序会检查它能不能正常运行

## 这个程序不能干什么

现在它还不是一个“万能爬虫平台”，下面这些事情还没做：
- 还没有直接接入 `elfclaw` 主程序
- 还没有做图形界面
- 还没有做复杂账号登录流程
- 还没有做大规模分布式任务调度

所以你现在应该把它理解成：
“一个独立的、可执行的、给 elfclaw 以后调用的抓取侧车程序”

## 目录说明

```text
cf-crawler/
  src/                     本地 CLI 主程序
  worker/                  部署到 Cloudflare 的 Worker
  examples/                示例输入 JSON
  release/                 本地生成的 Windows EXE
  .github/workflows/       GitHub 自动编译 EXE 的工作流
```

## 本地程序和 Cloudflare 分工

本地程序负责：
- 读取命令和参数
- 决定是抓单页还是抓多页
- 做重试、去重、限速
- 调用 Cloudflare Worker
- 接收 JSON 结果
- 保存结果
- 检查 Agent-Reach

Cloudflare 负责：
- 用 Cloudflare 的出口 IP 去访问目标站
- 返回网页内容
- 返回状态码、反爬信号、耗时
- 在需要时调用 Browser Rendering

## 为什么要这样设计

因为你的机器配置低，而且你明确要求：
- 本地不要跑浏览器
- 重点是稳，不是快
- 重点是别把自己 IP 爬死

所以这个方案比“本地直接开 Playwright”更合适。

## Cloudflare 免费版用了什么

这个项目按免费版来设计，主要用这几样：
- Workers
- Browser Rendering
- KV（可选）

大致思路是：
- 大部分请求走 Workers 的普通 `fetch`
- 少量难抓页面才走 Browser Rendering
- KV 只做短时间缓存，不做重要数据库

## 最重要的 4 个命令

### 1. 检查 Cloudflare 端是否在线

```bash
cf-crawler-win-x64.exe health --pretty
```

如果你还没部署 Worker，这个命令会报连接失败，这是正常的。

### 2. 检查 Agent-Reach 是否装好

```bash
cf-crawler-win-x64.exe agent-reach-ensure --pretty
```

这个命令会：
- 检查本机有没有 Agent-Reach
- 没有就尝试安装
- 最后执行 doctor 检查

### 3. 抓单个网页

```bash
cf-crawler-win-x64.exe scrape-page --input .\examples\scrape-page.json --pretty
```

### 4. 抓站点列表

```bash
cf-crawler-win-x64.exe crawl-site --input .\examples\crawl-site.json --pretty
```

## 输入文件怎么写

### `scrape-page` 输入示例

文件：[examples/scrape-page.json](C:/Dev/cf-crawler/examples/scrape-page.json)

常用字段：
- `url`：要抓的网页
- `goal`：这次抓取的目的，给后续处理用
- `mode`：抓取模式
- `strategy`：`auto` / `edge_fetch` / `edge_browser`

### `crawl-site` 输入示例

文件：[examples/crawl-site.json](C:/Dev/cf-crawler/examples/crawl-site.json)

常用字段：
- `seed_url`：起始页面
- `max_pages`：最多抓多少页
- `depth`：递进深度
- `scope`：限制抓取范围
- `include_patterns` / `exclude_patterns`：过滤 URL

## 输出结果是什么

程序输出统一是 JSON，便于以后给 elfclaw 直接调用。

主要字段：
- `success`：是否成功
- `strategy_used`：最终用了哪种抓取方式
- `final_url`：最终页面地址
- `title`：标题
- `markdown`：正文或主要内容
- `items`：抓到的链接/条目列表
- `anti_bot_signals`：检测到的反爬信号
- `diagnostics`：耗时、重试次数等信息

## 怎么生成 Windows 可执行文件

```bash
npm.cmd install
npm.cmd run build:exe
```

生成后的文件在：
[cf-crawler-win-x64.exe](C:/Dev/cf-crawler/release/cf-crawler-win-x64.exe)

## GitHub 自动编译和 Release 说明

GitHub 工作流文件在：
[build-windows-exe.yml](C:/Dev/cf-crawler/.github/workflows/build-windows-exe.yml)

现在的规则是：
- 推送到 `main` 后，会自动编译 EXE
- 同时自动创建或更新一个叫 `latest` 的 GitHub Release
- 推送 `v1.0.0` 这种 tag 后，会自动创建对应版本 Release

所以以后你在 Releases 页面里应该能直接下载 EXE，不需要再去 Actions 里找 Artifact。

## 怎么部署到 Cloudflare

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

### 第 4 步：设置 Worker 的访问密钥

```bash
npx wrangler secret put CF_CRAWLER_TOKEN
```

这里填一个你自己定义的随机字符串，后面本地程序要用同一个值。

### 第 5 步：部署 Worker

```bash
npx wrangler deploy
```

部署成功后，你会拿到一个类似这样的地址：
- `https://cf-crawler-worker.xxx.workers.dev`

### 第 6 步：让本地程序连这个地址

在本地环境变量里配置：
- `CF_CRAWLER_ENDPOINT=https://你的workers地址`
- `CF_CRAWLER_TOKEN=你刚才设置的token`

然后再运行：

```bash
cf-crawler-win-x64.exe health --pretty
```

如果返回正常 JSON，就说明已经通了。

## Browser Rendering 什么时候再开

建议你先不要急着开。

先跑通这条链路：
- 本地 EXE
- Cloudflare Worker
- 普通 fetch 抓网页

确认这条链路稳定之后，再考虑给少量难抓页面开 Browser Rendering。
这样最省免费额度，也最容易排错。

## elfclaw 以后怎么接这个程序

以后 elfclaw 不需要把代码写进自己主程序里。
更合理的方式是：
- elfclaw 把它当成一个独立外部工具
- 直接调用这个 EXE
- 给它传 JSON 输入
- 读取它返回的 JSON 结果

这样好处很直接：
- 主程序更干净
- 抓取模块可以单独升级
- Agent-Reach 也可以继续保持独立

## 和 Agent-Reach 怎么分工

建议这么分：
- `cf-crawler`：通用网页、新闻站、文章页、列表页、分页页
- `Agent-Reach`：GitHub、YouTube、RSS、X 这类平台型来源

简单说：
- 普通网站交给 `cf-crawler`
- 平台接口交给 `Agent-Reach`

## 参考与感谢

这个项目主要参考了下面两个项目：
- Agent-Reach: [https://github.com/Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)
- Crawlee: [https://github.com/apify/crawlee](https://github.com/apify/crawlee)
