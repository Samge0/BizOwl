// chat.js — renderer module (split from index.html)

      // ─────────────────────────────────────────────
      // 发送消息
      // ─────────────────────────────────────────────
      /** 构造发给 LLM 的用户消息 content：有图片时返回 OpenAI vision 多模态数组，否则纯文本 */
      function buildUserLLMContent(text, imageAttachments, fileAttachments) {
        let llmText = text || '';
        if (fileAttachments && fileAttachments.length) {
          llmText += '\n\n[用户附带文件: ' + fileAttachments.map(f => f.name).join('、') + ']';
        }
        if (!imageAttachments || imageAttachments.length === 0) return llmText;
        const content = [{ type: 'text', text: llmText }];
        for (const img of imageAttachments) {
          content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
        }
        return content;
      }
      window.buildUserLLMContent = buildUserLLMContent;

      // 生成客户端消息 id（与 session-store 的 _doSaveId 同策略），保证渲染层 DOM / state / 持久化三处 id 一致，
      // 单条删除（按 id）才能精确命中。
      function genMsgId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      }

      async function sendMessage() {
        const text = dom.chatInput.value.trim();
        if (!text) return;

        // 检查模型
        if (!state.selectedModel) {
          showToast('请先在右侧设置中选择一个模型', 'error');
          return;
        }
        if (!state.selectedModel.modelId || !state.selectedModel.baseUrl || !state.selectedModel.apiKey) {
          showToast('当前模型配置不完整，请填写 Model ID、Base URL、API Key', 'error');
          return;
        }

        // 上下文超限检查：用最后一次 API 请求的 prompt_tokens（上下文窗口占用）
        // 而不是累计 total（累计 total 包含重复发送的历史，会虚高导致误判）
        const maxTokens = parseInt(state.selectedModel.maxTokens, 10);
        if (Number.isFinite(maxTokens) && maxTokens > 0) {
          const ss0 = getSessionState(state.currentSessionId);
          const contextTokens = ss0.tokenUsage?.prompt || 0;
          if (contextTokens >= maxTokens) {
            showToast(
              `上下文已满（${formatTokenCount(contextTokens)} / ${formatTokenCount(maxTokens)}）。请点击左上角「新对话」开启新会话。`,
              'error', 6000
            );
            return;
          }
        }

        // 防止快速双击在「新会话创建」await 窗口内创建重复会话
        if (!state.currentSessionId && state._pendingNewSession) {
          showToast('正在创建会话，请稍候', 'info');
          return;
        }

        // 确保有会话
        if (!state.currentSessionId) {
          if (api?.sessionCreate) {
            state._pendingNewSession = true;
            try {
              const session = await api.sessionCreate('新对话', state.selectedAgentId || null);
              if (session && session.id) {
                state.sessions.unshift(session);
                state.currentSessionId = session.id;
                renderSessionList();
              }
            } catch (err) {
              debugError('创建会话失败:', err);
            } finally {
              state._pendingNewSession = false;
            }
          }
        }

        // 获取当前会话的独立状态（多会话并行）
        const sessionId = state.currentSessionId;
        const ss = getSessionState(sessionId);
        if (ss.isSending) {
          showToast('当前会话正在生成中，请等待或切换到其他会话', 'info');
          return;
        }

        // 处理附件：图片→dataUrl（多模态 image_url），其它文件→文本附注
        const imageAttachments = [];
        const fileAttachments = [];
        for (const att of state.attachments) {
          if (att.type && att.type.startsWith('image/') && att.file) {
            try {
              const dataUrl = await fileToDataUrl(att.file);
              imageAttachments.push({ name: att.name, type: att.type, dataUrl });
            } catch (e) { debugError('读取图片失败:', e); }
          } else {
            fileAttachments.push({ name: att.name, type: att.type, size: att.size });
          }
        }
        // 发给模型的文本（非图片文件作为附注说明）+ 多模态 content（图片→OpenAI vision image_url）
        const llmContent = buildUserLLMContent(text, imageAttachments, fileAttachments);

        // 用户消息（带附件用于展示）
        const userMsg = { id: genMsgId(), role: 'user', content: text, timestamp: new Date().toISOString() };
        if (imageAttachments.length) userMsg.attachments = imageAttachments;
        if (fileAttachments.length) userMsg.fileAttachments = fileAttachments;
        appendMessageEl(userMsg);
        state.messages.push(userMsg);
        state.conversationHistory.push({ role: 'user', content: llmContent });

        // 保存用户消息
        saveMessage(sessionId, userMsg);

        // 更新会话标题（如果是第一条消息）
        if (api?.sessionRename && sessionId) {
          const session = state.sessions.find(s => s.id === sessionId);
          if (session && (!session.title || session.title === '新对话')) {
            const newTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
            try {
              await api.sessionRename(sessionId, newTitle);
              session.title = newTitle;
              renderSessionList();
            } catch (err) {
              debugError('更新会话标题失败:', err);
            }
          }
        }

        // 清空输入 + 附件 + 提及 + 预设
        // 先快照预设：confirmReport 设置的 research-report 预设需要在下方 buildPrompt
        // 时触发 research_report 方法论注入；但 buildPrompt 是异步执行，届时
        // state.activePreset 已被清空，故先捕获到局部变量再清空 UI 状态
        const activePreset = state.activePreset;
        dom.chatInput.value = '';
        dom.chatInput.style.height = 'auto';
        // 释放图片缩略图的 blob URL（remove 按钮路径已 revoke，发送路径补上，避免内存泄漏）
        for (const att of state.attachments) {
          if (att._objectUrl) { try { URL.revokeObjectURL(att._objectUrl); } catch {} }
        }
        state.attachments = [];
        state.mentionedCompanies = [];
        state.activePreset = null;
        renderAttachments();
        ss.isSending = true;
        ss.genStatus = null; // 清空上一轮的参数生成状态，避免新发送时短暂闪现旧文案
        updateSendButtonUI();

        // 创建 assistant 消息气泡（流式）—— live 视图按会话独立追踪
        // ss.live 保存文本/工具累积状态；切走再切回时由 rebuildLiveView 复现
        ss.live = { text: '', tools: [], view: null };
        rebuildLiveView(ss);

        try {
          // 构建 system prompt（通过 PromptPipeline，支持 triggers 条件注入）
          let systemPrompt = '';
          try {
            // 加载用户记忆（OptMem wake + USER.md），注入到 pipeline context
            let memoryContext = '';
            try {
              if (api?.memoryWake) {
                const memResult = await api.memoryWake();
                if (memResult?.text && memResult.text !== 'No memories yet. The first conversation will create one.') {
                  memoryContext += '### 历史记忆（时间衰减压缩视图）\n' + memResult.text + '\n';
                }
              }
            } catch (e) { debugLog('memoryWake failed (降级):', e?.message); }
            try {
              if (api?.memoryGetUserMd) {
                const userMd = await api.memoryGetUserMd();
                if (userMd && userMd.trim()) {
                  memoryContext += '\n### 用户画像（USER.md）\n' + userMd.trim() + '\n';
                }
              }
            } catch (e) { debugLog('memoryGetUserMd failed (降级):', e?.message); }

            const ctx = {
              agentId: state.selectedAgentId || undefined,
              memoryContext: memoryContext || undefined,
            };
            // 传递预设场景信息（触发 Task 类 prompt 条件注入）
            // 使用上方快照的 activePreset（state.activePreset 已在清空阶段置 null）
            if (activePreset) {
              ctx.presetId = activePreset.title || activePreset.id;
              ctx.presetContent = activePreset.label || activePreset.prompt;
            }
            if (api?.buildPrompt) {
              const promptResult = await api.buildPrompt(ctx);
              systemPrompt = promptResult.systemPrompt || '';
              debugLog('buildPrompt nodes:', promptResult.nodeCount, 'agent:', promptResult.activeAgent);
            }
          } catch (e) {
            debugError('buildPrompt failed (降级):', e);
          }

          // 追加工具能力提示（根据登录状态动态包含数据工具）
          const hasQccToken = state.authSession?.isLoggedIn;
          const qccToolPrompt = hasQccToken
            ? '\n- **qcc_knowledge_search**: 企业知识库搜索。当用户询问企业信息（工商、股权、风险等）时优先调用。'
              + '\n- **qcc_tool_search**: 搜索可用数据工具。goal 用中文描述查询目标（不含企业名）。'
              + '\n- **qcc_execute_tool**: 执行数据工具查询具体数据。url/name 从搜索结果获取。'
              + '\n\n**企业信息查询流程**：用户问企业信息 → 先 qcc_tool_search 搜索匹配工具 → qcc_execute_tool 执行查询 → 用返回的数据回答。'
            : '';
          systemPrompt += '\n\n---\n\n# 工具能力\n\n你拥有以下工具，当需要时请主动调用：'
            + '\n- **web_search**: 搜索网络获取最新信息。'
            + '\n- **shell**: 在本地终端执行命令。'
            + '\n- **read_file** / **write_file**: 读写本地文件。'
            + '\n- **memory_note**: 记录关于用户的长期记忆（偏好、习惯、重要决定等）。每次只记一条。'
            + '\n- **memory_recall**: 搜索历史记忆，用关键词回忆用户之前提到的信息。'
            + qccToolPrompt
            + '\n\n当用户询问需要实时信息或需要操作本地系统时，**必须先调用对应工具**。'
            + '\n\n当前时间：' + new Date().toLocaleString('zh-CN')
            // 推荐追问（前端解析为可点击 chips）
            + '\n\n---\n\n## 推荐追问\n回答结束后，必须额外输出一个推荐追问块，格式严格如下：\n<related_questions>[{"label":"展示给用户的简短问题","prompt":"点击后发送给模型的任务指令"}]</related_questions>\n要求：2-3 个、与本轮问题及回答强相关；label 是短而完整的问题（中文 14-28 字）；prompt 是具体可执行的任务指令句（不要问句、不要问号结尾）；围绕当前回答的具体对象/线索/风险点追问。';

          // 组装 messages
          const messages = [];
          if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
          messages.push(...state.conversationHistory);

          // 发送
          const { requestId } = await api.chatSend({
            modelId: state.selectedModel.modelId,
            baseUrl: state.selectedModel.baseUrl,
            apiKey: state.selectedModel.apiKey,
            messages,
            enableTools: true,
          });
          ss.requestId = requestId;

          // 判断此 requestId 是否属于当前活跃会话（用于决定是否更新 UI）
          const isActiveSession = () => (ss.requestId === requestId && state.currentSessionId === sessionId);

          // 流式渲染节流：避免每个 delta 都全量重渲染 innerHTML 导致界面抖动；
          // 仅在"贴近底部"时自动滚动，用户上滑阅读时不强制拉回。
          let renderTimer = null;
          let hasRendered = false; // 首个 delta 立即渲染，避免 typing→空白→文字 的闪烁
          const flushRender = () => {
            renderTimer = null;
            if (ss.requestId !== requestId) return;
            const vv = ensureLiveView(ss);
            vv.assistantContent.innerHTML = renderMarkdown(ss.live.text);
            maybeScrollToBottom();
          };

          // 监听产物事件（报告/文件导出成功 → 暂存，等 onChatDone 的 assistant 消息保存后再持久化，
          // 确保 jsonl/store 里 artifact 一定排在 assistant 之后，切会话后位置正确）
          const offArtifact = api.onChatArtifact && api.onChatArtifact(requestId, (artifact) => {
            if (ss.requestId !== requestId) return;
            const artMsg = {
              id: genMsgId(),
              role: 'artifact',
              artifact: artifact || {},
              timestamp: new Date().toISOString(),
            };
            // 暂存（onChatDone 保存 assistant 后再持久化 artMsg）
            if (!ss.pendingArtifacts) ss.pendingArtifacts = [];
            ss.pendingArtifacts.push(artMsg);
            // 仅当前活跃会话更新 UI（立即显示卡片，不等 done）
            if (isActiveSession()) {
              appendMessageEl(artMsg);
              scrollToBottom();
              showToast('✅ ' + (artifact.title || '文件') + ' 已生成', 'success');
            } else {
              showToast('✅ ' + (artifact.title || '文件') + ' 已生成（会话 ' + (state.sessions.find(s => s.id === sessionId)?.title || '') + '）', 'success');
            }
          });

          // 监听流式数据
          const offData = api.onChatData(requestId, (delta) => {
            if (ss.requestId !== requestId) return; // 防止跨会话数据混乱
            ss.live.text += delta; // 累积到会话状态（无论是否当前会话）
            // 只有当前活跃会话才更新 UI
            if (isActiveSession()) {
              const v = ensureLiveView(ss);
              removeLiveTyping(v);
              if (!hasRendered) { hasRendered = true; v.assistantContent.innerHTML = renderMarkdown(ss.live.text); maybeScrollToBottom(); return; }
              if (renderTimer) return; // 已有排队渲染，等下一次节流刷新
              renderTimer = setTimeout(flushRender, 50);
            }
          });

          // 监听工具调用
          const offTool = api.onChatTool(requestId, (info) => {
            if (ss.requestId !== requestId) return;
            if (info.type === 'tool_start') {
              ss.genStatus = null; // 工具参数已生成完毕，进入真实执行阶段
              const toolName = info.tool || info.name || 'tool';
              const entry = {
                name: toolName,
                args: info.args,
                argsStr: formatToolArgs(toolName, info.args),
                icon: getToolIcon(toolName),
                displayName: getToolDisplayName(toolName),
                status: 'start',
                iteration: info.iteration,
              };
              ss.live.tools.push(entry); // 累积到会话状态
              // 只有当前活跃会话才更新 UI
              if (isActiveSession()) {
                const v = ensureLiveView(ss);
                // 移除参数生成阶段的占位卡片（如有），由下方真实卡片接替（同一渲染帧，无闪烁）
                v.preparingCards = v.preparingCards || new Map();
                const placeholder = v.preparingCards.get(toolName);
                if (placeholder) { placeholder.remove(); v.preparingCards.delete(toolName); }
                if (!v.toolCardMap.has(entry)) {
                  const card = createToolCallCard({
                    name: entry.name, argsStr: entry.argsStr, args: entry.args,
                    icon: entry.icon, displayName: entry.displayName,
                  });
                  (v.assistantContent.parentNode || v.assistantEl).insertBefore(card, v.assistantContent);
                  v.toolCardMap.set(entry, card);
                  scrollToBottom();
                }
                // 工具开始执行时就显示 typing（带"执行中"提示），让用户知道系统在工作；
                // 之前的 removeLiveTyping 会导致工具执行期间无加载动画，用户以为卡住。
                showLiveThinking(v, '执行中');
                updateGeneratingBar(); // 同步底部持久状态条：执行中
              }
            } else if (info.type === 'tool_end') {
              // 标记匹配的 tool_start 为完成（FIFO + 同名匹配）
              const entry = ss.live.tools.find(t => t.name === info.tool && t.status === 'start');
              if (entry) { entry.status = 'end'; entry.result = info.result; }
              // 只有当前活跃会话才更新 UI
              if (isActiveSession() && entry) {
                const v = ensureLiveView(ss);
                const card = v.toolCardMap.get(entry);
                if (card) updateToolCallCardDone(card, info.result);
                showLiveThinking(v, '思考中'); // 工具完成后模型在思考下一步 → 显示加载动画
                updateGeneratingBar(); // 同步底部持久状态条：思考中
                debugLog('tool done:', info.tool);
                scrollToBottom();
              }
            } else if (info.type === 'tool_arg_progress') {
              // 模型正在生成工具调用参数（report_export 生成整份报告时可持续数分钟）。
              // 此阶段 tool_start 尚未触发、无工具卡片也无文本，UI 会显得"卡住"——
              // ① 底部持久状态条显示"正在撰写…（约 X% · Y 字符）"；
              // ② 大参数工具额外插入一张"撰写中…"占位卡片，让进度出现在消息流里（tool_start 时由真实卡片接替）。
              if (isActiveSession()) {
                ss.genStatus = formatToolArgStatus(info.tool, info.argsLength);
                updateGeneratingBar();
                if (isSlowArgTool(info.tool)) {
                  const v = ensureLiveView(ss);
                  v.preparingCards = v.preparingCards || new Map();
                  let card = v.preparingCards.get(info.tool);
                  if (!card) {
                    card = createToolCallCard({
                      name: info.tool, argsStr: '', args: {},
                      icon: getToolIcon(info.tool), displayName: getToolDisplayName(info.tool),
                    });
                    (v.assistantContent.parentNode || v.assistantEl).insertBefore(card, v.assistantContent);
                    v.preparingCards.set(info.tool, card);
                    scrollToBottom();
                  }
                  const statusEl = card.querySelector('.tool-call-status');
                  if (statusEl) statusEl.textContent = info.tool === 'report_export'
                    ? `撰写中… 约${reportArgPercent(info.argsLength)}%`
                    : '生成参数中…';
                }
              }
            }
          });

          // 监听 Token 用量
          // agent-loop 每次 reportUsage 汇报：
          //   prompt_tokens = 最后一次 API 的上下文大小（用于超限检测）
          //   completion_tokens = 本轮 runAgentLoop 累计输出 token
          //   total_tokens = 本轮真实计费总量（累加每次 API 调用）
          // 会话级总计：
          //   contextSize (prompt) = 取最后一次值（覆盖式）
          //   completion = 累加各轮增量
          //   total = 累加各轮增量
          const offUsage = api.onChatUsage && api.onChatUsage(requestId, (usage) => {
            if (ss.requestId !== requestId) return;
            ss.tokenUsage = ss.tokenUsage || { prompt: 0, completion: 0, total: 0 };
            // prompt/context 取最后一次值（覆盖式，因为每轮 API 重发完整历史）
            ss.tokenUsage.prompt = usage.prompt_tokens || 0;
            // completion/total 累加增量（本轮值 - 上次记录值）
            const prevCompletion = ss._lastRoundCompletion || 0;
            const prevTotal = ss._lastRoundTotal || 0;
            const completionDelta = Math.max(0, (usage.completion_tokens || 0) - prevCompletion);
            const totalDelta = Math.max(0, (usage.total_tokens || 0) - prevTotal);
            ss.tokenUsage.completion += completionDelta;
            ss.tokenUsage.total += totalDelta;
            ss._lastRoundCompletion = usage.completion_tokens || 0;
            ss._lastRoundTotal = usage.total_tokens || 0;
            // 只有当前活跃会话才更新 UI
            if (isActiveSession()) {
              updateTokenStatsUI(ss.tokenUsage);
            }
          });

          // 监听完成
          const offDone = api.onChatDone(requestId, () => {
            offData(); offTool(); offDone(); offError();
            if (typeof offArtifact === 'function') offArtifact();
            if (typeof offUsage === 'function') offUsage();
            // 清除本轮记录，下次发消息重新统计
            ss._lastRoundCompletion = null;
            ss._lastRoundTotal = null;
            // 持久化 token 统计到会话元数据（每轮结束落盘一次，重启后可恢复）
            if (api?.sessionUpdateTokenUsage) api.sessionUpdateTokenUsage(sessionId, ss.tokenUsage);
            if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; } // 停止节流渲染
            // 先记录活跃状态（下面会清空 ss.requestId，isActiveSession 将失效）
            const wasActive = isActiveSession();
            const finalText = ss.live.text;
            // 提前生成助手消息 id：DOM(finalEl) 与持久化(aiMsg)共用同一 id，单条删除才能精确命中
            const assistantMsgId = genMsgId();
            // token 失效：除消息外再弹一条红色 toast，强化提示用户去设置更新
            if (finalText && finalText.includes('accessToken 已过期')) {
              showToast('数据源 Token 已过期，请到「设置」更新', 'error');
            }
            const finalTools = ss.live.tools.map(t => ({ name: t.name, args: t.args, status: 'end', result: t.result }));
            const liveView = ss.live.view;
            ss.requestId = null;
            ss.isSending = false;

            // 只有当前活跃会话才更新 UI
            if (wasActive) {
              updateSendButtonUI();
              // 用完整的消息元素替换 live 气泡（带复制按钮 + 工具卡片 + Markdown）
              if (liveView && liveView.assistantEl && finalText) {
                const finalEl = buildMessageEl({
                  id: assistantMsgId,
                  role: 'assistant',
                  content: finalText,
                  toolCalls: finalTools,
                });
                liveView.assistantEl.replaceWith(finalEl);
                processMermaidInElement(finalEl);
                scrollToBottom();
              }
            }

            // 持久化助手消息（无论是否当前会话）
            if (ss.live.text) {
              const aiMsg = {
                id: assistantMsgId,
                role: 'assistant',
                content: ss.live.text,
                timestamp: new Date().toISOString(),
              };
              if (ss.live.tools.length > 0) {
                aiMsg.toolCalls = ss.live.tools.map(t => ({
                  name: t.name, args: t.args, status: t.status, result: t.result,
                }));
              }
              // 同步内存 state 与会话历史：让当前会话与「切走再切回（reload）」保持一致，
              // 也是单条删除后按 state.messages 重建 conversationHistory 的数据来源。
              state.messages.push(aiMsg);
              // conversationHistory 发给 LLM：前置本轮工具结果，使同会话内下一轮（如超时后"继续"）可见采集数据。
              const _toolCtx = (typeof formatToolResultsForContext === 'function') ? formatToolResultsForContext(ss.live.tools) : '';
              state.conversationHistory.push({ role: 'assistant', content: _toolCtx + ss.live.text });
              saveMessage(sessionId, aiMsg);
            }
            // 持久化暂存的产物消息（在 assistant 之后保存，确保 jsonl/store 顺序正确）
            // artifact 先于 done 到达，但逻辑上属于 assistant 回复的产物，应排在 assistant 之后
            if (ss.pendingArtifacts && ss.pendingArtifacts.length > 0) {
              for (const artMsg of ss.pendingArtifacts) {
                state.messages.push(artMsg);
                saveMessage(sessionId, artMsg);
              }
              ss.pendingArtifacts = [];
            }
            const doneLen = ss.live.text.length;
            const doneActive = isActiveSession();
            // 消息已持久化：清除 live 视图状态（下次切换从 store 重新加载完整消息）
            ss.live = { text: '', tools: [], view: null };
            debugLog('chat done, len:', doneLen, 'active:', doneActive);
          });

          // 监听错误
          const offError = api.onChatError(requestId, (error) => {
            offData(); offTool(); offDone(); offError();
            if (typeof offArtifact === 'function') offArtifact();
            if (typeof offUsage === 'function') offUsage();
            if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
            const wasActive = isActiveSession(); // 先记录（下面会清空 requestId）
            const partialText = ss.live.text;
            ss.requestId = null;
            ss.isSending = false;
            // 与 onChatDone 对称：重置本轮 token 基准（避免下一轮因基准泄漏而少算），
            // 并把已累计的 token 落盘（避免重启归零）
            ss._lastRoundCompletion = null;
            ss._lastRoundTotal = null;
            if (api?.sessionUpdateTokenUsage) api.sessionUpdateTokenUsage(sessionId, ss.tokenUsage);

            const errMsg = error?.message || String(error);
            // 只有当前活跃会话才更新 UI
            if (wasActive) {
              updateSendButtonUI();
              const v = ensureLiveView(ss);
              removeLiveTyping(v);
              // 清理参数生成阶段的占位卡片（若错误发生在撰写报告途中）
              v.preparingCards = v.preparingCards || new Map();
              v.preparingCards.forEach(c => c.remove());
              v.preparingCards.clear();
              v.assistantContent.innerHTML = renderMarkdown(partialText
                ? partialText + '\n\n❌ ' + errMsg
                : '❌ ' + errMsg);
            }
            debugError('chat error:', errMsg);
          });

        } catch (err) {
          ss.isSending = false;
          ss.requestId = null;
          updateSendButtonUI();
          if (ss.live.view) {
            removeLiveTyping(ss.live.view);
            ss.live.view.assistantContent.innerHTML = renderMarkdown('❌ ' + err.message);
          }
          debugError('sendMessage error:', err);
        }
      }

      // 根据当前会话的发送状态更新发送/停止按钮 UI
      function updateSendButtonUI() {
        const ss = getSessionState(state.currentSessionId);
        const sending = ss.isSending;
        if (dom.sendBtn) dom.sendBtn.style.display = sending ? 'none' : 'flex';
        if (dom.stopBtn) dom.stopBtn.style.display = sending ? 'flex' : 'none';
        // 通知侧栏更新执行中动效（任意会话的 isSending 变化都触发重渲染）
        if (typeof updateSessionRunningStates === 'function') updateSessionRunningStates();
        // 同步底部持久生成状态条（当前会话）——与发送按钮同源，覆盖所有 isSending 变化点 + 切换会话
        updateGeneratingBar();
        // 同步 token 统计的脉冲动画（生成中时闪烁，提示正在消耗）
        if (dom.tokenStats) {
          dom.tokenStats.classList.toggle('active', sending);
        }
      }

      // 底部持久生成状态条：当前会话 isSending 时显示，独立于流式 live view，
      // 不受工具调用/会话切换打断影响——只看"当前会话是否在生成"这一个状态。
      // 阶段文字：有正在执行的工具 → "正在执行…"，否则 "正在思考…"。
      function updateGeneratingBar() {
        const bar = dom.chatGeneratingBar;
        if (!bar) return;
        const ss = getSessionState(state.currentSessionId);
        const sending = !!(ss && ss.isSending);
        bar.classList.toggle('active', sending);
        if (!sending) { if (ss) ss.genStatus = null; return; }
        const labelEl = bar.querySelector('.gen-label');
        if (!labelEl) return;
        // 优先显示参数生成阶段的细粒度状态（如"正在撰写研究报告…（已生成 X 字符）"）
        if (ss.genStatus) { labelEl.textContent = ss.genStatus; return; }
        const tools = ss.live && Array.isArray(ss.live.tools) ? ss.live.tools : [];
        const runningTool = tools.some(t => t.status === 'start');
        labelEl.textContent = runningTool ? '正在执行…' : '正在思考…';
      }

      // 参数体量大、生成耗时长（可达数分钟）的工具——为它们显示占位卡片 + 渐近进度百分比
      function isSlowArgTool(tool) {
        return tool === 'report_export' || tool === 'document_export';
      }
      // report_export 的参数即整份报告，无法预知总量；用渐近百分比给"进度"直觉（永不虚假到 100%）
      function reportArgPercent(argsLength) {
        if (!argsLength || !Number.isFinite(argsLength)) return 0;
        return Math.round(argsLength / (argsLength + 20000) * 100);
      }
      // 工具参数生成阶段的状态文案（report_export 等大参数工具可能持续数分钟）
      function formatToolArgStatus(toolName, argsLength) {
        const verbs = {
          report_export: '正在撰写研究报告',
          document_export: '正在生成文档',
          web_search: '正在发起搜索',
          write_file: '正在写入文件',
        };
        const base = verbs[toolName] || '正在生成内容';
        if (!argsLength) return `${base}…`;
        if (isSlowArgTool(toolName)) {
          return `${base}…（约 ${reportArgPercent(argsLength)}% · ${argsLength.toLocaleString()} 字符）`;
        }
        return `${base}…（已生成 ${argsLength.toLocaleString()} 字符）`;
      }

      // 兼容旧调用（内部转发到 updateSendButtonUI）
      function setSendingState(sending) {
        const ss = getSessionState(state.currentSessionId);
        ss.isSending = sending;
        if (dom.sendBtn) dom.sendBtn.style.display = sending ? 'none' : 'flex';
        if (dom.stopBtn) dom.stopBtn.style.display = sending ? 'flex' : 'none';
      }

      // ─────────────────────────────────────────────
      // Token 用量统计 UI
      // ─────────────────────────────────────────────
      /**
       * 格式化 token 数字（1234 → 1.2K，1234567 → 1.2M）
       */
      function formatTokenCount(n) {
        if (!n || n < 0) return '0';
        if (n < 1000) return String(n);
        if (n < 1000000) return (n / 1000).toFixed(1) + 'K';
        return (n / 1000000).toFixed(1) + 'M';
      }

      /**
       * 更新 chat-header 中的 token 用量显示
       * @param {Object} usage - { prompt, completion, total }
       */
      function updateTokenStatsUI(usage) {
        if (!dom.tokenStats || !dom.tokenStatsValue) return;
        const total = usage?.total || 0;
        dom.tokenStatsValue.textContent = formatTokenCount(total);

        // 上限检测：maxTokens 是上下文窗口大小，跟 prompt（上下文占用）比较
        const maxTokens = parseInt(state.selectedModel?.maxTokens, 10);
        const hasLimit = Number.isFinite(maxTokens) && maxTokens > 0;

        // 清除旧的状态类
        dom.tokenStats.classList.remove('warning', 'danger');

        if (hasLimit) {
          // 用 prompt（上下文占用）算百分比，而不是 total（累计计费量）
          const contextSize = usage?.prompt || 0;
          const pct = contextSize / maxTokens;
          if (dom.tokenStatsLimit) {
            dom.tokenStatsLimit.textContent = '/ ' + formatTokenCount(maxTokens);
          }
          // 超过 80% 显示警告色，超过 95% 显示危险色
          if (pct >= 0.95) dom.tokenStats.classList.add('danger');
          else if (pct >= 0.80) dom.tokenStats.classList.add('warning');
          // tooltip：显示详细分解
          // 累计输入 = 累计计费总量 − 累计输出（使"输入+输出=累计消耗"自洽；
          // 注意：与下方"上下文占用"用的 prompt（末次上下文大小）是不同口径，不要混用）
          const contextStr = formatTokenCount(contextSize);
          const inputStr = formatTokenCount(Math.max(0, total - (usage?.completion || 0)));
          const completionStr = formatTokenCount(usage?.completion || 0);
          const totalStr = formatTokenCount(total);
          dom.tokenStats.title = `累计消耗: ${totalStr}（输入 ${inputStr} + 输出 ${completionStr}）\n上下文占用: ${contextStr} / ${formatTokenCount(maxTokens)}（${Math.round(pct * 100)}%）`;
        } else {
          if (dom.tokenStatsLimit) dom.tokenStatsLimit.textContent = '';
          // 累计输入 = 累计计费总量 − 累计输出（使"输入+输出=累计消耗"自洽）
          const inputStr = formatTokenCount(Math.max(0, total - (usage?.completion || 0)));
          const completionStr = formatTokenCount(usage?.completion || 0);
          dom.tokenStats.title = `累计消耗: ${formatTokenCount(total)}（输入 ${inputStr} · 输出 ${completionStr}）`;
        }
      }

      /**
       * 重置 token 统计 UI（切换会话时调用，从会话状态恢复）
       */
      function resetTokenStatsUI() {
        const ss = getSessionState(state.currentSessionId);
        // 更新上限显示（模型可能切换了）
        const maxTokens = parseInt(state.selectedModel?.maxTokens, 10);
        if (dom.tokenStatsLimit) {
          dom.tokenStatsLimit.textContent = (Number.isFinite(maxTokens) && maxTokens > 0)
            ? '/ ' + formatTokenCount(maxTokens) : '';
        }
        updateTokenStatsUI(ss.tokenUsage || { prompt: 0, completion: 0, total: 0 });
        // 同步生成中的脉冲动画状态
        if (dom.tokenStats) {
          dom.tokenStats.classList.toggle('active', !!ss.isSending);
        }
      }
