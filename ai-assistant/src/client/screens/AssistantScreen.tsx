import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, PageContentBlock, Select, Spinner, Switch, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { Copy, RefreshCw, Send, Sparkles } from 'lucide-react';
import { TextControl } from '../Controls';
import { Notice } from '../components/PageChrome';
import {
    applyProposal,
    chat,
    clearMyAi,
    fetchState,
    listFiles,
    myAiModels,
    myAiTest,
    rejectProposal,
    saveMyAi,
    type AssistantState,
    type ChatMessage,
    type FileEntry,
    type Proposal,
} from '../api';

/** 引导问题：以一条 AI 消息的形式出现在对话里，点击即发送。 */
const QUICK = [
    '服务器启动失败，帮我看看是什么原因',
    '控制台一直刷插件报错，帮我定位',
    '服务器很卡、TPS 很低，怎么排查',
    '玩家进不来，一直提示连接超时',
    '帮我写一个菜单插件，支持 /menu 打开',
    '帮我看看 server.properties 有没有可以优化的地方',
];

const TOOL_LABELS: Record<string, string> = {
    list_dir: '列目录',
    read_file: '读文件',
    grep: '搜索文本',
    web_search: '联网搜索',
};

const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name;

/** 附件上限：文件按内容读取，目录只列文件名。 */
const MAX_ATTACH_FILES = 5;
const MAX_ATTACH_DIRS = 3;

const AVATAR =
    'aia:flex aia:size-7 aia:shrink-0 aia:items-center aia:justify-center aia:rounded-full ' +
    'aia:bg-primary/15 aia:text-primary';

/** 会话按服务器隔离存在浏览器本地，刷新/重开页面都能接着聊。 */
const STORAGE_PREFIX = 'ext-ai-assistant:chat:';
const MAX_STORED = 60;

const loadHistory = (uuid: string): ChatMessage[] => {
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + uuid);

        if (raw === null) {
            return [];
        }

        const parsed: unknown = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.flatMap((item): ChatMessage[] => {
            if (typeof item !== 'object' || item === null) {
                return [];
            }

            const row = item as Partial<ChatMessage>;

            if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') {
                return [];
            }

            const usage =
                typeof row.usage === 'object' && row.usage !== null && typeof row.usage.total_tokens === 'number'
                    ? {
                          prompt_tokens: Number(row.usage.prompt_tokens) || 0,
                          completion_tokens: Number(row.usage.completion_tokens) || 0,
                          cached_tokens: Number(row.usage.cached_tokens) || 0,
                          cache_write_tokens: Number(row.usage.cache_write_tokens) || 0,
                          reasoning_tokens: Number(row.usage.reasoning_tokens) || 0,
                          total_tokens: Number(row.usage.total_tokens) || 0,
                      }
                    : undefined;

            return [
                {
                    role: row.role,
                    content: row.content,
                    charged: typeof row.charged === 'number' ? row.charged : undefined,
                    tokens: typeof row.tokens === 'number' ? row.tokens : undefined,
                    usage,
                    model: typeof row.model === 'string' ? row.model : undefined,
                    elapsedMs: typeof row.elapsedMs === 'number' ? row.elapsedMs : undefined,
                    truncated: row.truncated === true,
                },
            ];
        });
    } catch {
        return [];
    }
};

/** 只存文本与用量；待确认提案有有效期，不跨刷新保留。 */
const saveHistory = (uuid: string, messages: ChatMessage[]): void => {
    try {
        const slim = messages.slice(-MAX_STORED).map((message) => ({
            role: message.role,
            content: message.content,
            charged: message.charged,
            tokens: message.tokens,
            usage: message.usage,
            model: message.model,
            elapsedMs: message.elapsedMs,
            truncated: message.truncated === true,
        }));

        window.localStorage.setItem(STORAGE_PREFIX + uuid, JSON.stringify(slim));
    } catch {
        // 隐私模式或配额不足时静默放弃，不影响对话本身。
    }
};

const copyText = async (text: string): Promise<void> => {
    try {
        await navigator.clipboard.writeText(text);
        toast.success('已复制。');
    } catch {
        toast.error('复制失败，请手动选择文本。');
    }
};

/** 行内格式：`code`、**加粗**、*斜体*。 */
function Inline({ text }: { text: string }) {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g);

    return (
        <>
            {parts.map((part, index) => {
                if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
                    return (
                        <code
                            key={index}
                            className={
                                'aia:rounded aia:bg-background/60 aia:px-1 aia:py-0.5 aia:font-mono ' +
                                'aia:text-[12px]'
                            }
                        >
                            {part.slice(1, -1)}
                        </code>
                    );
                }

                if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
                    return (
                        <strong key={index} className={'aia:font-semibold'}>
                            {part.slice(2, -2)}
                        </strong>
                    );
                }

                if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
                    return (
                        <em key={index} className={'aia:italic'}>
                            {part.slice(1, -1)}
                        </em>
                    );
                }

                return <span key={index}>{part}</span>;
            })}
        </>
    );
}

/** 用户自己的输入按纯文本显示，避免 `*` `#` 被当成格式。 */
function PlainText({ text }: { text: string }) {
    return (
        <p className={'aia:whitespace-pre-wrap aia:break-words aia:text-sm aia:leading-relaxed'}>{text}</p>
    );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
    const [copied, setCopied] = useState(false);

    const copy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('复制失败，请手动选择。');
        }
    };

    return (
        <div className={'aia:mt-2 aia:overflow-hidden aia:rounded-sm aia:border aia:border-border'}>
            <div
                className={
                    'aia:flex aia:items-center aia:justify-between aia:bg-background/60 ' +
                    'aia:px-2 aia:py-1'
                }
            >
                <span className={'aia:font-mono aia:text-[11px] aia:text-muted-foreground'}>
                    {lang === '' ? 'code' : lang}
                </span>
                <button
                    type={'button'}
                    className={
                        'aia:cursor-pointer aia:text-[11px] aia:text-muted-foreground ' +
                        'aia:transition-colors hover:aia:text-foreground'
                    }
                    onClick={() => void copy()}
                >
                    {copied ? '已复制' : '复制'}
                </button>
            </div>
            <pre className={'aia:overflow-x-auto aia:bg-secondary/40 aia:p-3 aia:font-mono aia:text-xs'}>
                {code.trimEnd()}
            </pre>
        </div>
    );
}

/**
 * 轻量 Markdown：代码块、无序/有序列表、标题、加粗与行内代码。
 * 不引入第三方解析器，避免给面板增加依赖。
 */
