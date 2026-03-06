import * as cheerio from "cheerio";

const pagerHints = ["next", "older", "more", "下一页", "下页"];

export function extractPaginationLinks(baseUrl: string, html: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();

    $("a[href]").each((_, el) => {
        const href = $(el).attr("href") ?? "";
        const rel = ($(el).attr("rel") ?? "").toLowerCase();
        const text = $(el).text().toLowerCase();

        const looksLikePager = rel.includes("next") || pagerHints.some((hint) => text.includes(hint));
        if (!looksLikePager) {
            return;
        }

        try {
            links.add(new URL(href, baseUrl).toString());
        } catch {
            // Ignore malformed URLs.
        }
    });

    return Array.from(links);
}
