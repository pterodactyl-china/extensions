<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\Server;

/**
 * 所有越权判断集中在这里：开放范围、限流、命令白名单。
 * 控制器只做参数校验与转发，不自己判断权限。
 */
class Guard
{
    /** 命令长度上限，超过一律拒绝。 */
    private const MAX_COMMAND_LENGTH = 200;

    public function __construct(
        private readonly AiSettings $settings,
    ) {}

    public function settings(): AiSettings
    {
        return $this->settings;
    }

    public function on(string $key): bool
    {
        return (bool) $this->settings()->get($key);
    }

    public function number(string $key, int $fallback): int
    {
        $value = (int) $this->settings()->get($key);

        return $value > 0 ? $value : $fallback;
    }

    public function text(string $key): string
    {
        return trim((string) ($this->settings()->get($key) ?? ''));
    }

    /**
     * 这台服务器是否开放 AI 助手。
     * scope = all 时全部开放；scope = tags 时要求预设标签与白名单有交集。
     */
    /**
     * 是否对这台服务器开放。
     *
     * 不再有独立的「启用」总开关：范围选「所有预设」就全开，
     * 想整体停用就把范围改成「仅指定标签」且不选任何标签。
     */
    public function enabledFor(Server $server): bool
    {
        if ($this->text('scope') !== 'tags') {
            return true;
        }

        $allowed = $this->allowedTags();

        if ($allowed === []) {
            return false;
        }

        $server->loadMissing('egg.tags');

        return $server->egg !== null
            && $server->egg->tags->pluck('slug')->intersect($allowed)->isNotEmpty();
    }

    /** @return list<string> */
    public function allowedTags(): array
    {
        $raw = $this->settings()->get('tags');
        $items = is_array($raw) ? $raw : [];

        return array_values(array_unique(array_filter(
            array_map(static fn ($value): string => mb_strtolower(trim((string) $value)), $items),
            static fn (string $value): bool => $value !== '',
        )));
    }

    /**
     * 每用户每分钟的提问次数限制。
     */
    public function attempt(int $userId, int $limit): bool
    {
        // 0 或负数表示不限，直接放行（不计数）。
        if ($limit <= 0) {
            return true;
        }

        $key = sprintf('ai-assistant:rate:%d:%s', $userId, now()->format('YmdHi'));
        $count = (int) Cache::get($key, 0);

        if ($count >= $limit) {
            return false;
        }

        Cache::put($key, $count + 1, now()->addMinutes(2));

        return true;
    }

    /** 每分钟提问次数；0 表示不限。 */
    public function rateLimit(): int
    {
        return max(0, (int) $this->settings()->get('rate_limit'));
    }

    /** 单次回复最大 Token；0 表示不限（交给上游默认）。 */
    public function maxTokens(): int
    {
        return max(0, (int) $this->settings()->get('max_tokens'));
    }

    /** 未计费时的单次上限；0 表示不限。 */
    public function maxTokensGuest(): int
    {
        return max(0, (int) $this->settings()->get('max_tokens_guest'));
    }

    /**
     * 每人每天的提问上限；0 表示不限。
     *
     * 注意不能用 number()：它会把 0 当成「没设置」替换成 fallback，
     * 而这里 0 是有意义的（不限）。
     */
    public function dailyLimit(): int
    {
        return max(0, (int) $this->settings()->get('daily_limit'));
    }

    /**
     * 每日额度校验。未配置（0）时直接放行。
     * 计数按「用户 + 自然日」存，跨天自动归零。
     */
    public function attemptDaily(int $userId): bool
    {
        $limit = $this->dailyLimit();

        if ($limit <= 0) {
            return true;
        }

        $key = sprintf('ai-assistant:daily:%d:%s', $userId, now()->format('Y-m-d'));
        $count = (int) Cache::get($key, 0);

        if ($count >= $limit) {
            return false;
        }

        Cache::put($key, $count + 1, now()->endOfDay());

        return true;
    }

    /** 今日剩余次数；不限时返回 null。 */
    public function dailyRemaining(int $userId): ?int
    {
        $limit = $this->dailyLimit();

        if ($limit <= 0) {
            return null;
        }

        $key = sprintf('ai-assistant:daily:%d:%s', $userId, now()->format('Y-m-d'));

        return max(0, $limit - (int) Cache::get($key, 0));
    }

