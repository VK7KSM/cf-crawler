import type pino from "pino";
import { z } from "zod";
import { withRetry } from "../../core/retry.js";
import { shouldUpgradeToRender } from "../../executors/decision.js";
import { cfFetch } from "../../executors/cf_fetch.js";
import { cfRender } from "../../executors/cf_render.js";
import { cfBypass } from "../../executors/cf_bypass.js";
import type { RemoteResponse } from "../../executors/types.js";
import { extractArticle } from "../../extractors/article.js";
import { extractListing } from "../../extractors/listing.js";
import { loadRuntimeConfig } from "../../runtime_config.js";
import { UrlPolicy } from "../../security/url_policy.js";
import { persistJson } from "../../storage/files.js";
import { ensureSqliteSchema } from "../../storage/sqlite.js";
import type { ScrapePageInput, ToolResult } from "../../types.js";

const schema = z.object({
    url: z.string().url(),
    goal: z.string().min(1),
    mode: z.enum(["article", "feed", "listing", "raw", "screenshot"]).default("article"),
    strategy: z.enum(["auto", "edge_fetch", "edge_browser", "paywall_bypass"]).default("auto"),
    selectors: z.array(z.string()).optional(),
    session_id: z.string().optional(),
    persist_path: z.string().optional(),
    device_type: z.enum(["desktop", "mobile", "auto"]).optional(),
});

export async function runScrapePage(raw: unknown, logger: pino.Logger): Promise<ToolResult> {
    const input = schema.parse(raw) as ScrapePageInput;
    const started = Date.now();
    const config = loadRuntimeConfig();

    const policy = new UrlPolicy({
        allowedHosts: config.allowedHosts,
        blockPrivateIp: config.blockPrivateIp,
    });
    await policy.assertAllowed(input.url);

    const execCfg = { endpoint: config.endpoint, token: config.token, timeoutMs: config.timeoutMs };

    // Paywall bypass strategy
    if (input.strategy === "paywall_bypass") {
        const bypassResult = await cfBypass(execCfg, {
            url: input.url,
            goal: input.goal,
            mode: input.mode,
            timeout_ms: config.timeoutMs,
            session_id: input.session_id,
        });

        const html = bypassResult.html ?? bypassResult.body ?? "";
        const article = extractArticle(html);
        const listing = extractListing(bypassResult.final_url ?? input.url, html);

        const output: ToolResult = {
            success: bypassResult.ok,
            strategy_used: "edge_fetch",
            final_url: bypassResult.final_url ?? input.url,
            title: bypassResult.title ?? article.title,
            markdown: bypassResult.markdown ?? article.markdown,
            items: listing.items,
            anti_bot_signals: bypassResult.anti_bot_signals ?? [],
            diagnostics: {
                status: bypassResult.ok ? "ok" : "error",
                timings: {
                    total_ms: Date.now() - started,
                    remote_ms: bypassResult.timings?.total_ms ?? 0,
                },
                retries: 0,
                cache_hit: false,
            },
            bypass_strategy_used: bypassResult.bypass_strategy_used,
        };

        if (input.persist_path) {
            await persistJson(input.persist_path, output);
            if (config.dbPath) await ensureSqliteSchema(config.dbPath);
        }

        logger.info({ url: input.url, bypass: output.bypass_strategy_used }, "scrape-page (paywall_bypass) completed");
        return output;
    }

    // Standard strategies (auto / edge_fetch / edge_browser)
    const payload = {
        url: input.url,
        mode: input.mode,
        timeout_ms: config.timeoutMs,
        selectors: input.selectors,
        session_id: input.session_id,
        device_type: input.device_type,
    };

    let strategyUsed: "edge_fetch" | "edge_browser" = input.strategy === "edge_browser" ? "edge_browser" : "edge_fetch";
    let retries = 0;

    let result: RemoteResponse;
    if (input.strategy === "edge_browser") {
        const renderAttempt = await withRetry(
            () => cfRender(execCfg, payload),
            config.maxRetries,
        );
        retries += renderAttempt.retries;
        result = renderAttempt.value;
    } else if (input.strategy === "edge_fetch") {
        const fetchAttempt = await withRetry(
            () => cfFetch(execCfg, payload),
            config.maxRetries,
        );
        retries += fetchAttempt.retries;
        result = fetchAttempt.value;
    } else {
        const fetchAttempt = await withRetry(
            () => cfFetch(execCfg, payload),
            config.maxRetries,
        );
        retries += fetchAttempt.retries;
        result = fetchAttempt.value;

        if (shouldUpgradeToRender(fetchAttempt.value)) {
            const renderAttempt = await withRetry(
                () => cfRender(execCfg, payload),
                config.maxRetries,
            );
            retries += renderAttempt.retries;
            if (renderAttempt.value.ok) {
                strategyUsed = "edge_browser";
                result = renderAttempt.value;
            }
        }
    }

    const html = result.html ?? result.body ?? "";
    const article = extractArticle(html);
    const listing = extractListing(result.final_url ?? input.url, html);

    const output: ToolResult = {
        success: result.ok,
        strategy_used: strategyUsed,
        final_url: result.final_url ?? input.url,
        title: result.title ?? article.title,
        markdown: result.markdown ?? article.markdown,
        items: listing.items,
        anti_bot_signals: result.anti_bot_signals ?? [],
        diagnostics: {
            status: result.ok ? "ok" : "error",
            timings: {
                total_ms: Date.now() - started,
                remote_ms: result.timings?.total_ms ?? 0,
            },
            retries,
            cache_hit: false,
        },
    };

    if (input.persist_path) {
        await persistJson(input.persist_path, output);
        if (config.dbPath) {
            await ensureSqliteSchema(config.dbPath);
        }
    }

    logger.info({ url: input.url, strategy: output.strategy_used }, "scrape-page completed");
    return output;
}
