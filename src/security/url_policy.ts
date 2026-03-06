import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface UrlPolicyOptions {
    allowedHosts: string[];
    blockPrivateIp: boolean;
}

function normalizeHost(hostname: string): string {
    return hostname.trim().toLowerCase();
}

function isPrivateIpv4(ip: string): boolean {
    const parts = ip.split(".").map((value) => Number(value));
    if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return true;
    }

    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) {
        return true;
    }
    if (a === 169 && b === 254) {
        return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return true;
    }
    if (a === 192 && b === 168) {
        return true;
    }
    if (a === 100 && b >= 64 && b <= 127) {
        return true;
    }
    if (a >= 224) {
        return true;
    }

    return false;
}

function isPrivateIpv6(ip: string): boolean {
    const lower = ip.toLowerCase().split("%")[0];
    if (lower === "::1") {
        return true;
    }
    if (lower.startsWith("fc") || lower.startsWith("fd")) {
        return true;
    }
    if (["fe8", "fe9", "fea", "feb"].some((prefix) => lower.startsWith(prefix))) {
        return true;
    }

    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
        return isPrivateIpv4(mapped[1]);
    }

    return false;
}

function isPrivateIp(ip: string): boolean {
    const family = isIP(ip);
    if (family === 4) {
        return isPrivateIpv4(ip);
    }
    if (family === 6) {
        return isPrivateIpv6(ip);
    }
    return true;
}

function matchesHostRule(hostname: string, rule: string): boolean {
    const normalizedHost = normalizeHost(hostname);
    const normalizedRule = normalizeHost(rule);

    if (normalizedRule.startsWith("*.")) {
        const suffix = normalizedRule.slice(2);
        return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }

    if (normalizedRule.startsWith(".")) {
        const suffix = normalizedRule.slice(1);
        return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }

    return normalizedHost === normalizedRule;
}

export class UrlPolicy {
    private readonly hostSafetyCache = new Map<string, boolean>();

    constructor(private readonly options: UrlPolicyOptions) {}

    async assertAllowed(rawUrl: string): Promise<void> {
        let parsed: URL;
        try {
            parsed = new URL(rawUrl);
        } catch {
            throw new Error(`invalid url: ${rawUrl}`);
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(`unsupported protocol: ${parsed.protocol}`);
        }

        const host = normalizeHost(parsed.hostname);
        if (!host) {
            throw new Error("url host is empty");
        }

        if (this.options.allowedHosts.length > 0) {
            const allowed = this.options.allowedHosts.some((rule) => matchesHostRule(host, rule));
            if (!allowed) {
                throw new Error(`host is not in allowlist: ${host}`);
            }
        }

        if (this.options.blockPrivateIp) {
            await this.assertPublicHost(host);
        }
    }

    private async assertPublicHost(host: string): Promise<void> {
        const cached = this.hostSafetyCache.get(host);
        if (cached !== undefined) {
            if (!cached) {
                throw new Error(`host resolves to private or local address: ${host}`);
            }
            return;
        }

        if (isIP(host) > 0) {
            const safe = !isPrivateIp(host);
            this.hostSafetyCache.set(host, safe);
            if (!safe) {
                throw new Error(`host resolves to private or local address: ${host}`);
            }
            return;
        }

        const resolved = await lookup(host, { all: true, verbatim: true });
        if (resolved.length === 0) {
            this.hostSafetyCache.set(host, false);
            throw new Error(`host has no DNS records: ${host}`);
        }

        const safe = resolved.every((entry) => !isPrivateIp(entry.address));
        this.hostSafetyCache.set(host, safe);

        if (!safe) {
            throw new Error(`host resolves to private or local address: ${host}`);
        }
    }
}
