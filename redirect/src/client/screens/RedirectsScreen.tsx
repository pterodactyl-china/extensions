import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, ExternalLink, Link2, Pencil, Search, Trash2 } from 'lucide-react';
import {
    Alert,
    Button,
    Dialog,
    Form,
    Icon,
    Input,
    Label,
    PageContentBlock,
    Spinner,
    Switch,
    Table,
    httpErrorToHuman,
    toast,
    useAppForm,
    useFieldContext,
    type TableColumn,
} from '@pterodactyl/sdk';
import { usePresence } from '../presence';
import {
    createRedirect,
    deleteRedirect,
    fetchRedirects,
    updateRedirect,
    type RedirectInput,
    type ShortRedirect,
} from '../api';

// The panel's Button wraps its children in an inline element, so icon-and-label spacing
// has to come from a wrapper inside the button rather than from the button itself.
const ICON_LABEL = 'rdr:inline-flex rdr:items-center rdr:gap-1.5';

const QUERY_KEY = ['ext-redirect', 'all'] as const;

/* ---------------------------------------------------------------------------------------
 * Validation. These mirror src/Http/Requests/RedirectRequest.php and
 * src/Rules/AbsoluteHttpUrl.php, so a value that passes here passes on the server
 * (apart from a name another admin takes in the meantime, which the server reports).
 * ------------------------------------------------------------------------------------- */

const SLUG_MAX = 64;
const TARGET_MAX = 2048;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

/** What the server does before validating (trim + lowercase), plus spaces to hyphens. */
const normaliseSlug = (value: string): string => value.toLowerCase().replace(/\s/g, '-');

const validateSlug = (value: string, taken: ReadonlySet<string>): string | undefined => {
    const slug = value.trim().toLowerCase();

    if (slug === '') return '请输入短链接的名称。';
    if ([...slug].length > SLUG_MAX) return `请使用 ${SLUG_MAX} 个以内的字符。`;
    if (!SLUG_PATTERN.test(slug)) {
        return /^[a-z0-9_-]+$/.test(slug) ? '请以字母或数字开头和结尾。' : '只能使用字母、数字、连字符和下划线。';
    }
    if (taken.has(slug)) return '已有其他链接使用了该名称。';

    return undefined;
};

const validateTarget = (value: string): string | undefined => {
    const url = value.trim();

    if (url === '') return '请输入此链接要打开的地址。';
    if ([...url].length > TARGET_MAX || new TextEncoder().encode(url).length > TARGET_MAX) {
        return `请使用 ${TARGET_MAX.toLocaleString()} 个以内的字符。`;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x20\x7f\\]/.test(url)) return '地址中不能包含空格和反斜杠。';
    if (!/^https?:\/\/[^/?#]/i.test(url)) {
        return '请输入以 https:// 或 http:// 开头的完整地址';
    }

    const authority = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] ?? '';
    if (authority.includes('@')) return '不允许包含用户名或密码的地址。';

    const port = /:(\d*)$/.exec(authority);
    const host = port ? authority.slice(0, port.index) : authority;
    if (host === '' || (port && Number(port[1]) > 65535) || (!port && /:[^\]]*$/.test(authority))) {
        return '请输入以 https:// 或 http:// 开头的完整地址';
    }

    return undefined;
};

/** Field-level messages from a 422 response, keyed by the field the server blamed. */
const serverFieldErrors = (cause: unknown): Partial<Record<'slug' | 'target', string>> => {
    const response = (cause as { response?: { status?: number; data?: unknown } } | null)?.response;
    const errors = (response?.data as { errors?: unknown } | undefined)?.errors;
    if (response?.status !== 422 || !Array.isArray(errors)) return {};

    const found: Partial<Record<'slug' | 'target', string>> = {};
    for (const entry of errors as { detail?: unknown; meta?: { source_field?: unknown; rule?: unknown } }[]) {
        const field = entry?.meta?.source_field;
        if ((field !== 'slug' && field !== 'target') || found[field] || typeof entry.detail !== 'string') continue;
        found[field] =
            field === 'slug' && (entry.meta?.rule === 'unique' || /taken/i.test(entry.detail))
                ? '已有其他链接使用了该名称。'
                : entry.detail;
    }

    return found;
};

