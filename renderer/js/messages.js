// messages.js — renderer module (split from index.html)

      // ─────────────────────────────────────────────
      // 消息渲染
      // ─────────────────────────────────────────────
      /** 动态加载 Mermaid.js 并渲染图表 */
      let _mermaidLoaded = null;
      function loadMermaidAndRender(elements) {
        if (!_mermaidLoaded) {
          _mermaidLoaded = new Promise((resolve, reject) => {
            if (window.mermaid) { resolve(window.mermaid); return; }
            const onLoaded = () => {
              try {
                window.mermaid.initialize({
                  startOnLoad: false,
                  securityLevel: 'strict',
                  theme: 'base',              // base = 空白画布，完全由 themeVariables 控制
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", system-ui, sans-serif',
                  fontSize: 14,
                  themeVariables: {
                    /* ── 画布 ── */
                    background: 'transparent',
                    mainBkg: 'transparent',

                    /* ── 色板（Apple System Colors）── */
                    // 主节点：白底 + accent 描边
                    primaryColor: '#FFFFFF',
                    primaryBorderColor: '#0066CC',
                    primaryTextColor: '#1D1D1F',

                    // 次级节点：浅蓝填充
                    secondaryColor: 'rgba(0, 102, 204, 0.06)',
                    secondaryBorderColor: 'rgba(0, 102, 204, 0.3)',
                    secondaryTextColor: '#1D1D1F',

                    // 三级节点：浅灰填充
                    tertiaryColor: '#F5F5F7',
                    tertiaryBorderColor: 'rgba(0,0,0,0.08)',
                    tertiaryTextColor: '#6E6E73',

                    /* ── 线条 ── */
                    lineColor: '#86868B',          // Apple gray for connectors
                    arrowheadColor: '#86868B',

                    /* ── 文字 ── */
                    textColor: '#1D1D1F',

                    /* ── 各图表类型专用 ── */
                    // flowchart
                    nodeBorder: '#0066CC',
                    nodeTextColor: '#1D1D1F',
                    clusterBkg: 'rgba(0, 102, 204, 0.03)',
                    clusterBorder: 'rgba(0, 102, 204, 0.15)',

                    // sequence diagram
                    actorBkg: '#FFFFFF',
                    actorBorder: '#0066CC',
                    actorTextColor: '#1D1D1F',
                    actorLineColor: '#86868B',
                    signalColor: '#1D1D1F',
                    signalTextColor: '#6E6E73',
                    labelBoxBkgColor: '#FFFFFF',
                    labelBoxBorderColor: '#0066CC',
                    labelTextColor: '#1D1D1F',
                    loopTextColor: '#1D1D1F',
                    noteBkgColor: 'rgba(255, 149, 0, 0.08)',
                    noteBorderColor: '#FF9500',
                    noteTextColor: '#1D1D1F',
                    activationBkgColor: 'rgba(0, 102, 204, 0.1)',
                    activationBorderColor: '#0066CC',

                    // gantt
                    // sectionBkgColor / altSectionBkgColor 用 Apple 灰
                    gridColor: 'rgba(0,0,0,0.06)',
                    doneTaskBkgColor: '#86868B',
                    doneTaskBorderColor: '#6E6E73',
                    activeTaskBkgColor: '#0066CC',
                    activeTaskBorderColor: '#0050A4',
                    taskBkgColor: 'rgba(0, 102, 204, 0.15)',
                    taskBorderColor: '#0066CC',
                    taskTextColor: '#1D1D1F',
                    taskTextDarkColor: '#1D1D1F',
                    taskTextLightColor: '#6E6E73',
                    taskTextOutsideColor: '#6E6E73',
                    sectionBkgColor: 'rgba(0,0,0,0.02)',
                    sectionBkgColor2: 'rgba(0, 102, 204, 0.03)',
                    excludeBkgColor: 'rgba(255, 59, 48, 0.06)',

                    // pie chart
                    pie1: '#0066CC',
                    pie2: '#34C759',
                    pie3: '#FF9500',
                    pie4: '#AF52DE',
                    pie5: '#FF3B30',
                    pie6: '#5AC8FA',
                    pie7: '#FFD60A',
                    pie8: '#64D2FF',
                    pie9: '#BF5AF2',
                    pie10: '#30D158',
                    pie11: '#AC8E68',
                    pie12: '#FFCC00',
                    pieTitleTextColor: '#1D1D1F',
                    pieSectionTextColor: '#FFFFFF',
                    pieLegendTextColor: '#6E6E73',
                    pieStrokeColor: '#FFFFFF',
                    pieStrokeWidth: '2px',

                    // class diagram
                    classText: '#1D1D1F',

                    // state diagram
                    fillType0: '#0066CC',
                    fillType1: '#34C759',
                    fillType2: '#FF9500',
                    fillType3: '#AF52DE',
                    fillType4: '#FF3B30',
                    fillType5: '#5AC8FA',
                    fillType6: '#FFD60A',
                    fillType7: '#64D2FF',

                    // git graph
                    git0: '#0066CC',
                    git1: '#34C759',
                    git2: '#FF9500',
                    git3: '#AF52DE',
                    git4: '#FF3B30',
                    git5: '#5AC8FA',
                    git6: '#FFD60A',
                    git7: '#64D2FF',
                    gitBranchLabel0: '#FFFFFF',
                    gitBranchLabel1: '#FFFFFF',
                    gitBranchLabel2: '#FFFFFF',
                    commitLabelColor: '#1D1D1F',
                    commitLabelBackground: '#F5F5F7',
                    commitLabelFontSize: '12px',
                    tagLabelColor: '#1D1D1F',
                    tagLabelBackground: 'rgba(255, 149, 0, 0.1)',
                    tagLabelBorder: '#FF9500',
                    tagLabelFontSize: '12px',
                  },
                });
                resolve(window.mermaid);
              } catch (e) { reject(e); }
            };
            const loadScript = (src, onErr) => {
              const s = document.createElement('script');
              s.src = src;
              s.onload = onLoaded;
              s.onerror = onErr;
              document.head.appendChild(s);
            };
            // 主源 jsdelivr，失败回退 unpkg（避免单一 CDN 不可达时 mermaid 永久不渲染）
            loadScript('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js', () => {
              console.warn('[Mermaid] 主源加载失败，尝试备用源 unpkg');
              loadScript('https://unpkg.com/mermaid@11/dist/mermaid.min.js', () => {
                console.warn('[Mermaid] 备用源也失败');
                reject(new Error('load failed'));
              });
            });
          });
        }
        _mermaidLoaded.then(async (mm) => {
          try {
            await mm.run({ nodes: elements });
            // 渲染完成后注入 Apple 风格 SVG 样式
            elements.forEach(el => applyAppleSvgStyle(el));
          } catch (e) { console.warn('[Mermaid] render:', e.message); }
        }).catch(() => {});
      }

      /**
       * 对 mermaid 渲染后的 SVG 做二次美化：
       * 圆角节点、柔和阴影、统一描边、字体微调。
       * 这些通过 CSS themeVariables 无法覆盖的视觉细节。
       */
      function applyAppleSvgStyle(container) {
        const svg = container.querySelector?.('svg') || (container.tagName === 'svg' ? container : null);
        if (!svg) return;
        // 确保只处理一次
        if (svg._appleStyled) return;
        svg._appleStyled = true;
        // 节点圆角：把所有 rect 的 rx/ry 设为 Apple 风格
        svg.querySelectorAll('rect').forEach(r => {
          const w = parseFloat(r.getAttribute('width') || '0');
          const h = parseFloat(r.getAttribute('height') || '0');
          if (w > 10 && h > 8) {
            // 大矩形 → 8px 圆角；小矩形保持
            const rx = Math.min(8, Math.min(w, h) / 4);
            r.setAttribute('rx', rx);
            r.setAttribute('ry', rx);
          }
        });
        // 统一描边宽度
        svg.querySelectorAll('path, line, rect, polygon').forEach(el => {
          const sw = el.getAttribute('stroke-width');
          if (sw && parseFloat(sw) > 2) el.setAttribute('stroke-width', '1.5');
        });
      }

      /**
       * 在指定容器内渲染 Mermaid 图表并绑定工具栏（zoom 预览 + copy 代码）。
       * 所有产生新 mermaid DOM 的入口都应调用此函数：
       *   renderMessages / appendMessageEl / chat.js 流式完成替换 live view
       */
      function processMermaidInElement(container) {
        if (!container) return;
        const els = container.querySelectorAll('.mermaid');
        if (els.length > 0) {
          loadMermaidAndRender(els);
          bindMermaidToolbar(container);
        }
        // 同时处理 KaTeX 公式
        renderKatexInContainer(container);
      }

      /** 绑定 mermaid-zoom / mermaid-copy 按钮事件（幂等：已绑的跳过） */
      function bindMermaidToolbar(container) {
        container.querySelectorAll('.mermaid-zoom').forEach(btn => {
          if (btn._mermaidBound) return;
          btn._mermaidBound = true;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrapper = btn.closest('.mermaid-wrapper');
            const svg = wrapper && wrapper.querySelector('svg');
            if (!svg) return;
            const svgData = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            openImageLightbox(URL.createObjectURL(blob), 'mermaid-diagram', true);
          });
        });
        container.querySelectorAll('.mermaid-copy').forEach(btn => {
          if (btn._mermaidBound) return;
          btn._mermaidBound = true;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrapper = btn.closest('.mermaid-wrapper');
            const code = wrapper ? decodeURIComponent(wrapper.dataset.mermaidCode || '') : '';
            copyToClipboard(code);
            showToast('Mermaid 代码已复制', 'success');
          });
        });
      }

      function renderMessages() {
        // 清除所有内容
        dom.chatMessages.innerHTML = '';

        // 没有消息时显示欢迎首页（无论是否有 currentSessionId）
        if (state.messages.length === 0) {
          dom.chatMessages.appendChild(dom.welcomePage);
          dom.welcomePage.style.display = '';
          updateScrollNavVisibility();
          updateMsgRailVisibility();
          return;
        }

        const inner = document.createElement('div');
        inner.className = 'messages-inner';

        state.messages.forEach(msg => {
          inner.appendChild(buildMessageEl(msg));
        });

        dom.chatMessages.appendChild(inner);
        scrollToBottom();
        // 渲染 Mermaid 图表（动态加载 mermaid.js）+ 绑定工具栏 + KaTeX 公式
        const mermaidEls = inner.querySelectorAll('.mermaid');
        if (mermaidEls.length > 0) {
          loadMermaidAndRender(mermaidEls);
          bindMermaidToolbar(inner);
        }
        renderKatexInContainer(inner);
        // 渲染后更新导航可见性
        requestAnimationFrame(() => {
          updateScrollNavVisibility();
          updateMsgRailVisibility();
        });
      }

      // 解析 <related_questions>[{label,prompt}]</related_questions>（推荐追问）
      // 兼容两种模型异常：① 输出被截断、缺少 </related_questions> 结束标签；
      //                  ② 偶发非法 JSON（如 key 漏写引号），此时降级逐对象宽容提取。
      function parseRelatedQuestions(content) {
        if (!content) return { text: content || '', questions: [] };
        // 结束标签可选：缺失（被截断）时匹配到字符串末尾，避免把原始 JSON 当正文渲染
        const m = content.match(/<related_questions>([\s\S]*?)(?:<\/related_questions>|$)/);
        if (!m) return { text: content, questions: [] };
        const raw = m[1].trim();
        let questions = [];
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) questions = arr.filter(q => q && (q.label || q.prompt));
        } catch {
          questions = extractQuestionsLenient(raw);
        }
        return { text: content.replace(m[0], '').trim(), questions };
      }

      // 宽容提取（best-effort）：从可能非法/被截断的文本中逐个抽取 {label, prompt} 对象
      function extractQuestionsLenient(text) {
        const out = [];
        const objRe = /\{[^{}]*\}/g;
        let om;
        while ((om = objRe.exec(text)) !== null) {
          const obj = om[0];
          const label = readJsonStringValue(obj, /"?label"?\s*:\s*"((?:[^"\\]|\\.)*)"/);
          const prompt = readJsonStringValue(obj, /"?prompt"?\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (label || prompt) out.push({ label: label || prompt || '', prompt: prompt || label || '' });
        }
        return out;
      }

      // 在单个对象文本中读取某 key 的字符串值（key 引号可选，兼容漏写引号的非法写法）
      function readJsonStringValue(obj, re) {
        const mm = obj.match(re);
        return mm ? mm[1] : '';
      }

      // ─────────────────────────────────────────────
      // 产物卡片（workbuddy 风格文件交互 — 研究报告/导出文件通用）
      // ─────────────────────────────────────────────
      function getArtifactIcon(format) {
        const map = { pdf: '📕', docx: '📘', xlsx: '📗', pptx: '📙', md: '📄', html: '🌐', csv: '📊', txt: '📃' };
        return map[(format || '').toLowerCase()] || '📎';
      }

      function formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      }

      function formatArtifactMeta(artifact) {
        const size = formatFileSize(artifact.size);
        let time = '';
        if (artifact.createdAt) {
          time = new Date(artifact.createdAt).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          });
        }
        return [(artifact.format || artifact.kind || 'file').toUpperCase(), size, time].filter(Boolean).join(' · ');
      }

      async function openArtifact(artifact) {
        if (!artifact) return;
        try {
          if (api?.artifactsOpen) {
            const r = await api.artifactsOpen(artifact);
            if (r && !r.success) showToast(r.error || '打开失败', 'error');
          } else if (artifact.filePath && api?.openExternal) {
            await api.openExternal('file://' + artifact.filePath);
          }
        } catch (err) {
          debugError('打开产物失败:', err);
          showToast('打开失败：' + (err?.message || err), 'error');
        }
      }

      function buildArtifactCard(artifact) {
        const card = document.createElement('div');
        card.className = 'artifact-card';
        card.title = artifact.filePath || artifact.title || '';

        const icon = document.createElement('div');
        icon.className = 'artifact-icon';
        icon.textContent = getArtifactIcon(artifact.format || artifact.kind);

        const info = document.createElement('div');
        info.className = 'artifact-info';
        const title = document.createElement('div');
        title.className = 'artifact-title';
        title.textContent = artifact.title || '文件';
        const meta = document.createElement('div');
        meta.className = 'artifact-meta';
        meta.textContent = formatArtifactMeta(artifact);
        info.appendChild(title);
        info.appendChild(meta);

        const openBtn = document.createElement('button');
        openBtn.className = 'artifact-open-btn';
        openBtn.textContent = '打开';
        openBtn.title = '在浏览器中打开预览';
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openArtifact(artifact);
        });

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(openBtn);
        card.addEventListener('click', () => openArtifact(artifact));
        return card;
      }

      // 当前助手头像（优先取已选 Agent 的 icon）
      function currentAgentAvatar() {
        const a = (state.presetAgents || []).find(x => x.id === state.selectedAgentId);
        return (a && a.icon) || '🤖';
      }

      /** 构造用户消息的附件展示盒（图片缩略图 + 文件标签），无附件返回 null */
      function buildUserAttachmentBox(msg) {
        const images = Array.isArray(msg.attachments) ? msg.attachments : [];
        const files = Array.isArray(msg.fileAttachments) ? msg.fileAttachments : [];
        if (images.length === 0 && files.length === 0) return null;
        const box = document.createElement('div');
        box.className = 'msg-attachments';
        images.forEach(a => {
          const img = document.createElement('img');
          img.className = 'msg-att-img';
          img.src = a.dataUrl;
          img.alt = a.name || '';
          img.title = '点击查看大图';
          img.addEventListener('click', () => openImageLightbox(a.dataUrl, a.name));
          box.appendChild(img);
        });
        files.forEach(a => {
          const chip = document.createElement('div');
          chip.className = 'msg-att-file';
          chip.textContent = (getAttachmentIcon(a.type, a.name)) + ' ' + (a.name || '文件');
          box.appendChild(chip);
        });
        return box;
      }

      /** 图片大图预览（lightbox） — 居中 + 毛玻璃背景 + 缩放/拖拽 */
      const lightboxState = { zoom: 1, ox: 0, oy: 0, dragging: false, sx: 0, sy: 0, hasMoved: false };
      window.lightboxState = lightboxState;

      function applyLightboxTransform() {
        if (!dom.imgLightboxImg) return;
        dom.imgLightboxImg.style.transform = `translate(${lightboxState.ox}px, ${lightboxState.oy}px) scale(${lightboxState.zoom})`;
        const label = document.getElementById('imgZoomLabel');
        if (label) label.textContent = Math.round(lightboxState.zoom * 100) + '%';
      }

      function setLightboxZoom(z) {
        lightboxState.zoom = Math.max(0.2, Math.min(8, z));
        // 缩小回 1x 时自动重置位移
        if (lightboxState.zoom <= 1) { lightboxState.ox = 0; lightboxState.oy = 0; }
        applyLightboxTransform();
      }

      function openImageLightbox(src, name, isSvg) {
        if (!dom.imgLightbox || !dom.imgLightboxImg) return;
        dom.imgLightboxImg.src = src;
        dom.imgLightboxImg.alt = name || '';
        // SVG 图表给白色背景（灰色线条/箭头在暗色背景上不可见）
        dom.imgLightbox.classList.toggle('svg-mode', !!isSvg);
        // 重置状态
        lightboxState.zoom = 1; lightboxState.ox = 0; lightboxState.oy = 0;
        lightboxState.hasMoved = false;
        applyLightboxTransform();
        dom.imgLightbox.style.display = 'flex';
        dom.imgLightbox.focus();
      }

      function closeImageLightbox() {
        if (dom.imgLightbox) dom.imgLightbox.style.display = 'none';
        if (dom.imgLightbox) dom.imgLightbox.classList.remove('svg-mode');
        if (dom.imgLightboxImg) dom.imgLightboxImg.src = '';
        lightboxState.dragging = false;
      }
      window.closeImageLightbox = closeImageLightbox;

      // ── lightbox 交互绑定（只绑一次）──
      let lightboxBound = false;
      function bindLightboxInteractions() {
        if (lightboxBound) return;
        lightboxBound = true;

        // 点 stage（非图片区域）关闭
        const stage = document.getElementById('imgLightboxStage');
        if (stage) {
          stage.addEventListener('click', (e) => {
            if (e.target === stage || e.target === dom.imgLightboxImg && !lightboxState.hasMoved) {
              // 点图片本身：如果没移动过且未放大，也关闭；放大后点图片不关闭（允许拖拽）
              if (e.target === stage) closeImageLightbox();
            }
          });
          // 更直接：stage 区域（不含图片）点击关闭
          stage.addEventListener('mousedown', (e) => {
            if (e.target === stage) { closeImageLightbox(); return; }
            // 点在图片上：开始拖拽（放大状态下）
            if (e.target === dom.imgLightboxImg && lightboxState.zoom > 1) {
              lightboxState.dragging = true;
              lightboxState.hasMoved = false;
              lightboxState.sx = e.clientX - lightboxState.ox;
              lightboxState.sy = e.clientY - lightboxState.oy;
              e.preventDefault();
            }
          });
        }

        // 拖拽移动
        document.addEventListener('mousemove', (e) => {
          if (!lightboxState.dragging) return;
          const nx = e.clientX - lightboxState.sx;
          const ny = e.clientY - lightboxState.sy;
          if (Math.abs(nx - lightboxState.ox) > 3 || Math.abs(ny - lightboxState.oy) > 3) {
            lightboxState.hasMoved = true;
          }
          lightboxState.ox = nx;
          lightboxState.oy = ny;
          applyLightboxTransform();
        });
        document.addEventListener('mouseup', () => {
          lightboxState.dragging = false;
        });

        // 滚轮缩放
        if (dom.imgLightboxImg) {
          dom.imgLightboxImg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            setLightboxZoom(lightboxState.zoom + delta * lightboxState.zoom);
          }, { passive: false });
        }

        // 工具栏按钮
        const zoomIn = document.getElementById('imgZoomIn');
        const zoomOut = document.getElementById('imgZoomOut');
        const zoomReset = document.getElementById('imgZoomReset');
        if (zoomIn) zoomIn.addEventListener('click', (e) => { e.stopPropagation(); setLightboxZoom(lightboxState.zoom + 0.25); });
        if (zoomOut) zoomOut.addEventListener('click', (e) => { e.stopPropagation(); setLightboxZoom(lightboxState.zoom - 0.25); });
        if (zoomReset) zoomReset.addEventListener('click', (e) => { e.stopPropagation(); setLightboxZoom(1); lightboxState.ox = 0; lightboxState.oy = 0; applyLightboxTransform(); });

        // 阻止工具栏点击穿透到 stage
        const toolbar = document.querySelector('.img-lightbox-toolbar');
        if (toolbar) toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
        const closeBtn = document.querySelector('.img-lightbox-close');
        if (closeBtn) closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      }

      // 构造单条消息的「删除」按钮（挂在操作栏中，点击按 id 删除该条）
      function createMessageDeleteBtn(wrapper) {
        const btn = document.createElement('button');
        btn.className = 'msg-action-btn msg-delete-btn';
        btn.title = '删除';
        btn.textContent = '🗑️';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteMessage(wrapper);
        });
        return btn;
      }

      // 删除一条聊天记录：移除 DOM + 同步内存 state/会话历史 + 持久化（jsonl + 内存 store）
      async function deleteMessage(wrapper) {
        if (!wrapper) return;
        const msgId = wrapper.dataset.msgId;
        if (!msgId) return; // 无 id 无法持久化删除，忽略（理论上不会发生）
        if (!await showConfirmDialog({ title: '删除消息', message: '确定删除这条消息吗？', confirmText: '删除', danger: true })) return;

        wrapper.remove();

        // 同步内存：state.messages + 重建 conversationHistory（供下次发送给 LLM）
        const idx = state.messages.findIndex((m) => m && m.id === msgId);
        if (idx !== -1) state.messages.splice(idx, 1);
        if (typeof buildConversationHistory === 'function') {
          state.conversationHistory = buildConversationHistory(state.messages);
        }

        // 持久化删除（jsonl 文件 + 内存 store 缓存）
        if (state.currentSessionId && api?.sessionDeleteMessage) {
          try {
            await api.sessionDeleteMessage(state.currentSessionId, msgId);
          } catch (err) {
            debugError('删除消息失败:', err);
            showToast('删除失败：' + (err?.message || err), 'error');
          }
        }

        // 全部删完 → 显示欢迎页；否则刷新滚动导航可见性
        const inner = dom.chatMessages.querySelector('.messages-inner');
        if (!inner || inner.children.length === 0) {
          renderMessages();
        } else {
          if (typeof updateScrollNavVisibility === 'function') updateScrollNavVisibility();
          if (typeof updateMsgRailVisibility === 'function') updateMsgRailVisibility();
        }
      }

      function buildMessageEl(msg) {
        // 产物消息（研究报告 PDF / 导出文件卡片）— 独立渲染，不解析追问/不做 markdown
        if (msg.role === 'artifact' || msg.artifact) {
          const wrapper = document.createElement('div');
          wrapper.className = 'message message-artifact';
          if (msg.id) wrapper.dataset.msgId = msg.id;
          const body = document.createElement('div');
          body.className = 'message-body';
          body.appendChild(buildArtifactCard(msg.artifact || msg));
          wrapper.appendChild(body);
          // 操作栏（删除）
          const actionBar = document.createElement('div');
          actionBar.className = 'msg-action-bar';
          actionBar.appendChild(createMessageDeleteBtn(wrapper));
          wrapper.appendChild(actionBar);
          return wrapper;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'message ' + (msg.role === 'user' ? 'message-user' : 'message-assistant');
        if (msg.id) wrapper.dataset.msgId = msg.id;

        // 助手消息：直接使用 wrapper 作为挂载点（无头像，气泡贴左对齐）
        let mount = wrapper;
        if (msg.role === 'assistant') {
          const body = document.createElement('div');
          body.className = 'message-body';
          wrapper.appendChild(body);
          mount = body;
        }

        // 内容元素
        const content = document.createElement('div');
        content.className = 'message-content';
        let questions = [];
        if (msg.role === 'assistant') {
          const parsed = parseRelatedQuestions(msg.content || '');
          questions = parsed.questions;
          content.innerHTML = renderMarkdown(parsed.text);
        } else {
          content.textContent = msg.content || '';
        }

        // 工具调用卡片（插入到文本内容之前，确保工具调用在上方）
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          msg.toolCalls.forEach(tc => {
            const toolName = tc.name || tc.tool || 'tool';
            const args = tc.args || tc.arguments || {};
            const card = createToolCallCard({
              name: toolName,
              argsStr: formatToolArgs(toolName, args),
              args: args,
              icon: getToolIcon(toolName),
              displayName: getToolDisplayName(toolName),
            });
            // 标记为已完成
            if (tc.status === 'end' || !tc.status) {
              updateToolCallCardDone(card, tc.result);
            }
            mount.appendChild(card);
          });
        }

        // 用户消息附件（图片缩略图 + 文件标签），渲染在文本之前
        if (msg.role === 'user') {
          const attBox = buildUserAttachmentBox(msg);
          if (attBox) mount.appendChild(attBox);
        }

        // 文本内容插入到工具卡片之后
        mount.appendChild(content);

        // 推荐追问 chips（仅助手消息）
        if (msg.role === 'assistant' && questions.length > 0) {
          const chipBox = document.createElement('div');
          chipBox.className = 'related-questions';
          questions.forEach(q => {
            const chip = document.createElement('button');
            chip.className = 'related-question-chip';
            chip.textContent = q.label || q.prompt;
            chip.title = q.prompt || q.label;
            chip.addEventListener('click', () => {
              const prompt = q.prompt || q.label;
              dom.chatInput.value = prompt;
              dom.chatInput.style.height = 'auto';
              dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 140) + 'px';
              // 自动发送，省去再点一次发送按钮
              sendMessage();
            });
            chipBox.appendChild(chip);
          });

          // 固定追加「深度研究报告」入口（在 LLM 生成的动态追问之后，不影响原有功能）
          const reportChip = document.createElement('button');
          reportChip.className = 'related-question-chip chip-research-report';
          reportChip.title = '基于本次会话内容进行深度研究并生成 PDF 报告';
          reportChip.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>深度研究报告';
          reportChip.addEventListener('click', () => {
            if (typeof window.openReportModal === 'function') window.openReportModal();
            else showToast('报告功能未就绪，请刷新应用', 'error');
          });
          chipBox.appendChild(reportChip);

          mount.appendChild(chipBox);
        }

        // AI 消息添加操作栏（复制）
        if (msg.role === 'assistant' && msg.content) {
          const actionBar = document.createElement('div');
          actionBar.className = 'msg-action-bar';

          // 复制 Markdown 原文
          const copyBtn = document.createElement('button');
          copyBtn.className = 'msg-action-btn';
          copyBtn.title = '复制';
          copyBtn.textContent = '📋';
          copyBtn.addEventListener('click', () => {
            copyToClipboard(parseRelatedQuestions(msg.content || '').text || '');
            copyBtn.textContent = '✓';
            setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
          });
          actionBar.appendChild(copyBtn);
          actionBar.appendChild(createMessageDeleteBtn(wrapper));

          mount.appendChild(actionBar);
        }

        // 用户消息操作栏（删除）
        if (msg.role === 'user') {
          const actionBar = document.createElement('div');
          actionBar.className = 'msg-action-bar';
          actionBar.appendChild(createMessageDeleteBtn(wrapper));
          mount.appendChild(actionBar);
        }

        return wrapper;
      }

      // 追加一条消息到 UI（不存储）
      function appendMessageEl(msg) {
        // 移除欢迎页
        if (dom.welcomePage.parentNode === dom.chatMessages) {
          dom.chatMessages.removeChild(dom.welcomePage);
        }
        // 如果当前只有欢迎页占位，清空
        const welcome = dom.chatMessages.querySelector('.welcome');
        if (welcome && welcome !== dom.welcomePage) welcome.remove();

        let inner = dom.chatMessages.querySelector('.messages-inner');
        if (!inner) {
          dom.chatMessages.innerHTML = '';
          inner = document.createElement('div');
          inner.className = 'messages-inner';
          dom.chatMessages.appendChild(inner);
        }

        const el = buildMessageEl(msg);
        inner.appendChild(el);
        processMermaidInElement(el);
        scrollToBottom();
        return el;
      }
      function appendMessageToUI(role, content) {
        return appendMessageEl({ role, content });
      }

      // ─────────────────────────────────────────────
      // 进行中会话的 live 视图（多会话并行：切走再切回应能复现正在进行的交互）
      // ss.live = { text: '', tools: [], view: null }
      // ss.live.view = { assistantEl, assistantContent, typing, toolCardMap }
      // ─────────────────────────────────────────────
      function removeLiveTyping(view) {
        if (view && view.typing && view.typing.parentNode) view.typing.remove();
      }

      /** 显示"思考中"动画（工具调用间隙 / 初始等待时）；收到文本后被 removeLiveTyping 移除。
       *  @param {Object} view - live view
       *  @param {string} [label] - 可选状态文字（"执行中"/"思考中"），让用户明确知道当前阶段 */
      function showLiveThinking(view, label) {
        if (!view || !view.assistantContent) return;
        // 已有 typing 且 label 未变 → 不重复创建（避免闪烁）
        if (view.typing && view.typing.parentNode) {
          // 更新 label 文字（如果传了新 label）
          // 注意：rebuildLiveView 创建的初始 typing 没有 .typing-label 子元素，
          // 这里在缺失时补建，否则"执行中/思考中"状态文字永远不会显示（只看到 3 个光秃秃的点）
          if (label !== undefined) {
            let labelEl = view.typing.querySelector('.typing-label');
            if (label) {
              if (!labelEl) {
                labelEl = document.createElement('span');
                labelEl.className = 'typing-label';
                view.typing.appendChild(labelEl);
              }
              if (labelEl.textContent !== label) labelEl.textContent = label;
            }
          }
          return;
        }
        const typing = document.createElement('span');
        typing.className = 'typing-indicator';
        typing.innerHTML = '<span></span><span></span><span></span>'
          + (label ? `<span class="typing-label">${label}</span>` : '');
        view.typing = typing;
        view.assistantContent.appendChild(typing);
      }

      /** 在当前 DOM 末尾重建 live 助手气泡，重放已累积的文本 + 工具卡片 */
      function rebuildLiveView(ss) {
        const assistantEl = appendMessageToUI('assistant', '');
        const assistantContent = assistantEl.querySelector('.message-content');
        const typing = document.createElement('span');
        typing.className = 'typing-indicator';
        typing.innerHTML = '<span></span><span></span><span></span>';
        const toolCardMap = new Map();
        const view = { assistantEl, assistantContent, typing, toolCardMap };
        ss.live.view = view;
        // 重放文本
        if (ss.live.text) {
          assistantContent.innerHTML = renderMarkdown(ss.live.text);
        } else {
          assistantContent.appendChild(typing);
        }
        // 如果有正在执行的工具（status=start），追加 typing（带"执行中"提示），
        // 让用户知道系统还在工作（切走再切回时复现执行中状态）
        const hasRunningTool = ss.live.tools.some(t => t.status === 'start');
        if (hasRunningTool && ss.live.text) {
          // 已有文本时，在末尾追加 typing（不覆盖已有内容）
          const t2 = document.createElement('span');
          t2.className = 'typing-indicator';
          t2.innerHTML = '<span></span><span></span><span></span><span class="typing-label">执行中</span>';
          assistantContent.appendChild(t2);
          view.typing = t2; // 更新 view.typing 引用，后续 removeLiveTyping 能找到它
        }
        // 重放工具卡片
        for (const entry of ss.live.tools) {
          if (toolCardMap.has(entry)) continue;
          const card = createToolCallCard({
            name: entry.name, argsStr: entry.argsStr, args: entry.args,
            icon: entry.icon, displayName: entry.displayName,
          });
          (assistantContent.parentNode || assistantEl).insertBefore(card, assistantContent);
          toolCardMap.set(entry, card);
          if (entry.status === 'end') updateToolCallCardDone(card, entry.result);
        }
        scrollToBottom();
        return view;
      }

      /** 确保 live 视图存在且挂在当前 DOM 上（被 renderMessages 清空后自动重建） */
      function ensureLiveView(ss) {
        const v = ss.live.view;
        if (v && v.assistantEl && v.assistantEl.isConnected) return v;
        return rebuildLiveView(ss);
      }

      // ─────────────────────────────────────────────
      // 工具调用卡片
      // ─────────────────────────────────────────────
      function getToolIcon(toolName) {
        const icons = {
          web_search: '🔍',
          shell: '💻',
          read_file: '📄',
          write_file: '✏️',
          list_skills: '📋',
          qcc_knowledge_search: '📚',
          qcc_tool_search: '🧭',
          qcc_execute_tool: '🏢',
          document_export: '📤',
          report_export: '📕',
        };
        return icons[toolName] || '🔧';
      }

      function getToolDisplayName(toolName) {
        const names = {
          web_search: '网页搜索',
          shell: '执行命令',
          read_file: '读取文件',
          write_file: '写入文件',
          list_skills: '列出技能',
          qcc_knowledge_search: '企业知识搜索',
          qcc_tool_search: '企业数据工具搜索',
          qcc_execute_tool: '企业数据工具执行',
          document_export: '文档导出',
          report_export: '研究报告',
        };
        return names[toolName] || toolName;
      }

      function formatToolArgs(toolName, args) {
        if (!args) return '';
        if (toolName === 'web_search') return args.query ? `查询: "${args.query}"` : '';
        if (toolName === 'shell') return args.command ? `命令: ${args.command}` : '';
        if (toolName === 'read_file' || toolName === 'write_file') return args.path ? `路径: ${args.path}` : '';
        if (toolName === 'qcc_knowledge_search') return args.query ? `查询: "${args.query}"` : '';
        if (toolName === 'qcc_tool_search') return args.goal ? `目标: ${args.goal}` : '';
        if (toolName === 'qcc_execute_tool') return (args.goal || args.name || '') ? `${args.name || ''} ${args.goal || ''}`.trim() : '';
        if (toolName === 'document_export') return args.format ? `导出: ${args.format}` : '';
        if (toolName === 'report_export') return args.title ? `报告: "${args.title}"` : '';
        try {
          const s = JSON.stringify(args);
          return s.length > 2 ? s : '';
        } catch { return ''; }
      }

      function toggleToolCard(headerEl) {
        const card = headerEl.closest('.tool-call-card');
        if (!card) return;
        const body = card.querySelector('.tool-call-body');
        const expanded = card.classList.toggle('expanded');
        if (body) body.style.display = expanded ? 'block' : 'none';
      }

      function createToolCallCard({ name, argsStr, args, icon, displayName }) {
        const card = document.createElement('div');
        card.className = 'tool-call-card';
        // 缓存卡片元数据，供复制按钮拼「标题+参数+结果」完整文本
        card._meta = {
          displayName: displayName || name || '工具调用',
          argsStr: argsStr || '',
          argsRaw: (() => { try { return JSON.stringify(args, null, 2); } catch { return String(args); } })(),
        };

        const header = document.createElement('div');
        header.className = 'tool-call-header';
        header.onclick = () => toggleToolCard(header);

        const iconSpan = document.createElement('span');
        iconSpan.className = 'tool-call-icon';
        iconSpan.textContent = icon;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tool-call-name';
        nameSpan.textContent = displayName;

        const argsInline = document.createElement('span');
        argsInline.className = 'tool-call-args-inline';
        argsInline.textContent = argsStr || '';

        const status = document.createElement('span');
        status.className = 'tool-call-status';
        status.textContent = '执行中...';

        // 复制按钮（默认隐藏，hover 卡片时显示；完成后可复制结果）
        const copyBtn = document.createElement('button');
        copyBtn.className = 'tool-call-copy';
        copyBtn.title = '复制结果';
        copyBtn.textContent = '📋';
        copyBtn.style.display = 'none';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = card._copyText || '';
          if (!text) return;
          copyToClipboard(text);
          copyBtn.textContent = '✓';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
        });

        const toggle = document.createElement('span');
        toggle.className = 'tool-call-toggle';
        toggle.textContent = '▼';

        header.appendChild(iconSpan);
        header.appendChild(nameSpan);
        if (argsStr) header.appendChild(argsInline);
        header.appendChild(status);
        header.appendChild(copyBtn);
        header.appendChild(toggle);
        card.appendChild(header);

        // body（默认折叠）
        const body = document.createElement('div');
        body.className = 'tool-call-body';
        body.style.display = 'none';

        if (argsStr) {
          const argsLabel = document.createElement('div');
          argsLabel.className = 'tool-call-body-label';
          argsLabel.textContent = '参数';
          const argsPre = document.createElement('pre');
          try { argsPre.textContent = JSON.stringify(args, null, 2); }
          catch { argsPre.textContent = String(args); }
          body.appendChild(argsLabel);
          body.appendChild(argsPre);
        }

        const resultContainer = document.createElement('div');
        resultContainer.className = 'tool-call-result-container';
        body.appendChild(resultContainer);

        card.appendChild(body);
        return card;
      }

      function updateToolCallCardDone(card, result) {
        card.classList.add('tool-done');
        const status = card.querySelector('.tool-call-status');
        if (status) status.textContent = '✓ 完成';

        const resultStr = (result == null) ? '' : (typeof result === 'string' ? result : (() => { try { return JSON.stringify(result); } catch { return String(result); } })());

        // 复制按钮：拼完整内容（标题 + 完整参数 JSON + 完整结果），而非截断/仅结果
        const meta = card._meta || {};
        const parts = [`【${meta.displayName || '工具调用'}】`];
        if (meta.argsStr) parts.push(meta.argsStr);
        if (meta.argsRaw && meta.argsRaw !== '{}') parts.push('参数：\n' + meta.argsRaw);
        if (resultStr) parts.push('结果：\n' + resultStr);
        card._copyText = parts.join('\n');
        const copyBtn = card.querySelector('.tool-call-copy');
        if (copyBtn && resultStr) copyBtn.style.display = '';

        const resultContainer = card.querySelector('.tool-call-result-container');
        if (resultContainer) {
          if (resultStr) {
            const lineCount = resultStr.split('\n').length;
            const isError = /^\[error\]/i.test(resultStr);
            const label = document.createElement('div');
            label.className = 'tool-call-body-label';
            label.textContent = isError ? '执行失败' : `执行结果 · ${lineCount} 行`;
            const preview = document.createElement('div');
            preview.className = 'tool-call-result-preview';
            preview.textContent = resultStr;
            resultContainer.appendChild(label);
            resultContainer.appendChild(preview);
          }
        }
      }
