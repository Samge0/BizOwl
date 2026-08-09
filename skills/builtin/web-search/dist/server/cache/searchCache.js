"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchCache = void 0;
exports.hashCacheKey = hashCacheKey;
const crypto_1 = require("crypto");
const keyv_1 = require("keyv");
function hashCacheKey(prefix, value) {
    const digest = (0, crypto_1.createHash)('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
    return `${prefix}:${digest}`;
}
class SearchCache {
    keyv;
    constructor() {
        this.keyv = new keyv_1.Keyv();
    }
    async get(key) {
        return await this.keyv.get(key);
    }
    async set(key, value, ttlMs) {
        await this.keyv.set(key, value, ttlMs);
    }
}
exports.SearchCache = SearchCache;
