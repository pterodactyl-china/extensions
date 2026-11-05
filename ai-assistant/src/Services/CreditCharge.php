<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Pterodactyl\Models\User;
use Throwable;

/**
 * 按 token 消耗扣积分。
 *
 * 依赖「计费与积分」扩展（Billing & Credits）的账本；
 * 没装该扩展时自动降级为不扣费，不影响 AI 功能本身。
 */
class CreditCharge
{
    /** 扣费依赖的账本类，存在即表示计费扩展已启用。 */
    private const LEDGER = 'Billing\Services\CreditLedger';

    private const TRANSACTION = 'Billing\Models\Transaction';

    public function available(): bool
    {
        return class_exists(self::LEDGER) && class_exists(self::TRANSACTION);
    }

    public function balance(User $user): ?int
    {
        if (!$this->available()) {
            return null;
        }

        try {
            return (int) app(self::LEDGER)->balance($user);
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
        if ($credits <= 0 || !$this->available()) {
            return false;
        }

        try {
            app(self::LEDGER)->apply($user, -$credits, 'api', $description, $reference);

            return true;
        } catch (Throwable) {
            // 余额在并发下被别处扣光时可能失败：不阻断回复，下一次对话会被预检拦住。
            return false;
        }
    }
}
