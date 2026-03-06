import type pino from "pino";
import { DedupeSet } from "./dedupe.js";
import { UrlQueue } from "./queue.js";
import { HostRateLimiter } from "./rate_limit.js";
import { withRetry } from "./retry.js";
import { shouldUpgradeToRender } from "../executors/decision.js";
import { cfFetch } from "../executors/cf_fetch.js";
import { cfRender } from "../executors/cf_render.js";
import type { RemoteResponse } from "../executors/types.js";
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

export async function runCrawlScheduler(opts: SchedulerOptions): Promise<ToolResult> {
    const started = Date.now();
    const { input, logger } = opts;
    const seed = new URL(input.seed_url);
    const include = toRegexes(input.include_patterns);
    const exclude = toRegexes(input.exclude_patterns);

    const queue = new UrlQueue();
    const dedupe = new DedupeSet();
    const limiter = new HostRateLimiter(opts.hostCooldownMs);

    queue.enqueue({ url: seed.toString(), depth: 0 });
    dedupe.addUrl(seed.toString());

    const pages: CrawlPage[] = [];
    const items: CrawlItem[] = [];
    let retries = 0;

    while (queue.size > 0 && pages.length < input.max_pages) {
        const task = queue.dequeue();
        if (!task) {
            break;
        }

        await limiter.waitFor(task.url);

        let remote: RemoteResponse;
        let strategy: "edge_fetch" | "edge_browser" = input.strategy === "edge_browser" ? "edge_browser" : "edge_fetch";

        try {
            await opts.urlPolicy.assertAllowed(task.url);

            const payload = {
                url: task.url,
                timeout_ms: opts.timeoutMs,
                mode: input.strategy === "edge_browser" ? "article" : "raw",
            };

            if (input.strategy === "edge_browser") {
                const renderResult = await withRetry(
                    () => cfRender({ endpoint: opts.endpoint, token: opts.token, timeoutMs: opts.timeoutMs }, payload),
                    opts.maxRetries,
                );
                retries += renderResult.retries;
                remote = renderResult.value;
            } else if (input.strategy === "edge_fetch") {
                const fetchResult = await withRetry(
                    () => cfFetch({ endpoint: opts.endpoint, token: opts.token, timeoutMs: opts.timeoutMs }, payload),
                    opts.maxRetries,
                );
                retries += fetchResult.retries;
                remote = fetchResult.value;
            } else {
                const fetchResult = await withRetry(
                    () => cfFetch({ endpoint: opts.endpoint, token: opts.token, timeoutMs: opts.timeoutMs }, payload),
                    opts.maxRetries,
                );
                retries += fetchResult.retries;
                remote = fetchResult.value;

                if (shouldUpgradeToRender(fetchResult.value)) {
                    const renderResult = await withRetry(
                        () =>
                            cfRender(
                                { endpoint: opts.endpoint, token: opts.token, timeoutMs: opts.timeoutMs },
                                {
                                    url: task.url,
                                    mode: "article",
                                    timeout_ms: opts.timeoutMs,
                                },
                            ),
                        opts.maxRetries,
                    );
                    retries += renderResult.retries;
                    if (renderResult.value.ok) {
                        remote = renderResult.value;
                        strategy = "edge_browser";
                    }
                }
            }
        } catch (error) {
            logger.warn({ url: task.url, err: String(error) }, "page crawl failed, skip");
            continue;
        }

        const html = remote.html ?? remote.body ?? "";
        const article = extractArticle(html);
        const listing = extractListing(task.url, html);
        const pagerLinks = extractPaginationLinks(task.url, html);

        pages.push({
            url: task.url,
            final_url: remote.final_url ?? task.url,
            status: remote.status,
            strategy_used: strategy,
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

        if (task.depth >= input.depth) {
            continue;
        }

        const candidateLinks = [...listing.links, ...pagerLinks];
        for (const link of candidateLinks) {
            try {
                const parsed = new URL(link);
                if (!allowByScope(seed, parsed, input.scope)) {
                    continue;
                }
                if (include.length > 0 && !include.some((regex) => regex.test(parsed.toString()))) {
                    continue;
                }
                if (exclude.some((regex) => regex.test(parsed.toString()))) {
                    continue;
                }

                const normalized = parsed.toString();
                await opts.urlPolicy.assertAllowed(normalized);

                if (dedupe.hasUrl(normalized)) {
                    continue;
                }

                dedupe.addUrl(normalized);
                queue.enqueue({ url: normalized, depth: task.depth + 1 });
            } catch {
                logger.debug({ link }, "skip malformed or blocked link");
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
