#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const serverUrl = (process.env.BROWSER_USE_SERVER || 'http://127.0.0.1:8933').replace(/\/+$/, '');
const connectionFile = process.env.BROWSER_USE_CONNECTION_FILE
  || path.join(__dirname, '..', '.connection');
const maxInlineText = Number.parseInt(process.env.BROWSER_USE_MAX_TEXT || '10000', 10);

function usage() {
  console.log(`Usage: browser.sh <command> [args]

Commands:
  navigate <url>              Open URL and print a snapshot
  snapshot                    Print the current page snapshot
  click <ref>                 Click an element ref from snapshot
  fill <ref> <text> [--enter] Fill an element ref
  select <ref> <option>       Select option by label/value
  press <key>                 Press a keyboard key, e.g. Enter
  text                        Print current page text
  html                        Print current page HTML
  screenshot [path] [--full-page]
                              Save a screenshot
  close                       Close browser and clear connection
`);
}

async function request(method, pathname, body) {
  const response = await fetch(`${serverUrl}${pathname}`, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  const raw = await response.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
  if (!response.ok || parsed.success === false) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  return parsed.data || {};
}

async function post(pathname, body) {
  return await request('POST', pathname, body);
}

function readCachedConnection() {
  try {
    return fs.readFileSync(connectionFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function writeCachedConnection(connectionId) {
  fs.mkdirSync(path.dirname(connectionFile), { recursive: true });
  fs.writeFileSync(connectionFile, `${connectionId}\n`);
}

function clearCachedConnection() {
  try {
    fs.unlinkSync(connectionFile);
  } catch {
    // Already absent.
  }
}

async function connect() {
  const data = await post('/api/browser/connect', {});
  writeCachedConnection(data.connectionId);
  return data.connectionId;
}

function isConnectionError(error) {
  return /Connection (not found|not active|became invalid)/i.test(error.message);
}

async function withConnection(action) {
  let connectionId = readCachedConnection();
  if (!connectionId) {
    connectionId = await connect();
  }

  try {
    return await action(connectionId);
  } catch (error) {
    if (!isConnectionError(error)) {
      throw error;
    }
    clearCachedConnection();
    connectionId = await connect();
    return await action(connectionId);
  }
}

function writeOverflowFile(kind, content) {
  const dir = path.join(os.tmpdir(), 'qcc-browser-use');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}-${Date.now()}.txt`);
  fs.writeFileSync(file, content);
  return file;
}

function formatSnapshot(snapshot) {
  const text = snapshot.text || '';
  const shouldTruncate = text.length > maxInlineText;
  const overflowPath = shouldTruncate ? writeOverflowFile('page-text', text) : null;
  const visibleText = shouldTruncate ? text.slice(0, maxInlineText) : text;
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];

  const lines = [
    '[snapshot]',
    '---',
    `Title: ${snapshot.title || ''}`,
    `URL:   ${snapshot.url || ''}`,
    '---',
    'Interactive elements (ref[:]info):'
  ];

  if (elements.length === 0) {
    lines.push('(none)');
  } else {
    for (const element of elements) {
      lines.push(`${element.ref}[:] ${element.description}`);
    }
  }

  lines.push('---', 'Page Text:', visibleText || '(empty)');
  if (overflowPath) {
    lines.push('', `[truncated; full page text saved to ${overflowPath}]`);
  }

  return lines.join('\n');
}

async function printSnapshot(connectionId) {
  const snapshot = await post('/api/page/snapshot', { connectionId, maxElements: 100 });
  console.log(formatSnapshot(snapshot));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'close') {
    await post('/api/browser/close', {});
    clearCachedConnection();
    console.log('[browser-use] closed');
    return;
  }

  await withConnection(async (connectionId) => {
    if (command === 'navigate') {
      const url = args[0];
      if (!url) {
        throw new Error('navigate requires a URL');
      }
      await post('/api/page/navigate', { connectionId, url, waitUntil: 'domcontentloaded' });
      await printSnapshot(connectionId);
      return;
    }

    if (command === 'snapshot') {
      await printSnapshot(connectionId);
      return;
    }

    if (command === 'click') {
      const ref = args[0];
      if (!ref) {
        throw new Error('click requires an element ref');
      }
      await post('/api/page/click', { connectionId, ref });
      await new Promise(resolve => setTimeout(resolve, 500));
      await printSnapshot(connectionId);
      return;
    }

    if (command === 'fill') {
      const ref = args[0];
      const pressEnter = args.includes('--enter');
      const text = args.slice(1).filter(item => item !== '--enter').join(' ');
      if (!ref || !text) {
        throw new Error('fill requires an element ref and text');
      }
      await post('/api/page/fill', { connectionId, ref, text, pressEnter });
      await new Promise(resolve => setTimeout(resolve, pressEnter ? 1000 : 300));
      await printSnapshot(connectionId);
      return;
    }

    if (command === 'select') {
      const ref = args[0];
      const option = args.slice(1).join(' ');
      if (!ref || !option) {
        throw new Error('select requires an element ref and option');
      }
      await post('/api/page/select', { connectionId, ref, label: option, value: option });
      await printSnapshot(connectionId);
      return;
    }

    if (command === 'press') {
      const key = args[0];
      if (!key) {
        throw new Error('press requires a key');
      }
      await post('/api/page/press', { connectionId, key });
      await new Promise(resolve => setTimeout(resolve, 500));
      await printSnapshot(connectionId);
      return;
    }

    if (command === 'text') {
      const data = await post('/api/page/text', { connectionId });
      const text = data.text || '';
      if (text.length > maxInlineText) {
        const file = writeOverflowFile('page-text', text);
        console.log(text.slice(0, maxInlineText));
        console.log(`\n[truncated; full page text saved to ${file}]`);
        return;
      }
      console.log(text);
      return;
    }

    if (command === 'html') {
      const data = await post('/api/page/content', { connectionId });
      const content = data.content || '';
      if (content.length > maxInlineText) {
        const file = writeOverflowFile('page-html', content);
        console.log(content.slice(0, maxInlineText));
        console.log(`\n[truncated; full page HTML saved to ${file}]`);
        return;
      }
      console.log(content);
      return;
    }

    if (command === 'screenshot') {
      const fullPage = args.includes('--full-page');
      const requestedPath = args.find(item => item !== '--full-page');
      const output = requestedPath
        ? path.resolve(process.cwd(), requestedPath)
        : path.join(os.tmpdir(), 'qcc-browser-use', `screenshot-${Date.now()}.png`);
      const data = await post('/api/page/screenshot', {
        connectionId,
        format: 'png',
        fullPage
      });
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, Buffer.from(data.screenshot, 'base64'));
      console.log(`[screenshot] saved to ${output}`);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  });
}

main().catch((error) => {
  console.error(`[browser-use] ${error.message}`);
  process.exit(1);
});
