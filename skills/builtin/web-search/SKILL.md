---
name: web-search
description: 当用户明确要求使用 web-search/web search/网络搜索/联网搜索/全网搜索/搜索一下/查最新，或需要搜索发现网页、近期新闻、最新资料、实时公开信息时使用。不要用 web_fetch 替代搜索发现；web_fetch 只适合已有具体 URL。
official: true
version: 1.0.2
---

# Web Search Skill

## When to Use This Skill

Use the web-search skill when you need:

- **Current information** - Events, news, or data after January 2025
- **Latest documentation** - Up-to-date framework/library docs (React 19, Next.js 15, etc.)
- **Real-time data** - Stock prices, weather, sports scores, etc.
- **Fact verification** - Check current status of projects, companies, or technologies
- **Recent discussions** - Community opinions, GitHub issues, Stack Overflow answers
- **Product comparisons** - Latest reviews and comparisons
- **Troubleshooting** - Search for specific error messages or solutions

**Examples of when to use:**
- User: "What are the new features in React 19?"
- User: "Search for the latest Next.js App Router documentation"
- User: "What's the current status of the Rust async project?"
- User: "Find recent discussions about Vue 3 performance"

## How It Works

```
┌──────────┐    Bash    ┌─────────┐    HTTP    ┌──────────────┐    CDP    ┌────────┐
│  Claude  │───────────▶│ CLI.sh  │───────────▶│ Bridge Server│──────────▶│ Chrome │
│          │            │         │            │ (localhost)  │ Playwright│        │
└──────────┘            └─────────┘            └──────────────┘            └────────┘
                                                      │
                                                  ▼
                                         Bing/Baidu/360/Sogou/Google Search
                                                Extract Results
```

**Architecture:**
1. **CLI Script** - Simple bash interface for Claude
2. **Bridge Server** - Express HTTP API (auto-started by Electron)
3. **Playwright Manager** - Browser connection and session management
4. **Search Engine Layer** - Ordered fallback across Baidu, Bing, 360, Sogou, and Google
5. **Chrome Browser** - Headless browser by default; set `WEB_SEARCH_BROWSER_HEADLESS=0` to show it

## Basic Usage

### Simple Search (Recommended)

**IMPORTANT:** Always use the `$SKILLS_ROOT` environment variable to locate the skill scripts. This ensures the skill works in both development and production environments.

```bash
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "search query" [max_results]
```

On Windows PowerShell, use the dedicated wrapper. It does not require `&&`, does not require changing directories, expands `~` paths inside the Node CLI, sets UTF-8 output, and starts the local Bridge Server when needed:

```powershell
& "$env:SKILLS_ROOT\web-search\scripts\search.ps1" "2026年江苏省中考时间" 5
```

For structured output:

```powershell
& "$env:SKILLS_ROOT\web-search\scripts\search.ps1" --json "世界杯最新消息" 5
```

For Chinese or other non-ASCII queries on Windows, prefer UTF-8 file input/output when the result will be inspected by an agent. `~` is safe here because `search.cjs` expands it itself:

```powershell
Set-Content -Encoding UTF8 ~/web-search-query.txt "世界杯最新消息"
& "$env:SKILLS_ROOT\web-search\scripts\search.ps1" --out ~/web-search-result.md "@~/web-search-query.txt" 5
```

After the command finishes, read `~/web-search-result.md` with the file-reading tool available to the agent. Do not use PowerShell object formatting to inspect Chinese search results.

For JSON:

```powershell
Set-Content -Encoding UTF8 ~/web-search-query.txt "世界杯最新消息"
& "$env:SKILLS_ROOT\web-search\scripts\search.ps1" --json --out ~/web-search-result.json "@~/web-search-query.txt" 5
```

After the command finishes, read `~/web-search-result.json` with the file-reading tool available to the agent.

Use the returned titles, URLs, and snippets directly for a concise answer. Only fetch a result page when the snippets are insufficient for the user's question; do not try more than one follow-up fetch before answering or asking for a narrower source.

For non-ASCII queries (Chinese/Japanese/etc.) with the Bash CLI, prefer UTF-8 file input to avoid shell encoding issues on Windows-like Bash shells:

```bash
cat > /tmp/web-query.txt <<'TXT'
苹果 Siri AI 2026 发布计划
TXT

bash "$SKILLS_ROOT/web-search/scripts/search.sh" @/tmp/web-query.txt 10
```

**Examples:**

```bash
# Search with default 10 results
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "TypeScript 5.0 new features"

# Limit to 5 results
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "React Server Components guide" 5

# Structured JSON output
bash "$SKILLS_ROOT/web-search/scripts/search.sh" --json "React Server Components guide" 5

# Search for recent news
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "AI news January 2026" 10
```

