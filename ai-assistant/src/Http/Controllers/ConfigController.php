<?php

declare(strict_types=1);

namespace AiAssistant\Http\Controllers;

use AiAssistant\Services\AiClient;
use AiAssistant\Services\AiProviders;
use AiAssistant\Services\AiSettings;
use AiAssistant\Services\CreditCharge;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Pterodactyl\Models\Tag;
use RuntimeException;

/**
 * 后台配置页：读取面板已有标签、拉取 AI 模型列表、测试连通性、保存设置。
 *
 * 配置存在面板的 extension_settings 表里，但由本插件的专用页面维护，
 * 面板自带的扩展设置表单不再出现这些项。
 */
class ConfigController
{
    public function __construct(
        private readonly AiSettings $settings,
        private readonly AiClient $ai,
        private readonly CreditCharge $credits,
    ) {}

    public function show(): JsonResponse
    {
        $values = $this->settings->all();

        return new JsonResponse([
            'data' => [
                'enabled' => (bool) $values['enabled'],
                'providers' => AiProviders::options(),
                'provider' => (string) $values['provider'],
                'model' => (string) $values['model'],
                'base_url' => (string) $values['base_url'],
                'has_key' => trim((string) $values['api_key']) !== '',
                'scope' => (string) $values['scope'] === 'tags' ? 'tags' : 'all',
                'tags' => $this->tagsOnly($values['tags']),
                'allow_execute' => (bool) $values['allow_execute'],
                'command_mode' => (string) $values['command_mode'] === 'whitelist' ? 'whitelist' : 'all',
                'allow_files' => (bool) $values['allow_files'],
                'file_allow_dirs' => $this->lines((string) $values['file_allow_dirs']),
                'file_read_dirs' => $this->lines((string) $values['file_read_dirs']),
                'command_allow' => (string) $values['command_allow'],
                'charge_enabled' => (bool) $values['charge_enabled'],
                'tokens_per_credit' => (int) $values['tokens_per_credit'],
                'rate_limit' => (int) $values['rate_limit'],
                'daily_limit' => (int) $values['daily_limit'],
                'daily_token_limit' => (int) $values['daily_token_limit'],
                'max_tokens' => (int) $values['max_tokens'],
                'max_tokens_guest' => (int) $values['max_tokens_guest'],
                'timeout' => (int) $values['timeout'],
                'search_provider' => (string) $values['search_provider'],
                'search_base_url' => (string) $values['search_base_url'],
                'search_fallback' => (bool) $values['search_fallback'],
                'search_credits' => (int) $values['search_credits'],
                'search_has_key' => trim((string) $values['search_api_key']) !== '',
                // 经济系统是否可用：后台据此提示「开了计费但没装扩展」。
                'economy_available' => $this->credits->available(),
                'system_prompt' => (string) $values['system_prompt'],
                'tools_disabled' => (string) $values['tools_disabled'],
                'custom_tools' => (string) $values['custom_tools'],
            ],
        ]);
    }

    /** 面板现有的全部标签（给多选列表用）。 */
    public function tags(): JsonResponse
    {
        return new JsonResponse([
            'data' => Tag::query()
                ->orderBy('slug')
                ->get(['id', 'slug', 'name'])
                ->map(fn (Tag $tag) => [
                    'id' => $tag->id,
                    'slug' => (string) $tag->slug,
                    'name' => (string) $tag->name,
                ])
                ->all(),
        ]);
    }

