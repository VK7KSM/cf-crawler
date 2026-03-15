import type pino from "pino";
import { DedupeSet } from "./dedupe.js";
import { UrlQueue } from "./queue.js";
import { HostRateLimiter } from "./rate_limit.js";
import { withRetry } from "./retry.js";
import { shouldUpgradeToRender, shouldTryCrawlApi } from "../executors/decision.js";
import { cfFetch } from "../executors/cf_fetch.js";
import { cfRender } from "../executors/cf_render.js";
import { cfBatchFetch } from "../executors/cf_batch.js";
import { cfSitemap } from "../executors/cf_sitemap.js";
import { cfCrawlApi } from "../executors/cf_crawl_api.js";
import type { ExecutorConfig, RemoteResponse } from "../executors/types.js";
import { extractArticle } from "../extractors/article.js";
import { extractListing } from "../extractors/listing.js";
import { extractPaginationLinks } from "../extractors/pagination.js";
import { UrlPolicy } from "../security/url_policy.js";
import type { CrawlItem, CrawlPage, CrawlSiteInput, ToolResult } from "../types.js";

interface SchedulerOptions {
    input: CrawlSiteInput;
    endpoint: string;
    token?: string;
    timeoutMs: number;
    maxRetries: number;
    hostCooldownMs: number;
    batchSize: number;
    urlPolicy: UrlPolicy;
    logger: pino.Logger;
}

function toRegexes(values?: string[]): RegExp[] {
    return (values ?? []).map((value) => new RegExp(value, "i"));
}

function allowByScope(seed: URL, target: URL, scope: CrawlSiteInput["scope"]): boolean {
    if (scope === "same_host") {
        return seed.host === target.host;
    }
    if (scope === "same_path") {
        return seed.host === target.host && target.pathname.startsWith(seed.pathname.split("/").slice(0, 2).join("/"));
    }
    return true;
}

async function fetchSinglePage(
    url: string,
    strategy: CrawlSiteInput["strategy"],
    execCfg: ExecutorConfig,
    maxRetries: number,
    extraPayload: Record<string, unknown>,
): Promise<{ remote: RemoteResponse; strategy: "edge_fetch" | "edge_browser"; retries: number }> {
    let retries = 0;
    let strategyUsed: "edge_fetch" | "edge_browser" = strategy === "edge_browser" ? "edge_browser" : "edge_fetch";

    const payload = {
        url,
        timeout_ms: execCfg.timeoutMs,
        mode: strategy === "edge_browser" ? "article" : "raw",
        ...extraPayload,
    };

    let remote: RemoteResponse;

    if (strategy === "edge_browser") {
        const r = await withRetry(() => cfRender(execCfg, payload), maxRetries);
        retries += r.retries;
        remote = r.value;
    } else if (strategy === "edge_fetch") {
        const r = await withRetry(() => cfFetch(execCfg, payload), maxRetries);
        retries += r.retries;
        remote = r.value;
    } else {
        // auto
        const fetchR = await withRetry(() => cfFetch(execCfg, payload), maxRetries);
        retries += fetchR.retries;
        remote = fetchR.value;

        if (shouldUpgradeToRender(fetchR.value)) {
            const renderR = await withRetry(
                () => cfRender(execCfg, { url, mode: "article", timeout_ms: execCfg.timeoutMs, ...extraPayload }),
                maxRetries,
            );
            retries += renderR.retries;
            if (renderR.value.ok) {
                remote = renderR.value;
                strategyUsed = "edge_browser";
            } else if (shouldTryCrawlApi(renderR.value)) {
                const crawlR = await cfCrawlApi(execCfg, {
                    url,
                    formats: ["markdown", "html"],
                    render: true,
                });
                if (crawlR.ok) {
                    remote = crawlR;
                    strategyUsed = "edge_browser";
                }
            }
        }
    }

    return { remote, strategy: strategyUsed, retries };
}

