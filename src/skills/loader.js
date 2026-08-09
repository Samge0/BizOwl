/**
 * loader.js — Skill 加载器
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SKILLS_DIR = path.resolve(__dirname, '../../skills/builtin');

/** 解析 frontmatter */
export function parseSkillMd(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content.trim() };
  const [, fmRaw, body] = match;
  const frontmatter = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      frontmatter[m[1]] = val;
    }
  }
  return { frontmatter, body: body.trim() };
}

/** 加载单个 skill */
export function loadSkill(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;
  const raw = fs.readFileSync(skillMdPath, 'utf8');
  const { frontmatter, body } = parseSkillMd(raw);
  const name = frontmatter.name || path.basename(skillDir);
  const scriptsDir = path.join(skillDir, 'scripts');
  return {
    name,
    description: frontmatter.description || '',
    official: frontmatter.official === 'true' || frontmatter.official === true,
    path: skillDir,
    frontmatter,
    body,
    hasScripts: fs.existsSync(scriptsDir),
    scripts: fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir) : [],
  };
}

/** 扫描整个 skills 目录 */
export function loadAllSkills(skillsDir = DEFAULT_SKILLS_DIR) {
  if (!fs.existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const skill = loadSkill(path.join(skillsDir, entry.name));
    if (skill) out.push(skill);
  }
  return out;
}