**Output Format:**

The script returns Markdown-formatted results by default, or JSON with `--json`:

```markdown
# Search Results: TypeScript 5.0 new features

**Query:** TypeScript 5.0 new features
**Results:** 5
**Time:** 834ms

---

## TypeScript 5.0 Release Notes

**URL:** [https://www.typescriptlang.org/docs/...]

TypeScript 5.0 introduces decorators, const type parameters...

---

## (More results...)
```

### Workflow Example

```bash
# 1. Search for topic
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Next.js 14 features" 5

# 2. Analyze results and answer user

# 3. Follow-up search if needed
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Next.js Server Actions tutorial" 3
```

## Advanced Usage

### Server Management

The Bridge Server is **automatically managed** by Electron. You typically don't need to start/stop it manually.

However, for manual control:

```bash
# Start server (if not already running)
bash "$SKILLS_ROOT/web-search/scripts/start-server.sh"

# Stop server
bash "$SKILLS_ROOT/web-search/scripts/stop-server.sh"

# Check health (start script will print endpoint status)
bash "$SKILLS_ROOT/web-search/scripts/start-server.sh"
```

### Search Engine Priority

By default, `auto` mode tries Baidu, then Bing, then 360, then Sogou, then Google, and stops as soon as one source returns valid results.

```bash
# Force Baidu only
WEB_SEARCH_ENGINE=baidu bash "$SKILLS_ROOT/web-search/scripts/search.sh" "search query" 5

# Keep fallback but control priority
WEB_SEARCH_FALLBACK_ORDER=baidu,bing,360,sogou,google bash "$SKILLS_ROOT/web-search/scripts/search.sh" "search query" 5
```

`/api/search/content` returns plain text only and truncates `textContent` to
`WEB_SEARCH_CONTENT_MAX_CHARS` characters by default (`8000`).
Search and content responses are cached in Bridge Server process memory only;
the cache is not written to disk and is cleared on server restart.
`WEB_SEARCH_CACHE_TTL_MS` and `WEB_SEARCH_CONTENT_CACHE_TTL_MS` still control
in-process expiration.

### Direct API Calls

For advanced use cases, you can call the HTTP API directly:

```bash
# Perform search
curl -X POST http://127.0.0.1:8923/api/search \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"Playwright tutorial\",
    \"maxResults\": 5
  }"

# Navigate to specific URL
curl -X POST http://127.0.0.1:8923/api/page/navigate \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"url\": \"https://example.com\"
  }"

# Take screenshot
curl -X POST http://127.0.0.1:8923/api/page/screenshot \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"format\": \"png\"
  }"
```

## Best Practices

### 1. Use Specific Queries

❌ Bad: `bash scripts/search.sh "react"`
✅ Good: `bash scripts/search.sh "React 19 new features and breaking changes"`

### 2. Limit Results Appropriately

- Quick lookup: 3-5 results
- Comprehensive research: 10 results
- Don't request more than needed (faster + less noise)

### 3. Check Server Status First

If search fails, verify the server is running:

```bash
bash "$SKILLS_ROOT/web-search/scripts/start-server.sh" || echo "Server not running"
```

### 4. Reuse Connections

The CLI script automatically caches connections. Multiple searches in the same session will reuse the same browser connection for better performance.

### 5. Clean Output

Parse the Markdown output to extract key information for the user. Don't just dump all results - synthesize and summarize.

## Common Patterns

### Pattern 1: Latest Documentation

```bash
# User asks about latest framework features
bash SKILLs/web-search/scripts/search.sh "Next.js 15 documentation" 5

# Parse results, find official docs, summarize features
```

### Pattern 2: Troubleshooting

```bash
# User reports an error
bash SKILLs/web-search/scripts/search.sh "TypeError: Cannot read property of undefined React" 5

# Find Stack Overflow answers and GitHub issues, provide solution
```

### Pattern 3: Current Events

```bash
# User asks about recent news
bash SKILLs/web-search/scripts/search.sh "AI developments January 2026" 10

# Summarize key news items from results
```

### Pattern 4: Comparison Research

```bash
# User wants to compare technologies
bash SKILLs/web-search/scripts/search.sh "Vue 3 vs React 18 performance 2026" 5

# Synthesize comparison from multiple sources
```

### Pattern 5: API/Library Usage

```bash
# User needs specific API documentation
bash SKILLs/web-search/scripts/search.sh "Playwright page.evaluate examples" 5

# Extract code examples and usage patterns
```

## Error Handling

### Server Not Running

**Error:** `✗ Bridge Server is not running`