export async function runCrawlScheduler(opts: SchedulerOptions): Promise<ToolResult> {
    const started = Date.now();
    const { input, logger } = opts;
    const seed = new URL(input.seed_url);
    const include = toRegexes(input.include_patterns);
    const exclude = toRegexes(input.exclude_patterns);

    const queue = new UrlQueue();
    const dedupe = new DedupeSet();
    const limiter = new HostRateLimiter(opts.hostCooldownMs);
    const execCfg: ExecutorConfig = { endpoint: opts.endpoint, token: opts.token, timeoutMs: opts.timeoutMs };
    const extraPayload: Record<string, unknown> = {};
    if (input.session_id) extraPayload.session_id = input.session_id;
    if (input.device_type) extraPayload.device_type = input.device_type;

    // If sitemap_url is provided, fetch sitemap URLs and use them as the initial queue
    if (input.sitemap_url) {
        logger.info({ sitemap_url: input.sitemap_url }, "fetching sitemap");
        const sitemapResult = await cfSitemap(execCfg, {
            url: input.sitemap_url,
            timeout_ms: opts.timeoutMs,
        });

        if (sitemapResult.ok && sitemapResult.urls.length > 0) {
            logger.info({ count: sitemapResult.urls.length }, "sitemap URLs loaded");
            for (const url of sitemapResult.urls) {
                try {
                    const parsed = new URL(url);
                    if (!allowByScope(seed, parsed, input.scope)) continue;
                    if (include.length > 0 && !include.some((r) => r.test(url))) continue;
                    if (exclude.some((r) => r.test(url))) continue;

                    const normalized = parsed.toString();
                    if (dedupe.hasUrl(normalized)) continue;

                    await opts.urlPolicy.assertAllowed(normalized);
                    dedupe.addUrl(normalized);
                    queue.enqueue({ url: normalized, depth: 0 });
                } catch {
                    logger.debug({ url }, "skip sitemap URL (blocked or invalid)");
                }
            }
        } else {
            logger.warn({ error: sitemapResult.error }, "sitemap fetch failed, falling back to BFS");
        }
    }

    // If no sitemap URLs were added, seed normally
    if (queue.size === 0) {
        queue.enqueue({ url: seed.toString(), depth: 0 });
        dedupe.addUrl(seed.toString());
    }

    const pages: CrawlPage[] = [];
    const items: CrawlItem[] = [];
    let retries = 0;
    const batchSize = opts.batchSize;

    // Batch processing loop
    while (queue.size > 0 && pages.length < input.max_pages) {
        // Collect a batch of URLs from the queue
        const batch: Array<{ url: string; depth: number }> = [];
        while (batch.length < batchSize && queue.size > 0 && pages.length + batch.length < input.max_pages) {
            const task = queue.dequeue();
            if (!task) break;
            batch.push(task);
        }

        if (batch.length === 0) break;

        // For edge_fetch/auto with batchSize > 1 and no render needed, use batch-fetch
        if (batch.length > 1 && input.strategy !== "edge_browser") {
            // Wait for rate limiter for each URL
            for (const task of batch) {
                await limiter.waitFor(task.url);
            }

            // Validate URLs
            const validBatch: Array<{ url: string; depth: number }> = [];
            for (const task of batch) {
                try {
                    await opts.urlPolicy.assertAllowed(task.url);
                    validBatch.push(task);
                } catch (error) {
                    logger.warn({ url: task.url, err: String(error) }, "URL blocked, skip");
                }
            }

            if (validBatch.length === 0) continue;

            // Use batch-fetch endpoint
            try {
                const batchResult = await cfBatchFetch(execCfg, {
                    urls: validBatch.map((t) => t.url),
                    mode: "raw",
                    timeout_ms: opts.timeoutMs,
                    session_id: input.session_id,
                    device_type: input.device_type,
                });

                for (let i = 0; i < validBatch.length; i++) {
                    const task = validBatch[i];
                    const remote = batchResult.results?.[i] as RemoteResponse | undefined;
                    if (!remote) continue;

                    let strategyUsed: "edge_fetch" | "edge_browser" = "edge_fetch";

                    // Auto-upgrade if needed
                    if (input.strategy === "auto" && shouldUpgradeToRender(remote)) {
                        try {
                            const renderR = await withRetry(
                                () => cfRender(execCfg, { url: task.url, mode: "article", timeout_ms: opts.timeoutMs, ...extraPayload }),
                                opts.maxRetries,
                            );
                            retries += renderR.retries;
                            if (renderR.value.ok) {
                                processPage(task, renderR.value, "edge_browser", pages, items, dedupe, queue, seed, input, include, exclude, opts, logger);
                                continue;
                            }
                        } catch (error) {
                            logger.warn({ url: task.url, err: String(error) }, "render upgrade failed");
                        }
                    }

                    processPage(task, remote, strategyUsed, pages, items, dedupe, queue, seed, input, include, exclude, opts, logger);
                }
            } catch (error) {
                // Batch failed, fall back to sequential
                logger.warn({ err: String(error) }, "batch-fetch failed, falling back to sequential");
                for (const task of validBatch) {
                    try {
                        await limiter.waitFor(task.url);
                        const result = await fetchSinglePage(task.url, input.strategy, execCfg, opts.maxRetries, extraPayload);
                        retries += result.retries;
                        processPage(task, result.remote, result.strategy, pages, items, dedupe, queue, seed, input, include, exclude, opts, logger);
                    } catch (error) {
                        logger.warn({ url: task.url, err: String(error) }, "page crawl failed, skip");
                    }
                }
            }
        } else {
            // Sequential processing (single URL or edge_browser)
            for (const task of batch) {
                try {
                    await limiter.waitFor(task.url);
                    await opts.urlPolicy.assertAllowed(task.url);

                    const result = await fetchSinglePage(task.url, input.strategy, execCfg, opts.maxRetries, extraPayload);
                    retries += result.retries;
                    processPage(task, result.remote, result.strategy, pages, items, dedupe, queue, seed, input, include, exclude, opts, logger);
                } catch (error) {
                    logger.warn({ url: task.url, err: String(error) }, "page crawl failed, skip");
                }
            }
        }
    }

    return {
        success: pages.length > 0,
        strategy_used: pages.some((page) => page.strategy_used === "edge_browser") ? "edge_browser" : "edge_fetch",
        final_url: pages[0]?.final_url ?? input.seed_url,
        title: pages[0]?.title ?? "",
        markdown: pages[0]?.markdown ?? "",
        items,
        anti_bot_signals: Array.from(new Set(pages.flatMap((p) => p.anti_bot_signals))),
        diagnostics: {
            status: pages.length > 0 ? "ok" : "empty",
            timings: {
                total_ms: Date.now() - started,
                pages: pages.length,
            },
            retries,
            cache_hit: false,
        },
        pages,
    };
}

