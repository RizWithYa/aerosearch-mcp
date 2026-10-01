export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain?: string;
}

export interface ExtractedSource {
  title: string;
  url: string;
  domain: string;
  content: string;
  credibility: "high" | "medium";
}

export interface SearchResponse {
  query: string;
  sources: ExtractedSource[];
  formattedOutput: string;
}

export interface CacheEntry {
  key: string;
  query: string;
  result: string;
  createdAt: number;
  expiresAt: number;
}
