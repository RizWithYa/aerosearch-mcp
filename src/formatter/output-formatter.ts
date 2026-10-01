import type { ExtractedSource } from "../types.js";

export type NanoMode = "compact" | "detailed";

export class OutputFormatter {
  private readonly mode: NanoMode;

  private readonly injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/gi,
    /system\s+prompt\s+override/gi,
    /you\s+are\s+now\s+(DAN|unrestricted)/gi,
    /disregard\s+(all\s+)?(above|previous\s+instructions|prior\s+instructions)/gi,
  ];

  constructor(mode?: NanoMode) {
    if (mode) {
      this.mode = mode;
    } else {
      this.mode = process.env.NANO_MODE === "detailed" ? "detailed" : "compact";
    }
  }

  public sanitize(text: string): string {
    let clean = text;
    for (const pattern of this.injectionPatterns) {
      clean = clean.replace(pattern, "[FILTERED_INSTRUCTION]");
    }
    return clean;
  }

  public formatSources(query: string, sources: ExtractedSource[]): string {
    const now = new Date();
    const currentDateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    if (sources.length === 0) {
      return `No verified web sources could be retrieved for query: "${query}". Current real-world date is ${currentDateStr}. Try refining your search keywords.`;
    }

    const maxSources = this.mode === "compact" ? 2 : 4;
    const maxCharsPerSource = this.mode === "compact" ? 600 : 1200;
    const selectedSources = sources.slice(0, maxSources);

    const lines: string[] = [];
    lines.push(`=== Verified Web Consensus (${selectedSources.length} SOURCES) ===`);
    lines.push(`[SYSTEM REAL-WORLD DATE: ${currentDateStr}]`);
    lines.push(`Query: "${query}"\n`);

    selectedSources.forEach((src, idx) => {
      let content = src.content;
      if (content.length > maxCharsPerSource) {
        const sliced = content.slice(0, maxCharsPerSource);
        const lastDot = Math.max(sliced.lastIndexOf("."), sliced.lastIndexOf("!"), sliced.lastIndexOf("?"));
        content = lastDot > maxCharsPerSource * 0.6 ? sliced.slice(0, lastDot + 1) : sliced;
      }

      lines.push(`[SOURCE ${idx + 1}: ${src.domain}] (Credibility: ${src.credibility})`);
      lines.push(`Title: ${this.sanitize(src.title)}`);
      lines.push(`URL: ${src.url}`);
      lines.push(`Key Information:`);
      lines.push(`"${this.sanitize(content)}"`);
      lines.push("");
    });

    lines.push("---");
    lines.push("Note: The above information was extracted directly from live web sources for factual synthesis.");

    return lines.join("\n").trim();
  }
}
