/**
 * lint.js — Skill 静态安全审查
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadAllSkills } from './loader.js';

class Rule {
  constructor({ id, level, pattern, description }) {
    Object.assign(this, { id, level, pattern, description });
  }
}

export const DEFAULT_RULES = [
  new Rule({ id: 'exfil_curl', level: '⛔ EXTREME', pattern: /\bcurl\s+https?:\/\//i, description: '向外部 URL 发送数据（curl）' }),
  new Rule({ id: 'exfil_wget', level: '⛔ EXTREME', pattern: /\bwget\s+https?:\/\//i, description: '向外部 URL 发送数据（wget）' }),
  new Rule({ id: 'read_ssh', level: '⛔ EXTREME', pattern: /~\/\.ssh|\/\.ssh\//i, description: '读取 SSH 密钥目录' }),
  new Rule({ id: 'read_aws', level: '⛔ EXTREME', pattern: /~\/\.aws|\/\.aws\//i, description: '读取 AWS 凭据目录' }),
  new Rule({ id: 'eval_exec', level: '⛔ EXTREME', pattern: /\beval\s*\(|exec\s*\(\s*['"]/i, description: 'eval/exec 执行外部输入' }),
  new Rule({ id: 'read_env', level: '🔴 HIGH', pattern: /process\.env|os\.environ|\$HOME/i, description: '读取环境变量' }),
  new Rule({ id: 'rm_rf', level: '🔴 HIGH', pattern: /rm\s+-rf?\s+\//i, description: '递归删除根目录' }),
];

export function scanContent(content, rules = DEFAULT_RULES) {
  const hits = [];
  for (const rule of rules) {
    const m = content.match(rule.pattern);
    if (m) hits.push({ rule, match: m[0] });
  }
  return hits;
}

export function scanSkill(skill, rules = DEFAULT_RULES) {
  const findings = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!/\.(md|js|cjs|mjs|py|sh|ps1|json|txt|yaml|yml)$/.test(ext)) continue;
        let content;
        try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
        const hits = scanContent(content, rules);
        for (const h of hits) {
          findings.push({ file: full, ...h });
        }
      }
    }
  };
  walk(skill.path);
  return findings;
}

export function overallLevel(findings) {
  const order = ['⛔ EXTREME', '🔴 HIGH', '🟡 MEDIUM', '🟢 LOW'];
  for (const lvl of order) {
    if (findings.some(f => f.rule.level === lvl)) return lvl;
  }
  return '🟢 LOW';
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('lint.js')) {
  const skills = loadAllSkills();
  console.log(`Skill security scan over ${skills.length} skills\n`);
  let blocked = 0;
  for (const s of skills) {
    const findings = scanSkill(s);
    const level = overallLevel(findings);
    const icon = level.startsWith('⛔') ? 'BLOCK' : level.startsWith('🔴') ? 'WARN ' : 'OK   ';
    console.log(`[${icon}] ${s.name.padEnd(28)} ${level}  (${findings.length} hits)`);
    if (level.startsWith('⛔')) blocked++;
  }
  console.log(`\nSummary: ${blocked} blocked, ${skills.length - blocked} passed`);
  process.exit(blocked > 0 ? 1 : 0);
}
