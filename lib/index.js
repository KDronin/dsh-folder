/**
 * Host half of the dsh-folder client plugin.
 *
 * This plugin is pure UI: the browser half injects one entry into the sidebar
 * workspace row menu, and the click is served by the Host capability the
 * assembly already provides (`session.openWorkspacePath` — see
 * `@deepseek-ai/dsh-api-session-controller`). The host half exists so the
 * Loader can mount the entry and the client bundle can be composed for the web
 * profile.
 *
 * @returns nothing; there is no host-side state to install.
 */
export function apply() {}
