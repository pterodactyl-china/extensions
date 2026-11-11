<?php

declare(strict_types=1);

namespace Economy\Http\Controllers;

use Economy\Contracts\Wallet;
use Economy\Services\EconomySettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** 用户自己的钱包：余额与流水。 */
class WalletController
{
    public function __construct(
        private readonly Wallet $wallet,
        private readonly EconomySettings $settings,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user === null) {
            return new JsonResponse(['message' => '未登录。'], 401);
        }

        return new JsonResponse([
            'data' => [
                'balance' => $this->wallet->balance($user),
                'currency' => $this->settings->text('currency_name', '积分'),
                'symbol' => $this->settings->text('currency_symbol'),
                'transactions' => $this->wallet->history($user, 20),
            ],
        ]);
    }

    public function transactions(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user === null) {
            return new JsonResponse(['message' => '未登录。'], 401);
        }

        $limit = max(1, min(200, (int) $request->query('limit', 50)));
        $kind = $request->query('kind');
        $kind = is_string($kind) && $kind !== '' ? $kind : null;

        return new JsonResponse([
            'data' => $this->wallet->history($user, $limit, $kind),
        ]);
    }
}
