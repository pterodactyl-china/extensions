# 公告

全站公告横幅。管理员撰写公告，用户会看到彩色的横幅提示，并可以关闭它们。

- 标题、正文、类型（信息、成功、警告、危险），以及可选的链接和图标。
- 可选的开始与结束时间。
- 可显示在服务器列表、服务器控制台、管理概览，或所有位置。
- 可选的按用户关闭。
- 可将公告通过邮件发送给所有用户。

## 安装

从最新版本中下载 [announcements.zip](https://github.com/pterodactyl-china/extensions/releases/latest/download/announcements.zip)，
然后在面板所在主机上执行：

```sh
php artisan p:extension:install /path/to/announcements.zip --enable
```

重新加载面板，随后可在「管理 > 公告」中管理公告。

## 说明

- 只有根管理员可以管理公告。
- 邮件通过队列发送，因此需要运行队列处理器（queue worker）才能真正发出。

## 致谢

基于 Boy132 为 Pelican Panel 编写的 Announcements 插件思路，为 Pterodactyl 面板重写。