function Reply({ text }: { text: string }) {
    const nodes: ReactNode[] = [];
    const lines = text.split('\n');
    let index = 0;
    let list: string[] = [];
    let ordered = false;
    let seq = 0;

    const flushList = (): void => {
        if (list.length === 0) {
            return;
        }

        const Tag = ordered ? 'ol' : 'ul';

        nodes.push(
            <Tag
                key={`list-${seq++}`}
                className={
                    (ordered ? 'aia:list-decimal' : 'aia:list-disc') +
                    ' aia:my-1.5 aia:pl-5 aia:text-sm aia:leading-relaxed aia:marker:text-muted-foreground'
                }
            >
                {list.map((item, position) => (
                    <li key={position}>
                        <Inline text={item} />
                    </li>
                ))}
            </Tag>
        );

        list = [];
    };

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        // 代码块
        if (trimmed.startsWith('```')) {
            flushList();
            ordered = false;

            const lang = trimmed.replace(/^```/, '').split(/\s+/)[0] ?? '';
            const code: string[] = [];
            index++;

            while (index < lines.length && !lines[index].trim().startsWith('```')) {
                code.push(lines[index]);
                index++;
            }

            index++;
            nodes.push(<CodeBlock key={`code-${seq++}`} code={code.join('\n')} lang={lang} />);

            continue;
        }

        // 分隔线
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            flushList();
            ordered = false;
            nodes.push(<hr key={`hr-${seq++}`} className={'aia:my-3 aia:border-border'} />);
            index++;

            continue;
        }

        // 标题
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);

        if (heading !== null) {
            flushList();
            ordered = false;

            const size = heading[1].length <= 2 ? 'aia:text-base' : 'aia:text-sm';

            nodes.push(
                <p
                    key={`h-${seq++}`}
                    className={`${size} aia:mt-2.5 aia:mb-0.5 aia:font-semibold aia:text-foreground`}
                >
                    <Inline text={heading[2]} />
                </p>
            );
            index++;

            continue;
        }

        // 引用
        if (trimmed.startsWith('>')) {
            flushList();
            ordered = false;
            nodes.push(
                <p
                    key={`q-${seq++}`}
                    className={
                        'aia:my-1 aia:border-l-2 aia:border-border aia:pl-3 aia:text-sm ' +
                        'aia:leading-relaxed aia:text-muted-foreground'
                    }
                >
                    <Inline text={trimmed.replace(/^>\s?/, '')} />
                </p>
            );
            index++;

            continue;
        }

        // 无序列表
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);

        if (bullet !== null) {
            if (ordered) {
                flushList();
                ordered = false;
            }

            list.push(bullet[1]);
            index++;

            continue;
        }

        // 有序列表
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

        if (numbered !== null) {
            if (!ordered) {
                flushList();
                ordered = true;
            }

            list.push(numbered[1]);
            index++;

            continue;
        }

        flushList();
        ordered = false;

        if (trimmed === '') {
            index++;

            continue;
        }

        nodes.push(
            <p
                key={`p-${seq++}`}
                className={'aia:whitespace-pre-wrap aia:break-words aia:text-sm aia:leading-relaxed'}
            >
                <Inline text={line} />
            </p>
        );
        index++;
    }

    flushList();

    return <div className={'aia:space-y-1'}>{nodes}</div>;
}

/** 待确认卡片：命令列出来，文件给路径 + 行数 + 预览，确认后才执行。 */
function ProposalCard({
    uuid,
    proposal,
    onSettled,
}: {
    uuid: string;
    proposal: Proposal;
    onSettled: (text: string) => void;
}) {
    const [pending, setPending] = useState(false);
    // 高风险命令必须再勾一次，避免「顺手点确认」把服务器停了。
    const [ack, setAck] = useState(false);

    const confirm = async (): Promise<void> => {
        setPending(true);

        try {
            const result = await applyProposal(uuid, proposal.id, ack);

            if (result.type === 'file') {
                const text = `已写入 ${result.path}（${result.bytes ?? 0} 字节）。`;
                toast.success(text);
                onSettled(text);
            } else {
                const commands = result.commands ?? [];
                toast.success('命令已发送。');
                onSettled(`已发送命令：${commands.join('；')}`);
            }
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setPending(false);
        }
    };

    const cancel = async (): Promise<void> => {
        setPending(true);

        try {
            await rejectProposal(uuid, proposal.id);
            onSettled('已取消该操作，没有对服务器做任何改动。');
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setPending(false);
        }
    };

    return (
        <div
            className={
                'aia:mt-2 aia:space-y-2 aia:rounded-sm aia:border aia:border-warning/60 ' +
                'aia:bg-warning/10 aia:p-3'
            }
        >
            <p className={'aia:text-xs aia:font-medium aia:text-warning'}>待确认操作（确认前不会执行）</p>

            {proposal.type === 'command' ? (
                <div className={'aia:space-y-1'}>
                    {(proposal.commands ?? []).map((command) => (
                        <code
                            key={command}
                            className={
                                'aia:block aia:overflow-x-auto aia:rounded-sm aia:bg-background/60 aia:px-2 ' +
                                'aia:py-1 aia:font-mono aia:text-xs'
                            }
                        >
                            {command}
                        </code>
                    ))}
                </div>
            ) : (
                <div className={'aia:space-y-2'}>
                    <p className={'aia:text-sm'}>
                        将写入 <code className={'aia:font-mono aia:text-xs'}>{proposal.path}</code>
                    </p>

                    <p
                        className={
                            'aia:text-xs ' +
                            (proposal.exists === true ? 'aia:text-warning' : 'aia:text-muted-foreground')
                        }
                    >
                        {proposal.lines} 行 · {proposal.bytes} 字节 ·{' '}
                        {proposal.exists === true ? '目标文件已存在，将被覆盖' : '目标文件不存在，将新建'}
                    </p>
                    <pre
                        className={
                            'aia:max-h-48 aia:overflow-auto aia:rounded-sm aia:bg-background/60 aia:p-2 ' +
                            'aia:font-mono aia:text-xs'
                        }
                    >
                        {proposal.preview}
                    </pre>
                </div>
            )}

            {proposal.reason !== null && <p className={'aia:text-xs aia:text-warning'}>{proposal.reason}</p>}

            {proposal.dangerous === true && (
                <label
                    className={
                        'aia:flex aia:cursor-pointer aia:items-start aia:gap-2 aia:rounded-sm ' +
                        'aia:border aia:border-destructive/40 aia:bg-destructive/10 aia:p-2 ' +
                        'aia:text-xs aia:text-destructive'
                    }
                >
                    <input
                        type={'checkbox'}
                        className={'aia:mt-0.5'}
                        checked={ack}
                        onChange={(event) => setAck(event.target.checked)}
                    />
                    我知道这会停机、改动权限或封禁玩家，仍要执行
                </label>
            )}

            <div className={'aia:flex aia:flex-wrap aia:items-center aia:justify-end aia:gap-2'}>
                <Button.Text type={'button'} size={'xsmall'} disabled={pending} onClick={() => void cancel()}>
                    取消
                </Button.Text>
                <Button
                    type={'button'}
                    size={'small'}
                    disabled={pending || !proposal.allowed || (proposal.dangerous === true && !ack)}
                    onClick={() => void confirm()}
                >
                    {pending ? '处理中…' : proposal.type === 'file' ? '确认写入' : '确认执行'}
                </Button>
            </div>
        </div>
    );
}

