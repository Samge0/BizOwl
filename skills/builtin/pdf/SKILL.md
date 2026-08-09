---
name: pdf
description: 阅读、提取、合并、拆分、转换和处理 PDF 文件。
license: Proprietary. LICENSE.txt has complete terms
official: true
---

# PDF Processing Guide

## Overview

This guide covers essential PDF processing operations using Python libraries and command-line tools. For advanced features, JavaScript libraries, and detailed examples, see REFERENCE.md. If you need to fill out a PDF form, read FORMS.md and follow its instructions.

## BizOwl Desktop Export Override

本 skill 用于有封面、目录、排版优化或正式汇报等排版优化要求的 PDF 生成。快速导出应回到 `document-export`，使用 `document_export` 工具，不要读取本 skill。

开始生成前，告知用户：`开始生成排版优化版 PDF，预计需要几分钟`。如果生成明显超出预期，再补一句：`还在生成，预计还要几分钟`。

最终文件由导出器按“标题或指定基础名 + `YYYYMMDD-HHMMSS`”生成唯一名称。`outputFileName` 只传基础名，不要传目录或时间戳。除非用户明确点名要覆盖的已有文件，否则不得覆盖、删除或替换此前生成的 PDF 文件。

**排版优化策略**：根据交付意图选择渲染路径：

- 展示型 / 只读报告：使用 `write` / `edit` 分段编写完整 HTML/CSS 文件，通过 `sourcePath` 调用 `document_export`。`sourcePath` 指向的 HTML 就是最终文档正文，BizOwl 会复用应用内 Electron `printToPDF` 输出 PDF。
- PDF 原生处理：只有在合并、拆分、表单、加水印等非报告导出任务中，才使用 PDF 原生工具。

报告导出时，不要自己运行 `node`、安装依赖、查找 `soffice`、使用 Playwright，或切换到 Python / LibreOffice / Pandoc。HTML 写完后只通过 `sourcePath` 调用 `document_export`，禁止传内联 `source`。若工具返回 `diagnostic.canRetry=true`，只修复同一个临时 HTML 文件一次，并带上 `isRepairAttempt=true` 再调用一次。

当 `actualQuality=standard` 时，固定使用这句话：`已为你生成标准版 PDF 文件。如需调整排版，可使用 Word/Excel 编辑器进一步美化。` 不要说“失败”“错误”“降级”或“系统限制”。

不要因为历史任务里出现过其它公司或主题，就导出不属于本次用户要求的报告。
所有新生成的 PDF 报告文件都必须包含可见页脚文字 `内容由AI生成，请仔细甄别`。使用 qcc 文档导出工具时会自动添加；只有兜底或自定义 PDF 生成时才需要自行添加。这个页脚只写进导出文件本身，不要在聊天消息里附带。

对于正式汇报风格的 PDF 报告，如果 `../frontend-design/SKILL.md` 可用，在做版式决策前先读取它。可以把它作为视觉质量参考，但成品必须保持商务报告语气，不要做成营销落地页。

中文 / CJK 内容中，除非最终渲染确实坏了，否则保留原始标点和引号风格。不要为了样式反复标准化中文引号、全角标点或类似细节。如果某个字体族渲染不好，应切换字体或渲染路径，不要反复改写正文。

编写 Python / JavaScript PDF 生成脚本时，把报告正文当作数据，不要当作源码片段。应从 Markdown / JSON / 文本读取正文，或使用 `json.dumps(..., ensure_ascii=False)` / `JSON.stringify(...)` 这类真实序列化方式嵌入；避免使用很长的引号字符串，因为正文里的 ASCII 引号会破坏脚本。若出现引号相关语法错误，应移动或转义数据，不要全局替换报告标点。

### 专业 PDF 的固定生成流程

1. 在任务输出目录创建绝对路径文件 `.doc-pdf-source-<timestamp>.html`。
2. 第一次 `write` 写入完整 HTML 骨架、样式和首批章节；尚未写完时在 `</body>` 前保留唯一占位符 `<!-- PDF_CONTINUE -->`。
3. 每次 `edit` 用“下一批章节 + 同一个占位符”替换该占位符，直至全部章节写完。
4. 最后一次 `edit` 移除占位符；调用前用 `read` 复查 CSS 和文件末尾，确认不存在 `{{content}}` 等未替换模板占位符、正文容器没有强制分页，且 `style`、`script`、`body` 和 `html` 均已闭合。
5. 调用 `document_export(mode=..., format="pdf", sourcePath=<临时HTML绝对路径>)`，不要传内联 `source`。
6. 若本次任务已经有完整 Markdown `content`，可以原样传入；不得为了调用导出工具再生成、改写或压缩一份 Markdown。
7. 不要因为 HTML 较长而删减章节、只保留目录或缩成摘要。`mode="current"` 会自动用当前报告检查 HTML 可见正文覆盖率；没有可用正文基准时，HTML 至少需要 500 个可见正文字符，并继续接受结构和续写标记检查。

专业版成功后临时 HTML 会自动删除。失败时会保留并通过 `diagnostic.sourcePath` 返回，供一次修复重试使用；只有调用中存在完整正文时才可能生成标准版兜底，未传 `content` 的 `mode="content"` 不会拿不完整数据另做一份 PDF。

