---
name: browser-use
description: 面向通用网页交互的无头浏览器自动化技能。当任务需要打开网页、提取文本快照、点击链接或按钮、填写表单、选择选项、按键或截图，且不需要展示浏览器窗口时使用。不要用于简单搜索发现；搜索结果优先使用 web-search，用户提供具体 URL 时优先使用 web_fetch。
official: true
version: 1.0.0
---

# Browser Use Skill

Use this skill for interactive web pages that need browser behavior in the background. The browser runs headless by default and returns text-first snapshots with stable element refs.

## Basic Usage

Always locate scripts through `$SKILLS_ROOT`:

```bash
export BROWSER_USE="$SKILLS_ROOT/browser-use/scripts/browser.sh"
```

Open a page and get a snapshot:

```bash
bash "$BROWSER_USE" navigate "https://example.com"
```

Refresh the current snapshot:

```bash
bash "$BROWSER_USE" snapshot
```

Click or fill by refs from the latest snapshot:

```bash
bash "$BROWSER_USE" click e2
bash "$BROWSER_USE" fill e1 "search terms"
bash "$BROWSER_USE" fill e1 "search terms" --enter
bash "$BROWSER_USE" select e3 "Option label"
bash "$BROWSER_USE" press Enter
```

Capture page output:

```bash
bash "$BROWSER_USE" text
bash "$BROWSER_USE" screenshot /tmp/page.png --full-page
```

Close the headless browser:

```bash
bash "$BROWSER_USE" close
```

## Workflow

1. `navigate` to the page.
2. Read the `Interactive elements` list in the snapshot.
3. Use refs such as `e1`, `e2`, `e3` for `click`, `fill`, or `select`.
4. Re-run `snapshot` after navigation or dynamic UI changes.

Refs are refreshed by each snapshot. If a ref stops working, run `snapshot` again and use the new ref.

## Environment

- `BROWSER_USE_SERVER`: bridge endpoint, default `http://127.0.0.1:8933`
- `BROWSER_USE_CDP_PORT`: Chrome CDP port, default `9223`
- `BROWSER_USE_MAX_TEXT`: inline snapshot text limit, default `10000`
- `WEB_SEARCH_BROWSER_HEADLESS`: stays `1` by default for this skill

## Boundaries

This skill is for browser interaction, not search ranking. For search discovery, use the `web-search` skill. For a known URL that does not need JavaScript, use `web_fetch`.
