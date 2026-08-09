/**
 * paths.cjs — 将「逻辑技能路径」映射为「真实磁盘路径」
 *
 * 打包后所有文件位于 resources/app.asar 内（虚拟文件系统，仅 Electron
 * 补丁过的 fs 能读取）。但通过子进程执行的脚本（bash / node-as-node /
 * Playwright 库）走的是真实 OS open()，无法读取 asar 内部路径。
 * electron-builder 的 asarUnpack 会把这些文件释放到 app.asar.unpacked
 * 真实目录；本助手用经典的 asar → app.asar.unpacked 替换得到真实路径。
 * 开发模式下路径不含 app.asar，原样返回。
 *
 * 仅用于「子进程执行」场景（spawn 脚本 / 启动 server）。
 * 主进程里的 fs 读操作（如 loader.js 列出技能）继续用逻辑 asar 路径即可。
 */

const path = require('node:path');

/** 把 asar 虚拟路径转换为真实磁盘路径 */
function realPath(p) {
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

/** skills/builtin 的真实磁盘根路径（__dirname = .../src/skills） */
function skillsRoot() {
  return realPath(path.resolve(__dirname, '..', '..', 'skills', 'builtin'));
}

module.exports = { realPath, skillsRoot };
