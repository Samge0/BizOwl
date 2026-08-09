---
name: create-plan
description: 创建简洁可执行的计划。当用户明确要求为编码任务制定计划、拆解步骤或先规划再实施时使用。
official: true
metadata:
  short-description: Create a plan
---

# Create Plan

## 默认语言

- 除非用户明确要求其他语言，最终计划必须使用中文。
- 文件路径、命令、代码标识符、包名、API 名称和错误原文保持原样，不要为了中文化而翻译。
- 不要输出英文模板标题，例如 `Plan`、`Scope`、`Action items`、`Open questions`。

## Goal

Turn a user prompt into a **single, actionable plan** delivered in the final assistant message.

## Minimal workflow

Throughout the entire workflow, operate in read-only mode. Do not write or update files.

1. **Scan context quickly**
   - Read `README.md` and any obvious docs (`docs/`, `CONTRIBUTING.md`, `ARCHITECTURE.md`).
   - Skim relevant files (the ones most likely touched).
   - Identify constraints (language, frameworks, CI/test commands, deployment shape).

2. **Ask follow-ups only if blocking**
   - Ask **at most 1–2 questions**.
   - Only ask if you cannot responsibly plan without the answer; prefer multiple-choice.
   - If unsure but not blocked, make a reasonable assumption and proceed.

3. **Create a plan using the template below**
   - Start with **1 short paragraph** describing the intent and approach.
   - Clearly call out what is **in scope** and what is **not in scope** in short.
   - Then provide a **small checklist** of action items (default 6–10 items).
      - Each checklist item should be a concrete action and, when helpful, mention files/commands.
      - **Make items atomic and ordered**: discovery → changes → tests → rollout.
      - **Verb-first**: “Add…”, “Refactor…”, “Verify…”, “Ship…”.
   - Include at least one item for **tests/validation** and one for **edge cases/risk** when applicable.
   - If there are unknowns, include a tiny **Open questions** section (max 3).

4. **Do not preface the plan with meta explanations; output only the plan as per template**

## Plan template (follow exactly)

```markdown
# 计划

<1–3 句：说明要做什么、为什么做，以及总体思路。>

## 范围
- 包含：
- 不包含：

## 行动项
[ ] <步骤 1>
[ ] <步骤 2>
[ ] <步骤 3>
[ ] <步骤 4>
[ ] <步骤 5>
[ ] <步骤 6>

## 待确认问题
- <问题 1>
- <问题 2>
- <问题 3>
```

## Checklist item guidance
Good checklist items:
- Point to likely files/modules: src/..., app/..., services/...
- Name concrete validation: “Run npm test”, “Add unit tests for X”
- Include safe rollout when relevant: feature flag, migration plan, rollback note

Avoid:
- Vague steps (“handle backend”, “do auth”)
- Too many micro-steps
- Writing code snippets (keep the plan implementation-agnostic)
