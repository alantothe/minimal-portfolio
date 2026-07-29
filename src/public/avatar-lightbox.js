const triggerSelector = "[data-avatar-lightbox-trigger]";
const dialogSelector = "[data-avatar-lightbox]";
const closeSelector = "[data-avatar-lightbox-close]";

export function attachAvatarLightboxListener(root = document) {
  root.addEventListener("click", (event) => {
    const target = event.target;

    if (!target || typeof target.closest !== "function") {
      return;
    }

    const trigger = target.closest(triggerSelector);
    if (trigger) {
      const dialogId = trigger.getAttribute("aria-controls");
      const dialog = dialogId ? root.getElementById(dialogId) : null;

      if (dialog && !dialog.open) {
        dialog.addEventListener("close", () => trigger.focus(), { once: true });
        dialog.showModal();
      }
      return;
    }

    const closeControl = target.closest(closeSelector);
    if (closeControl) {
      closeControl.closest(dialogSelector)?.close();
      return;
    }

    if (target.matches(dialogSelector)) {
      target.close();
    }
  });
}

if (typeof document !== "undefined") {
  attachAvatarLightboxListener();
}
