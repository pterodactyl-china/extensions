# 短链接跳转

由面板提供的短链接服务。创建一个名称和目标地址，例如 `discord` 指向某个邀请链接，
那么 `https://your-panel.example/go/discord` 就会跳转到该地址。

## 安装

从最新版本中下载 [redirect.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/redirect.zip)，
然后在面板所在主机上执行：

```sh
php artisan p:extension:install /path/to/redirect.zip --enable
```

重新加载面板，随后可在「管理 > 短链接跳转」中管理链接。列表会显示每个链接、一个复制按钮、
它的目标地址，以及使用次数和最近使用时间。链接可在列表中直接开关而无需删除，
还有筛选框可按名称或目标地址缩小列表范围。

## 说明

- 链接位于 `/go/` 之下。若已有其他扩展占用了该前缀，面板会拒绝启用本扩展。
- 名称长度为 1-64 个字符：仅可使用小写字母、数字、`-` 和 `_`。
- 目标地址必须是完整的 `http://` 或 `https://` 网址。
- 跳转默认为临时（302）；也可为每个链接选择永久（301）。
  浏览器会缓存永久跳转，之后的修改可能对其不生效。
- 只有根管理员可以管理链接。