/* ---------------------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------------------- */

/** Where short links live, e.g. "https://panel.example/go/". Taken from the server when it told us. */
const linkBaseOf = (rows: readonly ShortRedirect[]): string => {
    const sample = rows.find((row) => row.url.endsWith(`/${row.slug}`));

    return sample ? sample.url.slice(0, sample.url.length - sample.slug.length) : `${window.location.origin}/go/`;
};

/** "https://panel.example/go/" -> "panel.example" */
const hostOf = (base: string): string => base.replace(/^https?:\/\//i, '').replace(/\/go\/$/, '');

const clicksLabel = (hits: number): string => `${hits.toLocaleString()} 次点击`;

const RELATIVE_STEPS: [limit: number, seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
    [3600, 60, 'minute'],
    [86400, 3600, 'hour'],
    [86400 * 30, 86400, 'day'],
    [86400 * 365, 86400 * 30, 'month'],
    [Infinity, 86400 * 365, 'year'],
];

const timeAgo = (iso: string): string => {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return '刚刚';

    const [, size, unit] = RELATIVE_STEPS.find(([limit]) => seconds < limit) ?? RELATIVE_STEPS[4]!;

    return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-Math.floor(seconds / size), unit);
};

/** Clipboard API where available, with a fallback for panels served over plain http. */
const copyText = async (text: string, near: HTMLElement): Promise<boolean> => {
    if (window.isSecureContext && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the legacy path.
        }
    }

    // Inserted next to the button so it also works inside a dialog's focus trap.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    (near.parentElement ?? document.body).appendChild(area);
    area.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    }
    area.remove();
    near.focus();

    return copied;
};

const subscribeWide = (notify: () => void): (() => void) => {
    const query = window.matchMedia('(min-width: 640px)');
    query.addEventListener('change', notify);

    return () => query.removeEventListener('change', notify);
};
const useIsWide = (): boolean =>
    useSyncExternalStore(
        subscribeWide,
        () => window.matchMedia('(min-width: 640px)').matches,
        () => true
    );

const helpClass = 'rdr:mt-1 rdr:text-xs rdr:leading-relaxed rdr:text-foreground/70';
const errorClass = 'rdr:mt-1 rdr:text-xs rdr:leading-relaxed rdr:text-destructive';

/* ---------------------------------------------------------------------------------------
 * Copy button: the label itself confirms ("Copied").
 * ------------------------------------------------------------------------------------- */

function CopyButton({
    text,
    name,
    disabled,
    compact,
}: {
    text: string;
    /** What is being copied, for screen readers ("Copy link discord"). */
    name: string;
    disabled?: boolean;
    /** Icon only on narrow screens. */
    compact?: boolean;
}) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timeout = setTimeout(() => setCopied(false), 2000);

        return () => clearTimeout(timeout);
    }, [copied]);

    return (
        <Button.Text
            type={'button'}
            size={'xsmall'}
            disabled={disabled}
            aria-label={copied ? `已复制链接 ${name}` : `复制链接 ${name}`}
            className={'rdr:shrink-0 rdr:whitespace-nowrap'}
            onClick={(event) => {
                const button = event.currentTarget;
                void copyText(text, button).then((ok) => {
                    if (ok) setCopied(true);
                    else toast.error('复制失败，请手动选中链接后复制。');
                });
            }}
        >
            <span className={ICON_LABEL}>
                <Icon icon={copied ? Check : Copy} aria-hidden={'true'} className={'rdr:h-3.5 rdr:w-3.5'} />
                <span aria-live={'polite'} className={compact ? 'rdr:hidden rdr:sm:inline' : undefined}>
                    {copied ? '已复制' : '复制'}
                </span>
            </span>
        </Button.Text>
    );
}

