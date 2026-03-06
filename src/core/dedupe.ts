import { createHash } from "node:crypto";

export class DedupeSet {
    private readonly urlSet = new Set<string>();
    private readonly contentSet = new Set<string>();

    hasUrl(url: string): boolean {
        return this.urlSet.has(url);
    }

    addUrl(url: string): void {
        this.urlSet.add(url);
    }

    hasContent(content: string): boolean {
        return this.contentSet.has(this.hash(content));
    }

    addContent(content: string): void {
        this.contentSet.add(this.hash(content));
    }

    private hash(value: string): string {
        return createHash("sha256").update(value).digest("hex");
    }
}
