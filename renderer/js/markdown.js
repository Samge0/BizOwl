// markdown.js — renderer module (split from index.html)

      // ─────────────────────────────────────────────
      // 轻量 Markdown 渲染器（无外部依赖）
      // ─────────────────────────────────────────────

      // ── KaTeX 动态加载（按需，只加载一次）──
      let _katexLoaded = null;
      function ensureKatex() {
        if (_katexLoaded) return _katexLoaded;
        _katexLoaded = new Promise((resolve) => {
          if (window.katex) { resolve(window.katex); return; }
          // CSS
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
          document.head.appendChild(link);
          // JS
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
          s.onload = () => resolve(window.katex);
          s.onerror = () => {
            console.warn('[KaTeX] CDN 加载失败，尝试备用源');
            // 备用源：unpkg
            const s2 = document.createElement('script');
            s2.src = 'https://unpkg.com/katex@0.16.11/dist/katex.min.js';
            s2.onload = () => resolve(window.katex);
            s2.onerror = () => { console.warn('[KaTeX] 备用源也失败'); resolve(null); };
            document.head.appendChild(s2);
          };
          document.head.appendChild(s);
        });
        return _katexLoaded;
      }

      /** 用 KaTeX 渲染所有 .katex-render 元素（块级+行内） */
      function renderKatexInContainer(container) {
        const els = container.querySelectorAll('.katex-render');
        if (els.length === 0) return;
        ensureKatex().then((katex) => {
          if (!katex) return;
          els.forEach(el => {
            if (el._katexDone) return;
            el._katexDone = true;
            const latex = el.dataset.latex || '';
            const displayMode = el.dataset.display === '1';
            try {
              katex.render(latex, el, {
                displayMode,
                throwOnError: false,
                errorColor: '#FF3B30',
                strict: false,
                // 仅放行安全协议的外链，阻断 \href{javascript:...} / \url{data:...} 等 XSS
                trust: (ctx) => {
                  if (!ctx || !ctx.command) return false;
                  if (/^(\\href|\\url|\\includegraphics)$/.test(ctx.command)) {
                    return /^(https?:|mailto:|tel:|\/|\.\/|\.\.\/)/i.test(String(ctx.url || ''));
                  }
                  return false;
                },
              });
            } catch (e) {
              el.textContent = latex;
            }
          });
        });
      }

      /** 渲染引用块内部内容：表格 + 行内样式（加粗/斜体/链接/行内代码） */
      function renderInlineMarkdown(text) {
        if (!text) return '';
        let h = text;
        // 行内代码（引用块内可能还有 `code`）— 先提取为占位符
        const inlineCodes = [];
        h = h.replace(/`([^`]+)`/g, (m, code) => {
          const idx = inlineCodes.length;
          inlineCodes.push('<code class="md-inline-code">' + escapeHtml(code) + '</code>');
          return `\x01INLI${idx}\x01`;
        });
        // ★ XSS 防护：对正文做 HTML 实体转义
        h = escapeHtml(h);
        // 表格
        h = renderTables(h);
        // 加粗和斜体
        h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // 链接 — 对 href 做 sanitize 防止 javascript: 等危险协议
        h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
          const safeUrl = /^(https?:|mailto:|tel:|\/|#)/i.test(url) ? url : '#';
          return `<a class="md-a" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
        });
        // 恢复行内代码
        h = h.replace(/\x01INLI(\d+)\x01/g, (m, idx) => inlineCodes[parseInt(idx)] || '');
        // 换行
        h = h.replace(/\n/g, '<br>');
        return h;
      }

      function renderMarkdown(md) {
        if (!md) return '';
        let html = md;

        // 剥离推荐追问块（由 buildMessageEl 单独渲染为可点击 chips）
        // 结束标签可选：模型偶发截断、缺少 </related_questions> 时也剥离到末尾，避免露出原始 JSON 文本（含流式渲染中途）
        html = html.replace(/<related_questions>[\s\S]*?(?:<\/related_questions>|$)/g, '');

        // 提取代码块/行内代码/mermaid 为占位符，再对正文做 HTML 实体转义（防 XSS）
        const codeBlocks = [];
        // 先提取 mermaid 代码块（特殊处理：渲染为可交互图表）
        const mermaidBlocks = [];
        html = html.replace(/```mermaid\n?([\s\S]*?)```/g, (m, code) => {
          const idx = mermaidBlocks.length;
          mermaidBlocks.push(code.trim());
          return `\x02MERMAID${idx}\x02`;
        });
        // 兼容：检测未包裹在代码块中的 mermaid 语法（AI 偶尔不遵守格式）
        // 仅在行首匹配精确的 mermaid 关键字 + 空格
        const mermaidKeywords = /\n(graph (TD|LR|RL|BT|TB)\n|flowchart (TD|LR|RL|BT|TB)\n|xychart-beta\n|pie title\n|sequenceDiagram\n|mindmap\n|gantt\n|classDiagram\n|stateDiagram\n|erDiagram\n|journey )/;
        if (mermaidKeywords.test('\n' + html) && !html.includes('\x02MERMAID')) {
          html = html.replace(/\n(graph (?:TD|LR|RL|BT|TB)|flowchart (?:TD|LR|RL|BT|TB)|xychart-beta|pie title|sequenceDiagram|mindmap|gantt|classDiagram|stateDiagram|erDiagram|journey )([\s\S]*?)(?=\n\n|\n#|\n---|\n$|$)/g, (m, prefix, rest) => {
            const idx = mermaidBlocks.length;
            mermaidBlocks.push((prefix + rest).trim());
            return '\n\x02MERMAID' + idx + '\x02';
          });
        }
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
          const idx = codeBlocks.length;
          codeBlocks.push('<pre class="md-code"><code>' + escapeHtml(code.trim()) + '</code></pre>');
          return `\x00CODEBLOCK${idx}\x00`;
        });

        // 行内代码
        const inlineCodes = [];
        html = html.replace(/`([^`]+)`/g, (m, code) => {
          const idx = inlineCodes.length;
          inlineCodes.push('<code class="md-inline-code">' + escapeHtml(code) + '</code>');
          return `\x01INLINE${idx}\x01`;
        });

        // LaTeX 公式提取（在 HTML 转义和 markdown 语法处理之前，保护原始 LaTeX）
        const katexFormulas = [];
        // 块级公式 $$...$$
        html = html.replace(/\$\$([\s\S]+?)\$\$/g, (m, latex) => {
          const idx = katexFormulas.length;
          katexFormulas.push({ latex: latex.trim(), display: true });
          return `\x03KATEX${idx}\x03`;
        });
        // 行内公式 $...$（排除 $$ 和空内容；不匹配跨行）
        html = html.replace(/\$([^\$\n]{1,})\$/g, (m, latex) => {
          // 跳过明显不是公式的（如纯数字价格 $5）
          if (/^\d+$/.test(latex.trim())) return m;
          const idx = katexFormulas.length;
          katexFormulas.push({ latex: latex.trim(), display: false });
          return `\x03KATEX${idx}\x03`;
        });

        // 引用块提取（先剥离 > 前缀，内部内容走完整 markdown 管线，支持表格/加粗等）
        const quoteBlocks = [];
        html = html.replace(/((?:^>.*(?:\n|$))+)/gm, (block) => {
          const idx = quoteBlocks.length;
          const inner = block.replace(/^>\s?/gm, '').trim();
          quoteBlocks.push(inner);
          return `\x04QUOTE${idx}\x04`;
        });

        // ★ XSS 防护核心：对正文做 HTML 实体转义
        // 此时所有代码块/行内代码/mermaid/katex/引用块都已被替换为占位符（\x00-\x04 前缀），
        // 不会被 escapeHtml 影响。占位符本身只含控制字符+数字+\x02 等安全字符。
        html = escapeHtml(html);

        // 表格（简化版：| col1 | col2 | 格式）
        html = renderTables(html);

        // 标题（h1-h6，每级独立 class 对应不同样式）
        html = html.replace(/^###### (.+)$/gm, '<h6 class="md-h6">$1</h6>');
        html = html.replace(/^##### (.+)$/gm, '<h5 class="md-h5">$1</h5>');
        html = html.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

        // 分割线
        html = html.replace(/^---+$/gm, '<hr class="md-hr">');

        // 加粗和斜体
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // 链接 [text](url) — 对 href 做 sanitize 防止 javascript: 等危险协议
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
          const safeUrl = /^(https?:|mailto:|tel:|\/|#)/i.test(url) ? url : '#';
          return `<a class="md-a" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        });

        // 列表
        html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => '<ul class="md-ul">' + m + '</ul>');
        html = html.replace(/<\/ul>\s*<ul[^>]*>/g, ''); // 合并相邻 ul

        // 有序列表
        html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
        html = html.replace(/(<oli>[\s\S]*?<\/oli>)/g, (m) => '<ol class="md-ol">' + m.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>') + '</ol>');

        // 段落（双换行分段）
        html = html.replace(/\n\n+/g, '\n\n');
        const paragraphs = html.split('\n\n');
        html = paragraphs.map(p => {
          p = p.trim();
          if (!p) return '';
          if (p.startsWith('<') && (p.endsWith('>') || p.includes('</'))) return p;
          return '<p class="md-p">' + p.replace(/\n/g, '<br>') + '</p>';
        }).join('\n');

        // 恢复引用块（内部内容已走完整 markdown 管线：表格/加粗/行内代码等）
        html = html.replace(/\x04QUOTE(\d+)\x04/g, (m, idx) => {
          const inner = quoteBlocks[parseInt(idx)];
          if (!inner) return '';
          // 递归渲染引用块内部（表格、加粗、链接等）
          const innerHtml = renderInlineMarkdown(inner);
          return '<blockquote class="md-quote">' + innerHtml + '</blockquote>';
        });

        // 恢复代码块和行内代码
        html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (m, idx) => codeBlocks[parseInt(idx)]);
        html = html.replace(/\x01INLINE(\d+)\x01/g, (m, idx) => inlineCodes[parseInt(idx)]);

        // 恢复 LaTeX 公式为 KaTeX 渲染容器
        html = html.replace(/\x03KATEX(\d+)\x03/g, (m, idx) => {
          const f = katexFormulas[parseInt(idx)];
          if (!f) return '';
          const tag = f.display ? 'div' : 'span';
          return `<${tag} class="katex-render ${f.display ? 'katex-display-block' : 'katex-inline'}" data-latex="${escapeHtml(f.latex)}" data-display="${f.display ? '1' : '0'}"></${tag}>`;
        });

        // 恢复 Mermaid 图表（渲染为 wrapper > [mermaid-code div + toolbar]）
        // 关键：toolbar HTML 不能放在 .mermaid div 内部，否则 mermaid.run() 会把
        // toolbar 的 HTML 当作图表语法解析，导致 Parse error / 炸弹图标。
        html = html.replace(/\x02MERMAID(\d+)\x02/g, (m, idx) => {
          const code = mermaidBlocks[parseInt(idx)];
          const escaped = escapeHtml(code);
          return `<div class="mermaid-wrapper" data-mermaid-code="${encodeURIComponent(code)}">` +
            `<div class="mermaid">${escaped}</div>` +
            `<div class="mermaid-toolbar">` +
              `<button class="mermaid-zoom" title="放大预览"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>` +
              `<button class="mermaid-copy" title="复制代码"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` +
            `</div>` +
          `</div>`;
        });

        return html;
      }
