/**
 * dsh-folder — browser half of the plugin.
 *
 * Adds "打开文件夹 / Open folder" to the sidebar workspace row menu, between
 * "重命名 / Rename" and "删除工作区 / Delete workspace".
 *
 * Three facts shape this file:
 *
 * 1. Opening a folder is a Host capability. The client face is
 *    `ctx.remote.session.openWorkspacePath({ path })`, which asks the desktop
 *    opener and answers with a `RemoteResult`. There is no
 *    `ctx.workspaces.openPath`: the Workspace client service only owns the
 *    registry (create / rename / delete / reorder / archive), so calling it
 *    throws on every click.
 * 2. DSH exposes no slot for workspace row menu entries, so the row is injected
 *    into the open menu's portaled DOM. React owns that subtree and may drop a
 *    child it never created, so the entry is re-asserted for as long as the menu
 *    lives.
 * 3. The menu mounts, renders and is positioned by React after the click that
 *    opened it. A fixed delay (or a single `setTimeout(0)`) races that commit,
 *    which is why the entry used to appear for some rows and not others. The
 *    watcher below reacts to the DOM instead of guessing a delay.
 *
 * The row menu carries a per-row label ("工作区“<title>”的操作" / "Workspace
 * actions for <title>"), which is how the clicked row is matched back to the
 * Workspace registry entry that holds `path`.
 */