### `document_export(sourcePath=...)` 的 PDF 打印规则

写入 `sourcePath` 的 HTML/CSS 必须遵循这些规则：

```html
<style>
  @page { size: A4; margin: 2cm; }
  body {
    font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "SimSun", sans-serif;
  }
  .cover, .toc { break-after: page; page-break-after: always; }
  .keep-together { break-inside: avoid; page-break-inside: avoid; }
  table { width: 700px; max-width: 100%; border-collapse: collapse; }
</style>
```

- 只对封面、目录等固定页强制分页；正文章节必须自然流动，不要给通用 `.page`、整章或最后一个正文容器设置 `break-after: page`。
- `break-inside: avoid` 只用于能放进单页的小块，不能用于整章、长表或跨页 Grid/Flex。
- 不要用 `position: fixed` 做页眉或页脚；需要重复页眉页脚时，把它们放进每个页面块内部。
- 表格不要只写 `width: 100%`，边框和内边距可能撑出可打印宽度；使用固定宽度并配合 `max-width: 100%`。

### 常见修复示例

```javascript
// 错误：引号破坏 source 字符串
const title = "企业"名称"";

// 正确
const title = '企业"名称"';
```

```javascript
// 错误：Windows 反斜杠可能变成转义字符
const fileName = "C:\Users\report.pdf";

// 正确：只给工具传基础名；时间戳和扩展名由导出器处理
const outputFileName = "report";
```

## Quick Start

```python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python Libraries

### pypdf - Basic Operations

#### Merge PDFs

```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### Split PDF

```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### Extract Metadata

```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Subject: {meta.subject}")
print(f"Creator: {meta.creator}")
```

#### Rotate Pages

```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # Rotate 90 degrees clockwise
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber - Text and Table Extraction

#### Extract Text with Layout

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### Extract Tables

```python
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"Table {j+1} on page {i+1}:")
            for row in table:
                print(row)
```

#### Advanced Table Extraction

```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:  # Check if table is not empty
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

# Combine all tables
if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### reportlab - Create PDFs

#### CJK text in generated PDFs

**IMPORTANT**: If the PDF contains Chinese, Japanese, or Korean text, do not use
ReportLab's built-in western fonts (`Helvetica`, `Times-Roman`, `Courier`) for
that text. They render CJK glyphs as black squares or unreadable output.
If any visible content contains CJK text, treat the whole PDF as a CJK
document: use the registered CJK font for all visible text, including English,
numbers, punctuation, titles, headings, table cells, captions, headers, and
footers. Modern CJK fonts cover Latin characters well, so do not mix western
fonts back in for English or numeric text.

Do not manually scan the user's computer for fonts with shell commands before
generation. The helper performs font discovery and compatibility checks. Use
the `font_name` returned by `cjk.register_cjk_font()`; do not choose a font from
`find` output yourself. In particular, do not prefer `Hiragino Sans GB` just
because it exists on macOS, because some Hiragino TTC files cannot be loaded by
ReportLab.

Before creating a CJK PDF, use the helper in this skill:
`scripts/cjk_reportlab.py`. Resolve that path relative to this `SKILL.md`.
The helper searches common macOS, Windows, and Linux CJK fonts, honors
`BIZOWL_PDF_CJK_FONT`, and falls back to ReportLab's `STSong-Light` CID font
only if no embeddable TrueType/TTC font can be registered.

Use the registered font for every canvas draw call and every Platypus style:

```python
from pathlib import Path
import importlib.util

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

# Replace this with the directory that contains this SKILL.md.
pdf_skill_dir = Path("/path/to/pdf/skill")
helper_path = pdf_skill_dir / "scripts" / "cjk_reportlab.py"
spec = importlib.util.spec_from_file_location("cjk_reportlab", helper_path)
cjk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cjk)

font_info = cjk.register_cjk_font()
font_name = font_info["font_name"]

styles = getSampleStyleSheet()
cjk.apply_cjk_font_to_styles(styles, font_name)

doc = SimpleDocTemplate("report.pdf", pagesize=A4)
story = [
    Paragraph("中文报告标题", styles["Title"]),
    Spacer(1, 12),
    Paragraph("这里是中文正文，必须使用已注册的 CJK 字体。", styles["Normal"]),
]
doc.build(story)

# If pypdf or PyPDF2 is available, verify text extraction before delivery.
if cjk.extract_pdf_text("report.pdf") is not None:
    assert cjk.verify_cjk_pdf_text("report.pdf", "中文报告标题")