    public function models(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'string', 'max:32'],
            'base_url' => ['nullable', 'string', 'max:255'],
            'api_key' => ['nullable', 'string', 'max:255'],
        ]);

        $key = trim((string) ($data['api_key'] ?? '')) ?: (string) $this->settings->get('api_key');

        try {
            $models = $this->ai->models(
                (string) $data['provider'],
                $key,
                (string) ($data['base_url'] ?? ''),
            );
        } catch (RuntimeException $exception) {
            // 上游失败用 502，和「参数不合法」的 422 区分开。
            return new JsonResponse(['message' => $exception->getMessage()], 502);
        }

        return new JsonResponse(['data' => ['models' => $models]]);
    }

    /** 自动探测可用地址（CodeBuddy 这类没有固定域名的服务商）。 */
    public function detect(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'string', 'max:32'],
            'api_key' => ['nullable', 'string', 'max:255'],
        ]);

        $key = trim((string) ($data['api_key'] ?? '')) ?: (string) $this->settings->get('api_key');

        if ($key === '') {
            return new JsonResponse(['message' => '请先填写 API Key，再点自动检测。'], 422);
        }

        $result = $this->ai->detect((string) $data['provider'], $key);

        if ($result === null) {
            return new JsonResponse([
                'message' => '没有探测到可用地址：该服务商的 Key 只能在它分配的专属域名上使用，'
                    .'请在控制台复制「模型路由实例」的访问域名，填成 https://<你的域名>/v1。',
            ], 422);
        }

        return new JsonResponse(['data' => $result]);
    }

    public function test(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'string', 'max:32'],
            'base_url' => ['nullable', 'string', 'max:255'],
            'model' => ['nullable', 'string', 'max:191'],
            'api_key' => ['nullable', 'string', 'max:255'],
        ]);

        $key = trim((string) ($data['api_key'] ?? '')) ?: (string) $this->settings->get('api_key');

        try {
            $result = $this->ai->ping(
                (string) $data['provider'],
                $key,
                (string) ($data['base_url'] ?? ''),
                (string) ($data['model'] ?? ''),
            );
        } catch (RuntimeException $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 502);
        }

        return new JsonResponse(['data' => $result]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['nullable', 'string', 'in:deepseek,qwen,openai,codebuddy,custom'],
            'model' => ['nullable', 'string', 'max:191'],
            'base_url' => ['nullable', 'string', 'max:255'],
            'api_key' => ['nullable', 'string', 'max:255'],
            'scope' => ['nullable', 'string', 'in:all,tags'],
            'tags' => ['nullable', 'array', 'max:50'],
            'tags.*' => ['string', 'max:100'],
            'allow_execute' => ['nullable', 'boolean'],
            'allow_files' => ['nullable', 'boolean'],
            'file_allow_dirs' => ['nullable', 'array', 'max:20'],
            'file_allow_dirs.*' => ['string', 'max:191'],
            'file_read_dirs' => ['nullable', 'array', 'max:20'],
            'file_read_dirs.*' => ['string', 'max:191'],
            'command_mode' => ['nullable', 'string', 'in:all,whitelist'],
            'command_allow' => ['nullable', 'string', 'max:5000'],
            'charge_enabled' => ['nullable', 'boolean'],
            'tokens_per_credit' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'rate_limit' => ['nullable', 'integer', 'min:0', 'max:120'],
            'daily_limit' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'daily_token_limit' => ['nullable', 'integer', 'min:0', 'max:100000000'],
            'max_tokens' => ['nullable', 'integer', 'min:0', 'max:8192'],
            'max_tokens_guest' => ['nullable', 'integer', 'min:0', 'max:8192'],
            'timeout' => ['nullable', 'integer', 'min:5', 'max:120'],
            'enabled' => ['nullable', 'boolean'],
            'search_provider' => ['nullable', 'string', 'in:,tavily,serper,deepseek,custom'],
            'search_api_key' => ['nullable', 'string', 'max:255'],
            'search_base_url' => ['nullable', 'string', 'max:255'],
            'search_fallback' => ['nullable', 'boolean'],
            'search_credits' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'system_prompt' => ['nullable', 'string', 'max:5000'],
            'tools_disabled' => ['nullable', 'string', 'max:500'],
            'custom_tools' => ['nullable', 'string', 'max:5000'],
        ]);

        $payload = [];

        foreach (['provider', 'model', 'base_url', 'scope', 'command_allow', 'command_mode', 'search_provider', 'search_base_url', 'system_prompt', 'tools_disabled', 'custom_tools'] as $key) {
            if (array_key_exists($key, $data) && $data[$key] !== null) {
                $payload[$key] = (string) $data[$key];
            }
        }

        foreach (['tokens_per_credit', 'rate_limit', 'daily_limit', 'daily_token_limit', 'max_tokens', 'max_tokens_guest', 'timeout', 'search_credits'] as $key) {
            if (array_key_exists($key, $data) && $data[$key] !== null) {
                $payload[$key] = (int) $data[$key];
            }
        }

        foreach (['allow_execute', 'allow_files', 'charge_enabled', 'enabled', 'search_fallback'] as $key) {
            if (array_key_exists($key, $data) && $data[$key] !== null) {
                $payload[$key] = (bool) $data[$key];
            }
        }

        if (array_key_exists('tags', $data) && $data['tags'] !== null) {
            $payload['tags'] = array_values(array_unique(array_map(
                static fn ($tag): string => mb_strtolower(trim((string) $tag)),
                $data['tags'],
            )));
        }

        if (array_key_exists('file_allow_dirs', $data) && $data['file_allow_dirs'] !== null) {
            $payload['file_allow_dirs'] = implode("\n", $data['file_allow_dirs']);
        }

        if (array_key_exists('file_read_dirs', $data) && $data['file_read_dirs'] !== null) {
            $payload['file_read_dirs'] = implode("\n", $data['file_read_dirs']);
        }

        if (trim((string) ($data['api_key'] ?? '')) !== '') {
            $payload['api_key'] = trim((string) $data['api_key']);
        }

        if (trim((string) ($data['search_api_key'] ?? '')) !== '') {
            $payload['search_api_key'] = trim((string) $data['search_api_key']);
        }

        $this->settings->save($payload);

        return new JsonResponse(['data' => ['saved' => array_keys($payload)]]);
    }

    /** @return list<string> */
    private function lines(string $value): array
    {
        return array_values(array_filter(
            array_map(static fn (string $line): string => trim($line), preg_split('/\R/', $value) ?: []),
            static fn (string $line): bool => $line !== '',
        ));
    }

    /** @return list<string> */
    private function tagsOnly(mixed $raw): array
    {
        $items = is_array($raw) ? $raw : [];

        return array_values(array_filter(
            array_map(static fn ($value): string => mb_strtolower(trim((string) $value)), $items),
            static fn (string $value): bool => $value !== '',
        ));
    }
}
