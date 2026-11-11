<?php

declare(strict_types=1);

namespace Economy\Http\Controllers;

use Economy\Contracts\Wallet;
use Economy\Exceptions\InsufficientBalanceException;
use Economy\Services\EconomySettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use Pterodactyl\Models\User;

/** 后台：设置、用户检索、手动调整与流水。 */
class AdminWalletController
{
    public function __construct(
        private readonly Wallet $wallet,
        private readonly EconomySettings $settings,
    ) {}

    public function config(): JsonResponse
    {
        return new JsonResponse(['data' => $this->settings->all()]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'currency_name' => ['nullable', 'string', 'max:32'],
            'currency_symbol' => ['nullable', 'string', 'max:8'],
            'max_adjust' => ['nullable', 'integer', 'min:0', 'max:100000000'],
            'allow_negative' => ['nullable', 'boolean'],
        ]);

        $this->settings->save($data);

        return new JsonResponse(['data' => $this->settings->all()]);
    }

    public function users(Request $request): JsonResponse
    {
        $query = trim((string) $request->query('query', ''));

        $builder = User::query()->orderBy('id')->limit(20);

        if ($query !== '') {
            $builder->where(function ($inner) use ($query): void {
                $inner->where('username', 'like', '%'.$query.'%')
                    ->orWhere('email', 'like', '%'.$query.'%')
                    ->orWhere('name_first', 'like', '%'.$query.'%')
                    ->orWhere('name_last', 'like', '%'.$query.'%');
            });
        }

        // users 表只有 name_first / name_last，没有 name 列，不能直接 select/where。
        $users = $builder->get(['id', 'username', 'email', 'name_first', 'name_last'])->map(
            fn (User $user): array => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'name' => mb_trim($user->name_first.' '.$user->name_last),
                'balance' => $this->wallet->balance($user),
            ]
        );

        return new JsonResponse([
            'data' => [
                'users' => $users,
                'currency' => $this->settings->text('currency_name', '积分'),
            ],
        ]);
    }

    public function user(int $id): JsonResponse
    {
        $user = User::query()->findOrFail($id);

        return new JsonResponse([
            'data' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'name' => mb_trim($user->name_first.' '.$user->name_last),
                'balance' => $this->wallet->balance($user),
                'currency' => $this->settings->text('currency_name', '积分'),
                'transactions' => $this->wallet->history($user, 20),
            ],
        ]);
    }

    public function adjust(Request $request, int $id): JsonResponse
    {
        $user = User::query()->findOrFail($id);

        $data = $request->validate([
            'amount' => ['required', 'integer', 'not_in:0'],
            'description' => ['nullable', 'string', 'max:191'],
            'reference' => ['nullable', 'string', 'max:150'],
        ]);

        $amount = (int) $data['amount'];
        $limit = $this->settings->number('max_adjust');

        if ($limit > 0 && abs($amount) > $limit) {
            return new JsonResponse(['message' => "单次调整不能超过 {$limit}。"], 422);
        }

        $description = (string) ($data['description'] ?? '') ?: '管理员调整';
        $reference = (string) ($data['reference'] ?? '') ?: 'admin:'.$user->id.':'.uniqid('', true);

        // 手工扣减最多扣到 0：余额不足时只扣剩下的部分，不再往下扣成负数。
        if ($amount < 0) {
            $balance = $this->wallet->balance($user);

            if ($balance <= 0) {
                return new JsonResponse([
                    'message' => sprintf('该用户余额为 %d，已经扣到 0 或以下，无需再扣。', $balance),
                ], 422);
            }

            $requested = -$amount;
            $amount = -min($requested, $balance);

            if ($amount !== -$requested) {
                $description .= sprintf('（申请扣 %d，余额只有 %d，已扣至 0）', $requested, $balance);
            }
        }

        try {
            $entry = $amount > 0
                ? $this->wallet->deposit($user, $amount, 'admin', $description, $reference)
                : $this->wallet->withdraw($user, -$amount, 'admin', $description, $reference);
        } catch (InsufficientBalanceException $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 422);
        } catch (InvalidArgumentException $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 422);
        }

        return new JsonResponse([
            'data' => [
                'entry' => $entry,
                'balance' => $this->wallet->balance($user),
            ],
        ]);
    }

    /**
     * 批量调整：对多个用户执行同一笔增减。
     * 每个用户独立记账，单个失败不影响其他人，最后返回成功与失败明细。
     */
    public function adjustBatch(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['integer', 'min:1'],
            'amount' => ['required', 'integer', 'not_in:0'],
            'description' => ['nullable', 'string', 'max:191'],
        ]);

        $amount = (int) $data['amount'];
        $limit = $this->settings->number('max_adjust');

        if ($limit > 0 && abs($amount) > $limit) {
            return new JsonResponse(['message' => "单次调整不能超过 {$limit}。"], 422);
        }

        $description = (string) ($data['description'] ?? '') ?: '管理员批量调整';
        $adjusted = [];
        $failed = [];

        foreach (array_values(array_unique(array_map('intval', $data['ids']))) as $id) {
            $user = User::query()->find($id);

            if ($user === null) {
                $failed[] = ['id' => $id, 'message' => '用户不存在'];

                continue;
            }

            // 扣减最多扣到 0；已经是 0 或负数的用户跳过，不再往下扣。
            $delta = $amount;

            if ($amount < 0) {
                $balance = $this->wallet->balance($user);

                if ($balance <= 0) {
                    $failed[] = [
                        'id' => $id,
                        'username' => $user->username,
                        'message' => sprintf('余额为 %d，已扣到 0 或以下，已跳过。', $balance),
                    ];

                    continue;
                }

                $delta = -min(-$amount, $balance);
            }

            try {
                $reference = 'admin:batch:'.$id.':'.uniqid('', true);

                $entry = $delta > 0
                    ? $this->wallet->deposit($user, $delta, 'admin', $description, $reference)
                    : $this->wallet->withdraw($user, -$delta, 'admin', $description, $reference);

                $adjusted[] = [
                    'id' => $id,
                    'username' => $user->username,
                    'balance' => $entry['balance_after'],
                ];
            } catch (InsufficientBalanceException|InvalidArgumentException $exception) {
                $failed[] = [
                    'id' => $id,
                    'username' => $user->username,
                    'message' => $exception->getMessage(),
                ];
            }
        }

        return new JsonResponse([
            'data' => [
                'adjusted' => $adjusted,
                'failed' => $failed,
            ],
        ]);
    }

    public function transactions(Request $request, int $id): JsonResponse
    {
        $user = User::query()->findOrFail($id);

        $limit = max(1, min(200, (int) $request->query('limit', 50)));
        $kind = $request->query('kind');
        $kind = is_string($kind) && $kind !== '' ? $kind : null;

        return new JsonResponse([
            'data' => $this->wallet->history($user, $limit, $kind),
        ]);
    }
}
