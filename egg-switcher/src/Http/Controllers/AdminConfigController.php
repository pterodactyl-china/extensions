<?php

declare(strict_types=1);

namespace EggSwitcher\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Pterodactyl\Models\Tag;
use Pterodactyl\Services\Extensions\ExtensionSettings;

/**
 * 后台配置：2.0 用标签组织预设，所以这里只维护「允许的标签」与变量保留策略。
 */
class AdminConfigController
{
    private const ID = 'egg-switcher';

    public function show(): JsonResponse
    {
        $settings = new ExtensionSettings(self::ID);

        return new JsonResponse([
            'data' => [
                'keep_variables' => (bool) $settings->get('keep_variables', true),
                'allow_tag_switch' => (bool) $settings->get('allow_tag_switch', false),
                'tags' => $this->lines((string) $settings->get('target_tags', '')),
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'keep_variables' => ['nullable', 'boolean'],
            'allow_tag_switch' => ['nullable', 'boolean'],
            'tags' => ['nullable', 'array', 'max:200'],
            'tags.*' => ['string', 'max:191'],
        ]);

        $payload = [];

        if (array_key_exists('keep_variables', $data) && $data['keep_variables'] !== null) {
            $payload['keep_variables'] = (bool) $data['keep_variables'];
        }

        if (array_key_exists('allow_tag_switch', $data) && $data['allow_tag_switch'] !== null) {
            $payload['allow_tag_switch'] = (bool) $data['allow_tag_switch'];
        }

        if (array_key_exists('tags', $data) && $data['tags'] !== null) {
            $tags = array_values(array_unique(array_filter(
                array_map(static fn ($value): string => mb_strtolower(trim((string) $value)), $data['tags']),
                static fn (string $value): bool => $value !== '',
            )));

            $payload['target_tags'] = implode("\n", $tags);
        }

        if ($payload !== []) {
            (new ExtensionSettings(self::ID))->setMany($payload);
        }

        return new JsonResponse(['data' => ['saved' => true]]);
    }

    /** 面板现有的全部标签，供多选使用。 */
    public function tags(): JsonResponse
    {
        return new JsonResponse([
            'data' => Tag::query()
                ->orderBy('slug')
                ->get(['id', 'slug', 'name'])
                ->map(fn (Tag $tag): array => [
                    'id' => $tag->id,
                    'slug' => (string) $tag->slug,
                    'name' => (string) $tag->name,
                ])
                ->all(),
        ]);
    }

    /** @return list<string> */
    private function lines(string $raw): array
    {
        return array_values(array_filter(
            array_map(static fn (string $line): string => trim($line), preg_split('/\R/', $raw) ?: []),
            static fn (string $line): bool => $line !== '',
        ));
    }
}
