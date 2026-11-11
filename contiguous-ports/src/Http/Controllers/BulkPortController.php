<?php

declare(strict_types=1);

namespace ContiguousPorts\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\Server;
use Pterodactyl\Services\Extensions\ExtensionSettingsRegistry;
use Throwable;

/**
 * 批量分配连续端口。
 *
 * 面板原生的「新建分配」每次只从空闲端口里随机取一个，
 * 这里改成：按端口号排序后找一段连续的空闲端口，一次写入 server_id。
 */
class BulkPortController
{
    /** 单次最多分配多少个，避免一次把整段端口占满（后台可再调小）。 */
    private const MAX_BATCH = 64;

    public function __construct(
        private readonly ExtensionSettingsRegistry $settings,
    ) {}

    /** 后台设置的单次上限，缺省 16，最多 64。 */
    private function maxBatch(): int
    {
        $value = (int) $this->settings->get('contiguous-ports')->get('max_batch');

        return max(1, min(self::MAX_BATCH, $value > 0 ? $value : 16));
    }

    public function index(Server $server): JsonResponse
    {
        $allocations = Allocation::query()
            ->where('server_id', $server->id)
            ->orderBy('port')
            ->get(['id', 'ip', 'port', 'notes', 'server_id']);

        // allocation_limit 是「分配总数」的上限，主分配也算在内（与面板 1.0 的 data.length 一致）。
        $total = $allocations->count();
        $limit = (int) $server->allocation_limit;

        return new JsonResponse([
            'data' => [
                'ip' => $server->allocation?->ip,
                'limit' => $limit,
                'used' => $total,
                'remain' => max(0, $limit - $total),
                'max_batch' => $this->maxBatch(),
                'auto_allocation' => (bool) config('pterodactyl.client_features.allocations.enabled'),
                'allocations' => $allocations->map(fn (Allocation $allocation) => [
                    'id' => $allocation->id,
                    'ip' => $allocation->ip,
                    'port' => (int) $allocation->port,
                    'primary' => $allocation->id === $server->allocation_id,
                ])->all(),
            ],
        ]);
    }

    public function assign(Request $request, Server $server): JsonResponse
    {
        abort_unless($request->user()?->can('allocation.create', $server), 403);

        $max = $this->maxBatch();

        $data = $request->validate([
            'count' => ['required', 'integer', 'min:1', 'max:'.$max],
            'start' => ['nullable', 'integer', 'min:1024', 'max:65535'],
        ]);

        $count = (int) $data['count'];
        $start = isset($data['start']) ? (int) $data['start'] : null;

        $limit = (int) $server->allocation_limit;
        // 当前已有的分配数量，主分配合计在内。
        $total = Allocation::query()->where('server_id', $server->id)->count();

        if ($limit <= 0) {
            return new JsonResponse(['message' => '该服务器未配置分配额度（allocation_limit 为 0），无法创建新的分配。'], 422);
        }

        if ($total + $count > $limit) {
            $left = max(0, $limit - $total);

            return new JsonResponse([
                'message' => "该服务器最多允许 {$limit} 个分配（含主分配），当前已有 {$total} 个，最多还能创建 {$left} 个。",
            ], 422);
        }

        $primary = $server->allocation;

        if ($primary === null) {
            return new JsonResponse(['message' => '服务器没有主分配，无法确定端口所在 IP。'], 422);
        }

        // 同节点、同 IP、还没有分配给任何服务器的端口。
        $free = Allocation::query()
            ->where('node_id', $server->node_id)
            ->where('ip', $primary->ip)
            ->whereNull('server_id')
            ->orderBy('port')
            ->pluck('port')
            ->map(fn ($port) => (int) $port)
            ->all();

        $block = $this->findBlock($free, $count, $start);

        if ($block === null) {
            return new JsonResponse([
                'message' => $start === null
                    ? "IP {$primary->ip} 下没有 {$count} 个连续的空闲端口，请减少数量或指定起始端口。"
                    : "从 {$start} 开始的 {$count} 个端口不全是空闲的，请换一个起始端口。",
            ], 422);
        }

        Allocation::query()
            ->where('node_id', $server->node_id)
            ->where('ip', $primary->ip)
            ->whereIn('port', $block)
            ->update(['server_id' => $server->id]);

        try {
            Daemon::server($server)->sync();
        } catch (Throwable) {
            // 面板已经写入，Wings 下次同步也会拿到；不因此回滚分配。
        }

        return new JsonResponse([
            'data' => [
                'ip' => $primary->ip,
                'ports' => $block,
            ],
        ]);
    }

    /**
     * 在升序的空闲端口里找 count 个连续的。
     * 指定了起始端口就只认这一段，否则找第一段够长的。
     *
     * @param  list<int>  $free
     * @return list<int>|null
     */
    private function findBlock(array $free, int $count, ?int $start): ?array
    {
        if ($start !== null) {
            $block = range($start, $start + $count - 1);

            return count(array_diff($block, $free)) === 0 ? $block : null;
        }

        $run = [];
        $previous = null;

        foreach ($free as $port) {
            $run = ($previous !== null && $port === $previous + 1) ? [...$run, $port] : [$port];
            $previous = $port;

            if (count($run) >= $count) {
                return array_slice($run, 0, $count);
            }
        }

        return null;
    }
}
