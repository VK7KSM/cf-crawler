function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
        return fallback;
    }

    const normalized = Math.trunc(value);
    if (normalized < min) {
        return min;
    }
    if (normalized > max) {
        return max;
    }
    return normalized;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(value)) {
        return false;
    }
    return fallback;
}

function parseCsvEnv(name: string): string[] {
    const raw = process.env[name];
    if (!raw) {
        return [];
    }

    return raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
}

export interface RuntimeConfig {
    endpoint: string;
    token?: string;
    timeoutMs: number;
    dbPath?: string;
    hostCooldownMs: number;
    maxRetries: number;
    allowedHosts: string[];
    blockPrivateIp: boolean;
    agentReachCommand?: string;
    agentReachMinVersion?: string;
    agentReachAutoUpdate: boolean;
    agentReachTimeoutMs: number;
}

export function loadRuntimeConfig(): RuntimeConfig {
    return {
        endpoint: process.env.CF_CRAWLER_ENDPOINT ?? "http://127.0.0.1:8787",
        token: process.env.CF_CRAWLER_TOKEN,
        timeoutMs: parseIntEnv("CF_CRAWLER_TIMEOUT_MS", 20_000, 1_000, 120_000),
        dbPath: process.env.CF_CRAWLER_DB_PATH,
        hostCooldownMs: parseIntEnv("CF_CRAWLER_HOST_COOLDOWN_MS", 1_200, 100, 60_000),
        maxRetries: parseIntEnv("CF_CRAWLER_MAX_RETRIES", 2, 0, 8),
        allowedHosts: parseCsvEnv("CF_CRAWLER_ALLOWED_HOSTS"),
        blockPrivateIp: parseBoolEnv("CF_CRAWLER_BLOCK_PRIVATE_IP", true),
        agentReachCommand: process.env.AGENT_REACH_COMMAND,
        agentReachMinVersion: process.env.AGENT_REACH_MIN_VERSION,
        agentReachAutoUpdate: parseBoolEnv("AGENT_REACH_AUTO_UPDATE", true),
        agentReachTimeoutMs: parseIntEnv("AGENT_REACH_TIMEOUT_MS", 90_000, 5_000, 600_000),
    };
}