/* ---------------------------------------------------------------------------------------
 * Create / edit dialog
 * ------------------------------------------------------------------------------------- */

interface FormValues {
    slug: string;
    target: string;
    enabled: boolean;
    permanent: boolean;
}

const toInput = (values: FormValues): RedirectInput => ({
    slug: values.slug.trim().toLowerCase(),
    target: values.target.trim(),
    status_code: values.permanent ? 301 : 302,
    enabled: values.enabled,
});

/**
 * The name field with the fixed part of the address attached in front of it, and the
 * finished link (with a copy button) underneath. The SDK's TextField has no room for an
 * attached prefix, so this is a custom field built on the same form context.
 */
function SlugField({ base, taken, original }: { base: string; taken: ReadonlySet<string>; original?: string }) {
    const field = useFieldContext<string>();
    const id = useId();
    const error = field.state.meta.errors.find((e): e is string => typeof e === 'string' && e !== '');
    const slug = field.state.value.trim().toLowerCase();
    const ready = validateSlug(slug, taken) === undefined;
    const renamed = original !== undefined && ready && slug !== original;

    const onChange = (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.target;
        const composing = (event.nativeEvent as InputEvent).isComposing;
        const next = composing ? input.value : normaliseSlug(input.value);

        // Write the tidied text straight back and put the caret where it was, so typing
        // or pasting in the middle of the name never jumps the cursor to the end.
        if (next !== input.value) {
            const caret = Math.min(input.selectionStart ?? next.length, next.length);
            input.value = next;
            input.setSelectionRange(caret, caret);
        }
        field.handleChange(next);
    };

    return (
        <div>
            <Label htmlFor={id}>短链接</Label>
            <div className={'rdr:flex rdr:items-stretch'}>
                <span
                    aria-hidden={'true'}
                    title={base}
                    className={
                        'rdr:flex rdr:max-w-[55%] rdr:min-w-0 rdr:items-center rdr:rounded-l-sm rdr:border-2 rdr:border-r-0 rdr:border-input rdr:bg-muted rdr:pl-3 rdr:pr-2 rdr:font-mono rdr:text-sm rdr:text-muted-foreground'
                    }
                >
                    <span className={'rdr:truncate'}>{hostOf(base)}</span>
                    <span className={'rdr:shrink-0'}>/go/</span>
                </span>
                <Input
                    id={id}
                    type={'text'}
                    value={field.state.value}
                    onChange={onChange}
                    onBlur={field.handleBlur}
                    $hasError={!!error}
                    aria-invalid={!!error}
                    aria-describedby={`${id}-help`}
                    placeholder={'discord'}
                    autoComplete={'off'}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    className={'rdr:min-w-0 rdr:flex-1 rdr:rounded-l-none rdr:font-mono'}
                />
            </div>
            <p id={`${id}-help`} className={error ? errorClass : helpClass}>
                {error ??
                    (renamed
                        ? `保存后将重命名该链接，旧地址 /go/${original} 将失效。`
                        : '便于记忆的短名称。仅可使用字母、数字、连字符和下划线。')}
            </p>
            <div
                className={
                    'rdr:mt-3 rdr:flex rdr:items-center rdr:justify-between rdr:gap-3 rdr:rounded-sm rdr:border rdr:border-border rdr:bg-muted/40 rdr:py-2 rdr:pl-3 rdr:pr-2'
                }
            >
                <div className={'rdr:min-w-0'}>
                    <p className={'rdr:text-xs rdr:text-muted-foreground'}>你的链接</p>
                    <p className={'rdr:truncate rdr:font-mono rdr:text-sm'} title={ready ? base + slug : undefined}>
                        <span className={'rdr:text-muted-foreground'}>{base}</span>
                        {ready ? (
                            <span className={'rdr:font-semibold rdr:text-foreground'}>{slug}</span>
                        ) : (
                            <span className={'rdr:text-muted-foreground'}>...</span>
                        )}
                    </p>
                </div>
                <CopyButton text={base + slug} name={slug} disabled={!ready} />
            </div>
        </div>
    );
}

