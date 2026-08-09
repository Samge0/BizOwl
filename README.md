<div align="center">

# BizOwl

**一个基于 Electron 的轻量级 AI 商业助手桌面Agent应用。**

Apple Design System 风格 UI · 多模型支持 · 企业工商数据查询 · 持久记忆 · 研究报告 · 技能扩展系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>


https://github.com/user-attachments/assets/89bd4091-1fcf-4b31-ab56-32d533bc5fcb


---

## ✨ 功能特性

### 🤖 AI 对话
- **流式输出** — 实时显示 AI 回复，支持中途停止生成
- **多会话并行** — 多个对话同时进行，独立状态管理
- **历史记录** — 按「今天 / 昨天 / 本周 / 本月 / 更早」自动分组（OpenAI 风格）
- **全文搜索** — 搜索对话标题和消息内容，高亮命中片段
- **Markdown 渲染** — 表格、代码块、引用、列表等完整支持
- **Mermaid 图表** — 流程图/饼图/甘特图等，按需动态加载，全屏缩放预览
- **KaTeX 公式** — 行内/块级数学公式渲染

### 🧠 持久记忆系统
- **跨会话记忆** — Agent 自动学习用户偏好、习惯和历史经验，在后续对话中自动加载
- **懒加载机制** — 记忆按需读取，不占用上下文窗口
- **自动压缩** — 空闲时自动压缩历史记忆块，保持快速召回
- **可视化编辑** — 设置面板查看/搜索/批量删除记忆条目
- **人设画像** — `USER.md` 持久化用户画像，支持 Agent 主动维护

### 🔍 多引擎聚合搜索
- **本地多引擎** — 同时查询 360 / Bing / 百度等引擎，合并去重并按相关性评分排序
- **外部搜索源** — 支持 Tavily / Serper.dev / SearXNG 三个外部 API 并行查询
- **相关性评分** — 每条结果附带 0-100 分相关性评分，词典/百科类自动降级
- **随机 UA** — 所有搜索请求自动轮换 User-Agent，降低被限流概率
- **取消传播** — 用户点击"停止"时，所有已发出的搜索请求（含外部 API）立即取消

### 📊 研究报告导出
- **PDF / Markdown** — 7 阶段研究方法论，生成含封面/摘要/目录/正文/评分总表/参考文献的完整报告
- **产物注册表** — 所有导出文件自动注册，UI 以卡片形式展示
- **多格式文档** — 支持 Markdown / PDF / DOCX / XLSX 导出

### ⏱️ Agent 健壮性
- **双超时降级** — 首字节超时（90s 普通 / 300s 研究类）+ 流传输空闲超时（60s），均可在设置页自定义
- **优雅降级** — 超时不崩溃，基于已收集数据生成部分结论；工具参数 JSON 不完整时跳过执行
- **Token 统计** — 三指标（上下文占用 / 累加输出 / 真实计费），80% 黄 / 95% 红预警 + 超限拦截

### 🏢 企业数据查询（可选）
BizOwl 内置了企业信息检索、股权穿透、风险排查等 Agent 能力。如果你已有**企查查**等商业数据平台的账号，可在 **设置 → 账号凭证** 中自行配置，让 Agent 接入实时企业数据源：

- **扫码登录** — 使用企查查 App 扫码授权（推荐）
- **验证码登录** — 手机号 + 短信验证码（含极验滑块验证）
- **Token 输入** — 直接粘贴已获取的 `accessToken`（高级模式）

> 💡 **凭证是可选的。** 不配置也不影响 AI 对话、模型使用、文档生成等核心功能。配置后 Agent 将获得更丰富的实时企业数据（工商、股权、司法、风险等），查询准确度会显著提升。
>
> ⚠️ 凭证仅存储在本地，不会上传到任何第三方服务器。请遵守对应数据源平台的服务条款。

