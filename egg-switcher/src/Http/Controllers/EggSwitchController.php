<?php

declare(strict_types=1);

namespace EggSwitcher\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Pterodactyl\Contracts\Servers\ChangesServerEgg;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Egg;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Tag;
use Pterodactyl\Services\Extensions\ExtensionSettings;
use Throwable;

/**
 * 预设切换接口。
 *
 * 2.0 用「标签」取代了 Nest 分组，所以可选范围完全由标签决定：
 * - 后台没选标签 → 所有预设都可切换
 * - 选了标签     → 目标预设必须带其中任意一个标签
 */
class EggSwitchController
{
    private const ID = 'egg-switcher';

    /** 当前预设与可选列表。 */
    public function show(Request $request, Server $server): JsonResponse
    {
        $user = $request->user();

        if ($user === null || $user->can('ext.egg-switcher.view', $server) !== true) {
            return new JsonResponse(['message' => '你没有查看服务器预设的权限。'], 403);
        }

        $server->loadMissing('egg.tags');
        $settings = $this->settings();
        $allowedTags = $this->tags($settings);

        // 后台开关：是否允许用户「切换标签」，即跨到其他标签下的预设。
        $allowTagSwitch = (bool) $settings->get('allow_tag_switch', false);

        $current = $server->egg;

        // 当前预设自己的标签；关闭跨标签时作为唯一可选范围。
        $currentTags = $current === null ? [] : $current->tags->pluck('slug')->all();

        $items = Egg::query()
            ->orderBy('name')
            ->get()
            ->map(function (Egg $egg) use ($current, $currentTags, $allowedTags, $allowTagSwitch): array {
                $tags = $egg->tags()->pluck('slug')->all();

                $related = $currentTags === [] || array_intersect($tags, $currentTags) !== [];
                $adminAllowed = $allowedTags === [] || array_intersect($tags, $allowedTags) !== [];
                $inRange = $allowTagSwitch || $related;

                return [
                    'id' => $egg->id,
                    'name' => $egg->name,
                    'tags' => $tags,
                    'current' => $current !== null && $egg->id === $current->id,
                    'related' => $related,
                    'allowed' => $inRange && $adminAllowed,
                    'reason' => !$inRange
                        ? '与当前预设没有共同的标签，且未开启跨标签切换'
                        : ($adminAllowed
                            ? null
                            : '不在管理员允许的标签范围内（需包含：'.implode('、', $allowedTags).'）'),
                ];
            })
            // 关闭跨标签时，无关预设直接不返回；开启时全部返回。
            ->filter(fn (array $item): bool => $allowTagSwitch || $item['related'])
            ->values()
            ->all();

        // 开启跨标签时列出面板全部标签，否则只列当前预设的标签。
        $tagQuery = Tag::query()->orderBy('name');

        if (!$allowTagSwitch) {
            $tagQuery->whereIn('slug', $currentTags);
        }

        $tagNames = $tagQuery
            ->get(['slug', 'name'])
            ->map(fn (Tag $tag): array => ['slug' => (string) $tag->slug, 'name' => (string) $tag->name])
            ->all();

        return new JsonResponse([
            'data' => [
                'current' => $current === null ? null : [
                    'id' => $current->id,
                    'name' => $current->name,
                    'tags' => $currentTags,
                ],
                'items' => $items,
                'tags' => $tagNames,
                'can_switch' => $user->can('ext.egg-switcher.switch', $server) === true,
                'allowed_tags' => $allowedTags,
                'allow_tag_switch' => $allowTagSwitch,
            ],
        ]);
    }

    /** 切换预设（switch 是 PHP 保留字，方法名用 change）。 */
    public function change(Request $request, Server $server): JsonResponse
    {
        $user = $request->user();

        if ($user === null || $user->can('ext.egg-switcher.switch', $server) !== true) {
            return new JsonResponse(['message' => '你没有切换服务器预设的权限。'], 403);
        }

        $data = $request->validate([
            'egg_id' => ['required', 'integer'],
        ]);

        $server->loadMissing('egg.tags');
        $egg = Egg::query()->find((int) $data['egg_id']);

        if ($egg === null) {
            return new JsonResponse(['message' => '目标预设不存在。'], 422);
        }

        if ($server->egg_id === $egg->id) {
            return new JsonResponse(['message' => '服务器已经在使用这个预设。'], 422);
        }

        $settings = $this->settings();
        $allowedTags = $this->tags($settings);
        $eggTags = $egg->tags()->pluck('slug')->all();

        // 未开启跨标签切换时，只能切到与当前预设共享标签的预设（当前预设没有标签时不限制）。
        $allowTagSwitch = (bool) $settings->get('allow_tag_switch', false);
        $currentTags = $server->egg === null ? [] : $server->egg->tags()->pluck('slug')->all();

        if (!$allowTagSwitch && $currentTags !== [] && array_intersect($eggTags, $currentTags) === []) {
            return new JsonResponse([
                'message' => '只能切换到与当前预设共享标签的预设（当前标签：'.implode('、', $currentTags).'）。',
            ], 422);
        }

        if ($allowedTags !== [] && array_intersect($eggTags, $allowedTags) === []) {
            return new JsonResponse([
                'message' => '该预设不在允许切换的标签范围内（需包含：'.implode('、', $allowedTags).'）。',
            ], 422);
        }

        try {
            // 走契约而不是具体实现，面板内部调整时不需要改这里。
            $updated = app(ChangesServerEgg::class)->change(
                $server,
                $egg,
                (bool) $settings->get('keep_variables', true),
            );
        } catch (Throwable $exception) {
            return new JsonResponse(['message' => '切换失败：'.$exception->getMessage()], 502);
        }

        // 让 Wings 立刻拿到新的启动命令与镜像；失败不影响切换本身。
        try {
            Daemon::server($updated)->sync();
        } catch (Throwable) {
            // 忽略：用户启动服务器时 Wings 会再次拉取配置。
        }

        return new JsonResponse([
            'data' => [
                'egg_id' => $updated->egg_id,
                'egg' => $egg->name,
                'tags' => $egg->tags()->pluck('slug')->all(),
                'requires_restart' => true,
            ],
        ]);
    }

    private function settings(): ExtensionSettings
    {
        return new ExtensionSettings(self::ID);
    }

    /** @return list<string> */
    private function tags(ExtensionSettings $settings): array
    {
        $raw = (string) $settings->get('target_tags', '');

        return array_values(array_filter(
            array_map(static fn (string $line): string => mb_strtolower(trim($line)), preg_split('/\R/', $raw) ?: []),
            static fn (string $line): bool => $line !== '',
        ));
    }
}
