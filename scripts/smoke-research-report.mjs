// 验证：research_report Task trigger 注入 + report_export 工具注册 + main.cjs 冒烟
import { createDefaultPipeline } from '../src/prompt-pipeline/builder.js';
import { BUSINESS_PROMPT_CATALOG } from '../src/prompt-pipeline/business-catalog.js';
import { getToolsForApi } from '../src/agent/tools.js';

let fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name); if (!ok) fail++; };

// 1. catalog 包含 research_report 节点
const node = BUSINESS_PROMPT_CATALOG.find((n) => n.id === 'business.task.research_report');
check('catalog 包含 business.task.research_report', !!node);

// 2. trigger 命中：presetId = '深度研究报告'
const pipeline = createDefaultPipeline();
const buildCtx = (extra) => ({ businessCatalog: BUSINESS_PROMPT_CATALOG, ...extra });
const ctx = buildCtx({ presetId: '深度研究报告', presetContent: '深度研究报告' });
const result = pipeline.build(ctx);
const injected = result.nodes?.find((n) => n.id === 'business.task.research_report');
check('presetId=深度研究报告 命中 research_report 注入', !!injected);
check('注入内容含 7 阶段工作流', injected && injected.content && injected.content.includes('7 阶段'));
check('注入内容含 report_export 说明', injected && injected.content && injected.content.includes('report_export'));

// 3. 不相关预设不触发
const result2 = pipeline.build(buildCtx({ presetId: '查企业信息', presetContent: '查询公司工商信息' }));
const injected2 = result2.nodes?.find((n) => n.id === 'business.task.research_report');
check('不相关预设不注入 research_report', !injected2);

// 4. 原文案 Task（工商信息）仍正常触发（不影响之前功能）
const result3 = pipeline.build(buildCtx({ presetId: '工商信息', presetContent: '工商信息' }));
const injected3 = result3.nodes?.find((n) => n.id === 'business.task.company_profile');
check('原有 Task（工商信息）仍正常注入', !!injected3);

// 5. 工具注册
const tools = getToolsForApi();
const reportTool = tools.find((t) => t.function.name === 'report_export');
check('report_export 工具已注册', !!reportTool);
check('report_export 参数含 chapters', reportTool && !!reportTool.function.parameters.properties.chapters);
const oldTools = ['web_search', 'shell', 'read_file', 'write_file', 'memory_note', 'memory_recall', 'list_skills'];
for (const t of oldTools) {
  check(`原有工具 ${t} 保留`, tools.some((x) => x.function.name === t));
}

console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
