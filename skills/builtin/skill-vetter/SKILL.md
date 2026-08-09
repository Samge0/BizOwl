---
name: skill-vetter
description: 面向 AI Agent 的安全优先技能审查工具。在从 GitHub 或其他来源安装技能前使用，用于检查风险信号、权限范围和可疑模式。
official: true
version: 1.0.0
---

# Skill Vetter 🔒

Security-first vetting protocol for AI agent skills. **Never install a skill without vetting it first.**

## 默认语言

- 除非用户明确要求其他语言，审查结论、风险说明和最终报告必须使用中文。
- 文件路径、命令、代码片段、包名、URL、API 名称、权限名和错误原文保持原样。
- 风险标签可以保留 `LOW/MEDIUM/HIGH/EXTREME` 作为括注，但主要结论必须用中文表达。

## When to Use

- Before installing any skill from SkillHub
- Before running skills from GitHub repos
- When evaluating skills shared by other agents
- Anytime you're asked to install unknown code

## Vetting Protocol

### Step 1: Source Check

```
Questions to answer:
- [ ] Where did this skill come from?
- [ ] Is the author known/reputable?
- [ ] How many downloads/stars does it have?
- [ ] When was it last updated?
- [ ] Are there reviews from other agents?
```

### Step 2: Code Review (MANDATORY)

Read ALL files in the skill. Check for these **RED FLAGS**:

```
🚨 REJECT IMMEDIATELY IF YOU SEE:
─────────────────────────────────────────
• curl/wget to unknown URLs
• Sends data to external servers
• Requests credentials/tokens/API keys
• Reads ~/.ssh, ~/.aws, ~/.config without clear reason
• Accesses MEMORY.md, USER.md, SOUL.md, IDENTITY.md
• Uses base64 decode on anything
• Uses eval() or exec() with external input
• Modifies system files outside workspace
• Installs packages without listing them
• Network calls to IPs instead of domains
• Obfuscated code (compressed, encoded, minified)
• Requests elevated/sudo permissions
• Accesses browser cookies/sessions
• Touches credential files
─────────────────────────────────────────
```

### Step 3: Permission Scope

```
Evaluate:
- [ ] What files does it need to read?
- [ ] What files does it need to write?
- [ ] What commands does it run?
- [ ] Does it need network access? To where?
- [ ] Is the scope minimal for its stated purpose?
```

### Step 4: Risk Classification

| Risk Level | Examples                      | Action                    |
| ---------- | ----------------------------- | ------------------------- |
| 🟢 LOW     | Notes, weather, formatting    | Basic review, install OK  |
| 🟡 MEDIUM  | File ops, browser, APIs       | Full code review required |
| 🔴 HIGH    | Credentials, trading, system  | Human approval required   |
| ⛔ EXTREME | Security configs, root access | Do NOT install            |

## Output Format

After vetting, produce this report in Chinese:

```
技能安全审查报告
═══════════════════════════════════════
技能：[name]
来源：[SkillHub / GitHub / other]
作者：[username]
版本：[version]
───────────────────────────────────────
基础信息：
• 下载量/Star：[count]
• 最近更新：[date]
• 已审查文件数：[count]
───────────────────────────────────────
风险信号：[无 / 列出具体问题]

所需权限：
• 文件：[列表或“无”]
• 网络：[列表或“无”]
• 命令：[列表或“无”]
───────────────────────────────────────
风险级别：[🟢 低 / 🟡 中 / 🔴 高 / ⛔ 极高]

结论：[✅ 可以安装 / ⚠️ 谨慎安装 / ❌ 不要安装]

备注：[其他观察]
═══════════════════════════════════════
```

## Quick Vet Commands

For GitHub-hosted skills:

```bash
# Check repo stats
curl -s "https://api.github.com/repos/OWNER/REPO" | jq '{stars: .stargazers_count, forks: .forks_count, updated: .updated_at}'

# List skill files
curl -s "https://api.github.com/repos/OWNER/REPO/contents/skills/SKILL_NAME" | jq '.[].name'

# Fetch and review SKILL.md
curl -s "https://raw.githubusercontent.com/OWNER/REPO/main/skills/SKILL_NAME/SKILL.md"
```

## Trust Hierarchy

1. **Official BizOwl skills** → Lower scrutiny (still review)
2. **High-star repos (1000+)** → Moderate scrutiny
3. **Known authors** → Moderate scrutiny
4. **New/unknown sources** → Maximum scrutiny
5. **Skills requesting credentials** → Human approval always

## Remember

- No skill is worth compromising security
- When in doubt, don't install
- Ask your human for high-risk decisions
- Document what you vet for future reference

---

_Paranoia is a feature._ 🔒🦀
