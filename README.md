# dsh-folder

DeepSeek Harness（DSH）工作区插件：在侧边栏工作区「三个点」菜单中，于 **重命名** 与 **删除工作区** 之间插入 **打开文件夹** 操作。

## 功能

- 在工作区行更多操作菜单中新增「打开文件夹」
- 菜单位置固定在「重命名」和「删除工作区」之间，复用原生菜单项的样式与图标，对齐一致
- 点击后调用 DSH Host 能力 `session.openWorkspacePath`，在系统文件管理器中打开该工作区目录
- 支持中文 / English 界面
- 打开失败时在菜单项上给出可见提示（并写入 `console.error`），不会静默无响应

## 安装

### 方式一：DSH 官方命令

```sh
dsh plugin --profile web add github:KDronin/dsh-folder
```

然后重启 `dsh web` 并刷新页面。

### 方式二：手动安装

把 `dsh-folder` 复制到 DSH profile 的 `node_modules`：

```powershell
$target = Join-Path $env:USERPROFILE '.dsh\profiles\node_modules\dsh-folder'
Copy-Item -Recurse .\dsh-folder $target
```

在 `$HOME/.dsh/profiles/web/cordis.patch.yml` 添加：

```yaml
- insert:
    - id: dsh-folder
      name: 'dsh-folder'
```

重启 `dsh web` 并刷新页面。

## 更新记录

### 0.2.0 — 修复「点击打开文件夹没有反应 / 部分或全部工作区失效」

三个独立缺陷共同造成了原来的症状：

1. **调用了不存在的客户端 API（全部工作区失效）**
   旧代码点击后执行 `ctx.workspaces.openPath(workspace.path)`。DSH 的 Workspace 客户端服务
   （`IWorkspaces`）只提供 `list` / `create` / `rename` / `delete` / `insertBefore` /
   `archiveSession` / `insertSessionBefore`，**没有 `openPath`**。因此调用处同步抛出
   `TypeError: ctx.workspaces.openPath is not a function`，`.catch()` 根本来不及接管，
   点击表现为完全没反应。
   现在改为调用真正的 Host 能力 `ctx.remote.session.openWorkspacePath({ path })`
   （打开目录由 Host 端 `dsh-native-command` 交给系统默认程序处理），并检查
   `RemoteResult` 的 `ok` 分支。

2. **菜单项注入与 React 提交时机竞争（部分工作区失效）**
   旧代码在捕获到点击后用固定的 `setTimeout(..., 0)` 去查找刚弹出的菜单。工作区菜单是
   React 门户（portal）节点，挂载与定位发生在本帧之后的提交阶段，固定延时并不保证菜单
   已经存在——找不到就直接 `return`，于是某些行「有菜单项、某些行没有」。
   现在改为由 `MutationObserver` 驱动注入：菜单一挂载就插入菜单项，并且只要菜单还在，
   就持续守住这一项（React 重渲染丢弃非 React 节点后会自动补回）；同时保留有上限的轮询
   作为兜底，确保观察者不会比菜单活得更久。

3. **解析失败与打开失败无反馈（看起来像没反应）**
   现在「找不到工作区」「当前环境无法打开文件夹」「打开文件夹失败」都会写回菜单项文案
   （失败态复用原生危险色）并记录原因。按标题匹配之外增加了一层**受保护**的位置回退：
   仅当渲染出的工作区行数与注册表条目数一致时才按行序回退，避免侧边栏过滤时把某行映射
   到错误的目录。

另外修正了 `dsh.client.inject`：原声明里的 `@deepseek-ai/dsh-client-runtime` 并非当前
DSH 版本的客户端包（安装目录下并不存在该包），现改为实际依赖
`@deepseek-ai/dsh-client-locale` / `@deepseek-ai/dsh-api-workspace-controller` /
`@deepseek-ai/dsh-client-ui-workspace`。

## 开发

- `lib/index.js` — Host 侧空实现（本插件是纯 UI 插件，打开目录走 Host 既有能力）
- `lib/client.js` — 浏览器侧插件，向工作区行菜单注入菜单项
- `test/harness.mjs` — 行为验证（jsdom 驱动真实客户端 bundle）

```sh
npm install
npm test
```

`test/harness.mjs` 覆盖：注入位置、Host 能力调用与路径、菜单延迟挂载、React 重渲染后
补回、多行互不串位、重命名后的回退、会话菜单不注入、英文界面、失败反馈、缺少能力时的
提示、卸载清理、菜单长时间停留仍持续守护等 15 项断言。

需要对照旧版本时，可用 `DSH_FOLDER_CLIENT` 指定别的 bundle：

```sh
git show HEAD:lib/client.js > /tmp/old-client.js
DSH_FOLDER_CLIENT=/tmp/old-client.js npm test
```

## License

MIT