### 🔌 模型 & 技能
- **自定义模型** — 兼容 OpenAI API 格式（vLLM / Ollama / 本地部署 / 云端）
- **技能系统** — 内置文档生成、网页搜索、浏览器自动化等技能
- **MCP 市场** — 动态注册第三方 MCP 工具
- **技能导入** — 从外部 `.json` 文件导入自定义技能

### 🎨 Apple Design System
- **毛玻璃质感** — `backdrop-filter` 贯穿标题栏、侧栏、聊天区、弹窗
- **SF Pro 字体** — 系统字体栈 + 负字距优化
- **Action Blue** — `#0066CC` 作为唯一交互色
- **发丝分隔线** — `0.5px` hairline borders
- **药丸按钮** — `border-radius: 9999px` 圆角 CTA
- **图片预览** — 全屏毛玻璃 lightbox，支持滚轮缩放、拖拽平移

---

## 📸 截图

> 运行 `npm run dev` 后可查看实时效果

| 欢迎页 | 对话界面 |
|:---:|:---:|
| 快捷场景卡片 · Apple 风格大标题 | 毛玻璃气泡 · 流式输出 · 工具调用展示 |

| 会话历史分组 | 图片预览 Lightbox |
|:---:|:---:|
| 按「今天/昨天/本周」自动分组 · 粘性吸顶 | 全屏毛玻璃 · 滚轮缩放 · 拖拽平移 |

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- **macOS** 12+ / **Windows** 10+ / **Linux**

### 安装

```bash
git clone https://github.com/Samge0/BizOwl.git
cd BizOwl

# 安装主项目依赖
npm install

# 安装 web-search 技能依赖（可选，仅联网搜索需要）
cd skills/builtin/web-search && npm install && cd ../../..
```

### 运行

```bash
# 开发模式（带 DevTools）
npm run dev

# 生产模式
npm start
```

### 构建

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

构建产物输出到 `dist/` 目录。也可以 push `v*` 格式的 tag（如 `v1.0.0`）触发 GitHub Actions 自动构建三平台产物并发布到 Release。

---

## ⚙️ 配置

### 自定义模型

在应用内 **设置 → 自定义模型** 中添加：

| 字段 | 说明 | 示例 |
|------|------|------|
| Model ID | 模型标识 | `gpt-4o`, `claude-sonnet-4`, `qwen-72b` |
| API Base URL | OpenAI 兼容接口地址 | `http://localhost:8000/v1` |
| API Key | 密钥 | `sk-...` |

### 数据源凭证（可选）

在 **设置 → 账号凭证** 中配置企查查等数据源平台的账号凭证：

- **方式一**：扫码登录（推荐，使用企查查 App 扫码）
- **方式二**：手机号 + 验证码登录（含极验滑块验证）
- **方式三**：直接粘贴 `accessToken`（高级模式）

> 💡 此步骤是**可选的**。不配置凭证也能正常使用 AI 对话、自定义模型、文档生成等功能。配置后可增强 Agent 的实时企业数据查询能力（工商信息、股权穿透、风险排查等）。
>
> ⚠️ 凭证仅存储在本地（`~/.BizOwl/auth.json`），不会上传到任何第三方服务器。请遵守对应数据源平台的服务条款。

---

## 🏗️ 项目结构

```
BizOwl/
├── electron/              # Electron 主进程（CJS）
│   ├── main.cjs           # 窗口管理 + IPC handler 注册
│   └── preload.cjs        # contextBridge 安全暴露 API
├── src/                   # 业务逻辑（ESM）
│   ├── agent/             # Agent Loop + 工具系统
│   ├── auth/              # 数据源认证
│   ├── chat/              # 会话存储（JSONL 持久化）
│   ├── config/            # 自定义模型管理
│   ├── prompt-pipeline/   # 5 层 Prompt 注入管道
│   ├── skills/            # 技能加载 + 安全检查
│   └── utils/             # 日志等工具
├── renderer/              # UI 渲染层
│   ├── index.html         # 主页面
│   ├── styles.css         # Apple Design System 样式
│   └── js/                # 原生 JS 模块（非 framework）
├── skills/                # 技能系统
│   ├── builtin/           # 内置技能（web-search / docx / xlsx / pptx / pdf）
│   └── mcp-market/        # MCP 市场技能
├── assets/                # 静态资源
└── scripts/               # 开发工具（渲染层测试）
```

