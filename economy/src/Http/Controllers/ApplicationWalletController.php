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

/**
 * 第三方站点调用：查余额、增减积分。
 * 建议始终带 reference，重复请求不会重复记账。
 */
class ApplicationWalletController
{
    public function __construct(
        private readonly Wallet $wallet,
        private readonly EconomySettings $settings,
    ) {}

    public function balance(int $id): JsonResponse
    {
        $user = User::query()->findOrFail($id);

        return new JsonResponse([
            'data' => [
                'user_id' => $user->id,
                'balance' => $this->wallet->balance($user),
                'currency' => $this->settings->text('currency_name', '积分'),
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
            'kind' => ['nullable', 'string', 'max:32'],
        ]);

        $amount = (int) $data['amount'];
        $description = (string) ($data['description'] ?? '') ?: '第三方调整';
        $kind = (string) ($data['kind'] ?? '') ?: 'api';
        $reference = (string) ($data['reference'] ?? '') ?: null;

        // 第三方扣减同样最多扣到 0，余额不足的部分不再追。
        if ($amount < 0) {
            $balance = $this->wallet->balance($user);

            if ($balance <= 0) {
                return new JsonResponse([
                    'message' => sprintf('该用户余额为 %d，已经扣到 0 或以下，无需再扣。', $balance),
                ], 422);
            }

            $amount = -min(-$amount, $balance);
        }

        try {
            $entry = $amount > 0
                ? $this->wallet->deposit($user, $amount, $kind, $description, $reference)
                : $this->wallet->withdraw($user, -$amount, $kind, $description, $reference);
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
}
