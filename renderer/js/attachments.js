// attachments.js — renderer module (split from index.html)

      // 拖拽上传
      const chatWrapper = document.querySelector('.chat-input-wrapper');

      /** 把图片 File 读成 data URL（供多模态 image_url 与展示缩略图） */
      function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
          reader.readAsDataURL(file);
        });
      }

      function getAttachmentIcon(type, name) {
        if (!type && name) {
          const ext = name.split('.').pop()?.toLowerCase();
          if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return '🖼️';
          if (ext === 'pdf') return '📄';
          if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
          if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝';
          if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return '🗜️';
          if (['mp4', 'avi', 'mov', 'mkv'].includes(ext)) return '🎬';
          if (['mp3', 'wav', 'flac'].includes(ext)) return '🎵';
          if (['js', 'ts', 'py', 'json', 'html', 'css', 'java', 'go', 'rs', 'c', 'cpp'].includes(ext)) return '💻';
        }
        if (type?.startsWith('image/')) return '🖼️';
        if (type?.includes('pdf')) return '📄';
        if (type?.includes('sheet') || type?.includes('excel') || type?.includes('csv')) return '📊';
        if (type?.includes('word') || type?.includes('document') || type?.includes('text')) return '📝';
        if (type?.includes('zip') || type?.includes('compressed') || type?.includes('archive')) return '🗜️';
        if (type?.startsWith('video/')) return '🎬';
        if (type?.startsWith('audio/')) return '🎵';
        if (type?.includes('javascript') || type?.includes('json') || type?.includes('code')) return '💻';
        return '📎';
      }

      function renderAttachments() {
        if (!dom.attachmentPreview) return;
        dom.attachmentPreview.innerHTML = '';
        state.attachments.forEach((att, i) => {
          const card = document.createElement('div');
          card.className = 'attachment-card';

          const isImage = att.type?.startsWith('image/') && att.file;

          // 缩略图区域（图片类型）
          if (isImage) {
            const thumb = document.createElement('img');
            thumb.className = 'attachment-thumb';
            // 存储 object URL 以便删除时 revoke（防止内存泄漏）
            if (!att._objectUrl) att._objectUrl = URL.createObjectURL(att.file);
            thumb.src = att._objectUrl;
            thumb.alt = att.name;
            card.appendChild(thumb);
          } else {
            // 文件类型图标
            const iconEl = document.createElement('span');
            iconEl.className = 'attachment-icon';
            iconEl.textContent = getAttachmentIcon(att.type, att.name);
            card.appendChild(iconEl);
          }

          // 文件信息（名称+大小）
          const info = document.createElement('div');
          info.className = 'attachment-info';
          const sizeStr = att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+'MB' : Math.round(att.size/1024)+'KB';
          const nameEl = document.createElement('span');
          nameEl.className = 'attachment-name';
          nameEl.textContent = att.name;
          nameEl.title = att.name;
          const sizeEl = document.createElement('span');
          sizeEl.className = 'attachment-size';
          sizeEl.textContent = sizeStr;
          info.appendChild(nameEl);
          info.appendChild(sizeEl);
          card.appendChild(info);

          // 删除按钮
          const rmBtn = document.createElement('span');
          rmBtn.className = 'remove-att';
          rmBtn.textContent = '×';
          rmBtn.title = '移除';
          rmBtn.addEventListener('click', () => {
            // 释放 object URL 避免内存泄漏
            if (isImage && att._objectUrl) URL.revokeObjectURL(att._objectUrl);
            state.attachments.splice(i, 1);
            renderAttachments();
          });
          card.appendChild(rmBtn);

          dom.attachmentPreview.appendChild(card);
        });
      }
