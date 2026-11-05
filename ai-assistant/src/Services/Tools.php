<?php

declare(strict_types=1);

namespace AiAssistant\Services;

use Illuminate\Support\Facades\Http;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use Throwable;

/**
 * Agent 可调用的工具集，全部只读。
 *
 * 设计重点是「不把大目录整个倒进上下文」：
 * - list_dir 只给文件名与大小，最多 200 项
 * - read_file 必须按行分段，单次最多 200 行
 * - grep 只回匹配行 + 行号，最多 40 条，每条限 200 字
 * - 单次对话所有工具输出共享 24 KB 预算，用完即拒
 */
class Tools
{
    /** 单次对话内所有工具输出的总预算（字节）。 */
    public const OUTPUT_BUDGET = 24000;

    private const MAX_LIST = 200;

    private const MAX_READ_LINES = 200;

    private const MAX_READ_BYTES = 262144;

    private const MAX_GREP_HITS = 40;

    private const MAX_GREP_FILES = 40;

    private const MAX_LINE_CHARS = 200;

    public function __construct(
        private readonly Guard $guard,
        private readonly ?AiSettings $settings = null,
        private readonly ?User $user = null,
    ) {}

    /**
     * 搜索配置：用户自带的优先，其次平台配置。
     *
     * @return array{provider: string, key: string, base_url: string}
     */
    private function searchConfig(): array
    {
        $provider = $this->guard->text('search_provider');
        $key = $this->guard->text('search_api_key');
        $baseUrl = $this->guard->text('search_base_url');

        if ($this->settings !== null && $this->user !== null) {
            try {
                $own = $this->settings->userSearch($this->user);

                if ($own['api_key'] !== '') {
                    $key = $own['api_key'];
                    $provider = $own['provider'] !== '' ? $own['provider'] : $provider;
                    $baseUrl = $own['base_url'] !== '' ? $own['base_url'] : $baseUrl;
                }
            } catch (Throwable) {
                // 读用户配置失败就退回平台配置。
            }
        }

        return ['provider' => $provider, 'key' => $key, 'base_url' => $baseUrl];
    }

