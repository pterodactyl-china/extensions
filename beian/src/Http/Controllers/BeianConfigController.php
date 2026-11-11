<?php

declare(strict_types=1);

namespace Beian\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Pterodactyl\Services\Extensions\ExtensionSettingsRegistry;

/**
 * 公开的备案信息，未登录的登录页也要能读到，因此走 root 路由而不是 client API。
 * 只返回要显示的那几项，空字符串表示不显示。
 */
class BeianConfigController
{
    public function __construct(
        private readonly ExtensionSettingsRegistry $settings,
    ) {}

    public function show(): JsonResponse
    {
        $values = $this->settings->get('beian');

        $read = function (string $toggle, string $number) use ($values): string {
            // 开关默认开启：未保存过也当作开启。
            if ($values->get($toggle) === false) {
                return '';
            }

            return trim((string) $values->get($number));
        };

        $response = new JsonResponse([
            'icp' => $read('show_icp', 'icp_number'),
            'police' => $read('show_police', 'police_number'),
            'license' => $read('show_license', 'license_number'),
        ]);

        // 号码改动后刷新页面就能看到，避免浏览器缓存旧值。
        $response->headers->set('Cache-Control', 'no-store, max-age=0');

        return $response;
    }
}
