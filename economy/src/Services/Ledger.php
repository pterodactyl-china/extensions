<?php

declare(strict_types=1);

namespace Economy\Services;

use Economy\Contracts\Wallet;
use Economy\Exceptions\InsufficientBalanceException;
use Economy\Models\WalletAccount;
use Economy\Models\WalletTransaction;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Pterodactyl\Models\User;

/**
 * 默认账本实现：余额与流水同表记录，所有变更都在事务里加行锁。
 *
 * 并发安全靠两点：
 * 1. 事务内 lockForUpdate 锁住钱包行；
 * 2. reference 唯一索引，重复请求不会重复记账。
 */
class Ledger implements Wallet
{
    public function __construct(private readonly EconomySettings $settings) {}

    public function balance(User $user): int
    {
        return (int) WalletAccount::query()->where('user_id', $user->id)->value('balance');
    }

    public function canAfford(User $user, int $amount): bool
    {
        if ($amount <= 0) {
            return true;
        }

        return $this->balance($user) >= $amount;
    }

    public function deposit(
        User $user,
        int $amount,
        string $kind,
        ?string $description = null,
        ?string $reference = null,
        array $meta = [],
    ): array {
        if ($amount <= 0) {
            throw new InvalidArgumentException('入账金额必须大于 0。');
        }

        return $this->apply($user, $amount, $kind, $description, $reference, $meta);
    }

    public function withdraw(
        User $user,
        int $amount,
        string $kind,
        ?string $description = null,
        ?string $reference = null,
        array $meta = [],
    ): array {
        if ($amount <= 0) {
            throw new InvalidArgumentException('出账金额必须大于 0。');
        }

        return $this->apply($user, -$amount, $kind, $description, $reference, $meta);
    }

    public function transfer(
        User $from,
        User $to,
        int $amount,
        string $kind,
        ?string $description = null,
        ?string $reference = null,
        array $meta = [],
    ): void {
        if ($amount <= 0) {
            throw new InvalidArgumentException('转账金额必须大于 0。');
        }

        if ($from->is($to)) {
            throw new InvalidArgumentException('不能给自己转账。');
        }

        DB::transaction(function () use ($from, $to, $amount, $kind, $description, $reference, $meta): void {
            $suffix = $reference === null || $reference === '' ? null : $reference;

            $this->apply(
                $from,
                -$amount,
                $kind,
                $description,
                $suffix === null ? null : $suffix.':out',
                $meta + ['counterparty' => $to->id],
            );

            $this->apply(
                $to,
                $amount,
                $kind,
                $description,
                $suffix === null ? null : $suffix.':in',
                $meta + ['counterparty' => $from->id],
            );
        });
    }

    public function history(User $user, int $limit = 50, ?string $kind = null): array
    {
        $query = WalletTransaction::query()
            ->where('user_id', $user->id)
            ->orderByDesc('id')
            ->limit(max(1, min(200, $limit)));

        if ($kind !== null && $kind !== '') {
            $query->where('kind', $kind);
        }

        return $query->get()->map(fn (WalletTransaction $row): array => $row->toPublicArray())->all();
    }

    public function entry(string $reference): ?array
    {
        $row = WalletTransaction::query()->where('reference', $reference)->first();

        return $row?->toPublicArray();
    }

    public function summary(User $user): array
    {
        $earned = (int) WalletTransaction::query()
            ->where('user_id', $user->id)
            ->where('amount', '>', 0)
            ->sum('amount');

        $spent = (int) abs((int) WalletTransaction::query()
            ->where('user_id', $user->id)
            ->where('amount', '<', 0)
            ->sum('amount'));

        return ['earned' => $earned, 'spent' => $spent];
    }

    public function aggregate(): array
    {
        return [
            'users' => (int) WalletAccount::query()->count(),
            'balance' => (int) WalletAccount::query()->sum('balance'),
        ];
    }

    public function all(int $limit = 100, array $userIds = []): array
    {
        $query = WalletTransaction::query()->orderByDesc('id')->limit(max(1, min(500, $limit)));

        if ($userIds !== []) {
            $query->whereIn('user_id', $userIds);
        }

        return $query->get()->map(fn (WalletTransaction $row): array => $row->toPublicArray() + [
            'user_id' => $row->user_id,
        ])->all();
    }

    /**
     * 记一笔账，返回流水。
     *
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     *
     * @throws InsufficientBalanceException
     */
    private function apply(
        User $user,
        int $amount,
        string $kind,
        ?string $description,
        ?string $reference,
        array $meta,
    ): array {
        $reference = $reference === null || $reference === '' ? null : $reference;

        // 幂等：同一个 reference 直接返回已有流水，不再重复记账。
        if ($reference !== null) {
            $existing = WalletTransaction::query()->where('reference', $reference)->first();

            if ($existing !== null) {
                $this->assertSameIntent($existing, $amount, $kind);

                return $existing->toPublicArray();
            }
        }

        try {
            return DB::transaction(function () use ($user, $amount, $kind, $description, $reference, $meta): array {
                WalletAccount::query()->firstOrCreate(['user_id' => $user->id], ['balance' => 0, 'frozen' => 0]);

                $wallet = WalletAccount::query()
                    ->where('user_id', $user->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $next = $wallet->balance + $amount;

                if ($next < 0 && !$this->settings->on('allow_negative')) {
                    throw new InsufficientBalanceException($wallet->balance, abs($amount));
                }

                $wallet->balance = $next;
                $wallet->save();

                $transaction = WalletTransaction::query()->create([
                    'user_id' => $user->id,
                    'amount' => $amount,
                    'balance_after' => $next,
                    'kind' => $kind,
                    'description' => $description,
                    'reference' => $reference,
                    'meta' => $meta === [] ? null : $meta,
                    'created_at' => now(),
                ]);

                return $transaction->toPublicArray();
            });
        } catch (QueryException $exception) {
            // 并发下两个请求带同一个 reference：唯一索引会拦住后到的那个，
            // 这里把已有的流水读出来当作成功，保证幂等语义。
            if ($reference !== null && $this->isUniqueViolation($exception)) {
                $existing = WalletTransaction::query()->where('reference', $reference)->first();

                if ($existing !== null) {
                    $this->assertSameIntent($existing, $amount, $kind);

                    return $existing->toPublicArray();
                }
            }

            throw $exception;
        }
    }

    private function assertSameIntent(WalletTransaction $existing, int $amount, string $kind): void
    {
        if ($existing->amount !== $amount || $existing->kind !== $kind) {
            throw new InvalidArgumentException(sprintf(
                '幂等键 %s 已用于另一笔账（%s %d），不能复用。',
                (string) $existing->reference,
                $existing->kind,
                $existing->amount,
            ));
        }
    }

    private function isUniqueViolation(QueryException $exception): bool
    {
        $message = $exception->getMessage();

        return str_contains($message, 'Duplicate entry')
            || str_contains($message, 'UNIQUE constraint failed')
            || str_contains($message, 'duplicate key value');
    }
}
