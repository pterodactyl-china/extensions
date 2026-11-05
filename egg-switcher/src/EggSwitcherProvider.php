<?php

declare(strict_types=1);

namespace EggSwitcher;

use Pterodactyl\Extensions\ExtensionProvider;

/**
 * 预设切换：在服务器「启动」页注入一张卡片，让有权限的用户换预设（egg）。
 *
 * - 权限注册到子用户编辑器：ext.egg-switcher.view / ext.egg-switcher.switch
 * - 后台配置走专属页面「管理 → 预设切换」，不再注册面板设置表单，避免重复
 * - 切换走面板自带的 ChangeServerEgg，保留同名变量并同步 Wings
 */
class EggSwitcherProvider extends ExtensionProvider
{
    public function boot(): void
    {
        // routes/server.php -> /api/client/servers/{server}/extensions/egg-switcher
        // routes/admin.php  -> /api/admin/extensions/egg-switcher
        $this->registerApiRoutes();

        $this->registerPermissions('预设切换', [
            'view' => '查看当前预设与可切换的预设列表',
            'switch' => '切换服务器预设（会改动启动命令、镜像与变量）',
        ]);
    }
}