---

## 🧪 测试

```bash
npm run test:renderer
```

测试覆盖：消息渲染、会话切换、模型选择、搜索、@企业引用、图片预览、主题检测等。

---

## 🛠️ 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **桌面框架** | Electron 43 | 跨平台桌面应用 |
| **主进程** | Node.js (CJS) | IPC 通信、文件系统、进程管理 |
| **业务逻辑** | ES Modules | Agent Loop、认证、Prompt Pipeline |
| **渲染层** | Vanilla JS + CSS | 零框架依赖，原生 Web 标准 |
| **设计系统** | Apple Design Tokens | SF Pro 字体、Action Blue、毛玻璃 |
| **搜索技能** | Playwright + Crawlee | 多搜索引擎 fallback |
| **文档生成** | python-docx / openpyxl / pptxgenjs | 调研报告导出 |
| **构建** | electron-builder | DMG / NSIS / AppImage |

---

## ⚠️ 免责声明

> 本项目仅供学习交流和技术研究使用。

### 1. 非官方项目
本项目是一个独立的个人开源项目，**不隶属于、不受雇于、也不代表任何公司或组织**。项目中涉及的任何品牌名称、商标、产品名称均为各自所有者的财产，本项目不对它们主张任何权利。

### 2. 用户责任
用户使用本项目时所产生的一切后果由用户自行承担。用户应确保自己的使用行为符合当地法律法规以及相关平台的服务条款。

### 3. 不提供保证
本项目按"现状"（AS IS）提供，不提供任何形式的明示或暗示的保证。作者不对项目的完整性、准确性、可靠性或适用性作出任何承诺。

### 4. 数据来源
本项目本身不包含任何企业数据。数据查询功能依赖用户自行配置有效凭证，所有数据均来自用户授权访问的第三方平台。用户应遵守对应平台的使用条款。

### 5. 知识产权
本项目自身的源代码（UI 界面、架构设计、工具封装）在 MIT 许可证下发布。第三方平台的所有内容（包括但不限于 API、数据、商标、界面设计）其版权归原权利人所有。

### 6. 责任限制
在任何情况下，对于因使用或无法使用本项目而导致的任何直接、间接、附带、特殊或后果性损害，作者不承担任何责任。

## 相关截图

- 首页
<img width="1272" height="793" alt="BizOwl" src="https://github.com/user-attachments/assets/0dd5df85-644e-4f54-aee5-f212d8f82af5" />
- 对话
<img width="1273" height="793" alt="BizOwl" src="https://github.com/user-attachments/assets/a20172ee-dbb3-42f5-b566-e5276509f660" />
- 设置页
<img width="1272" height="790" alt="BizOwl" src="https://github.com/user-attachments/assets/802d4fc2-0247-4dc6-a0cc-25daf3457fa3" />
<img width="1274" height="793" alt="BizOwl" src="https://github.com/user-attachments/assets/d35035d2-0e7d-4234-aa8a-d9b073bc9d77" />
<img width="1269" height="793" alt="BizOwl" src="https://github.com/user-attachments/assets/a1bfa621-cac7-433f-87f3-096a7370471d" />
<img width="1278" height="794" alt="BizOwl" src="https://github.com/user-attachments/assets/d9797ab4-6f32-48b2-9242-9333e41a6534" />
<img width="1272" height="790" alt="BizOwl" src="https://github.com/user-attachments/assets/a05fc889-0bea-4fe2-a398-cf073d491ce7" />

---

## 📄 License

[MIT](LICENSE) © 2026 [Samge0](https://github.com/Samge0)
