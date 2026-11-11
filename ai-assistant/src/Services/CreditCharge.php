<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Pterodactyl\Models\User;
use Throwable;

/**
 * 按 token 消耗扣积分。
 *
 * 只依赖「经济系统」的公共契约（Economy\Contracts\Wallet）；
 * 没装经济系统时降级为不扣费，不影响 AI 功能本身。
 */
class CreditCharge
{
    private const WALLET = 'Economy\Contracts\Wallet';

    public function available(): bool
    {
        return interface_exists(self::WALLET);
    }

    public function balance(User $user): ?int
    {
        if (!interface_exists(self::WALLET)) {
            return null;
        }

        try {
            return (int) app(self::WALLET)->balance($user);
        } catch (Throwable) {
            return null;
        }
    }

    /** tokens → 积分，向上取整，至少 1 分（只要产生了 token）。 */
    public function creditsFor(int $tokens, int $tokensPerCredit): int
    {
        if ($tokens <= 0) {
            return 0;
        }

        $per = max(1, $tokensPerCredit);

        return max(1, (int) ceil($tokens / $per));
    }

    /**
     * 扣费；失败（余额不足等）只记录，不影响已经拿到的回复。
     */
    public function charge(User $user, int $credits, string $description, string $reference): bool
    {
        if ($credits <= 0 || !interface_exists(self::WALLET)) {
            return false;
        }

        try {
            app(self::WALLET)->withdraw($user, $credits, 'ai-assistant', $description, $reference);

            return true;
        } catch (Throwable) {
            // 余额不足或账本异常：不阻断回复，下一次对话会被预检拦住。
            return false;
        }
    }
}
