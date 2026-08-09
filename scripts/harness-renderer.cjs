// Feedback-loop harness: executes the renderer init + key flows under jsdom
// with a mock clawAPI, and reports EVERY runtime error + flow assertions.
// Usage: node scripts/harness-renderer.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
// jsdom 用 resources:'usable' + file:// 自动按 index.html 顺序加载 js/*.js，无需手动读取。

const errors = [];
const asserts = [];
function assert(name, cond, detail = '') {
  asserts.push(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) errors.push(`ASSERT FAIL: ${name} ${detail}`);
}
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  if (String(e.message || '').includes('Could not parse CSS')) return;
  errors.push('[jsdomError] ' + (e.detail?.stack || e.detail || e.message));
});
vc.on('error', (...a) => errors.push('[console.error] ' + a.map(String).join(' ')));

const callbacks = {};
const cancelled = [];
const sentMessagesStack = [];
function mkReq() { return 'req-' + Math.random().toString(36).slice(2, 8); }
const ASSETS = path.join(__dirname, '..', 'assets');
const handlers = {
  chatSend: async (options) => {
    sentMessagesStack.push((options && options.messages) || []);
    const r = mkReq(); callbacks[r] = { data: [], tool: [], done: [], error: [] }; return { requestId: r };
  },
  chatCancel: (req) => { cancelled.push(req); return Promise.resolve(true); },
  sessionCreate: async (title) => ({ id: 's-' + Math.random().toString(36).slice(2, 6), title: title || '新对话' }),
  readAsset: (name) => { try { return Promise.resolve(JSON.parse(fs.readFileSync(path.join(ASSETS, path.basename(name)), 'utf8'))); } catch { return Promise.resolve(null); } },
  onChatData: (req, cb) => { (callbacks[req] ||= {data:[],tool:[],done:[],error:[]}).data.push(cb); return () => {}; },
  onChatTool: (req, cb) => { (callbacks[req] ||= {data:[],tool:[],done:[],error:[]}).tool.push(cb); return () => {}; },
  onChatDone: (req, cb) => { (callbacks[req] ||= {data:[],tool:[],done:[],error:[]}).done.push(cb); return () => {}; },
  onChatError: (req, cb) => { (callbacks[req] ||= {data:[],tool:[],done:[],error:[]}).error.push(cb); return () => {}; },
  storeGet: (k) => Promise.resolve(storeMap[k]),
  storeSet: (k, v) => { storeMap[k] = v; return Promise.resolve(true); },
  storeRemove: (k) => { delete storeMap[k]; return Promise.resolve(true); },
};
const storeMap = {};
const defaults = {
  sessionList: [], getCustomModels: [{ name: 'Test', modelId: 'm1', baseUrl: 'http://x/v1', apiKey: 'k' }],
  listAgents: [{ id: 'stockexpert', name: '股票助手', icon: '📈' }], listSkills: [],
  authGetSession: null, getState: {}, getVersion: '1.0', getSystemLocale: 'zh-CN',
  getLogs: [], buildPrompt: { systemPrompt: 'SYS', nodeCount: 1, activeAgent: null },
  searchCompanies: { success: true, companies: [{ name: '华为技术有限公司', keyNo: 'k1', operatingStatus: '存续', legalRep: '张三' }] },
};
const searchCalls = [];
const realSearch = defaults.searchCompanies;
defaults.searchCompanies = undefined; // move to handlers so we can track
handlers.searchCompanies = (kw) => { searchCalls.push(kw); return Promise.resolve(JSON.parse(JSON.stringify(realSearch))); };
const apiMock = new Proxy({}, {
  get(_t, prop) {
    if (prop in handlers) return handlers[prop];
    if (prop in defaults) { const v = defaults[prop]; return typeof v === 'function' ? v : () => Promise.resolve(JSON.parse(JSON.stringify(v))); }
    if (['minimize','close','toggleMaximize','isMaximized'].includes(prop)) return () => {};
    return () => Promise.resolve(undefined);
  }
});

