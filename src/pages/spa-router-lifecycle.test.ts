import { describe, expect, test } from "bun:test";
import { attachAvatarLightboxListener } from "../public/avatar-lightbox.js";
import {
  blogPostApiPath,
  collectionPath,
  getCollectionPage,
  isCollectionPage,
  pageCacheKey,
} from "../public/navigation-state.js";
import {
  canFinishMobilePageSwipe,
  canStartMobilePageSwipe,
  createMobilePageSwipeRecognizer,
  getMobilePageBoundaryCues,
} from "../public/mobile-page-navigation.js";

const routerSource = await Bun.file(
  import.meta.dir + "/../public/spa-router.js"
).text();
const runtimeStart = routerSource.indexOf(
  "const MOBILE_SWIPE_INTERACTIVE_SELECTOR"
);
const bootstrapStart = routerSource.indexOf("\nif (document.readyState");

if (runtimeStart === -1 || bootstrapStart === -1) {
  throw new Error("Could not locate the SPA router class boundary");
}

const routerClassSource = routerSource.slice(runtimeStart, bootstrapStart);

class FakeClassList {
  values = new Set<string>();

  constructor(
    initial: string[] = [],
    private readonly onAdd: (token: string) => void = () => {}
  ) {
    initial.forEach((token) => this.values.add(token));
  }

  add(...tokens: string[]) {
    for (const token of tokens) {
      this.values.add(token);
      this.onAdd(token);
    }
  }

  remove(...tokens: string[]) {
    tokens.forEach((token) => this.values.delete(token));
  }

  contains(token: string) {
    return this.values.has(token);
  }

  toggle(token: string, force?: boolean) {
    const enabled = force ?? !this.values.has(token);
    if (enabled) this.add(token);
    else this.remove(token);
    return enabled;
  }
}

type Listener = (event: any) => void;

class FakeElement {
  classList: FakeClassList;
  dataset: Record<string, string> = {};
  disabled = false;
  href = "";
  id = "";
  innerHTML = "";
  media = "";
  open = false;
  rel = "";
  removed = false;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  textContent = "";
  tagName = "DIV";
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();

  constructor(
    id = "",
    initialClasses: string[] = [],
    onClassAdd: (token: string) => void = () => {}
  ) {
    this.id = id;
    this.classList = new FakeClassList(initialClasses, onClassAdd);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (candidate) => candidate !== listener
      )
    );
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, target: this, ...event });
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === "id") this.id = "";
  }

  getAttribute(name: string) {
    if (name === "id") return this.id || null;
    return this.attributes.get(name) ?? null;
  }

  remove() {
    this.removed = true;
  }

  closest(_selector: string): FakeElement | null {
    return null;
  }

  matches(_selector: string) {
    return false;
  }

  focus() {}

  querySelector(_selector: string): FakeElement | null {
    return null;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatch("close");
  }
}

interface HarnessOptions {
  fetchFails?: boolean;
  reducedMotion?: boolean;
  styleFails?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const mutationObservers: Array<{ callback: Listener }> = [];
  const rafCallbacks: Array<() => void> = [];
  const links: FakeElement[] = [];

  const stylePath = (link: FakeElement) =>
    new URL(link.href, "https://portfolio.test").pathname;
  const isApplicableStyle = (link: FakeElement) =>
    !link.removed &&
    !link.disabled &&
    (link.media === "" || link.media === "all" || link.media === "screen");
  const activeStyles = () => links.filter(isApplicableStyle).map(stylePath);

  const pageElements: FakeElement[] = [];
  const createPage = (id: string, active = false) => {
    const page = new FakeElement(
      id,
      active ? ["page-container", "active"] : ["page-container"],
      (token) => {
        if (token.startsWith("mobile-page-")) {
          events.push(`${token}:${activeStyles().join(",")}`);
          queueMicrotask(() =>
            page.dispatch("animationend", { animationName: token })
          );
        } else if (token === "active") {
          events.push(`active:${id}:${activeStyles().join(",")}`);
        }
      }
    );
    pageElements.push(page);
    return page;
  };

  const homePage = createPage("home-page", true);
  const aboutPage = createPage("about-page");
  const content = new FakeElement("app-content");
  content.scrollTop = 0;
  content.scrollHeight = 300;
  content.clientHeight = 400;
  const mobileNav = new FakeElement("mobile-nav");
  const nextCue = new FakeElement("mobile-page-cue-next");

  const currentStyle = new FakeElement("page-css");
  currentStyle.rel = "stylesheet";
  currentStyle.href = "https://portfolio.test/pages/home/styles.css";
  links.push(currentStyle);

