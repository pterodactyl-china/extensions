<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * 统一封装各家 AI 接口。
 *
 * 两种协议：
 * - openai：DeepSeek / 通义千问 / OpenAI / 自定义，走 POST {base}/chat/completions，非流式
 * - codebuddy：中国版 CodeBuddy（www.codebuddy.cn），走 POST /v2/chat/completions，
 *   必须带 CLI 指纹头，且**只能流式**（stream:false 会被上游拒绝），这里读完整 SSE 再聚合
 */
class AiClient
{
    /**
     * 默认端点。
     *
     * CodeBuddy 的 ck_ Key 只在中国版域名有效，海外站会直接 401；
     * 它的聊天路径是 /v2/chat/completions，不是 /v1/chat/completions。
     */
    private const DEFAULTS = [
        'deepseek' => ['url' => 'https://api.deepseek.com/v1', 'model' => 'deepseek-chat'],
        'qwen' => ['url' => 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'model' => 'qwen-plus'],
        'openai' => ['url' => 'https://api.openai.com/v1', 'model' => 'gpt-4o-mini'],
        'codebuddy' => ['url' => 'https://www.codebuddy.cn', 'model' => 'hy3'],
        'custom' => ['url' => '', 'model' => ''],
    ];

    /** 自动探测用的候选地址（仅 OpenAI 兼容的服务商需要）。 */
    private const CANDIDATES = [
        'custom' => [],
    ];

    /**
     * CodeBuddy 没有服务端的 /models 目录（/v2/models 返回 404），
     * 模型清单来自 CLI 的产品配置，这里取常用的子集。
     */
    private const CODEBUDDY_MODELS = [
        'hy3',
        'hy3-preview-agent',
        'auto',
        'glm-5.1',
        'glm-5.0',
        'glm-5v-turbo',
        'glm-4.7',
        'glm-4.6v',
        'deepseek-v4-pro',
        'deepseek-v4-flash',
        'deepseek-v3.1',
        'kimi-k2.6',
        'minimax-m2.7',
        'hunyuan-2.0-instruct',
        'hunyuan-chat',
    ];

    /** CodeBuddy 要求带上 CLI 指纹头，否则会被判成非法客户端。 */
    private const CODEBUDDY_HEADERS = [
        'Content-Type' => 'application/json',
        'Accept' => 'text/event-stream',
        'X-Requested-With' => 'XMLHttpRequest',
        'x-codebuddy-request' => '1',
        'X-Product' => 'SaaS',
        'X-IDE-Type' => 'CLI',
        'X-IDE-Name' => 'CLI',
        'X-IDE-Version' => '2.118.2',
        'X-Agent-Intent' => 'craft',
        'X-Agent-Purpose' => 'conversation',
        'User-Agent' => 'CLI/2.118.2 CodeBuddy/2.118.2',
    ];

    public function isCodeBuddy(string $provider): bool
    {
        return $provider === 'codebuddy';
    }

    /** @return list<array{value: string, label: string}> 可选提供商 */
    public function providers(): array
    {
        return AiProviders::options();
    }

    public function protocol(string $provider): string
    {
        return $this->isCodeBuddy($provider) ? 'codebuddy' : AiProviders::protocol($provider);
    }

    /** 提供商的 API 根地址（不含具体端点）。 */
    public function baseUrl(string $provider, string $baseUrl): string
    {
        $base = rtrim(trim($baseUrl), '/');

        if ($base === '') {
            $base = AiProviders::url($provider);
        }

        if ($base === '' && isset(self::DEFAULTS[$provider])) {
            $base = self::DEFAULTS[$provider]['url'];
        }

        if ($base === '') {
            throw new RuntimeException('这家提供商需要填写接口地址（形如 https://xxx/v1）。');
        }

        foreach (['/chat/completions', '/messages'] as $suffix) {
            if (str_ends_with($base, $suffix)) {
                return substr($base, 0, -strlen($suffix));
            }
        }

        return $base;
    }

    public function endpoint(string $provider, string $baseUrl, string $model = ''): string
    {
        return match ($this->protocol($provider)) {
            'codebuddy' => $this->baseUrl($provider, $baseUrl).'/v2/chat/completions',
            'anthropic' => $this->baseUrl($provider, $baseUrl).'/messages',
            'gemini' => $this->baseUrl($provider, $baseUrl).'/models/'.$model.':generateContent',
            default => $this->baseUrl($provider, $baseUrl).'/chat/completions',
        };
    }

