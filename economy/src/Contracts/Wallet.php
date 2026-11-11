<?php

declare(strict_types=1);

namespace Economy\Contracts;

use Economy\Exceptions\InsufficientBalanceException;
use Pterodactyl\Models\User;

/**
 * 公共经济契约。
 *
 * 其它扩展只依赖这个接口，不依赖任何具体实现：
 *
 *     if (!interface_exists(Wallet::class)) {
 *         // 没装经济系统，不扣费
 *     }
 *
 *     app(Wallet::class)->withdraw($user, 4, 'ai-assistant', 'AI 对话', 'ai:'.$uuid);
 *
 * 约定：
 * - 金额单位为「分」，一律是整数，正数加、负数减由方法语义决定；
 * - 传 reference 时幂等，同一 reference 重复调用只会记一次账；
 * - withdraw 在余额不足时抛 InsufficientBalanceException，调用方自行决定是否拦截。
 */
interface Wallet
{
    /** 当前可用余额。 */
    public function balance(User $user): int;

    /** 余额是否足够。 */
    public function canAfford(User $user, int $amount): bool;

    /**
     * 入账。
     *
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed> 流水记录
     */
    public function deposit(
        User $user,
        int $amount,
        string $kind,
        ?string $description = null,
        ?string $reference = null,
        array $meta = [],
    ): array;

    /**
     * 出账，余额不足时抛 InsufficientBalanceException。
     *
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed> 流水记录
     *
     * @throws InsufficientBalanceException
     */
    public function withdraw(
        User $user,
        int $amount,
        string $kind,
        ?string $description = null,
        ?string $reference = null,
        array $meta = [],
    ): array;

    /**
     * 转账，同一个事务内一扣一加。
     *
     * @param  array<string, mixed>  $meta
     *
     * @throws InsufficientBalanceException
     */
    public function transfer(
        User $from,
        User $to,
        int $amount,
        string $kind,
        ?string $description = null,
        ?string $reference = null,
        array $meta = [],
    ): void;

    /**
     * 流水查询，按时间倒序。
     *
     * @return list<array<string, mixed>>
     */
    public function history(User $user, int $limit = 50, ?string $kind = null): array;

    /**
     * 按幂等键查流水；不存在返回 null。
     * 供调用方在重试前判断这笔账是否已经记过。
     *
     * @return array<string, mixed>|null
     */
    public function entry(string $reference): ?array;

    /**
     * 单个用户的累计收入与支出。
     *
     * @return array{earned: int, spent: int}
     */
    public function summary(User $user): array;

    /**
     * 平台级汇总：有多少个钱包、余额总和。
     *
     * @return array{users: int, balance: int}
     */
    public function aggregate(): array;

    /**
     * 全局流水（审计用），按时间倒序。
     *
     * @param  list<int>  $userIds  非空时只返回这些用户的流水
     * @return list<array<string, mixed>>
     */
    public function all(int $limit = 100, array $userIds = []): array;
}
