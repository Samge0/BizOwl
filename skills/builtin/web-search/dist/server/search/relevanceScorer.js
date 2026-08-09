"use strict";
/**
 * 搜索结果相关性评分系统
 *
 * 对每条搜索结果打 0-100 分，衡量其与查询的相关性。
 * 用于多引擎聚合时排序，以及低质量结果降级。
 *
 * 评分维度：
 *   - 关键词覆盖率（查询词在标题/摘要中的出现比例）
 *   - 标题匹配权重（标题命中 = 3x 摘要命中）
 *   - 域名质量分级（权威域名加分，词典/百科/SEO农场降分）
 *   - 内容长度奖励（过短摘要可能是无关片段）
 *   - 词典/百科内容降级（用户反馈的核心痛点）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreResult = scoreResult;
exports.scoreAndSort = scoreAndSort;
exports.extractQueryTerms = extractQueryTerms;

// ─── 域名质量分级 ───

// 权威域名：官方机构/知名媒体/行业网站 → 加分
const HIGH_QUALITY_DOMAINS = [
    // 政府/教育
    'gov.cn', 'edu.cn', 'gouv.fr', 'gov.uk',
    // 科技媒体/行业资讯
    '36kr.com', 'techcrunch.com', 'arstechnica.com',
    'theverge.com', 'wired.com', 'reuters.com',
    'bloomberg.com', 'ft.com', 'economist.com',
    // 中文科技/商业媒体
    'geekpark.net', 'huxiu.com', 'pingwest.com',
    'ifanr.com', 'leiphone.com', 'sspai.com',
    'cnbeta.com', 'ithome.com', 'oschina.net',
    'csdn.net', 'juejin.cn', 'zhihu.com',
    'segmentfault.com', 'infoq.cn',
    // 学术/研究
    'arxiv.org', 'ieee.org', 'acm.org',
    'nature.com', 'science.org', 'sciencedirect.com',
    // 官方文档
    'developer.mozilla.org', 'w3.org',
    'docs.python.org', 'nodejs.org',
];

// 低质量域名：词典/百科/SEO农场/内容聚合 → 降分
// 这些是"搜索机器人""具身智能"等技术词返回词典定义的主要来源
const LOW_QUALITY_DOMAINS = [
    // 百科/词典（对技术/商业查询通常是无用的定义解释）
    'baike.baidu.com',
    'baike.so.com',
    'baike.sogou.com',
    'zhidao.baidu.com',
    'wenku.baidu.com',
    'dict.cn',
    'dict.youdao.com',
    'zidian.kk.tc',
    'cdict.cn',
    'guoxue.com',
    // 翻译/词典
    'fanyi.baidu.com',
    'fanyi.youdao.com',
    'translate.google.com',
    // SEO/内容农场/低质量聚合
    'shichern.com',
    'baijiahao.baidu.com',   // 百家号质量参差不齐
    'k.sina.com.cn',         // 快讯质量低
    // 企业信息（已被 urlBlacklist 覆盖，这里再降级一层）
    'qcc.com',
    'tianyancha.com',
    'qixin.com',
];

// ─── 停用词（中英文）───
const STOP_WORDS = new Set([
    // 中文
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
    '看', '好', '自己', '这', '那', '它', '他', '她', '什么', '怎么', '为什么',
    '哪里', '哪个', '可以', '能', '吗', '呢', '吧', '啊', '嗯', '哦',
    // 英文
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'need', 'shall',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
    'and', 'or', 'not', 'but', 'if', 'then', 'else', 'when', 'where',
    'what', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'about', 'into', 'through', 'during', 'before', 'after',
]);

/**
 * 从查询中提取有意义的搜索词
 * 对中文：按词和字符二元组提取
 * 对英文：按空格分词+过滤停用词
 */
function extractQueryTerms(query) {
    if (!query) return { terms: [], phrases: [], bigrams: [] };
    const cleaned = query.replace(/[""''（）()【】\[\]{}/<>]/g, ' ').trim();
    // 提取引号包裹的短语（精确匹配）
    const phraseMatches = cleaned.match(/[""]([^""]+)[""]/g);
    const phrases = phraseMatches
        ? phraseMatches.map(p => p.replace(/[""]/g, '')).filter(p => p.length > 1)
        : [];
    // 按空格分词（处理中英混合）
    const rawTokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    const terms = [];
    const bigrams = new Set();
    for (const token of rawTokens) {
        // 英文 token
        if (/^[a-zA-Z0-9\-_.]+$/.test(token)) {
            const lower = token.toLowerCase();
            if (!STOP_WORDS.has(lower) && token.length > 1) {
                terms.push(lower);
            }
        } else {
            // 中文 token：提取 2-3 字组合作为词
            // 同时保留完整的 token 作为一个 term
            if (token.length <= 4 && !STOP_WORDS.has(token)) {
                terms.push(token);
            }
            // 提取中文二元组（覆盖分词不准的情况）
            const chineseChars = token.replace(/[^\u4e00-\u9fa5]/g, '');
            for (let i = 0; i < chineseChars.length - 1; i++) {
                bigrams.add(chineseChars.substring(i, i + 2));
            }
            // 3-gram 也加入（提高匹配精度）
            for (let i = 0; i < chineseChars.length - 2; i++) {
                bigrams.add(chineseChars.substring(i, i + 3));
            }
        }
    }
    return { terms, phrases, bigrams: Array.from(bigrams) };
}

