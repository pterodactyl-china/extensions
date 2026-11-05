<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * 待确认操作：AI 给出的命令或文件不会立即生效，先落在这里，
 * 用户点「确认」后才由 apply 接口取出执行，10 分钟内未确认自动失效。
 */
class ProposalStore
{
    private const TTL_MINUTES = 10;

    /** @return array<string, mixed> */
    public function put(int $userId, int $serverId, array $proposal): array
    {
        $id = (string) Str::uuid();

        $stored = $proposal + [
            'id' => $id,
            'user_id' => $userId,
            'server_id' => $serverId,
            'expires_at' => now()->addMinutes(self::TTL_MINUTES)->toIso8601String(),
        ];

        Cache::put($this->key($id), $stored, now()->addMinutes(self::TTL_MINUTES));

        return $stored;
    }

    /** @return array<string, mixed>|null */
    public function get(string $id, int $userId, int $serverId): ?array
    {
        $stored = Cache::get($this->key($id));

        if (!is_array($stored)) {
            return null;
        }

        // 必须属于同一用户、同一服务器，防止拿别人的 id 执行。
        if ((int) ($stored['user_id'] ?? 0) !== $userId || (int) ($stored['server_id'] ?? 0) !== $serverId) {
            return null;
        }

        return $stored;
    }

    public function forget(string $id): void
    {
        Cache::forget($this->key($id));
    }

    private function key(string $id): string
    {
        return 'ai-assistant:proposal:'.$id;
    }
}
