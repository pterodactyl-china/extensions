<?php

declare(strict_types=1);

namespace Economy\Services;

use Pterodactyl\Services\Extensions\ExtensionSettings;

/**
 * 经济系统设置。0 一律表示「不限」或「不启用」，不做特殊回退。
 */
class EconomySettings
{
    private const EXTENSION = 'economy';

    /** @var array<string, mixed> */
    public const DEFAULTS = [
        'currency_name' => '积分',
        'currency_symbol' => '',
        // 单次调整上限，0 表示不限。
        'max_adjust' => 0,
        // 是否允许余额为负（默认不允许，避免出现负资产）。
        // 默认允许透支：消耗型插件扣费不会中断，账本记成负数，下次充值自动抵扣。
        // 购买、续费这类场景由调用方先用 canAfford() 拦住，不会让用户欠钱买东西。
        'allow_negative' => true,
    ];

    /** @return array<string, mixed> */
    public function all(): array
    {
        $settings = new ExtensionSettings(self::EXTENSION);
        $values = [];

        foreach (self::DEFAULTS as $key => $default) {
            try {
                $value = $settings->get($key);
            } catch (\Throwable) {
                $value = null;
            }

            $values[$key] = $value ?? $default;
        }

        return $values;
    }

    public function text(string $key, string $fallback = ''): string
    {
        $value = $this->all()[$key] ?? $fallback;

        return $value === null || $value === '' ? $fallback : (string) $value;
    }

    public function number(string $key, int $fallback = 0): int
    {
        $value = $this->all()[$key] ?? $fallback;

        return is_numeric($value) ? (int) $value : $fallback;
    }

    public function on(string $key, bool $fallback = false): bool
    {
        $value = $this->all()[$key] ?? $fallback;

        return in_array($value, [true, 1, '1', 'true', 'on'], true);
    }

    /** @param  array<string, mixed>  $payload */
    public function save(array $payload): void
    {
        $clean = [];

        foreach (self::DEFAULTS as $key => $default) {
            if (!array_key_exists($key, $payload) || $payload[$key] === null) {
                continue;
            }

            $clean[$key] = is_bool($default) ? (bool) $payload[$key] : $payload[$key];
        }

        if ($clean !== []) {
            (new ExtensionSettings(self::EXTENSION))->setMany($clean);
        }
    }
}
