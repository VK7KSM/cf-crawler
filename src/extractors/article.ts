import * as cheerio from "cheerio";

export interface ArticleExtraction {
    title: string;
    markdown: string;
}

export function extractArticle(html: string): ArticleExtraction {
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || $("h1").first().text().trim() || "";

    const candidate = $("article").first().length
        ? $("article").first()
        : $("main").first().length
          ? $("main").first()
          : $("body");

    const lines: string[] = [];
    candidate.find("h1, h2, h3, p, li").each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text.length >= 20) {
            lines.push(text);
        }
    });

    return {
        title,
        markdown: lines.slice(0, 80).join("\n\n"),
    };
}
