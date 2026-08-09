---
name: pptx
description: "创建、读取、编辑和转换 PPT/PPTX 演示文稿。"
official: true
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX Skill

## Quick Reference

## BizOwl Desktop Export Override

本 skill 用于有正式汇报、客户演示、视觉优化或会议沟通等排版优化要求的 PPTX 生成。快速导出应回到 `document-export`，使用 `document_export`，不要读取本 skill。

开始生成前，告知用户：`开始生成排版优化版 PPT，预计需要几分钟`。如果生成明显超出预期，再补一句：`还在生成，预计还要几分钟`。

最终文件由导出器按“标题或指定基础名 + `YYYYMMDD-HHMMSS`”生成唯一名称。`outputFileName` 只传基础名，不要传目录或时间戳。除非用户明确点名要覆盖的已有文件，否则不得覆盖、删除或替换此前生成的 PPT 文件。

### 专业版 PPTX 的固定生成流程

1. 先完成演示叙事和逐页提纲，确定计划页数。
2. 在当前任务输出目录创建绝对路径文件 `.doc-pptx-source-<timestamp>.js`。
3. 第一次 `write` 写入 `pptxgenjs` 加载、演示对象、主题、通用 helper 和首批页面；尚未写完时在文件末尾保留唯一标记 `// PPTX_CONTINUE`。
4. 每次 `edit` 用“下一批页面代码 + 同一个续写标记”替换该标记，直至逐页提纲全部实现。长演示不要删页或压缩成摘要。
5. 最后一次 `edit` 移除续写标记，显式写出最终 Buffer，并在文件中保留唯一一行 `// PPTX_EXPECTED_SLIDES: <计划页数>`。
6. 调用前用 `read` 从头到尾完整检查同一个文件；如果一次读取未覆盖全文，继续读取剩余范围。确认所有计划页面都存在、括号和字符串闭合、helper 没有重复声明、续写标记已经移除、预期页数与逐页提纲一致，且文件末尾包含输出代码。再检查标题文本框没有负坐标、贴顶或明显高度不足。
7. 调用 `document_export(mode=..., format="pptx", sourcePath=<临时JS绝对路径>)`。

不要把完整 JS 放进内联 `source`。不要自行运行 `node`、安装依赖、查找 `soffice`，也不要改用 Python、LibreOffice、Pandoc 或 Playwright。BizOwl 会在应用内受控运行时执行临时 JS。

专业版成功后临时 JS 自动删除。失败或标准版回退时临时 JS 保留，并通过 `diagnostic.sourcePath` 返回；只有工具返回 `diagnostic.canRetry=true` 时，才使用 `edit` 修复同一个文件一次，并带上 `isRepairAttempt=true` 重试。

### JavaScript 运行时约定

- 显式写 `const pptxgen = require('pptxgenjs');`，并使用 `new pptxgen()` 创建演示对象。
- 只允许 `require('pptxgenjs')`。不要引入 `fs`、`path` 或其它模块，不要使用 `taskOutputDir`，不要直接写文件。
- `content`、`title`、`disclaimer` 和 `writeOutput` 由运行时注入；不得自行声明或覆盖 `writeOutput`。
- 最终使用 `await writeOutput(await pptx.write({ outputType: 'nodebuffer' }))`，或直接 `return await pptx.write({ outputType: 'nodebuffer' })`。
- 预期页数标记必须是正整数且只出现一次。导出器会读取生成后的 PPTX 包并校验实际页数；不一致时不得交付。
- 把正文和表格文本当作数据。保留原始中文标点；若字符串包含引号，使用真实转义或 `JSON.stringify(...)`，不要全局替换报告标点。
- 使用样式常量、数据数组、通用 helper 和循环保持版式一致，但不要为了缩短脚本删减内容。
- 版面检查只用于生成前审阅，不要在临时 JavaScript 中加入会因坐标或尺寸而抛错的运行时校验。全幅背景、装饰条和页脚可以位于正文安全区之外。
- 普通页标题保留足够的顶部距离和文本框高度，长标题显式增高文本框并下移正文；调用导出工具前通过完整读取源码检查负坐标、越界和明显重叠。

