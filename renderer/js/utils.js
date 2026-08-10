// utils.js — renderer module (split from index.html)

      function renderTables(html) {
        const lines = html.split('\n');
        const result = [];
        let i = 0;
        while (i < lines.length) {
          const line = lines[i].trim();
          // 检测表格行（包含 |）
          if (line.startsWith('|') && line.endsWith('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
              tableLines.push(lines[i].trim());
              i++;
            }
            if (tableLines.length >= 2) {
              // 解析表格
              const rows = tableLines.map(l => l.slice(1, -1).split('|').map(c => c.trim()));
              // 第二行是分隔线（|---|---|）
              const isSep = rows[1] && rows[1].every(c => /^[-:]+$/.test(c));
              let tableHtml = '<table class="md-table"><thead>';
              if (isSep) {
                tableHtml += '<tr>' + rows[0].map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
                for (let r = 2; r < rows.length; r++) {
                  tableHtml += '<tr>' + rows[r].map(c => `<td>${c}</td>`).join('') + '</tr>';
                }
              } else {
                tableHtml += '<tr>' + rows[0].map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
                for (let r = 1; r < rows.length; r++) {
                  tableHtml += '<tr>' + rows[r].map(c => `<td>${c}</td>`).join('') + '</tr>';
                }
              }
              tableHtml += '</tbody></table>';
              result.push(tableHtml);
              continue;
            }
          }
          result.push(lines[i]);
          i++;
        }
        return result.join('\n');
      }

      // ─────────────────────────────────────────────
      // 调试日志
      // ─────────────────────────────────────────────
      const debugPanel = document.getElementById('debugPanel');
      const debugContent = document.getElementById('debugContent');
      const _log = console.log.bind(console);
      const _err = console.error.bind(console);

      function debugLog(...args) {
        _log('[UI]', ...args);
        const time = new Date().toLocaleTimeString();
        const text = args.map(a => {
          try { return typeof a === 'object' ? JSON.stringify(a).slice(0, 120) : String(a); }
          catch { return String(a); }
        }).join(' ');
        if (debugContent) {
          debugContent.textContent += `[${time}] ${text}\n`;
          debugContent.scrollTop = debugContent.scrollHeight;
        }
        // 写入文件日志
        if (api?.writeLog) {
          try { api.writeLog('info', 'renderer', text); } catch {}
        }
      }
      function debugError(...args) {
        _err('[UI]', ...args);
        const time = new Date().toLocaleTimeString();
        const text = args.map(a => {
          try { return typeof a === 'object' ? (a.message || JSON.stringify(a)).slice(0, 120) : String(a); }
          catch { return String(a); }
        }).join(' ');
        if (debugContent) {
          debugContent.textContent += `[${time}] ❌ ${text}\n`;
          debugContent.scrollTop = debugContent.scrollHeight;
        }
        if (api?.writeLog) {
          try { api.writeLog('error', 'renderer', text); } catch {}
        }
      }

      // ─────────────────────────────────────────────
      // 工具函数
      // ─────────────────────────────────────────────
      function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, (c) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
      }

      function formatTime(iso) {
        try {
          const d = new Date(iso);
          const now = new Date();
          const diff = now - d;
          if (diff < 60000) return '刚刚';
          if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
          if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
          if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
          return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        } catch { return ''; }
      }

      // Apple 风格 toast：白色毛玻璃卡片 + 彩色类型圆点 + 深色文字
      function showToast(msg, type = 'info', duration = 2500) {
        // 类型 → 圆点颜色 + 图标
        const DOT = {
          error:   { color: '#FF3B30', icon: '✕' },
          success: { color: '#34C759', icon: '✓' },
          info:    { color: '#0066CC', icon: 'i' },
        }[type] || { color: '#0066CC', icon: 'i' };

        const banner = document.createElement('div');
        banner.style.cssText = `
          position: fixed; top: 54px; left: 50%;
          transform: translateX(-50%) translateY(-8px);
          display: flex; align-items: center; gap: 8px;
          padding: 9px 16px 9px 10px;
          border-radius: 999px;
          font-size: 13px; font-weight: 500;
          color: var(--ink);
          letter-spacing: -0.15px;
          background: rgba(255, 255, 255, 0.82);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border: 0.5px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06);
          z-index: 99999;
          opacity: 0;
          transition: opacity 0.25s cubic-bezier(0.32, 0.72, 0, 1), transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
          pointer-events: none;
          max-width: 80vw;
        `;

        // 类型圆点
        const dot = document.createElement('span');
        dot.style.cssText = `
          width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
          background: ${DOT.color};
          color: #fff; font-size: 11px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          line-height: 1;
        `;
        dot.textContent = DOT.icon;
        banner.appendChild(dot);

        const label = document.createElement('span');
        label.textContent = msg;
        label.style.cssText = 'line-height: 1.35; white-space: pre-line;';
        banner.appendChild(label);

        document.body.appendChild(banner);
        requestAnimationFrame(() => {
          banner.style.opacity = '1';
          banner.style.transform = 'translateX(-50%) translateY(0)';
        });
        setTimeout(() => {
          banner.style.opacity = '0';
          banner.style.transform = 'translateX(-50%) translateY(-8px)';
          setTimeout(() => banner.remove(), 260);
        }, duration);
      }

      function copyToClipboard(text) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
          fallbackCopy(text);
        }
      }
      function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
      }

      function scrollToBottom() {
        requestAnimationFrame(() => {
          dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
        });
      }
      // 仅在用户贴近底部时自动滚动（流式输出时用，避免用户上滑阅读被强制拉回）
      function maybeScrollToBottom() {
        const el = dom.chatMessages;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 120) el.scrollTop = el.scrollHeight;
      }
