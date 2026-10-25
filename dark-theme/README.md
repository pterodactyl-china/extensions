# 深色主题

一款为 Pterodactyl 面板打造的更深沉、中性的深色主题。它会重新定义仪表盘、服务器页面、
管理区域和登录页面的样式，包括控制台、文字选中和滚动条。

它完全通过覆盖面板的设计令牌来工作，因此即使面板自身的组件发生变化也能继续生效。

## 安装

从最新版本中下载 [dark-theme.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/dark-theme.zip)，
然后在面板所在主机上执行：

```sh
php artisan p:extension:install /path/to/dark-theme.zip --enable
```

重新加载面板即可。停用该扩展即可恢复面板原本的外观。

## 设置

管理 > 扩展 > 深色主题。

| 设置项 | 默认值 | 说明                                                                                             |
| ------ | ------ | ------------------------------------------------------------------------------------------------ |
| 强调色 | 靛蓝   | 用于按钮、链接和焦点框的颜色。可任选颜色，主题会自动调整其亮度以保证文字可读。清空即可恢复默认。 |

## 制作你自己的主题

整个主题只有一个文件：[`src/client/theme.css`](src/client/theme.css)，
其中只包含分组并带有注释的 CSS 自定义属性。

1. 复制本扩展，并修改 `extension.json` 中的 `id` 和 `name`。
2. 修改 `src/client/theme.css` 中的取值。
3. 运行 `npm run contrast` 检查文字颜色在其背景下的可读性（WCAG AA）。
4. 用 `npm ci && npm run build` 构建（SDK 的搭建方式见仓库根目录的 README），
   再用 `php artisan p:extension:install` 安装该目录。

请按文件头部注释所说，把规则保持在 `:root.dark` 之下且不放进任何 `@layer`；
否则面板自带的值会覆盖它们。

完整的令牌列表见面板的 `docs/theming/tokens.md`。

## 局限

- 硬刷新时，主题加载完成前会短暂显示面板默认的配色。
- 网站图标、阴影和滚动条宽度不受令牌控制。