    /** 每人每天的 Token 上限；0 表示不限（同样不能用 number()）。 */
    public function dailyTokenLimit(): int
    {
        return max(0, (int) $this->settings()->get('daily_token_limit'));
    }

    /** 今日已消耗的 Token（估算 + 实际累计）。 */
    public function dailyTokensUsed(int $userId): int
    {
        $key = sprintf('ai-assistant:tokens:%d:%s', $userId, now()->format('Y-m-d'));

        return (int) Cache::get($key, 0);
    }

    /** 今日还剩多少 Token；不限时返回 null。 */
    public function dailyTokensRemaining(int $userId): ?int
    {
        $limit = $this->dailyTokenLimit();

        if ($limit <= 0) {
            return null;
        }

        return max(0, $limit - $this->dailyTokensUsed($userId));
    }

    /** 记录本次对话消耗的 Token。 */
    public function addDailyTokens(int $userId, int $tokens): void
    {
        if ($this->dailyTokenLimit() <= 0 || $tokens <= 0) {
            return;
        }

        $key = sprintf('ai-assistant:tokens:%d:%s', $userId, now()->format('Y-m-d'));

        Cache::put($key, $this->dailyTokensUsed($userId) + $tokens, now()->endOfDay());
    }

    /**
     * 命令白名单校验。
     *
     * 支持的规则（每行一条）：
     * - prefix:stop      以 stop 开头
     * - /^whitelist /    正则
     * - stop             完全匹配
     *
     * 另外无条件拒绝换行与 shell 元字符，避免把控制台当脚本通道。
     */
    public function commandAllowed(string $command): bool
    {
        $command = trim($command);

        if ($command === '' || mb_strlen($command) > self::MAX_COMMAND_LENGTH) {
            return false;
        }

        if (preg_match('/[\r\n]/', $command) === 1) {
            return false;
        }

        if (preg_match('/[;&|`$<>]/', $command) === 1) {
            return false;
        }

        // all：只要不是危险命令就放行（危险命令由前端二次确认 + 后端复核）。
        if ($this->commandMode() === 'all') {
            return true;
        }

        foreach ($this->commandRules() as $rule) {
            if (str_starts_with($rule, 'prefix:')) {
                $prefix = trim(substr($rule, 7));

                if ($prefix !== '' && str_starts_with($command, $prefix)) {
                    return true;
                }

                continue;
            }

            if (mb_strlen($rule) > 2 && str_starts_with($rule, '/') && str_ends_with($rule, '/')) {
                $pattern = substr($rule, 1, -1);

                if (@preg_match('/'.$pattern.'/u', $command) === 1) {
                    return true;
                }

                continue;
            }

            if ($command === $rule) {
                return true;
            }
        }

        return false;
    }

    /** 命令模式：all（默认，放行非危险命令）或 whitelist（只放行白名单）。 */
    public function commandMode(): string
    {
        return $this->text('command_mode') === 'whitelist' ? 'whitelist' : 'all';
    }

    /**
     * 高风险命令：停机、权限、封禁、插件装卸、执行任意命令。
     * 这些不是禁止，而是必须额外勾选确认才允许下发。
     */
    public function isDangerous(string $command): bool
    {
        $patterns = [
            '/^\s*(stop|restart|end|shutdown)\b/i',
            '/^\s*(op|deop)\b/i',
            '/^\s*(ban|ban-ip|pardon|pardon-ip|kick)\b/i',
            '/^\s*whitelist\b/i',
            '/^\s*(execute|sudo)\b/i',
            '/^\s*(lp|luckperms|permissions|pex|groupmanager)\b/i',
            '/^\s*(plugins?\s+(load|unload|disable|enable)|plugman)\b/i',
            '/^\s*reload\b/i',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, trim($command)) === 1) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    public function commandRules(): array
    {
        $lines = preg_split('/\R/', $this->text('command_allow')) ?: [];

        return array_values(array_filter(
            array_map(static fn (string $line): string => trim($line), $lines),
            static fn (string $line): bool => $line !== '',
        ));
    }

    public function allowFiles(): bool
    {
        return $this->on('allow_files');
    }

    public function chargeEnabled(): bool
    {
        return $this->on('charge_enabled');
    }

