<?php

declare(strict_types=1);

namespace Beian;

use Pterodactyl\Extensions\ExtensionProvider;
use Pterodactyl\Services\Extensions\ExtensionSettingDefinition;
use Pterodactyl\Services\Extensions\ExtensionSettingsDefinition;

/**
 * 只有几个可选的备案号码，没有数据表与模型。
 *
 * 号码不通过前端的 config 下发，而是由 /beian/config.json 这个公开接口提供：
 * 前端设置的类型校验会把留空的项判为无效，导致整份 config 被丢弃，表现就是
 * 「只要有一项没填，全都不显示」。改走接口就不受这个影响。
 */
class BeianProvider extends ExtensionProvider
{
    public function boot(): void
    {
        // routes/root.php -> /beian/config.json（公开，供未登录的登录页读取）
        $this->registerRootRoutes($this->extensionPath('routes', 'root.php'));

        $this->registerSettings(new ExtensionSettingsDefinition($this->settings(), [
            ExtensionSettingDefinition::make('icp_number', 'icp_number', '', ['nullable', 'string', 'max:191'])
                ->label('ICP 备案号')
                ->help('例如「京ICP备2023012345号-1」。留空则不在页面上显示，点击后跳转工信部备案查询系统。')
                ->field('text'),

            ExtensionSettingDefinition::make('show_icp', 'show_icp', true)
                ->label('显示 ICP 备案号')
                ->help('关闭后该项从页脚消失，号码仍然保留，重新打开即可恢复。')
                ->field('toggle'),

            ExtensionSettingDefinition::make('police_number', 'police_number', '', ['nullable', 'string', 'max:191'])
                ->label('公安备案号')
                ->help('例如「京公网安备 11010502030146号」。留空则不在页面上显示，点击后跳转全国互联网安全管理服务平台。')
                ->field('text'),

            ExtensionSettingDefinition::make('show_police', 'show_police', true)
                ->label('显示公安备案号')
                ->help('关闭后该项从页脚消失，号码仍然保留，重新打开即可恢复。')
                ->field('toggle'),

            ExtensionSettingDefinition::make('license_number', 'license_number', '', ['nullable', 'string', 'max:191'])
                ->label('ICP 许可证号')
                ->help('增值电信业务经营许可证，例如「京B2-20230123」。留空则不在页面上显示，点击后跳转电信业务市场综合管理信息系统。')
                ->field('text'),

            ExtensionSettingDefinition::make('show_license', 'show_license', true)
                ->label('显示 ICP 许可证号')
                ->help('关闭后该项从页脚消失，号码仍然保留，重新打开即可恢复。')
                ->field('toggle'),
        ]));
    }
}