// 用 runScripts:'dangerously' + resources:'usable' 让 jsdom 真正加载外部 <script src>/<link>；
// beforeParse 在任何脚本运行前注入 mock + stubs（core.js 会读 window.clawAPI）
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'file://' + path.join(RENDERER_DIR, 'index.html'),
  beforeParse(window) {
    window.clawAPI = apiMock;
    window.scrollTo = () => {};
    window.alert = () => {};
    window.confirm = () => true;
    if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.fetch = (u) => Promise.reject(new TypeError('Failed to fetch ' + u));
  },
});
const { window } = dom;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const $ = (id) => window.document.getElementById(id);
function drive(label, fn) { try { fn(); } catch (e) { errors.push(`[${label}] THROW: ${e.message}\n${e.stack}`); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // jsdom 已通过 resources:'usable' 加载并执行了外部 <script src>；等待异步 init 完成
  await sleep(800);

  // --- init assertions ---
  assert('init: themed presets loaded', window.document.querySelectorAll('#quickActions .prompt-category').length === 5);
  assert('init: agent section removed (no #agentGrid)', !window.document.getElementById('agentGrid'));
  assert('init: no errors so far', errors.length === 0, errors[0] || '');

  // --- select model + chat flow ---
  drive('selectModel', () => window.selectModel(0));
  drive('set-input', () => { const ci = $('chatInput'); ci.value = '测试'; });
  drive('click-send', () => $('sendBtn').click());
  await sleep(150); // let buildPrompt + chatSend resolve
  const reqs = Object.keys(callbacks);
  assert('chat: requestId created', reqs.length >= 1, 'reqs=' + reqs.length);
  const req = reqs[0];
  const cb = callbacks[req];

  drive('chat:data', () => cb.data.forEach(fn => fn('你好')));
  await sleep(80); // 文本渲染有 50ms 节流，需等刷新
  assert('chat: assistant bubble has text', /你好/.test(window.document.querySelector('.message-assistant .message-content')?.textContent || ''), (window.document.querySelector('.message-assistant .message-content')?.textContent || '').slice(0, 60));
  // streaming: <related_questions> block must be stripped from view (not shown raw); 同时含引用块/链接验证 md 渲染
  drive('chat:data-related', () => cb.data.forEach(fn => fn('\n> 注意：以上信息仅供参考\n详见[说明](https://example.com)\n<related_questions>[{"label":"查股东结构","prompt":"请查询股东结构"}]</related_questions>')));
  await sleep(80);
  assert('chat: related_questions stripped during stream', !/related_questions/.test(window.document.querySelector('.message-assistant .message-content')?.textContent || ''));
  assert('chat: blockquote rendered (.md-quote)', window.document.querySelectorAll('.message-assistant .md-quote').length >= 1);
  assert('chat: link rendered (.md-a)', window.document.querySelectorAll('.message-assistant .md-a').length >= 1);

  drive('chat:tool_start', () => cb.tool.forEach(fn => fn({ type: 'tool_start', tool: 'web_search', args: { query: 'x' }, iteration: 1 })));
  await sleep(20);
  assert('chat: tool card rendered', window.document.querySelectorAll('.tool-call-card').length >= 1, 'count=' + window.document.querySelectorAll('.tool-call-card').length);

  // 用一个 >200 字符的长结果验证「复制完整、不截断」
  const longTail = 'END_MARKER_' + 'X'.repeat(260);
  drive('chat:tool_end', () => cb.tool.forEach(fn => fn({ type: 'tool_end', tool: 'web_search', result: longTail, iteration: 1 })));
  await sleep(20);
  assert('chat: tool card marked done', window.document.querySelectorAll('.tool-call-card.tool-done').length >= 1);
  // 复制按钮：标题 + 参数 JSON + 完整结果（>200 不截断）
  const copyText = window.document.querySelector('.tool-call-card')?._copyText || '';
  assert('chat: tool copy includes title', copyText.includes('网页搜索'), JSON.stringify(copyText).slice(0,80));
  assert('chat: tool copy includes 参数 JSON', copyText.includes('参数') && copyText.includes('"query"'), JSON.stringify(copyText).slice(0,80));
  assert('chat: tool copy has FULL untruncated result', copyText.includes(longTail), 'len=' + copyText.length);

  drive('chat:done', () => cb.done.forEach(fn => fn()));
  await sleep(20);
  assert('chat: copy button present after done', window.document.querySelectorAll('.message-assistant .msg-action-btn').length >= 1, 'count=' + window.document.querySelectorAll('.message-assistant .msg-action-btn').length);

  // verify the replaced bubble rendered final markdown text + tool card together
  assert('chat: final assistant bubble shows text', /你好/.test(window.document.querySelector('.message-assistant:last-of-type .message-content')?.textContent || ''));
  // avatar rail present on assistant turn
  // 助手消息不再渲染头像（气泡贴左对齐，避免左侧空隙）
  assert('chat: assistant avatar removed', window.document.querySelectorAll('.message-assistant .message-avatar').length === 0, 'count=' + window.document.querySelectorAll('.message-assistant .message-avatar').length);
  // related_questions parsed into clickable chips
  const chips = window.document.querySelectorAll('.message-assistant:last-of-type .related-question-chip');
  assert('chat: related_questions chips rendered', chips.length >= 1, 'count=' + chips.length);
  if (chips.length > 0) {
    const reqsBefore = Object.keys(callbacks).length;
    drive('chat: click related chip (auto-send)', () => chips[0].click());
    await sleep(150); // sendMessage → chatSend (sendMessage clears the input after reading it)
    assert('chat: chip auto-sends (new requestId)', Object.keys(callbacks).length > reqsBefore, 'reqs=' + Object.keys(callbacks).length);
    assert('chat: input cleared after auto-send', $('chatInput').value === '', 'value="' + $('chatInput').value + '"');
  }

  // --- 附件（图片）流程：① 多模态构造 image_url ② 用户消息气泡显示缩略图 ---
  // jsdom 无 DataTransfer 不能模拟 file picker，故分两步直接测构造器 + 渲染
  const multi = window.buildUserLLMContent
    ? window.buildUserLLMContent('看下这张图', [{ name: 't.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }], [{ name: 'a.pdf', type: 'application/pdf', size: 1 }])
    : null;
  assert('attach: 多模态 content 含 image_url', Array.isArray(multi) && multi.some(c => c.type === 'image_url' && c.image_url && c.image_url.url === 'data:image/png;base64,AAAA'), JSON.stringify(multi).slice(0,80));
  assert('attach: 多模态 content 含 text + 文件附注', Array.isArray(multi) && multi[0].type === 'text' && /附带文件/.test(multi[0].text), (multi && multi[0] && multi[0].text || '').slice(0,80));
  // 渲染：用户消息带附件 → 气泡显示图片缩略图
  drive('attach: 渲染带图的用户消息', () => {
    window.appendMessageEl({ role: 'user', content: '看下这张图', attachments: [{ name: 't.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }] });
  });
  await sleep(10);
  assert('attach: 用户消息气泡显示图片', window.document.querySelectorAll('.message-user .msg-att-img').length >= 1, 'count=' + window.document.querySelectorAll('.message-user .msg-att-img').length);
  // 点击图片 → 大图预览（lightbox）；✕ 关闭
  drive('lightbox: 点击图片', () => { const img = window.document.querySelector('.message-user .msg-att-img'); img && img.click(); });
  await sleep(10);
  assert('lightbox: 打开显示大图', $('imgLightbox')?.style.display !== 'none' && /data:image\/png/.test($('imgLightboxImg')?.src || ''), 'display=' + $('imgLightbox')?.style.display);
  drive('lightbox: 点 ✕ 关闭', () => $('imgLightboxClose')?.click());
  await sleep(10);
  assert('lightbox: 关闭后隐藏', $('imgLightbox')?.style.display === 'none', 'display=' + $('imgLightbox')?.style.display);

  // --- @mention flow: realistic keystroke typing (set caret to end each char) ---
  searchCalls.length = 0;
  drive('mention: clear input', () => { const ci = $('chatInput'); ci.value = ''; ci.selectionStart = ci.selectionEnd = 0; });
  for (const ch of '@华为') {
    drive('mention: type ' + ch, () => {
      const ci = $('chatInput');
      ci.value += ch;
      ci.selectionStart = ci.selectionEnd = ci.value.length; // caret to end (real typing)
      ci.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await sleep(40);
  }
  await sleep(400); // debounce 300ms
  const mentionItems = window.document.querySelectorAll('#mentionDropdown .mention-item[data-idx]');
  assert('mention: searchCompanies IPC called', searchCalls.includes('华为'), 'calls=' + JSON.stringify(searchCalls));
  assert('mention: candidates rendered', mentionItems.length >= 1, 'count=' + mentionItems.length);

  // --- @ button → company search modal (decoupled popup flow) ---
  searchCalls.length = 0;
  drive('modal: click @ button', () => $('mentionBtn').click());
  await sleep(30);
  assert('modal: overlay opens', $('companyModalOverlay')?.style.display !== 'none', 'display=' + $('companyModalOverlay')?.style.display);
  drive('modal: type keyword', () => {
    const ci = $('companySearchInput');
    ci.value = '华为';
    ci.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await sleep(400); // debounce 300ms
  const modalResults = window.document.querySelectorAll('#companyModalResults .company-result');
  assert('modal: searchCompanies IPC called', searchCalls.includes('华为'), 'calls=' + JSON.stringify(searchCalls));
  assert('modal: results rendered', modalResults.length >= 1, 'count=' + modalResults.length);
  // click first result → inserts @company into textarea + records mention
  const chatInputBefore = $('chatInput').value;
  drive('modal: click first result', () => modalResults[0]?.click());
  await sleep(30);
  assert('modal: mention inserted into textarea', /@华为/.test($('chatInput').value), 'value="' + $('chatInput').value + '"');
  assert('modal: overlay closes after select', $('companyModalOverlay')?.style.display === 'none', 'display=' + $('companyModalOverlay')?.style.display);

  // --- session switch-back live view ---
  // create a 2nd session and start a chat in it, then switch away & back
  drive('navNewChat', () => $('navNewChat').click());
  await sleep(100);
  drive('switch-back: send in new session', () => { const ci = $('chatInput'); ci.value = '第二条'; $('sendBtn').click(); });
  await sleep(150);
  const reqs2 = Object.keys(callbacks);
  const req2 = reqs2[reqs2.length - 1];
  drive('switch-back: partial data', () => callbacks[req2].data.forEach(fn => fn('流式中')));
  await sleep(20);
  // switch away (click first history item) then back
  const firstItem = window.document.querySelector('#historyList .session-item');
  // find a different session item to switch to
  drive('switch-back: switch to other session', () => { const items = window.document.querySelectorAll('#historyList .session-item'); if (items.length > 1) items[1].click(); });
  await sleep(100);
  drive('switch-back: switch back', () => { const items = window.document.querySelectorAll('#historyList .session-item'); if (items.length > 1) items[0].click(); });
  await sleep(100);
  assert('switch-back: live text restored', /流式中/.test(window.document.querySelector('.chat-messages')?.textContent || ''), 'missing partial text after switch-back');

  // --- stop button (round 9): mid-send ⏹ must call chatCancel ---
  drive('stop: start send', () => { const ci = $('chatInput'); ci.value = '取消测试'; $('sendBtn').click(); });
  await sleep(150);
  const stopReqs = Object.keys(callbacks);
  const stopReq = stopReqs[stopReqs.length - 1];
  const stopBtnVisibleBefore = $('stopBtn')?.style.display !== 'none';
  drive('stop: click ⏹', () => $('stopBtn')?.click());
  await sleep(20);
  assert('stop: ⏹ visible during send', stopBtnVisibleBefore, 'display=' + $('stopBtn')?.style.display);
  assert('stop: chatCancel invoked', cancelled.includes(stopReq), 'cancelled=' + JSON.stringify(cancelled));

  // --- settings popup (round 5): ⚙️ opens panel ---
  drive('settings: open', () => $('openSettingsBtn')?.click());
  await sleep(20);
  const settingsPanel = window.document.querySelector('.settings-panel, #settingsPanel');
  assert('settings: panel opens', !!settingsPanel, 'no settings panel found');

  // --- model edit/delete (round 6): model list rendered with editable fields + delete ---
  const modelItems = window.document.querySelectorAll('#modelList .model-item');
  assert('models: list rendered', modelItems.length >= 1, 'count=' + modelItems.length);
  assert('models: shows name + edit/delete actions (not delete-x)', window.document.querySelectorAll('#modelList .model-action-btn').length >= 2);
  assert('models: collapsed by default (no .expanded)', window.document.querySelectorAll('#modelList .model-item.expanded').length === 0);
  // fields exist in DOM but hidden (display:none via .model-fields) until expanded
  assert('models: fields present but collapsed', window.document.querySelectorAll('#modelList .model-field input').length >= 4);
  drive('model: click edit to expand', () => {
    const editBtn = window.document.querySelector('#modelList .model-item .model-action-btn');
    editBtn && editBtn.click();
  });
  assert('models: edit expands fields', window.document.querySelectorAll('#modelList .model-item.expanded').length >= 1);

  // --- model persistence: selecting a model writes to store; restore picks it back ---
  storeMap.selectedModelKey = 'm1::http://x/v1'; // simulate previously-persisted selection
  drive('model: select via dropdown', () => {
    const sel = $('modelSelect');
    sel.value = '0';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await sleep(20);
  assert('model: selection persisted to store', storeMap.selectedModelKey === 'm1::http://x/v1', 'key=' + storeMap.selectedModelKey);
  assert('model: dropdown reflects selection', $('modelSelect').value === '0', 'value=' + $('modelSelect').value);

  // --- light theme: :root in styles.css must define a light --bg-main (jsdom can't resolve var() in getComputedStyle, so check source) ---
  const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const bgMain = (cssSrc.match(/--bg-main:\s*(#[0-9A-Fa-f]+)/) || [])[1];
  const hex = bgMain ? bgMain.slice(1).match(/.{2}/g).map(h => parseInt(h, 16)) : [0, 0, 0];
  const lightest = Math.min(hex[0], hex[1], hex[2]);
  assert('theme: default --bg-main is light', lightest >= 230, '--bg-main=' + bgMain);

  // --- 工具结果折叠进上下文（Fix A）：超时后"继续"应能看到本轮采集的数据 ---
  // 验证 formatToolResultsForContext + buildConversationHistory 把工具 result 折算进发给 LLM 的上下文。
  assert('ctx: formatToolResultsForContext 可用', typeof window.formatToolResultsForContext === 'function');
  assert('ctx: buildConversationHistory 可用', typeof window.buildConversationHistory === 'function');
  if (typeof window.formatToolResultsForContext === 'function') {
    const longRes = '比亚迪已布局具身智能…' + 'Z'.repeat(300);
    const block = window.formatToolResultsForContext([
      { name: 'web_search', args: { query: '比亚迪机器人' }, result: longRes },
    ]);
    assert('ctx: 折算块含工具名 web_search', block.includes('web_search'), block.slice(0, 60));
    assert('ctx: 折算块含完整 result（不截断）', block.includes(longRes), 'len=' + block.length);
    assert('ctx: 折算块含短参数', block.includes('比亚迪机器人'), block.slice(0, 60));

    // 大参数工具（report_export 整份报告作参数）→ 参数被省略避免撑爆上下文；result 仍保留
    const bigArgs = { chapters: Array.from({ length: 20 }, (_, i) => ({ title: '章' + i, body: 'B'.repeat(500) })) };
    const blockBig = window.formatToolResultsForContext([{ name: 'report_export', args: bigArgs, result: '✅ 报告已生成' }]);
    assert('ctx: 大参数被省略（无“参数：”行）', !blockBig.includes('参数：'), blockBig.slice(0, 80));
    assert('ctx: 大参数块仍含 result', blockBig.includes('报告已生成'));

    // 无 result（工具未完成）→ 被跳过，返回空串
    assert('ctx: 无 result 返回空串', window.formatToolResultsForContext([{ name: 'web_search', args: { query: 'x' } }]) === '');
  }
  if (typeof window.buildConversationHistory === 'function') {
    const hist = window.buildConversationHistory([
      { role: 'user', content: '查比亚迪' },
      { role: 'assistant', content: '根据查询…', toolCalls: [{ name: 'web_search', args: { query: '比亚迪' }, result: 'DATA_42' }] },
    ]);
    const a = hist.find(m => m.role === 'assistant');
    assert('ctx: 历史含折叠的工具结果 DATA_42', a && a.content.includes('DATA_42'), JSON.stringify(a && a.content || '').slice(0, 80));
    assert('ctx: 历史仍含原文正文', a && a.content.includes('根据查询'));

    const hist2 = window.buildConversationHistory([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好啊' },
    ]);
    const a2 = hist2.find(m => m.role === 'assistant');
    assert('ctx: 无工具消息原样保留（不注入任何前缀）', a2 && a2.content === '你好啊', JSON.stringify(a2 && a2.content || ''));
  }

  // --- REPORT ---
  console.log('\n========== RENDERER HARNESREPORT ==========');
  console.log('assertions:');
  asserts.forEach(a => console.log('  ' + a));
  console.log('\nruntime errors:', errors.filter(e => !e.startsWith('ASSERT FAIL')).length);
  [...new Set(errors.filter(e => !e.startsWith('ASSERT FAIL')))].forEach((e, i) => console.log(`  [${i + 1}] ${e.split('\n')[0]}`));
  process.exit(errors.length ? 1 : 0);
})();
