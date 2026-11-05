<?php

declare(strict_types=1);

namespace AiAssistant;

use Pterodactyl\Extensions\ExtensionProvider;

/**
 * AI 助手。
 *
 * 不注册面板的扩展设置表单：所有配置都在「管理 → AI 助手」这个专用页面里维护
 * （标签多选、拉模型、测试连接这些面板表单做不到），值存于 extension_settings。
 *
 * 安全边界：
 * - 接口一律挂在 /api/client/servers/{server}/extensions/ai-assistant 下，服务器由路由绑定
 * - 只读能力：读取当前服务器最近 100 行控制台输出
 * - 写能力：命令（白名单 + control.console）与文件（目录白名单 + file.create/update），都必须先确认
 */
class AiAssistantProvider extends ExtensionProvider
{
    public function boot(): void
    {
        $this->registerApiRoutes();
    }
}
