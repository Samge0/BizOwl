// smoke test: mermaid 块清理 + 竞态相关（不需要 electron）
import { renderReportHtml } from '../src/report/report-export.js';

let fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name); if (!ok) fail++; };

// mermaid 块清理
const html = renderReportHtml({
  title: 'mermaid 测试',
  chapters: [{
    title: 'ch',
    sections: [{
      heading: 'h',
      body: '<p>正常内容</p><pre><code class="language-mermaid">graph TD\n  A-->B</code></pre><div class="mermaid">pie title test\n  "A" : 50</div><p>尾部</p>',
    }],
  }],
  references: [],
});
check('mermaid pre/code 块被清理', !html.includes('language-mermaid'));
check('mermaid div 块被清理', !html.includes('class="mermaid"'));
check('正常内容保留', html.includes('正常内容') && html.includes('尾部'));
check('替换为提示文字', html.includes('[此处为图表'));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
