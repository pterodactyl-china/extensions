<?php

declare(strict_types=1);

namespace AiAssistant\Services;

/**
 * 支持的 AI 提供商清单。
 *
 * 绝大多数走 OpenAI 兼容协议（POST {base}/chat/completions、GET {base}/models），
 * 少数走 Anthropic Messages 或 Gemini 原生协议，用 protocol 区分。
 *
 * url 为空表示必须由用户自己填（自建 / 私有部署 / 按实例分配域名）。
 */
class AiProviders
{
    /**
     * @var array<string, array{label: string, url: string, protocol: string}>
     */
    public const LIST = [
        'openai' => ['label' => 'OpenAI', 'url' => 'https://api.openai.com/v1', 'protocol' => 'openai'],
        'openai_compatible' => ['label' => 'OpenAI Compatible（自填地址）', 'url' => '', 'protocol' => 'openai'],
        'openai_responses' => ['label' => 'OpenAI Responses', 'url' => 'https://api.openai.com/v1', 'protocol' => 'responses'],
        'azure_openai' => ['label' => 'Azure OpenAI', 'url' => '', 'protocol' => 'openai'],
        'deepseek' => ['label' => 'DeepSeek', 'url' => 'https://api.deepseek.com/v1', 'protocol' => 'openai'],
        'qwen' => ['label' => '通义千问（DashScope）', 'url' => 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'protocol' => 'openai'],
        'deepseek_responses' => ['label' => 'DeepSeek Responses', 'url' => 'https://api.deepseek.com/v1', 'protocol' => 'responses'],
        'kimi' => ['label' => 'Kimi（Moonshot）', 'url' => 'https://api.moonshot.cn/v1', 'protocol' => 'openai'],
        'kimi_coding' => ['label' => 'Kimi Coding Plan', 'url' => 'https://api.moonshot.cn/v1', 'protocol' => 'openai'],
        'minimax' => ['label' => 'MiniMax', 'url' => 'https://api.minimax.chat/v1', 'protocol' => 'openai'],
        'minimax_token' => ['label' => 'MiniMax Token Plan', 'url' => 'https://api.minimax.chat/v1', 'protocol' => 'openai'],
        'zhipu' => ['label' => '智谱（Zhipu）', 'url' => 'https://open.bigmodel.cn/api/paas/v4', 'protocol' => 'openai'],
        'xiaomi' => ['label' => '小米（Xiaomi）', 'url' => 'https://api.xiaomi.com/v1', 'protocol' => 'openai'],
        'xiaomi_token' => ['label' => 'Xiaomi Token Plan', 'url' => 'https://api.xiaomi.com/v1', 'protocol' => 'openai'],
        'xai' => ['label' => 'xAI（Grok）', 'url' => 'https://api.x.ai/v1', 'protocol' => 'openai'],
        'longcat' => ['label' => 'LongCat', 'url' => 'https://api.longcat.chat/openai/v1', 'protocol' => 'openai'],
        'openrouter' => ['label' => 'OpenRouter', 'url' => 'https://openrouter.ai/api/v1', 'protocol' => 'openai'],
        'nvidia' => ['label' => 'NVIDIA NIM', 'url' => 'https://integrate.api.nvidia.com/v1', 'protocol' => 'openai'],
        'groq' => ['label' => 'Groq', 'url' => 'https://api.groq.com/openai/v1', 'protocol' => 'openai'],
        'gemini_compatible' => ['label' => 'Gemini Compatible（OpenAI 兼容）', 'url' => 'https://generativelanguage.googleapis.com/v1beta/openai', 'protocol' => 'openai'],
        'gemini_native' => ['label' => 'Gemini（原生协议）', 'url' => 'https://generativelanguage.googleapis.com/v1beta', 'protocol' => 'gemini'],
        'anthropic' => ['label' => 'Anthropic（Claude）', 'url' => 'https://api.anthropic.com/v1', 'protocol' => 'anthropic'],
        'anthropic_compatible' => ['label' => 'Anthropic Compatible（自填地址）', 'url' => '', 'protocol' => 'anthropic'],
        'ollama' => ['label' => 'Ollama（本地）', 'url' => 'http://127.0.0.1:11434/v1', 'protocol' => 'openai'],
        'lmstudio' => ['label' => 'LM Studio（本地）', 'url' => 'http://127.0.0.1:1234/v1', 'protocol' => 'openai'],
        'siliconflow' => ['label' => 'SiliconFlow 硅基流动', 'url' => 'https://api.siliconflow.cn/v1', 'protocol' => 'openai'],
        'ppio' => ['label' => 'PPIO 派欧云', 'url' => 'https://api.ppinfra.com/v3/openai', 'protocol' => 'openai'],
        'tp_302' => ['label' => '302.AI', 'url' => 'https://api.302.ai/v1', 'protocol' => 'openai'],
        'tokenpony' => ['label' => 'TokenPony', 'url' => 'https://api.tokenpony.cn/v1', 'protocol' => 'openai'],
        'compshare' => ['label' => 'Compshare', 'url' => 'https://api.compshare.cn/v1', 'protocol' => 'openai'],
        'modelscope' => ['label' => 'ModelScope 魔搭', 'url' => 'https://api-inference.modelscope.cn/v1', 'protocol' => 'openai'],
        'fastgpt' => ['label' => 'FastGPT（自建）', 'url' => '', 'protocol' => 'openai'],
        'codebuddy' => ['label' => 'CodeBuddy（中国版）', 'url' => 'https://www.codebuddy.cn', 'protocol' => 'codebuddy'],
        'custom' => ['label' => '自定义', 'url' => '', 'protocol' => 'openai'],
    ];

    /** @return list<array{value: string, label: string, url: string}> */
    public static function options(): array
    {
        $options = [];

        foreach (self::LIST as $value => $meta) {
            // 带上默认地址，前端切换提供商时可以直接回填。
            $options[] = ['value' => $value, 'label' => $meta['label'], 'url' => $meta['url']];
        }

        return $options;
    }

    /** @return array{label: string, url: string, protocol: string}|null */
    public static function find(string $provider): ?array
    {
        return self::LIST[$provider] ?? null;
    }

    /** 该提供商的默认地址；为空表示必须手填。 */
    public static function url(string $provider): string
    {
        return self::LIST[$provider]['url'] ?? '';
    }

    public static function protocol(string $provider): string
    {
        return self::LIST[$provider]['protocol'] ?? 'openai';
    }

    public static function exists(string $provider): bool
    {
        return array_key_exists($provider, self::LIST);
    }
}