    /** 按后台配置组装可用的 tools（内置 + 自定义）。 */
    public function definitions(): array
    {
        $disabled = $this->disabledTools();
        $tools = [];

        foreach ($this->builtin() as $tool) {
            if (!in_array($tool['function']['name'], $disabled, true)) {
                $tools[] = $tool;
            }
        }

        foreach ($this->customTools() as $custom) {
            if (in_array($custom['name'], $disabled, true)) {
                continue;
            }

            $tools[] = [
                'type' => 'function',
                'function' => [
                    'name' => $custom['name'],
                    'description' => $custom['description'],
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'query' => ['type' => 'string', 'description' => '要查询的内容'],
                        ],
                        'required' => ['query'],
                    ],
                ],
            ];
        }

        return $tools;
    }

    /** @return list<string> */
    private function disabledTools(): array
    {
        $raw = $this->guard->text('tools_disabled');

        return array_values(array_filter(array_map('trim', explode(',', $raw))));
    }

    /**
     * 后台配置的自定义 GET 工具。
     *
     * @return list<array{name: string, description: string, url: string}>
     */
    private function customTools(): array
    {
        $tools = [];

        foreach (preg_split('/\R/', $this->guard->text('custom_tools')) ?: [] as $line) {
            $parts = array_map('trim', explode('|', $line));

            if (count($parts) < 3) {
                continue;
            }

            [$name, $description, $url] = $parts;

            // 工具名要能被模型安全引用；地址必须是 https，占位符固定为 {query}。
            if (preg_match('/^[a-z][a-z0-9_]{2,40}$/', $name) !== 1) {
                continue;
            }

            if (!str_starts_with($url, 'https://') || mb_strlen($description) > 200) {
                continue;
            }

            $tools[] = ['name' => $name, 'description' => $description, 'url' => $url];
        }

        return $tools;
    }

    /** 内置工具定义。 */
    private function builtin(): array
    {
        return [
            [
                'type' => 'function',
                'function' => [
                    'name' => 'list_dir',
                    'description' => '列出服务器某个目录里的文件与子目录名（只给名称和大小，不含内容）。根目录用 "."。',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'path' => ['type' => 'string', 'description' => '目录路径，相对服务器根目录'],
                        ],
                        'required' => ['path'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'read_file',
                    'description' => '按行分段读取文本文件。大文件必须用 offset/limit 分段，禁止一次读整份。',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'path' => ['type' => 'string', 'description' => '文件路径'],
                            'offset' => ['type' => 'integer', 'description' => '起始行号，从 1 开始，默认 1'],
                            'limit' => ['type' => 'integer', 'description' => '读取行数，默认 80，最大 200'],
                        ],
                        'required' => ['path'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'grep',
                    'description' => '在一层目录里搜索文本（大小写不敏感），返回「文件:行号:内容」，最多 40 条。用于定位报错关键词、配置项。',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'pattern' => ['type' => 'string', 'description' => '要搜索的字符串或正则'],
                            'path' => ['type' => 'string', 'description' => '搜索起点目录，默认 "."'],
                        ],
                        'required' => ['pattern'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'web_search',
                    'description' => '搜索互联网，用于查报错、插件文档、版本兼容性。仅在管理员配置了搜索服务时可用。',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'query' => ['type' => 'string', 'description' => '搜索词'],
                        ],
                        'required' => ['query'],
                    ],
                ],
            ],
        ];
    }

    /**
     * 执行一个工具调用，返回给模型看的文本。
     *
     * @param  array<string, mixed>  $args
     * @return array{ok: bool, content: string}
     */
    public function run(string $name, array $args, Server $server, int $remaining): array
    {
        if ($remaining <= 0) {
            return ['ok' => false, 'content' => '工具输出预算已用尽，请基于已有信息作答，或让用户缩小范围。'];
        }

        return match ($name) {
            'list_dir' => $this->listDir($server, (string) ($args['path'] ?? '.'), $remaining),
            'read_file' => $this->readFile(
                $server,
                (string) ($args['path'] ?? ''),
                max(1, (int) ($args['offset'] ?? 1)),
                min(self::MAX_READ_LINES, max(1, (int) ($args['limit'] ?? 80))),
                $remaining,
            ),
            'grep' => $this->grep($server, (string) ($args['pattern'] ?? ''), (string) ($args['path'] ?? '.'), $remaining),
            'web_search' => $this->webSearch((string) ($args['query'] ?? ''), $remaining),
            default => $this->runCustom($name, $args, $remaining),
        };
    }

    /**
     * 执行后台配置的自定义工具（只允许 GET + https + 公网）。
     *
     * @param  array<string, mixed>  $args
     * @return array{ok: bool, content: string}
     */
    private function runCustom(string $name, array $args, int $remaining): array
    {
        $tool = null;

        foreach ($this->customTools() as $item) {
            if ($item['name'] === $name) {
                $tool = $item;

                break;
            }
        }

        if ($tool === null) {
            return ['ok' => false, 'content' => "未知工具：{$name}"];
        }

        $query = mb_substr(trim((string) ($args['query'] ?? '')), 0, 200);
        $url = str_replace('{query}', rawurlencode($query), $tool['url']);
        $host = mb_strtolower((string) parse_url($url, PHP_URL_HOST));

        if ($this->isPrivateHost($host)) {
            return ['ok' => false, 'content' => "不允许访问内网地址：{$host}"];
        }

        try {
            $response = Http::acceptJson()->timeout(15)->get($url);
        } catch (Throwable $exception) {
            return ['ok' => false, 'content' => '请求失败：'.$exception->getMessage()];
        }

        if ($response->failed()) {
            return ['ok' => false, 'content' => sprintf('接口返回 %d：%s', $response->status(), mb_substr($response->body(), 0, 200))];
        }

        return ['ok' => true, 'content' => $this->clip(mb_substr($response->body(), 0, 8000), $remaining)];
    }

    /** 内网、回环、本地域名一律拒绝，避免自定义工具变成 SSRF 通道。 */
    private function isPrivateHost(string $host): bool
    {
        $host = mb_strtolower(trim($host));

        if ($host === '' || $host === 'localhost') {
            return true;
        }

        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
        }

        return str_ends_with($host, '.local') || str_ends_with($host, '.internal');
    }

    /** @return array{ok: bool, content: string} */
    private function listDir(Server $server, string $path, int $remaining): array
    {
        $path = trim(str_replace('\\', '/', $path), '/');
        $path = $path === '.' ? '' : $path;

        if ($path !== '' && !$this->guard->readAllowed($path)) {
            return ['ok' => false, 'content' => "目录 {$path} 不在允许读取的范围内。"];
        }

        try {
            $entries = Daemon::server($server)->files()->getDirectory($path);
        } catch (Throwable $exception) {
            return ['ok' => false, 'content' => '读取目录失败：'.$exception->getMessage()];
        }

        $lines = [];
        $total = 0;

        foreach ($entries as $entry) {
            $name = trim((string) data_get($entry, 'name', ''));

            if ($name === '' || str_starts_with($name, '.')) {
                continue;
            }

            $total++;

            if (count($lines) >= self::MAX_LIST) {
                continue;
            }

            $isFile = data_get($entry, 'is_file', true) !== false;
            $size = (int) data_get($entry, 'size', 0);
            $lines[] = $isFile ? sprintf('%s (%s)', $name, $this->size($size)) : $name.'/';
        }

        if ($lines === []) {
            return ['ok' => true, 'content' => "{$path} 为空或没有可读文件。"];
        }

        $header = $total > count($lines)
            ? sprintf('%s 共 %d 项，下面只列出前 %d 项：', $path === '' ? '/' : $path, $total, count($lines))
            : sprintf('%s 共 %d 项：', $path === '' ? '/' : $path, $total);

        return ['ok' => true, 'content' => $this->clip($header."\n".implode("\n", $lines), $remaining)];
    }

    /** @return array{ok: bool, content: string} */
    private function readFile(Server $server, string $path, int $offset, int $limit, int $remaining): array
    {
        $path = ltrim(str_replace('\\', '/', trim($path)), '/');

        if (!$this->guard->readAllowed($path)) {
            return ['ok' => false, 'content' => "文件 {$path} 不在允许读取的范围内。"];
        }

        try {
            $content = Daemon::server($server)->files()->getContent($path, self::MAX_READ_BYTES);
        } catch (Throwable $exception) {
            return ['ok' => false, 'content' => "读取 {$path} 失败（可能不存在或超过 256 KB）：".$exception->getMessage()];
        }

        if (str_contains($content, "\0")) {
            return ['ok' => false, 'content' => "{$path} 是二进制文件，无法按文本读取。"];
        }

        $lines = preg_split('/\R/', $content) ?: [];
        $total = count($lines);
        $slice = array_slice($lines, $offset - 1, $limit);
        $numbered = [];

        foreach ($slice as $index => $line) {
            $numbered[] = sprintf('%d| %s', $offset + $index, mb_substr($line, 0, self::MAX_LINE_CHARS));
        }

        $end = $offset + count($slice) - 1;
        $header = sprintf('%s 共 %d 行，本次 %d–%d 行：', $path, $total, $offset, max($offset, $end));

        if ($end < $total) {
            $header .= "\n（还有后续内容，需要时用 offset=".($end + 1).' 继续读）';
        }

        return ['ok' => true, 'content' => $this->clip($header."\n".implode("\n", $numbered), $remaining)];
    }

    /** @return array{ok: bool, content: string} */
    private function grep(Server $server, string $pattern, string $path, int $remaining): array
    {
        $pattern = trim($pattern);

        if ($pattern === '' || mb_strlen($pattern) > 120) {
            return ['ok' => false, 'content' => '搜索词为空或过长。'];
        }

        $path = trim(str_replace('\\', '/', $path), '/');
        $path = $path === '.' ? '' : $path;

        if ($path !== '' && !$this->guard->readAllowed($path)) {
            return ['ok' => false, 'content' => "目录 {$path} 不在允许读取的范围内。"];
        }

        try {
            $entries = Daemon::server($server)->files()->getDirectory($path);
        } catch (Throwable $exception) {
            return ['ok' => false, 'content' => '读取目录失败：'.$exception->getMessage()];
        }

        $files = Daemon::server($server)->files();
        $hits = [];
        $scanned = 0;

        foreach ($entries as $entry) {
            if (data_get($entry, 'is_file', true) === false) {
                continue;
            }

            $name = (string) data_get($entry, 'name', '');

            if ($name === '' || str_starts_with($name, '.')) {
                continue;
            }

            if ($scanned >= self::MAX_GREP_FILES || count($hits) >= self::MAX_GREP_HITS) {
                break;
            }

            $file = $path === '' ? $name : $path.'/'.$name;

            if (!$this->guard->readAllowed($file)) {
                continue;
            }

            $scanned++;

            try {
                $content = $files->getContent($file, self::MAX_READ_BYTES);
            } catch (Throwable) {
                continue;
            }

            if (str_contains($content, "\0")) {
                continue;
            }

            foreach (preg_split('/\R/', $content) ?: [] as $number => $line) {
                $matched = @preg_match('/'.str_replace('/', '\\/', $pattern).'/iu', $line);

                if ($matched === false) {
                    $matched = mb_stripos($line, $pattern) !== false ? 1 : 0;
                }

                if ($matched !== 1) {
                    continue;
                }

                $hits[] = sprintf('%s:%d: %s', $file, $number + 1, mb_substr(trim($line), 0, self::MAX_LINE_CHARS));

                if (count($hits) >= self::MAX_GREP_HITS) {
                    break;
                }
            }
        }

        if ($hits === []) {
            return ['ok' => true, 'content' => "在 {$path} 下扫了 {$scanned} 个文件，没有匹配「{$pattern}」。"];
        }

        return [
            'ok' => true,
            'content' => $this->clip(
                "匹配「{$pattern}」（扫了 {$scanned} 个文件，最多 ".self::MAX_GREP_HITS." 条）：\n".implode("\n", $hits),
                $remaining,
            ),
        ];
    }

    /** @return array{ok: bool, content: string} */
    private function webSearch(string $query, int $remaining): array
    {
        $query = trim($query);

        if ($query === '') {
            return ['ok' => false, 'content' => '搜索词为空。'];
        }

        $config = $this->searchConfig();
        $provider = $config['provider'];
        $key = $config['key'];
        $baseUrl = $config['base_url'];

        if ($provider === '' || $key === '') {
            return [
                'ok' => false,
                'content' => '没有可用的搜索服务（管理员未配置，当前用户也没有填自己的搜索 Key）。'
                    .'请基于已有信息回答，或提示用户在「我的 API」里填搜索 Key。',
            ];
        }

        try {
            if ($provider === 'deepseek') {
                // DeepSeek 官方搜索：POST {base}/v1/tools/search
                $base = rtrim($baseUrl, '/');
                $base = $base === '' ? 'https://api.deepseek.com' : $base;

                $response = Http::withToken($key)
                    ->acceptJson()
                    ->timeout(25)
                    ->post($base.'/v1/tools/search', [
                        'query' => mb_substr($query, 0, 128),
                        'count' => 5,
                        'need_content' => false,
                    ]);

                $items = (array) $response->json('results', []);
                $lines = [];

                foreach (array_slice($items, 0, 5) as $item) {
                    $lines[] = sprintf(
                        "- %s\n  %s\n  %s",
                        $item['title'] ?? '',
                        $item['url'] ?? '',
                        $item['summary'] ?? ($item['snippet'] ?? ''),
                    );
                }
            } elseif ($provider === 'custom') {
                // 自定义搜索：地址里用 {query} 占位，鉴权统一走 Bearer。
                $url = trim($baseUrl);

                if ($url === '') {
                    return ['ok' => false, 'content' => '自定义搜索缺少接口地址（后台填一个带 {query} 的 https 地址）。'];
                }

                $url = str_replace('{query}', rawurlencode($query), $url);

                if (!str_starts_with($url, 'https://')) {
                    return ['ok' => false, 'content' => '自定义搜索地址必须是 https。'];
                }

                $response = Http::withToken($key)->acceptJson()->timeout(20)->get($url);

                $payload = $response->json();
                $items = is_array($payload)
                    ? ($payload['results'] ?? ($payload['data'] ?? ($payload['organic'] ?? [])))
                    : [];
                $lines = [];

                foreach (array_slice((array) $items, 0, 5) as $item) {
                    if (!is_array($item)) {
                        continue;
                    }

                    $lines[] = sprintf(
                        "- %s\n  %s\n  %s",
                        $item['title'] ?? ($item['name'] ?? ''),
                        $item['url'] ?? ($item['link'] ?? ''),
                        $item['snippet'] ?? ($item['summary'] ?? ($item['content'] ?? '')),
                    );
                }
            } elseif ($provider === 'serper') {
                $response = Http::withHeaders(['X-API-KEY' => $key])
                    ->timeout(20)
                    ->post('https://google.serper.dev/search', ['q' => $query, 'num' => 5]);
                $items = (array) $response->json('organic', []);
                $lines = [];

                foreach (array_slice($items, 0, 5) as $item) {
                    $lines[] = sprintf('- %s\n  %s\n  %s', $item['title'] ?? '', $item['link'] ?? '', $item['snippet'] ?? '');
                }
            } else {
                // 默认 Tavily
                $response = Http::timeout(20)->post('https://api.tavily.com/search', [
                    'api_key' => $key,
                    'query' => $query,
                    'max_results' => 5,
                    'search_depth' => 'basic',
                ]);
                $items = (array) $response->json('results', []);
                $lines = [];

                foreach (array_slice($items, 0, 5) as $item) {
                    $lines[] = sprintf('- %s\n  %s\n  %s', $item['title'] ?? '', $item['url'] ?? '', $item['content'] ?? '');
                }
            }

            if (!empty($response->json('error'))) {
                return ['ok' => false, 'content' => '搜索失败：'.mb_substr((string) $response->json('error'), 0, 200)];
            }

            if ($lines === []) {
                return ['ok' => true, 'content' => "没有搜到「{$query}」的结果。"];
            }

            return ['ok' => true, 'content' => $this->clip("搜索「{$query}」：\n".implode("\n", $lines), $remaining)];
        } catch (Throwable $exception) {
            return ['ok' => false, 'content' => '搜索请求失败：'.$exception->getMessage()];
        }
    }

    /** 单条工具结果不超过剩余预算，避免一次把上下文塞满。 */
    private function clip(string $text, int $remaining): string
    {
        $limit = min($remaining, self::OUTPUT_BUDGET);

        if (strlen($text) <= $limit) {
            return $text;
        }

        return mb_substr($text, 0, (int) floor($limit / 2))
            ."\n…（内容过长已截断，请缩小范围后重试）";
    }

    private function size(int $bytes): string
    {
        if ($bytes >= 1048576) {
            return round($bytes / 1048576, 1).' MB';
        }

        if ($bytes >= 1024) {
            return round($bytes / 1024, 1).' KB';
        }

        return $bytes.' B';
    }
}
