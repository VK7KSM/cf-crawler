import * as cheerio from "cheerio";
import type { CrawlItem } from "../types.js";

export interface ListingExtraction {
    items: CrawlItem[];
    links: string[];
}

export function extractListing(baseUrl: string, html: string): ListingExtraction {
    const $ = cheerio.load(html);
    const links = new Set<string>();
    const items: CrawlItem[] = [];

    $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) {
            return;
        }
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text.length < 10) {
            return;
        }

        try {
            const absolute = new URL(href, baseUrl).toString();
            links.add(absolute);
            items.push({
                url: absolute,
                title: text,
                summary: text.slice(0, 140),
            });
        } catch {
            // Ignore malformed URLs.
        }
    });

    return {
        items: items.slice(0, 80),
        links: Array.from(links),
    };
}
