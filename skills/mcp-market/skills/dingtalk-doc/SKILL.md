---
name: dingtalk-doc
description: "钉钉文档 MCP 使用指南。用于钉钉 DingTalk 文档搜索、创建、读取、编辑、知识库节点和文件夹管理、权限管理、附件上传下载、文档导出等任务。"
---

# 钉钉文档 MCP 使用指南

当用户需要处理钉钉文档、知识库、文件夹、权限、附件或文档导出相关任务时，优先使用已安装的钉钉 MCP 市场能力。

## 使用原则

- 不要猜测文档 ID、节点 ID、任务 ID 或权限 ID；缺少必要信息时先向用户确认。
- 如果工具执行结果返回文档 ID、节点 ID、任务 ID 或权限 ID，后续处理只能使用这些结果里的真实 ID。
- 涉及删除、覆盖、权限变更等敏感操作时，先向用户确认目标和操作影响。
- 如果当前上下文显示该 market 处于 disabled、unavailable 或 connecting 状态，先说明状态并让用户在 MCP 市场启用、配置密钥或刷新；不要编造工具结果。

## MCP 调用路径

- 工具名必须使用运行时完整名称，例如 `dingtalk-doc__search_documents`，不要用展示名替代。
- 如果工具已作为原生 MCP 工具直接可用，可以直接调用；如果作为延迟工具暴露，先用 `ToolSearch` 加载 schema，再用 `DeferExecuteTool` 执行。
- 已知完整工具名时，用 `ToolSearch({ tool_names: [...] })` 精确查找；不确定工具时，用 `ToolSearch({ queries: [...] })` 搜索。
- 调用 `DeferExecuteTool` 时，`goal` 必须放在顶层字段，`params` 只放目标工具参数；不要把 `goal` 放进 `params`。
- 不要在 schema 加载前猜测参数结构；按 `ToolSearch` 返回的参数 schema 填写。

## 适用场景

- 搜索钉钉文档或知识库节点。
- 创建、读取、更新钉钉文档。
- 管理文件夹、知识库节点、权限、附件。
- 发起或查询文档导出任务。

## 已配置的 MCP Server

- dingtalk-doc: 钉钉文档 MCP，支持查找、创建、读取、编辑文档，管理文件夹、知识库节点、权限、附件和导出任务。

## 能力参考

- dingtalk-doc__search_documents: 搜索钉钉文档。
- dingtalk-doc__create_document: 创建一篇文字类型的钉钉在线文档。
- dingtalk-doc__get_document_content: 获取钉钉文档内容，以 Markdown 格式返回。
- dingtalk-doc__get_document_info: 获取钉钉文档、知识库或钉盘文件的元信息。
- dingtalk-doc__update_document: 覆盖或追加更新钉钉在线文档内容。
- dingtalk-doc__list_document_blocks: 查询指定文档下的一级块元素列表。
- dingtalk-doc__insert_document_block: 插入文档块元素。
- dingtalk-doc__update_document_block: 更新文档块元素内容或样式。
- dingtalk-doc__delete_document_block: 删除文档块元素。
- dingtalk-doc__list_nodes: 列出知识库、文件夹或“我的文档”下的直接子节点。
- dingtalk-doc__create_folder: 创建文件夹。
- dingtalk-doc__create_file: 创建文档、表格、演示、白板、脑图、多维表或文件夹。
- dingtalk-doc__rename_document: 重命名文档或文件夹节点。
- dingtalk-doc__copy_document: 复制节点到目标文件夹。
- dingtalk-doc__move_document: 移动节点到目标文件夹。
- dingtalk-doc__delete_document: 将节点移入回收站。
- dingtalk-doc__add_permission: 添加知识库节点成员权限。
- dingtalk-doc__update_permission: 修改知识库节点成员角色。
- dingtalk-doc__remove_permission: 移除知识库节点成员权限。
- dingtalk-doc__list_permission: 查询知识库节点成员权限列表。
- dingtalk-doc__get_file_upload_info: 获取上传文件到钉钉文档或知识库的凭证。
- dingtalk-doc__commit_uploaded_file: 提交已上传文件，完成文件入库。
- dingtalk-doc__download_file: 获取文件下载凭证。
- dingtalk-doc__get_doc_attachment_upload_info: 获取向文档上传附件所需的 OSS 凭证。
- dingtalk-doc__download_doc_attachment: 获取文档附件临时下载 URL。
- dingtalk-doc__submit_export_job: 提交在线文档导出任务。
- dingtalk-doc__query_export_job: 查询文档导出任务状态和下载链接。
- dingtalk-doc__pat.batch_plan: 查询 PAT 批量授权计划。
- dingtalk-doc__pat.batch_grant: 执行 PAT 批量授权。

## 认证说明

钉钉 MCP Key 由用户在市场配置页填写。运行时会通过 URL query 参数 `key` 传给钉钉 MCP 网关，模型不应要求用户在对话中重复提供密钥。
