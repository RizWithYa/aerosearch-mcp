# AeroSearch MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-87%20passed-brightgreen.svg)]()
[![Model Compatibility](https://img.shields.io/badge/models-2B%20%7C%204B%20%7C%208B%2B-blueviolet.svg)]()

AeroSearch is a local Model Context Protocol (MCP) server for web search and content extraction. It is designed for small language models (1B to 4B parameters) running locally in tools like LM Studio, OpenCode, Ollama, and Claude Desktop.

Most existing search MCP servers depend on paid API keys (Tavily, Brave, Exa) and return large raw HTML payloads that overflow small context windows. AeroSearch operates without external API keys, extracts clean text under 800 tokens, and caches repeated queries in SQLite for sub-millisecond responses.

---

## Capabilities

- Zero API keys: Queries public search and encyclopedic endpoints (DuckDuckGo HTML, Bing, Google News RSS, HackerNews Algolia, and Wikipedia API) without paid accounts or token limits.
- Global and multilingual: Supports worldwide search queries in English, Indonesian, and other languages. Regional handlers (such as BMKG seismic data and Indonesian news streams) activate automatically only when relevant regional keywords are present.
- Direct URL reading: Passing any web link bypasses search engine latency to directly fetch, parse, and clean the page via Readability in under one second.
- Specialized live handlers:
  - Weather: Real-time global forecast, temperature, humidity, and wind conditions via Open-Meteo API.
  - Cryptocurrency: Current prices in USD and IDR with 24-hour change via CoinGecko API.
  - Package registries: Stable version numbers, licenses, and metadata from npm and PyPI.
  - Earthquakes: Real-time seismic sensor reports from BMKG.
- Noise stripping: Automatically removes inline publisher noise, including "read also" links, video promo banners, pagination artifacts, and cookie notices.
- Anti-cutoff date grounding: Injects current real-world date information to prevent local models from rejecting queries about recent events.
- Local SQLite cache: Persists search results to a local database (`aerosearch.db`), answering repeated queries in under 1ms with zero network requests.
- Adaptive token budget (`NANO_MODE`):
  - `compact` (default): Limits output to the top two sources and 600 characters per source (~300 to 500 tokens). Designed for 1B and 2B models.
  - `detailed`: Delivers up to four sources (~1,200 tokens) for 4B and larger models.

---

## Installation

Requirements: Node.js 18 or newer.

```bash
git clone https://github.com/RizWithYa/aerosearch-mcp.git
cd aerosearch-mcp
npm install
npm run build
npm test
```

The compiled binary will be located at `dist/index.js`.

---

## Client Configuration

### OpenCode

Add AeroSearch to your OpenCode configuration file (`~/.config/opencode/opencode.json` or project `opencode.json`) under the `mcp` section:

```json
{
  "mcp": {
    "aerosearch": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/aerosearch-mcp/dist/index.js"
      ],
      "environment": {
        "NANO_MODE": "compact"
      }
    }
  }
}
```

### LM Studio

Add to `~/.lmstudio/mcp.json`:

```json
{
  "mcpServers": {
    "aerosearch": {
      "command": "node",
      "args": ["/absolute/path/to/aerosearch-mcp/dist/index.js"],
      "env": {
        "NANO_MODE": "compact"
      }
    }
  }
}
```

Then enable `mcp/aerosearch` in the LM Studio Integrations panel.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aerosearch": {
      "command": "node",
      "args": ["/absolute/path/to/aerosearch-mcp/dist/index.js"]
    }
  }
}
```

---

## Exposed Tools

AeroSearch exposes two minimal tools to avoid decision overhead in smaller models:

### `web_search`

Searches the web or reads a direct URL:

```json
{
  "query": "string"
}
```

### `get_current_date`

Returns current real-world date and time:

```json
{}
```

---

## Architecture

```text
[Client: OpenCode / LM Studio / Claude Desktop]
                     │
                     ▼ stdio: web_search({ query })
           [AeroSearch MCP Server]
                     │
     ┌───────────────┴───────────────┐
     ▼                               ▼
[Direct URL Input?]            [Cache Check]
     │                               │
     ├─ Yes: Readability Fetch       ├─ Hit: Return in <1ms
     │       in <1s                  │
     └─ No ──────────────────────────┴─► [Specialized / Cascade Search]
                                                 │
                                                 ├─ Weather: Open-Meteo
                                                 ├─ Crypto: CoinGecko
                                                 ├─ Package: npm / PyPI
                                                 ├─ Disasters: BMKG
                                                 └─ Web: DDG, Bing, Google News,
                                                         HackerNews, Wikipedia
                                                 │
                                                 ▼
                                     [Noise & Boilerplate Stripper]
                                                 │
                                                 ▼
                                     [Sanitization & Budget Formatter]
                                                 │
                                                 ▼
                                     [High-Density Markdown Result]
```

---

## Verification

Run the test suite:

```bash
npm test
```

```text
 ✓ tests/types.test.ts (1 test)
 ✓ tests/filter.test.ts (13 tests)
 ✓ tests/formatter.test.ts (11 tests)
 ✓ tests/cache.test.ts (10 tests)
 ✓ tests/search.test.ts (23 tests)
 ✓ tests/extractor.test.ts (13 tests)
 ✓ tests/server.test.ts (12 tests)
 ✓ tests/e2e.test.ts (2 tests)
 ✓ tests/lmstudio.test.ts (1 test)

Test Files  9 passed (9)
     Tests  87 passed (87)
```

---

## License

MIT. Copyright (c) 2026 RizWithYA.
