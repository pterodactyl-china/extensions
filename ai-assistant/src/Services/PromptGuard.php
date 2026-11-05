<?php

declare(strict_types=1);

namespace AiAssistant\Services;

/**
 * 提示注入 / 越狱检测。
 *
 * 分两级：
 * - blocked：伪造对话标签、零宽字符这类正常用户不会输入的内容，直接拒绝
 * - suspect：要求覆盖指令、替换人格、取消安全约束等，不拦截但会在系统提示里降权
 *
 * 设计原则：宁可放过可疑措辞，也不能误伤正常排障提问（"忽略这条警告"这种说法要能通过）。
 */
class PromptGuard
{
    /**
     * 直接拒绝：普通玩家不会打出这些字符/标签。
     *
     * @var array<string, string>
     */
    private const BLOCKED = [
        '/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/i' => '伪造的对话控制标记',
        '/<\|?\s*(system|assistant|developer)\s*\|?>/i' => '伪造的系统角色标签',
        '/<\s*project_instructions\s*>|<\s*user_style\s*>/i' => '伪造的指令块',
        '/^\s*\[\s*(system|sys)\s*\]/im' => '伪造的系统前缀',
        '/^\s*###\s*(system|指令)/im' => '伪造的系统前缀',
        '/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u' => '零宽或双向控制字符',
    ];

    /**
     * 仅标记：可能是正常讨论，也可能是指令覆盖，交给系统提示降权。
     *
     * @var array<string, string>
     */
    private const SUSPECT = [
        '/ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i' => '要求忽略之前的指令',
        '/disregard\s+(all\s+)?(previous|prior|your)/i' => '要求忽略之前的指令',
        '/忽略(之前|以上|先前|所有)的?(指令|提示|规则|设定)/u' => '要求忽略之前的指令',
        '/must\s+supersede|outrank\s+everything|override\s+(your|the)\s+(rules|instructions|system)/i' => '宣称优先级高于系统规则',
        '/you\s+are\s+now\s+|from\s+now\s+on,?\s+you\s+are/i' => '要求替换人格',
        '/你现在是|从现在开始你是|你的新身份/u' => '要求替换人格',
        '/jailbreak|dan\s+mode|developer\s+mode|unrestricted\s+(sandbox|mode)/i' => '越狱关键词',
        '/never\s+refuse|do\s+not\s+refuse|no\s+disclaimers?|no\s+refusals?/i' => '要求取消安全约束',
        '/禁止拒绝|不能拒绝|不要拒绝|不许拒绝|不要免责声明/u' => '要求取消安全约束',
        '/ratman4080|little\s+code\s+sauce|kovak/i' => '已知越狱人格标记',
        '/system\s*prompt|系统提示词|你的(初始)?设定/u' => '索要系统提示',
    ];

    /**
     * @return array{level: 'ok'|'suspect'|'blocked', reasons: list<string>}
     */
    public function inspect(string $text): array
    {
        if (trim($text) === '') {
            return ['level' => 'ok', 'reasons' => []];
        }

        // 去掉不可见字符后再匹配一次，避免被零宽字符拆开的关键词绕过。
        $normalized = $this->normalize($text);

        foreach (self::BLOCKED as $pattern => $reason) {
            if (preg_match($pattern, $text) === 1 || preg_match($pattern, $normalized) === 1) {
                return ['level' => 'blocked', 'reasons' => [$reason]];
            }
        }

        $reasons = [];

        foreach (self::SUSPECT as $pattern => $reason) {
            if (preg_match($pattern, $normalized) === 1) {
                $reasons[] = $reason;
            }
        }

        return [
            'level' => $reasons === [] ? 'ok' : 'suspect',
            'reasons' => array_values(array_unique($reasons)),
        ];
    }

    /**
     * 输出侧：防止模型把系统提示、密钥、内部路径回显出来。
     */
    public function sanitizeReply(string $reply): string
    {
        $leaks = [
            '硬性规则：',
            '工作流程（必须遵守）',
            '以下是文件管理器里读到的服务器文件',
            'user_input 包裹',
            '系统提示词（可选）',
        ];

        foreach ($leaks as $marker) {
            if (str_contains($reply, $marker)) {
                return '（这次回复包含了不应展示的内部说明，已拦截。请换一种问法，或描述具体报错。）';
            }
        }

        // 常见的密钥形态：不要把 Key 回显给前端。
        if (preg_match('/\b(sk|ck)_[A-Za-z0-9._-]{16,}/', $reply) === 1) {
            return '（回复中包含疑似密钥的内容，已拦截。请不要在对话里粘贴 Key。）';
        }

        return $reply;
    }

    /** 归一化：去掉零宽字符、全角转半角、压缩空白，便于关键词匹配。 */
    private function normalize(string $text): string
    {
        $text = preg_replace('/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $text) ?? $text;
        $text = mb_convert_kana($text, 'as', 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return mb_strtolower($text);
    }
}
