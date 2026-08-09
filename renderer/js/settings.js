// settings.js — renderer module (split from index.html)

      // ─────────────────────────────────────────────
      // 设置面板（macOS 风格居中弹窗）+ 左侧分类导航 + 技能浮层
      // ─────────────────────────────────────────────
      // 积分刷新函数句柄（由 renderAuthArea 内部赋值），供 openSettingsPanel 进入设置页时调用
      let refreshCreditsFn = null;

      // ── 左导航切换逻辑 ──
      // 点击导航项 → 切换 active 状态 + 显示对应 section
      (function initSettingsNav() {
        // 延迟绑定：等 DOM ready
        function bind() {
          const navEl = document.getElementById('settingsNav');
          if (!navEl) return;
          const navItems = navEl.querySelectorAll('.settings-nav-item');
          const sections = document.querySelectorAll('.settings-section[data-tab]');
          navItems.forEach(item => {
            item.addEventListener('click', () => {
              const tab = item.dataset.tab;
              // 切换导航项高亮
              navItems.forEach(n => n.classList.remove('active'));
              item.classList.add('active');
              // 切换内容区
              sections.forEach(s => {
                s.classList.toggle('active', s.dataset.tab === tab);
              });
            });
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', bind);
        } else {
          bind();
        }
      })();

      function openSettingsPanel() {
        dom.settingsPanel.classList.add('visible');
        dom.settingsOverlay.classList.add('visible');
        if (!state.authSession?.isLoggedIn) {
          // 未登录 → 重新渲染触发二维码生成
          renderAuthArea();
        } else {
          // 已登录 → 进入设置页自动刷新一次积分
          refreshCreditsFn?.();
        }
      }
      // 二维码轮询控制（模块级，避免闭包作用域问题）
      let _qrPollTimer = null;
      let _qrExpireTimer = null;
      let _qrSessionId = null;
      function stopQrPolling() {
        if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
        if (_qrExpireTimer) { clearTimeout(_qrExpireTimer); _qrExpireTimer = null; }
        _qrSessionId = null;
      }

      function closeSettingsPanel() {
        dom.settingsPanel.classList.remove('visible');
        dom.settingsOverlay.classList.remove('visible');
        stopQrPolling();
      }

      // ─────────────────────────────────────────────
      // 模型选择
      // ─────────────────────────────────────────────
      /**
       * 模型稳定标识。优先用 _id（不可变），兜底用 modelId+baseUrl 组合（向后兼容旧记录）。
       * ⚠️ 不能只用 modelId+baseUrl —— 这两个字段是用户编辑的对象，编辑过程中 key 会变化，
       * 导致后续字段 blur 保存时按旧 key 查找不到目标模型 → baseUrl/apiKey 丢失。
       */
      function modelKeyOf(m) { return m?._id || `${(m && m.modelId) || ''}::${(m && m.baseUrl) || ''}`; }

      function selectModel(index) {
        state.selectedModelIndex = parseInt(index);
        state.selectedModel = (state.selectedModelIndex >= 0 && state.allModels[state.selectedModelIndex])
          ? state.allModels[state.selectedModelIndex]
          : null;
        // 持久化选择，跨重启自动恢复
        if (state.selectedModel && api?.storeSet) {
          try { api.storeSet('selectedModelKey', modelKeyOf(state.selectedModel)); } catch {}
        }
        debugLog('selected model:', state.selectedModel?.name || 'none');
        // 更新 token 上限显示（模型可能带不同的 maxTokens 配置）
        if (typeof resetTokenStatsUI === 'function') resetTokenStatsUI();
      }

      async function loadModels() {
        if (!api?.getCustomModels) {
          dom.modelList.innerHTML = '<div class="empty-state">IPC API 不可用</div>';
          return;
        }
        try {
          const models = await api.getCustomModels();
          state.allModels = Array.isArray(models) ? models : [];

          // 更新顶部下拉框
          const prev = state.selectedModelIndex;
          dom.modelSelect.innerHTML = '<option value="-1">— 选择模型 —</option>';
          state.allModels.forEach((m, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = m.name || m.modelId || `模型${i + 1}`;
            dom.modelSelect.appendChild(opt);
          });
          // 恢复选择：优先持久化 key（跨重启），其次会话内 prev
          let restoreIndex = -1;
          if (api?.storeGet) {
            try {
              const savedKey = await api.storeGet('selectedModelKey');
              if (savedKey) restoreIndex = state.allModels.findIndex(m => modelKeyOf(m) === savedKey);
            } catch {}
          }
          if (restoreIndex < 0 && prev >= 0 && prev < state.allModels.length) restoreIndex = prev;
          if (restoreIndex >= 0) {
            selectModel(restoreIndex);
            dom.modelSelect.value = restoreIndex;
          }
          dom.modelSelect.onchange = (e) => selectModel(e.target.value);

          // 渲染设置面板中的模型列表
          if (state.allModels.length === 0) {
            dom.modelList.innerHTML = '<div class="empty-state">暂无模型，点击下方添加</div>';
            return;
          }

          dom.modelList.innerHTML = '';
          state.allModels.forEach((m, i) => {
            const item = document.createElement('div');
            item.className = 'model-item';

            const header = document.createElement('div');
            header.className = 'model-item-header';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'model-name';
            nameSpan.textContent = m.name || m.modelId || '未命名模型';
            nameSpan.style.flex = '1';

            const actions = document.createElement('div');
            actions.className = 'model-actions';

            // 编辑：点击展开/收起详细字段
            const editBtn = document.createElement('button');
            editBtn.className = 'model-action-btn';
            editBtn.title = '编辑';
            editBtn.textContent = '✏️';
            editBtn.addEventListener('click', () => item.classList.toggle('expanded'));

            // 删除：弹确认框
            const delBtn = document.createElement('button');
            delBtn.className = 'model-action-btn';
            delBtn.title = '删除';
            delBtn.textContent = '🗑️';
            delBtn.addEventListener('click', async () => {
              if (!await showConfirmDialog({ title: '删除模型', message: `确定删除模型「${m.name || m.modelId || i + 1}」？`, confirmText: '删除', danger: true })) return;
              try {
                await api.deleteCustomModel(i);
                await loadModels();
                showToast('模型已删除', 'success');
              } catch (err) {
                showToast('删除失败: ' + err.message, 'error');
              }
            });

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            header.appendChild(nameSpan);
            header.appendChild(actions);
            item.appendChild(header);

            // 详细字段（默认折叠，点编辑展开）
            const fieldsWrap = document.createElement('div');
            fieldsWrap.className = 'model-fields';
            const fields = [
              { key: 'name', label: '名称', type: 'text', placeholder: '如 我的GPT-4o' },
              { key: 'modelId', label: 'Model ID', type: 'text', placeholder: '如 gpt-4o' },
              { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.openai.com/v1' },
              { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
              { key: 'maxTokens', label: '最大 Token', type: 'text', placeholder: '留空=不限制，如 128000' },
            ];
            fields.forEach(f => {
              const grp = document.createElement('div');
              grp.className = 'model-field';
              const lbl = document.createElement('label');
              lbl.textContent = f.label;
              const inp = document.createElement('input');
              inp.type = f.type;
              inp.value = m[f.key] || '';
              inp.placeholder = f.placeholder;
              const modelKey = modelKeyOf(m); // 渲染时快照：数组增删重排后仍能定位同一模型
              inp.addEventListener('blur', async () => {
                // 静默保存：不重新渲染列表（避免折叠 + 输入框失焦）
                try {
                  const all = await api.getCustomModels();
                  // 按稳定 key 定位（而非渲染期下标 i），避免增删其他模型后写错对象
                  const idx = all.findIndex(x => modelKeyOf(x) === modelKey);
                  if (idx >= 0 && all[idx]) {
                    all[idx][f.key] = inp.value;
                    await api.saveCustomModels(all);
                    state.allModels[idx] = all[idx];
                    // 同步顶部下拉框选项文案（+1 跳过占位项「— 选择模型 —」）
                    const opt = dom.modelSelect.options[idx + 1];
                    if (opt) opt.textContent = all[idx].name || all[idx].modelId || `模型${idx + 1}`;
                    if (f.key === 'name') nameSpan.textContent = inp.value || all[idx].modelId || '未命名模型';
                  }
                } catch (err) {
                  debugError('保存模型字段失败:', err);
                }
              });
              grp.appendChild(lbl);
              grp.appendChild(inp);
              fieldsWrap.appendChild(grp);
            });
            item.appendChild(fieldsWrap);

            dom.modelList.appendChild(item);
          });

          debugLog('loadModels:', state.allModels.length);
        } catch (err) {
          debugError('loadModels failed:', err);
          dom.modelList.innerHTML = `<div class="empty-state error-text">加载失败: ${escapeHtml(err.message)}</div>`;
        }
      }

      // ─────────────────────────────────────────────
      // Agent 选择
      // ─────────────────────────────────────────────
      function selectAgent(agentId) {
        state.selectedAgentId = agentId || null;
        // 欢迎页网格高亮
        document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active'));
        if (agentId) {
          const card = document.querySelector(`.agent-card[data-agent="${agentId}"]`);
          if (card) card.classList.add('active');
        }
        const agent = state.presetAgents.find(a => a.id === agentId);
        if (agent) {
          dom.headerAgentName.textContent = agent.name;
          dom.headerAgentIcon.textContent = agent.icon || '🤖';
        } else {
          dom.headerAgentName.textContent = 'BizOwl';
          dom.headerAgentIcon.textContent = '🤖';
        }
        debugLog('selectAgent:', agent?.name || '默认');
      }

      async function loadAgents() {
        if (!dom.agentGrid) return; // 首页助手卡已移除；保留函数以便日后恢复
        if (!api?.listAgents) {
          dom.agentGrid.innerHTML = '<div class="empty-state">IPC API 不可用</div>';
          return;
        }
        try {
          const agents = await api.listAgents();
          state.presetAgents = Array.isArray(agents) ? agents : [];
          if (state.presetAgents.length === 0) {
            dom.agentGrid.innerHTML = '<div class="empty-state">暂无预设助手</div>';
            return;
          }
          // 欢迎页网格
          dom.agentGrid.innerHTML = '';
          state.presetAgents.forEach(a => {
            const card = document.createElement('div');
            card.className = 'agent-card';
            card.dataset.agent = a.id;
            card.addEventListener('click', () => selectAgent(a.id));

            const icon = document.createElement('div');
            icon.className = 'agent-card-icon';
            icon.textContent = a.icon || '🤖';

            const name = document.createElement('div');
            name.className = 'agent-card-name';
            name.textContent = a.name || '未命名';

            const desc = document.createElement('div');
            desc.className = 'agent-card-desc';
            const d = a.description || '';
            desc.textContent = d.length > 50 ? d.slice(0, 50) + '...' : d;

            card.appendChild(icon);
            card.appendChild(name);
            card.appendChild(desc);
            dom.agentGrid.appendChild(card);
          });

          debugLog('loadAgents:', state.presetAgents.length);
        } catch (err) {
          debugError('loadAgents failed:', err);
          dom.agentGrid.innerHTML = '<div class="empty-state">加载失败</div>';
        }
      }

      // ─────────────────────────────────────────────
      // 认证 / 登录
      // ─────────────────────────────────────────────
      async function loadAuthSession() {
        if (!api?.authGetSession) {
          renderAuthArea();
          return;
        }
        try {
          state.authSession = await api.authGetSession();
          debugLog('authSession:', state.authSession);
          renderAuthArea();
          updateLoginFooter();
        } catch (err) {
          debugError('loadAuthSession failed:', err);
          renderAuthArea();
        }
      }

      function updateLoginFooter() {
        // 侧栏底部登录状态已移除，此函数保留为空操作（兼容旧调用）
        const s = state.authSession;
        if (!s) return;
        // 可选：在设置面板内显示登录状态（由 renderAuthArea 处理）
      }

      async function renderAuthArea() {
        const s = state.authSession;
        dom.authArea.innerHTML = '';

        // 已登录 — 先验证 token，再显示用户卡片
        if (s && s.isLoggedIn) {
          // 异步验证 token 有效性（不阻塞 UI 渲染）
          verifyTokenOnRender().catch(err => debugError('verifyTokenOnRender failed:', err));

          const card = document.createElement('div');
          card.className = 'user-card';

          // 头像：优先用 URL，否则用首字母
          const avatar = document.createElement('div');
          avatar.className = 'avatar';
          const name = s.userInfo?.nickname || s.userInfo?.name || s.userInfo?.nickName || s.phone || 'U';
          if (s.userInfo?.avatarUrl) {
            const img = document.createElement('img');
            img.src = s.userInfo.avatarUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = '50%';
            img.style.objectFit = 'cover';
            avatar.appendChild(img);
          } else {
            avatar.textContent = String(name).charAt(0).toUpperCase();
          }

          const info = document.createElement('div');
          info.className = 'user-card-info';
          const nameEl = document.createElement('div');
          nameEl.className = 'user-card-name';
          nameEl.textContent = name;
          const phoneEl = document.createElement('div');
          phoneEl.className = 'user-card-phone';
          // 脱敏手机号：138****1234
          const rawPhone = s.userInfo?.phone || s.phone || '';
          const masked = rawPhone.length >= 7
            ? rawPhone.slice(0, 3) + '****' + rawPhone.slice(-4)
            : (rawPhone || (s.hasToken ? 'Token 认证' : '已登录'));
          phoneEl.textContent = masked;
          info.appendChild(nameEl);
          info.appendChild(phoneEl);

          card.appendChild(avatar);
          card.appendChild(info);
          dom.authArea.appendChild(card);

          // 积分信息
          const creditsCard = document.createElement('div');
          creditsCard.className = 'info-banner';
          creditsCard.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;margin-bottom:8px;';
          creditsCard.innerHTML = `
            <span style="font-size:13px;color:var(--ink-muted);">剩余积分</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span id="creditsBalance" style="font-size:17px;font-weight:600;color:var(--ink);">加载中...</span>
              <button class="icon-btn" id="refreshCreditsBtn" title="刷新积分" style="color:var(--ink-faint);width:28px;height:28px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
          `;
          dom.authArea.appendChild(creditsCard);

          // 异步获取积分
          async function refreshCredits() {
            const balanceEl = document.getElementById('creditsBalance');
            if (!balanceEl) return;
            balanceEl.textContent = '...';
            try {
              const info = await api.authGetCreditsInfo();
              if (info && typeof info.balance === 'number') {
                balanceEl.textContent = info.balance + ' 积分';
                // 积分为 0 时，额外验证 token 是否真的有效（可能是 token 失效导致积分查询返回 0）
                if (info.balance === 0) {
                  balanceEl.style.color = 'var(--warning)';
                  balanceEl.textContent = '0 积分';
                  await checkAndAutoLogout(); // token 失效会自动登出并提示；仍有效则确认是真实 0 分
                } else {
                  balanceEl.style.color = 'var(--ink)';
                }
              } else {
                // info === null → getCreditsInfo 抛了异常（IPC 内部 catch 返回 null）
                // 可能是 token 失效 → 验证一下
                balanceEl.textContent = '验证中...';
                await checkAndAutoLogout();
              }
            } catch (err) {
              const msg = err.message || '';
              balanceEl.textContent = '获取失败';
              if (msg.includes('401') || msg.includes('403') || msg.includes('40102') || msg.includes('过期') || msg.includes('失效')) {
                await checkAndAutoLogout();
              }
            }
          }

          // 打开设置页时主动验证 token 有效性
          async function verifyTokenOnRender() {
            try {
              const verify = await api.authVerify();
              if (!verify.valid) {
                showToast('登录信息已失效，请重新登录', 'error');
                await api.authLogout();
                await loadAuthSession();
              } else if (verify.refreshed) {
                showToast('Token 已自动续期', 'success');
                await loadAuthSession();
              }
            } catch (err) {
              debugError('token 验证异常:', err);
            }
          }

          // 检查 token 是否失效，失效则自动登出
          async function checkAndAutoLogout() {
            try {
              const verify = await api.authVerify();
              if (!verify.valid) {
                showToast('登录信息已失效，请重新登录', 'error');
                await api.authLogout();
                await loadAuthSession();
                return true; // 已登出
              }
            } catch {}
            return false; // 仍然有效
          }
          refreshCreditsFn = refreshCredits; // 暴露给 openSettingsPanel，进入设置页时自动刷新
          refreshCredits();
          document.getElementById('refreshCreditsBtn')?.addEventListener('click', refreshCredits);

          // 自动刷新 Token 开关（仅扫码/验证码登录用户可见，Token 手动输入不显示）
          // hasRefreshToken：主进程返回的布尔值，表示 auth.json 里是否有 refreshToken
          // （手动配置 token 的方式没有 refreshToken，无法自动续期）
          const isManualToken = s.hasToken && !s.hasRefreshToken && !s.userInfo?.phone && !s.phone;
          if (!isManualToken) {
            const autoRefreshRow = document.createElement('div');
            autoRefreshRow.className = 'info-banner';
            autoRefreshRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;margin-bottom:8px;';
            autoRefreshRow.innerHTML = `
              <div>
                <div style="font-size:13px;color:var(--ink);font-weight:500;">保持在线</div>
                <div style="font-size:11px;color:var(--ink-faint);">自动刷新 Token，避免频繁登录</div>
              </div>
              <label style="position:relative;display:inline-block;width:44px;height:26px;cursor:pointer;">
                <input type="checkbox" id="autoRefreshToggle" ${(s.autoRefresh && s.hasRefreshToken) ? 'checked' : ''} style="opacity:0;width:0;height:0;">
                <span class="toggle-slider" style="position:absolute;inset:0;background:${(s.autoRefresh && s.hasRefreshToken) ? '#34C759' : '#E5E5EA'};border-radius:9999px;transition:0.3s;">
                  <span style="position:absolute;top:2px;left:${(s.autoRefresh && s.hasRefreshToken) ? '20px' : '2px'};width:22px;height:22px;background:#fff;border-radius:50%;transition:0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
                </span>
              </label>
            `;
            dom.authArea.appendChild(autoRefreshRow);

            const toggle = document.getElementById('autoRefreshToggle');
            const slider = autoRefreshRow.querySelector('.toggle-slider');
            const knob = slider.querySelector('span:last-child');
            toggle.addEventListener('change', async () => {
              const enabled = toggle.checked;
              // 开启前校验：没有 refreshToken（手动 token 配置）不支持保持在线
              if (enabled && !s.hasRefreshToken) {
                // 回滚开关
                toggle.checked = false;
                slider.style.background = '#E5E5EA';
                knob.style.left = '2px';
                showToast('当前登录方式不支持保持在线，请使用扫码或手机验证码登录', 'error', 4000);
                return;
              }
              slider.style.background = enabled ? '#34C759' : '#E5E5EA';
              knob.style.left = enabled ? '20px' : '2px';
              try {
                await api.authSetAutoRefresh(enabled);
                showToast(enabled ? '已开启保持在线' : '已关闭保持在线', 'success');
              } catch (err) {
                showToast('设置失败: ' + err.message, 'error');
                // 回滚
                toggle.checked = !enabled;
                slider.style.background = !enabled ? '#34C759' : '#E5E5EA';
                knob.style.left = !enabled ? '20px' : '2px';
              }
            });
          }

          const logoutBtn = document.createElement('button');
          logoutBtn.className = 'btn btn-danger btn-block';
          logoutBtn.textContent = '退出登录';
          logoutBtn.addEventListener('click', async () => {
            try {
              logoutBtn.disabled = true;
              logoutBtn.textContent = '退出中...';
              await api.authLogout();
              await loadAuthSession();
              showToast('已退出登录', 'success');
            } catch (err) {
              showToast('退出失败: ' + err.message, 'error');
              logoutBtn.disabled = false;
              logoutBtn.textContent = '退出登录';
            }
          });
          dom.authArea.appendChild(logoutBtn);
          return;
        }

        // 未登录 — 显示 Tab 切换：扫码登录 / 手机号登录 / Token 设置
        const tabs = document.createElement('div');
        tabs.className = 'auth-tabs';

        const tabQr = document.createElement('button');
        tabQr.className = 'auth-tab active';
        tabQr.textContent = '扫码登录';

        const tabPhone = document.createElement('button');
        tabPhone.className = 'auth-tab';
        tabPhone.textContent = '手机号登录';

        const tabToken = document.createElement('button');
        tabToken.className = 'auth-tab';
        tabToken.textContent = 'Token';

        tabs.appendChild(tabQr);
        tabs.appendChild(tabPhone);
        tabs.appendChild(tabToken);
        dom.authArea.appendChild(tabs);

        // ── 扫码登录面板（默认显示）──
        const qrPanel = document.createElement('div');
        qrPanel.className = 'auth-content active';
        qrPanel.style.flexDirection = 'column';
        qrPanel.style.alignItems = 'center';
        qrPanel.style.padding = '8px 0';

        const qrHint = document.createElement('div');
        qrHint.className = 'info-banner';
        qrHint.style.textAlign = 'center';
        qrHint.textContent = '使用数据源平台 App 扫描下方二维码登录';
        qrPanel.appendChild(qrHint);

        const qrImg = document.createElement('img');
        qrImg.style.cssText = 'width:200px;height:200px;border-radius:12px;border:0.5px solid var(--hairline);margin:12px 0;';
        qrImg.alt = '登录二维码';
        qrPanel.appendChild(qrImg);

        const qrStatus = document.createElement('div');
        qrStatus.style.cssText = 'font-size:13px;color:var(--ink-muted);text-align:center;min-height:20px;';
        qrStatus.textContent = '正在生成二维码...';
        qrPanel.appendChild(qrStatus);

        const refreshQrBtn = document.createElement('button');
        refreshQrBtn.className = 'btn btn-secondary btn-sm';
        refreshQrBtn.textContent = '刷新二维码';
        refreshQrBtn.style.marginTop = '8px';
        refreshQrBtn.style.display = 'none';
        qrPanel.appendChild(refreshQrBtn);

        dom.authArea.appendChild(qrPanel);

        // 扫码登录逻辑（使用模块级 _qrPollTimer / _qrSessionId）
        const QR_POLL_INTERVAL = 5000;
        const QR_EXPIRE_TIMEOUT = 120000;

        async function startQrLogin() {
          qrStatus.textContent = '正在生成二维码...';
          qrImg.style.display = 'none';
          refreshQrBtn.style.display = 'none';
          if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
          try {
            const result = await api.authGenerateQrLogin();
            _qrSessionId = result.sessionId;
            qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(result.qrCodeUrl);
            qrImg.style.display = '';
            qrStatus.textContent = '请使用 App 扫描二维码';
            qrStatus.style.color = 'var(--ink-muted)';
            // 开始轮询
            _qrPollTimer = setInterval(pollQrStatus, QR_POLL_INTERVAL);
            // 2 分钟后自动刷新（跟踪定时器，stopQrPolling 时清理，避免悬挂）
            if (_qrExpireTimer) clearTimeout(_qrExpireTimer);
            _qrExpireTimer = setTimeout(() => {
              _qrExpireTimer = null;
              if (_qrPollTimer && _qrSessionId === result.sessionId) {
                if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
                qrStatus.textContent = '二维码已过期，正在刷新...';
                startQrLogin();
              }
            }, QR_EXPIRE_TIMEOUT);
          } catch (err) {
            qrStatus.textContent = '生成二维码失败: ' + err.message;
            qrStatus.style.color = 'var(--danger)';
            refreshQrBtn.style.display = '';
          }
        }

        let pollErrorCount = 0;
        async function pollQrStatus() {
          if (!_qrSessionId) return;
          try {
            const result = await api.authGetQrLoginStatus(_qrSessionId);
            pollErrorCount = 0; // 成功重置错误计数
            if (result.status === 'scanned') {
              qrStatus.textContent = '✓ 已扫描，请在手机上确认';
              qrStatus.style.color = 'var(--accent)';
            } else if (result.status === 'confirmed') {
              stopQrPolling();
              qrStatus.textContent = '✓ 登录成功！';
              qrStatus.style.color = 'var(--success)';
              await loadAuthSession();
              showToast('扫码登录成功', 'success');
            }
          } catch (err) {
            pollErrorCount++;
            // 连续 3 次出错 → 二维码可能已过期，自动刷新
            if (pollErrorCount >= 3) {
              console.warn('[QR] 连续轮询失败，自动刷新二维码');
              if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
              pollErrorCount = 0;
              qrStatus.textContent = '二维码已过期，正在刷新...';
              startQrLogin();
            }
          }
        }

        refreshQrBtn.addEventListener('click', startQrLogin);

        // 自动开始扫码登录（仅当设置面板可见时）
        function startQrLoginIfVisible() {
          if (dom.settingsPanel?.classList.contains('visible')) {
            startQrLogin();
          }
        }
        startQrLoginIfVisible();

        // 手机号登录面板
        const phonePanel = document.createElement('div');
        phonePanel.className = 'auth-content';

        const intlGroup = document.createElement('div');
        intlGroup.className = 'form-group';
        const intlLabel = document.createElement('label');
        intlLabel.textContent = '国际区号';
        const intlInput = document.createElement('input');
        intlInput.type = 'text';
        intlInput.value = '86';
        intlInput.placeholder = '如 86 (中国大陆)';
        intlGroup.appendChild(intlLabel);
        intlGroup.appendChild(intlInput);
        phonePanel.appendChild(intlGroup);

        const phoneGroup = document.createElement('div');
        phoneGroup.className = 'form-group';
        const phoneLabel = document.createElement('label');
        phoneLabel.textContent = '手机号';
        const phoneInput = document.createElement('input');
        phoneInput.type = 'tel';
        phoneInput.placeholder = '请输入手机号';
        phoneGroup.appendChild(phoneLabel);
        phoneGroup.appendChild(phoneInput);
        phonePanel.appendChild(phoneGroup);

        const codeGroup = document.createElement('div');
        codeGroup.className = 'form-group';
        codeGroup.style.display = 'flex';
        codeGroup.style.gap = '8px';
        codeGroup.style.alignItems = 'flex-end';
        const codeSub = document.createElement('div');
        codeSub.style.flex = '1';
        const codeLabel = document.createElement('label');
        codeLabel.textContent = '验证码';
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.placeholder = '验证码';
        codeSub.appendChild(codeLabel);
        codeSub.appendChild(codeInput);
        const sendCodeBtn = document.createElement('button');
        sendCodeBtn.className = 'btn btn-secondary btn-sm';
        sendCodeBtn.textContent = '获取验证码';
        sendCodeBtn.style.height = '30px';
        sendCodeBtn.style.marginBottom = '0';
        codeGroup.appendChild(codeSub);
        codeGroup.appendChild(sendCodeBtn);
        phonePanel.appendChild(codeGroup);

        const loginBtn = document.createElement('button');
        loginBtn.className = 'btn btn-primary btn-block';
        loginBtn.textContent = '登录';
        loginBtn.style.marginTop = '10px';
        phonePanel.appendChild(loginBtn);

        let countdown = 0;
        let countdownTimer = null;

        // 极验 GeeTest4 人机验证
        const GEETEST_CAPTCHA_ID = 'fea2dfff091251c32537254dc869267d';
        const GEETEST_SCRIPT_SRC = 'https://qcc-static.qcc.com/resources/web/js/gt4.js';
        let geetestInstance = null;
        let geetestInitPromise = null;

        function initGeetest() {
          if (geetestInitPromise) return geetestInitPromise;
          geetestInitPromise = new Promise((resolve, reject) => {
            const doInit = () => {
              if (!window.initGeetest4) { reject(new Error('人机验证组件不可用')); return; }
              window.initGeetest4({
                captchaId: GEETEST_CAPTCHA_ID,
                product: 'bind',
                https: true,
              }, (gt) => {
                geetestInstance = gt;
                resolve(gt);
              });
            };
            // 确保 gt4.js 已加载
            if (window.initGeetest4) { doInit(); return; }
            const existing = document.querySelector(`script[src="${GEETEST_SCRIPT_SRC}"]`);
            if (existing) {
              existing.addEventListener('load', doInit, { once: true });
              existing.addEventListener('error', () => reject(new Error('人机验证组件加载失败')), { once: true });
              return;
            }
            const s = document.createElement('script');
            s.src = GEETEST_SCRIPT_SRC;
            s.async = true;
            s.onload = doInit;
            s.onerror = () => reject(new Error('人机验证组件加载失败'));
            document.head.appendChild(s);
          });
          return geetestInitPromise;
        }

        // 初始化极验（页面加载时预初始化）
        initGeetest().catch(err => console.warn('[Geetest] 初始化失败:', err.message));

        function showGeetestCaptcha() {
          return new Promise(async (resolve, reject) => {
            try {
              const gt = await initGeetest();
              if (!gt) { reject(new Error('验证组件未就绪，请稍后重试')); return; }
              // 注册本次验证的回调
              gt.onSuccess(() => {
                const result = gt.getValidate();
                resolve(result);
              }).onClose(() => {
                reject(new Error('captcha_closed'));
              }).onError(() => {
                reject(new Error('人机验证失败，请重试'));
              });
              // 弹出验证窗口
              gt.reset();
              gt.showBox();
            } catch (err) {
              reject(err);
            }
          });
        }

        sendCodeBtn.addEventListener('click', async () => {
          const phone = phoneInput.value.trim();
          const intl = intlInput.value.trim() || '86';
          if (!phone) { showToast('请输入手机号', 'error'); return; }
          try {
            sendCodeBtn.disabled = true;
            sendCodeBtn.textContent = '验证中...';

            // 先完成极验人机验证
            let captcha;
            try {
              captcha = await showGeetestCaptcha();
            } catch (err) {
              if (err.message === 'captcha_closed') {
                sendCodeBtn.disabled = false;
                sendCodeBtn.textContent = '获取验证码';
                return; // 用户关闭验证码，静默返回
              }
              throw err;
            }

            sendCodeBtn.textContent = '发送中...';
            await api.authSendCode(phone, intl, captcha);
            showToast('验证码已发送', 'success');
            countdown = 60;
            countdownTimer = setInterval(() => {
              if (countdown <= 0) {
                clearInterval(countdownTimer);
                sendCodeBtn.disabled = false;
                sendCodeBtn.textContent = '获取验证码';
              } else {
                sendCodeBtn.textContent = countdown + 's';
                countdown--;
              }
            }, 1000);
          } catch (err) {
            showToast('发送失败: ' + err.message, 'error');
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = '获取验证码';
          }
        });

        loginBtn.addEventListener('click', async () => {
          const phone = phoneInput.value.trim();
          const code = codeInput.value.trim();
          const intl = intlInput.value.trim() || '86';
          if (!phone) { showToast('请输入手机号', 'error'); return; }
          if (!code) { showToast('请输入验证码', 'error'); return; }
          try {
            loginBtn.disabled = true;
            loginBtn.textContent = '登录中...';
            await api.authLogin(phone, code, intl);
            await loadAuthSession();
            showToast('登录成功', 'success');
          } catch (err) {
            showToast('登录失败: ' + err.message, 'error');
            loginBtn.disabled = false;
            loginBtn.textContent = '登录';
          }
        });

        dom.authArea.appendChild(phonePanel);

        // Token 设置面板
        const tokenPanel = document.createElement('div');
        tokenPanel.className = 'auth-content';

        const tokenInfo = document.createElement('div');
        tokenInfo.className = 'info-banner';
        tokenInfo.textContent = '高级选项：直接粘贴 accessToken 和 API Base URL。适用于已通过其他方式获取 token 的场景。';
        tokenPanel.appendChild(tokenInfo);

        const baseUrlGroup = document.createElement('div');
        baseUrlGroup.className = 'form-group';
        const baseUrlLabel = document.createElement('label');
        baseUrlLabel.textContent = 'API Base URL';
        const baseUrlInput = document.createElement('input');
        baseUrlInput.type = 'text';
        baseUrlInput.value = s?.apiBaseUrl || '';
        baseUrlInput.placeholder = 'https://api.qcc.com/open';
        baseUrlGroup.appendChild(baseUrlLabel);
        baseUrlGroup.appendChild(baseUrlInput);
        tokenPanel.appendChild(baseUrlGroup);

        const tokenGroup = document.createElement('div');
        tokenGroup.className = 'form-group';
        const tokenLabel = document.createElement('label');
        tokenLabel.textContent = 'Access Token';
        const tokenInput = document.createElement('textarea');
        tokenInput.placeholder = '粘贴 accessToken...';
        tokenInput.rows = 3;
        tokenGroup.appendChild(tokenLabel);
        tokenGroup.appendChild(tokenInput);
        tokenPanel.appendChild(tokenGroup);

        const setTokenBtn = document.createElement('button');
        setTokenBtn.className = 'btn btn-primary btn-block';
        setTokenBtn.textContent = '保存 Token';
        setTokenBtn.style.marginTop = '8px';
        setTokenBtn.addEventListener('click', async () => {
          const token = tokenInput.value.trim();
          const baseUrl = baseUrlInput.value.trim();
          if (!token) { showToast('请输入 Token', 'error'); return; }
          try {
            setTokenBtn.disabled = true;
            setTokenBtn.textContent = '保存并验证中...';
            // 1. 先保存 Token（临时）
            await api.authSetToken(token, baseUrl);
            // 2. 验证 Token 有效性
            try {
              const verifyResult = await api.authVerify();
              if (verifyResult.valid) {
                // ✅ 验证通过 → 走登录成功流程
                await loadAuthSession();
                showToast('Token 验证通过', 'success');
              } else {
                // ❌ 验证失败 → 登出清除 token，不走成功流程
                await api.authLogout();
                state.authSession = null;
                renderAuthArea();
                showToast('Token 无效: ' + (verifyResult.reason || '请检查 Token 是否正确'), 'error');
                setTokenBtn.disabled = false;
                setTokenBtn.textContent = '保存 Token';
              }
            } catch (verifyErr) {
              // ❌ 验证异常 → 同样清除
              await api.authLogout();
              state.authSession = null;
              renderAuthArea();
              showToast('Token 验证失败: ' + verifyErr.message, 'error');
              setTokenBtn.disabled = false;
              setTokenBtn.textContent = '保存 Token';
            }
          } catch (err) {
            showToast('保存失败: ' + err.message, 'error');
            setTokenBtn.disabled = false;
            setTokenBtn.textContent = '保存 Token';
          }
        });
        tokenPanel.appendChild(setTokenBtn);

        dom.authArea.appendChild(tokenPanel);

        // Tab 切换
        tabQr.addEventListener('click', () => {
          tabQr.classList.add('active');
          tabPhone.classList.remove('active');
          tabToken.classList.remove('active');
          qrPanel.classList.add('active');
          phonePanel.classList.remove('active');
          tokenPanel.classList.remove('active');
          // 切回扫码 tab → 如果没有在轮询则重新启动
          if (!_qrPollTimer) {
            startQrLogin();
          }
        });
        tabPhone.addEventListener('click', () => {
          tabPhone.classList.add('active');
          tabQr.classList.remove('active');
          tabToken.classList.remove('active');
          phonePanel.classList.add('active');
          qrPanel.classList.remove('active');
          tokenPanel.classList.remove('active');
          stopQrPolling();
        });
        tabToken.addEventListener('click', () => {
          tabToken.classList.add('active');
          tabPhone.classList.remove('active');
          tabQr.classList.remove('active');
          tokenPanel.classList.add('active');
          phonePanel.classList.remove('active');
          qrPanel.classList.remove('active');
          stopQrPolling();
        });
      }

      // ─────────────────────────────────────────────
      // 技能列表（加载到侧栏技能浮层）
      // ─────────────────────────────────────────────
      async function loadSkills() {
        if (!dom.skillsList) return;
        if (!api?.listSkills) {
          dom.skillsList.innerHTML = '<div class="empty-state">IPC API 不可用</div>';
          return;
        }
        try {
          const skills = await api.listSkills();
          const list = Array.isArray(skills) ? skills : [];
          if (list.length === 0) {
            dom.skillsList.innerHTML = '<div class="empty-state">暂无技能</div>';
            return;
          }
          dom.skillsList.innerHTML = '';
          list.forEach(sk => {
            const item = document.createElement('div');
            item.className = 'skill-item';

            const skillId = sk.name || sk.id || '';

            const nameRow = document.createElement('div');
            nameRow.className = 'skill-item-row';

            const name = document.createElement('div');
            name.className = 'skill-item-name';
            name.textContent = skillId || '未命名技能';
            name.style.flex = '1';

            const actions = document.createElement('div');
            actions.className = 'skill-item-actions';

            // 导出按钮
            const exportBtn = document.createElement('button');
            exportBtn.className = 'skill-action-btn';
            exportBtn.title = '导出技能';
            exportBtn.textContent = '📥';
            exportBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (!api?.exportSkill) { showToast('IPC API 不可用', 'error'); return; }
              try {
                const result = await api.exportSkill(skillId);
                if (result && result.success) {
                  showToast('已导出: ' + (result.path || skillId), 'success');
                } else if (result && !result.success && result.error) {
                  showToast('导出失败: ' + result.error, 'error');
                }
              } catch (err) {
                showToast('导出失败: ' + err.message, 'error');
              }
            });
            actions.appendChild(exportBtn);

            // 删除按钮
            const delBtn = document.createElement('button');
            delBtn.className = 'skill-action-btn danger';
            delBtn.title = '删除技能';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (!api?.deleteSkill) { showToast('IPC API 不可用', 'error'); return; }
              if (!await showConfirmDialog({ title: '删除技能', message: `确定删除技能「${skillId}」？`, confirmText: '删除', danger: true })) return;
              try {
                await api.deleteSkill(skillId);
                showToast('已删除: ' + skillId, 'success');
                await loadSkills();
              } catch (err) {
                showToast('删除失败: ' + err.message, 'error');
              }
            });
            actions.appendChild(delBtn);

            nameRow.appendChild(name);
            nameRow.appendChild(actions);

            const desc = document.createElement('div');
            desc.className = 'skill-item-desc';
            const d = sk.description || sk.desc || '';
            desc.textContent = d.length > 60 ? d.slice(0, 60) + '...' : d;

            item.appendChild(nameRow);
            item.appendChild(desc);
            dom.skillsList.appendChild(item);
          });
          debugLog('loadSkills:', list.length);
        } catch (err) {
          debugError('loadSkills failed:', err);
          dom.skillsList.innerHTML = '<div class="empty-state">加载失败</div>';
        }
      }

      // ─── 记忆管理（OptMem）───
      async function loadMemoryProfile() {
        const editor = document.getElementById('userMdEditor');
        if (!editor) return;
        try {
          const content = await api.memoryGetUserMd();
          editor.value = content || '';
        } catch (e) {
          editor.value = '# 加载失败';
        }
      }

      async function saveMemoryProfile() {
        const editor = document.getElementById('userMdEditor');
        if (!editor) return;
        try {
          await api.memorySetUserMd(editor.value);
          showToast('用户画像已保存', 'success');
        } catch (e) {
          showToast('保存失败: ' + e.message, 'error');
        }
      }

      async function loadMemoryLog() {
        const statsEl = document.getElementById('memoryStats');
        const listEl = document.getElementById('memoryLogList');
        const filterInput = document.getElementById('memoryFilterInput');
        if (!statsEl || !listEl) return;
        // 清空过滤框（避免新加载的数据被旧过滤条件隐藏）
        if (filterInput) filterInput.value = '';
        // 清除 stats 的 baseText 缓存（重新加载时数据已变）
        delete statsEl.dataset.baseText;
        try {
          const stats = await api.memoryGetStats();
          const total = stats.totalMemories || 0;
          const pending = stats.pendingCompressions || 0;
          statsEl.innerHTML = `<span class="memory-stat-item">📋 ${total} 条记忆</span>` +
            (pending > 0 ? `<span class="memory-stat-item">⏳ ${pending} 待压缩</span>` : '') +
            `<span class="memory-stat-item">⚙️ WAKE_LINES=${stats.knobs?.WAKE_LINES || 96}</span>`;
          const all = await api.memoryGetAll();
          if (!all.memories || all.memories.length === 0) {
            listEl.innerHTML = '<div class="empty-state">暂无记忆。BizOwl 会在对话中自动学习。</div>';
            updateMemorySelectionUI(0, 0);
            return;
          }
          listEl.innerHTML = '';
          // 倒序显示（最新的在上）
          for (let i = all.memories.length - 1; i >= 0; i--) {
            const m = all.memories[i];
            const item = document.createElement('div');
            item.className = 'memory-log-item';
            item.dataset.memId = m.id;
            item.innerHTML = `<input type="checkbox" class="memory-log-checkbox" data-mem-id="${m.id}">` +
              `<span class="memory-log-id">#${escapeHtml(m.id)}</span>` +
              `<span class="memory-log-date">${escapeHtml(m.date)}</span>` +
              `<span class="memory-log-text">${escapeHtml(m.text)}</span>`;
            listEl.appendChild(item);
          }
          // 初始化选择状态
          updateMemorySelectionUI(0, all.memories.length);
          bindMemoryCheckboxEvents();
        } catch (e) {
          listEl.innerHTML = '<div class="empty-state">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
      }

      // ─── 记忆批量选择 + 删除 ───
      function bindMemoryCheckboxEvents() {
        // 单条 checkbox 变化
        document.querySelectorAll('.memory-log-checkbox').forEach(cb => {
          cb.addEventListener('change', () => {
            const item = cb.closest('.memory-log-item');
            if (item) item.classList.toggle('selected', cb.checked);
            updateMemorySelectionCount();
          });
        });
        // 全选 checkbox（仅影响当前可见条目）
        const selectAll = document.getElementById('memorySelectAll');
        if (selectAll) {
          selectAll.onchange = () => {
            const checked = selectAll.checked;
            document.querySelectorAll('.memory-log-checkbox').forEach(cb => {
              const item = cb.closest('.memory-log-item');
              if (!item || item.style.display === 'none') return; // 跳过被过滤隐藏的
              cb.checked = checked;
              if (item) item.classList.toggle('selected', checked);
            });
            updateMemorySelectionCount();
          };
        }
        // 删除按钮
        const deleteBtn = document.getElementById('memoryDeleteBtn');
        if (deleteBtn) {
          deleteBtn.onclick = deleteSelectedMemories;
        }
      }

      function getSelectedMemoryIds() {
        return Array.from(document.querySelectorAll('.memory-log-checkbox:checked'))
          .map(cb => parseInt(cb.dataset.memId, 10))
          .filter(id => !isNaN(id));
      }

      function updateMemorySelectionCount() {
        const ids = getSelectedMemoryIds();
        const countEl = document.getElementById('memorySelectedCount');
        const deleteBtn = document.getElementById('memoryDeleteBtn');
        const selectAll = document.getElementById('memorySelectAll');
        if (countEl) countEl.textContent = ids.length > 0 ? `已选 ${ids.length} 条` : '';
        if (deleteBtn) deleteBtn.disabled = ids.length === 0;
        // 同步全选 checkbox 状态（仅与当前可见的条目比较）
        const visibleBoxes = document.querySelectorAll('.memory-log-checkbox');
        const visibleChecked = Array.from(visibleBoxes).filter(cb => {
          const item = cb.closest('.memory-log-item');
          return cb.checked && item && item.style.display !== 'none';
        });
        const visibleTotal = Array.from(visibleBoxes).filter(cb => {
          const item = cb.closest('.memory-log-item');
          return item && item.style.display !== 'none';
        }).length;
        if (selectAll) {
          selectAll.checked = visibleTotal > 0 && visibleChecked.length === visibleTotal;
        }
      }

      function updateMemorySelectionUI(selected, total) {
        const countEl = document.getElementById('memorySelectedCount');
        const deleteBtn = document.getElementById('memoryDeleteBtn');
        const selectAll = document.getElementById('memorySelectAll');
        if (countEl) countEl.textContent = '';
        if (deleteBtn) deleteBtn.disabled = true;
        if (selectAll) selectAll.checked = false;
      }

      async function deleteSelectedMemories() {
        const ids = getSelectedMemoryIds();
        if (ids.length === 0) return;
        if (!await showConfirmDialog({ title: '删除记忆', message: `确定删除选中的 ${ids.length} 条记忆？此操作不可撤销。`, confirmText: '删除', danger: true })) return;

        const deleteBtn = document.getElementById('memoryDeleteBtn');
        if (deleteBtn) {
          deleteBtn.disabled = true;
          deleteBtn.textContent = '删除中…';
        }
        try {
          const result = await api.memoryDeleteMany(ids);
          if (result.ok) {
            showToast(`已删除 ${result.deleted} 条记忆`, 'success');
            await loadMemoryLog(); // 刷新列表
          } else {
            showToast('删除失败: ' + (result.error || '未知'), 'error');
          }
        } catch (e) {
          showToast('删除失败: ' + e.message, 'error');
        } finally {
          if (deleteBtn) {
            deleteBtn.textContent = '删除选中';
            deleteBtn.disabled = false;
          }
        }
      }

      async function searchMemories(query) {
        // 客户端过滤：在已加载的记忆列表中按关键词过滤显示
        const items = document.querySelectorAll('#memoryLogList .memory-log-item');
        const q = (query || '').trim().toLowerCase();
        let visibleCount = 0;
        items.forEach(item => {
          if (!q) {
            item.style.display = '';
            visibleCount++;
          } else {
            const text = (item.textContent || '').toLowerCase();
            const match = text.includes(q);
            item.style.display = match ? '' : 'none';
            if (match) visibleCount++;
          }
        });
        // 过滤后更新全选 checkbox 状态
        updateMemorySelectionCount();
        // 更新统计显示
        const statsEl = document.getElementById('memoryStats');
        if (statsEl && q) {
          const existing = statsEl.dataset.baseText || statsEl.textContent;
          if (!statsEl.dataset.baseText) statsEl.dataset.baseText = existing;
          statsEl.textContent = `${existing}  ·  筛选: ${visibleCount} 条`;
        } else if (statsEl && statsEl.dataset.baseText) {
          statsEl.textContent = statsEl.dataset.baseText;
        }
      }

      // escapeHtml 已在 utils.js 中统一定义（含单引号转义），此处不再重复定义

      // 记忆 tab 切换（立即绑定事件 + 设置面板打开时加载数据）
      function initMemoryTabs() {
        const tabs = document.querySelectorAll('.memory-tab');
        tabs.forEach(tab => {
          tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const mtab = tab.dataset.mtab;
            document.querySelectorAll('.memory-panel').forEach(p => p.style.display = 'none');
            const panel = document.getElementById('mtab-' + mtab);
            if (panel) panel.style.display = '';
            if (mtab === 'profile') loadMemoryProfile();
            if (mtab === 'log') loadMemoryLog();
          });
        });

        const saveBtn = document.getElementById('saveUserMdBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveMemoryProfile);

        const filterInput = document.getElementById('memoryFilterInput');
        if (filterInput) {
          let debounce;
          filterInput.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => searchMemories(filterInput.value), 200);
          });
        }
      }

      // 刷新当前激活的记忆 tab 数据
      function refreshActiveMemoryTab() {
        const activeTab = document.querySelector('.memory-tab.active');
        if (!activeTab) { loadMemoryProfile(); return; }
        const mtab = activeTab.dataset.mtab;
        if (mtab === 'profile') loadMemoryProfile();
        if (mtab === 'log') loadMemoryLog();
      }

      // 设置面板打开时刷新当前激活的记忆 tab
      function initMemoryOnSettingsOpen() {
        const observer = new MutationObserver(() => {
          const panel = document.getElementById('settingsPanel');
          if (panel && panel.classList.contains('visible')) {
            refreshActiveMemoryTab();
          }
        });
        const panel = document.getElementById('settingsPanel');
        if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
      }

      // 立即绑定 tab 事件 + 延迟初始化面板监听
      setTimeout(() => {
        initMemoryTabs();
        initMemoryOnSettingsOpen();
      }, 500);

      // ─────────────────────────────────────────────
      // 外部搜索源配置（Tavily / Serper / SearXNG）
      // ─────────────────────────────────────────────
      function initExternalSearchConfig() {
        const els = {
          tavilyEnabled: document.getElementById('tavilyEnabled'),
          tavilyApiKey: document.getElementById('tavilyApiKey'),
          serperEnabled: document.getElementById('serperEnabled'),
          serperApiKey: document.getElementById('serperApiKey'),
          searxngEnabled: document.getElementById('searxngEnabled'),
          searxngUrl: document.getElementById('searxngUrl'),
          saveBtn: document.getElementById('saveExternalSearchBtn'),
        };

        // 有任何一个元素不存在 → 静默跳过（设置面板还没渲染好）
        if (!els.saveBtn) return;

        // 加载已保存的配置
        async function loadConfig() {
          try {
            const [tavily, serper, searxng] = await Promise.all([
              api?.storeGet?.('tavily'),
              api?.storeGet?.('serper'),
              api?.storeGet?.('searxng'),
            ]);
            if (tavily && typeof tavily === 'object') {
              els.tavilyEnabled.checked = !!tavily.enabled;
              els.tavilyApiKey.value = tavily.apiKey || '';
            }
            if (serper && typeof serper === 'object') {
              els.serperEnabled.checked = !!serper.enabled;
              els.serperApiKey.value = serper.apiKey || '';
            }
            if (searxng && typeof searxng === 'object') {
              els.searxngEnabled.checked = !!searxng.enabled;
              els.searxngUrl.value = searxng.url || '';
            }
          } catch (e) {
            console.warn('加载外部搜索配置失败:', e);
          }
        }

        // 保存配置
        async function saveConfig() {
          const tavily = { enabled: els.tavilyEnabled.checked, apiKey: els.tavilyApiKey.value.trim() };
          const serper = { enabled: els.serperEnabled.checked, apiKey: els.serperApiKey.value.trim() };
          const searxng = { enabled: els.searxngEnabled.checked, url: els.searxngUrl.value.trim() };

          try {
            await Promise.all([
              api?.storeSet?.('tavily', tavily),
              api?.storeSet?.('serper', serper),
              api?.storeSet?.('searxng', searxng),
            ]);
            els.saveBtn.textContent = '✅ 已保存';
            setTimeout(() => { els.saveBtn.textContent = '保存配置'; }, 2000);
          } catch (e) {
            els.saveBtn.textContent = '❌ 保存失败';
            setTimeout(() => { els.saveBtn.textContent = '保存配置'; }, 2000);
            console.error('保存外部搜索配置失败:', e);
          }
        }

        els.saveBtn.addEventListener('click', saveConfig);
        loadConfig();
      }

      // ─────────────────────────────────────────────
      // 超时配置（agent-loop 流式响应超时，单位：秒）
      // 默认值须与 src/agent/agent-loop.js 的 TIMEOUT_CONFIG（毫秒）保持同步
      // ─────────────────────────────────────────────
      const DEFAULT_TIMEOUT_SEC = {
        firstByteNormal: 90,
        firstByteResearch: 300,
        streamIdleNormal: 60,
        streamIdleResearch: 1800,
      };

      function initTimeoutConfig() {
        // [input元素id, store字段名] 映射
        const fields = [
          ['timeoutFirstByteNormal', 'firstByteNormal'],
          ['timeoutFirstByteResearch', 'firstByteResearch'],
          ['timeoutStreamIdleNormal', 'streamIdleNormal'],
          ['timeoutStreamIdleResearch', 'streamIdleResearch'],
        ];
        const inputs = {};
        for (const [elId] of fields) inputs[elId] = document.getElementById(elId);
        const saveBtn = document.getElementById('saveTimeoutBtn');
        const resetBtn = document.getElementById('resetTimeoutBtn');
        if (!saveBtn) return; // 设置面板未渲染好 → 静默跳过

        function fillFrom(obj) {
          for (const [elId, key] of fields) {
            if (inputs[elId]) inputs[elId].value = obj[key] ?? DEFAULT_TIMEOUT_SEC[key];
          }
        }

        async function loadConfig() {
          try {
            const saved = await api?.storeGet?.('timeoutConfig');
            fillFrom(saved && typeof saved === 'object' ? saved : {});
          } catch (e) {
            console.warn('加载超时配置失败:', e);
          }
        }

        async function saveConfig() {
          const cfg = {};
          for (const [elId, key] of fields) {
            const v = Number(inputs[elId]?.value);
            // 非法（<5 / NaN）回落默认，避免存入会立即触发超时的脏值
            cfg[key] = Number.isFinite(v) && v >= 5 ? Math.round(v) : DEFAULT_TIMEOUT_SEC[key];
          }
          try {
            await api?.storeSet?.('timeoutConfig', cfg);
            fillFrom(cfg); // 回填：把被替换的非法值在 UI 上也修正
            saveBtn.textContent = '✅ 已保存';
            setTimeout(() => { saveBtn.textContent = '保存配置'; }, 2000);
          } catch (e) {
            saveBtn.textContent = '❌ 保存失败';
            setTimeout(() => { saveBtn.textContent = '保存配置'; }, 2000);
            console.error('保存超时配置失败:', e);
          }
        }

        saveBtn.addEventListener('click', saveConfig);
        // 恢复默认：只回填 UI，不自动保存（让用户点保存确认）
        resetBtn?.addEventListener('click', () => fillFrom(DEFAULT_TIMEOUT_SEC));
        loadConfig();
      }

      // 延迟初始化（等 DOM 渲染完成）
      setTimeout(initExternalSearchConfig, 500);
      setTimeout(initTimeoutConfig, 500);