function LinkDialog({
    editing,
    open,
    onClose,
    base,
    rows,
}: {
    editing: ShortRedirect | 'new';
    open: boolean;
    onClose: () => void;
    base: string;
    rows: readonly ShortRedirect[];
}) {
    const queryClient = useQueryClient();
    const current = editing === 'new' ? null : editing;
    const formId = useId();
    const advancedId = useId();
    const [failure, setFailure] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(current?.status_code === 301);

    // Names already in use by other links: the server's "unique" rule, checked up front.
    // Taken once, when the dialog opens: after a save the list refreshes while the dialog
    // is still closing, and the link just created must not be reported as a duplicate.
    const [taken] = useState(
        () => new Set(rows.filter((row) => row.id !== current?.id).map((row) => row.slug.toLowerCase()))
    );

    const form = useAppForm({
        defaultValues: {
            slug: current?.slug ?? '',
            target: current?.target ?? '',
            enabled: current?.enabled ?? true,
            permanent: current?.status_code === 301,
        } as FormValues,
        onSubmit: async ({ value, formApi }) => {
            setFailure(null);
            setSubmitting(true);
            try {
                const input = toInput(value);
                await (current ? updateRedirect(current.id, input) : createRedirect(input));
                await queryClient.invalidateQueries({ queryKey: ['ext-redirect'] });
                toast.success(current ? '更改已保存。' : '短链接已创建。');
                onClose();
            } catch (cause) {
                const fields = serverFieldErrors(cause);
                for (const name of ['slug', 'target'] as const) {
                    const message = fields[name];
                    if (!message) continue;
                    // Stored as a submit error: it shows under the field and clears on the next edit.
                    formApi.setFieldMeta(name, (meta) => ({
                        ...meta,
                        errorMap: { ...meta.errorMap, onSubmit: message },
                    }));
                }
                if (!fields.slug && !fields.target) setFailure(httpErrorToHuman(cause));
            } finally {
                setSubmitting(false);
            }
        },
    });

    return (
        <Dialog
            open={open}
            title={current ? '编辑短链接' : '新建短链接'}
            preventExternalClose={submitting}
            hideCloseIcon={submitting}
            onClose={onClose}
        >
            <Form form={form} id={formId} className={'rdr:m-0 rdr:grid rdr:gap-5'}>
                {failure && <Alert type={'danger'}>{failure}</Alert>}

                <form.AppField
                    name={'slug'}
                    validators={{
                        // Quiet until the field has been left or a save was tried; live after that.
                        onChange: ({ value, fieldApi }) =>
                            fieldApi.state.meta.isBlurred || fieldApi.form.state.submissionAttempts > 0
                                ? validateSlug(value, taken)
                                : undefined,
                    }}
                    listeners={{ onBlur: ({ fieldApi }) => void fieldApi.validate('change') }}
                >
                    {() => <SlugField base={base} taken={taken} original={current?.slug} />}
                </form.AppField>

                <form.AppField
                    name={'target'}
                    validators={{
                        onChange: ({ value, fieldApi }) =>
                            fieldApi.state.meta.isBlurred || fieldApi.form.state.submissionAttempts > 0
                                ? validateTarget(value)
                                : undefined,
                    }}
                    listeners={{ onBlur: ({ fieldApi }) => void fieldApi.validate('change') }}
                >
                    {(field) => (
                        <field.TextField
                            type={'text'}
                            inputMode={'url'}
                            label={'目标地址'}
                            description={'此链接要打开的完整地址，需以 https:// 开头'}
                            placeholder={'https://discord.gg/example'}
                            autoComplete={'off'}
                            autoCapitalize={'none'}
                            spellCheck={false}
                        />
                    )}
                </form.AppField>

                <div className={'rdr:border-t rdr:border-border rdr:pt-5'}>
                    <form.AppField name={'enabled'}>
                        {(field) => (
                            <field.SwitchField
                                label={'启用'}
                                description={'关闭后可在不删除的情况下停用该链接，访问者将看到「未找到」页面。'}
                            />
                        )}
                    </form.AppField>
                </div>

                <div>
                    <button
                        type={'button'}
                        aria-expanded={showAdvanced}
                        aria-controls={advancedId}
                        onClick={() => setShowAdvanced((shown) => !shown)}
                        className={
                            'rdr:-ml-1 rdr:inline-flex rdr:cursor-pointer rdr:items-center rdr:gap-1 rdr:rounded-sm rdr:px-1 rdr:py-0.5 rdr:text-sm rdr:font-medium rdr:text-muted-foreground rdr:hover:text-foreground'
                        }
                    >
                        <Icon
                            icon={ChevronRight}
                            aria-hidden={'true'}
                            className={`rdr:h-4 rdr:w-4 rdr:transition-transform ${showAdvanced ? 'rdr:rotate-90' : ''}`}
                        />
                        高级
                    </button>
                    <div id={advancedId} hidden={!showAdvanced} className={'rdr:mt-3'}>
                        <form.AppField name={'permanent'}>
                            {(field) => (
                                <field.SwitchField
                                    label={'永久跳转（301）'}
                                    description={
                                        '仅适用于永不更改的目标地址。浏览器会记住永久跳转，因此之后的修改可能不会生效于已访问过该链接的人。'
                                    }
                                />
                            )}
                        </form.AppField>
                    </div>
                </div>
            </Form>
            <Dialog.Footer>
                <Button.Text type={'button'} disabled={submitting} onClick={onClose}>
                    取消
                </Button.Text>
                <form.AppForm>
                    <form.SubmitButton form={formId}>{current ? '保存更改' : '创建链接'}</form.SubmitButton>
                </form.AppForm>
            </Dialog.Footer>
        </Dialog>
    );
}

