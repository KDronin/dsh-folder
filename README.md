# dsh-folder

DeepSeek Harness（DSH）工作区插件：在侧边栏工作区「三个点」菜单中，于 **重命名** 与 **删除工作区** 之间插入 **打开文件夹** 操作。

## 功能

- 在工作区行更多操作菜单中新增「打开文件夹」
- 菜单位置固定在「重命名」和「删除工作区」之间，克隆原菜单项保证对齐一致
- 点击后调用 DSH Host 的 `workspaces.openPath` 打开该工作区对应目录
- 支持中文 / English 界面

## 安装

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

## 开发

- `lib/index.js` — Host 侧空实现（纯 UI 插件）
- `lib/client.js` — 浏览器侧插件，通过 DOM 注入菜单项

## License

MIT
