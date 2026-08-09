---
name: pkulaw
description: "北大法宝 PKULaw MCP 使用指南。用于法律法规检索、法规条文详情获取、司法案例检索等法律数据服务。"
---

# 北大法宝 MCP 使用指南

当用户需要检索法律法规或司法案例时，优先使用已安装的北大法宝 MCP 市场能力。

## 使用原则

- 根据用户目标选择法律法规或司法案例检索能力。
- 不要猜测法规 ID、案例 ID、案由或检索条件；ID 必须来自真实检索结果。
- 用户要求法律结论时，应区分法规原文、案例事实和模型归纳，不把检索结果扩展成确定法律意见。
- 如果当前上下文显示该 market 处于 disabled、unavailable 或 connecting 状态，先说明状态并让用户在 MCP 市场启用、配置 Access Token 或刷新；不要编造检索结果。

## MCP 调用路径

- 工具名必须使用运行时完整名称，例如 `pkulaw-law-search-service__search_article`，不要用展示名替代。
- 如果工具已作为原生 MCP 工具直接可用，可以直接调用；如果作为延迟工具暴露，先用 `ToolSearch` 加载 schema，再用 `DeferExecuteTool` 执行。
- 已知完整工具名时，用 `ToolSearch({ tool_names: [...] })` 精确查找；不确定工具时，用 `ToolSearch({ queries: [...] })` 搜索。
- 调用 `DeferExecuteTool` 时，`goal` 必须放在顶层字段，`params` 只放目标工具参数；不要把 `goal` 放进 `params`。
- 不要在 schema 加载前猜测参数结构；按 `ToolSearch` 返回的参数 schema 填写。

## 适用场景

- 按关键词、主题或语义检索法律法规。
- 获取法律法规详情。
- 按关键词、案由、争议焦点或语义检索司法案例。

## 已配置的 MCP Server

- pkulaw-law-search-service: 检索法律法规语义服务，包含 `search_article` 和 `get_article` 工具。
- pkulaw-case-search-service: 检索司法案例语义服务，包含 `search_case` 工具。

## 能力参考

- pkulaw-law-search-service__search_article: 检索法律法规。
- pkulaw-law-search-service__get_article: 获取法律法规详情。
- pkulaw-case-search-service__search_case: 检索司法案例。

## 认证说明

北大法宝 Access Token 由用户在市场配置页填写。运行时通过请求头 `Authorization: Bearer <token>` 传给 MCP server，模型不应要求用户在对话中重复提供密钥。
