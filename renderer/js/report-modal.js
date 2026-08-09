// report-modal.js — 深度研究报告弹窗 + 会话后追问固定入口
//
// 功能：
// 1. 在每条助手消息的推荐追问 chips 之后，固定追加「📊 深度研究报告」入口（由 messages.js 调用 window.openReportModal）
// 2. 弹窗允许用户输入方向指导（可为空）
// 3. 确认后：把本次会话内容 + 方向指导组装为研究任务，设置 activePreset 命中
//    PromptPipeline 的 research_report Task 注入（完整 7 阶段方法论），再走正常 sendMessage 链路
// 4. 报告生成期间显示进度提示；生成成功由主进程推送 artifact 事件 → chat.js 插入产物卡片

(function () {
  'use strict';

  let bound = false;

  function getEl(id) { return document.getElementById(id); }

  function openReportModal() {
    // 当前会话正在生成时不允许再发起报告任务
    const ss = getSessionState(state.currentSessionId);
    if (ss && ss.isSending) {
      showToast('当前会话正在生成中，请等待完成后再发起研究报告', 'info');
      return;
    }
    const overlay = getEl('reportModalOverlay');
    const input = getEl('reportDirectionInput');
    if (!overlay) return;
    if (input) input.value = '';
    overlay.style.display = 'flex';
    // 焦点给方向指导输入框（可选，聚焦但不自动弹键盘干扰）
    if (input) input.focus({ preventScroll: true });
  }

  function closeReportModal() {
    const overlay = getEl('reportModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * 组装会话上下文（供研究报告参考）
   * - 用户消息完整保留（≤2000 字符）
   * - 助手消息截断到 600 字符（只保留主题/结论线索）
   * - 总长度上限 ~12000 字符，优先保留最近的
   */
  function buildSessionContext(maxChars = 12000) {
    const msgs = Array.isArray(state.messages) ? state.messages : [];
    const parts = [];
    let total = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || !m.content) continue;
      if (m.role === 'artifact' || m.role === 'system') continue;
      let text = String(m.content);
      // 跳过研究报告任务自身的 prompt（含标记），避免多次生成时重复拼接
      if (text.includes('【深度研究报告任务】')) continue;
      if (m.role === 'assistant' && typeof parseRelatedQuestions === 'function') {
        text = parseRelatedQuestions(text).text || '';
      }
      text = text.replace(/<related_questions>[\s\S]*?<\/related_questions>/gi, '').trim();
      if (!text) continue;
      const roleLabel = m.role === 'user' ? '用户' : '助手';
      const limit = m.role === 'user' ? 2000 : 600;
      if (text.length > limit) text = text.slice(0, limit) + '…[已截断]';
      const line = `[${roleLabel}] ${text}`;
      if (total + line.length > maxChars) {
        parts.unshift('…[更早内容已省略]');
        break;
      }
      total += line.length;
      parts.unshift(line);
    }
    return parts.join('\n\n');
  }

  function confirmReport() {
    const directionInput = getEl('reportDirectionInput');
    const direction = directionInput ? directionInput.value.trim() : '';

    // 组装研究任务 prompt
    const sessionContext = buildSessionContext();
    const directionText = direction
      ? direction
      : '（无，按默认维度全面分析：市场规模 / 竞争格局 / 技术成熟度 / 政策与风险 / 未来趋势）';

    const taskPrompt = [
      '【深度研究报告任务】请将本次会话作为一个整体主题，进行深度研究报告，并最终输出一份专业的 PDF 报告。',
      '',
      '用户方向指导：',
      directionText,
      '',
      '=== 本次会话内容（研究参考素材，可结合 web_search 补充最新信息） ===',
      sessionContext || '（会话无历史内容，请直接围绕方向指导开展研究）',
      '',
      '执行要求：',
      '1. 先明确报告主题边界与报告类型（行业研究/方案对比/市场前景评估/主题研究），输出大纲后直接推进，无需再向用户确认。',
      '2. 用 web_search 进行多源数据采集（关键数据至少 2 个独立来源交叉验证），无法核实的数据标注数据缺口。',
      '3. 多维度打分（0-10 分 + 权重 + 置信度 + 评分依据）。',
      '4. 调用 report_export 工具生成结构化 PDF（封面/摘要/正文/评分总表/图表/参考文献）。',
      '5. 交付时给出 PDF 绝对路径、核心结论与数据局限说明。',
    ].join('\n');

    closeReportModal();

    // 命中 PromptPipeline 的 research_report Task trigger（深度研究报告方法论注入）
    state.activePreset = {
      id: 'research-report',
      title: '深度研究报告',
      label: '深度研究报告',
      prompt: taskPrompt,
    };

    if (dom.chatInput) {
      dom.chatInput.value = taskPrompt;
      dom.chatInput.style.height = 'auto';
      dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 140) + 'px';
    }
    showToast('已发起深度研究报告任务（可能需要几分钟），可切换到其他会话继续工作', 'info', 4000);

    if (typeof sendMessage === 'function') {
      sendMessage();
    }
  }

  function bindEvents() {
    if (bound) return;
    bound = true;

    const overlay = getEl('reportModalOverlay');
    const closeBtn = getEl('reportModalClose');
    const cancelBtn = getEl('reportModalCancel');
    const confirmBtn = getEl('reportModalConfirm');
    const directionInput = getEl('reportDirectionInput');

    if (closeBtn) closeBtn.addEventListener('click', closeReportModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeReportModal);
    if (confirmBtn) confirmBtn.addEventListener('click', confirmReport);
    if (overlay) {
      // 点击遮罩空白处关闭（不关闭弹窗内部）
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeReportModal();
      });
    }
    if (directionInput) {
      // Cmd/Ctrl + Enter 直接确认
      directionInput.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          confirmReport();
        }
      });
    }
    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && getEl('reportModalOverlay')?.style.display === 'flex') {
        closeReportModal();
      }
    });
  }

  // DOM ready 后绑定（幂等）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }

  // 暴露给 messages.js 的追问 chips 调用
  window.openReportModal = openReportModal;
  window.closeReportModal = closeReportModal;
})();
