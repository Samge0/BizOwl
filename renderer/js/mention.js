// mention.js — renderer module (split from index.html)

      // ─────────────────────────────────────────────
      // @企业提及（模糊搜索 + loading + 键盘导航）
      // ─────────────────────────────────────────────
      let mentionSearchTimer = null;
      let mentionResults = []; // 当前搜索结果缓存
      let mentionSelectedIndex = -1; // 键盘选中索引

      function getMentionItems() {
        return dom.mentionDropdown ? dom.mentionDropdown.querySelectorAll('.mention-item[data-idx]') : [];
      }

      function highlightMentionItem(index) {
        const items = getMentionItems();
        items.forEach((el, i) => {
          el.classList.toggle('mention-active', i === index);
        });
        // 滚动到可视区域（部分环境无 scrollIntoView，需防御）
        if (index >= 0 && items[index] && typeof items[index].scrollIntoView === 'function') {
          items[index].scrollIntoView({ block: 'nearest' });
        }
        mentionSelectedIndex = index;
      }

      function selectMentionByIndex(index) {
        const items = getMentionItems();
        if (index >= 0 && index < items.length) {
          const company = mentionResults[index];
          if (company) {
            insertMention(company.name || company, company.keyNo, company);
          }
        }
      }
      let companySearchTimer = null;
      function openCompanySearchModal() {
        if (!dom.companyModalOverlay) return;
        if (!api?.searchCompanies) { showToast('搜索 API 不可用', 'error'); return; }
        dom.companyModalOverlay.style.display = '';
        dom.companySearchInput.value = '';
        dom.companyModalResults.innerHTML = '<div class="company-modal-hint">💡 输入公司名搜索并引用企业</div>';
        setTimeout(() => dom.companySearchInput?.focus(), 0);
      }
      function closeCompanySearchModal() {
        if (dom.companyModalOverlay) dom.companyModalOverlay.style.display = 'none';
        clearTimeout(companySearchTimer);
        dom.chatInput?.focus();
      }
      function renderCompanyModalResults(results, q) {
        if (!results.length) {
          dom.companyModalResults.innerHTML = `<div class="company-modal-hint">🔍 未找到匹配 "${escapeHtml(q)}" 的企业</div>`;
          return;
        }
        dom.companyModalResults.innerHTML = '';
        results.forEach((c) => {
          const item = document.createElement('div');
          item.className = 'company-result';
          const logo = document.createElement('img');
          logo.className = 'company-logo';
          logo.src = c.imageUrl || '';
          logo.alt = '';
          logo.onerror = () => { logo.style.display = 'none'; };
          const info = document.createElement('div');
          info.className = 'company-info';
          const name = document.createElement('div');
          name.className = 'company-name';
          name.textContent = c.name || '';
          const sub = document.createElement('div');
          sub.className = 'company-sub';
          const parts = [];
          if (c.operatingStatus) parts.push(c.operatingStatus);
          if (c.legalRep) parts.push('法人: ' + c.legalRep);
          if (c.regCap) parts.push(c.regCap);
          sub.textContent = parts.join(' · ');
          info.appendChild(name);
          info.appendChild(sub);
          item.appendChild(logo);
          item.appendChild(info);
          item.addEventListener('click', () => {
            insertCompanyMention(c);
            closeCompanySearchModal();
          });
          dom.companyModalResults.appendChild(item);
        });
      }
      function insertCompanyMention(company) {
        const input = dom.chatInput;
        const name = company.name || '';
        // 在光标处插入 @公司名（带空格），若末尾无空格则补一个
        const pos = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, pos);
        const after = input.value.slice(pos);
        const needSpaceBefore = before && !/\s$/.test(before) ? ' ' : '';
        const insert = `${needSpaceBefore}@${name} `;
        input.value = before + insert + after;
        const newPos = (before + insert).length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
        const mention = { name, keyNo: company.keyNo };
        if (company.imageUrl) mention.imageUrl = company.imageUrl;
        state.mentionedCompanies.push(mention);
        debugLog('inserted company mention:', name);
      }

      async function showMentionDropdown(keyword) {
        if (!dom.mentionDropdown) return;
        if (!api?.searchCompanies) {
          hideMentionDropdown();
          return;
        }
        mentionSelectedIndex = -1;
        // 空关键词显示提示
        if (!keyword) {
          dom.mentionDropdown.innerHTML = '<div class="mention-item mention-hint"><span class="mention-name">💡 输入公司名搜索...</span></div>';
          dom.mentionDropdown.classList.add('visible');
          return;
        }
        clearTimeout(mentionSearchTimer);
        // 立即显示 loading 状态
        dom.mentionDropdown.innerHTML = '<div class="mention-item mention-loading"><span class="mention-name">⏳ 搜索中...</span></div>';
        dom.mentionDropdown.classList.add('visible');
        mentionSearchTimer = setTimeout(async () => {
          try {
            const resp = await api.searchCompanies(keyword);
            // IPC 返回 {success, companies}（兼容旧版直接返回数组）
            let results;
            if (resp && typeof resp === 'object' && !Array.isArray(resp) && 'success' in resp) {
              if (!resp.success) {
                dom.mentionDropdown.innerHTML = `<div class="mention-item mention-error"><span class="mention-name">❌ ${escapeHtml(resp.error || '搜索失败，请先登录数据源')}</span></div>`;
                return;
              }
              results = Array.isArray(resp.companies) ? resp.companies : [];
            } else {
              results = Array.isArray(resp) ? resp : [];
            }
            mentionResults = results;
            if (mentionResults.length === 0) {
              dom.mentionDropdown.innerHTML = `<div class="mention-item mention-empty"><span class="mention-name">🔍 未找到匹配 "${escapeHtml(keyword)}" 的企业</span></div>`;
              return;
            }
            dom.mentionDropdown.innerHTML = '';
            mentionResults.forEach((company, idx) => {
              const item = document.createElement('div');
              item.className = 'mention-item';
              item.dataset.idx = idx;

              const name = document.createElement('div');
              name.className = 'mention-name';
              name.textContent = company.name || company;

              // 额外信息：经营状态、法定代表人等
              const subParts = [];
              if (company.operatingStatus || company.businessStatus) subParts.push(company.operatingStatus || company.businessStatus);
              if (company.legalRep || company.legalPerson) subParts.push('法人: ' + (company.legalRep || company.legalPerson));
              if (company.regCap || company.registeredCapital) subParts.push(company.regCap || company.registeredCapital);
              if (company.keyNo && subParts.length === 0) subParts.push(company.keyNo);

              const sub = document.createElement('div');
              sub.className = 'mention-sub';
              sub.textContent = subParts.join(' · ');

              item.appendChild(name);
              if (subParts.length > 0) item.appendChild(sub);

              item.addEventListener('click', () => {
                insertMention(company.name || company, company.keyNo, company);
              });
              item.addEventListener('mouseenter', () => highlightMentionItem(idx));
              dom.mentionDropdown.appendChild(item);
            });
            // 默认选中第一项
            if (mentionResults.length > 0) highlightMentionItem(0);
          } catch (err) {
            debugError('searchCompanies error:', err);
            dom.mentionDropdown.innerHTML = '<div class="mention-item mention-error"><span class="mention-name">❌ 搜索失败，请重试</span></div>';
          }
        }, 300);
      }

      function hideMentionDropdown() {
        if (dom.mentionDropdown) dom.mentionDropdown.classList.remove('visible');
        mentionSelectedIndex = -1;
        mentionResults = [];
      }

      function insertMention(name, keyNo, companyInfo) {
        const input = dom.chatInput;
        const val = input.value;
        const pos = input.selectionStart;
        const before = val.slice(0, pos);
        const after = val.slice(pos);
        // 替换 @keyword 为 @name（用函数替换：返回值按字面使用，避免公司名含 $ 时被替换串特殊模式破坏）
        const newBefore = before.replace(/@([^\s@]*)$/, () => '@' + name + ' ');
        input.value = newBefore + after;
        const newPos = newBefore.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
        // 记录提及的企业
        const mention = { name, keyNo };
        if (companyInfo) mention.info = companyInfo;
        state.mentionedCompanies.push(mention);
        hideMentionDropdown();
      }
