<?php

declare(strict_types=1);

namespace CronBuilder;

use Pterodactyl\Extensions\ExtensionProvider;

/**
 * 纯前端扩展：没有路由、没有设置项、没有数据表。
 * 面板加载 dist/client.js 后由前端自己往计划任务弹窗里注入时间选择器。
 */
class CronBuilderProvider extends ExtensionProvider
{
    public function boot(): void
    {
        // 无后端逻辑。
    }
}
