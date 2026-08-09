/**
 * 搜索结果相关性评分系统
 *
 * 对每条搜索结果打 0-100 分，衡量其与查询的相关性。
 * 用于多引擎聚合时排序，以及低质量结果降级。
 */

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
    'baijiahao.baidu.com',
    'k.sina.com.cn',
    // 企业信息（已被 urlBlacklist 覆盖，这里再降级一层）
    'qcc.com',
    'tianyancha.com',
    'qixin.com',
];

// ─── 停用词（中英文）───
const STOP_WORDS = new Set<string>([
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

export interface QueryTerms {
    terms: string[];
    phrases: string[];
    bigrams: string[];
}

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source?: string;
    position?: number;
    _relevanceScore?: number;
}

/**
 * 从查询中提取有意义的搜索词
 */
export function extractQueryTerms(query: string): QueryTerms {
    if (!query) return { terms: [], phrases: [], bigrams: [] };
    const cleaned = query.replace(/[""''（）()【】\[\]{}/<>]/g, ' ').trim();
    // 提取引号包裹的短语（精确匹配）
    const phraseMatches = cleaned.match(/[""]([^""]+)[""]/g);
    const phrases = phraseMatches
        ? phraseMatches.map(p => p.replace(/[""]/g, '')).filter(p => p.length > 1)
        : [];
    // 按空格分词
    const rawTokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    const terms: string[] = [];
    const bigramSet = new Set<string>();
    for (const token of rawTokens) {
        if (/^[a-zA-Z0-9\-_.]+$/.test(token)) {
            const lower = token.toLowerCase();
            if (!STOP_WORDS.has(lower) && token.length > 1) {
                terms.push(lower);
            }
        } else {
            if (token.length <= 4 && !STOP_WORDS.has(token)) {
                terms.push(token);
            }
            const chineseChars = token.replace(/[^\u4e00-\u9fa5]/g, '');
            for (let i = 0; i < chineseChars.length - 1; i++) {
                bigramSet.add(chineseChars.substring(i, i + 2));
            }
            for (let i = 0; i < chineseChars.length - 2; i++) {
                bigramSet.add(chineseChars.substring(i, i + 3));
            }
        }
    }
    return { terms, phrases, bigrams: Array.from(bigramSet) };
}

function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname.toLowerCase();
    } catch {
        return '';
    }
}

function domainMatches(hostname: string, domainList: string[]): boolean {
    return domainList.some(domain =>
        hostname === domain || hostname.endsWith('.' + domain)
    );
}

/**
 * 对单条搜索结果打分（0-100）
 */
export function scoreResult(result: SearchResult, queryTerms: QueryTerms): number {
    const { terms, phrases, bigrams } = queryTerms;
    let score = 50;

    const titleLower = (result.title || '').toLowerCase();
    const snippetLower = (result.snippet || '').toLowerCase();
    const combinedText = titleLower + ' ' + snippetLower;

    // 标题精确短语匹配
    for (const phrase of phrases) {
        if (titleLower.includes(phrase.toLowerCase())) {
            score += 20;
        } else if (snippetLower.includes(phrase.toLowerCase())) {
            score += 8;
        }
    }

    // 词覆盖
    let titleHits = 0;
    let snippetHits = 0;
    for (const term of terms) {
        if (titleLower.includes(term)) titleHits++;
        if (snippetLower.includes(term)) snippetHits++;
    }
    const totalTerms = terms.length || 1;
    score += (titleHits / totalTerms) * 25;
    score += (snippetHits / totalTerms) * 10;

    // 中文二元组
    if (bigrams.length > 0) {
        let bigramHits = 0;
        for (const bg of bigrams) {
            if (combinedText.includes(bg)) bigramHits++;
        }
        score += (bigramHits / bigrams.length) * 15;
    }

    // 域名质量
    const domain = extractDomain(result.url);
    if (domainMatches(domain, HIGH_QUALITY_DOMAINS)) score += 15;
    if (domainMatches(domain, LOW_QUALITY_DOMAINS)) score -= 25;

    // 内容丰富度
    const snippetLen = (result.snippet || '').length;
    if (snippetLen < 20) score -= 10;
    else if (snippetLen > 80) score += 5;

    // URL 深度
    try {
        const parsed = new URL(result.url);
        const pathDepth = parsed.pathname.split('/').filter(Boolean).length;
        if (pathDepth >= 2) score += 3;
        else if (pathDepth === 0 || parsed.pathname === '/') score -= 5;
    } catch {}

    // 词典/定义类标题降级
    const titleStr = result.title || '';
    if (/^(什么是|什么叫|.*是什么|.*的意思|.*的定义|.*含义)/.test(titleStr)) {
        score -= 15;
    }
    if (/词典|字典|百科释义|在线翻译|汉语词典/.test(snippetLower)) {
        score -= 20;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 评分并排序
 */
export function scoreAndSort(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = extractQueryTerms(query);
    const scored = results.map(result => ({
        ...result,
        _relevanceScore: scoreResult(result, queryTerms)
    }));
    scored.sort((a, b) => {
        const diff = (b._relevanceScore || 0) - (a._relevanceScore || 0);
        if (Math.abs(diff) > 0.5) return diff;
        return (a.position || 0) - (b.position || 0);
    });
    return scored;
}
