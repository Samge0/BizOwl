// presets.js — renderer module (split from index.html)

      // ─────────────────────────────────────────────
      // 快捷场景
      // ─────────────────────────────────────────────
      async function loadQuickActions() {
        dom.quickActions.innerHTML = '';
        try {
          // 通过 IPC 读取（file:// 协议下 fetch 本地资源会被 Chromium 拦截）
          const data = api?.readAsset ? await api.readAsset('preset-prompts.json') : null;
          if (!data) throw new Error('readAsset unavailable');

          // 渲染标题
          if (data.heroTitle || data.heroDescription) {
            const hero = document.querySelector('#welcomePage h1');
            const heroP = document.querySelector('#welcomePage > p');
            if (hero && data.heroTitle) {
              // textContent 设置主标题 + 保留 .lite 样式 span
              hero.textContent = '';
              hero.appendChild(document.createTextNode(data.heroTitle + ' '));
              const liteSpan = document.createElement('span');
              liteSpan.className = 'lite';
              liteSpan.textContent = 'Lite';
              hero.appendChild(liteSpan);
            }
            if (heroP && data.heroDescription) heroP.textContent = data.heroDescription;
          }

          // 渲染分类
          const categories = data.categories || [];
          categories.forEach(cat => {
            const section = document.createElement('div');
            section.className = 'prompt-category';
            section.style.marginBottom = '20px';

            const header = document.createElement('div');
            header.className = 'category-header';
            // 用 textContent 防 XSS（icon 和 title 来自 JSON 资源）
            const iconSpan = document.createElement('span');
            iconSpan.className = 'category-icon';
            iconSpan.textContent = cat.icon || '';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'category-title';
            titleSpan.textContent = cat.title || '';
            header.appendChild(iconSpan);
            header.appendChild(titleSpan);
            header.style.color = cat.color || '#3B82F6';
            section.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'quick-actions';

            (cat.prompts || []).forEach(p => {
              const card = document.createElement('div');
              card.className = 'quick-action-card';
              card.addEventListener('click', () => {
                // 记录激活的预设场景（用于 PromptPipeline triggers 匹配）
                state.activePreset = {
                  id: p.title || cat.title,
                  title: p.title,
                  label: p.label,
                  prompt: p.prompt || p.label,
                  category: cat.id,
                };
                dom.chatInput.value = p.prompt || p.label;
                dom.chatInput.focus();
                dom.chatInput.style.height = 'auto';
                dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 140) + 'px';
                debugLog('选中预设场景:', state.activePreset.title);
              });

              const title = document.createElement('div');
              title.className = 'quick-action-title';
              title.textContent = p.title;

              const desc = document.createElement('div');
              desc.className = 'quick-action-desc';
              desc.textContent = (p.label || p.desc || '').slice(0, 50);

              card.appendChild(title);
              card.appendChild(desc);
              grid.appendChild(card);
            });
            section.appendChild(grid);
            dom.quickActions.appendChild(section);
          });

          // 保留旧的 QUICK_ACTIONS 作为补充
          if (categories.length === 0) {
            QUICK_ACTIONS.forEach(q => {
              const card = document.createElement('div');
              card.className = 'quick-action-card';
              card.addEventListener('click', () => {
                dom.chatInput.value = q.prompt;
                dom.chatInput.focus();
                dom.chatInput.style.height = 'auto';
                dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 140) + 'px';
              });
              const title = document.createElement('div');
              title.className = 'quick-action-title';
              title.textContent = q.title;
              const desc = document.createElement('div');
              desc.className = 'quick-action-desc';
              desc.textContent = q.desc;
              card.appendChild(title);
              card.appendChild(desc);
              dom.quickActions.appendChild(card);
            });
          }
        } catch (err) {
          debugError('loadQuickActions fetch failed, using fallback', err);
          QUICK_ACTIONS.forEach(q => {
            const card = document.createElement('div');
            card.className = 'quick-action-card';
            card.addEventListener('click', () => {
              dom.chatInput.value = q.prompt;
              dom.chatInput.focus();
            });
            const title = document.createElement('div');
            title.className = 'quick-action-title';
            title.textContent = q.title;
            const desc = document.createElement('div');
            desc.className = 'quick-action-desc';
            desc.textContent = q.desc;
            card.appendChild(title);
            card.appendChild(desc);
            dom.quickActions.appendChild(card);
          });
        }
      }
