import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, PageContentBlock, Select, Spinner, Switch, toast } from '@pterodactyl/sdk';
import {
    describeError,
    detectEndpoint,
    fetchAdminConfig,
    fetchModels,
    fetchTagOptions,
    saveAdminConfig,
    testConnection,
    type AdminConfig,
} from '../api';
import { TextArea, TextControl } from '../Controls';
import { Notice, PageHeader } from '../components/PageChrome';

const PROVIDERS = [
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'qwen', label: '通义千问（DashScope）' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'codebuddy', label: 'CodeBuddy' },
    { value: 'custom', label: '自定义（OpenAI 兼容）' },
];

interface Draft {
    provider: string;
    model: string;
    base_url: string;
    api_key: string;
    scope: 'all' | 'tags';
    tags: string[];
    allow_execute: boolean;
    command_mode: 'all' | 'whitelist';
    allow_files: boolean;
    file_allow_dirs: string;
    file_read_dirs: string;
    command_allow: string;
    charge_enabled: boolean;
    tokens_per_credit: string;
    rate_limit: string;
    daily_limit: string;
    daily_token_limit: string;
    max_tokens: string;
    max_tokens_guest: string;
    timeout: string;
    enabled: boolean;
    search_provider: string;
    search_api_key: string;
    search_base_url: string;
    search_fallback: boolean;
    search_credits: string;
    system_prompt: string;
    tools_disabled: string;
    custom_tools: string;
}

const toDraft = (config: AdminConfig): Draft => ({
    provider: config.provider || 'deepseek',
    model: config.model,
    base_url: config.base_url,
    api_key: '',
    scope: config.scope,
    tags: config.tags,
    allow_execute: config.allow_execute,
    command_mode: config.command_mode === 'whitelist' ? 'whitelist' : 'all',
    allow_files: config.allow_files,
    file_allow_dirs: (config.file_allow_dirs ?? []).join('\n'),
    file_read_dirs: (config.file_read_dirs ?? []).join('\n'),
    command_allow: config.command_allow,
    charge_enabled: config.charge_enabled,
    tokens_per_credit: String(config.tokens_per_credit),
    rate_limit: String(config.rate_limit),
    daily_limit: String(config.daily_limit ?? 0),
    daily_token_limit: String(config.daily_token_limit ?? 0),
    max_tokens: String(config.max_tokens),
    max_tokens_guest: String(config.max_tokens_guest),
    timeout: String(config.timeout),
    enabled: config.enabled,
    search_provider: config.search_provider ?? '',
    search_base_url: config.search_base_url ?? '',
    search_fallback: config.search_fallback,
    search_credits: String(config.search_credits ?? 0),
    search_api_key: '',
    system_prompt: config.system_prompt ?? '',
    tools_disabled: config.tools_disabled ?? '',
    custom_tools: config.custom_tools ?? '',
});

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className={'aia:flex aia:flex-col aia:gap-1'}>
            <span className={'aia:text-xs aia:text-muted-foreground'}>{label}</span>
            {children}
        </label>
    );
}