    /**
     * 组装请求体：max_tokens <= 0 表示不限，此时不传该字段，由上游用默认上限。
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function withBudget(array $payload, int $maxTokens): array
    {
        if ($maxTokens > 0) {
            $payload['max_tokens'] = max(16, $maxTokens);
        }

        return $payload;
    }

    public function model(string $provider, string $model): string
    {
        $model = trim($model);

        if ($model !== '') {
            return $model;
        }

        return self::DEFAULTS[$provider]['model'] ?? '';
    }

    /**
     * 拉取模型列表。
     *
     * CodeBuddy 没有服务端目录，直接返回内置清单。
     *
     * @return list<string>
     *
     * @throws RuntimeException
     */
    public function models(string $provider, string $apiKey, string $baseUrl): array
    {
        if ($this->isCodeBuddy($provider)) {
            return self::CODEBUDDY_MODELS;
        }

        if (trim($apiKey) === '') {
            throw new RuntimeException('还没有配置 API Key。');
        }

        $protocol = $this->protocol($provider);
        $base = $this->baseUrl($provider, $baseUrl);

        if ($protocol === 'anthropic') {
            $response = Http::withHeaders([
                'x-api-key' => $apiKey,
                'anthropic-version' => '2023-06-01',
            ])->acceptJson()->timeout(20)->get($base.'/models');
            $items = (array) $response->json('data', []);
        } elseif ($protocol === 'gemini') {
            $response = Http::acceptJson()->timeout(20)->get($base.'/models', ['key' => $apiKey]);
            $items = (array) $response->json('models', []);
        } else {
            $response = Http::withToken($apiKey)->acceptJson()->timeout(20)->get($base.'/models');
            $items = (array) $response->json('data', []);
        }

        if ($response->failed()) {
            $detail = $response->json('error.message') ?? $response->body();

            throw new RuntimeException(sprintf(
                '获取模型列表失败（%d）：%s%s',
                $response->status(),
                mb_substr((string) $detail, 0, 200),
                $response->status() === 404 ? '（该服务商不提供 /models，请手动填写模型 ID）' : '',
            ));
        }

        $models = [];

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            // Gemini 返回 name: "models/gemini-2.5-flash"，去掉前缀才是模型 ID。
            $id = (string) ($item['id'] ?? $item['name'] ?? '');

            if ($protocol === 'gemini') {
                $id = str_replace('models/', '', $id);
            }

            if ($id !== '') {
                $models[] = $id;
            }
        }

        sort($models);

