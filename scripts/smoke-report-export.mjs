// smoke test: report-export.js 模板渲染 + 数据校验（不需要 electron）
import { renderReportHtml } from '../src/report/report-export.js';

let fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name); if (!ok) fail++; };

// ─── 场景 1：完整数据渲染 ───
const html = renderReportHtml({
  title: '测试报告',
  subtitle: '冒烟测试',
  report_type: '主题研究',
  date: '2026-08-08',
  abstract: '摘要第一段。\n\n摘要第二段。',
  total_score: '7.4',
  confidence: '中',
  chapters: [{ title: '第一章 背景', sections: [{ heading: '1.1 概述', body: '<p>正文内容 <strong>加粗</strong></p>' }] }],
  score_table: { headers: ['维度', '权重', '得分', '置信度', '依据'], rows: [['市场规模', '20%', '7.5', '高', '依据文本']] },
  charts_html: '<div class="chart-box"><div class="chart-title">测试图表</div><div class="bar-row"><div class="bar-label">A公司</div><div class="bar-track"><div class="bar-fill" style="width:70%"></div></div><div class="bar-val">70亿</div></div></div>',
  references: [{ id: 1, title: '来源A', url: 'https://example.com', accessed: '2026-08-08' }],
  appendix: '<section class="chapter"><h2>附录</h2><p>数据缺口说明</p></section>',
});

check('封面 badge', html.includes('BIZOWL · 深度研究报告'));
check('标题', html.includes('测试报告'));
check('摘要分段', html.includes('</p><p>'));
check('总评分', html.includes('7.4'));
check('章节渲染', html.includes('第一章 背景') && html.includes('1.1 概述'));
check('评分表', html.includes('score-table') && html.includes('市场规模'));
check('图表', html.includes('chart-box') && html.includes('bar-fill'));
check('参考文献', html.includes('example.com') && html.includes('访问'));
check('附录', html.includes('数据缺口说明'));
check('无残留占位符', !html.includes('{{'));

// ─── 场景 2：新增图表组件 ───
const html2 = renderReportHtml({
  title: '图表测试',
  chapters: [{ title: 'ch1', sections: [{ heading: 'h', body: '' }] }],
  references: [],
  score_table: {},
});
check('时间线样式存在', html2.includes('.timeline'));
check('KPI 样式存在', html2.includes('.kpi-grid'));
check('评分卡样式存在', html2.includes('.score-cards'));
check('进度环样式存在', html2.includes('.ring-row'));
check('bar-label 百分比宽度', html2.includes('width: 34%'));

// ─── 场景 3：分页清理 ───
const html3 = renderReportHtml({
  title: '分页测试',
  chapters: [{
    title: 'ch',
    sections: [{ heading: 'h', body: '<div style="page-break-before:always">强制分页</div><p style="page-break-after:always">x</p>' }],
  }],
  references: [],
});
check('清理 page-break-before:always', !html3.includes('page-break-before:always'));
check('清理 page-break-after:always', !html3.includes('page-break-after:always'));
check('保留内容文字', html3.includes('强制分页'));

// ─── 场景 4：undefined/空章节过滤 ───
const html4 = renderReportHtml({
  title: '空章测试',
  chapters: [
    { title: undefined, sections: [] },  // 全空，应跳过
    { title: '有效章', sections: [{ heading: 'h', body: '正文' }] },
    { title: '', sections: [{ heading: '', body: '' }] },  // 全空，应跳过
  ],
  references: [],
});
check('过滤 undefined 章节标题', !html4.includes('undefined'));
check('保留有效章节', html4.includes('有效章'));

// ─── 场景 5：评分总表/参考文献不再独占页（section 标签不带 page-break class）───
// 旧的模板是 <section class="chapter page-break">，新模板改为 <section class="chapter">
check('评分总表 section 无 page-break class', (() => {
  const idx = html.indexOf('评分总表');
  if (idx < 0) return false;
  const before = html.slice(Math.max(0, idx - 60), idx);
  return !before.includes('class="chapter page-break"');
})());
check('参考文献 section 无 page-break class', (() => {
  const idx = html.indexOf('参考文献');
  if (idx < 0) return false;
  const before = html.slice(Math.max(0, idx - 60), idx);
  return !before.includes('class="chapter page-break"');
})());
check('模板无 .chapter.page-break CSS 规则', !html.includes('.chapter.page-break'));

console.log(fail === 0 ? `\nALL PASS (${html.length} chars)` : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
