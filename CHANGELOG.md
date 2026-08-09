# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-09

### Added
- Mermaid diagram rendering — flowchart / pie / gantt / sequence, with zoom + copy toolbar
- KaTeX math formula rendering — inline and block-level equations
- OptMem persistent memory system — lazy-loading, auto-compress, cross-session recall
- Research report generation — 7-stage methodology, PDF / Markdown export with cover, TOC, scoring matrix
- Multi-engine search aggregation — local engines (360 / Bing / Baidu) + external sources (Tavily / Serper.dev / SearXNG) queried in parallel
- Relevance scorer — 0-100 scoring with dictionary / encyclopedia auto-downgrade
- Random User-Agent rotation for all web-search requests
- Token consumption statistics — three metrics (context usage / cumulative output / actual billing), persisted per session
- Text selection and copy within messages
- Single message deletion
- Memory entry deletion — individual or batch, with visual management in settings
- Standalone settings page with expanded configuration surface
- Agent timeout configuration exposed in settings (first-byte timeout + idle timeout)
- Credits auto-refresh on settings page
- Persistent "view info" bar at the bottom of active sessions

### Changed
- Fully de-branded — project renamed, all code / prompts / skills / comments sanitized of third-party brand names
- Markdown rendering refinements — line spacing, h4-h6 heading support, Apple-style chart rendering
- Strengthened Agent prompt to proactively suggest chart-based visualizations
- Search engine optimization — parallel local + external queries with dedup and relevance ranking
- Agent graceful degradation on LLM timeout — resolves with partial results instead of crashing
- Timeout presets — 90s for standard tasks, 300s for research-heavy tasks, 60s stream-idle
- Default web-search service port updated to avoid conflicts

### Fixed
- Streaming response UTF-8 multi-byte character corruption at chunk boundaries (CJK garbled text)
- Mermaid dynamic loading — no longer blocks renderer init or jsdom test harness
- Auto-detection of bare Mermaid syntax (without code fence)
- Scroll-nav and message-rail positioning issues
- Report generation timeout edge cases
- Various stability improvements and bug fixes

### Security
- Markdown XSS sanitization — body text escaping + link protocol whitelist
- Mermaid `securityLevel: strict` enforced
- `openExternal` restricted to `http(s)` whitelist
- `openPath` replaces `openExternal` for `file://` access
- Export / import skill path-traversal defense
- Session race-condition guard with version numbers
- SSE `\r\n` compatibility hardening
- 120s streaming timeout cap

## [0.0.4] - 2026-08-07

### Added
- QR code login — generate + poll workflow, auto-refresh expired codes
- GeeTest4 captcha integration for SMS verification
- Remaining credits display as inline banner after login
- App icon — minimalist owl (wisdom + search symbol), Apple design principles

### Changed
- Removed assistant avatar from message list for cleaner UI
- Dynamic model dropdown update when adding custom models

### Fixed
- App icon visibility in macOS dev mode (Dock + taskbar via `app.dock.setIcon()`)
- Request timeout + Accept header for data source API calls
- CSP meta tag + GeeTest4 `showBox()` trigger for SMS captcha
- Packed skill loading — bundled skills now resolve correctly in production builds
- QR code auto-refresh timing to match server poll cadence

## [0.0.3] - 2026-08-07

### Changed
- Strengthened legal disclaimer, de-branded README, cleaned API-detail comments

### Fixed
- Added author email + Linux deb maintainer / desktopName for packaging

## [0.0.2] - 2026-08-07

### Added
- Apple Design System UI — SF Pro typography, Action Blue (#0066CC), frosted glass panels
- 5-layer Prompt Pipeline with conditional injection
- 6 preset AI agents with configurable triggers
- Agent Loop with 5 built-in tools + 3 enterprise data source tools
- Multi-session support with parallel `sessionStates` Map
- Session history with OpenAI-style date grouping (今天 / 昨天 / 本周 / 本月 / 更早)
- Full-text session search with snippet preview
- Custom model configuration (OpenAI-compatible API)
- File attachment upload with image thumbnail preview
- `@company` mention with search-and-reference modal
- Image lightbox with zoom (wheel / button / keyboard), pan, frosted glass overlay
- Web search skill (Playwright + Crawlee) with multi-engine fallback
- Skill system with dynamic MCP registration
- Debug console with log export
- Right-side message rail for quick navigation to user messages
- Floating scroll-to-top / scroll-to-bottom buttons

### Security
- Token-based authentication — refresh token is never consumed
- Skill security lint on import

## [0.0.1] - 2026-07-31

### Added
- Initial public release
- Core chat interface with streaming responses
- Enterprise search via data source API
- Document export (DOCX / XLSX / PPTX / PDF)
