export class HostRateLimiter {
    private readonly nextAllowed = new Map<string, number>();
    constructor(private readonly hostCooldownMs: number) {}

    async waitFor(url: string): Promise<void> {
        const host = new URL(url).host;
        const now = Date.now();
        const ready = this.nextAllowed.get(host) ?? now;

        if (ready > now) {
            await new Promise((resolve) => setTimeout(resolve, ready - now));
        }

        this.nextAllowed.set(host, Date.now() + this.hostCooldownMs);
    }
}
