"use strict";
/**
 * 搜索引擎动态评分系统
 *
 * 基于实际搜索结果的表现，对每个引擎维护一个动态评分。
 * 评分越高 = 越优先使用。使用指数移动平均（EMA），近期表现权重更高。
 *
 * 评分维度：
 *   - 成功返回结果 (+1 基础分 + 结果数量奖励)
 *   - 失败/超时/验证码 (-2 惩罚)
 *   - 速度奖励（越快加分越多）
 *
 * 存储：~/.BizOwl/engine-scores.json
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineScorer = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
// EMA 衰减因子：0.3 表示新数据占 30% 权重，历史数据占 70%
const EMA_ALPHA = 0.3;
// 每个引擎的初始评分（让新引擎有公平的机会被尝试）
const INITIAL_SCORE = 50;
// 评分下限（低于此值的引擎会被降到最低优先级，但不会完全排除——给它恢复的机会）
const MIN_SCORE = 0;
// 评分上限
const MAX_SCORE = 100;
// 结果数量奖励：每条结果加 0.5 分（最多 10 分）
const REWARD_PER_RESULT = 0.5;
const MAX_RESULT_REWARD = 10;
// 速度奖励：在 5 秒内完成额外加 5 分，线性衰减到 30 秒加 0 分
const SPEED_THRESHOLD_FAST_MS = 5000;
const SPEED_THRESHOLD_SLOW_MS = 30000;
const MAX_SPEED_REWARD = 5;
const SCORES_FILE = path.join(os.homedir(), '.BizOwl', 'engine-scores.json');
class EngineScorer {
    scores = {};
    lastLoaded = 0;
    constructor() {
        this.load();
    }
    /**
     * 从磁盘加载评分（每 60 秒最多加载一次，避免频繁 IO）
     */
    load() {
        const now = Date.now();
        if (now - this.lastLoaded < 60000 && Object.keys(this.scores).length > 0) {
            return;
        }
        this.lastLoaded = now;
        try {
            if (fs.existsSync(SCORES_FILE)) {
                const raw = fs.readFileSync(SCORES_FILE, 'utf8');
                const data = JSON.parse(raw);
                if (data && typeof data === 'object') {
                    this.scores = data;
                }
            }
        }
        catch {
            // 读取失败不影响功能
        }
    }
    /**
     * 持久化评分到磁盘（原子写）
     */
    save() {
        try {
            const dir = path.dirname(SCORES_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const tmp = SCORES_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.scores, null, 2), 'utf8');
            fs.renameSync(tmp, SCORES_FILE);
        }
        catch {
            // 写入失败不影响功能
        }
    }
    /**
     * 获取引擎当前评分
     */
    getScore(engine) {
        this.load();
        const entry = this.scores[engine];
        if (!entry) {
            return INITIAL_SCORE;
        }
        return entry.score;
    }
    /**
     * 记录一次搜索的结果，更新引擎评分
     *
     * @param engine 引擎名称
     * @param success 是否成功返回了结果
     * @param resultCount 返回的结果数量
     * @param durationMs 搜索耗时（毫秒）
     */
    recordSearch(engine, success, resultCount, durationMs) {
        this.load();
        const current = this.scores[engine]?.score ?? INITIAL_SCORE;
        let delta;
        if (success && resultCount > 0) {
            // 成功：基础分 + 结果数量奖励 + 速度奖励
            const resultReward = Math.min(resultCount * REWARD_PER_RESULT, MAX_RESULT_REWARD);
            const speedReward = durationMs <= SPEED_THRESHOLD_FAST_MS
                ? MAX_SPEED_REWARD
                : durationMs >= SPEED_THRESHOLD_SLOW_MS
                    ? 0
                    : MAX_SPEED_REWARD * (1 - (durationMs - SPEED_THRESHOLD_FAST_MS) / (SPEED_THRESHOLD_SLOW_MS - SPEED_THRESHOLD_FAST_MS));
            delta = 1 + resultReward + speedReward;
        }
        else {
            // 失败：惩罚
            delta = -2;
        }
        // EMA 更新：新评分 = 历史 × (1-α) + (当前评分+delta) × α
        const newRaw = current * (1 - EMA_ALPHA) + (current + delta) * EMA_ALPHA;
        const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, newRaw));
        const prev = this.scores[engine] || { score: INITIAL_SCORE, searches: 0, successes: 0, failures: 0, lastUpdated: 0 };
        this.scores[engine] = {
            score: Math.round(clamped * 100) / 100,
            searches: (prev.searches || 0) + 1,
            successes: success ? (prev.successes || 0) + 1 : (prev.successes || 0),
            failures: !success ? (prev.failures || 0) + 1 : (prev.failures || 0),
            lastUpdated: Date.now()
        };
        this.save();
    }
    /**
     * 获取所有引擎的统计信息（用于调试/展示）
     */
    getStats() {
        this.load();
        return { ...this.scores };
    }
    /**
     * 按动态评分对引擎列表排序（评分高的在前，评分相同则保持原始顺序）
     *
     * @param engines 原始引擎列表（静态优先级顺序）
     * @returns 按评分排序后的引擎列表
     */
    sortByScore(engines) {
        this.load();
        // 稳定排序：保持原始顺序作为 tie-breaker
        return [...engines].map((engine, originalIndex) => ({
            engine,
            score: this.getScore(engine),
            originalIndex
        })).sort((a, b) => {
            // 评分高的在前
            if (Math.abs(a.score - b.score) > 1) {
                return b.score - a.score;
            }
            // 评分接近（差 ≤1 分）→ 保持静态顺序（让用户配置的优先级有话语权）
            return a.originalIndex - b.originalIndex;
        }).map(item => item.engine);
    }
}
exports.EngineScorer = EngineScorer;
// 单例
let _instance = null;
function getEngineScorer() {
    if (!_instance) {
        _instance = new EngineScorer();
    }
    return _instance;
}
exports.default = getEngineScorer;
