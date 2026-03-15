import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pino from "pino";
import { z } from "zod";
import { runAgentReachEnsure } from "./commands/agent-reach-ensure.js";
import { runCrawlSite } from "./commands/crawl-site.js";
import { runLogin } from "./commands/login.js";
import { runScrapePage } from "./commands/scrape-page.js";
import { cfHealth } from "../executors/cf_health.js";
import { loadRuntimeConfig } from "../runtime_config.js";

const logger = pino({ name: "cf-crawler" });

const argv = process.argv.slice(2);

const command = argv[0];
const allowedCommands = new Set(["scrape-page", "crawl-site", "health", "agent-reach-ensure", "login", "help"]);
if (!command || !allowedCommands.has(command)) {
    process.stderr.write(
        "Usage: cf-crawler <scrape-page|crawl-site|health|login|agent-reach-ensure|help> [--input <file>] [--json <json>] [--pretty]\\n",
    );
    process.exit(2);
}

const parseArgs = z.object({
    input: z.string().optional(),
    json: z.string().optional(),
    pretty: z.boolean().default(false),
});

function parseCliFlags(raw: string[]) {
    const out: Record<string, unknown> = { pretty: false };
    for (let i = 0; i < raw.length; i += 1) {
        const token = raw[i];
        if (token === "--pretty") {
            out.pretty = true;
            continue;
        }
        if ((token === "--input" || token === "--json") && raw[i + 1]) {
            out[token.slice(2)] = raw[i + 1];
            i += 1;
        }
    }
    return parseArgs.parse(out);
}

function parseJsonText(raw: string) {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

async function loadPayload(flags: { input?: string; json?: string }) {
    if (flags.json) {
        return parseJsonText(flags.json);
    }
    if (flags.input) {
        const path = resolve(flags.input);
        const content = await readFile(path, "utf8");
        return parseJsonText(content);
    }
    // Read from stdin if piped (not a TTY)
    if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (text.length > 0) {
            return parseJsonText(text);
        }
    }
    return {};
}

async function main() {
    const flags = parseCliFlags(argv.slice(1));
    const config = loadRuntimeConfig();

    if (command === "help") {
        const helpText = [
            "cf-crawler — Cloudflare Workers web crawler",
            "",
            "Commands:",
            "  health              Check if the Cloudflare Worker is running",
            "  scrape-page         Scrape a single page (article/feed/listing/raw/screenshot)",
            "  crawl-site          Crawl multiple pages via BFS",
            "  login               Automate login and create reusable session",
            "  agent-reach-ensure  Check/install agent-reach tool",
            "",
            "Input: echo '<json>' | cf-crawler <cmd> --pretty",
            "",
            "Preferred skill tools (use these instead of shell commands in agent context):",
            "  web_scrape(json_input='{\"url\":\"URL\",\"goal\":\"goal\",\"mode\":\"feed\"}')",
            "  web_crawl(json_input='{\"seed_url\":\"URL\",\"goal\":\"goal\",\"max_pages\":5}')",
            "  web_login(json_input='{\"url\":\"URL\",\"steps\":[...]}')",
            "  web_health()",
        ].join("\n");
        const out = { success: true, command: "help", help: helpText };
        process.stdout.write(`${JSON.stringify(out, null, flags.pretty ? 2 : 0)}\n`);
        return;
    }

    if (command === "health") {
        const health = await cfHealth(config.endpoint, config.token, config.timeoutMs);
        const result = {
            ok: health.ok,
            command: "health",
            endpoint: config.endpoint,
            status_code: health.statusCode,
            total_ms: health.totalMs,
            remote: health.body,
            timestamp: new Date().toISOString(),
        };
        process.stdout.write(flags.pretty ? `${JSON.stringify(result, null, 2)}\\n` : `${JSON.stringify(result)}\\n`);
        return;
    }

    if (command === "agent-reach-ensure") {
        const result = await runAgentReachEnsure(logger);
        process.stdout.write(flags.pretty ? `${JSON.stringify(result, null, 2)}\\n` : `${JSON.stringify(result)}\\n`);
        return;
    }

    const payload = await loadPayload(flags);

    if (command === "login") {
        const result = await runLogin(payload, logger);
        process.stdout.write(flags.pretty ? `${JSON.stringify(result, null, 2)}\\n` : `${JSON.stringify(result)}\\n`);
        return;
    }

    const result = command === "scrape-page" ? await runScrapePage(payload, logger) : await runCrawlSite(payload, logger);

    process.stdout.write(flags.pretty ? `${JSON.stringify(result, null, 2)}\\n` : `${JSON.stringify(result)}\\n`);
}

main().catch((error) => {
    logger.error({ err: error }, "command failed");
    const out = {
        success: false,
        error: String(error instanceof Error ? error.message : error),
        // elfClaw: guide agent toward skill tools on any command failure
        hint: "Skill tools are preferred over shell commands. Use: web_scrape, web_crawl, web_login, web_health. Run 'cf-crawler help' for full usage.",
    };
    process.stderr.write(`${out.error}\n`);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(1);
});
