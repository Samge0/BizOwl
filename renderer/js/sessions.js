// sessions.js — renderer module (split from index.html)

      // 会话搜索：输入 → 防抖 → 调后端全文搜索 → 渲染结果
      let sessionSearchTimer = null;
      function closeSessionSearch() {
        if (dom.sessionSearchBox) dom.sessionSearchBox.style.display = 'none';
        dom.navSearch?.classList.remove('active');
        if (dom.sessionSearchInput) dom.sessionSearchInput.value = '';
        state.searchQuery = '';
        state.searchResults = null;
        renderSessionList();
      }

      // ─────────────────────────────────────────────
      // 消息存储（客户端管理，通过 store KV 持久化）
      // 由于后端 session:getMessages 读取 jsonl 文件，但 appendMessage 未通过 IPC 暴露，
      // 我们使用 store:get/set 以 msgs_<sessionId> 为 key 持久化消息列表。
      // ─────────────────────────────────────────────
      // saveMessage 的串行化锁：同一会话的并发 saveMessage 必须排队执行，
      // 否则 read-modify-write 竞态会导致后写入的覆盖先写入的（如 artifact 被 assistant 覆盖）。
      const _saveMessageLocks = new Map(); // sessionId → Promise chain
      async function saveMessage(sessionId, message) {
        if (!sessionId) return;
        // 串行化：等待该会话上一次 saveMessage 完成
        const prev = _saveMessageLocks.get(sessionId) || Promise.resolve();
        const curr = prev.then(() => _doSaveMessage(sessionId, message)).catch(() => {});
        _saveMessageLocks.set(sessionId, curr);
        // 完成后清理：如果当前 Promise 仍是链尾则删除，防止 Map 无限增长
        curr.finally(() => {
          if (_saveMessageLocks.get(sessionId) === curr) {
            _saveMessageLocks.delete(sessionId);
          }
        });
        return curr;
      }

      async function _doSaveMessage(sessionId, message) {
        const key = `msgs_${sessionId}`;
        try {
          const entry = {
            id: message.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
            role: message.role,
            content: message.content,
            timestamp: message.timestamp || new Date().toISOString(),
          };
          if (message.toolCalls) entry.toolCalls = message.toolCalls;
          if (message.toolResults) entry.toolResults = message.toolResults;
          if (message.attachments) entry.attachments = message.attachments;
          if (message.fileAttachments) entry.fileAttachments = message.fileAttachments;
          // 产物消息（研究报告 PDF / 导出文件卡片）— 必须保留 artifact 对象，否则重载后卡片丢失
          if (message.artifact) entry.artifact = message.artifact;

          // 方案1：store 内存持久化（切换会话时读取）
          let existing = [];
          if (api?.storeGet) {
            const data = await api.storeGet(key);
            existing = Array.isArray(data) ? data : [];
          }
          existing.push(entry);
          if (api?.storeSet) await api.storeSet(key, existing);

          // 方案2：同时写入 jsonl 文件持久化（app 重启后读取）
          if (api?.sessionAppendMessage) {
            try { await api.sessionAppendMessage(sessionId, entry); } catch {}
          }

          debugLog('saveMessage:', sessionId, entry.role, 'total:', existing.length);
        } catch (err) {
          debugError('saveMessage failed:', err);
        }
      }

      async function loadMessagesFromStore(sessionId) {
        if (!sessionId) return [];
        try {
          if (api?.storeGet) {
            const data = await api.storeGet(`msgs_${sessionId}`);
            return Array.isArray(data) ? data : [];
          }
        } catch (err) {
          debugError('loadMessagesFromStore failed:', err);
        }
        return [];
      }

      // 把一轮工具调用的返回结果格式化为文本块，注入下一轮发给 LLM 的上下文。
      // 目的：超时/中断后用户回复"继续"时，模型仍能看到本轮采集的数据，
      // 而非只能凭已写出的正文硬续（工具结果原本只用于 UI 卡片，不进 LLM 上下文）。
      // 兼容两种来源：渲染态 ss.live.tools（含 argsStr）与持久化消息的 toolCalls（含 args）。
      // 注意：只折叠 result（采集到的数据，不截断）；args 是输入参数，超 500 字则省略以免大参数工具（如 report_export）撑爆上下文。
      function formatToolResultsForContext(toolCalls) {
        if (!Array.isArray(toolCalls)) return '';
        const withResult = toolCalls.filter(t => t && typeof t.result === 'string' && t.result.trim().length > 0);
        if (withResult.length === 0) return '';
        const blocks = withResult.map((t, i) => {
          const a = t.args != null ? t.args : t.argsStr;
          let argsLine = '';
          if (a != null && a !== '') {
            const s = typeof a === 'string' ? a : JSON.stringify(a);
            if (s.length <= 500) argsLine = `\n参数：${s}`;
          }
          return `【工具${i + 1} · ${t.name}】${argsLine}\n返回结果：\n${t.result}`;
        });
        return `--- 本轮工具调用与采集结果（供后续对话引用这些数据继续）---\n${blocks.join('\n\n')}\n--- 以上为本轮工具结果 ---\n\n`;
      }

      // 根据消息列表重建发送给 LLM 的历史（排除 system/artifact；用户消息带图重建多模态 content）
      // switchSession 加载与单条删除后均复用，保证会话历史与可见消息一致。
      // assistant 消息若带工具结果，则前置折算为文本，使下一轮可见本轮采集的数据。
      function buildConversationHistory(msgs) {
        return (msgs || [])
          .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
          .map(m => {
            if (m.role === 'user' && (m.attachments?.length || m.fileAttachments?.length) && typeof buildUserLLMContent === 'function') {
              return { role: 'user', content: buildUserLLMContent(m.content, m.attachments, m.fileAttachments) };
            }
            if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0 && typeof formatToolResultsForContext === 'function') {
              const toolCtx = formatToolResultsForContext(m.toolCalls);
              if (toolCtx) return { role: 'assistant', content: toolCtx + (m.content || '') };
            }
            return { role: m.role, content: m.content };
          });
      }

      // ─────────────────────────────────────────────
      // 会话管理
      // ─────────────────────────────────────────────
      async function loadSessions() {
        if (!dom.historyList) return;
        if (!api?.sessionList) {
          dom.historyList.innerHTML = '<div class="history-empty">IPC API 不可用</div>';
          return;
        }
        try {
          const sessions = await api.sessionList();
          state.sessions = Array.isArray(sessions) ? sessions : [];
          renderSessionList();
          debugLog('loadSessions:', state.sessions.length);
        } catch (err) {
          debugError('loadSessions failed:', err);
          dom.historyList.innerHTML = '<div class="history-empty">加载失败</div>';
        }
      }

      // ─────────────────────────────────────────────
      // 时间分组（OpenAI 风格）
      // ─────────────────────────────────────────────
      function getSessionDateGroup(timestamp) {
        const now = new Date();
        const d = timestamp ? new Date(timestamp) : new Date();
        if (isNaN(d.getTime())) return '更早';

        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 86400000);
        const weekAgo = new Date(today.getTime() - 7 * 86400000);
        const monthAgo = new Date(today.getTime() - 30 * 86400000);
        // 本年初
        const yearStart = new Date(now.getFullYear(), 0, 1);

        const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

        if (dDate.getTime() === today.getTime()) return '今天';
        if (dDate.getTime() === yesterday.getTime()) return '昨天';
        if (dDate >= weekAgo) return '本周';
        if (dDate >= monthAgo) return '本月';
        if (d >= yearStart) return '本年初';
        return '更早';
      }

      // 分组顺序
      const DATE_GROUP_ORDER = ['今天', '昨天', '本周', '本月', '本年初', '更早'];

      function renderSessionList() {
        if (!dom.historyList) return;
        const q = state.searchQuery.toLowerCase().trim();
        const filtered = q
          ? state.sessions.filter(s => (s.title || '').toLowerCase().includes(q))
          : state.sessions;

        if (filtered.length === 0) {
          dom.historyList.innerHTML = `<div class="history-empty">${q ? '未找到匹配的对话' : '暂无会话'}</div>`;
          return;
        }

        // 搜索模式：不分组，平铺（带 snippet）
        if (q) {
          const searchResults = state.searchResults || filtered;
          dom.historyList.innerHTML = '';
          if (searchResults.length === 0) {
            dom.historyList.innerHTML = '<div class="history-empty">未找到匹配的对话</div>';
            return;
          }
          searchResults.forEach(s => {
            const item = buildSessionItemEl(s, true);
            dom.historyList.appendChild(item);
          });
          return;
        }

        // 正常模式：按时间分组
        // 确保按时间倒序排列
        const sorted = [...filtered].sort((a, b) => {
          const ta = a.updatedAt || a.createdAt || a.timestamp || 0;
          const tb = b.updatedAt || b.createdAt || b.timestamp || 0;
          return (tb || 0) - (ta || 0);
        });

        const groups = {};
        sorted.forEach(s => {
          const g = getSessionDateGroup(s.updatedAt || s.createdAt || s.timestamp);
          if (!groups[g]) groups[g] = [];
          groups[g].push(s);
        });

        dom.historyList.innerHTML = '';
        DATE_GROUP_ORDER.forEach(gName => {
          const items = groups[gName];
          if (!items || items.length === 0) return;
          const header = document.createElement('div');
          header.className = 'session-date-group';
          header.textContent = gName;
          dom.historyList.appendChild(header);
          items.forEach(s => {
            dom.historyList.appendChild(buildSessionItemEl(s, false));
          });
        });
      }

      // 检查某会话是否正在执行（遍历 sessionStates 找 isSending）
      function isSessionRunning(sessionId) {
        if (!sessionId) return false;
        const ss = sessionStates.get(sessionId);
        return !!(ss && ss.isSending);
      }

      // 任意会话的执行状态变化时调用：只更新侧栏各 item 的 running 标记，不全量重渲染（避免闪烁）
      function updateSessionRunningStates() {
        if (!dom.historyList) return;
        const items = dom.historyList.querySelectorAll('.session-item');
        items.forEach(item => {
          // 从 data-session-id 读取（buildSessionItemEl 里设置）
          const sid = item.dataset.sessionId;
          if (!sid) return;
          item.classList.toggle('running', isSessionRunning(sid));
        });
      }

      // 构建单个会话项 DOM（复用逻辑）
      function buildSessionItemEl(s, withSnippet) {
        const item = document.createElement('div');
        const isRunning = isSessionRunning(s.id);
        item.className = 'session-item'
          + (s.id === state.currentSessionId ? ' active' : '')
          + (isRunning ? ' running' : '');
        item.dataset.sessionId = s.id;

        const wrap = document.createElement('div');
        wrap.style.flex = '1';
        wrap.style.overflow = 'hidden';
        wrap.style.minWidth = '0';

        const titleSpan = document.createElement(withSnippet ? 'div' : 'span');
        titleSpan.className = 'session-item-title';
        titleSpan.textContent = s.title || '新对话';
        titleSpan.title = s.title || '新对话';
        wrap.appendChild(titleSpan);

        if (withSnippet && s.snippet) {
          const snip = document.createElement('div');
          snip.className = 'session-item-snippet';
          snip.textContent = s.snippet;
          wrap.appendChild(snip);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'session-delete';
        delBtn.textContent = '×';
        delBtn.title = '删除对话';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await showConfirmDialog({
            title: '删除对话',
            message: '确定删除这条对话吗？删除后无法恢复。',
            confirmText: '删除',
            danger: true,
          });
          if (ok) deleteSession(s.id);
        });

        item.appendChild(wrap);
        item.appendChild(delBtn);
        item.addEventListener('click', () => switchSession(s.id));
        return item;
      }

      // 搜索结果直接复用 renderSessionList（q 分支），无需独立函数
      // state.searchResults 存放后端全文搜索结果，renderSessionList 的 q 分支会读取它
      function renderSessionSearchMode(results) {
        state.searchResults = results || [];
        renderSessionList();
      }
      // 兼容旧调用名（防止其他地方仍引用 renderSessionSearchResults）
      function renderSessionSearchResults(results) { renderSessionSearchMode(results); }

      async function createNewSession() {
        if (!api?.sessionCreate) {
          showToast('IPC API 不可用', 'error');
          return;
        }
        try {
          const session = await api.sessionCreate('新对话', state.selectedAgentId || null);
          if (session && session.id) {
            state.sessions.unshift(session);
            state.currentSessionId = session.id;
            state.messages = [];
            state.conversationHistory = [];
            // 新建会话时关闭搜索
            if (dom.sessionSearchBox) dom.sessionSearchBox.style.display = 'none';
            dom.navSearch?.classList.remove('active');
            if (dom.sessionSearchInput) dom.sessionSearchInput.value = '';
            state.searchQuery = '';
            renderSessionList();
            renderMessages();
            dom.chatInput.focus();
            debugLog('createNewSession:', session.id);
          }
        } catch (err) {
          debugError('createNewSession failed:', err);
          showToast('创建对话失败: ' + err.message, 'error');
        }
      }

      async function switchSession(sessionId) {
        // 多会话并行：不阻止切换，后台请求继续运行
        if (sessionId === state.currentSessionId) return;

        // 版本号 guard：防止快速切换 A→B→C 时 B 的异步加载覆盖 C
        const switchVersion = ++state._switchVersion;

        state.currentSessionId = sessionId;
        state.messages = [];
        state.conversationHistory = [];
        // 切换会话时重置搜索状态（不另行渲染，下方 renderSessionList 会刷新）
        if (dom.sessionSearchBox) dom.sessionSearchBox.style.display = 'none';
        dom.navSearch?.classList.remove('active');
        if (dom.sessionSearchInput) dom.sessionSearchInput.value = '';
        state.searchQuery = '';
        renderSessionList();

        // 加载历史消息
        try {
          // 先尝试从 store 读取（我们的客户端持久化）
          let msgs = await loadMessagesFromStore(sessionId);
          // 如果 store 为空，尝试从后端 sessionGetMessages 读取（jsonl 文件）
          if (msgs.length === 0 && api?.sessionGetMessages) {
            const backendMsgs = await api.sessionGetMessages(sessionId);
            if (Array.isArray(backendMsgs) && backendMsgs.length > 0) {
              msgs = backendMsgs;
            }
          }
          // 双保险：如果 jsonl 条数 > store 条数（store 被竞态覆盖过），用 jsonl 的数据
          // 竞态修复后不应再发生，但旧数据可能已被覆盖
          if (api?.sessionGetMessages && msgs.length > 0) {
            try {
              const backendMsgs = await api.sessionGetMessages(sessionId);
              if (Array.isArray(backendMsgs) && backendMsgs.length > msgs.length) {
                msgs = backendMsgs;
              }
            } catch {}
          }
          state.messages = msgs;
          // 重建 conversationHistory（排除 system/artifact）；用户消息若带图片，重建多模态 content
          state.conversationHistory = buildConversationHistory(msgs);
          // 版本号 guard：如果在异步加载期间用户又切换了其他会话，放弃本次渲染
          if (switchVersion !== state._switchVersion) {
            debugLog('switchSession: 已被更新的切换取代，跳过渲染', sessionId);
            return;
          }
          renderMessages();
          // 复现进行中的会话交互：目标会话正在生成时，重建 live 助手气泡（累积文本 + 工具卡片）
          {
            const ss2 = getSessionState(sessionId);
            if (ss2.isSending && ss2.requestId) {
              rebuildLiveView(ss2);
            }
          }
          // 切换后根据目标会话的发送状态更新按钮 UI
          updateSendButtonUI();
          // 重置 token 统计 UI（从目标会话的累计 token 恢复）
          if (typeof resetTokenStatsUI === 'function') resetTokenStatsUI();
          debugLog('switchSession:', sessionId, 'msgs:', msgs.length);
        } catch (err) {
          debugError('switchSession failed:', err);
          renderMessages();
          {
            const ss2 = getSessionState(sessionId);
            if (ss2.isSending && ss2.requestId) {
              rebuildLiveView(ss2);
            }
          }
          updateSendButtonUI();
          if (typeof resetTokenStatsUI === 'function') resetTokenStatsUI();
        }
      }

      async function deleteSession(sessionId) {
        if (!api?.sessionDelete) return;
        try {
          await api.sessionDelete(sessionId);
          // 清理 store 中的消息
          if (api?.storeRemove) await api.storeRemove(`msgs_${sessionId}`);
          // 清理会话状态
          sessionStates.delete(sessionId);

          state.sessions = state.sessions.filter(s => s.id !== sessionId);
          if (state.currentSessionId === sessionId) {
            state.currentSessionId = null;
            state.messages = [];
            state.conversationHistory = [];
            renderMessages();
          }
          renderSessionList();
          debugLog('deleteSession:', sessionId);
        } catch (err) {
          debugError('deleteSession failed:', err);
          showToast('删除失败: ' + err.message, 'error');
        }
      }

      // ─────────────────────────────────────────────
      // 会话右键菜单 + 内联重命名
      // ─────────────────────────────────────────────

      // 单例右键菜单元素（懒创建、复用）
      let _sessionContextMenu = null;
      function getSessionContextMenu() {
        if (_sessionContextMenu) return _sessionContextMenu;
        const menu = document.createElement('div');
        menu.className = 'session-context-menu';
        menu.setAttribute('role', 'menu');
        menu.style.display = 'none';

        const renameItem = document.createElement('div');
        renameItem.className = 'session-context-item';
        renameItem.setAttribute('role', 'menuitem');
        renameItem.textContent = '重命名';
        renameItem.addEventListener('click', () => {
          const sid = menu.dataset.sessionId;
          hideSessionContextMenu();
          if (sid) startRenameSessionInline(sid);
        });
        menu.appendChild(renameItem);

        const divider = document.createElement('div');
        divider.className = 'session-context-separator';
        menu.appendChild(divider);

        const deleteItem = document.createElement('div');
        deleteItem.className = 'session-context-item danger';
        deleteItem.setAttribute('role', 'menuitem');
        deleteItem.textContent = '删除';
        deleteItem.addEventListener('click', async () => {
          const sid = menu.dataset.sessionId;
          hideSessionContextMenu();
          if (!sid) return;
          // 复用删除按钮的确认弹窗（危险操作默认聚焦取消）
          const ok = await showConfirmDialog({
            title: '删除对话',
            message: '确定删除这条对话吗？删除后无法恢复。',
            confirmText: '删除',
            danger: true,
          });
          if (ok) deleteSession(sid);
        });
        menu.appendChild(deleteItem);

        document.body.appendChild(menu);
        _sessionContextMenu = menu;
        return menu;
      }

      function showSessionContextMenu(x, y, sessionId) {
        const menu = getSessionContextMenu();
        menu.dataset.sessionId = sessionId;
        menu.style.display = 'block';
        // 先显示再测量，按视口边界夹取位置，避免溢出屏幕
        const rect = menu.getBoundingClientRect();
        menu.style.left = Math.min(x, window.innerWidth - rect.width - 4) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - rect.height - 4) + 'px';
      }

      function hideSessionContextMenu() {
        if (_sessionContextMenu) _sessionContextMenu.style.display = 'none';
      }

      // 内联重命名：标题替换为 input；Enter/blur 提交，Esc 取消
      function startRenameSessionInline(sessionId) {
        const session = state.sessions.find(s => s.id === sessionId);
        if (!session) return;
        const item = dom.historyList.querySelector(
          `.session-item[data-session-id="${CSS.escape(sessionId)}"]`
        );
        if (!item) return;
        const titleEl = item.querySelector('.session-item-title');
        // 已在编辑中（如该 item 同时匹配多处）则跳过
        if (!titleEl || item.querySelector('.session-item-title-edit')) return;

        const input = document.createElement('input');
        input.className = 'session-item-title-edit';
        input.value = session.title || '';
        input.placeholder = '输入会话标题';
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        let done = false;
        const finish = async () => {
          if (done) return;
          done = true;
          const newTitle = input.value.trim();
          if (newTitle && newTitle !== session.title) {
            try {
              if (api?.sessionRename) await api.sessionRename(sessionId, newTitle);
              session.title = newTitle;
            } catch (err) {
              debugError('重命名失败:', err);
              showToast('重命名失败: ' + (err?.message || err), 'error');
            }
          }
          renderSessionList();
        };
        const cancel = () => {
          if (done) return;
          done = true;
          renderSessionList();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        // blur 即提交（与 Finder 等重命名交互一致）
        input.addEventListener('blur', finish);
      }

      // 右键会话项 → 弹出菜单（事件委托，正常/搜索两种渲染模式均生效）
      if (dom.historyList) {
        dom.historyList.addEventListener('contextmenu', (e) => {
          const item = e.target.closest('.session-item');
          if (!item) return;
          const sid = item.dataset.sessionId;
          if (!sid) return;
          e.preventDefault();
          showSessionContextMenu(e.clientX, e.clientY, sid);
        });
      }
      // 点击菜单外 / 滚动 / Esc → 关闭菜单
      document.addEventListener('click', (e) => {
        if (!_sessionContextMenu || _sessionContextMenu.style.display === 'none') return;
        if (!_sessionContextMenu.contains(e.target)) hideSessionContextMenu();
      });
      document.addEventListener('scroll', hideSessionContextMenu, true);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideSessionContextMenu();
      });
