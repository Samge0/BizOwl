---
name: qveris
description: "QVeris MCP 使用指南。用于通过 QVeris discover、inspect、call 发现、检查并调用第三方数据/API/tool 能力。覆盖量化/行情、宏观固收、投研、风险合规、加密资产、另类信号等金融 agent 场景；实际业务范围必须以 discover 返回结果为准，再选择 QVeris tool_id。"
---

# QVeris MCP 使用指南

当用户需要通过自然语言查找并调用第三方数据/API 能力时，优先使用已安装的 QVeris MCP 市场能力。QVeris 覆盖金融 agent 场景，包括股票基金量化/行情、宏观固收、投研、风险合规、加密资产和另类信号；但实际业务范围由运行时 `discover` 返回的当前 tool list 决定。

## 使用原则

- 不要凭用户描述猜测 QVeris 工具参数；缺少必填信息时先向用户确认。
- 如果用户想“看看 QVeris 有哪些工具”，或需求不确定具体工具，优先使用 QVeris 的 `discover` 获取当前 tool list。
- QVeris tool list 是动态发现结果，不要把历史 tool_id 当成永久稳定清单；调用前按需 `inspect` 确认参数 schema 和示例。
- 查询用量、积分流水或执行平台工具时，保持用户的目标、时间范围和工具名称一致。
- 如果当前上下文显示该 market 处于 disabled、unavailable 或 connecting 状态，先说明状态并让用户在 MCP 市场启用、配置 API Key 或刷新；不要编造 discover / call 结果。

## MCP 调用路径

- 工具名必须使用运行时完整名称，例如 `qveris-mcp__discover`，不要用展示名替代。
- 如果工具已作为原生 MCP 工具直接可用，可以直接调用；如果作为延迟工具暴露，先用 `ToolSearch` 加载 schema，再用 `DeferExecuteTool` 执行。
- 已知完整工具名时，用 `ToolSearch({ tool_names: [...] })` 精确查找；不确定工具时，用 `ToolSearch({ queries: [...] })` 搜索。
- 调用 `DeferExecuteTool` 时，`goal` 必须放在顶层字段，`params` 只放目标工具参数；不要把 `goal` 放进 `params`。
- QVeris 内部业务工具仍要遵循 `discover -> inspect -> call`：先发现候选 tool_id，再检查 schema，最后调用。

## 适用场景

- 能力路由网络：为 AI Agent 统一发现、检查和调用真实世界的外部能力、实时数据、工具和服务，而不是绑定到某个固定业务工具。
- 金融 agent 工作流：量化/行情、宏观固收、投研、风险合规、加密资产、另类信号等金融数据与分析场景。
- 动态能力发现：当用户只描述业务目标、不知道具体接口、数据源或 provider 时，用自然语言 `discover` 获取当前候选工具。
- 能力目录确认：当用户想确认 QVeris 当前支持哪些业务、数据源、provider 或接口时，用 `discover` 获取最新 tool list，而不是依赖静态清单。
- Provider-aware 工具选择：根据 `inspect` 返回的参数 schema、示例、成功率、延迟、计费规则和 provider 信息选择工具。
- 结构化执行与追踪：用 `call` 调用选中的 QVeris tool_id，并保留 search_id / execution_id 便于排查结果、复用上下文或查询审计记录。
- 用量与积分审计：查询 usage history、credits ledger，核对调用是否成功、是否计费以及积分流水。

## 已配置的 MCP Server

- qveris-mcp: QVeris MCP Server，通过本地 `qverisMcpProxy` 启动，提供工具发现、schema 查看、工具执行、用量历史和积分流水能力。

## 能力参考

- qveris-mcp__discover: 发现 QVeris 可用工具。
- qveris-mcp__inspect: 查看 QVeris 工具 schema、参数和说明。
- qveris-mcp__call: 执行 QVeris 工具。
- qveris-mcp__usage_history: 查询 QVeris 用量历史。
- qveris-mcp__credits_ledger: 查询 QVeris 积分流水。

## 认证说明

QVeris API Key 由用户在市场配置页填写。运行时通过环境变量 `QVERIS_API_KEY` 注入 MCP server，模型不应要求用户在对话中重复提供密钥。
