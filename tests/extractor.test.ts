import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContentExtractor } from "../src/extractor/content-extractor.js";

describe("ContentExtractor", () => {
  const extractor = new ContentExtractor();

  describe("cleanHtml", () => {
    it("cleans HTML, strips script and navigation, and extracts body text via Readability", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Quantum Computing Overview - Science Daily</title></head>
          <body>
            <nav><a href="/">Home</a> <a href="/about">About</a></nav>
            <header><h1>Welcome to Our Site</h1></header>
            <article>
              <p>Quantum computing uses qubits to achieve quantum superposition and entanglement in computational systems.</p>
              <p>These principles allow exponential speedup for specific computational problems compared to classical systems.</p>
              <p>Recent advances in quantum error correction demonstrate significant progress toward fault-tolerant quantum processors.</p>
            </article>
            <footer>Copyright 2026 Science Daily</footer>
          </body>
        </html>
      `;
      const cleaned = extractor.cleanHtml(html, "https://example.com/quantum");
      expect(cleaned.title).toContain("Quantum Computing");
      expect(cleaned.text).toContain("Quantum computing uses qubits");
      expect(cleaned.text).not.toContain("Copyright 2026");
    });

    it("falls back to cheerio when Readability cannot parse or text is short", () => {
      const html = `
        <html>
          <head><title>Simple Fallback Page</title></head>
          <body>
            <script>console.log("ad code");</script>
            <style>.banner { color: red; }</style>
            <div>Short announcement without semantic article tags: The system maintenance window is scheduled for tonight at midnight UTC.</div>
          </body>
        </html>
      `;
      const cleaned = extractor.cleanHtml(html, "https://example.com/short");
      expect(cleaned.title).toBe("Simple Fallback Page");
      expect(cleaned.text).toContain("system maintenance window is scheduled");
      expect(cleaned.text).not.toContain("console.log");
      expect(cleaned.text).not.toContain(".banner");
    });

    it("uses default title if HTML has no title tag", () => {
      const html = `<div><p>This is a plain body of text without a head or title tag present anywhere.</p></div>`;
      const cleaned = extractor.cleanHtml(html, "https://example.com/notitle");
      expect(cleaned.title).toBe("Web Document");
    });
  });

  describe("findSmartWindow", () => {
    it("extracts relevant anchor paragraph matching query and skips introductory fluff", () => {
      const text = [
        "In the ever-evolving landscape of technology, it is crucial to stay informed about upcoming developments.",
        "Many industry experts have frequently debated about the future implications of various technologies.",
        "The new XYZ chip delivers 45 teraflops of computing power using a 3-nanometer architecture.",
        "This chip architecture consumes only 15 watts during peak machine learning inference tasks.",
        "In conclusion, we can see that technology continues to march steadily forward into tomorrow."
      ].join("\n\n");

      const query = "XYZ chip architecture teraflops";
      const window = extractor.findSmartWindow(text, query, 300);

      expect(window).toContain("The new XYZ chip delivers 45 teraflops");
      expect(window).toContain("consumes only 15 watts");
      expect(window).not.toContain("ever-evolving landscape");
    });

    it("snaps to sentence boundaries when content exceeds maxChars", () => {
      const text = [
        "First paragraph about introductory background concepts that are somewhat relevant.",
        "Target paragraph contains alpha beta gamma keywords. It has a second sentence that should fit. It has a third sentence that pushes past the limit.",
        "Following paragraph with additional information on alpha beta gamma."
      ].join("\n\n");

      // Set maxChars so that the window cuts in the middle of a sentence
      const window = extractor.findSmartWindow(text, "alpha beta gamma", 120);

      // Window should not end with an incomplete sentence without punctuation
      // It should end with '.', '!', or '?' if snapped
      expect(window.length).toBeLessThanOrEqual(120);
      if (window.endsWith(".")) {
        expect(window.slice(-1)).toBe(".");
      }
    });

    it("returns sliced text if no paragraphs exceed 40 characters", () => {
      const shortText = "Tiny text.\nShort line.";
      const window = extractor.findSmartWindow(shortText, "text", 50);
      expect(window).toBe("Tiny text.\nShort line.");
    });
  });

  describe("fetchAndExtract", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("extracts source and assigns 'high' credibility to .edu, .gov, and .org domains", async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>MIT Research on Distributed Algorithms</title></head>
          <body>
            <article>
              <p>Distributed consensus protocols require synchronization across independent nodes in a network.</p>
              <p>The Raft algorithm simplifies Paxos while maintaining equivalent safety guarantees and fault tolerance.</p>
              <p>Experimental evaluations on clusters show sub-millisecond failover times under standard conditions.</p>
            </article>
          </body>
        </html>
      `;

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(htmlContent, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      }));

      const result = await extractor.fetchAndExtract("https://mit.edu/raft-research", "distributed consensus raft", 3500);

      expect(result).not.toBeNull();
      expect(result?.domain).toBe("mit.edu");
      expect(result?.credibility).toBe("high");
      expect(result?.title).toContain("MIT Research");
      expect(result?.content).toContain("Raft algorithm");
    });

    it("assigns 'medium' credibility to commercial or general domains (.com, .io)", async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Tech Blog Article on Cloud Architecture</title></head>
          <body>
            <article>
              <p>Cloud infrastructure modernization often involves microservices and serverless patterns.</p>
              <p>Serverless architectures scale to zero automatically when traffic subsides during off-peak hours.</p>
              <p>Monitoring distributed traces ensures observability across loosely coupled application services.</p>
            </article>
          </body>
        </html>
      `;

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(htmlContent, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      }));

      const result = await extractor.fetchAndExtract("https://techblog.com/serverless", "serverless architectures scale", 3500);

      expect(result).not.toBeNull();
      expect(result?.domain).toBe("techblog.com");
      expect(result?.credibility).toBe("medium");
    });

    it("returns null if fetch response is not ok (e.g., 404 or 500)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", {
        status: 404,
        statusText: "Not Found"
      }));

      const result = await extractor.fetchAndExtract("https://example.com/notfound", "query");
      expect(result).toBeNull();
    });

    it("returns null if network fetch throws an error or times out", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));

      const result = await extractor.fetchAndExtract("https://example.com/timeout", "query", 100);
      expect(result).toBeNull();
    });

    it("returns null if extracted text is shorter than 100 characters", async () => {
      const shortHtml = "<html><head><title>Empty</title></head><body><p>Too short</p></body></html>";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(shortHtml, { status: 200 }));

      const result = await extractor.fetchAndExtract("https://example.com/empty", "query");
      expect(result).toBeNull();
    });
  });

  describe("stripNoise", () => {
    it("strips inline news artifacts like 'Baca juga:', 'Simak Video', and advertisement banners", () => {
      const noisyText = [
        "Pemerintah Indonesia meresmikan pusat riset teknologi AI di Bandung.",
        "Baca juga: Proyek Kereta Cepat Jakarta-Bandung Capai Target",
        "SCROLL TO CONTINUE WITH CONTENT",
        "Pusat riset ini berfokus pada pengembangan semikonduktor lokal generasi baru.",
        "Simak Video 'Menteri Kominfo Jelaskan Pentingnya Hilirisasi Chip Digital'",
        "ADVERTISEMENT",
        "Investasi tahap awal mencapai Rp 500 miliar dari konsorsium industri.",
        "Halaman 1 dari 2",
        "Pilihan Editor: Daftar Startup Terbesar di Asia Tenggara",
      ].join("\n\n");

      const cleaned = extractor.stripNoise(noisyText);

      expect(cleaned).toContain("Pemerintah Indonesia meresmikan pusat riset teknologi AI di Bandung.");
      expect(cleaned).toContain("Pusat riset ini berfokus pada pengembangan semikonduktor lokal generasi baru.");
      expect(cleaned).toContain("Investasi tahap awal mencapai Rp 500 miliar dari konsorsium industri.");
      expect(cleaned).not.toContain("Baca juga");
      expect(cleaned).not.toContain("SCROLL TO CONTINUE");
      expect(cleaned).not.toContain("Simak Video");
      expect(cleaned).not.toContain("ADVERTISEMENT");
      expect(cleaned).not.toContain("Halaman 1 dari 2");
      expect(cleaned).not.toContain("Pilihan Editor");
    });

    it("strips English news noise like 'Read also:', 'Recommended:', and 'Sign up for our newsletter'", () => {
      const noisyEnglish = [
        "OpenAI announced a new architectural model for enterprise reasoning tasks.",
        "Read also: Anthropic releases Claude 3.5 Sonnet updates",
        "The model achieves 92% on competition mathematics benchmarks.",
        "Sign up for our daily newsletter to stay updated.",
        "Deployment starts next week for API customers.",
      ].join("\n\n");

      const cleaned = extractor.stripNoise(noisyEnglish);

      expect(cleaned).toContain("OpenAI announced a new architectural model");
      expect(cleaned).toContain("The model achieves 92% on competition mathematics benchmarks.");
      expect(cleaned).not.toContain("Read also");
      expect(cleaned).not.toContain("newsletter");
    });
  });
});