export default function AdminScreen() {
    const config = useQuery({ queryKey: ['ext-ai-assistant', 'admin', 'config'], queryFn: fetchAdminConfig });
    const tags = useQuery({ queryKey: ['ext-ai-assistant', 'admin', 'tags'], queryFn: fetchTagOptions });

    const [draft, setDraft] = useState<Draft | null>(null);
    const [models, setModels] = useState<string[]>([]);
    const [tested, setTested] = useState<string | null>(null);
    const [testFailed, setTestFailed] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (config.data !== undefined && draft === null) {
            setDraft(toDraft(config.data));
        }
    }, [config.data, draft]);

    if (config.isLoading || draft === null) {
        return <Spinner size={'large'} centered />;
    }

    if (config.isError) {
        return (
            <PageContentBlock>
                <div className={'aia:grid aia:gap-4'}>
                    <PageHeader title={'AI 助手'} description={'配置 AI 提供商、开放范围与执行权限。'} />

                    <Card title={'连接配置'}>
                        <p className={'aia:text-sm aia:text-warning'}>{describeError(config.error)}</p>
                    </Card>
                </div>
            </PageContentBlock>
        );
    }

    const update = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch });

    const loadModels = async (): Promise<void> => {
        setBusy('models');

        try {
            const list = await fetchModels({
                provider: draft.provider,
                base_url: draft.base_url,
                api_key: draft.api_key.trim() === '' ? undefined : draft.api_key.trim(),
            });

            setModels(list);
            toast.success(`已获取 ${list.length} 个模型。`);

            if (draft.model === '' && list.length > 0) {
                update({ model: list[0] });
            }
        } catch (cause) {
            toast.error(describeError(cause));
        } finally {
            setBusy(null);
        }
    };

    const detect = async (): Promise<string | null> => {
        const result = await detectEndpoint({
            provider: draft.provider,
            api_key: draft.api_key.trim() === '' ? undefined : draft.api_key.trim(),
        });

        const patch: Partial<Draft> = { base_url: result.base_url };

        if (result.models.length > 0) {
            setModels(result.models);

            if (draft.model === '') {
                patch.model = result.models[0];
            }
        }

        update(patch);
        toast.success(`已找到可用地址：${result.base_url}`);

        return result.base_url;
    };

    const runDetect = async (): Promise<void> => {
        setBusy('detect');

        try {
            await detect();
        } catch (cause) {
            toast.error(describeError(cause));
        } finally {
            setBusy(null);
        }
    };

    const runTest = async (): Promise<void> => {
        setBusy('test');
        setTested(null);
        setTestFailed(null);

        try {
            let baseUrl = draft.base_url;

            // CodeBuddy / 自定义没有默认地址：测试前先自动找一次。
            if (baseUrl.trim() === '' && (draft.provider === 'codebuddy' || draft.provider === 'custom')) {
                baseUrl = (await detect()) ?? '';
            }

            const result = await testConnection({
                provider: draft.provider,
                base_url: baseUrl,
                model: draft.model,
                api_key: draft.api_key.trim() === '' ? undefined : draft.api_key.trim(),
            });

            setTested(`连接成功：${result.model}，耗时 ${result.ms} ms，回复「${result.reply}」`);
        } catch (cause) {
            setTestFailed(describeError(cause));
        } finally {
            setBusy(null);
        }
    };

    const save = async (): Promise<void> => {
        setBusy('save');

        try {
            await saveAdminConfig({
                enabled: draft.enabled,
                provider: draft.provider,
                model: draft.model,
                base_url: draft.base_url,
                api_key: draft.api_key.trim() === '' ? undefined : draft.api_key.trim(),
                scope: draft.scope,
                tags: draft.tags,
                allow_execute: draft.allow_execute,
                command_mode: draft.command_mode,
                allow_files: draft.allow_files,
                file_allow_dirs: draft.file_allow_dirs
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line !== ''),
                file_read_dirs: draft.file_read_dirs
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line !== ''),
                command_allow: draft.command_allow,
                charge_enabled: draft.charge_enabled,
                tokens_per_credit: Number(draft.tokens_per_credit),
                rate_limit: Number(draft.rate_limit),
                daily_limit: Number(draft.daily_limit),
                daily_token_limit: Number(draft.daily_token_limit),
                max_tokens: Number(draft.max_tokens),
                max_tokens_guest: Number(draft.max_tokens_guest),
                timeout: Number(draft.timeout),
                search_provider: draft.search_provider,
                search_api_key: draft.search_api_key.trim() === '' ? undefined : draft.search_api_key.trim(),
                search_base_url: draft.search_base_url,
                search_fallback: draft.search_fallback,
                search_credits: Number(draft.search_credits) || 0,
                system_prompt: draft.system_prompt,
                tools_disabled: draft.tools_disabled,
                custom_tools: draft.custom_tools,
            });

            toast.success('已保存。');
            update({ api_key: '' });
            await config.refetch();
        } catch (cause) {
            toast.error(describeError(cause));
        } finally {
            setBusy(null);
        }
    };

    const modelOptions = (models.length > 0 ? models : draft.model === '' ? [] : [draft.model]).map((id) => ({
        value: id,
        label: id,
    }));

    const saving = busy === 'save';

    return (
        <PageContentBlock>
            <div className={'aia:grid aia:gap-4'}>
                <PageHeader
                    title={'AI 助手'}
                    description={'管理 AI 提供商、开放范围与执行权限。修改后点右上角保存，立即生效。'}
                    actions={
                        <Button type={'button'} disabled={busy !== null} onClick={() => void save()}>
                            {saving ? '保存中…' : '保存设置'}
                        </Button>
                    }
                />

                {config.data !== undefined && !config.data.has_key && (
                    <Notice id={'admin-no-key'} tone={'warning'} title={'还没有填写 API Key'} dismissible={false}>
                        填好 Key 后，用「获取模型」和「测试连接」验证连通性，再保存。
                    </Notice>
                )}

                {config.data !== undefined && config.data.charge_enabled && !config.data.economy_available && (
                    <Notice id={'admin-no-economy'} tone={'warning'} title={'已开启按 Token 扣积分，但没检测到经济系统'}>
                        需要安装「经济系统」扩展，否则扣费会被自动跳过，等于免费使用。
                    </Notice>
                )}

            <Card title={'连接配置'}>
                <div className={'aia:grid aia:gap-3 aia:md:grid-cols-2'}>
                    <Field label={'AI 提供商'}>
                        <Select
                            id={'aia-provider'}
                            value={draft.provider}
                            options={
                                (config.data?.providers ?? []).length > 0
                                    ? (config.data?.providers ?? []).map((item) => ({
                                          value: item.value,
                                          label: item.label,
                                      }))
                                    : PROVIDERS
                            }
                            onChange={(value) => {
                                const nextUrl =
                                    (config.data?.providers ?? []).find((item) => item.value === String(value))?.url ?? '';

                                update({
                                    provider: String(value),
                                    model: '',
                                    // 地址还是空的时候，切提供商顺手带出默认地址。
                                    base_url: draft.base_url.trim() === '' ? nextUrl : draft.base_url,
                                });
                            }}
                        />
                    </Field>

                    <Field label={'API Key（留空表示不修改）'}>
                        <TextControl
                            type={'password'}
                            placeholder={config.data?.has_key ? '已保存，留空不修改' : '填写 API Key'}
                            value={draft.api_key}
                            onChange={(event) => update({ api_key: event.target.value })}
                        />
                    </Field>

                    <Field label={'接口地址（CodeBuddy 可点「自动检测」）'}>
                        <div className={'aia:flex aia:items-center aia:gap-2'}>
                            <div className={'aia:min-w-0 aia:flex-1'}>
                                <TextControl
                                    type={'text'}
                                    placeholder={
                                        draft.provider === 'codebuddy'
                                            ? '留空即用 https://www.codebuddy.cn（ck_ Key 只在中国版有效）'
                                            : draft.provider === 'custom'
                                              ? '必填：OpenAI 兼容地址，例如 https://xxx/v1'
                                              : '例如 https://api.deepseek.com/v1'
                                    }
                                    value={draft.base_url}
                                    onChange={(event) => update({ base_url: event.target.value })}
                                />
                            </div>
                            <Button
                                type={'button'}
                                size={'small'}
                                disabled={busy !== null}
                                onClick={() => void runDetect()}
                            >
                                {busy === 'detect' ? '检测中…' : '自动检测'}
                            </Button>
                        </div>
                    </Field>

                    <Field label={'模型'}>
                        <div className={'aia:flex aia:items-center aia:gap-2'}>
                            <div className={'aia:min-w-0 aia:flex-1'}>
                                {modelOptions.length > 0 ? (
                                    <Select
                                        id={'aia-model'}
                                        value={draft.model}
                                        options={modelOptions}
                                        onChange={(value) => update({ model: String(value) })}
                                    />
                                ) : (
                                    <TextControl
                                        type={'text'}
                                        placeholder={
                                            draft.provider === 'codebuddy'
                                                ? '留空默认 hy3；也可填 glm-4.7 / deepseek-v4-pro'
                                                : draft.provider === 'custom'
                                                  ? '必填：按服务商文档填写模型 ID'
                                                  : '先点「获取模型」或手动填写'
                                        }
                                        value={draft.model}
                                        onChange={(event) => update({ model: event.target.value })}
                                    />
                                )}
                            </div>
                            <Button
                                type={'button'}
                                size={'small'}
                                disabled={busy !== null}
                                onClick={() => void loadModels()}
                            >
                                {busy === 'models' ? '获取中…' : '获取模型'}
                            </Button>
                        </div>
                    </Field>
                </div>

                <div className={'aia:mt-3 aia:flex aia:flex-wrap aia:items-center aia:gap-3'}>
                    <Button type={'button'} size={'small'} disabled={busy !== null} onClick={() => void runTest()}>
                        {busy === 'test' ? '测试中…' : '测试连接'}
                    </Button>
                    <span className={'aia:text-xs aia:text-success'}>{tested ?? ''}</span>
                    <span className={'aia:text-xs aia:text-warning'}>{testFailed ?? ''}</span>
                </div>
            </Card>

            <Card title={'开放范围'}>
                <div className={'aia:grid aia:gap-3 aia:md:grid-cols-2'}>
                    <Field label={'范围'}>
                        <Select
                            id={'aia-scope'}
                            value={draft.scope}
                            options={[
                                { value: 'all', label: '所有预设' },
                                { value: 'tags', label: '仅指定标签' },
                            ]}
                            onChange={(value) => update({ scope: String(value) as 'all' | 'tags' })}
                        />
                    </Field>
                </div>

                <p className={'aia:mt-3 aia:text-xs aia:text-muted-foreground'}>
                    选中面板现有的标签（来自「管理 → 标签」，与预设绑定）：
                </p>

                <div className={'aia:mt-2 aia:flex aia:flex-wrap aia:gap-2'}>
                    {(tags.data ?? []).length === 0 && (
                        <span className={'aia:text-xs aia:text-warning'}>面板还没有任何标签。</span>
                    )}

                    {(tags.data ?? []).map((tag) => {
                        const checked = draft.tags.includes(tag.slug);

                        return (
                            <label
                                key={tag.id}
                                className={
                                    'aia:flex aia:cursor-pointer aia:items-center aia:gap-2 aia:rounded-sm ' +
                                    'aia:border aia:px-2 aia:py-1 aia:text-xs ' +
                                    (checked
                                        ? 'aia:border-primary aia:bg-primary/10 aia:text-foreground'
                                        : 'aia:border-border aia:text-muted-foreground')
                                }
                            >
                                <input
                                    type={'checkbox'}
                                    checked={checked}
                                    onChange={(event) =>
                                        update({
                                            tags: event.target.checked
                                                ? [...draft.tags, tag.slug]
                                                : draft.tags.filter((slug) => slug !== tag.slug),
                                        })
                                    }
                                />
                                {tag.name}
                                <span className={'aia:text-muted-foreground'}>({tag.slug})</span>
                            </label>
                        );
                    })}
                </div>
            </Card>

            <Card title={'命令与文件'}>
                <div className={'aia:grid aia:gap-4'}>
                    <label className={'aia:flex aia:cursor-pointer aia:items-center aia:gap-2 aia:text-sm'}>
                        <Switch checked={draft.allow_execute} onChange={(checked) => update({ allow_execute: checked })} />
                        允许执行命令（仍需命中白名单 + 控制台权限）
                    </label>

                    <Field label={'命令放行模式'}>
                        <Select
                            id={'aia-command-mode'}
                            value={draft.command_mode}
                            options={[
                                { value: 'all', label: '放行全部（危险命令需二次确认）' },
                                { value: 'whitelist', label: '仅白名单' },
                            ]}
                            onChange={(value) => update({ command_mode: String(value) as 'all' | 'whitelist' })}
                        />
                    </Field>

                    <Field
                        label={
                            draft.command_mode === 'whitelist'
                                ? '命令白名单（每行一条：prefix:stop / /^whitelist / / save-all）'
                                : '命令白名单（仅「仅白名单」模式生效）'
                        }
                    >
                        <TextArea
                            rows={4}
                            disabled={draft.command_mode !== 'whitelist'}
                            value={draft.command_allow}
                            placeholder={'prefix:stop\n/^whitelist /\nsave-all'}
                            onChange={(event) => update({ command_allow: event.target.value })}
                        />
                    </Field>

                    <label className={'aia:flex aia:cursor-pointer aia:items-center aia:gap-2 aia:text-sm'}>
                        <Switch checked={draft.allow_files} onChange={(checked) => update({ allow_files: checked })} />
                        允许生成文件（写入前必须用户确认）
                    </label>

                    <p className={'aia:text-xs aia:text-muted-foreground'}>
                        写入范围：<strong className={'aia:text-foreground'}>不限制目录</strong>，
                        任意位置都可写。仍会拦截绝对路径、<code className={'aia:font-mono'}>..</code> 穿越，
                        以及 <code className={'aia:font-mono'}>.env</code> / <code className={'aia:font-mono'}>*.key</code>
                        {' '}/ <code className={'aia:font-mono'}>*.pem</code> 这类凭据与数据库文件。
                        每次写入都会先弹出确认卡片，显示完整路径、字节数与覆盖提示。
                    </p>

                    <Field label={'允许 AI 读取的目录（每行一个，只读）'}>
                        <TextArea
                            rows={3}
                            value={draft.file_read_dirs}
                            placeholder={'mods\nconfig\nlogs\ncrash-reports'}
                            onChange={(event) => update({ file_read_dirs: event.target.value })}
                        />
                    </Field>
                </div>
            </Card>

            <Card title={'免费额度'}>
                <div className={'aia:grid aia:gap-3 aia:md:grid-cols-2'}>
                    <Field label={'每人每天提问次数（0 = 不限）'}>
                        <TextControl
                            type={'number'}
                            min={0}
                            placeholder={'0 = 不限，例如 20'}
                            value={draft.daily_limit}
                            onChange={(event) => update({ daily_limit: event.target.value })}
                        />
                    </Field>

                    <Field label={'每人每天 Token 上限（0 = 不限）'}>
                        <TextControl
                            type={'number'}
                            min={0}
                            placeholder={'0 = 不限，例如 50000'}
                            value={draft.daily_token_limit}
                            onChange={(event) => update({ daily_token_limit: event.target.value })}
                        />
                    </Field>

                    <Field label={'每分钟提问次数（0 = 不限）'}>
                        <TextControl
                            type={'number'}
                            min={0}
                            placeholder={'0 = 不限'}
                            value={draft.rate_limit}
                            onChange={(event) => update({ rate_limit: event.target.value })}
                        />
                    </Field>

                    <Field label={'单次回复最大 Token（未计费时，0 = 不限；建议 ≥ 1024，过小会截断回答）'}>
                        <TextControl
                            type={'number'}
                            min={0}
                            placeholder={'0 = 不限（交给模型默认）'}
                            value={draft.max_tokens_guest}
                            onChange={(event) => update({ max_tokens_guest: event.target.value })}
                        />
                    </Field>
                </div>

                <p className={'aia:mt-2 aia:text-xs aia:text-muted-foreground'}>
                    这四项都是「0 = 不限」：不开积分时，每天次数与每天 Token 就是防滥用的闸门，
                    按「用户 + 自然日」累计，跨天归零；用户端会显示今日剩余。
                    <br />
                    当前生效：
                    {(config.data?.daily_limit ?? 0) > 0
                        ? ` 每天 ${config.data?.daily_limit} 次`
                        : ' 每天次数不限'}
                    {' · '}
                    {(config.data?.daily_token_limit ?? 0) > 0
                        ? `每天 ${config.data?.daily_token_limit} Token`
                        : '每天 Token 不限'}
                    {' · '}
                    {(config.data?.rate_limit ?? 0) > 0
                        ? `每分钟 ${config.data?.rate_limit} 次`
                        : '每分钟不限'}
                    {' · '}
                    {(config.data?.max_tokens_guest ?? 0) > 0
                        ? `单次 ${config.data?.max_tokens_guest} Token`
                        : '单次 Token 不限'}
                    。
                </p>
            </Card>

            <Card title={'积分计费（可选）'}>
                <div className={'aia:grid aia:gap-3 aia:md:grid-cols-2'}>
                    <label className={'aia:flex aia:cursor-pointer aia:items-center aia:gap-2 aia:text-sm'}>
                        <Switch
                            checked={draft.charge_enabled}
                            onChange={(checked) => update({ charge_enabled: checked })}
                        />
                        按 Token 扣积分
                    </label>

                    <Field label={'多少 Token 扣 1 积分'}>
                        <TextControl
                            type={'number'}
                            min={1}
                            disabled={!draft.charge_enabled}
                            value={draft.tokens_per_credit}
                            onChange={(event) => update({ tokens_per_credit: event.target.value })}
                        />
                    </Field>

                    <Field label={'单次回复最大 Token（计费 / 自有 Key，默认 0 = 不限，交给模型自身上限）'}>
                        <TextControl
                            type={'number'}
                            min={0}
                            placeholder={'0 = 不限（交给模型默认）'}
                            value={draft.max_tokens}
                            onChange={(event) => update({ max_tokens: event.target.value })}
                        />
                    </Field>

                    <Field label={'请求超时（秒）'}>
                        <TextControl
                            type={'number'}
                            min={5}
                            value={draft.timeout}
                            onChange={(event) => update({ timeout: event.target.value })}
                        />
                    </Field>
                </div>

                <p className={'aia:mt-2 aia:text-xs aia:text-muted-foreground'}>
                    {config.data?.economy_available === true
                        ? '已检测到「经济系统」扩展：开启后会从用户余额扣费，免费额度仍然生效。'
                        : '未检测到「经济系统」扩展：开启后扣费会被自动跳过，此时请依赖上面的免费额度。'}
                </p>
            </Card>

            <Card title={'联网搜索'}>
                <div className={'aia:grid aia:gap-3 aia:md:grid-cols-2'}>
                    <Field label={'搜索服务'}>
                        <Select
                            id={'aia-search-provider'}
                            value={draft.search_provider}
                            options={[
                                { value: '', label: '关闭（不提供 web_search）' },
                                { value: 'deepseek', label: 'DeepSeek 官方搜索' },
                                { value: 'tavily', label: 'Tavily' },
                                { value: 'serper', label: 'Serper（Google）' },
                                { value: 'custom', label: '自定义接口（用 {query} 占位）' },
                            ]}
                            onChange={(value) => update({ search_provider: String(value) })}
                        />
                    </Field>

                    <Field label={'搜索 API Key（留空不修改）'}>
                        <TextControl
                            type={'password'}
                            placeholder={config.data?.search_has_key ? '已保存，留空不修改' : '填写后启用联网搜索'}
                            value={draft.search_api_key}
                            onChange={(event) => update({ search_api_key: event.target.value })}
                        />
                    </Field>

                    <Field
                        label={
                            draft.search_provider === 'custom'
                                ? '搜索接口地址（必填，用 {query} 占位）'
                                : '搜索接口地址（留空用默认）'
                        }
                    >
                        <TextControl
                            type={'text'}
                            placeholder={
                                draft.search_provider === 'custom'
                                    ? 'https://api.example.com/search?q={query}'
                                    : 'DeepSeek 默认 https://api.deepseek.com'
                            }
                            value={draft.search_base_url}
                            onChange={(event) => update({ search_base_url: event.target.value })}
                        />
                    </Field>

                    <Field label={'每次联网搜索扣积分（0 = 不扣）'}>
                        <TextControl
                            type={'number'}
                            min={0}
                            placeholder={'0 = 不扣，例如 1'}
                            value={draft.search_credits}
                            onChange={(event) => update({ search_credits: event.target.value })}
                        />
                    </Field>

                    <label
                        className={
                            'aia:flex aia:cursor-pointer aia:items-center aia:gap-2 aia:self-end aia:text-sm'
                        }
                    >
                        <Switch
                            checked={draft.search_fallback}
                            onChange={(checked) => update({ search_fallback: checked })}
                        />
                        未配置时用模型自带联网（OpenRouter 的 :online）
                    </label>
                </div>

                <p className={'aia:mt-2 aia:text-xs aia:text-muted-foreground'}>
                    DeepSeek 走官方 <code className={'aia:font-mono'}>POST /v1/tools/search</code>，
                    返回带权威度与摘要的结构化结果；搜索结果同样计入 24 KB 工具预算。
                    搜索接口按次计费：使用平台 Key 时按上面的设置扣积分，用户自带搜索 Key 不扣。
                </p>
            </Card>

            <Card title={'工具集'}>
                <div className={'aia:grid aia:gap-3'}>
                    <Field label={'禁用的内置工具（逗号分隔，留空表示全部启用）'}>
                        <TextControl
                            type={'text'}
                            placeholder={'例如 web_search,grep'}
                            value={draft.tools_disabled}
                            onChange={(event) => update({ tools_disabled: event.target.value })}
                        />
                    </Field>

                    <Field label={'自定义工具（每行：名称|说明|https://地址?q={query}）'}>
                        <TextArea
                            rows={4}
                            value={draft.custom_tools}
                            placeholder={'ip_lookup|查询 IP 归属地|https://api.example.com/ip?q={query}'}
                            onChange={(event) => update({ custom_tools: event.target.value })}
                        />
                    </Field>
                </div>

                <p className={'aia:mt-2 aia:text-xs aia:text-muted-foreground'}>
                    自定义工具只允许 <strong className={'aia:text-foreground'}>GET + https + 公网地址</strong>，
                    内网/回环域名会被拒绝（防 SSRF），单次返回截断 8 KB。
                </p>
            </Card>

            <Card title={'AI 行为'}>
                <Field label={'系统提示词（留空用默认）'}>
                    <TextArea
                        rows={6}
                        value={draft.system_prompt}
                        placeholder={'你是一名游戏服务器运维助手，擅长根据控制台报错定位问题…'}
                        onChange={(event) => update({ system_prompt: event.target.value })}
                    />
                </Field>

                <p className={'aia:mt-2 aia:text-xs aia:text-muted-foreground'}>
                    这里的文字会拼在内置规则<strong className={'aia:text-foreground'}>之前</strong>；
                    权限、白名单、注入防护等硬规则始终追加在后，无法被覆盖。
                </p>
            </Card>

            </div>
        </PageContentBlock>
    );
}
