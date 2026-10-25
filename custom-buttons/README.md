# 自定义按钮

让管理员向服务器页面添加自己的链接按钮与侧边栏项目。

- **按钮**显示在控制台电源按钮旁边。
- **侧边栏项目**显示在服务器导航中。
- 每个项目都有名称、网址、图标、配色、位置和「在新标签页打开」选项，编辑时可实时预览。
- 项目可通过列表中的上下箭头调整顺序，也可以临时停用而无需删除。
- 项目可限定为某个 Egg、具有某特性或标签的 Egg，或某一台服务器。

## 安装

从最新版本中下载 [custom-buttons.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/custom-buttons.zip)，
然后在面板所在主机上执行：

```sh
php artisan p:extension:install /path/to/custom-buttons.zip --enable
```

重新加载面板，随后可在「管理 > 自定义按钮」中管理这些项目。

## 网址占位符

以下内容会在链接显示前替换为服务器对应的值（经过 URL 编码）。网址输入框为每个占位符提供了一个按钮，
点击即可插入到光标所在位置：

| 占位符 | 取值 |
| --- | --- |
| `{{env.P_SERVER_UUID}}` | 服务器 UUID |
| `{{env.P_SERVER_UUID_SHORT}}` | 服务器短标识 |
| `{{env.P_SERVER_NAME}}` | 服务器名称 |
| `{{env.P_SERVER_ID}}` | 服务器内部 ID |
| `{{env.P_SERVER_ALLOCATION_IP}}` | 主分配 IP |
| `{{env.P_SERVER_ALLOCATION_PORT}}` | 主分配端口 |
| `{{env.P_SERVER_NODE}}` | 节点名称 |
| `{{env.P_SERVER_OWNER}}` | 所有者用户名 |

## 说明

- 只接受 `http://`、`https://` 以及相对路径（`/path`）形式的网址。
- 图标使用 [lucide](https://lucide.dev/icons) 的图标名，例如 `life-buoy`。
- 只有根管理员可以管理项目；任何有权访问某台服务器的用户都能看到适用于该服务器的项目。

## 致谢

基于 Olivier D. 与 NerdsCorp 为 Pelican Panel 编写的 Custom Buttons 插件思路，为 Pterodactyl 面板重写。