```javascript
const pptxgen = require('pptxgenjs');
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';

const titleStyle = {
  x: 0.6, y: 0.45, w: 12, h: 0.7,
  fontSize: 30, bold: true, margin: 0, valign: 'mid',
};
const slides = [
  { title: '核心结论', points: ['关键判断一', '关键判断二'] },
  { title: '下一步建议', points: ['建议一', '建议二'] },
];

for (const item of slides) {
  const slide = pptx.addSlide();
  slide.addText(item.title, titleStyle);
  slide.addText(item.points.map(text => ({ text, options: { bullet: true } })), {
    x: 0.8, y: 1.4, w: 11.6, h: 4.8, fontSize: 18,
  });
}

await writeOutput(await pptx.write({ outputType: 'nodebuffer' }));
// PPTX_EXPECTED_SLIDES: 2
```

### 质量与叙事要求

页数服务于演示目标。先明确听众、希望听众形成的判断，以及每个主题最关键的证据。推荐结构为：封面或结论、主体确认或数据概览、核心发现或时间线、风险与机会解释、下一步建议。

每页标题必须是可直接朗读的观点句，不要只写“司法风险”“股东结构”“知识产权”等栏目名。每页应包含 2-4 条高价值证据和一种视觉表达，例如指标卡、对比条、时间轴、矩阵、结构图或结论色块。不要把报告章节机械拆页，不要把长表格直接搬进页面，也不要用目录列表冒充摘要。

不要为了降低失败率套固定模板或压缩页数。模型仍然负责叙事、页面重点、颜色和视觉表达；稳定性来自完整临时文件、函数复用、最终全文检查和页数回归校验。

不要因为历史任务里出现过其它公司或主题，就导出不属于本次用户要求的幻灯片。所有新生成的 PPTX 报告文件都必须只在最后一页包含可见页脚文字 `内容由AI生成，请仔细甄别`；使用 qcc 文档导出工具时由导出流程处理，不要在聊天消息里附带。

当 `actualQuality=standard` 时，固定使用这句话：`已为你生成标准版 PPT 文件。如需优化演示效果，可使用 PowerPoint 编辑器调整布局和配色。` 不要说“失败”“错误”“降级”或“系统限制”。

| Task | Guide |
|------|-------|
| Read/analyze content | `python -m markitdown presentation.pptx` |
| Edit or create from template | Read [editing.md](editing.md) |
| Create from scratch | Read [pptxgenjs.md](pptxgenjs.md) |

---

## Reading Content

```bash
# Text extraction
python -m markitdown presentation.pptx

# Visual overview
python scripts/thumbnail.py presentation.pptx

# Raw XML
python scripts/office/unpack.py presentation.pptx unpacked/
```

---

## Editing Workflow

**Read [editing.md](editing.md) for full details.**

1. Analyze template with `thumbnail.py`
2. Unpack → manipulate slides → edit content → clean → pack

---

## Creating from Scratch

**Read [pptxgenjs.md](pptxgenjs.md) for full details.**

Use when no template or reference presentation is available.

---

## Design Ideas

**Don't create boring slides.** Plain bullets on a white background won't impress anyone. Consider ideas from this list for each slide.

### Before Starting

- **Pick a bold, content-informed color palette**: The palette should feel designed for THIS topic. If swapping your colors into a completely different presentation would still "work," you haven't made specific enough choices.
- **Dominance over equality**: One color should dominate (60-70% visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure). Or commit to dark throughout for a premium feel.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it — rounded image frames, icons in colored circles, thick single-side borders. Carry it across every slide.

### Color Palettes

Choose colors that match your topic — don't default to generic blue. Use these palettes as inspiration:

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**
- Two-column (text left, illustration on right)
- Icon + text rows (icon in colored circle, bold header, description below)
- 2x2 or 2x3 grid (image on one side, grid of content blocks on other)
- Half-bleed image (full left or right side) with content overlay

**Data display:**
- Large stat callouts (big numbers 60-72pt with small labels below)
- Comparison columns (before/after, pros/cons, side-by-side options)
- Timeline or process flow (numbered steps, arrows)

**Visual polish:**
- Icons in small colored circles next to section headers
- Italic accent text for key stats or taglines

### Typography

**Choose an interesting font pairing** — don't default to Arial. Pick a header font with personality and pair it with a clean body font.