```

Mandatory checklist for Chinese PDF generation:

- CJK document mode means "use the helper-discovered CJK font globally"; it
  does not mean using a hard-coded font named `CJK`.
- Always call `cjk.apply_cjk_font_to_styles(styles, font_name)` immediately
  after `styles = getSampleStyleSheet()`.
- Use `font_name` as the only visible text font in the PDF. This includes
  English words, dates, numbers, punctuation, page footers, and table values.
- Do not use the original `styles["Title"]`, `styles["Heading1"]`,
  `styles["Heading2"]`, `styles["Heading3"]`, or `styles["Heading4"]`
  before applying the CJK font to the whole stylesheet.
- Do not only create a custom normal body style. Titles, headings, bullets,
  table headers, and inline `<b>` / `<i>` spans also need the CJK font.
- In every `TableStyle`, set `('FONTNAME', (0, 0), (-1, -1), font_name)`;
  avoid setting only the header row or body rows.
- Verify the final PDF with `cjk.verify_cjk_pdf_text(output_path, expected_text)`.
  This check fails if extracted text contains replacement squares such as `■`.

For `canvas` output, call `setFont(font_name, size)` before drawing any CJK
text:

```python
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello-cjk.pdf", pagesize=A4)
c.setFont(font_name, 14)
c.drawString(72, 780, "中文标题和正文不能使用 Helvetica")
c.save()
```

If no compatible font can be registered, or verification shows missing CJK
glyphs, do not claim the Chinese PDF succeeded. Use DOCX instead or ask the
user for a CJK font file path.

#### Basic PDF Creation

```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

# Add text
c.drawString(100, height - 100, "Hello World!")
c.drawString(100, height - 120, "This is a PDF created with reportlab")

# Add a line
c.line(100, height - 140, 400, height - 140)

# Save
c.save()
```

#### Create PDF with Multiple Pages

```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

# Add content
title = Paragraph("Report Title", styles['Title'])
story.append(title)
story.append(Spacer(1, 12))

body = Paragraph("This is the body of the report. " * 20, styles['Normal'])
story.append(body)
story.append(PageBreak())

# Page 2
story.append(Paragraph("Page 2", styles['Heading1']))
story.append(Paragraph("Content for page 2", styles['Normal']))

# Build PDF
doc.build(story)
```

#### Subscripts and Superscripts

**IMPORTANT**: Never use Unicode subscript/superscript characters (₀₁₂₃₄₅₆₇₈₉, ⁰¹²³⁴⁵⁶⁷⁸⁹) in ReportLab PDFs. The built-in fonts do not include these glyphs, causing them to render as solid black boxes.

Instead, use ReportLab's XML markup tags in Paragraph objects:

```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()

# Subscripts: use <sub> tag
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])

# Superscripts: use <super> tag
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

For canvas-drawn text (not Paragraph objects), manually adjust font the size and position rather than using Unicode subscripts/superscripts.

## Command-Line Tools

### pdftotext (poppler-utils)

```bash
# Extract text
pdftotext input.pdf output.txt

# Extract text preserving layout
pdftotext -layout input.pdf output.txt

# Extract specific pages
pdftotext -f 1 -l 5 input.pdf output.txt  # Pages 1-5
```

### qpdf

```bash
# Merge PDFs
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf

# Split pages
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
qpdf input.pdf --pages . 6-10 -- pages6-10.pdf

# Rotate pages
qpdf input.pdf output.pdf --rotate=+90:1  # Rotate page 1 by 90 degrees

# Remove password
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

### pdftk (if available)

```bash
# Merge
pdftk file1.pdf file2.pdf cat output merged.pdf

# Split
pdftk input.pdf burst

# Rotate
pdftk input.pdf rotate 1east output rotated.pdf
```

## Common Tasks

### Extract Text from Scanned PDFs

```python
# Requires: pip install pytesseract pdf2image
import pytesseract
from pdf2image import convert_from_path

# Convert PDF to images
images = convert_from_path('scanned.pdf')

# OCR each page
text = ""
for i, image in enumerate(images):
    text += f"Page {i+1}:\n"
    text += pytesseract.image_to_string(image)
    text += "\n\n"

print(text)
```

### Add Watermark

```python
from pypdf import PdfReader, PdfWriter

# Create watermark (or load existing)
watermark = PdfReader("watermark.pdf").pages[0]

# Apply to all pages
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### Extract Images

```bash
# Using pdfimages (poppler-utils)
pdfimages -j input.pdf output_prefix

# This extracts all images as output_prefix-000.jpg, output_prefix-001.jpg, etc.
```

### Password Protection

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

# Add password
writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## Quick Reference

| Task               | Best Tool                       | Command/Code               |
| ------------------ | ------------------------------- | -------------------------- |
| Merge PDFs         | pypdf                           | `writer.add_page(page)`    |
| Split PDFs         | pypdf                           | One page per file          |
| Extract text       | pdfplumber                      | `page.extract_text()`      |
| Extract tables     | pdfplumber                      | `page.extract_tables()`    |
| Create PDFs        | reportlab                       | Canvas or Platypus         |
| Command line merge | qpdf                            | `qpdf --empty --pages ...` |
| OCR scanned PDFs   | pytesseract                     | Convert to image first     |
| Fill PDF forms     | pdf-lib or pypdf (see FORMS.md) | See FORMS.md               |

## Next Steps

- For advanced pypdfium2 usage, see REFERENCE.md
- For JavaScript libraries (pdf-lib), see REFERENCE.md
- If you need to fill out a PDF form, follow the instructions in FORMS.md
- For troubleshooting guides, see REFERENCE.md