/**
 * 用户自带的 AI 凭据：填了自己的 Key 就花自己的额度，不扣平台积分。
 */
function MyAiDialog({
    uuid,
    state,
    onSaved,
}: {
    uuid: string;
    state: AssistantState['user_ai'];
    onSaved: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [provider, setProvider] = useState(state.provider === '' ? 'deepseek' : state.provider);
    const [model, setModel] = useState(state.model);
    const [baseUrl, setBaseUrl] = useState(
        state.base_url !== ''
            ? state.base_url
            : (state.providers.find((item) => item.value === (state.provider || 'deepseek'))?.url ?? '')
    );
    const [key, setKey] = useState('');
    const [searchProvider, setSearchProvider] = useState(state.search_provider);
    const [searchBaseUrl, setSearchBaseUrl] = useState(state.search_base_url);
    const [searchKey, setSearchKey] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [tested, setTested] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    // 面板给浮层留了 #modal-portal；挂在这里可以避开对话卡片的 overflow-hidden。
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
    const [placement, setPlacement] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

    useEffect(() => {
        setPortalHost(document.getElementById('modal-portal') ?? document.body);
    }, []);

    useEffect(() => {
        if (!open) {
            setPlacement(null);

            return;
        }

        const place = (): void => {
            const element = anchorRef.current;

            if (element === null) {
                return;
            }

            const rect = element.getBoundingClientRect();
            const margin = 8;
            const below = window.innerHeight - rect.bottom - margin * 2;
            const above = rect.top - margin * 2;
            // 下方放不下时改为向上展开，两种情况都不超出视口。
            const openUp = below < 360 && above > below;
            const maxHeight = Math.max(240, Math.min(openUp ? above : below, 660));

            setPlacement({
                top: openUp ? rect.top - maxHeight - margin : rect.bottom + margin,
                right: Math.max(margin, window.innerWidth - rect.right),
                maxHeight,
            });
        };

        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);

        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    /** 切换提供商时自动带出对应接口地址（用户手动改过就不覆盖）。 */
    const changeProvider = (value: string): void => {
        const previous = state.providers.find((item) => item.value === provider)?.url ?? '';
        const next = state.providers.find((item) => item.value === value)?.url ?? '';

        setProvider(value);

        if (baseUrl.trim() === '' || baseUrl.trim() === previous) {
            setBaseUrl(next);
        }

        setModels([]);
        setTested(null);
        setFailed(null);
    };

    const loadModels = async (): Promise<void> => {
        setBusy('models');
        setTested(null);
        setFailed(null);

        try {
            const list = await myAiModels(uuid, {
                provider,
                base_url: baseUrl.trim(),
                api_key: key.trim() === '' ? undefined : key.trim(),
            });

            setModels(list);

            if (list.length > 0 && !list.includes(model)) {
                setModel(list[0]);
            }

            toast.success(`已获取 ${list.length} 个模型。`);
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    const runTest = async (): Promise<void> => {
        setBusy('test');
        setTested(null);
        setFailed(null);

        try {
            const result = await myAiTest(uuid, {
                provider,
                base_url: baseUrl.trim(),
                model: model.trim(),
                api_key: key.trim() === '' ? undefined : key.trim(),
            });

            setTested(`可用：${result.model} · ${result.ms} ms · 回复「${result.reply}」`);
        } catch (cause) {
            setFailed(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    const save = async (): Promise<void> => {
        setBusy('save');

        try {
            await saveMyAi(uuid, {
                provider,
                model: model.trim(),
                base_url: baseUrl.trim(),
                api_key: key.trim() === '' ? undefined : key.trim(),
                search_provider: searchProvider,
                search_base_url: searchBaseUrl.trim(),
                search_api_key: searchKey.trim() === '' ? undefined : searchKey.trim(),
            });

            toast.success('已保存，接下来的对话使用你的额度，不扣积分。');
            setKey('');
            setOpen(false);
            onSaved();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    const clear = async (): Promise<void> => {
        setBusy('clear');

        try {
            await clearMyAi(uuid);
            toast.success('已清除，改回平台额度。');
            setOpen(false);
            onSaved();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    return (
        <span ref={anchorRef} className={'aia:relative'}>
            <button
                type={'button'}
                className={
                    'aia:cursor-pointer aia:rounded-sm aia:border aia:px-2 aia:py-1 aia:text-xs ' +
                    'aia:transition-colors ' +
                    (state.has_key
                        ? 'aia:border-success/50 aia:bg-success/10 aia:text-success'
                        : 'aia:border-border aia:bg-card aia:text-muted-foreground hover:aia:border-primary/60 hover:aia:text-foreground')
                }
                onClick={() => setOpen(!open)}
            >
                {state.has_key ? '我的额度 · 已启用' : '使用我的 API'}
            </button>

            {open && placement !== null && portalHost !== null &&
                createPortal(
                    <>
                        <div className={'aia:fixed aia:inset-0 aia:z-40'} onClick={() => setOpen(false)} />

                        <div
                            style={{
                                top: placement.top,
                                right: placement.right,
                                maxHeight: placement.maxHeight,
                            }}
                            className={
                                'aia:fixed aia:z-50 aia:flex aia:w-[24rem] aia:max-w-[calc(100vw-1rem)] ' +
                                'aia:flex-col aia:overflow-hidden aia:rounded-sm aia:border ' +
                                'aia:border-border aia:bg-card aia:shadow-lg'
                            }
                        >
                    <div className={'aia:min-h-0 aia:flex-1 aia:overflow-y-auto aia:p-3'}>
                    <p className={'aia:text-xs aia:text-muted-foreground'}>
                        填自己的 Key 后，对话消耗的是你的额度，
                        <strong className={'aia:text-foreground'}>不扣平台积分</strong>。
                    </p>

                    <div className={'aia:mt-2 aia:grid aia:gap-2'}>
                        <label className={'aia:grid aia:gap-1'}>
                            <span className={'aia:text-[11px] aia:text-muted-foreground'}>提供商</span>
                            <Select
                                id={'aia-my-provider'}
                                value={provider}
                                options={state.providers.map((item) => ({ value: item.value, label: item.label }))}
                                onChange={(value) => changeProvider(String(value))}
                            />
                        </label>

                        <label className={'aia:grid aia:gap-1'}>
                            <span className={'aia:text-[11px] aia:text-muted-foreground'}>接口地址</span>
                            <TextControl
                                type={'text'}
                                placeholder={'https://xxx/v1（部分提供商必填）'}
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                            />
                        </label>

                        <label className={'aia:grid aia:gap-1'}>
                            <span className={'aia:text-[11px] aia:text-muted-foreground'}>API Key</span>
                            <TextControl
                                type={'password'}
                                placeholder={state.has_key ? '已保存，留空不修改' : '粘贴你的 Key'}
                                value={key}
                                onChange={(event) => setKey(event.target.value)}
                            />
                        </label>

                        <label className={'aia:grid aia:gap-1'}>
                            <span className={'aia:text-[11px] aia:text-muted-foreground'}>模型</span>
                            <div className={'aia:flex aia:items-center aia:gap-2'}>
                                <div className={'aia:min-w-0 aia:flex-1'}>
                                    {models.length > 0 ? (
                                        <Select
                                            id={'aia-my-model'}
                                            value={model}
                                            options={models.map((id) => ({ value: id, label: id }))}
                                            onChange={(value) => setModel(String(value))}
                                        />
                                    ) : (
                                        <TextControl
                                            type={'text'}
                                            placeholder={'点「获取模型」或手动填写'}
                                            value={model}
                                            onChange={(event) => setModel(event.target.value)}
                                        />
                                    )}
                                </div>
                                <Button
                                    type={'button'}
                                    size={'small'}
                                    className={'aia:shrink-0'}
                                    disabled={busy !== null}
                                    onClick={() => void loadModels()}
                                >
                                    {busy === 'models' ? '获取中…' : '获取模型'}
                                </Button>
                            </div>
                        </label>
                    </div>

                    <div className={'aia:mt-2 aia:border-t aia:border-border aia:pt-2'}>
                        <p className={'aia:text-[11px] aia:text-muted-foreground'}>
                            搜索（可选）：平台没配的话，填自己的 Key 也能联网搜索
                            {state.has_search_key && (
                                <span className={'aia:text-success'}> · 已启用你自己的搜索</span>
                            )}
                        </p>

                        <div className={'aia:mt-1 aia:grid aia:gap-2'}>
                            <Select
                                id={'aia-my-search'}
                                value={searchProvider}
                                options={[
                                    { value: '', label: '不使用（跟随平台）' },
                                    { value: 'deepseek', label: 'DeepSeek 官方搜索' },
                                    { value: 'tavily', label: 'Tavily' },
                                    { value: 'serper', label: 'Serper（Google）' },
                                    { value: 'custom', label: '自定义接口（{query} 占位）' },
                                ]}
                                onChange={(value) => setSearchProvider(String(value))}
                            />

                            <TextControl
                                type={'password'}
                                placeholder={
                                    state.has_search_key ? '已保存，留空不修改' : '搜索服务的 API Key'
                                }
                                value={searchKey}
                                onChange={(event) => setSearchKey(event.target.value)}
                            />

                            <TextControl
                                type={'text'}
                                placeholder={
                                    searchProvider === 'custom'
                                        ? '必填：https://api.example.com/search?q={query}'
                                        : '搜索接口地址（留空用默认）'
                                }
                                value={searchBaseUrl}
                                onChange={(event) => setSearchBaseUrl(event.target.value)}
                            />
                        </div>
                    </div>

                    <div className={'aia:mt-2 aia:flex aia:flex-wrap aia:items-center aia:gap-2'}>
                        <Button.Text
                            type={'button'}
                            size={'small'}
                            disabled={busy !== null}
                            onClick={() => void runTest()}
                        >
                            {busy === 'test' ? '测试中…' : '测试连接'}
                        </Button.Text>
                        {tested !== null && (
                            <span className={'aia:text-[11px] aia:text-success'}>{tested}</span>
                        )}
                        {failed !== null && (
                            <span className={'aia:text-[11px] aia:text-warning'}>{failed}</span>
                        )}
                    </div>
                    </div>

                    <div
                        className={
                            'aia:flex aia:shrink-0 aia:items-center aia:justify-end aia:gap-2 ' +
                            'aia:border-t aia:border-border aia:px-3 aia:py-2'
                        }
                    >
                        {state.has_key && (
                            <Button.Text
                                type={'button'}
                                size={'small'}
                                disabled={busy !== null}
                                onClick={() => void clear()}
                            >
                                改回平台
                            </Button.Text>
                        )}
                        <Button.Text
                            type={'button'}
                            size={'small'}
                            className={'aia:w-20'}
                            disabled={busy !== null}
                            onClick={() => setOpen(false)}
                        >
                            取消
                        </Button.Text>
                        <Button
                            type={'button'}
                            size={'small'}
                            className={'aia:w-20'}
                            disabled={busy !== null}
                            onClick={() => void save()}
                        >
                            {busy === 'save' ? '保存中…' : '保存'}
                        </Button>
                    </div>
                        </div>
                    </>,
                    portalHost
                )}
        </span>
    );
}

/** 目录/文件选择器：只在白名单目录内浏览，勾选后随请求一起发送。 */
function AttachPicker({
    uuid,
    files,
    dirs,
    onFiles,
    onDirs,
}: {
    uuid: string;
    files: FileEntry[];
    dirs: FileEntry[];
    onFiles: (items: FileEntry[]) => void;
    onDirs: (items: FileEntry[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [dir, setDir] = useState('');

    const listing = useQuery({
        queryKey: ['ext-ai-assistant', 'files', uuid, dir],
        queryFn: () => listFiles(uuid, dir),
        enabled: open,
        retry: false,
    });

    const filePaths = files.map((item) => item.path);
    const dirPaths = dirs.map((item) => item.path);
    const items = listing.data?.items ?? [];
    const visibleFiles = items.filter((item) => item.is_file === true);

    const toggleFile = (entry: FileEntry): void => {
        if (filePaths.includes(entry.path)) {
            onFiles(files.filter((item) => item.path !== entry.path));

            return;
        }

        if (files.length >= MAX_ATTACH_FILES) {
            toast.error(`一次最多附加 ${MAX_ATTACH_FILES} 个文件。`);

            return;
        }

        onFiles([...files, entry]);
    };

    const toggleDir = (entry: FileEntry): void => {
        if (dirPaths.includes(entry.path)) {
            onDirs(dirs.filter((item) => item.path !== entry.path));

            return;
        }

        if (dirs.length >= MAX_ATTACH_DIRS) {
            toast.error(`一次最多勾选 ${MAX_ATTACH_DIRS} 个文件夹。`);

            return;
        }

        onDirs([...dirs, entry]);
    };

    /** 全选当前目录里的文件（受总数上限约束）。 */
    const selectAll = (): void => {
        const next = [...files];

        for (const item of visibleFiles) {
            if (next.length >= MAX_ATTACH_FILES) {
                break;
            }

            if (!next.some((row) => row.path === item.path)) {
                next.push(item);
            }
        }

        const added = next.length - files.length;
        onFiles(next);

        if (added === 0 && visibleFiles.length > 0) {
            toast.error(`最多只能选 ${MAX_ATTACH_FILES} 个文件。`);
        }
    };

    /** 反选：把当前目录里已选的取消、未选的选上。 */
    const invert = (): void => {
        const inverted = visibleFiles
            .filter((item) => !filePaths.includes(item.path))
            .slice(0, MAX_ATTACH_FILES);

        onFiles(inverted);
    };

    /** 根目录没有对应的目录项，用一个 path 为空的虚拟条目表示。 */
    // 根目录用「.」表示而不是空字符串：空串在请求体与校验链路上容易被当成空值。
    const ROOT_ENTRY: FileEntry = { name: '（根目录）', path: '.', is_file: false, size: 0 };

    const toggleRoot = (): void => {
        if (dirPaths.includes('.')) {
            onDirs(dirs.filter((item) => item.path !== '.'));

            return;
        }

        if (dirs.length >= MAX_ATTACH_DIRS) {
            toast.error(`一次最多勾选 ${MAX_ATTACH_DIRS} 个目录。`);

            return;
        }

        onDirs([...dirs, ROOT_ENTRY]);
    };

    const chips = [
        ...files.map((entry) => ({ entry, kind: 'file' as const })),
        ...dirs.map((entry) => ({ entry, kind: 'dir' as const })),
    ];

    return (
        <div className={'aia:relative aia:flex aia:flex-wrap aia:items-center aia:gap-1.5 aia:pb-1.5'}>
            {chips.map(({ entry, kind }) => (
                <span
                    key={`${kind}:${entry.path}`}
                    className={
                        'aia:flex aia:items-center aia:gap-1 aia:rounded-sm aia:border ' +
                        'aia:px-2 aia:py-0.5 aia:font-mono aia:text-[11px] ' +
                        (kind === 'dir'
                            ? 'aia:border-warning/50 aia:bg-warning/10 aia:text-foreground'
                            : 'aia:border-primary/40 aia:bg-primary/10 aia:text-foreground')
                    }
                >
                    {kind === 'dir' ? '目录 · ' : '文件 · '}
                    {entry.path === '.' ? '（根目录）' : entry.path}
                    <button
                        type={'button'}
                        aria-label={`移除 ${entry.path === '.' ? '根目录' : entry.path}`}
                        className={
                            'aia:cursor-pointer aia:text-muted-foreground aia:transition-colors ' +
                            'hover:aia:text-destructive'
                        }
                        onClick={() => (kind === 'dir' ? toggleDir(entry) : toggleFile(entry))}
                    >
                        ×
                    </button>
                </span>
            ))}

            <button
                type={'button'}
                className={
                    'aia:cursor-pointer aia:rounded-sm aia:border aia:border-border aia:bg-card ' +
                    'aia:px-2 aia:py-0.5 aia:text-[11px] aia:text-muted-foreground ' +
                    'aia:transition-colors hover:aia:border-primary/60 hover:aia:text-foreground'
                }
                onClick={() => setOpen(!open)}
            >
                {open ? '收起' : '附件'}
            </button>

            {open && (
                <div
                    className={
                        'aia:absolute aia:bottom-full aia:left-0 aia:z-30 aia:mb-2 aia:w-96 ' +
                        'aia:max-w-full aia:rounded-sm aia:border aia:border-border aia:bg-card ' +
                        'aia:p-2 aia:shadow-lg'
                    }
                >
                    <div className={'aia:flex aia:items-center aia:gap-2 aia:text-xs'}>
                        <code className={'aia:min-w-0 aia:truncate aia:text-muted-foreground'}>
                            /{dir === '' ? '（根目录）' : dir}
                        </code>

                        {dir === '' && (
                            <label
                                className={
                                    'aia:flex aia:shrink-0 aia:cursor-pointer aia:items-center ' +
                                    'aia:gap-1 aia:text-[11px] aia:text-muted-foreground'
                                }
                            >
                                <input
                                    type={'checkbox'}
                                    className={'aia:shrink-0'}
                                    checked={dirPaths.includes('.')}
                                    onChange={toggleRoot}
                                />
                                勾选根目录
                            </label>
                        )}

                        <span className={'aia:flex-1'} />

                        {listing.data?.parent != null && (
                            <button
                                type={'button'}
                                className={
                                    'aia:cursor-pointer aia:text-xs aia:text-muted-foreground ' +
                                    'hover:aia:text-foreground'
                                }
                                onClick={() => setDir(listing.data?.parent ?? '')}
                            >
                                上一级
                            </button>
                        )}
                    </div>

                    <div className={'aia:mt-2 aia:max-h-56 aia:overflow-y-auto'}>
                        {listing.isLoading && (
                            <p className={'aia:px-2 aia:py-1 aia:text-xs aia:text-muted-foreground'}>读取中…</p>
                        )}

                        {listing.isError && (
                            <p className={'aia:px-2 aia:py-1 aia:text-xs aia:text-warning'}>
                                {httpErrorToHuman(listing.error)}
                            </p>
                        )}

                        {items.map((entry) => {
                            const isFile = entry.is_file === true;
                            const checked = isFile ? filePaths.includes(entry.path) : dirPaths.includes(entry.path);

                            return (
                                <div
                                    key={entry.path}
                                    className={
                                        'aia:flex aia:items-center aia:gap-1 aia:rounded-sm ' +
                                        'aia:px-1 hover:aia:bg-secondary/60'
                                    }
                                >
                                    <label
                                        className={
                                            'aia:flex aia:min-w-0 aia:flex-1 aia:cursor-pointer ' +
                                            'aia:items-center aia:gap-2 aia:px-1 aia:py-1'
                                        }
                                    >
                                        <input
                                            type={'checkbox'}
                                            className={'aia:shrink-0'}
                                            checked={checked}
                                            onChange={() => (isFile ? toggleFile(entry) : toggleDir(entry))}
                                        />
                                        <span
                                            className={
                                                'aia:truncate aia:text-xs ' + (isFile ? 'aia:font-mono' : '')
                                            }
                                        >
                                            {entry.name}
                                            {isFile ? '' : '/'}
                                        </span>
                                        {!isFile && (
                                            <span
                                                className={
                                                    'aia:shrink-0 aia:rounded-sm aia:bg-secondary/60 ' +
                                                    'aia:px-1 aia:text-[10px] aia:text-muted-foreground'
                                                }
                                            >
                                                文件夹
                                            </span>
                                        )}
                                    </label>

                                    {isFile ? (
                                        <span
                                            className={
                                                'aia:shrink-0 aia:pr-1 aia:text-[10px] aia:text-muted-foreground'
                                            }
                                        >
                                            {entry.size > 1024
                                                ? `${Math.round(entry.size / 1024)} KB`
                                                : `${entry.size} B`}
                                        </span>
                                    ) : (
                                        <button
                                            type={'button'}
                                            className={
                                                'aia:shrink-0 aia:cursor-pointer aia:px-1 aia:text-[11px] ' +
                                                'aia:text-muted-foreground hover:aia:text-primary'
                                            }
                                            onClick={() => setDir(entry.path)}
                                        >
                                            进入 ▸
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {!listing.isLoading && items.length === 0 && (
                            <p className={'aia:px-2 aia:py-1 aia:text-xs aia:text-muted-foreground'}>
                                这个目录没有可读文件。
                            </p>
                        )}
                    </div>

                    <div
                        className={
                            'aia:mt-2 aia:space-y-1 aia:border-t aia:border-border aia:pt-2 ' +
                            'aia:text-[11px] aia:text-muted-foreground'
                        }
                    >
                        <div className={'aia:flex aia:items-center aia:gap-2'}>
                            <button
                                type={'button'}
                                className={
                                    'aia:cursor-pointer aia:rounded-sm aia:border aia:border-border ' +
                                    'aia:bg-card aia:px-2 aia:py-0.5 hover:aia:border-primary/60 ' +
                                    'hover:aia:text-foreground'
                                }
                                onClick={selectAll}
                            >
                                全选当前目录
                            </button>
                            <button
                                type={'button'}
                                className={
                                    'aia:cursor-pointer aia:rounded-sm aia:border aia:border-border ' +
                                    'aia:bg-card aia:px-2 aia:py-0.5 hover:aia:border-primary/60 ' +
                                    'hover:aia:text-foreground'
                                }
                                onClick={invert}
                            >
                                反选
                            </button>
                            <button
                                type={'button'}
                                className={'aia:ml-auto aia:cursor-pointer hover:aia:text-foreground'}
                                onClick={() => setOpen(false)}
                            >
                                完成
                            </button>
                        </div>

                        <p>
                            已选 {files.length} 个文件 · {dirs.length} 个目录。勾选文件夹只把文件名给 AI，
                            不读内容；点「进入」可浏览下一级。
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AssistantScreen() {
    // server 页的地址是 /server/<uuid>/ai-assistant
    const uuid = useMemo(() => window.location.pathname.split('/')[2] ?? '', []);

    const state = useQuery({
        queryKey: ['ext-ai-assistant', 'state', uuid],
        queryFn: () => fetchState(uuid),
        enabled: uuid !== '',
        retry: false,
    });

    const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(uuid));
    const [input, setInput] = useState('');
    const [withLogs, setWithLogs] = useState(true);
    // 用户主动附加的文件：只有这里勾选的才会被读取。
    const [attachedFiles, setAttachedFiles] = useState<FileEntry[]>([]);
    const [attachedDirs, setAttachedDirs] = useState<FileEntry[]>([]);
    const [pending, setPending] = useState(false);
    const [balance, setBalance] = useState<number | null>(null);

    const bottom = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    // 每次消息变动都落盘，刷新后原样恢复。
    useEffect(() => {
        saveHistory(uuid, messages);
    }, [uuid, messages]);

    const scrollDown = (): void => {
        requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    };

    // 输入框随内容长高，最多 8 行。
    useEffect(() => {
        const element = inputRef.current;

        if (element === null) {
            return;
        }

        element.style.height = 'auto';
        element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
    }, [input]);

    const clearChat = (): void => {
        setMessages([]);

        try {
            window.localStorage.removeItem(STORAGE_PREFIX + uuid);
        } catch {
            // 忽略
        }

        toast.success('已清空对话，AI 不再参考之前的上下文。');
    };

    const sendWith = async (history: ChatMessage[], text: string): Promise<void> => {
        const content = text.trim();

        if (content === '' || pending) {
            return;
        }

        const next: ChatMessage[] = [...history, { role: 'user', content }];
        setMessages(next);
        setInput('');
        setPending(true);
        scrollDown();

        try {
            const result = await chat(
                uuid,
                next,
                withLogs,
                attachedFiles.map((item) => item.path),
                attachedDirs.map((item) => item.path)
            );

            setMessages([
                ...next,
                {
                    role: 'assistant',
                    content: result.reply,
                    proposal: result.proposal,
                    charged: result.charged,
                    tokens: result.usage.total_tokens,
                    usage: result.usage,
                    model: result.model,
                    elapsedMs: result.elapsed_ms,
                    truncated: result.truncated,
                    trace: result.trace,
                },
            ]);
            setBalance(result.balance);
            scrollDown();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
            setMessages(history);
            setInput(content);
        } finally {
            setPending(false);
        }
    };

    const send = (text: string): Promise<void> => sendWith(messages, text);

    /** 重试最后一条提问：丢掉那次回答，重新问一遍。 */
    const retryLast = (): void => {
        const lastUser = messages.map((message, index) => ({ message, index })).filter(
            (item) => item.message.role === 'user'
        ).pop();

        if (lastUser === undefined) {
            return;
        }

        const history = messages.slice(0, lastUser.index);
        setMessages(history);
        void sendWith(history, lastUser.message.content);
    };

    const settle = (index: number, text: string): void => {
        setMessages((current) =>
            current
                .map((message, position) => (position === index ? { ...message, proposal: null } : message))
                .concat({ role: 'assistant', content: text })
        );
        scrollDown();
    };

    if (uuid === '') {
        return <p className={'aia:text-sm aia:text-muted-foreground'}>无法识别当前服务器。</p>;
    }

    if (state.isLoading) {
        return <Spinner size={'large'} centered />;
    }

    if (state.isError || state.data === undefined) {
        return (
            <PageContentBlock title={'AI 助手'}>
                <div className={'aia:grid aia:gap-3'}>
                    <Notice id={'server-load-error'} tone={'error'} title={'读取配置失败'} dismissible={false}>
                        {httpErrorToHuman(state.error)}
                    </Notice>
                </div>
            </PageContentBlock>
        );
    }

    const data = state.data;

    if (!data.enabled) {
        return (
            <PageContentBlock title={'AI 助手'}>
                <div className={'aia:grid aia:gap-3'}>
                    <Notice id={'server-disabled'} tone={'info'} title={'此服务器未开放 AI 助手'} dismissible={false}>
                        {data.scope === 'tags' && data.tags.length > 0
                            ? `当前仅对标签「${data.tags.join('、')}」的预设开放，如需使用请联系管理员。`
                            : '如需使用，请联系管理员开启。'}
                    </Notice>
                </div>
            </PageContentBlock>
        );
    }

    const currentBalance = balance ?? data.charge.balance;

    return (
        <PageContentBlock title={'AI 助手'}>
            <div className={'aia:flex aia:flex-col aia:gap-3'}>
                {!data.has_key && !data.user_ai.has_key && (
                    <Notice id={'server-no-key'} tone={'error'} title={'AI 服务暂不可用'} dismissible={false}>
                        平台尚未完成 AI 接口配置，请联系管理员处理；你也可以在「使用我的 API」中填写自己的密钥后继续使用。
                    </Notice>
                )}

                {data.user_ai.has_key && (
                    <Notice id={'server-own-key'} tone={'success'} title={'正在使用你提供的 API 密钥'}>
                        相关调用费用由你自行承担，不计入平台积分；操作权限仍受平台规则限制。
                    </Notice>
                )}

                {data.charge.enabled && currentBalance !== null && currentBalance <= 0 && (
                    <Notice id={'server-no-credit'} tone={'warning'} title={'积分余额不足'}>
                        当前余额不足以发起新的对话，可在「我的积分」中查看明细；也可在「使用我的 API」中填写自己的密钥。
                    </Notice>
                )}

                {/* 对话卡片：固定高度、内部滚动，与控制台终端同一视觉规格 */}
                <div
                    className={
                        'aia:flex aia:h-[calc(100dvh-17rem)] aia:min-h-[22rem] aia:max-h-[64rem] ' +
                        'aia:flex-col aia:overflow-hidden aia:rounded-sm aia:border aia:border-border ' +
                        'aia:bg-card aia:shadow-md'
                    }
                >
                    {/* 卡片顶部工具条：额度信息在左，操作在右，不额外占用页面标头 */}
                    <div
                        className={
                            'aia:flex aia:flex-wrap aia:items-center aia:justify-between aia:gap-2 ' +
                            'aia:border-b aia:border-border aia:px-3 aia:py-2'
                        }
                    >
                        <span className={'aia:text-xs aia:text-muted-foreground'}>
                            {data.user_ai.has_key ? (
                                <span className={'aia:text-success'}>使用我的额度</span>
                            ) : (
                                '平台额度'
                            )}
                            {data.charge.enabled && currentBalance !== null && ` · 余额 ${currentBalance}`}
                            {data.daily.limit > 0 &&
                                data.daily.remaining !== null &&
                                ` · 今日剩余 ${data.daily.remaining} 次`}
                            {data.daily.tokens_limit > 0 &&
                                data.daily.tokens_remaining !== null &&
                                ` · 剩余 ${data.daily.tokens_remaining} Token`}
                        </span>

                        <div className={'aia:flex aia:shrink-0 aia:items-center aia:gap-2'}>
                            <MyAiDialog
                                uuid={uuid}
                                state={data.user_ai}
                                onSaved={() => void state.refetch()}
                            />

                            {messages.length > 0 && (
                                <button
                                    type={'button'}
                                    className={
                                        'aia:cursor-pointer aia:rounded-sm aia:border aia:border-border ' +
                                        'aia:bg-card aia:px-2 aia:py-1 aia:text-xs aia:text-muted-foreground ' +
                                        'aia:transition-colors hover:aia:border-destructive/60 ' +
                                        'hover:aia:text-destructive'
                                    }
                                    onClick={clearChat}
                                >
                                    清空对话
                                </button>
                            )}
                        </div>
                    </div>

                    <div className={'aia:flex-1 aia:overflow-y-auto aia:px-4 aia:py-4'}>
                        <div className={'aia:flex aia:flex-col aia:gap-4'}>
                            {messages.length === 0 && (
                                <div className={'aia:flex aia:gap-2.5'}>
                                    <span className={AVATAR}>
                                        <Sparkles className={'aia:size-3.5'} />
                                    </span>

                                    <div
                                        className={
                                            'aia:max-w-[85%] aia:rounded-md aia:rounded-tl-sm ' +
                                            'aia:bg-secondary/50 aia:px-4 aia:py-3'
                                        }
                                    >
                                        <p className={'aia:text-sm aia:leading-relaxed'}>
                                            你好，我是这台服务器的运维助手，可以看日志、查配置、给修复方案。
                                            你可以这样问我：
                                        </p>
                                        <div className={'aia:mt-2 aia:flex aia:flex-col aia:gap-1.5'}>
                                            {QUICK.map((question) => (
                                                <button
                                                    key={question}
                                                    type={'button'}
                                                    className={
                                                        'aia:cursor-pointer aia:rounded-sm aia:border ' +
                                                        'aia:border-border aia:bg-card aia:px-3 aia:py-2 ' +
                                                        'aia:text-left aia:text-sm aia:text-foreground ' +
                                                        'aia:transition-colors hover:aia:border-primary/60 ' +
                                                        'hover:aia:bg-primary/5'
                                                    }
                                                    onClick={() => void send(question)}
                                                >
                                                    {question}
                                                </button>
                                            ))}
                                        </div>
                                        <p className={'aia:mt-2 aia:text-[11px] aia:text-muted-foreground'}>
                                            也可以直接粘贴控制台报错。
                                        </p>
                                    </div>
                                </div>
                            )}

                            {messages.map((message, index) => (
                                <div
                                    key={index}
                                    className={
                                        message.role === 'user'
                                            ? 'aia:flex aia:justify-end'
                                            : 'aia:flex aia:justify-start aia:gap-2.5'
                                    }
                                >
                                    {message.role === 'assistant' && (
                                        <span className={AVATAR}>
                                            <Sparkles className={'aia:size-3.5'} />
                                        </span>
                                    )}

                                    <div
                                        className={
                                            message.role === 'user'
                                                ? 'aia:max-w-[82%] aia:rounded-md aia:rounded-br-sm ' +
                                                  'aia:bg-primary aia:px-4 aia:py-2.5 aia:text-primary-foreground'
                                                : 'aia:max-w-[82%] aia:rounded-md aia:rounded-tl-sm ' +
                                                  'aia:bg-secondary/50 aia:px-4 aia:py-2.5'
                                        }
                                    >
                                        {message.role === 'user' ? (
                                            <PlainText text={message.content} />
                                        ) : (
                                            <Reply text={message.content} />
                                        )}

                                        {message.proposal != null && (
                                            <ProposalCard
                                                uuid={uuid}
                                                proposal={message.proposal}
                                                onSettled={(text) => settle(index, text)}
                                            />
                                        )}

                                        {(message.trace ?? []).length > 0 && (
                                            <div
                                                className={
                                                    'aia:mt-2 aia:space-y-0.5 aia:rounded-sm aia:border ' +
                                                    'aia:border-border aia:bg-background/40 aia:p-2 ' +
                                                    'aia:text-[11px] aia:text-muted-foreground'
                                                }
                                            >
                                                {(message.trace ?? []).map((item, position) => (
                                                    <div key={position} className={'aia:truncate'}>
                                                        <span className={'aia:text-foreground'}>
                                                            {toolLabel(item.name)}
                                                        </span>
                                                        {' · '}
                                                        {item.summary}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {message.role === 'assistant' && (message.charged ?? 0) > 0 && (
                                            <p className={'aia:mt-2 aia:text-[11px] aia:text-muted-foreground'}>
                                                本次消耗 {message.charged} 积分
                                            </p>
                                        )}

                                        {message.role === 'assistant' && message.truncated === true && (
                                            <p className={'aia:mt-1.5 aia:text-[11px] aia:text-warning'}>
                                                本次回复达到单次输出上限，内容可能不完整。可以继续追问「请接着上面说完」，或联系管理员调高上限。
                                            </p>
                                        )}

                                        {message.role === 'assistant' && (
                                            <div
                                                className={
                                                    'aia:mt-2 aia:flex aia:flex-wrap aia:items-center ' +
                                                    'aia:gap-3 aia:text-[11px] aia:text-muted-foreground'
                                                }
                                            >
                                                <button
                                                    type={'button'}
                                                    className={
                                                        'aia:flex aia:cursor-pointer aia:items-center aia:gap-1 ' +
                                                        'aia:transition-colors hover:aia:text-foreground'
                                                    }
                                                    onClick={() => void copyText(message.content)}
                                                >
                                                    <Copy className={'aia:size-3'} />
                                                    复制
                                                </button>

                                                {index === messages.length - 1 && !pending && (
                                                    <button
                                                        type={'button'}
                                                        className={
                                                            'aia:flex aia:cursor-pointer aia:items-center aia:gap-1 ' +
                                                            'aia:transition-colors hover:aia:text-foreground'
                                                        }
                                                        onClick={retryLast}
                                                    >
                                                        <RefreshCw className={'aia:size-3'} />
                                                        重试
                                                    </button>
                                                )}

                                                {(message.charged ?? 0) > 0 && (
                                                    <span>
                                                        {message.charged} 积分 · {message.tokens ?? 0} Token
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {pending && (
                                <div className={'aia:flex aia:items-center aia:gap-2.5'}>
                                    <span className={AVATAR}>
                                        <Sparkles className={'aia:size-3.5'} />
                                    </span>
                                    <span className={'aia:text-xs aia:text-muted-foreground'}>
                                        AI 正在分析…
                                    </span>
                                </div>
                            )}

                            <div ref={bottom} />
                        </div>
                    </div>

                    {/* 输入区：贴在卡片底部，与终端命令行同一位置关系 */}
                    <div className={'aia:border-t aia:border-border aia:bg-popover/40 aia:px-3 aia:py-2.5'}>
                        {data.can_read && (
                            <AttachPicker
                                uuid={uuid}
                                files={attachedFiles}
                                dirs={attachedDirs}
                                onFiles={setAttachedFiles}
                                onDirs={setAttachedDirs}
                            />
                        )}

                        <div
                            className={
                                'aia:flex aia:items-end aia:gap-2 aia:rounded-sm aia:border ' +
                                'aia:border-border aia:bg-card aia:p-1.5 aia:transition-colors ' +
                                'focus-within:aia:border-primary'
                            }
                        >
                            <textarea
                                ref={inputRef}
                                rows={1}
                                value={input}
                                placeholder={'描述问题，或粘贴控制台报错…'}
                                aria-label={'输入问题'}
                                disabled={pending}
                                className={
                                    'aia:max-h-40 aia:min-h-9 aia:flex-1 aia:resize-none aia:border-0 ' +
                                    'aia:bg-transparent aia:px-2 aia:py-2 aia:text-sm aia:text-foreground ' +
                                    'aia:outline-none aia:placeholder:text-muted-foreground ' +
                                    'aia:disabled:cursor-not-allowed aia:disabled:opacity-60'
                                }
                                onChange={(event) => setInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        void send(input);
                                    }
                                }}
                            />

                            <button
                                type={'button'}
                                aria-label={'发送'}
                                disabled={pending || input.trim() === ''}
                                className={
                                    'aia:mb-0.5 aia:flex aia:size-9 aia:shrink-0 aia:cursor-pointer ' +
                                    'aia:items-center aia:justify-center aia:rounded-sm aia:bg-primary ' +
                                    'aia:text-primary-foreground aia:transition-colors ' +
                                    'hover:aia:bg-primary/85 ' +
                                    'disabled:aia:cursor-not-allowed disabled:aia:opacity-40'
                                }
                                onClick={() => void send(input)}
                            >
                                <Send className={'aia:size-4'} />
                            </button>
                        </div>

                        <div
                            className={
                                'aia:mt-2 aia:flex aia:flex-wrap aia:items-center aia:justify-between ' +
                                'aia:gap-2 aia:text-[11px] aia:text-muted-foreground'
                            }
                        >
                            <label className={'aia:flex aia:cursor-pointer aia:items-center aia:gap-2'}>
                                <Switch checked={withLogs} onChange={setWithLogs} />
                                附带日志、mods 列表与崩溃报告
                            </label>
                            <span>
                                {data.search_credits > 0 && `联网搜索每次扣 ${data.search_credits} 积分 · `}
                                Enter 发送 · Shift + Enter 换行
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </PageContentBlock>
    );
}