/** 选择 skill */
export function selectSkill(query, skills = []) {
  const q = query.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const s of skills) {
    const desc = (s.description || '').toLowerCase();
    let score = 0;
    for (const word of q.split(/\s+/)) {
      if (word.length < 2) continue;
      if (desc.includes(word)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore > 0 ? best : null;
}

// ─── Skill 导入 / 导出 / 删除 ───

/** 递归拷贝目录 */
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

/** 递归删除目录 */
function removeDirRecursive(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 检测系统是否有可用 zip 命令 */
function findZipCommand() {
  // macOS / Linux: zip；Windows: 可能需 tar
  try {
    execFileSync('which', ['zip'], { stdio: 'ignore' });
    return 'zip';
  } catch {
    try {
      execFileSync('where', ['zip'], { stdio: 'ignore' });
      return 'zip';
    } catch {
      return null;
    }
  }
}

/**
 * 导出 skill — 将 skills/builtin/{skillName}/ 打包为 zip
 * @param {string} skillName skill 名（目录名）
 * @param {string} destPath 目标 .zip 文件路径
 * @returns {{ success: boolean, path?: string, error?: string }}
 */
export function exportSkill(skillName, destPath) {
  const srcDir = path.join(DEFAULT_SKILLS_DIR, skillName);
  // 安全检查：防止路径穿越（与 deleteSkill 一致）
  const resolved = path.resolve(srcDir);
  const baseResolved = path.resolve(DEFAULT_SKILLS_DIR);
  if (!resolved.startsWith(baseResolved + path.sep)) {
    return { success: false, error: '非法路径' };
  }
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    return { success: false, error: `Skill 不存在: ${skillName}` };
  }
  const skillMd = path.join(srcDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    return { success: false, error: `Skill 缺少 SKILL.md: ${skillName}` };
  }

  // 确保目标目录存在
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  // 优先用系统 zip
  const zipCmd = findZipCommand();
  if (zipCmd) {
    try {
      // zip -j 不保留目录结构，会丢失子目录（scripts/）；改用进入目录的父目录再打包
      // 标准做法：cd 到 DEFAULT_SKILLS_DIR，zip -r destPath skillName
      execFileSync(zipCmd, ['-r', destPath, skillName], {
        cwd: DEFAULT_SKILLS_DIR,
        stdio: 'ignore',
      });
      return { success: true, path: destPath };
    } catch (err) {
      console.warn('[Skills] zip 打包失败，回退到 tar:', err.message);
    }
  }

  // 回退：用 tar.gz（跨平台，Node 内置）
  const tarPath = destPath.replace(/\.zip$/i, '.tar.gz');
  try {
    execFileSync('tar', ['-czf', tarPath, '-C', DEFAULT_SKILLS_DIR, skillName], {
      stdio: 'ignore',
    });
    return { success: true, path: tarPath };
  } catch (err) {
    return { success: false, error: '打包失败：' + err.message };
  }
}

/**
 * 导入 skill — 从 zip/tar.gz 或目录导入到 skills/builtin/{name}/
 * @param {string} sourcePath 源 .zip / .tar.gz 文件 或 目录路径
 * @param {string} [skillName] 可选指定 skill 名（默认从源推断）
 * @returns {{ success: boolean, name?: string, path?: string, error?: string }}
 */
export function importSkill(sourcePath, skillName) {
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `源路径不存在: ${sourcePath}` };
  }

  // 临时解压目录
  const tmpRoot = path.join(os.tmpdir(), `BizOwl-skill-import-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      // 目录直接拷贝
      const name = skillName || path.basename(sourcePath);
      const destDir = path.join(DEFAULT_SKILLS_DIR, name);
      copyDirRecursive(sourcePath, destDir);
      return { success: true, name, path: destDir };
    }

    // 文件：根据扩展名解压
    const lower = sourcePath.toLowerCase();
    if (lower.endsWith('.zip')) {
      try {
        execFileSync('unzip', ['-o', sourcePath, '-d', tmpRoot], { stdio: 'ignore' });
      } catch {
        // 无 unzip 命令时，尝试用 Python 的 zipfile 模块
        execFileSync('python3', ['-c', `import zipfile; zipfile.ZipFile(${JSON.stringify(sourcePath)}).extractall(${JSON.stringify(tmpRoot)})`], { stdio: 'ignore' });
      }
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      execFileSync('tar', ['-xzf', sourcePath, '-C', tmpRoot], { stdio: 'ignore' });
    } else if (lower.endsWith('.tar')) {
      execFileSync('tar', ['-xf', sourcePath, '-C', tmpRoot], { stdio: 'ignore' });
    } else {
      return { success: false, error: '不支持的文件格式（支持 .zip / .tar.gz / .tar）' };
    }

    // 在 tmpRoot 里查找 SKILL.md，确定实际 skill 目录
    const found = findSkillRoot(tmpRoot);
    if (!found) {
      return { success: false, error: '解压后未找到 SKILL.md' };
    }
    const name = skillName || found.name;
    const destDir = path.join(DEFAULT_SKILLS_DIR, name);
    // 安全检查：防止路径穿越（skillName 可能包含 ../）
    const destResolved = path.resolve(destDir);
    const baseResolved = path.resolve(DEFAULT_SKILLS_DIR);
    if (!destResolved.startsWith(baseResolved + path.sep)) {
      return { success: false, error: '非法 skill 名称' };
    }
    // 确保目标目录存在
    if (!fs.existsSync(DEFAULT_SKILLS_DIR)) fs.mkdirSync(DEFAULT_SKILLS_DIR, { recursive: true });
    // 覆盖式导入
    removeDirRecursive(destDir);
    copyDirRecursive(found.dir, destDir);
    return { success: true, name, path: destDir };
  } catch (err) {
    return { success: false, error: '导入失败：' + err.message };
  } finally {
    removeDirRecursive(tmpRoot);
  }
}

/** 在目录树中查找含 SKILL.md 的 skill 根目录 */
function findSkillRoot(dir) {
  const skillMd = path.join(dir, 'SKILL.md');
  if (fs.existsSync(skillMd)) {
    return { name: path.basename(dir), dir };
  }
  // 查找一层子目录
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    if (fs.existsSync(path.join(sub, 'SKILL.md'))) {
      return { name: entry.name, dir: sub };
    }
  }
  return null;
}

/**
 * 删除 skill — 删除 skills/builtin/{skillName}/ 目录
 * @param {string} skillName skill 名
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteSkill(skillName) {
  const dir = path.join(DEFAULT_SKILLS_DIR, skillName);
  if (!fs.existsSync(dir)) {
    return { success: false, error: `Skill 不存在: ${skillName}` };
  }
  // 安全检查：必须位于 DEFAULT_SKILLS_DIR 内，防止路径穿越
  const resolved = path.resolve(dir);
  const baseResolved = path.resolve(DEFAULT_SKILLS_DIR);
  if (!resolved.startsWith(baseResolved + path.sep)) {
    return { success: false, error: '非法路径' };
  }
  if (!fs.existsSync(path.join(resolved, 'SKILL.md'))) {
    return { success: false, error: `目标目录不是有效 skill: ${skillName}` };
  }
  removeDirRecursive(resolved);
  return { success: true };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('loader.js')) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    const skills = loadAllSkills();
    console.log(`Found ${skills.length} skills in ${DEFAULT_SKILLS_DIR}\n`);
    for (const s of skills) {
      console.log(`  ${s.official ? '★' : ' '} ${s.name.padEnd(28)} ${s.hasScripts ? '[scripts]' : '        '}  ${s.description.slice(0, 60)}`);
    }
  }
}