/* ---------------------------------------------------------------------------------------
 * List
 * ------------------------------------------------------------------------------------- */

function Usage({ row, inline }: { row: ShortRedirect; inline?: boolean }) {
    if (row.hits === 0 || !row.last_hit_at) {
        return <span className={'rdr:whitespace-nowrap rdr:text-xs rdr:text-muted-foreground'}>从未使用</span>;
    }

    const last = (
        <time dateTime={row.last_hit_at} title={new Date(row.last_hit_at).toLocaleString()}>
            最近使用于 {timeAgo(row.last_hit_at)}
        </time>
    );

    return inline ? (
        <span className={'rdr:text-xs rdr:text-muted-foreground'}>
            {clicksLabel(row.hits)}, {last}
        </span>
    ) : (
        <div className={'rdr:whitespace-nowrap'}>
            <p className={'rdr:tabular-nums'}>{clicksLabel(row.hits)}</p>
            <p className={'rdr:mt-0.5 rdr:text-xs rdr:text-muted-foreground'}>{last}</p>
        </div>
    );
}

function EnabledToggle({ row, onToggle }: { row: ShortRedirect; onToggle: (enabled: boolean) => void }) {
    const id = useId();

    return (
        <div className={'rdr:flex rdr:items-center rdr:gap-2'}>
            <label htmlFor={id} className={'rdr:sr-only'}>
                启用链接 {row.slug}
            </label>
            <Switch id={id} checked={row.enabled} onChange={onToggle} />
            <span
                aria-hidden={'true'}
                className={'rdr:hidden rdr:w-6 rdr:text-xs rdr:text-muted-foreground rdr:sm:inline'}
            >
                {row.enabled ? '开' : '关'}
            </span>
        </div>
    );
}

