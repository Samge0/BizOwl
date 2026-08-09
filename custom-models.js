/**
 * custom-models.js — 自定义模型配置（JSON 文件持久化）
 * 
 * 存储路径：~/.BizOwl/models.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// 配置存储路径
function getConfigDir() {
  return path.join(homedir(), '.BizOwl');
}

function getModelsPath() {
  return path.join(getConfigDir(), 'models.json');
}

/** 默认空模型列表 */
const DEFAULT_MODELS = [];

/** 生成稳定唯一 ID（时间戳 + 随机后缀） */
function genId() {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 加载自定义模型（自动补全 _id，保证每条记录都有稳定标识） */
export function loadCustomModels() {
  try {
    const modelsPath = getModelsPath();
    if (fs.existsSync(modelsPath)) {
      const raw = fs.readFileSync(modelsPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        // 向后兼容：为缺失 _id 的旧记录补全
        let changed = false;
        for (const m of data) {
          if (m && typeof m === 'object' && !m._id) {
            m._id = genId();
            changed = true;
          }
        }
        // 有补全则回写磁盘，避免下次重复补
        if (changed) {
          try { fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2), 'utf8'); } catch {}
        }
        return data;
      }
      return DEFAULT_MODELS;
    }
  } catch (err) {
    console.warn('[CustomModels] 加载失败:', err.message);
  }
  return DEFAULT_MODELS;
}

/** 生成新模型 ID（供渲染层添加模型时调用） */
export function newModelId() {
  return genId();
}

/** 保存自定义模型 */
export function saveCustomModels(models) {
  try {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const modelsPath = getModelsPath();
    fs.writeFileSync(modelsPath, JSON.stringify(models, null, 2), 'utf8');
    console.log('[CustomModels] 保存成功:', models.length, '个模型');
    return true;
  } catch (err) {
    console.error('[CustomModels] 保存失败:', err.message);
    return false;
  }
}

/** 获取自定义模型（用于 IPC） */
export function getCustomModels() {
  return loadCustomModels();
}

/** 添加自定义模型 */
export function addCustomModel(model) {
  const models = loadCustomModels();
  models.push(model);
  return saveCustomModels(models);
}

/** 更新自定义模型 */
export function updateCustomModel(index, model) {
  const models = loadCustomModels();
  if (index >= 0 && index < models.length) {
    models[index] = model;
    return saveCustomModels(models);
  }
  return false;
}
