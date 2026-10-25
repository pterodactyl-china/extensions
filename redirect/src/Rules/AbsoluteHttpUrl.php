<?php

namespace Redirect\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Accepts only absolute http(s) URLs with a real host. Rejects other schemes
 * (javascript:, data:, ...), protocol-relative and backslash tricks, embedded
 * credentials, and any whitespace or control characters (header injection).
 */
class AbsoluteHttpUrl implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! self::isValid($value)) {
            $fail(':attribute 必须是完整的 http 或 https 网址。');
        }
    }

    public static function isValid(string $url): bool
    {
        if (strlen($url) > 2048 || preg_match('/[\x00-\x20\x7f\\\\]/', $url) === 1) {
            return false;
        }

        // Scheme must be http/https followed by "//" and a non-empty authority.
        if (preg_match('~^https?://[^/?#]~i', $url) !== 1) {
            return false;
        }

        $parts = parse_url($url);
        if ($parts === false || ! isset($parts['host']) || $parts['host'] === '') {
            return false;
        }

        return ! isset($parts['user']) && ! isset($parts['pass']);
    }
}
