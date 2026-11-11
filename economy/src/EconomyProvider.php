<?php

declare(strict_types=1);

namespace Economy;

use Economy\Contracts\Wallet;
use Economy\Services\Ledger;
use Pterodactyl\Extensions\ExtensionProvider;

/**
 * 经济系统。
 *
 * 核心是「一个账本 + 一个契约」：
 * - 所有积分变动都走 Economy\Services\Ledger，余额与流水永远一致；
 * - 其它扩展只依赖 Economy\Contracts\Wallet 接口，不看具体实现，
 *   将来换存储（例如接入 Redis 或多节点账本）不需要改调用方。
 */
class EconomyProvider extends ExtensionProvider
{
    public function boot(): void
    {
        $this->loadExtensionMigrations();

        // routes/client.php      -> /api/client/extensions/economy
        // routes/admin.php       -> /api/admin/extensions/economy
        // routes/application.php -> /api/application/extensions/economy
        $this->registerApiRoutes();

        // 契约绑定：其它扩展 app(Wallet::class) 拿到的就是默认账本。
        $this->app->bind(Wallet::class, Ledger::class);
    }
}