/**
 * 提取域名的主机名（用于质量分级判断）
 */
function extractDomain(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.toLowerCase();
    } catch {
        return '';
    }
}

/**
 * 检查域名是否属于某个域名列表（支持子域名匹配）
 */
function domainMatches(hostname, domainList) {
    return domainList.some(domain =>
        hostname === domain || hostname.endsWith('.' + domain)
    );
}

/**
 * 对单条搜索结果打分（0-100）
 *
 * @param result 搜索结果 { title, url, snippet }
 * @param queryTerms 查询词提取结果
 * @returns 0-100 分数，越高越相关
 */
function scoreResult(result, queryTerms) {
    const { terms, phrases, bigrams } = queryTerms;
    let score = 50; // 基础分

    // ─── 1. 关键词覆盖评分 ───
    const titleLower = (result.title || '').toLowerCase();
    const snippetLower = (result.snippet || '').toLowerCase();
    const combinedText = titleLower + ' ' + snippetLower;

    // 标题精确短语匹配（最高权重）
    for (const phrase of phrases) {
        if (titleLower.includes(phrase.toLowerCase())) {
            score += 20; // 标题包含完整短语
        } else if (snippetLower.includes(phrase.toLowerCase())) {
            score += 8;
        }
    }

    // 标题词匹配（权重 3x）
    let titleHits = 0;
    let snippetHits = 0;
    for (const term of terms) {
        if (titleLower.includes(term)) {
            titleHits++;
        }
        if (snippetLower.includes(term)) {
            snippetHits++;
        }
    }
    // 词覆盖率：命中数 / 总词数
    const totalTerms = terms.length || 1;
    const titleCoverage = titleHits / totalTerms;
    const snippetCoverage = snippetHits / totalTerms;
    score += titleCoverage * 25; // 标题覆盖最高 +25
    score += snippetCoverage * 10; // 摘要覆盖最高 +10

    // 中文二元组匹配（补充分词不准）
    if (bigrams.length > 0) {
        let bigramHits = 0;
        for (const bg of bigrams) {
            if (combinedText.includes(bg)) {
                bigramHits++;
            }
        }
        const bigramCoverage = bigramHits / bigrams.length;
        score += bigramCoverage * 15; // 二元组覆盖最高 +15
    }

    // ─── 2. 域名质量分级 ───
    const domain = extractDomain(result.url);
    if (domainMatches(domain, HIGH_QUALITY_DOMAINS)) {
        score += 15; // 权威域名加分
    }
    if (domainMatches(domain, LOW_QUALITY_DOMAINS)) {
        score -= 25; // 词典/百科/SEO农场降分
    }

    // ─── 3. 内容丰富度 ───
    const snippetLen = (result.snippet || '').length;
    if (snippetLen < 20) {
        score -= 10; // 过短摘要可能是垃圾结果
    } else if (snippetLen > 80) {
        score += 5; // 丰富摘要通常质量更好
    }

    // ─── 4. URL 深度（文章页 vs 首页）───
    try {
        const parsed = new URL(result.url);
        const pathDepth = parsed.pathname.split('/').filter(Boolean).length;
        if (pathDepth >= 2) {
            score += 3; // 有一定路径深度的通常是具体文章
        } else if (pathDepth === 0 || parsed.pathname === '/') {
            score -= 5; // 首页通常不够具体
        }
    } catch {}

    // ─── 5. 特殊降级：词典/定义类标题模式 ───
    const titleStr = result.title || '';
    // 标题中出现"是什么""什么叫""定义""意思"等词典模式
    if (/^(什么是|什么叫|.*是什么|.*的意思|.*的定义|.*含义)/.test(titleStr)) {
        score -= 15;
    }
    // 摘要中出现"词典""字典""百科释义"等
    if (/词典|字典|百科释义|在线翻译|汉语词典/.test(snippetLower)) {
        score -= 20;
    }

    // 钳制到 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 对搜索结果数组评分并按相关性排序
 *
 * @param results 搜索结果数组
 * @param query 原始查询字符串
 * @returns 评分+排序后的结果（附加 _relevanceScore 字段）
 */
function scoreAndSort(results, query) {
    const queryTerms = extractQueryTerms(query);
    const scored = results.map(result => ({
        ...result,
        _relevanceScore: scoreResult(result, queryTerms)
    }));
    // 按相关性降序，相关性相同则保持原始顺序（搜索引擎的排名）
    scored.sort((a, b) => {
        const diff = b._relevanceScore - a._relevanceScore;
        if (Math.abs(diff) > 0.5) return diff;
        return (a.position || 0) - (b.position || 0);
    });
    return scored;
}
