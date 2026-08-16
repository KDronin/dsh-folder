window.__ModuleLoader__.load({
  id: "dsh-folder",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const NS = "folder";
    const zh = {
      openFolder: "打开文件夹",
      rename: "重命名",
      deleteWorkspace: "删除工作区",
    };
    const en = {
      openFolder: "Open folder",
      rename: "Rename",
      deleteWorkspace: "Delete workspace",
    };

    // Same geometry as @deepseek-ai/dsh-client-ui-primitives IconFolderOpenOutline16.
    const FOLDER_SVG =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z" fill="currentColor"/>' +
      '</svg>';

    function isWorkspaceActionsLabel(label) {
      return /^工作区“.+”的操作$/.test(label) || /^Workspace actions for .+$/.test(label);
    }

    function extractTitleFromLabel(label) {
      const zhMatch = label.match(/^工作区“(.+)”的操作$/);
      if (zhMatch) return zhMatch[1].trim();
      const enMatch = label.match(/^Workspace actions for (.+)$/);
      if (enMatch) return enMatch[1].trim();
      return "";
    }

    function rowTitle(row) {
      if (!row) return "";
      // ProjectRowItem children: [folder slot, chevron slot, projectText, actions]
      const projectText = row.children && row.children[2];
      const text = projectText ? projectText.textContent : row.textContent;
      return (text || "").trim();
    }

    function workspaceRows() {
      return Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded]'))
        .filter((row) => {
          const button = row.querySelector('button[aria-label]');
          return button && isWorkspaceActionsLabel(button.getAttribute("aria-label") || "");
        });
    }

    function findWorkspace(ctx, title, row) {
      const state = ctx.workspaces.list.getSnapshot();
      const items = state && Array.isArray(state.items) ? state.items : [];
      if (title) {
        const byTitle = items.find((w) => w.title === title);
        if (byTitle) return byTitle;
      }
      if (row) {
        const rows = workspaceRows();
        const index = rows.indexOf(row);
        if (index >= 0 && index < items.length) return items[index];
      }
      return null;
    }

    function findMenuItem(text) {
      if (!text) return null;
      return Array.from(document.querySelectorAll('button[role="menuitem"]'))
        .find((button) => (button.textContent || "").includes(text)) || null;
    }

    function injectOpenFolder(ctx, t, workspace) {
      const deleteItem = findMenuItem(t("deleteWorkspace")) || findMenuItem(zh.deleteWorkspace) || findMenuItem(en.deleteWorkspace);
      if (!deleteItem) return;
      const renameItem = findMenuItem(t("rename")) || findMenuItem(zh.rename) || findMenuItem(en.rename);
      const base = renameItem || deleteItem;

      // Remove stale injected entries from a previous open.
      document.querySelectorAll('[data-dsh-folder-item]').forEach((el) => el.remove());

      const item = base.cloneNode(true);
      item.setAttribute("data-dsh-folder-item", "true");
      item.setAttribute("aria-label", t("openFolder"));

      const spans = item.querySelectorAll("span");
      if (spans.length > 0) {
        spans[spans.length - 1].textContent = t("openFolder");
      }
      const iconSpan = item.querySelector("span");
      if (iconSpan) {
        iconSpan.innerHTML = FOLDER_SVG;
      }

      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!workspace) {
          console.warn("[dsh-folder] cannot open folder: workspace not resolved");
          return;
        }
        ctx.workspaces.openPath(workspace.path).catch((error) => {
          console.error("[dsh-folder] failed to open folder", error);
        });
        // The injected item is outside React's menu state, so ask the Menu to close.
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });

      deleteItem.parentNode.insertBefore(item, deleteItem);
    }

    const inject = ["workspaces", "locale"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-folder: dictionaries");
      const t = ctx.locale.bind(NS);
      let pendingWorkspace = null;

      const onDocumentClick = (event) => {
        const target = event.target;
        const button = target && target.closest ? target.closest('button[aria-label]') : null;
        if (!button) return;
        const label = button.getAttribute("aria-label") || "";
        if (!isWorkspaceActionsLabel(label)) return;
        const row = button.closest('[role="treeitem"]');
        const title = extractTitleFromLabel(label) || rowTitle(row);
        pendingWorkspace = findWorkspace(ctx, title, row);
        setTimeout(() => injectOpenFolder(ctx, t, pendingWorkspace), 0);
      };

      ctx.effect(() => {
        document.addEventListener("click", onDocumentClick, true);
        return () => document.removeEventListener("click", onDocumentClick, true);
      }, "dsh-folder: workspace menu injection");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