  let openDialog: FakeElement | null = null;
  const elements = new Map<string, FakeElement>([
    [homePage.id, homePage],
    [aboutPage.id, aboutPage],
    [content.id, content],
    [mobileNav.id, mobileNav],
    [nextCue.id, nextCue],
  ]);

  const addListener = (
    listenersByType: Map<string, Listener[]>,
    type: string,
    listener: Listener
  ) => {
    const listeners = listenersByType.get(type) ?? [];
    listeners.push(listener);
    listenersByType.set(type, listeners);
  };

  const fakeDocument: any = {
    title: "Home",
    body: new FakeElement("body"),
    documentElement: { dataset: {} },
    head: {
      appendChild(link: FakeElement) {
        links.push(link);
        events.push(
          `append:${stylePath(link)}:${isApplicableStyle(link) ? "active" : "inert"}`
        );
        queueMicrotask(() =>
          link.dispatch(options.styleFails ? "error" : "load")
        );
        return link;
      },
    },
    addEventListener(type: string, listener: Listener) {
      addListener(documentListeners, type, listener);
    },
    dispatch(type: string, event: Record<string, unknown>) {
      for (const listener of [...(documentListeners.get(type) ?? [])]) {
        listener({ type, ...event });
      }
    },
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
    getElementById(id: string) {
      if (id === "page-css") {
        return links.find((link) => !link.removed && link.id === id) ?? null;
      }
      return elements.get(id) ?? null;
    },
    querySelector(selector: string) {
      if (selector === ".page-container.active") {
        return (
          pageElements.find((page) => page.classList.contains("active")) ?? null
        );
      }
      if (selector === "dialog[open]") {
        return openDialog?.open ? openDialog : null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === ".page-container") return pageElements;
      if (selector === ".nav-link") return [];
      return [];
    },
  };

  const location = {
    origin: "https://portfolio.test",
    pathname: "/",
    search: "",
  };
  const historyCalls: string[] = [];
  const history = {
    state: { page: "home", pageNumber: 1 },
    pushState(state: any, _unused: string, path: string) {
      history.state = state;
      historyCalls.push(path);
      events.push(`history:${path}`);
      const url = new URL(path, location.origin);
      location.pathname = url.pathname;
      location.search = url.search;
    },
    replaceState(state: any, _unused: string, path: string) {
      history.state = state;
      const url = new URL(path, location.origin);
      location.pathname = url.pathname;
      location.search = url.search;
    },
  };
  const fakeWindow: any = {
    history,
    innerWidth: 390,
    location,
    matchMedia() {
      return { matches: Boolean(options.reducedMotion) };
    },
    addEventListener(type: string, listener: Listener) {
      addListener(windowListeners, type, listener);
    },
  };

  class FakeMutationObserver {
    callback: Listener;

    constructor(callback: Listener) {
      this.callback = callback;
    }

    observe() {
      mutationObservers.push(this);
    }

    disconnect() {}
  }

  const requestAnimationFrame = (callback: () => void) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  const flushUi = async () => {
    await Promise.resolve();
    while (rafCallbacks.length > 0) {
      rafCallbacks.shift()?.();
      await Promise.resolve();
    }
  };
  const notifyDialogMutation = (dialog: FakeElement) => {
    for (const observer of mutationObservers) {
      observer.callback([
        { type: "attributes", attributeName: "open", target: dialog },
      ]);
    }
  };

  const silentConsole = { ...console, error() {} };
  const factory = new Function(
    "window",
    "document",
    "fetch",
    "requestAnimationFrame",
    "performance",
    "Element",
    "MutationObserver",
    "console",
    "blogPostApiPath",
    "collectionPath",
    "getCollectionPage",
    "isCollectionPage",
    "pageCacheKey",
    "canFinishMobilePageSwipe",
    "canStartMobilePageSwipe",
    "createMobilePageSwipeRecognizer",
    "getMobilePageBoundaryCues",
    `"use strict"; ${routerClassSource}; return SPARouter;`
  );
  const Router = factory(
    fakeWindow,
    fakeDocument,
    async () => {
      if (options.fetchFails) {
        return { ok: false, statusText: "Offline" };
      }
      return {
        ok: true,
        async json() {
          return {
            content: "<h1>About</h1>",
            pageCSS: "/pages/about/styles.css",
            title: "About",
          };
        },
      };
    },
    requestAnimationFrame,
    { now: () => 1000 },
    FakeElement,
    FakeMutationObserver,
    silentConsole,
    blogPostApiPath,
    collectionPath,
    getCollectionPage,
    isCollectionPage,
    pageCacheKey,
    canFinishMobilePageSwipe,
    canStartMobilePageSwipe,
    createMobilePageSwipeRecognizer,
    getMobilePageBoundaryCues
  );
  const router: any = Object.create(Router.prototype);
  router.isNavigating = false;
  router.pagesData = {};
  router.mobileBreakpoint = 481;
  router.previewRoute = null;