**Solution:**
- The server should auto-start with Electron
- If manual start needed: `bash SKILLs/web-search/scripts/start-server.sh`
- Check logs: `cat SKILLs/web-search/.server.log`

### Browser Launch Failed

**Error:** `Failed to launch browser`

**Cause:** Chrome not installed or not found

**Solution:**
- macOS: Install from https://www.google.com/chrome/
- Linux: `sudo apt install chromium-browser`
- Windows: Install from https://www.google.com/chrome/

### Windows PowerShell Missing

**Error:** `spawn powershell ENOENT`

**Cause:** A Windows dependency needs `powershell.exe`, but the Bridge Server process cannot find Windows PowerShell in `PATH`. This is an environment issue, not a search API failure.

**Solution:**

```powershell
$env:Path = "$env:SystemRoot\System32\WindowsPowerShell\v1.0;$env:Path"
& "$env:SKILLS_ROOT\web-search\scripts\search.ps1" "test query" 1
```

For CMD:

```bat
set "PATH=%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
node "%SKILLS_ROOT%\web-search\scripts\search.cjs" "test query" 1
```

PowerShell 7 (`pwsh`) alone is not enough for this error because the dependency calls `powershell`.

### Connection Timeout

**Error:** `CDP port not ready` or `Connection timeout`

**Solution:**
```bash
# Stop server
bash SKILLs/web-search/scripts/stop-server.sh

# Clear cache
rm SKILLs/web-search/.connection

# Restart
bash SKILLs/web-search/scripts/start-server.sh
```

### No Search Results

**Error:** `Found 0 results`

**Possible causes:**
- Query too specific or unusual
- Bing changed page structure (rare)
- Network issues

**Solution:**
- Try broader query
- Check internet connection
- Verify page loads manually at bing.com

### Search Timeout

**Error:** `Search failed: timeout`

**Solution:**
- Check internet connection
- Reduce max results
- Try again (might be temporary network issue)

## Understanding Results

### Result Structure

Each search result contains:

```markdown
## [Title of Result]

**URL:** [https://example.com/page]

[Snippet/description from search results]
```

**Fields:**
- **Title** - Page/article title
- **URL** - Direct link (may include Bing tracking)
- **Snippet** - Preview text from the page

### Parsing Results

The search output is Markdown. Extract:
1. Total results count
2. Search duration
3. Individual result titles and URLs
4. Snippets for context

### Result Quality

- **Official docs** - Usually appear in top 3 results
- **Stack Overflow** - Appears for technical questions
- **Recent articles** - Bing prioritizes recent content
- **Chinese content** - Auto mode tries Baidu, Bing, 360, Sogou, then Google by default; override with `WEB_SEARCH_FALLBACK_ORDER` to customize priority

## Performance Considerations

### Typical Latencies

- Server startup: ~2 seconds (one-time, auto-started)
- Browser launch: ~3 seconds (one-time, persists across searches)
- First search: ~2-3 seconds (includes browser connection setup)
- Subsequent searches: ~1 second (browser and connection reused)

### Optimization Tips

1. **Browser persistence** - The headless browser stays alive across searches by default. Connections and pages are reused automatically. Set `WEB_SEARCH_CLEANUP=1` to close the browser after each search if needed.
2. **Limit results** - Request only what you need (5-10 is usually enough)
3. **Batch searches** - If multiple searches needed, do them consecutively to reuse connection
4. **Specific queries** - More specific = faster and better results

## Security and Privacy

### Security Measures

- **Localhost only** - Bridge Server binds to 127.0.0.1 (no external access)
- **No network exposure** - Not accessible from other machines
- **Isolated browser** - Uses separate Chrome profile, won't affect user's main browser
- **Headless operations** - Browser actions run in the background by default; set `WEB_SEARCH_BROWSER_HEADLESS=0` for a visible window
- **No credentials** - Skill never handles passwords or sensitive data

### Privacy Considerations

- Search queries go through the configured search providers depending on fallback order and availability
- Baidu/Bing/360/Sogou/Google may track searches (their standard privacy policies apply)
- No local storage of search history by the skill
- Browser activity is not shown by default; use screenshots or set `WEB_SEARCH_BROWSER_HEADLESS=0` when visual observation is needed

## Limitations

### Current Limitations

1. **No CAPTCHA handling** - If Google or Bing shows CAPTCHA, user must solve manually
2. **Engine availability varies by network/region** - Auto mode falls back between Baidu, Bing, and Google
3. **English/Chinese focus** - Optimized for English and Chinese results
4. **Basic extraction** - Extracts titles and snippets, not full page content
5. **No authentication** - Cannot search pages requiring login

