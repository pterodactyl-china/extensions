<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Pterodactyl\Models\User;
use Pterodactyl\Services\Extensions\ExtensionSettings;

/**
 * 插件自己的配置读写。
 *
 * 不注册面板的扩展设置表单（那会多出一套重复的 UI），
 * 直接读写面板的 extension_settings 表，由本插件的后台页负责展示与保存。
 * API Key 走 secret 通道，加密存储。
 */
class AiSettings
{
    private const EXTENSION = 'ai-assistant';

    /** 默认值集中在这里，替代面板设置定义。 */
    public const DEFAULTS = [
        'enabled' => true,
        'provider' => 'deepseek',
        'api_key' => '',
        'base_url' => '',
        'model' => '',
        // 计费用户与自带 Key 用户默认不限，交给模型自己的上限；填 0 即不向上游传 max_tokens。
        'max_tokens' => 0,
        // 免费额度是防滥用用的，这里留一个上限（400～1200 只能写一小段，分析类回答建议 4000 起步）。
        'max_tokens_guest' => 4000,
        'timeout' => 60,
        'scope' => 'all',
        'tags' => [],
        'allow_execute' => false,
        // all：放行所有非危险命令（危险项仍需勾选确认）；whitelist：只放行白名单。
        'command_mode' => 'all',
        'command_allow' => '',
        'allow_files' => false,
        // 写入不再限制目录；保留该键仅为兼容老配置（留空即不限制）。
        'file_allow_dirs' => '',
        // 允许 AI 只读的范围：`*` 表示整个服务器目录（密钥/凭据/数据库文件始终排除），
        // `.` 表示根目录顶层文件，也可写具体目录名。
        'file_read_dirs' => '*',
        'charge_enabled' => false,
        'tokens_per_credit' => 1000,
        'rate_limit' => 10,
        // 免费额度：没启用积分时用它控成本，0 表示不限。
        'daily_limit' => 0,
        'daily_token_limit' => 0,
        'system_prompt' => '',
        // 联网搜索：留空表示平台不提供；用户仍可在「我的 API」里自带搜索 Key。
        'search_provider' => '',
        'search_api_key' => '',
        'search_base_url' => '',
        // 未配置搜索服务时，是否尝试用模型自带的服务端搜索。
        'search_fallback' => false,
        // 每次联网搜索扣多少积分（0 = 不扣）；用户自带搜索 Key 时不扣。搜索接口按次计费。
        'search_credits' => 0,
        // 工具集：逗号分隔的禁用名单。
        'tools_disabled' => '',
        // 自定义 GET 工具，每行：name|描述|https://host/path?q={query}
        'custom_tools' => '',
    ];

    /** 这些键走加密存储，不进明文设置。 */
    private const SECRET_KEYS = ['api_key', 'search_api_key'];

    /** @return array<string, mixed> */
    public function all(): array
    {
        $settings = new ExtensionSettings(self::EXTENSION);
        $values = [];

        foreach (self::DEFAULTS as $key => $default) {
            $values[$key] = $settings->get($key, $default);
        }

        return $values;
    }

    public function get(string $key): mixed
    {
        return (new ExtensionSettings(self::EXTENSION))->get($key, self::DEFAULTS[$key] ?? null);
    }

    /**
     * 只写入传入的键；api_key 为 secret，空值直接跳过（保持原值）。
     *
     * @param  array<string, mixed>  $payload
     */
    public function save(array $payload): void
    {
        $settings = new ExtensionSettings(self::EXTENSION);
        $plain = [];
        $secrets = [];

        foreach ($payload as $key => $value) {
            if (in_array($key, self::SECRET_KEYS, true)) {
                $value = trim((string) $value);

                if ($value !== '') {
                    $secrets[$key] = $value;
                }

                continue;
            }

            if (!array_key_exists($key, self::DEFAULTS)) {
                continue;
            }

            $plain[$key] = $value;
        }

        if ($plain !== []) {
            $settings->setMany($plain);
        }

        if ($secrets !== []) {
            $settings->setManySecrets($secrets, array_keys($secrets));
        }
    }

    /**
     * 用户自带的 AI 凭据（BYOK）：用于自己的 Key，不消耗平台额度与积分。
     *
     * 注意：这里不用 ExtensionSettings 的 user scope（那要求 extension_settings 有 user_id 列，
     * 旧版本面板没有该列，会直接 SQL 报错 500）。改用「user_<id>_ 前缀」的全局键，
     * 配合 secret 加密，兼容所有版本。
     *
     * @return array{provider: string, model: string, base_url: string, api_key: string}
     */
    public function userAi(User $user): array
    {
        $prefix = 'user_'.$user->id.'_';
        $settings = new ExtensionSettings(self::EXTENSION);

        return [
            'provider' => (string) $settings->get($prefix.'provider', ''),
            'model' => (string) $settings->get($prefix.'model', ''),
            'base_url' => (string) $settings->get($prefix.'base_url', ''),
            'api_key' => (string) $settings->get($prefix.'api_key', ''),
        ];
    }

    /**
     * 用户自带的搜索服务（后台没配也能自己搜）。
     *
     * @return array{provider: string, base_url: string, api_key: string}
     */
    public function userSearch(User $user): array
    {
        $prefix = 'user_'.$user->id.'_';
        $settings = new ExtensionSettings(self::EXTENSION);

        return [
            'provider' => (string) $settings->get($prefix.'search_provider', ''),
            'base_url' => (string) $settings->get($prefix.'search_base_url', ''),
            'api_key' => (string) $settings->get($prefix.'search_api_key', ''),
        ];
    }

    /**
     * 保存用户自带的搜索配置；api_key 传空表示不修改，传 `-` 表示清除。
     *
     * @param  array<string, mixed>  $payload
     */
    public function saveUserSearch(User $user, array $payload): void
    {
        $prefix = 'user_'.$user->id.'_';
        $settings = new ExtensionSettings(self::EXTENSION);
        $plain = [];

        foreach (['provider', 'base_url'] as $field) {
            if (array_key_exists($field, $payload) && $payload[$field] !== null) {
                $plain[$prefix.'search_'.$field] = (string) $payload[$field];
            }
        }

        if ($plain !== []) {
            $settings->setMany($plain);
        }

        $key = trim((string) ($payload['api_key'] ?? ''));
        $secretKey = $prefix.'search_api_key';

        if ($key === '-') {
            $settings->setManySecrets([$secretKey => ''], [$secretKey]);
        } elseif ($key !== '') {
            $settings->setManySecrets([$secretKey => $key], [$secretKey]);
        }
    }

    /**
     * 保存用户自带的凭据；api_key 传空表示不修改，传 `-` 表示清除。
     *
     * @param  array<string, mixed>  $payload
     */
    public function saveUserAi(User $user, array $payload): void
    {
        $prefix = 'user_'.$user->id.'_';
        $settings = new ExtensionSettings(self::EXTENSION);
        $plain = [];

        foreach (['provider', 'model', 'base_url'] as $field) {
            if (array_key_exists($field, $payload) && $payload[$field] !== null) {
                $plain[$prefix.$field] = (string) $payload[$field];
            }
        }

        if ($plain !== []) {
            $settings->setMany($plain);
        }

        $key = trim((string) ($payload['api_key'] ?? ''));
        $secretKey = $prefix.'api_key';

        if ($key === '-') {
            $settings->setManySecrets([$secretKey => ''], [$secretKey]);
        } elseif ($key !== '') {
            $settings->setManySecrets([$secretKey => $key], [$secretKey]);
        }
    }
}