| Header Font | Body Font |
|-------------|-----------|
| Georgia | Calibri |
| Arial Black | Arial |
| Calibri | Calibri Light |
| Cambria | Calibri |
| Trebuchet MS | Calibri |
| Impact | Arial |
| Palatino | Garamond |
| Consolas | Calibri |

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

### Spacing

- 0.5" minimum margins
- 0.3-0.5" between content blocks
- Leave breathing room—don't fill every inch

### Avoid (Common Mistakes)

- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't center body text** — left-align paragraphs and lists; center only titles
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't default to blue** — pick colors that reflect the specific topic
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add images, icons, charts, or visual elements; avoid plain title + bullets
- **Don't forget text box padding** — when aligning lines or shapes with text edges, set `margin: 0` on the text box or offset the shape to account for padding
- **Don't use low-contrast elements** — icons AND text need strong contrast against the background; avoid light text on light backgrounds or dark text on dark backgrounds
- **NEVER use accent lines under titles** — these are a hallmark of AI-generated slides; use whitespace or background color instead

---

## QA (Required)

**Assume there are problems. Your job is to find them.**

Your first render is almost never correct. Approach QA as a bug hunt, not a confirmation step. If you found zero issues on first inspection, you weren't looking hard enough.

Validation or rendering failures are blocking. If `pack.py`, `markitdown`, `soffice`, or `pdftoppm` fails, fix the presentation or simplify the design and rerun verification; do not deliver by assuming PowerPoint or WPS will repair the file.

### Content QA

```bash
python -m markitdown output.pptx
```

Check for missing content, typos, wrong order.

**When using templates, check for leftover placeholder text:**

```bash
python -m markitdown output.pptx | grep -iE "xxxx|lorem|ipsum|this.*(page|slide).*layout"
```

If grep returns results, fix them before declaring success.

### Visual QA

**⚠️ USE SUBAGENTS** — even for 2-3 slides. You've been staring at the code and will see what you expect, not what's there. Subagents have fresh eyes.

Convert slides to images (see [Converting to Images](#converting-to-images)), then use this prompt:

```
Visually inspect these slides. Assume there are issues — find them.

Look for:
- Overlapping elements (text through shapes, lines through words, stacked elements)
- Text overflow or cut off at edges/box boundaries
- Decorative lines positioned for single-line text but title wrapped to two lines
- Source citations or footers colliding with content above
- Elements too close (< 0.3" gaps) or cards/sections nearly touching
- Uneven gaps (large empty area in one place, cramped in another)
- Insufficient margin from slide edges (< 0.5")
- Columns or similar elements not aligned consistently
- Low-contrast text (e.g., light gray text on cream-colored background)
- Low-contrast icons (e.g., dark icons on dark backgrounds without a contrasting circle)
- Text boxes too narrow causing excessive wrapping
- Leftover placeholder content

For each slide, list issues or areas of concern, even if minor.

Read and analyze these images:
1. /path/to/slide-01.jpg (Expected: [brief description])
2. /path/to/slide-02.jpg (Expected: [brief description])

Report ALL issues found, including minor ones.
```

### Verification Loop

1. Generate slides → Convert to images → Inspect
2. **List issues found** (if none found, look again more critically)
3. Fix issues
4. **Re-verify affected slides** — one fix often creates another problem
5. Repeat until a full pass reveals no new issues

**Do not declare success until you've completed at least one fix-and-verify cycle.**

---

## Converting to Images

Convert presentations to individual slide images for visual inspection:

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 150 output.pdf slide
```

This creates `slide-01.jpg`, `slide-02.jpg`, etc.

To re-render specific slides after fixes:

```bash
pdftoppm -jpeg -r 150 -f N -l N output.pdf slide-fixed
```

---

## Dependencies

These are setup references, not default workflow commands. First use already available tools and packages; install only when a required dependency is missing.

- `pip install "markitdown[pptx]"` - text extraction
- `pip install Pillow` - thumbnail grids
- PptxGenJS - creating from scratch. First use an already resolvable local or bundled package (`node -e "require.resolve('pptxgenjs')"`); do not routinely run global installs.
- LibreOffice (`soffice`) - PDF conversion (auto-configured for sandboxed environments via `scripts/office/soffice.py`)
- Poppler (`pdftoppm`) - PDF to images