window.__ModuleLoader__.load({
  id: "dsh-folder",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    /* ------------------------------------------------------------- locale --- */

    /** Dictionary namespace owned by this plugin. */
    const NS = "folder";
    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      openFolder: "打开文件夹",
      rename: "重命名",
      deleteWorkspace: "删除工作区",
      openFailed: "打开文件夹失败",
      workspaceUnknown: "未找到对应的工作区",
      openerUnavailable: "当前环境无法打开文件夹",
    };
    /** English dictionary, checked complete against the zh key set. */
    const en = {
      openFolder: "Open folder",
      rename: "Rename",
      deleteWorkspace: "Delete workspace",
      openFailed: "Couldn’t open folder",
      workspaceUnknown: "Workspace not found",
      openerUnavailable: "Opening folders is unavailable here",
    };

    /** Menu icon geometry, identical to primitives IconFolderOpenOutline16. */
    const FOLDER_SVG =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z" fill="currentColor"/>' +
      "</svg>";

    /* ---------------------------------------------------------- selectors --- */

    /** Marker on the injected row, and the idempotence key for re-assertion. */
    const ITEM_ATTR = "data-dsh-folder-item";
    /** The menu primitive portals one `role="menu"` list per open menu. */
    const MENU_SELECTOR = '[role="menu"]';
    /** One actionable menu row. */
    const MENU_ROW_SELECTOR = 'button[role="menuitem"]';
    /** Sidebar rows carrying a labelled actions button. */
    const ACTIONS_BUTTON_SELECTOR = "button[aria-label]";
    /** Workspace rows are the tree items that expand. */
    const TREE_ROW_SELECTOR = '[role="treeitem"][aria-expanded]';
    /** How long the observer-less poll fallback keeps retrying after a click. */
    const WATCH_TIMEOUT_MS = 4000;

    /* --------------------------------------------------------- DOM helpers -- */

    /**
     * Split an element's class attribute into tokens.
     * @param el - element to read, or null.
     * @returns class tokens, never null.
     */
    function classTokens(el) {
      if (el === null || el === undefined) return [];
      const raw = el.getAttribute("class");
      if (typeof raw !== "string" || raw === "") return [];
      return raw.split(/\s+/).filter((token) => token !== "");
    }

    /**
     * Whether one class token carries a semantic name. The bundler emits
     * `<hash>_<name>_<scope>_<index>` tokens, so the name survives minification.
     * @param el - element to inspect.
     * @param name - semantic name, e.g. `itemLabel`.
     * @returns true when some token contains the name.
     */
    function hasClassNamed(el, name) {
      return classTokens(el).some((token) => token.includes(name));
    }

    /**
     * Whether an actions button label belongs to a workspace row. Both the
     * Chinese and the English template are matched, whatever the UI language is,
     * so the plugin keeps working across a language switch.
     * @param label - the button's aria-label.
     * @returns true for a workspace row actions button.
     */
    function isWorkspaceActionsLabel(label) {
      return /^工作区“.+”的操作$/.test(label) || /^Workspace actions for .+$/.test(label);
    }

    /**
     * Read the workspace title out of a row actions label.
     * @param label - the button's aria-label.
     * @returns the title, or an empty string when the label is not one of ours.
     */
    function titleFromActionsLabel(label) {
      const zhMatch = /^工作区“(.+)”的操作$/.exec(label);
      if (zhMatch !== null) return zhMatch[1].trim();
      const enMatch = /^Workspace actions for (.+)$/.exec(label);
      if (enMatch !== null) return enMatch[1].trim();
      return "";
    }

    /**
     * Fallback title source: the row's project-text slot.
     * @param row - a workspace tree item.
     * @returns the displayed title, or an empty string.
     */
    function rowTitle(row) {
      if (row === null || row === undefined) return "";
      const slot = row.children === undefined ? null : row.children[2];
      const text = slot === undefined || slot === null ? row.textContent : slot.textContent;
      return (text || "").trim();
    }

    /**
     * Workspace rows currently rendered in the sidebar, in registry order.
     * @returns workspace tree items that carry a workspace actions button.
     */
    function workspaceRows() {
      return Array.from(document.querySelectorAll(TREE_ROW_SELECTOR)).filter((row) => {
        const button = row.querySelector(ACTIONS_BUTTON_SELECTOR);
        return button !== null && isWorkspaceActionsLabel(button.getAttribute("aria-label") || "");
      });
    }

    /**
     * The label span of one menu row, found by its semantic class name first and
     * by shape second.
     * @param row - a `role="menuitem"` button.
     * @returns the span holding the label, or null.
     */
    function labelSpanOf(row) {
      const spans = Array.from(row.querySelectorAll("span"));
      const named = spans.find((span) => hasClassNamed(span, "itemLabel"));
      if (named !== undefined) return named;
      for (let index = spans.length - 1; index >= 0; index -= 1) {
        const span = spans[index];
        if (span.children.length === 0 && (span.textContent || "").trim() !== "") return span;
      }
      return null;
    }

    /**
     * Find the menu row whose label matches one of the candidates exactly.
     * @param menu - a `role="menu"` list.
     * @param candidates - accepted labels.
     * @returns the row and its label span, or null.
     */
    function findMenuRow(menu, candidates) {
      const rows = Array.from(menu.querySelectorAll(MENU_ROW_SELECTOR));
      for (const row of rows) {
        if (row.hasAttribute(ITEM_ATTR)) continue;
        const span = labelSpanOf(row);
        const text = span === null ? (row.textContent || "").trim() : (span.textContent || "").trim();
        if (candidates.includes(text)) return { row, labelSpan: span };
      }
      return null;
    }

    /**
     * Translate one key, falling back to the bundled string when the locale
     * service cannot answer. The fallbacks also carry the exact labels the
     * built-in rows are matched by, so a dictionary problem cannot silently
     * disable injection.
     * @param t - bound translate function.
     * @param key - dictionary key.
     * @param fallback - the English string for that key.
     * @returns the resolved label.
     */
    function label(t, key, fallback) {
      try {
        const value = t(key);
        if (typeof value === "string" && value !== "" && value !== key) return value;
      } catch (error) {
        /* A missing dictionary must not break the menu: fall through. */
      }
      return fallback;
    }

    /* -------------------------------------------------------- menu entries -- */

    /**
     * Build the injected row from a built-in row's styling.
     * @param t - bound translate function.
     * @param template - a built-in row to copy geometry and classes from.
     * @returns the un-inserted `role="menuitem"` button.
     */
    function buildItem(t, template) {
      const tokens = classTokens(template);
      const labelToken = tokens.find((token) => token.includes("itemLabel")) || "";
      const iconToken =
        tokens.find((token) => token.includes("itemIcon")) || labelToken.split("itemLabel").join("itemIcon");

      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute(ITEM_ATTR, "true");
      item.setAttribute("aria-label", label(t, "openFolder", en.openFolder));
      // The template is either the rename row or the delete row; a threat colour
      // belongs to the delete row's own meaning, never to this entry.
      item.className = tokens.filter((token) => !token.includes("danger")).join(" ");

      const icon = document.createElement("span");
      if (iconToken !== "") icon.className = iconToken;
      icon.innerHTML = FOLDER_SVG;

      const text = document.createElement("span");
      if (labelToken !== "") text.className = labelToken;
      text.textContent = label(t, "openFolder", en.openFolder);

      item.appendChild(icon);
      item.appendChild(text);
      return item;
    }

    /**
     * Replace an injected row's text, so a failed click answers the user instead
     * of looking like a dead menu entry.
     * @param item - the injected row.
     * @param message - text to show.
     * @param dangerClass - the built-in danger class tokens, when known.
     */
    function showItemMessage(item, message, dangerClass) {
      const text = labelSpanOf(item);
      if (text !== null) text.textContent = message;
      item.setAttribute("aria-label", message);
      if (dangerClass !== "") {
        const tokens = classTokens(item);
        for (const token of dangerClass.split(/\s+/)) {
          if (token !== "" && !tokens.includes(token)) tokens.push(token);
        }
        item.className = tokens.join(" ");
      }
    }

    /**
     * Ask the Host to open one Workspace directory on the desktop.
     * @param ctx - the plugin context.
     * @param path - the Workspace's canonical directory path.
     * @returns a promise that resolves once the opener accepted the path.
     */
    async function requestOpenPath(ctx, path) {
      const remote = ctx.remote;
      const session = remote === undefined || remote === null ? undefined : remote.session;
      const open = session === undefined || session === null ? undefined : session.openWorkspacePath;
      if (typeof open !== "function") {
        const error = new Error("session.openWorkspacePath is unavailable in this assembly");
        error.code = "dsh-folder/opener-unavailable";
        throw error;
      }
      const result = await open.call(session, { path });
      if (result === undefined || result === null || result.ok !== true) {
        const failure = result === undefined || result === null ? undefined : result.error;
        throw new Error(`path open failed: ${failure === undefined ? "unknown failure" : failure.message}`);
      }
      return result.value;
    }

    /**
     * Resolve the Workspace registry entry behind a clicked row.
     * @param ctx - the plugin context.
     * @param target - the row captured when its menu opened.
     * @returns the registry entry, or null when it cannot be resolved.
     */
    function resolveWorkspace(ctx, target) {
      if (target === null) return null;
      const service = ctx.workspaces;
      const source = service === undefined || service === null ? undefined : service.list;
      const snapshot = source === undefined || source === null ? null : source.getSnapshot();
      const items = snapshot !== null && Array.isArray(snapshot.items) ? snapshot.items : [];
      if (target.title !== "") {
        const byTitle = items.find((workspace) => workspace.title === target.title);
        if (byTitle !== undefined) return byTitle;
      }
      // Positional fallback, allowed only when the rendered rows and the registry
      // agree in count — a filtered sidebar must never map a row onto the wrong
      // directory.
      const row = target.row;
      if (row !== null && row !== undefined && row.isConnected === true) {
        const rows = workspaceRows();
        if (rows.length === items.length) {
          const index = rows.indexOf(row);
          if (index >= 0) return items[index];
        }
      }
      return null;
    }

    /**
     * Close the open menu. The injected row is not a React child, so no menu
     * callback can run for it; Escape is the dismissal the primitive listens for.
     */
    function closeMenu() {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }

    /* -------------------------------------------------------------- plugin -- */

    /** Services this plugin needs to do anything at all. */
    const inject = ["workspaces", "remote", "locale"];

    /**
     * Mount the workspace row entry.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-folder: dictionaries");
      const t = ctx.locale.bind(NS);

      /** Row captured by the most recent actions-button click. */
      let target = null;
      /** Tear-down for the running watcher; replaced on every click. */
      let stopWatching = () => {};

      /** The label candidates for the two built-in rows. */
      function anchors() {
        return {
          rename: [label(t, "rename", en.rename), zh.rename, en.rename],
          remove: [label(t, "deleteWorkspace", en.deleteWorkspace), zh.deleteWorkspace, en.deleteWorkspace],
        };
      }

      /**
       * Insert the entry into the open workspace menu.
       * @returns "injected" when the menu now carries the entry, otherwise
       *          "pending" while it is not there yet, or "closed" when no menu
       *          is open.
       */
      function syncMenu() {
        const marks = anchors();
        const menus = Array.from(document.querySelectorAll(MENU_SELECTOR));
        if (menus.length === 0) return "closed";
        for (const menu of menus) {
          if (menu.querySelector(`[${ITEM_ATTR}]`) !== null) return "injected";
          const deleteRow = findMenuRow(menu, marks.remove);
          if (deleteRow === null) continue;
          const renameRow = findMenuRow(menu, marks.rename);
          const template = renameRow === null ? deleteRow.row : renameRow.row;
          const wrapper = deleteRow.row.parentElement;
          const container = wrapper === null ? null : wrapper.parentElement;
          if (container === null) continue;

          const item = buildItem(t, template);
          // Bind the row this entry was injected for: a later click on another
          // row replaces the watcher, not the meaning of this node.
          const pending = target;
          const dangerClass = classTokens(deleteRow.row)
            .filter((token) => token.includes("danger"))
            .join(" ");
          item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const workspace = resolveWorkspace(ctx, pending);
            if (workspace === null) {
              console.warn("[dsh-folder] cannot open folder: workspace not resolved", pending);
              showItemMessage(item, label(t, "workspaceUnknown", en.workspaceUnknown), dangerClass);
              return;
            }
            requestOpenPath(ctx, workspace.path).then(
              () => closeMenu(),
              (error) => {
                console.error("[dsh-folder] open folder failed", workspace.path, error);
                const unavailable = error !== null && error !== undefined && error.code === "dsh-folder/opener-unavailable";
                showItemMessage(
                  item,
                  label(
                    t,
                    unavailable ? "openerUnavailable" : "openFailed",
                    unavailable ? en.openerUnavailable : en.openFailed,
                  ),
                  dangerClass,
                );
              },
            );
          });
          container.insertBefore(item, wrapper);
          return "injected";
        }
        return "pending";
      }

      /**
       * Follow one menu open: inject as soon as React mounts the list, then keep
       * the entry in place for as long as that menu lives.
       *
       * The mutation observer is what makes this reliable: it fires exactly when
       * React commits the portaled list — or rewrites it later — instead of
       * guessing a frame with a fixed delay. The bounded poll only covers
       * engines without an observer, and the menu's own disappearance ends the
       * watch, so nothing here outlives the menu it was started for.
       */
      function watchMenu() {
        stopWatching();
        const pollDeadline = Date.now() + WATCH_TIMEOUT_MS;
        let injected = false;
        let busy = false;
        let done = false;
        let observer = null;
        let timer = null;

        const finish = () => {
          if (done) return;
          done = true;
          if (timer !== null) clearTimeout(timer);
          if (observer !== null) observer.disconnect();
          timer = null;
          observer = null;
        };

        const sync = () => {
          if (busy || done) return;
          busy = true;
          let state = "pending";
          try {
            state = syncMenu();
            if (state === "injected") injected = true;
          } catch (error) {
            console.error("[dsh-folder] workspace menu sync failed", error);
          } finally {
            busy = false;
          }
          // A vanished menu ends the watch; a live one keeps being re-asserted.
          if (state === "closed" && injected) finish();
        };

        const poll = () => {
          timer = null;
          sync();
          if (done) return;
          if (Date.now() >= pollDeadline) return;
          timer = setTimeout(poll, 60);
        };

        if (typeof MutationObserver === "function") {
          observer = new MutationObserver(sync);
          observer.observe(document.body, { childList: true, subtree: true });
          // The menu can already be mounted only if the entry was injected by an
          // earlier open, so one pass is enough to attach to it.
          sync();
        } else {
          timer = setTimeout(poll, 0);
        }
        stopWatching = finish;
      }

      /** Capture the clicked row before React opens its menu. */
      const onDocumentClickCapture = (event) => {
        const node = event.target;
        if (node === null || node === undefined || typeof node.closest !== "function") return;
        if (node.closest(MENU_SELECTOR) !== null) return;
        const button = node.closest(ACTIONS_BUTTON_SELECTOR);
        if (button === null) return;
        const aria = button.getAttribute("aria-label") || "";
        if (!isWorkspaceActionsLabel(aria)) return;
        const row = button.closest(TREE_ROW_SELECTOR);
        target = { title: titleFromActionsLabel(aria) || rowTitle(row), row };
        watchMenu();
      };

      ctx.effect(() => {
        document.addEventListener("click", onDocumentClickCapture, true);
        return () => {
          document.removeEventListener("click", onDocumentClickCapture, true);
          stopWatching();
        };
      }, "dsh-folder: workspace row menu entry");
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.NS = NS;
    return module.exports;
  },
});
