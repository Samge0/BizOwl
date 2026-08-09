// main.js — renderer module (split from index.html)

      'use strict';

      // 导出日志按钮
      document.getElementById('debugExportBtn')?.addEventListener('click', async () => {
        if (!api?.exportLogs) { showToast('日志 API 不可用', 'error'); return; }
        try {
          const result = await api.exportLogs();
          if (result.success) {
            showToast(`日志已导出: ${result.path} (${result.lines} 行)`, 'success');
          } else if (!result.canceled) {
            showToast('导出失败: ' + (result.error || '未知'), 'error');
          }
        } catch (err) {
          showToast('导出失败: ' + err.message, 'error');
        }
      });

      // 清空调试面板
      document.getElementById('debugClearBtn')?.addEventListener('click', () => {
        if (debugContent) debugContent.textContent = '';
      });

      window.addEventListener('error', (e) => debugError('[Global]', e.error || e.message));
      window.addEventListener('unhandledrejection', (e) => debugError('[Reject]', e.reason));

      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
          e.preventDefault();
          debugPanel.classList.toggle('visible');
          if (debugPanel.classList.contains('visible')) debugPanel.textContent = '';
        }
      });
      debugLog('clawAPI available:', hasAPI);

      // ─────────────────────────────────────────────
      // 窗口控制
      // ─────────────────────────────────────────────
      dom.btnMinimize.addEventListener('click', () => api?.minimize?.());
      dom.btnMaximize.addEventListener('click', () => api?.toggleMaximize?.());
      dom.btnClose.addEventListener('click', () => api?.close?.());

      dom.toggleSettings.addEventListener('click', openSettingsPanel);
      dom.closeSettings.addEventListener('click', closeSettingsPanel);
      dom.settingsOverlay.addEventListener('click', closeSettingsPanel);
      if (dom.openSettingsBtn) dom.openSettingsBtn.addEventListener('click', openSettingsPanel);

      // GitHub 链接 — 在默认浏览器中打开
      const githubLink = document.getElementById('githubLink');
      const updateDot = document.getElementById('updateDot');
      const RELEASES_URL = 'https://github.com/Samge0/BizOwl/releases';
      const REPO_URL = 'https://github.com/Samge0/BizOwl';
      if (githubLink) {
        githubLink.addEventListener('click', () => {
          githubLink.style.opacity = '0.5';
          setTimeout(() => githubLink.style.opacity = '', 150);
          // 如果有更新红点，跳转到 releases 页面；否则跳转到仓库主页
          const targetUrl = (updateDot && updateDot.style.display !== 'none') ? RELEASES_URL : REPO_URL;
          if (api?.openExternal) {
            api.openExternal(targetUrl);
          } else {
            window.open(targetUrl, '_blank');
          }
        });
      }

      // 全局拦截所有外部链接（target="_blank" 或 http(s) 链接）→ 系统默认浏览器
      // 覆盖设置页中的"获取 API Key"等外部链接，避免在 app 内打开
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        const isExternal = link.target === '_blank' || /^https?:\/\//i.test(href);
        if (!isExternal) return;
        e.preventDefault();
        if (api?.openExternal) {
          api.openExternal(href);
        } else {
          window.open(href, '_blank');
        }
      });

      // 导航按钮
      dom.navNewChat.addEventListener('click', () => {
        createNewSession();
      });
      dom.navSearch.addEventListener('click', () => {
        // 切换会话搜索框
        const box = dom.sessionSearchBox;
        if (!box) return;
        const visible = box.style.display !== 'none';
        if (visible) {
          closeSessionSearch();
        } else {
          box.style.display = '';
          dom.navSearch.classList.add('active');
          setTimeout(() => dom.sessionSearchInput?.focus(), 0);
        }
      });
      if (dom.sessionSearchInput) {
        dom.sessionSearchInput.addEventListener('input', (e) => {
          const q = e.target.value;
          state.searchQuery = q;
          clearTimeout(sessionSearchTimer);
          if (!q.trim()) {
            renderSessionList();
            return;
          }
          // 防抖 300ms 后做后端全文搜索（标题 + 消息内容）
          sessionSearchTimer = setTimeout(async () => {
            if (!api?.sessionSearch) {
              renderSessionList();
              return;
            }
            try {
              const results = await api.sessionSearch(q);
              // 临时保存原始 sessions，搜索结果渲染到 state.searchResults
              const arr = Array.isArray(results) ? results : [];
              state.searchResults = arr;
              renderSessionSearchMode(arr);
            } catch (err) {
              debugError('sessionSearch failed:', err);
              renderSessionList();
            }
          }, 300);
        });
        dom.sessionSearchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') closeSessionSearch();
        });
      }
      if (dom.sessionSearchClose) {
        dom.sessionSearchClose.addEventListener('click', closeSessionSearch);
      }
      dom.navSkills.addEventListener('click', () => {
        dom.skillsPopover.classList.toggle('visible');
        dom.navSkills.classList.toggle('active');
      });
      dom.closeSkillsPopover.addEventListener('click', () => {
        dom.skillsPopover.classList.remove('visible');
        dom.navSkills.classList.remove('active');
      });
      // 导入技能：弹出文件选择对话框 → 调后端 importSkill → 刷新列表
      if (dom.importSkillBtn) {
        dom.importSkillBtn.addEventListener('click', async () => {
          if (!api?.importSkill) { showToast('IPC API 不可用', 'error'); return; }
          try {
            const result = await api.importSkill();
            if (result && result.success) {
              showToast('技能导入成功: ' + (result.name || ''), 'success');
              await loadSkills();
            } else if (result && !result.success && result.error) {
              showToast('导入失败: ' + result.error, 'error');
            }
          } catch (err) {
            showToast('导入失败: ' + err.message, 'error');
          }
        });
      }

      // 双击 agent 名字可隐藏侧栏
      dom.headerAgentName.addEventListener('dblclick', () => {
        dom.sidebar.classList.toggle('collapsed');
      });
      window.toggleToolCard = toggleToolCard;

      dom.sendBtn.addEventListener('click', sendMessage);
      // 合并的 keydown 处理器：Enter 发送 + @mention 导航（避免重复绑定和双触发）
      dom.chatInput.addEventListener('keydown', (e) => {
        const mentionVisible = dom.mentionDropdown && dom.mentionDropdown.classList.contains('visible');
        const items = mentionVisible ? getMentionItems() : [];

        // @mention 导航优先（下拉可见时拦截方向键和选中后的 Enter）
        if (mentionVisible) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightMentionItem(Math.min(mentionSelectedIndex + 1, items.length - 1));
            return;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightMentionItem(Math.max(mentionSelectedIndex - 1, 0));
            return;
          } else if (e.key === 'Escape') {
            e.preventDefault();
            hideMentionDropdown();
            return;
          }
          // Enter：mention 下拉可见时
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (items.length > 0 && mentionSelectedIndex >= 0) {
              selectMentionByIndex(mentionSelectedIndex);
            } else {
              // 无选中项 → 关闭下拉，不发送
              hideMentionDropdown();
            }
            return; // 不触发 sendMessage
          }
        }

        // 普通 Enter 发送（mention 下拉不可见时）
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
      // 合并的 input 处理器：textarea 自动高度 + @mention 检测
      dom.chatInput.addEventListener('input', (e) => {
        // textarea 自动高度
        dom.chatInput.style.height = 'auto';
        dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 140) + 'px';
        // @mention 检测
        const val = e.target.value;
        const cursorPos = e.target.selectionStart;
        const beforeCursor = val.slice(0, cursorPos);
        const atMatch = beforeCursor.match(/@([^\s@]*)$/);
        if (atMatch) {
          const keyword = atMatch[1];
          if (keyword.length >= 0) {
            showMentionDropdown(keyword);
            return;
          }
        }
        hideMentionDropdown();
      });
      window.selectModel = selectModel;

      dom.addModelBtn.addEventListener('click', async () => {
        try {
          const models = await api.getCustomModels();
          const id = api.newModelId ? await api.newModelId() : ('m_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
          models.push({ _id: id, name: '新模型', modelId: '', baseUrl: '', apiKey: '', maxTokens: '' });
          await api.saveCustomModels(models);
          await loadModels();
          // 新增的模型默认展开，方便直接填写
          const last = dom.modelList.lastElementChild;
          if (last) last.classList.add('expanded');
          showToast('已添加新模型', 'success');
        } catch (err) {
          showToast('添加失败: ' + err.message, 'error');
        }
      });
      window.selectAgent = selectAgent;

      // 点击侧栏底部登录状态打开设置面板（旧元素已移除，保留为安全检查）
      if (dom.loginStatus) {
        dom.loginStatus.addEventListener('click', () => {
          openSettingsPanel();
          setTimeout(() => {
            dom.authArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        });
      }

      // ─────────────────────────────────────────────
      // 文件上传 + @提及 + 停止生成
      // ─────────────────────────────────────────────

      // 文件上传：点击📎按钮 → 选择文件 → 预览
      if (dom.attachBtn) {
        dom.attachBtn.addEventListener('click', () => dom.fileInput?.click());
      }
      if (dom.fileInput) {
        dom.fileInput.addEventListener('change', (e) => {
          const files = Array.from(e.target.files || []);
          for (const f of files) {
            state.attachments.push({ name: f.name, size: f.size, type: f.type, file: f });
          }
          renderAttachments();
          dom.fileInput.value = ''; // 清空，允许重复选择同一文件
        });
      }
      if (chatWrapper) {
        chatWrapper.addEventListener('dragover', (e) => { e.preventDefault(); chatWrapper.style.borderColor = 'var(--accent)'; });
        chatWrapper.addEventListener('dragleave', () => { chatWrapper.style.borderColor = ''; });
        chatWrapper.addEventListener('drop', (e) => {
          e.preventDefault();
          chatWrapper.style.borderColor = '';
          const files = Array.from(e.dataTransfer?.files || []);
          for (const f of files) {
            state.attachments.push({ name: f.name, size: f.size, type: f.type, file: f });
          }
          renderAttachments();
        });
      }

      // 粘贴文件
      if (dom.chatInput) {
        dom.chatInput.addEventListener('paste', (e) => {
          const files = Array.from(e.clipboardData?.files || []);
          if (files.length === 0) return;
          e.preventDefault();
          for (const f of files) {
            state.attachments.push({ name: f.name || `pasted-${Date.now()}`, size: f.size, type: f.type, file: f });
          }
          renderAttachments();
        });
      }

      // @按钮点击 → 打开企业搜索弹窗（解耦输入框输入检测，更稳定）
      // 注：keydown 和 input 事件已在上方合并处理（Enter 发送 + @mention 导航）
      if (dom.mentionBtn) {
        dom.mentionBtn.addEventListener('click', () => openCompanySearchModal());
      }
      if (dom.companyModalClose) {
        dom.companyModalClose.addEventListener('click', closeCompanySearchModal);
      }
      if (dom.companyModalOverlay) {
        dom.companyModalOverlay.addEventListener('click', (e) => {
          if (e.target === dom.companyModalOverlay) closeCompanySearchModal();
        });
      }
      // 图片大图预览：✕ / 点遮罩 / Esc 关闭 + 滚轮缩放 + 拖拽
      if (dom.imgLightboxClose) {
        dom.imgLightboxClose.addEventListener('click', closeImageLightbox);
      }
      // 绑定 stage 点击关闭、拖拽、滚轮缩放等交互（只绑一次）
      bindLightboxInteractions();
      if (dom.imgLightbox) {
        dom.imgLightbox.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') closeImageLightbox();
          if (e.key === '=' || e.key === '+') setLightboxZoom(lightboxState.zoom + 0.25);
          if (e.key === '-') setLightboxZoom(lightboxState.zoom - 0.25);
          if (e.key === '0') { setLightboxZoom(1); lightboxState.ox = 0; lightboxState.oy = 0; applyLightboxTransform(); }
        });
        dom.imgLightbox.tabIndex = -1; // 允许接收键盘事件
      }
      if (dom.companySearchInput) {
        dom.companySearchInput.addEventListener('input', (e) => {
          const q = e.target.value.trim();
          clearTimeout(companySearchTimer);
          if (!q) {
            dom.companyModalResults.innerHTML = '<div class="company-modal-hint">💡 输入公司名搜索并引用企业</div>';
            return;
          }
          dom.companyModalResults.innerHTML = '<div class="company-modal-hint">⏳ 搜索中...</div>';
          companySearchTimer = setTimeout(async () => {
            try {
              const resp = await api.searchCompanies(q);
              let results;
              if (resp && typeof resp === 'object' && !Array.isArray(resp) && 'success' in resp) {
                if (!resp.success) {
                  dom.companyModalResults.innerHTML = `<div class="company-modal-hint">❌ ${escapeHtml(resp.error || '搜索失败，请先登录数据源')}</div>`;
                  return;
                }
                results = Array.isArray(resp.companies) ? resp.companies : [];
              } else {
                results = Array.isArray(resp) ? resp : [];
              }
              renderCompanyModalResults(results, q);
            } catch (err) {
              debugError('companyModal search error:', err);
              dom.companyModalResults.innerHTML = '<div class="company-modal-hint">❌ 搜索失败，请重试</div>';
            }
          }, 300);
        });
        dom.companySearchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeCompanySearchModal(); }
        });
      }

      // 停止生成（停止当前会话的请求）
      if (dom.stopBtn) {
        dom.stopBtn.addEventListener('click', () => {
          const ss = getSessionState(state.currentSessionId);
          if (ss.requestId) {
            api.chatCancel(ss.requestId);
            showToast('已停止生成', 'info');
          }
        });
      }

      // ─────────────────────────────────────────────
      // 滚动导航（回到顶部/底部）+ 用户消息快速导航 rail
      // ─────────────────────────────────────────────
      function bindScrollNavigation() {
        const messages = dom.chatMessages;
        const topBtn = $('scrollToTopBtn');
        const bottomBtn = $('scrollToBottomBtn');
        if (!messages || !topBtn || !bottomBtn) return;

        // 滚动时显示/隐藏导航按钮
        messages.addEventListener('scroll', () => {
          updateScrollNavVisibility();
        });

        // 平滑滚动
        topBtn.addEventListener('click', () => {
          messages.scrollTo({ top: 0, behavior: 'smooth' });
        });
        bottomBtn.addEventListener('click', () => {
          messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
        });
      }

      // 更新滚动导航按钮可见性（renderMessages 后也调用）
      function updateScrollNavVisibility() {
        const messages = dom.chatMessages;
        const topBtn = $('scrollToTopBtn');
        const bottomBtn = $('scrollToBottomBtn');
        if (!messages || !topBtn || !bottomBtn) return;
        const { scrollTop, scrollHeight, clientHeight } = messages;
        topBtn.classList.toggle('visible', scrollTop > 120);
        bottomBtn.classList.toggle('visible', scrollHeight - scrollTop - clientHeight > 120);
      }

      // 更新 msg-rail 可见性（有消息时显示触发器，无消息隐藏）
      function updateMsgRailVisibility() {
        const rail = $('msgRail');
        if (!rail) return;
        const hasMessages = state.messages.length > 0;
        rail.style.display = hasMessages ? 'flex' : 'none';
      }

      function bindMsgRail() {
        const rail = $('msgRail');
        const tab = $('msgRailTab');
        const panel = $('msgRailPanel');
        const list = $('msgRailList');
        if (!rail || !tab || !panel || !list) return;

        let hoverTimer = null;

        // hover 展开（鼠标进入触发器）
        tab.addEventListener('mouseenter', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          rail.classList.add('expanded');
          rebuildMsgRailList();
        });

        // 鼠标离开整个 rail → 收起（延迟 300ms 避免误触）
        rail.addEventListener('mouseleave', () => {
          hoverTimer = setTimeout(() => {
            rail.classList.remove('expanded');
          }, 300);
        });

        // 鼠标重新进入 rail → 取消收起
        rail.addEventListener('mouseenter', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
        });
      }

      // 重建用户消息列表
      function rebuildMsgRailList() {
        const list = $('msgRailList');
        if (!list) return;
        list.innerHTML = '';
        const userMsgs = state.messages.filter(m => m.role === 'user' && m.content);
        if (userMsgs.length === 0) {
          list.innerHTML = '<div class="msg-rail-empty">暂无用户消息</div>';
          return;
        }
        // 找到所有 .message DOM 节点（user 和 assistant 交替）
        const inner = dom.chatMessages.querySelector('.messages-inner');
        const msgEls = inner ? Array.from(inner.querySelectorAll('.message.message-user')) : [];

        userMsgs.forEach((msg, idx) => {
          const el = msgEls[idx];
          const item = document.createElement('div');
          item.className = 'msg-rail-item';
          // 截取前 60 字符
          let text = (msg.content || '').replace(/\n/g, ' ').trim();
          item.textContent = text;
          item.title = text;
          item.addEventListener('click', () => {
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            $('msgRail')?.classList.remove('expanded');
          });
          list.appendChild(item);
        });
      }

      // ─────────────────────────────────────────────
      // 初始化
      // ─────────────────────────────────────────────
      async function init() {
        try {
          debugLog('init start');
          if (!hasAPI) {
            showToast('clawAPI 不可用，请检查主进程', 'error');
            if (dom.historyList) dom.historyList.innerHTML = '<div class="history-empty">IPC API 不可用</div>';
            dom.modelList.innerHTML = '<div class="empty-state">IPC API 不可用</div>';
            dom.authArea.innerHTML = '<div class="empty-state">IPC API 不可用</div>';
            return;
          }
          // 并行加载（首页助手卡已移除，不再 loadAgents）
          await Promise.allSettled([
            loadSessions(),
            loadModels(),
            loadAuthSession(),
            loadSkills(),
          ]);
          await loadQuickActions();
          renderMessages();
          // 初始化 token 统计 UI（从当前选中模型的上限恢复）
          if (typeof resetTokenStatsUI === 'function') resetTokenStatsUI();
          // 绑定滚动导航和用户消息快速导航
          bindScrollNavigation();
          bindMsgRail();
          // 版本号 + 更新检测（异步，不阻塞主流程）
          checkVersionAndUpdates();
          debugLog('init done');
        } catch (err) {
          console.error('[init] 致命错误:', err.message, err.stack);
          showToast('初始化失败: ' + err.message, 'error');
        }
      }

      // ─────────────────────────────────────────────
      // 版本号显示 + 更新检测（GitHub Releases）
      // ─────────────────────────────────────────────
      async function checkVersionAndUpdates() {
        // 1. 显示当前版本号
        try {
          if (api?.getVersion) {
            const ver = await api.getVersion();
            const versionSpan = document.querySelector('#githubLink span');
            if (versionSpan) versionSpan.textContent = `BizOwl v${ver}`;
          }
        } catch (e) {
          debugError('getVersion failed:', e);
        }
        // 2. 检测 GitHub 最新 release（匿名 API，失败静默忽略）
        if (!api?.checkUpdate) return;
        try {
          const result = await api.checkUpdate();
          debugLog('checkUpdate result:', result);
          if (result && result.hasUpdate) {
            const dot = document.getElementById('updateDot');
            if (dot) {
              dot.style.display = '';
              dot.title = `发现新版本 v${result.latestVersion}（当前 v${result.currentVersion}），点击下载`;
            }
            // 更新 GitHub 链接的 title
            const link = document.getElementById('githubLink');
            if (link) {
              link.title = `发现新版本 v${result.latestVersion}！点击前往下载`;
            }
            debugLog(`[Update] 发现新版本: ${result.latestVersion} (当前 ${result.currentVersion})`);
          }
        } catch (e) {
          debugError('checkUpdate failed:', e);
        }
      }

      init();