### Not Suitable For

- Searches requiring authentication
- Filling out forms or submitting data
- Actions requiring CAPTCHA solving (unless user manually solves)
- Mass scraping or automated bulk searches
- Accessing pages behind paywalls

## Troubleshooting Guide

### Quick Diagnostics

```bash
# 1. Check server health
curl http://127.0.0.1:8923/api/health

# 2. Check server logs
cat SKILLs/web-search/.server.log | tail -50

# 3. Test basic search
bash SKILLs/web-search/scripts/search.sh "test" 1

# 4. Check Chrome installation
which google-chrome || which chromium || which chromium-browser
```

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| Server down | `Connection refused` | Start server or restart Electron |
| Browser missing | `Chrome not found` | Install Chrome/Chromium |
| Port conflict | `Address already in use` | Stop conflicting process on port 8923 |
| Stale connection | `Connection not found` | Remove `.connection` cache file |
| Network issue | `Search timeout` | Check internet connection |

### Reset Everything

If all else fails, full reset:

```bash
cd SKILLs/web-search

# Stop server
bash scripts/stop-server.sh

# Clean cache and state
rm -f .connection .server.pid .server.log

# Rebuild
npm run build

# Restart
bash scripts/start-server.sh

# Test
bash scripts/search.sh "test" 1
```

## Examples for Claude

### Example 1: User Asks About Latest Framework

**User:** "What are the new features in Next.js 15?"

**Claude's approach:**
```bash
# Search for Next.js 15 features
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Next.js 15 new features" 5
```

**Then:** Parse results, identify official Next.js blog/docs, summarize key features for user.

### Example 2: Troubleshooting Error

**User:** "I'm getting 'Cannot find module' error in TypeScript"

**Claude's approach:**
```bash
# Search for the specific error
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "TypeScript Cannot find module error solution" 5
```

**Then:** Extract solutions from Stack Overflow results, provide step-by-step fix.

### Example 3: Current Events

**User:** "What happened in AI this month?"

**Claude's approach:**
```bash
# Search for recent AI news
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "AI news January 2026" 10
```

**Then:** Synthesize news from multiple sources, provide summary of key events.

### Example 4: Documentation Lookup

**User:** "How do I use React Server Components?"

**Claude's approach:**
```bash
# Search for RSC documentation and tutorials
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "React Server Components guide tutorial" 5
```

**Then:** Find official React docs and good tutorials, explain with examples.

### Example 5: Comparison Research

**User:** "Should I use Vite or webpack in 2026?"

**Claude's approach:**
```bash
# Search for recent comparisons
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Vite vs webpack 2026 comparison" 5
```

**Then:** Analyze multiple perspectives, provide balanced recommendation.

## Tips for Effective Use

1. **Be specific in queries** - Include version numbers, dates, or specific aspects
2. **Parse results carefully** - Don't just copy-paste, synthesize information
3. **Verify with multiple sources** - Cross-check important information
4. **Cite sources** - Tell user which sources you're using
5. **Explain limitations** - If search doesn't find good results, tell user
6. **Use follow-up searches** - One search might not be enough, do multiple if needed
7. **Check result dates** - Prefer recent articles for current info
8. **Look for official sources** - Prioritize official docs and authoritative sources

## Technical Details

### Technologies Used

- **Playwright Core** - Browser automation framework
- **Chrome DevTools Protocol** - Low-level browser control
- **Express.js** - HTTP API server
- **Google + Bing + Baidu + 360 + Sogou Search** - Multi-engine fallback search strategy
- **Bash Scripts** - Simple CLI interface

### System Requirements

- Node.js 18+
- Google Chrome or Chromium installed
- Internet connection for searches
- ~100MB RAM for Bridge Server
- ~200MB RAM for Chrome instance

### File Locations

- Server: `SKILLs/web-search/dist/server/index.js`
- Logs: `SKILLs/web-search/.server.log`
- PID: `SKILLs/web-search/.server.pid`
- Connection cache: `SKILLs/web-search/.connection`

## Additional Resources

- **Full documentation:** `SKILLs/web-search/README.md`
- **Usage examples:** `SKILLs/web-search/examples/basic-search.md`
- **API reference:** See README.md for complete API documentation
- **Troubleshooting:** See examples/basic-search.md

## Support

For issues:
1. Check `.server.log` for errors
2. Run basic test: `node SKILLs/web-search/scripts/test-basic.js`
3. Verify Chrome installation
4. Check internet connection
5. Review troubleshooting section above

---

**Remember:** This skill provides real-time access to current information. Use it whenever users need information beyond your knowledge cutoff or when accuracy of current data is important.