  const registerDialog = () => {
    const dialog = new FakeElement("profile-image-lightbox");
    dialog.tagName = "DIALOG";
    dialog.matches = (selector: string) =>
      selector === "[data-avatar-lightbox]";
    dialog.showModal = () => {
      dialog.open = true;
      openDialog = dialog;
      notifyDialogMutation(dialog);
    };
    dialog.close = () => {
      dialog.open = false;
      notifyDialogMutation(dialog);
      dialog.dispatch("close");
    };
    elements.set(dialog.id, dialog);

    const trigger = new FakeElement("avatar-trigger");
    trigger.closest = (selector: string) =>
      selector === "[data-avatar-lightbox-trigger]" ? trigger : null;
    trigger.getAttribute = (name: string) =>
      name === "aria-controls" ? dialog.id : null;
    const close = new FakeElement("avatar-close");
    close.closest = (selector: string) => {
      if (selector === "[data-avatar-lightbox-close]") return close;
      if (selector === "[data-avatar-lightbox]") return dialog;
      return null;
    };
    return { close, dialog, trigger };
  };

  return {
    aboutPage,
    activeStyles,
    content,
    currentStyle,
    events,
    fakeDocument,
    flushUi,
    history,
    historyCalls,
    homePage,
    links,
    nextCue,
    registerDialog,
    router,
  };
}

describe("mobile SPA navigation lifecycle", () => {
  test("a failed page request keeps the visible page and history together", async () => {
    const harness = createHarness({ fetchFails: true });

    await harness.router.navigate("about", "/about", "next");

    expect(harness.historyCalls).toEqual([]);
    expect(harness.history.state).toEqual({ page: "home", pageNumber: 1 });
    expect(harness.homePage.classList.contains("active")).toBe(true);
    expect(harness.aboutPage.classList.contains("active")).toBe(false);
  });

  test("a failed stylesheet leaves the current stylesheet as the only link", async () => {
    const harness = createHarness({ styleFails: true });

    await harness.router.navigate("about", "/about", "next");

    expect(harness.historyCalls).toEqual([]);
    expect(
      harness.links
        .filter((link) => !link.removed)
        .map((link) => new URL(link.href, "https://portfolio.test").pathname)
    ).toEqual(["/pages/home/styles.css"]);
    expect(harness.currentStyle.id).toBe("page-css");
  });

  test("keeps destination CSS inert until exit finishes, then cleans transition state", async () => {
    const harness = createHarness();

    await harness.router.navigate("about", "/about", "next");

    expect(harness.events).toContain("append:/pages/about/styles.css:inert");
    expect(harness.events).toContain(
      "mobile-page-exit-next:/pages/home/styles.css"
    );
    expect(harness.events).toContain(
      "mobile-page-enter-next:/pages/about/styles.css"
    );
    expect(harness.activeStyles()).toEqual(["/pages/about/styles.css"]);
    expect(harness.historyCalls).toEqual(["/about"]);
    expect(harness.events.indexOf("history:/about")).toBeGreaterThan(
      harness.events.findIndex((event) =>
        event.startsWith("active:about-page:")
      )
    );
    expect(
      [
        ...harness.homePage.classList.values,
        ...harness.aboutPage.classList.values,
      ].filter((token) => token.startsWith("mobile-page-"))
    ).toEqual([]);
  });

  test("opening and closing the avatar dialog updates an existing edge cue", async () => {
    const harness = createHarness();
    const avatar = harness.registerDialog();
    harness.router.attachMobilePageSwipeNavigation();
    attachAvatarLightboxListener(harness.fakeDocument);
    harness.router.refreshMobilePageCues();
    expect(harness.nextCue.classList.contains("visible")).toBe(true);
    expect(harness.nextCue.textContent).toBe("Swipe up");
    expect(harness.nextCue.dataset.destination).toBe("About");

    harness.fakeDocument.dispatch("click", { target: avatar.trigger });
    await harness.flushUi();
    expect(harness.nextCue.classList.contains("visible")).toBe(false);

    harness.fakeDocument.dispatch("click", { target: avatar.close });
    await harness.flushUi();
    expect(harness.nextCue.classList.contains("visible")).toBe(true);
  });

  test.each([
    ["reduced motion", true, "next"],
    ["menu navigation", false, null],
  ])(
    "%s does not add directional animation classes",
    async (_name, reducedMotion, direction) => {
      const harness = createHarness({ reducedMotion });

      await harness.router.navigate("about", "/about", direction);

      expect(
        harness.events.filter((event) => event.startsWith("mobile-page-"))
      ).toEqual([]);
    }
  );
});
