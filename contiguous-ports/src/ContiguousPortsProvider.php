<?php

declare(strict_types=1);

namespace ContiguousPorts;

use Pterodactyl\Extensions\ExtensionProvider;
use Pterodactyl\Services\Extensions\ExtensionSettingDefinition;
use Pterodactyl\Services\Extensions\ExtensionSettingsDefinition;

/**
 * 连续端口：在服务器的「网络」页里一次分配多个连续端口。
 * 只注册 server 上下文的 API 与一个设置项，其余都靠前端 slot 注入。
 */
class ContiguousPortsProvider extends ExtensionProvider
{
    public function boot(): void
    {
        // routes/server.php -> /api/client/servers/{server}/extensions/contiguous-ports
        $this->registerApiRoutes();

        $this->registerSettings(new ExtensionSettingsDefinition($this->settings(), [
            ExtensionSettingDefinition::make('max_batch', 'max_batch', 16, ['integer', 'min:1', 'max:64'])
                ->label('单次最多分配数量')
                ->help('用户一次最多能申请多少个连续端口，默认 16，上限 64。')
                ->field('number')
                ->frontend()
                ->frontendType('number'),
        ]));
    }
}
