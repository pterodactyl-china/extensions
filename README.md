# Pterodactyl 扩展

适用于 Pterodactyl 面板（v2）的扩展。每个文件夹即一个扩展。

| 扩展                         | 功能                                                       | 下载                                                                                                              |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [公告](announcements)        | 全站公告横幅，用户可自行关闭。                             | [announcements.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/announcements.zip)   |
| [备案信息](beian)            | 在页面底部显示 ICP 备案号、公安备案号与 ICP 许可证。       | [beian.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/beian.zip)                   |
| [自定义按钮](custom-buttons) | 由管理员定义的链接按钮与服务器页面侧边栏项目。             | [custom-buttons.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/custom-buttons.zip) |
| [深色主题](dark-theme)       | 一款更深沉、中性的深色主题，同时可作为编写自有主题的模板。 | [dark-theme.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/dark-theme.zip)         |
| [短链接跳转](redirect)       | 由面板提供的短链接，例如 `/go/discord`。                   | [redirect.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/redirect.zip)             |

## 安装扩展

从[最新版本](https://github.com/pterodactyl-china/extensions/releases/latest)下载对应的 zip 包，然后在面板所在主机上执行：

```sh
php artisan p:extension:install /path/to/dark-theme.zip --enable
```

之后重新加载面板。扩展可以在「管理 > 扩展」中停用或移除。

## 开发

扩展基于面板的 SDK 构建，该 SDK 尚未发布到 npm。请把面板克隆到本仓库根目录下的 `.panel`
（该目录已被 git 忽略）：

```sh
git clone --branch 2.0-develop https://github.com/pterodactyl/panel .panel
```

然后在扩展的目录中执行：

```sh
npm ci
npm run build
npm run typecheck
```

`node scripts/check.mjs <文件夹>` 会执行与 CI 相同的包检查。

## 新增扩展

1. 以扩展的 `id` 为名创建文件夹，并放入 `extension.json`、`package.json` 和一个 `README.md`。
2. 通过 `"@pterodactyl/sdk": "file:../.panel/packages/sdk"` 依赖 SDK。
3. 如果使用 Tailwind，请为它指定自己的短前缀：在 `extension.json` 中设置 `ui.prefix`
   （2-12 个小写字母，各扩展之间不可重复），并用 `prefix(<前缀>)` 构建样式表，
   使类名形如 `<前缀>:flex`。面板会拒绝使用未声明前缀的样式。
4. 在上表中新增一行，链接到 `releases/latest/download/<id>.zip`。

CI 会对每个包含 `extension.json` 的文件夹执行构建、类型检查和打包。

## 发布

先提升扩展 `extension.json` 和 `package.json` 中的 `version`，然后推送标签：

```sh
git tag v1.0.0
git push origin v1.0.0
```

发布内容为每个扩展各一个 `<id>.zip`。
