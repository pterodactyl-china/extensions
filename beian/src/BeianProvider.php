<?php

declare(strict_types=1);

namespace Beian;

use Pterodactyl\Extensions\ExtensionProvider;
use Pterodactyl\Services\Extensions\ExtensionSettingDefinition;
use Pterodactyl\Services\Extensions\ExtensionSettingsDefinition;

/**
 * 三个可选的备案号码，每个配一个显示开关；没有路由、数据表与模型。
 * 号码作为普通设置保存并交给前端 bundle，由前端决定显示哪几项。
 *
 * 所有设置都是 ->frontend()->public() 的：未登录的登录页也要显示备案信息，
 * 而备案号本身就是公开信息。
 */
class BeianProvider extends ExtensionProvider
{
    public function boot(): void
    {
        $this->registerSettings(new ExtensionSettingsDefinition($this->settings(), [
            ExtensionSettingDefinition::make('icp_number', 'icp_number', null, ['nullable', 'string', 'max:191'])
                ->label('ICP 备案号')
                ->help('例如「京ICP备2023012345号-1」。留空则不在页面上显示，点击后跳转工信部备案查询系统。')
                ->field('text')
                ->frontend()
                ->frontendType('string')
                ->public(),

            ExtensionSettingDefinition::make('show_icp', 'show_icp', true)
                ->label('显示 ICP 备案号')
                ->help('关闭后该项从页面底部消失，号码仍然保留，重新打开即可恢复。')
                ->field('toggle')
                ->frontend()
                ->frontendType('boolean')
                ->public(),

            ExtensionSettingDefinition::make('police_number', 'police_number', null, ['nullable', 'string', 'max:191'])
                ->label('公安备案号')
                ->help('例如「京公网安备 11010502030146号」。留空则不在页面上显示，点击后跳转全国互联网安全管理服务平台。')
                ->field('text')
                ->frontend()
                ->frontendType('string')
                ->public(),

            ExtensionSettingDefinition::make('show_police', 'show_police', true)
                ->label('显示公安备案号')
                ->help('关闭后该项从页面底部消失，号码仍然保留，重新打开即可恢复。')
                ->field('toggle')
                ->frontend()
                ->frontendType('boolean')
                ->public(),

            ExtensionSettingDefinition::make('license_number', 'license_number', null, ['nullable', 'string', 'max:191'])
                ->label('ICP 许可证号')
                ->help('增值电信业务经营许可证，例如「京B2-20230123」。留空则不在页面上显示，点击后跳转电信业务市场综合管理信息系统。')
                ->field('text')
                ->frontend()
                ->frontendType('string')
                ->public(),

            ExtensionSettingDefinition::make('show_license', 'show_license', true)
                ->label('显示 ICP 许可证号')
                ->help('关闭后该项从页面底部消失，号码仍然保留，重新打开即可恢复。')
                ->field('toggle')
                ->frontend()
                ->frontendType('boolean')
                ->public(),
        ]));
    }
}
