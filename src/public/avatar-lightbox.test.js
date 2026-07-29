import { describe, expect, test } from "bun:test";
import { attachAvatarLightboxListener } from "./avatar-lightbox.js";

const triggerSelector = "[data-avatar-lightbox-trigger]";
const dialogSelector = "[data-avatar-lightbox]";
const closeSelector = "[data-avatar-lightbox-close]";

function createHarness() {
  const rootListeners = {};
  const dialogListeners = {};
  let triggerFocused = false;

  const dialog = {
    open: false,
    addEventListener(type, listener) {
      dialogListeners[type] = listener;
    },
    close() {
      this.open = false;
      dialogListeners.close?.();
    },
    closest() {
      return null;
    },
    matches(selector) {
      return selector === dialogSelector;
    },
    showModal() {
      this.open = true;
    },
  };

  const trigger = {
    closest(selector) {
      return selector === triggerSelector ? this : null;
    },
    focus() {
      triggerFocused = true;
    },
    getAttribute(name) {
      return name === "aria-controls" ? "profile-image-lightbox" : null;
    },
  };

  const closeControl = {
    closest(selector) {
      if (selector === closeSelector) {
        return this;
      }
      return selector === dialogSelector ? dialog : null;
    },
  };

  const root = {
    addEventListener(type, listener) {
      rootListeners[type] = listener;
    },
    getElementById(id) {
      return id === "profile-image-lightbox" ? dialog : null;
    },
  };

  attachAvatarLightboxListener(root);

  return {
    click(target) {
      rootListeners.click({ target });
    },
    closeControl,
    dialog,
    trigger,
    wasTriggerFocused() {
      return triggerFocused;
    },
  };
}

describe("avatar lightbox behavior", () => {
  test("opens, closes, and restores focus to the avatar", () => {
    const harness = createHarness();

    harness.click(harness.trigger);
    expect(harness.dialog.open).toBe(true);

    harness.click(harness.closeControl);
    expect(harness.dialog.open).toBe(false);
    expect(harness.wasTriggerFocused()).toBe(true);
  });

  test("closes when the backdrop is clicked", () => {
    const harness = createHarness();

    harness.click(harness.trigger);
    harness.click(harness.dialog);

    expect(harness.dialog.open).toBe(false);
  });
});