function processPage(
    task: { url: string; depth: number },
    remote: RemoteResponse,
    strategyUsed: "edge_fetch" | "edge_browser",
    pages: CrawlPage[],
    items: CrawlItem[],
    dedupe: DedupeSet,
    queue: UrlQueue,
    seed: URL,
    input: CrawlSiteInput,
    include: RegExp[],
    exclude: RegExp[],
    opts: SchedulerOptions,
    logger: pino.Logger,
): void {
    const html = remote.html ?? remote.body ?? "";
    const article = extractArticle(html);
    const listing = extractListing(task.url, html);
    const pagerLinks = extractPaginationLinks(task.url, html);

    pages.push({
        url: task.url,
        final_url: remote.final_url ?? task.url,
        status: remote.status,
        strategy_used: strategyUsed,
        title: remote.title ?? article.title,
        markdown: remote.markdown ?? article.markdown,
        anti_bot_signals: remote.anti_bot_signals ?? [],
    });

    for (const entry of listing.items) {
        if (!dedupe.hasContent(entry.title + entry.summary)) {
            dedupe.addContent(entry.title + entry.summary);
            items.push(entry);
        }
    }

    if (task.depth >= input.depth) return;

    const candidateLinks = [...listing.links, ...pagerLinks];
    for (const link of candidateLinks) {
        try {
            const parsed = new URL(link);
            if (!allowByScope(seed, parsed, input.scope)) continue;
            if (include.length > 0 && !include.some((regex) => regex.test(parsed.toString()))) continue;
            if (exclude.some((regex) => regex.test(parsed.toString()))) continue;

            const normalized = parsed.toString();
            opts.urlPolicy.assertAllowed(normalized).then(() => {
                if (dedupe.hasUrl(normalized)) return;
                dedupe.addUrl(normalized);
                queue.enqueue({ url: normalized, depth: task.depth + 1 });
            }).catch(() => {
                logger.debug({ link: normalized }, "skip blocked link");
            });
        } catch {
            logger.debug({ link }, "skip malformed link");
        }
    }
}