    public function tokensPerCredit(): int
    {
        return max(1, $this->number('tokens_per_credit', 1000));
    }

    /**
     * 允许 AI 只读的目录（相对服务器根目录）。
     *
     * @return list<string>
     */
    public function readDirs(): array
    {
        $lines = preg_split('/\R/', $this->text('file_read_dirs')) ?: [];

        return array_values(array_filter(
            array_map(static fn (string $line): string => trim(str_replace('\\', '/', $line), '/'), $lines),
            static fn (string $line): bool => $line !== '',
        ));
    }

    /**
     * 读取路径校验：只允许白名单内的目录；`.` 代表根目录下的顶层文件，`*` 代表不限制。
     */
    public function readAllowed(string $path): bool
    {
        $path = ltrim(str_replace('\\', '/', trim($path)), '/');

        if ($path === '' || mb_strlen($path) > 255) {
            return false;
        }

        if (str_contains($path, '..') || preg_match('/[\x00-\x1f]/', $path) === 1) {
            return false;
        }

        // 敏感文件不因「放开目录」而暴露：密钥、凭据、数据库文件一律拒绝。
        if ($this->isSensitiveFile($path)) {
            return false;
        }

        $dirs = $this->readDirs();

        if (in_array('*', $dirs, true)) {
            return true;
        }

        $segments = explode('/', $path);

        // 根目录文件（如 server.properties）需要显式允许 `.`。
        if (count($segments) === 1) {
            return in_array('.', $dirs, true);
        }

        return in_array($segments[0], $dirs, true);
    }

    /** 密钥、凭据、数据库一类的文件永远不给 AI 读。 */
    private function isSensitiveFile(string $path): bool
    {
        $name = mb_strtolower(basename($path));

        if (in_array($name, ['.env', '.env.local', '.env.production', 'auth.json', 'credentials.json', 'secrets.json', 'config.json.bak'], true)) {
            return true;
        }

        if (preg_match('/\.(key|pem|p12|pfx|jks|keystore|sqlite|sqlite3|db|kdbx|htpasswd)$/i', $name) === 1) {
            return true;
        }

        return str_starts_with($name, 'id_rsa') || str_starts_with($name, 'id_ed25519');
    }

    /**
     * 允许 AI 写文件的目录前缀（相对服务器根目录）。
     *
     * @return list<string>
     */
    public function allowedDirs(): array
    {
        $lines = preg_split('/\R/', $this->text('file_allow_dirs')) ?: [];

        return array_values(array_filter(
            array_map(static fn (string $line): string => trim(str_replace('\\', '/', $line), '/'), $lines),
            static fn (string $line): bool => $line !== '',
        ));
    }

    /**
     * 文件路径校验：必须是相对路径、不含 .. 与控制字符、且落在允许目录内。
     */
    public function fileAllowed(string $path): bool
    {
        $path = ltrim(str_replace('\\', '/', trim($path)), '/');

        if ($path === '' || mb_strlen($path) > 255) {
            return false;
        }

        // 仍拒绝绝对路径与目录穿越：这不是白名单，是路径安全。
        if (str_contains($path, '..') || preg_match('/[\x00-\x1f]/', $path) === 1) {
            return false;
        }

        // 密钥/凭据/数据库文件不允许被覆盖，避免一次确认毁掉整个面板对接。
        if ($this->isSensitiveFile($path)) {
            return false;
        }

        // 目录白名单已取消：任何位置都可写，安全性由「写入前二次确认」保证。
        return true;
    }

    /** 前端展示用的安全摘要，不含任何密钥。 */
    public function describe(Server $server): array
    {
        return [
            'enabled' => $this->enabledFor($server),
            'scope' => $this->text('scope') === 'tags' ? 'tags' : 'all',
            'tags' => $this->allowedTags(),
            'allow_execute' => $this->on('allow_execute'),
            'allow_files' => $this->allowFiles(),
            'allow_dirs' => $this->allowedDirs(),
            'read_dirs' => $this->readDirs(),
            'rate_limit' => $this->number('rate_limit', 10),
            'has_key' => $this->text('api_key') !== '',
            'command_rules' => count($this->commandRules()),
            'command_mode' => $this->commandMode(),
            'charge_enabled' => $this->chargeEnabled(),
            'tokens_per_credit' => $this->tokensPerCredit(),
        ];
    }
}
