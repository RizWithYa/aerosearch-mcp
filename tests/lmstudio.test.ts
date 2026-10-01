import { describe, it, expect } from "vitest";
import { NanoSearchServer } from "../src/server.js";

describe("LM Studio Integration (qwen3.8-2b-distill)", () => {
  it("interacts with local LM Studio model via web_search tool", async () => {
    // Check if LM Studio is running
    let isLmStudioAlive = false;
    try {
      const check = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(1500) });
      if (check.ok) isLmStudioAlive = true;
    } catch {
      // LM Studio not running in current CI/test env
    }

    if (!isLmStudioAlive) {
      console.warn("Skipping live LM Studio test: LM Studio not active on :1234");
      return;
    }

    const server = new NanoSearchServer({ dbPath: ":memory:" });

    let activeModel = "qwen3.8-2b-distill";
    try {
      const modelsRes = await fetch("http://localhost:1234/api/v1/models");
      if (modelsRes.ok) {
        const data = (await modelsRes.json()) as { models?: Array<{ key: string; loaded_instances?: unknown[] }> };
        const loaded = data.models?.find((m) => m.loaded_instances && m.loaded_instances.length > 0);
        if (loaded) {
          activeModel = loaded.key;
        }
      }
    } catch {}

    const response = await fetch("http://localhost:1234/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: activeModel,
        messages: [
          {
            role: "system",
            content: "You are a research assistant with real-time web search capability. Always invoke the web_search tool to check current information.",
          },
          { role: "user", content: "What is the latest stable release of TypeScript? Use the web_search tool." },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "web_search",
              description: "Search the live web and retrieve key facts from multiple verified sources.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Keywords to search on the live web"
                  }
                },
                required: ["query"]
              }
            }
          }
        ],
        tool_choice: "auto",
        temperature: 0.1
      })
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    const message = data.choices[0].message;

    expect(message.tool_calls).toBeDefined();
    expect(message.tool_calls.length).toBeGreaterThan(0);
    expect(message.tool_calls[0].function.name).toBe("web_search");

    const parsedArgs = JSON.parse(message.tool_calls[0].function.arguments);
    expect(parsedArgs.query).toBeDefined();

    // Verify NanoSearch can execute the generated query
    const searchResult = await server.handleSearch(parsedArgs.query);
    expect(searchResult).toContain("Verified Web Consensus");
    expect(searchResult.length).toBeGreaterThan(100);

    server.cache.close();
  }, 30000);
});
