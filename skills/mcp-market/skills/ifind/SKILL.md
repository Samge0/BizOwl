---
name: ifind
description: "同花顺 iFinD MCP 使用指南。用于通过 iFinD MCP 查询股票、基金、EDB 宏观指标、财经资讯、债券、全球股票、指数等金融数据。"
---

# 同花顺 iFinD MCP 使用指南

当用户需要股票、基金、宏观 EDB、资讯、债券、全球股票或指数等金融数据时，优先使用已安装的同花顺 iFinD MCP 市场能力。

## 使用原则

- 根据用户的数据类型和查询目标，选择对应的 iFinD 数据能力。
- 不要猜测证券代码、指标名、查询范围或时间区间；缺少必要查询条件时先向用户确认。
- 金融数据查询需要保持市场、品种、指标和时间范围一致；结果中如有单位或币种，回答时一并说明。
- 如果当前上下文显示该 market 处于 disabled、unavailable 或 connecting 状态，先说明状态并让用户在 MCP 市场启用、配置 Authorization 或刷新；不要编造数据。
- iFinD 工具列表可能随账号权限和运行时状态变化，静态清单只作路由参考，实际工具与参数以运行时返回为准。

## MCP 调用路径

- 工具名必须使用运行时完整名称，例如 `hexin-ifind-ds-stock-mcp__search_stocks`，不要用展示名替代。
- 如果工具已作为原生 MCP 工具直接可用，可以直接调用；如果作为延迟工具暴露，先用 `ToolSearch` 加载 schema，再用 `DeferExecuteTool` 执行。
- 已知完整工具名时，用 `ToolSearch({ tool_names: [...] })` 精确查找；不确定工具时，用 `ToolSearch({ queries: [...] })` 搜索。
- 调用 `DeferExecuteTool` 时，`goal` 必须放在顶层字段，`params` 只放目标工具参数；不要把 `goal` 放进 `params`。
- 不要在 schema 加载前猜测参数结构；按 `ToolSearch` 返回的参数 schema 填写。

## 适用场景

- 股票行情、财务、指标或基础数据查询。
- 基金数据查询。
- EDB 宏观经济数据库查询。
- 金融资讯查询。
- 债券数据查询。
- 全球股票数据查询。
- 指数数据查询。

## 已配置的 MCP Server

- hexin-ifind-ds-stock-mcp: 同花顺 iFinD 股票数据。
- hexin-ifind-ds-fund-mcp: 同花顺 iFinD 基金数据。
- hexin-ifind-ds-edb-mcp: 同花顺 iFinD EDB 数据。
- hexin-ifind-ds-news-mcp: 同花顺 iFinD 资讯数据。
- hexin-ifind-ds-bond-mcp: 同花顺 iFinD 债券数据。
- hexin-ifind-ds-global-stock-mcp: 同花顺 iFinD 全球股票数据。
- hexin-ifind-ds-index-mcp: 同花顺 iFinD 指数数据。

## 已从运行日志捕获的工具

以下工具来自 qcc_claw 运行时日志中实际出现过的 ToolSearch / DeferExecuteTool 记录。工具名前缀使用 market server 的 `name`，不要改成展示名。

- `hexin-ifind-ds-stock-mcp__search_stocks`: 智能选股，根据自然语言要求筛选符合条件的 A 股股票并返回股票代码列表；常见条件包括行情或财务指标、行业板块、主题概念、主营业务等。
- `hexin-ifind-ds-news-mcp__search_news`: 同花顺财经新闻资讯片段检索，按查询内容、起止日期和返回数量查找相关新闻。
- `hexin-ifind-ds-news-mcp__search_notice`: A 股、基金、港美股公告内容语义查询，按查询内容、起止日期和返回数量查找相关公告段落。
- `hexin-ifind-ds-global-stock-mcp__global_stock_profile`: 港美股股票基本资料查询，包括证券基本信息、上市公司基本信息、股本结构与股东结构。
- `hexin-ifind-ds-global-stock-mcp__global_stock_quotes`: 港美股股票行情数据查询，包括日频行情指标、技术指标、技术形态和 beta、夏普比率、波动率等定量风险指标。
- `hexin-ifind-ds-index-mcp__index_data`: 指数数据查询，可用于指数行情、涨跌幅、成交量、成交额等指标查询。

基金、EDB、债券 MCP server 在当前可用日志中只看到 server 配置和认证失败记录，未捕获到成功返回的 tool list；如果用户已配置有效 Authorization，运行时可能仍会暴露更多工具。

## 认证说明

同花顺 iFinD Authorization 由用户在市场配置页填写。运行时通过请求头 `Authorization` 传给 MCP server，模型不应要求用户在对话中重复提供密钥。
