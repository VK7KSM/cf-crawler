export type CrawlKind = "scrape-page" | "crawl-site";

export interface Diagnostics {
    status: string;
    timings: Record<string, number>;
    retries: number;
    cache_hit: boolean;
}

export interface CrawlItem {
    url: string;
    title: string;
    summary: string;
    published_at?: string;
}

export interface CrawlPage {
    url: string;
    final_url: string;
    status: number;
    strategy_used: "edge_fetch" | "edge_browser";
    title: string;
    markdown: string;
    anti_bot_signals: string[];
}

export interface ScrapePageInput {
    url: string;
    goal: string;
    mode: "article" | "feed" | "listing" | "raw" | "screenshot";
    strategy?: "auto" | "edge_fetch" | "edge_browser";
    selectors?: string[];
    session_id?: string;
    persist_path?: string;
}

export interface CrawlSiteInput {
    seed_url: string;
    goal: string;
    scope: "same_path" | "same_host" | "custom";
    max_pages: number;
    depth: number;
    include_patterns?: string[];
    exclude_patterns?: string[];
    strategy?: "auto" | "edge_fetch" | "edge_browser";
    persist_path?: string;
}

export interface ToolResult {
    success: boolean;
    strategy_used: "edge_fetch" | "edge_browser";
    final_url: string;
    title: string;
    markdown: string;
    items: CrawlItem[];
    anti_bot_signals: string[];
    diagnostics: Diagnostics;
    pages?: CrawlPage[];
}