        return $models;
    }

    /**
     * 自动探测可用地址。
     *
     * CodeBuddy 的地址是固定的（中国版），不必探测，直接返回内置清单。
     *
     * @return array{base_url: string, models: list<string>}|null
     */
    public function detect(string $provider, string $apiKey): ?array
    {
        if ($this->isCodeBuddy($provider)) {
            return ['base_url' => self::DEFAULTS['codebuddy']['url'], 'models' => self::CODEBUDDY_MODELS];
        }

        $candidates = self::CANDIDATES[$provider] ?? [];

        if (trim($apiKey) === '' || $candidates === []) {
            return null;
        }

        foreach ($candidates as $base) {
            $response = Http::withToken($apiKey)->acceptJson()->timeout(8)->get($base.'/models');

            if ($response->successful()) {
                $models = [];

                foreach ((array) $response->json('data', []) as $item) {
                    $id = is_array($item) ? (string) ($item['id'] ?? '') : '';

                    if ($id !== '') {
                        $models[] = $id;
                    }
                }

                sort($models);

                return ['base_url' => $base, 'models' => $models];
            }

            if (in_array($response->status(), [401, 403], true)) {
                return ['base_url' => $base, 'models' => []];
            }
        }

        return null;
    }

    /**
     * 测试连接：发一条最小请求，返回耗时与回复片段。
     *
     * @return array{model: string, ms: int, reply: string, usage: array<string, int>}
     *
     * @throws RuntimeException
     */
    public function ping(string $provider, string $apiKey, string $baseUrl, string $model): array
    {
        $started = microtime(true);

        // CodeBuddy 的 hy3 是推理模型，预算太小会被 reasoning 吃光（content 为空），
        // 这里至少给 128，保证能看到实际回复。
        $result = $this->chat(
            $provider,
            $apiKey,
            $baseUrl,
            $model,
            [['role' => 'user', 'content' => 'ping，只回复 pong']],
            128,
            25,
        );

        return [
            'model' => $this->model($provider, $model),
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'reply' => mb_substr(trim($result['content']), 0, 80),
            'usage' => $result['usage'],
        ];
    }

    /**
     * @param  list<array{role: string, content: string}>  $messages
     * @return array{content: string, usage: array{prompt_tokens: int, completion_tokens: int, total_tokens: int}}
     *
     * @throws RuntimeException
     */
    public function chat(
        string $provider,
        string $apiKey,
        string $baseUrl,
        string $model,
        array $messages,
        int $maxTokens,
        int $timeout,
    ): array {
        if (trim($apiKey) === '') {
            throw new RuntimeException('还没有配置 API Key，请联系管理员。');
        }

        $resolvedModel = $this->model($provider, $model);

        if ($resolvedModel === '') {
            throw new RuntimeException('还没有填写模型名，请先点「获取模型」或按服务商文档手动填写。');
        }

        return match ($this->protocol($provider)) {
            'codebuddy' => $this->chatCodeBuddy($apiKey, $baseUrl, $resolvedModel, $messages, $maxTokens, $timeout),
            'anthropic' => $this->chatAnthropic($apiKey, $baseUrl, $resolvedModel, $messages, $maxTokens, $timeout),
            'gemini' => $this->chatGemini($apiKey, $baseUrl, $resolvedModel, $messages, $maxTokens, $timeout),
            default => $this->chatOpenAi($provider, $apiKey, $baseUrl, $resolvedModel, $messages, $maxTokens, $timeout),
        };
    }

    /**
     * 带工具的一轮对话（仅 OpenAI 兼容协议支持 function calling）。
     *
     * @param  list<array<string, mixed>>  $messages
     * @param  list<array<string, mixed>>  $tools
     * @return array{content: string, tool_calls: list<array{id: string, name: string, arguments: string}>, usage: array{prompt_tokens: int, completion_tokens: int, total_tokens: int}}
     *
     * @throws RuntimeException
     */
    public function chatWithTools(
        string $provider,
        string $apiKey,
        string $baseUrl,
        string $model,
        array $messages,
        int $maxTokens,
        int $timeout,
        array $tools,
    ): array {
        if ($this->protocol($provider) !== 'openai') {
            // 其它协议暂不支持工具调用，退化为普通一问一答。
            $plain = $this->chat($provider, $apiKey, $baseUrl, $model, $messages, $maxTokens, $timeout);

            return ['content' => $plain['content'], 'tool_calls' => [], 'usage' => $plain['usage']];
        }

        $resolved = $this->model($provider, $model);

        $response = Http::withToken($apiKey)
            ->acceptJson()
            ->timeout(max(10, $timeout))
            ->post($this->endpoint($provider, $baseUrl), $this->withBudget([
                'model' => $resolved,
                'messages' => $messages,
                'temperature' => 0.3,
                'stream' => false,
                'tools' => $tools,
                'tool_choice' => 'auto',
            ], $maxTokens));

        if ($response->failed()) {
            throw new RuntimeException($this->describeFailure($response->status(), (string) ($response->json('error.message') ?? $response->body())));
        }

        $calls = [];

        foreach ((array) $response->json('choices.0.message.tool_calls', []) as $call) {
            if (!is_array($call)) {
                continue;
            }

            $calls[] = [
                'id' => (string) ($call['id'] ?? ''),
                'name' => (string) ($call['function']['name'] ?? ''),
                'arguments' => (string) ($call['function']['arguments'] ?? '{}'),
            ];
        }

        return [
            'content' => (string) ($response->json('choices.0.message.content') ?? ''),
            'tool_calls' => $calls,
            'usage' => $this->usage(
                (int) ($response->json('usage.prompt_tokens') ?? 0),
                (int) ($response->json('usage.completion_tokens') ?? 0),
                (int) ($response->json('usage.total_tokens') ?? 0),
            ),
        ];
    }

    /**
     * Anthropic Messages：system 单独一个字段，响应是 content 数组。
     *
     * @param  list<array{role: string, content: string}>  $messages
     * @return array{content: string, usage: array{prompt_tokens: int, completion_tokens: int, total_tokens: int}}
     */
    private function chatAnthropic(
        string $apiKey,
        string $baseUrl,
        string $model,
        array $messages,
        int $maxTokens,
        int $timeout,
    ): array {
        $system = '';
        $turns = [];

        foreach ($messages as $message) {
            if (($message['role'] ?? '') === 'system') {
                $system .= (string) $message['content'];

                continue;
            }

            $turns[] = [
                'role' => ($message['role'] ?? '') === 'assistant' ? 'assistant' : 'user',
                'content' => (string) $message['content'],
            ];
        }

        $payload = [
            'model' => $model,
            // Anthropic 的 max_tokens 是必填：0（不限）时给一个足够大的值。
            'max_tokens' => $maxTokens > 0 ? max(64, $maxTokens) : 8192,
            'messages' => $turns,
        ];

        if ($system !== '') {
            $payload['system'] = $system;
        }

        $response = Http::withHeaders([
            'x-api-key' => $apiKey,
            'anthropic-version' => '2023-06-01',
        ])->acceptJson()->timeout(max(10, $timeout))->post($this->endpoint('anthropic', $baseUrl), $payload);

        if ($response->failed()) {
            $detail = $response->json('error.message') ?? $response->body();

            throw new RuntimeException(sprintf(
                'AI 接口返回 %d：%s%s',
                $response->status(),
                mb_substr((string) $detail, 0, 300),
                $response->status() === 401 ? '（Key 无效，或该 Key 不是 Anthropic 格式）' : '',
            ));
        }

        $content = '';

        foreach ((array) $response->json('content', []) as $block) {
            if (is_array($block) && ($block['type'] ?? '') === 'text') {
                $content .= (string) ($block['text'] ?? '');
            }
        }

        if (trim($content) === '') {
            throw new RuntimeException('AI 没有返回内容，请稍后再试。');
        }

        return [
            'content' => $content,
            'usage' => $this->usage(
                (int) ($response->json('usage.input_tokens') ?? 0),
                (int) ($response->json('usage.output_tokens') ?? 0),
                0,
            ),
        ];
    }

    /**
     * Gemini 原生：contents + systemInstruction。
     *
     * @param  list<array{role: string, content: string}>  $messages
     * @return array{content: string, usage: array{prompt_tokens: int, completion_tokens: int, total_tokens: int}}
     */
    private function chatGemini(
        string $apiKey,
        string $baseUrl,
        string $model,
        array $messages,
        int $maxTokens,
        int $timeout,
    ): array {
        $system = '';
        $contents = [];

        foreach ($messages as $message) {
            if (($message['role'] ?? '') === 'system') {
                $system .= (string) $message['content'];

                continue;
            }

            $contents[] = [
                'role' => ($message['role'] ?? '') === 'assistant' ? 'model' : 'user',
                'parts' => [['text' => (string) $message['content']]],
            ];
        }

        $payload = [
            'contents' => $contents,
            // 0（不限）时不传 maxOutputTokens，由模型用默认上限。
            'generationConfig' => $maxTokens > 0
                ? ['maxOutputTokens' => max(64, $maxTokens), 'temperature' => 0.3]
                : ['temperature' => 0.3],
        ];

        if ($system !== '') {
            $payload['systemInstruction'] = ['parts' => [['text' => $system]]];
        }

        $response = Http::acceptJson()
            ->timeout(max(10, $timeout))
            ->post($this->endpoint('gemini', $baseUrl, $model), $payload + ['key' => $apiKey]);

        // Gemini 更喜欢 key 放 query，重试一次更稳。
        if ($response->failed() && in_array($response->status(), [400, 401, 403], true)) {
            $response = Http::acceptJson()
                ->timeout(max(10, $timeout))
                ->post($this->endpoint('gemini', $baseUrl, $model).'?key='.urlencode($apiKey), $payload);
        }

        if ($response->failed()) {
            $detail = $response->json('error.message') ?? $response->body();

            throw new RuntimeException(sprintf(
                'AI 接口返回 %d：%s',
                $response->status(),
                mb_substr((string) $detail, 0, 300),
            ));
        }

        $content = '';

        foreach ((array) $response->json('candidates.0.content.parts', []) as $part) {
            if (is_array($part) && is_string($part['text'] ?? null)) {
                $content .= $part['text'];
            }
        }

        if (trim($content) === '') {
            throw new RuntimeException('AI 没有返回内容，请检查模型名是否正确。');
        }

        return [
            'content' => $content,
            'usage' => $this->usage(
                (int) ($response->json('usageMetadata.promptTokenCount') ?? 0),
                (int) ($response->json('usageMetadata.candidatesTokenCount') ?? 0),
                (int) ($response->json('usageMetadata.totalTokenCount') ?? 0),
            ),
        ];
    }

    /**
     * @param  list<array{role: string, content: string}>  $messages
     * @return array{content: string, usage: array{prompt_tokens: int, completion_tokens: int, total_tokens: int}}
     */
    private function chatOpenAi(
        string $provider,
        string $apiKey,
        string $baseUrl,
        string $model,
        array $messages,
        int $maxTokens,
        int $timeout,
    ): array {
        $response = Http::withToken($apiKey)
            ->acceptJson()
            ->timeout(max(5, $timeout))
            ->post($this->endpoint($provider, $baseUrl), $this->withBudget([
                'model' => $model,
                'messages' => $messages,
                'temperature' => 0.3,
                'stream' => false,
            ], $maxTokens));

        if ($response->failed()) {
            throw new RuntimeException($this->describeFailure($response->status(), (string) ($response->json('error.message') ?? $response->body())));
        }

        $content = $response->json('choices.0.message.content');

        if (!is_string($content) || trim($content) === '') {
            throw new RuntimeException('AI 没有返回内容，请稍后再试。');
        }

        return [
            'content' => $content,
            'usage' => $this->usage(
                (int) ($response->json('usage.prompt_tokens') ?? 0),
                (int) ($response->json('usage.completion_tokens') ?? 0),
                (int) ($response->json('usage.total_tokens') ?? 0),
            ),
        ];
    }

    /**
     * CodeBuddy 只能流式，这里把 SSE 读完整再拼成一次回复。
     *
     * @param  list<array{role: string, content: string}>  $messages
     * @return array{content: string, usage: array{prompt_tokens: int, completion_tokens: int, total_tokens: int}}
     */
    private function chatCodeBuddy(
        string $apiKey,
        string $baseUrl,
        string $model,
        array $messages,
        int $maxTokens,
        int $timeout,
    ): array {
        $response = Http::withHeaders(['Authorization' => 'Bearer '.$apiKey, 'X-API-Key' => $apiKey] + self::CODEBUDDY_HEADERS)
            ->timeout(max(10, $timeout))
            ->post($this->endpoint('codebuddy', $baseUrl), [
                'model' => $model,
                'messages' => $messages,
                // hy3 是推理模型：0（不限）时给 4096，避免思考过程吃光预算后正文为空。
                'max_tokens' => $maxTokens > 0 ? max(128, $maxTokens) : 4096,
                'stream' => true,
            ]);

        if ($response->failed()) {
            throw new RuntimeException($this->describeFailure($response->status(), $response->body()));
        }

        $content = '';
        $reasoning = '';
        $prompt = 0;
        $completion = 0;
        $total = 0;

        foreach (preg_split('/\R/', $response->body()) ?: [] as $line) {
            $line = trim($line);

            if (!str_starts_with($line, 'data:')) {
                continue;
            }

            $payload = trim(substr($line, 5));

            if ($payload === '' || $payload === '[DONE]') {
                continue;
            }

            $chunk = json_decode($payload, true);

            if (!is_array($chunk)) {
                continue;
            }

            $delta = $chunk['choices'][0]['delta'] ?? null;

            if (is_array($delta)) {
                if (is_string($delta['content'] ?? null)) {
                    $content .= $delta['content'];
                }

                if (is_string($delta['reasoning_content'] ?? null)) {
                    $reasoning .= $delta['reasoning_content'];
                }
            }

            if (isset($chunk['usage']) && is_array($chunk['usage'])) {
                $prompt = (int) ($chunk['usage']['prompt_tokens'] ?? $prompt);
                $completion = (int) ($chunk['usage']['completion_tokens'] ?? $completion);
                $total = (int) ($chunk['usage']['total_tokens'] ?? $total);
            }
        }

        // hy3 这类推理模型的思考过程放在 reasoning_content；
        // 若正文为空（预算被思考吃光），用思考内容兜底，避免前端只看到“没有返回内容”。
        if (trim($content) === '') {
            $content = trim($reasoning);
        }

        if (trim($content) === '') {
            throw new RuntimeException('CodeBuddy 没有返回内容，请检查模型名是否正确（默认 hy3）。');
        }

        return ['content' => $content, 'usage' => $this->usage($prompt, $completion, $total)];
    }

    /** @return array{prompt_tokens: int, completion_tokens: int, total_tokens: int} */
    private function usage(int $prompt, int $completion, int $total): array
    {
        return [
            'prompt_tokens' => $prompt,
            'completion_tokens' => $completion,
            'total_tokens' => $total > 0 ? $total : $prompt + $completion,
        ];
    }

    private function describeFailure(int $status, string $body): string
    {
        $hint = match ($status) {
            404 => '（该地址下没有这个接口，请确认服务商与地址是否匹配）',
            401 => '（Key 无效，或 Key 与站点不匹配：ck_ 开头的 Key 只能用于中国版 www.codebuddy.cn）',
            422 => '（请求体被拒绝，通常是模型名不存在或服务商要求别的字段）',
            429 => '（触发限流，请稍后再试）',
            default => '',
        };

        return sprintf('AI 接口返回 %d：%s%s', $status, mb_substr($body, 0, 300), $hint);
    }
}
