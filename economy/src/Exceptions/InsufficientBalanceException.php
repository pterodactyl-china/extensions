<?php

declare(strict_types=1);

namespace Economy\Exceptions;

use RuntimeException;

/** 余额不足。调用方通常捕获它并返回 402 / 提示文案。 */
class InsufficientBalanceException extends RuntimeException
{
    public function __construct(
        public readonly int $balance = 0,
        public readonly int $required = 0,
    ) {
        parent::__construct(sprintf('余额不足：当前 %d，需要 %d。', $balance, $required));
    }
}