export default function RedirectsScreen() {
    const queryClient = useQueryClient();
    const { data, isFetching, error, refetch } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchRedirects });
    const isWide = useIsWide();
    const [filter, setFilter] = useState('');
    const filterRef = useRef<HTMLInputElement>(null);

    const [editing, setEditing] = useState<ShortRedirect | 'new' | null>(null);
    const dialog = usePresence(editing);
    const [deleting, setDeleting] = useState<ShortRedirect | null>(null);
    const confirmation = usePresence(deleting);

    // Newest first, so a link that was just created is at the top of the list.
    const rows = useMemo(
        () => [...(data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id),
        [data]
    );
    const base = useMemo(() => linkBaseOf(rows), [rows]);
    const visible = useMemo(() => {
        const needle = filter.trim().toLowerCase();

        return needle === ''
            ? rows
            : rows.filter((row) => row.slug.includes(needle) || row.target.toLowerCase().includes(needle));
    }, [rows, filter]);

    const toggle = useMutation({
        mutationFn: ({ row, enabled }: { row: ShortRedirect; enabled: boolean }) =>
            updateRedirect(row.id, { slug: row.slug, target: row.target, status_code: row.status_code, enabled }),
        onMutate: async ({ row, enabled }) => {
            await queryClient.cancelQueries({ queryKey: QUERY_KEY });
            const previous = queryClient.getQueryData<ShortRedirect[]>(QUERY_KEY);
            queryClient.setQueryData<ShortRedirect[]>(QUERY_KEY, (list) =>
                list?.map((item) => (item.id === row.id ? { ...item, enabled } : item))
            );

            return { previous };
        },
        onError: (cause, { row }, context) => {
            queryClient.setQueryData(QUERY_KEY, context?.previous);
            toast.error(`无法更新 /go/${row.slug}。${httpErrorToHuman(cause)}`);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['ext-redirect'] }),
    });

    const remove = useMutation({
        mutationFn: (row: ShortRedirect) => deleteRedirect(row.id),
        onSuccess: async (_, row) => {
            await queryClient.invalidateQueries({ queryKey: ['ext-redirect'] });
            toast.success(`已删除 /go/${row.slug}。`);
            setDeleting(null);
        },
        onError: (cause) => toast.error(httpErrorToHuman(cause)),
    });

    const columns = useMemo<TableColumn<ShortRedirect>[]>(() => {
        const link: TableColumn<ShortRedirect> = {
            id: 'link',
            label: '短链接',
            cell: (row) => (
                <div className={'rdr:max-w-[40vw] rdr:min-w-0 rdr:sm:max-w-xs rdr:lg:max-w-md rdr:xl:max-w-xl'}>
                    <div className={'rdr:flex rdr:items-center rdr:gap-2'}>
                        <span
                            title={row.url}
                            className={`rdr:min-w-0 rdr:truncate rdr:font-mono rdr:text-sm ${row.enabled ? '' : 'rdr:opacity-60'}`}
                        >
                            <span className={'rdr:hidden rdr:text-muted-foreground rdr:sm:inline'}>{hostOf(base)}</span>
                            <span className={'rdr:text-muted-foreground'}>/go/</span>
                            <span className={'rdr:font-semibold rdr:text-foreground'}>{row.slug}</span>
                        </span>
                        <CopyButton text={row.url} name={row.slug} compact />
                        {row.status_code === 301 && (
                            <span
                                title={'永久跳转（301），浏览器会记住它。'}
                                className={
                                    'rdr:hidden rdr:shrink-0 rdr:rounded-sm rdr:border rdr:border-border rdr:bg-muted rdr:px-1.5 rdr:py-0.5 rdr:text-xs rdr:text-muted-foreground rdr:sm:inline'
                                }
                            >
                                永久
                            </span>
                        )}
                    </div>
                    <a
                        href={row.target}
                        target={'_blank'}
                        rel={'noopener noreferrer'}
                        title={row.target}
                        aria-label={`在新标签页打开目标地址 ${row.target}`}
                        className={
                            'rdr:mt-0.5 rdr:flex rdr:items-center rdr:gap-1 rdr:text-xs rdr:text-muted-foreground rdr:no-underline rdr:hover:text-foreground'
                        }
                    >
                        <span className={'rdr:truncate'}>{row.target.replace(/^https?:\/\//i, '')}</span>
                        <Icon icon={ExternalLink} aria-hidden={'true'} className={'rdr:h-3 rdr:w-3 rdr:shrink-0'} />
                    </a>
                    {!isWide && (
                        <p className={'rdr:mt-0.5 rdr:truncate'}>
                            <Usage row={row} inline />
                        </p>
                    )}
                </div>
            ),
        };
        const usage: TableColumn<ShortRedirect> = {
            id: 'usage',
            label: '使用情况',
            cell: (row) => <Usage row={row} />,
        };
        const enabled: TableColumn<ShortRedirect> = {
            id: 'enabled',
            label: '启用',
            cell: (row) => <EnabledToggle row={row} onToggle={(value) => toggle.mutate({ row, enabled: value })} />,
        };
        const actions: TableColumn<ShortRedirect> = {
            id: 'actions',
            label: <span className={'rdr:sr-only'}>操作</span>,
            cell: (row) => (
                <div className={'rdr:flex rdr:justify-end rdr:gap-1'}>
                    <Button.Text
                        type={'button'}
                        size={'xsmall'}
                        aria-label={`编辑链接 ${row.slug}`}
                        onClick={() => setEditing(row)}
                    >
                        <span className={ICON_LABEL}>
                            <Icon icon={Pencil} aria-hidden={'true'} className={'rdr:h-3.5 rdr:w-3.5'} />
                            <span className={'rdr:hidden rdr:md:inline'}>编辑</span>
                        </span>
                    </Button.Text>
                    <Button.Text
                        type={'button'}
                        size={'xsmall'}
                        color={'red'}
                        aria-label={`删除链接 ${row.slug}`}
                        onClick={() => setDeleting(row)}
                    >
                        <span className={ICON_LABEL}>
                            <Icon icon={Trash2} aria-hidden={'true'} className={'rdr:h-3.5 rdr:w-3.5'} />
                            <span className={'rdr:hidden rdr:md:inline'}>删除</span>
                        </span>
                    </Button.Text>
                </div>
            ),
        };

        return isWide ? [link, usage, enabled, actions] : [link, enabled, actions];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, isWide]);

    const example = `${base}discord`;

    return (
        <PageContentBlock title={'短链接跳转'}>
            <header
                className={
                    'rdr:mb-6 rdr:flex rdr:flex-col rdr:gap-3 rdr:sm:flex-row rdr:sm:items-center rdr:sm:justify-between'
                }
            >
                <div className={'rdr:min-w-0'}>
                    <h1 className={'rdr:font-header rdr:text-2xl rdr:font-semibold rdr:text-foreground'}>短链接跳转</h1>
                    <p className={'rdr:mt-1 rdr:text-sm rdr:leading-relaxed rdr:text-foreground/70'}>
                        面板上的短链接，用于把访问者带到别处。
                    </p>
                </div>
                {rows.length > 0 && (
                    <Button className={'rdr:shrink-0'} onClick={() => setEditing('new')}>
                        新建短链接
                    </Button>
                )}
            </header>

            {error && !data ? (
                <Alert type={'danger'} title={'无法加载你的短链接'}>
                    <p>{httpErrorToHuman(error)}</p>
                    <Button.Text size={'xsmall'} className={'rdr:mt-3'} onClick={() => void refetch()}>
                        重试
                    </Button.Text>
                </Alert>
            ) : !data ? (
                <Spinner size={'large'} centered />
            ) : rows.length === 0 ? (
                <section
                    className={
                        'rdr:rounded-sm rdr:border rdr:border-dashed rdr:border-border rdr:bg-card rdr:px-6 rdr:py-12 rdr:text-center rdr:sm:px-10'
                    }
                >
                    <span
                        className={
                            'rdr:mx-auto rdr:flex rdr:h-12 rdr:w-12 rdr:items-center rdr:justify-center rdr:rounded-sm rdr:border rdr:border-accent/30 rdr:bg-accent/10 rdr:text-accent'
                        }
                    >
                        <Icon icon={Link2} aria-hidden={'true'} />
                    </span>
                    <h2 className={'rdr:mt-4 rdr:font-header rdr:text-lg rdr:font-semibold rdr:text-foreground'}>
                        暂无短链接
                    </h2>
                    <p
                        className={
                            'rdr:mx-auto rdr:mt-2 rdr:max-w-xl rdr:text-sm rdr:leading-relaxed rdr:text-muted-foreground'
                        }
                    >
                        短链接是面板上便于记忆的地址，可以把访问者带到更长的地址。例如{' '}
                        <code className={'rdr:break-all rdr:font-mono rdr:text-foreground'}>{example}</code> 就可以打开
                        你的 Discord 邀请链接。
                    </p>
                    <Button className={'rdr:mt-6'} onClick={() => setEditing('new')}>
                        创建一个短链接
                    </Button>
                </section>
            ) : (
                <>
                    {error && (
                        <Alert type={'danger'} className={'rdr:mb-3'}>
                            {httpErrorToHuman(error)}
                        </Alert>
                    )}
                    <div className={'rdr:relative rdr:mb-3 rdr:w-full rdr:sm:max-w-lg'}>
                        <Icon
                            icon={Search}
                            aria-hidden={'true'}
                            className={
                                'rdr:pointer-events-none rdr:absolute rdr:left-3.5 rdr:top-1/2 rdr:z-10 rdr:h-4 rdr:w-4 rdr:-translate-y-1/2 rdr:text-muted-foreground'
                            }
                        />
                        <Input
                            ref={filterRef}
                            type={'search'}
                            aria-label={'筛选短链接'}
                            placeholder={'按名称或目标地址筛选'}
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape' && filter !== '') {
                                    event.preventDefault();
                                    setFilter('');
                                }
                            }}
                            className={'rdr:h-9 rdr:border-border rdr:bg-card rdr:pl-10'}
                        />
                    </div>
                    <Table
                        rows={visible}
                        columns={columns}
                        isFetching={isFetching}
                        keyOf={(row) => String(row.id)}
                        emptyState={
                            <div className={'rdr:text-center rdr:text-sm rdr:text-muted-foreground'}>
                                <p>没有匹配「{filter.trim()}」的短链接。</p>
                                <Button.Text
                                    size={'xsmall'}
                                    className={'rdr:mt-3'}
                                    onClick={() => {
                                        setFilter('');
                                        filterRef.current?.focus();
                                    }}
                                >
                                    清除筛选
                                </Button.Text>
                            </div>
                        }
                    />
                    {filter.trim() !== '' && visible.length > 0 && (
                        <p aria-live={'polite'} className={'rdr:mt-2 rdr:text-xs rdr:text-muted-foreground'}>
                            显示 {visible.length} / {rows.length} 条
                        </p>
                    )}
                </>
            )}

            {dialog.value && (
                <LinkDialog
                    key={dialog.key}
                    open={dialog.open}
                    editing={dialog.value}
                    base={base}
                    rows={rows}
                    onClose={() => setEditing(null)}
                />
            )}

            <Dialog.Confirm
                open={confirmation.open}
                onClose={() => setDeleting(null)}
                title={'删除这个短链接？'}
                confirm={'删除链接'}
                onConfirmed={() => {
                    if (confirmation.value && !remove.isPending) remove.mutate(confirmation.value);
                }}
            >
                <span className={'rdr:font-mono rdr:font-semibold rdr:break-all'}>/go/{confirmation.value?.slug}</span>{' '}
                将立即失效
                {confirmation.value && confirmation.value.hits > 0
                    ? `，其 ${clicksLabel(confirmation.value.hits)} 的记录也会一并丢失`
                    : ''}
                。此操作无法撤销。
            </Dialog.Confirm>
        </PageContentBlock>
    );
}
