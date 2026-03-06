import type pino from "pino";
import { z } from "zod";
import { runCrawlScheduler } from "../../core/scheduler.js";
import { loadRuntimeConfig } from "../../runtime_config.js";
import { UrlPolicy } from "../../security/url_policy.js";
import { persistJson } from "../../storage/files.js";
import { ensureSqliteSchema } from "../../storage/sqlite.js";
import type { CrawlSiteInput, ToolResult } from "../../types.js";

const schema = z.object({
    seed_url: z.string().url(),
    goal: z.string().min(1),
    scope: z.enum(["same_path", "same_host", "custom"]).default("same_host"),
    max_pages: z.number().int().min(1).max(200).default(20),
    depth: z.number().int().min(0).max(6).default(2),
    include_patterns: z.array(z.string()).optional(),
    exclude_patterns: z.array(z.string()).optional(),
    strategy: z.enum(["auto", "edge_fetch", "edge_browser"]).default("auto"),
    persist_path: z.string().optional(),
});

export async function runCrawlSite(raw: unknown, logger: pino.Logger): Promise<ToolResult> {
    const input = schema.parse(raw) as CrawlSiteInput;
    const config = loadRuntimeConfig();

    const urlPolicy = new UrlPolicy({
        allowedHosts: config.allowedHosts,
        blockPrivateIp: config.blockPrivateIp,
    });
    await urlPolicy.assertAllowed(input.seed_url);

    const output = await runCrawlScheduler({
        input,
        endpoint: config.endpoint,
        token: config.token,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        hostCooldownMs: config.hostCooldownMs,
        urlPolicy,
        logger,
    });

    if (input.persist_path) {
        await persistJson(input.persist_path, output);
        if (config.dbPath) {
            await ensureSqliteSchema(config.dbPath);
        }
    }

    return output;
}
