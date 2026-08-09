// core.js — renderer module (split from index.html)

      const api = window.clawAPI;
      const hasAPI = !!api;

      // ─────────────────────────────────────────────
      // 全局状态
      // ─────────────────────────────────────────────
      const state = {
        sessions: [],              // 会话列表
        currentSessionId: null,    // 当前会话 ID
        messages: [],              // 当前会话消息 [{role, content, timestamp, toolCalls?, toolResults?}]
        conversationHistory: [],   // 发送给 LLM 的历史 [{role, content}]
        selectedModelIndex: -1,
        selectedModel: null,
        allModels: [],
        selectedAgentId: null,
        activePreset: null,  // { id, title, label, prompt } 当前激活的预设场景
        attachments: [],     // [{ name, size, type, path }] 待发送的附件
        mentionedCompanies: [], // [{ name, keyNo }] @引用的企业
        presetAgents: [],
        authSession: null,         // { isLoggedIn, phone, userInfo, apiBaseUrl, hasToken }
        searchQuery: '',
        _switchVersion: 0,         // 切换版本号 guard（防快速 A→B→C 切换时旧加载覆盖新视图）
      };

      // ─────────────────────────────────────────────
      // 多会话并行状态追踪（每个会话独立）
      // ─────────────────────────────────────────────
      const sessionStates = new Map(); // sessionId → { isSending, requestId, live, tokenUsage }

      function getSessionState(sessionId) {
        if (!sessionId) return { isSending: false, requestId: null, live: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
        if (!sessionStates.has(sessionId)) {
          // 首次访问该会话时，从已持久化的会话元数据恢复累计 token（重启后不归零）
          const persisted = (state.sessions || []).find((s) => s && s.id === sessionId);
          const persistedUsage = (persisted && persisted.tokenUsage)
            ? persisted.tokenUsage
            : { prompt: 0, completion: 0, total: 0 };
          sessionStates.set(sessionId, { isSending: false, requestId: null, live: null, tokenUsage: persistedUsage });
        }
        const ss = sessionStates.get(sessionId);
        if (!ss.live) ss.live = { text: '', tools: [], view: null };
        if (!ss.tokenUsage) ss.tokenUsage = { prompt: 0, completion: 0, total: 0 };
        return ss;
      }

      // 快捷场景
      const QUICK_ACTIONS = [
        { title: '查企业信息', desc: '查询公司工商信息、股权、风险', prompt: '帮我查询华为技术有限公司的工商基本信息、法定代表人、注册资本和经营状态' },
        { title: '股权穿透', desc: '分析公司股东结构和实际控制人', prompt: '帮我分析比亚迪股份有限公司的股权穿透图，识别实际控制人' },
        { title: '制作PPT', desc: '生成工作汇报或调研报告幻灯片', prompt: '制作一份季度工作汇报PPT，包含核心成果、项目进展、数据指标和下季度计划' },
        { title: '内容创作', desc: '撰写公众号文章或营销文案', prompt: '帮我写一篇关于AI在教育领域应用的深度分析文章，2000字左右' },
      ];

      // ─────────────────────────────────────────────
      // DOM 引用
      // ─────────────────────────────────────────────
      const $ = (id) => document.getElementById(id);
      const dom = {
        sidebar: $('sidebar'),
        settingsPanel: $('settingsPanel'),
        settingsOverlay: $('settingsOverlay'),
        // 旧元素（部分已移除，保留 null-safe 引用）
        sessionList: null,
        searchInput: null,
        newChatBtn: null,
        // 新侧栏元素
        navNewChat: $('navNewChat'),
        navSearch: $('navSearch'),
        navSkills: $('navSkills'),
        historyList: $('historyList'),
        sessionSearchBox: $('sessionSearchBox'),
        sessionSearchInput: $('sessionSearchInput'),
        sessionSearchClose: $('sessionSearchClose'),
        openSettingsBtn: $('openSettingsBtn'),
        skillsPopover: $('skillsPopover'),
        skillsList: $('skillsList'),
        closeSkillsPopover: $('closeSkillsPopover'),
        importSkillBtn: $('importSkillBtn'),
        // 聊天区
        chatMessages: $('chatMessages'),
        chatGeneratingBar: $('chatGeneratingBar'),
        welcomePage: $('welcomePage'),
        chatInput: $('chatInput'),
        sendBtn: $('sendBtn'),
        stopBtn: $('stopBtn'),
        attachBtn: $('attachBtn'),
        mentionBtn: $('mentionBtn'),
        fileInput: $('fileInput'),
        attachmentPreview: $('attachmentPreview'),
        mentionDropdown: $('mentionDropdown'),
        companyModalOverlay: $('companyModalOverlay'),
        companySearchInput: $('companySearchInput'),
        companyModalResults: $('companyModalResults'),
        companyModalClose: $('companyModalClose'),
        imgLightbox: $('imgLightbox'),
        imgLightboxImg: $('imgLightboxImg'),
        imgLightboxClose: $('imgLightboxClose'),
        modelSelect: $('modelSelect'),
        agentGrid: $('agentGrid'),
        quickActions: $('quickActions'),
        modelList: $('modelList'),
        addModelBtn: $('addModelBtn'),
        authArea: $('authArea'),
        // 兼容旧引用（已无对应 DOM，置为安全占位）
        loginStatus: null,
        footerAvatar: null,
        footerLoginName: null,
        footerLoginSub: null,
        headerAgentName: $('headerAgentName'),
        headerAgentIcon: $('headerAgentIcon'),
        tokenStats: $('tokenStats'),
        tokenStatsValue: $('tokenStatsValue'),
        tokenStatsLimit: $('tokenStatsLimit'),
        toggleSettings: $('toggleSettings'),
        closeSettings: $('closeSettings'),
        expandSidebar: null,
        expandSettings: null,
        btnMinimize: $('btnMinimize'),
        btnMaximize: $('btnMaximize'),
        btnClose: $('btnClose'),
      };
