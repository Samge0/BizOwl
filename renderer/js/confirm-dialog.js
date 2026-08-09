// confirm-dialog.js — 通用确认弹窗（替代原生 window.confirm，使用应用图标）
//
// 原生 window.confirm 在 Electron 下会显示默认/Electron 图标，无法自定义。
// 这里提供一个与应用风格一致、带应用图标的确认弹窗：
//   const ok = await showConfirmDialog({ title, message, confirmText, cancelText, danger });
// 危险操作（删除）传 danger:true → 确认键变红，且默认聚焦"取消"以防误按回车。

(function () {
  const overlay = document.getElementById('confirmDialogOverlay');
  const dialogEl = overlay ? overlay.querySelector('.confirm-dialog') : null;
  const titleEl = document.getElementById('confirmDialogTitle');
  const msgEl = document.getElementById('confirmDialogMessage');
  const confirmBtn = document.getElementById('confirmDialogConfirm');
  const cancelBtn = document.getElementById('confirmDialogCancel');

  let activeResolver = null;

  function close(value) {
    if (!overlay) return;
    overlay.style.display = 'none';
    if (activeResolver) {
      const r = activeResolver;
      activeResolver = null;
      r(value);
    }
  }

  /**
   * 显示确认弹窗，返回 Promise<boolean>（true=确认，false=取消）。
   * @param {{title?:string, message?:string, confirmText?:string, cancelText?:string, danger?:boolean}} [opts]
   */
  function showConfirmDialog(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      // 兜底：DOM 缺失时回退原生 confirm（如 headless 测试环境）
      if (!overlay || !confirmBtn || !cancelBtn || !titleEl || !msgEl) {
        resolve(window.confirm(opts.message || ''));
        return;
      }
      activeResolver = resolve;
      titleEl.textContent = opts.title || '确认操作';
      msgEl.textContent = opts.message || '';
      confirmBtn.textContent = opts.confirmText || '确定';
      cancelBtn.textContent = opts.cancelText || '取消';
      if (dialogEl) dialogEl.classList.toggle('danger', !!opts.danger);
      overlay.style.display = 'flex';
      // 危险操作默认聚焦"取消"，按回车=取消，避免误触删除
      (opts.danger ? cancelBtn : confirmBtn).focus();
    });
  }

  if (confirmBtn) confirmBtn.addEventListener('click', () => close(true));
  if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));
  if (overlay) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  }
  document.addEventListener('keydown', (e) => {
    if (!overlay || overlay.style.display === 'none') return;
    if (e.key === 'Escape') close(false);
  });

  window.showConfirmDialog = showConfirmDialog;
})();
