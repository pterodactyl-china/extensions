import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronDown, Info, Megaphone, Plus, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
    Alert,
    Button,
    Checkbox,
    Dialog,
    Form,
    Label,
    NamedIcon,
    PageContentBlock,
    Spinner,
    Table,
    httpErrorToHuman,
    loadIconNames,
    toast,
    useAppForm,
} from '@pterodactyl/sdk';
import { usePresence } from '../presence';
import { Banner } from '../Banners';
import {
    AREAS,
    TYPES,
    createAnnouncement,
    deleteAnnouncement,
    emailAnnouncement,
    fetchAll,
    updateAnnouncement,
    type Announcement,
    type AnnouncementArea,
    type AnnouncementInput,
    type AnnouncementType,
} from '../api';

interface FormState {
    title: string;
    body: string;
    type: AnnouncementType;
    icon: string;
    url_label: string;
    url_link: string;
    panels: AnnouncementArea[];
    dismissible: boolean;
    valid_from: string;
    valid_to: string;
}

type FieldName = keyof FormState;

const emptyForm: FormState = {
    title: '',
    body: '',
    type: 'info',
    icon: '',
    url_label: '',
    url_link: '',
    panels: [],
    dismissible: true,
    valid_from: '',
    valid_to: '',
};

/** Fields behind "More options"; an error on one of them opens the section. */
const OPTION_FIELDS: FieldName[] = ['icon', 'url_label', 'url_link', 'panels', 'dismissible', 'valid_from', 'valid_to'];

// <input type="datetime-local"> works in local time without a zone suffix.
const toLocalInput = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toTime = (value: string | null): number | null => {
    if (!value) return null;
    const time = new Date(value).getTime();

    return Number.isNaN(time) ? null : time;
};

const fromLocalInput = (value: string): string | null => {
    const time = toTime(value);

    return time === null ? null : new Date(time).toISOString();
};

const toForm = (a: Announcement): FormState => ({
    title: a.title,
    body: a.body ?? '',
    type: a.type,
    icon: a.icon ?? '',
    url_label: a.url_label ?? '',
    url_link: a.url_link ?? '',
    panels: a.panels,
    dismissible: a.dismissible,
    valid_from: toLocalInput(a.valid_from),
    valid_to: toLocalInput(a.valid_to),
});

const toInput = (f: FormState): AnnouncementInput => ({
    title: f.title.trim(),
    body: f.body.trim() || null,
    type: f.type,
    icon: f.icon.trim() || null,
    url_label: f.url_label.trim() || null,
    url_link: f.url_link.trim() || null,
    panels: f.panels,
    dismissible: f.dismissible,
    valid_from: fromLocalInput(f.valid_from),
    valid_to: fromLocalInput(f.valid_to),
});

const hasOptions = (f: FormState): boolean =>
    f.icon !== '' ||
    f.url_label !== '' ||
    f.url_link !== '' ||
    f.panels.length > 0 ||
    !f.dismissible ||
    f.valid_from !== '' ||
    f.valid_to !== '';

/* ---------- wording shared by the dialog and the list ---------- */

const formatDate = (time: number): string =>
    new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const areaLabel = (area: AnnouncementArea): string => AREAS.find((a) => a.value === area)?.label ?? area;

const isEverywhere = (panels: readonly AnnouncementArea[]): boolean =>
    panels.length === 0 || AREAS.every((area) => panels.includes(area.value));

const whereSummary = (panels: readonly AnnouncementArea[]): string =>
    isEverywhere(panels)
        ? '在所有位置显示'
        : `仅在以下位置显示：${AREAS.filter((area) => panels.includes(area.value))
              .map((area) => area.label)
              .join('、')}`;

type Status = 'active' | 'scheduled' | 'expired';

const statusOf = (from: number | null, to: number | null, now: number): Status =>
    to !== null && to < now ? 'expired' : from !== null && from > now ? 'scheduled' : 'active';

const scheduleSummary = (from: number | null, to: number | null, now: number): string => {
    const status = statusOf(from, to, now);

    if (status === 'expired' && to !== null) return `已于 ${formatDate(to)} 结束，不再显示`;
    if (status === 'scheduled' && from !== null) {
        return to === null
            ? `将于 ${formatDate(from)} 开始，无结束时间`
            : `${formatDate(from)} 至 ${formatDate(to)} 期间显示`;
    }

    return to === null ? '正在显示，无结束时间' : `正在显示，至 ${formatDate(to)}`;
};

/* ---------- validation ---------- */

const ICON_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const validateTitle = (value: string): string | undefined => {
    const length = value.trim().length;
    if (length === 0) return '请填写公告标题。';
    if (length > 191) return '标题请控制在 191 个字符以内。';

    return undefined;
};

const validateBody = (value: string): string | undefined =>
    value.trim().length > 5000 ? '正文请控制在 5000 个字符以内。' : undefined;

const validateIcon = (value: string, known: readonly string[] | undefined): string | undefined => {
    const icon = value.trim();
    if (icon === '') return undefined;
    if (!ICON_PATTERN.test(icon) || icon.length > 64) return '请使用小写单词，以短横线连接，例如 life-buoy。';
    if (known && !known.includes(icon)) return '没有该名称的图标，请从建议列表中选择。';

    return undefined;
};

// While typing, only complain once the text can no longer become a web address.
const validateUrlTyping = (value: string): string | undefined => {
    const url = value.trim().toLowerCase();
    if (url === '') return undefined;
    if (url.length > 2048) return '地址请控制在 2048 个字符以内。';
    if (/\s/.test(url)) return '网址中不能包含空格。';
    const couldBecomeValid = ['http://', 'https://'].some(
        (scheme) => url.startsWith(scheme) || scheme.startsWith(url)
    );

    return couldBecomeValid ? undefined : '地址需以 http:// 或 https:// 开头';
};

const validateUrlFinal = (value: string, label: string): string | undefined => {
    const url = value.trim();
    if (url === '') return label.trim() === '' ? undefined : '请填写链接要打开的地址。';
    try {
        const parsed = new URL(url);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '') return undefined;
    } catch {
        // falls through to the message below
    }

    return '请输入完整地址，例如 https://example.com/status';
};

const validateUrlLabel = (value: string, url: string): string | undefined => {
    const label = value.trim();
    if (label.length > 191) return '链接文字请控制在 191 个字符以内。';

    return label === '' && url.trim() !== '' ? '请填写供点击的链接文字。' : undefined;
};

const validateEnd = (to: string, from: string): string | undefined => {
    const start = toTime(from);
    const end = toTime(to);

    return start !== null && end !== null && end <= start ? '结束时间必须晚于开始时间。' : undefined;
};

interface ServerErrors {
    form: string | null;
    fields: Partial<Record<FieldName, string>>;
}

/** Splits a failed save into messages for known fields and one for everything else. */
const readServerErrors = (cause: unknown): ServerErrors => {
    const result: ServerErrors = { form: null, fields: {} };
    const data = (cause as { response?: { data?: unknown } } | null)?.response?.data;
    const errors = (data as { errors?: unknown } | null | undefined)?.errors;

    if (Array.isArray(errors)) {
        for (const error of errors as { detail?: unknown; meta?: { source_field?: unknown } }[]) {
            const source = typeof error?.meta?.source_field === 'string' ? error.meta.source_field.split('.')[0] : '';
            const detail = typeof error?.detail === 'string' ? error.detail : '';
            if (detail !== '' && source in emptyForm) {
                result.fields[source as FieldName] ??= detail;
            }
        }
    }

    if (Object.keys(result.fields).length === 0) {
        result.form = httpErrorToHuman(cause);
    }

    return result;
};

/* ---------- small pieces ---------- */

// Same colours and icons as the panel's Alert, which draws the banner itself.
const TYPE_STYLES: Record<AnnouncementType, { icon: typeof Info; box: string; iconColor: string; dot: string }> = {
    info: { icon: Info, box: 'ann:border-accent ann:bg-accent/10', iconColor: 'ann:text-accent', dot: 'ann:bg-accent' },
    success: {
        icon: CheckCircle2,
        box: 'ann:border-success ann:bg-success/15',
        iconColor: 'ann:text-success',
        dot: 'ann:bg-success',
    },
    warning: {
        icon: TriangleAlert,
        box: 'ann:border-warning ann:bg-warning/15',
        iconColor: 'ann:text-warning',
        dot: 'ann:bg-warning',
    },
    danger: {
        icon: ShieldAlert,
        box: 'ann:border-destructive ann:bg-destructive/15',
        iconColor: 'ann:text-destructive',
        dot: 'ann:bg-destructive',
    },
};

const typeLabel = (type: AnnouncementType): string => TYPES.find((t) => t.value === type)?.label ?? type;

function TypePicker({ value, onChange }: { value: AnnouncementType; onChange: (value: AnnouncementType) => void }) {
    const name = useId();

    return (
        <fieldset className={'ann:m-0 ann:min-w-0 ann:border-0 ann:p-0'}>
            <Label as={'legend'}>类型</Label>
            <div className={'ann:grid ann:grid-cols-2 ann:gap-2 ann:sm:grid-cols-4'}>
                {TYPES.map((type) => {
                    const style = TYPE_STYLES[type.value];
                    const TypeIcon = style.icon;
                    const selected = value === type.value;

                    return (
                        <label
                            key={type.value}
                            className={[
                                'ann:relative ann:flex ann:cursor-pointer ann:items-center ann:gap-2 ann:rounded-sm ann:border ann:border-l-4',
                                'ann:px-3 ann:py-2.5 ann:text-sm ann:text-foreground',
                                // Unselected styles stay readable but recede; the chosen one is ringed and ticked.
                                'ann:opacity-60 ann:hover:opacity-100 ann:has-checked:opacity-100',
                                'ann:has-checked:ring-2 ann:has-checked:ring-primary ann:has-checked:font-semibold',
                                'ann:has-focus-visible:outline-2 ann:has-focus-visible:outline-offset-2 ann:has-focus-visible:outline-ring',
                                style.box,
                            ].join(' ')}
                        >
                            <input
                                type={'radio'}
                                name={name}
                                value={type.value}
                                checked={selected}
                                onChange={() => onChange(type.value)}
                                className={'ann:sr-only'}
                            />
                            <TypeIcon
                                aria-hidden={'true'}
                                className={`ann:size-4 ann:shrink-0 ${style.iconColor}`}
                            />
                            <span className={'ann:min-w-0 ann:flex-1'}>{type.label}</span>
                            {selected && (
                                <span
                                    aria-hidden={'true'}
                                    className={
                                        'ann:absolute ann:-top-2 ann:-right-2 ann:flex ann:size-4 ann:items-center ann:justify-center ann:rounded-full ann:bg-primary ann:text-primary-foreground'
                                    }
                                >
                                    <Check className={'ann:size-3'} />
                                </span>
                            )}
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}

function TypeBadge({ type }: { type: AnnouncementType }) {
    return (
        <span
            className={
                'ann:inline-flex ann:items-center ann:gap-1.5 ann:whitespace-nowrap ann:rounded-sm ann:border ann:border-border ann:bg-muted ann:px-2 ann:py-0.5 ann:text-xs ann:font-medium ann:text-foreground'
            }
        >
            <span aria-hidden={'true'} className={`ann:size-2 ann:rounded-full ${TYPE_STYLES[type].dot}`} />
            {typeLabel(type)}
        </span>
    );
}

const STATUS_STYLES: Record<Status, { label: string; badge: string; dot: string }> = {
    active: {
        label: '生效中',
        badge: 'ann:border-success/25 ann:bg-success/10 ann:text-success',
        dot: 'ann:bg-success',
    },
    scheduled: {
        label: '待生效',
        badge: 'ann:border-warning/25 ann:bg-warning/10 ann:text-warning',
        dot: 'ann:bg-warning',
    },
    expired: {
        label: '已过期',
        badge: 'ann:border-border ann:bg-muted ann:text-muted-foreground',
        dot: 'ann:bg-muted-foreground',
    },
};

function StatusBadge({ status }: { status: Status }) {
    const style = STATUS_STYLES[status];

    return (
        <span
            className={`ann:inline-flex ann:items-center ann:gap-1.5 ann:whitespace-nowrap ann:rounded-sm ann:border ann:px-2 ann:py-0.5 ann:text-xs ann:font-medium ${style.badge}`}
        >
            <span aria-hidden={'true'} className={`ann:size-1.5 ann:rounded-full ${style.dot}`} />
            {style.label}
        </span>
    );
}

const Hint = ({ children, id }: { children: ReactNode; id?: string }) => (
    <p id={id} className={'ann:mt-1 ann:text-xs ann:leading-relaxed ann:text-foreground/70'}>
        {children}
    </p>
);

const FieldError = ({ children }: { children: ReactNode }) => (
    <p role={'alert'} className={'ann:mt-1 ann:text-xs ann:leading-relaxed ann:text-destructive'}>
        {children}
    </p>
);

/** The banner exactly as users will get it. Inert: its link and Dismiss button are for show. */
function Preview({ values }: { values: FormState }) {
    const icon = values.icon.trim();
    const label = values.url_label.trim();
    const link = values.url_link.trim();

    return (
        <div
            className={[
                'ann:-mx-6 ann:-mt-5 ann:border-b ann:border-border ann:bg-card ann:px-6 ann:pb-4 ann:pt-6',
                'ann:top-0 ann:z-10 ann:[@media(min-height:720px)]:sticky',
            ].join(' ')}
        >
            <p className={'ann:mb-2 ann:text-xs ann:font-medium ann:uppercase ann:tracking-wide ann:text-muted-foreground'}>
                预览
            </p>
            <div inert className={'ann:max-h-40 ann:overflow-y-auto'}>
                <Banner
                    announcement={{
                        title: values.title.trim() || '公告标题',
                        body: values.body.trim() || null,
                        type: values.type,
                        icon: ICON_PATTERN.test(icon) ? icon : null,
                        url_label: label || null,
                        url_link: label && link ? link : null,
                        dismissible: values.dismissible,
                    }}
                />
            </div>
        </div>
    );
}

/* ---------- create / edit dialog ---------- */

function EditDialog({ editing, open, onClose }: { editing: Announcement | 'new'; open: boolean; onClose: () => void }) {
    const queryClient = useQueryClient();
    const formId = useId();
    const optionsId = useId();
    const initial = editing === 'new' ? emptyForm : toForm(editing);
    const [showOptions, setShowOptions] = useState(() => hasOptions(initial));
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const { data: iconNames } = useQuery({
        queryKey: ['ext-announcements', 'icon-names'],
        queryFn: loadIconNames,
        staleTime: Infinity,
    });

    const form = useAppForm({
        defaultValues: initial,
        validators: {
            // Saving happens here so that what the server rejects lands under the field it is about.
            onSubmitAsync: async ({ value }) => {
                setFormError(null);
                setSaving(true);
                try {
                    if (editing === 'new') {
                        await createAnnouncement(toInput(value));
                    } else {
                        await updateAnnouncement(editing.id, toInput(value));
                    }

                    return undefined;
                } catch (cause) {
                    const errors = readServerErrors(cause);
                    setFormError(errors.form);
                    if (OPTION_FIELDS.some((name) => errors.fields[name])) setShowOptions(true);

                    return { form: errors.form ?? '部分字段需要检查。', fields: errors.fields };
                } finally {
                    setSaving(false);
                }
            },
        },
        onSubmit: async () => {
            await queryClient.invalidateQueries({ queryKey: ['ext-announcements'] });
            toast.success(editing === 'new' ? '公告已创建。' : '公告已保存。');
            onClose();
        },
        onSubmitInvalid: ({ formApi }) => {
            if (OPTION_FIELDS.some((name) => (formApi.getFieldMeta(name)?.errors.length ?? 0) > 0)) {
                setShowOptions(true);
            }
        },
    });

    return (
        <Dialog
            open={open}
            onClose={onClose}
            preventExternalClose={saving}
            title={editing === 'new' ? '新建公告' : '编辑公告'}
        >
            <Form form={form} id={formId} className={'ann:isolate ann:m-0'}>
                <form.Subscribe selector={(state) => state.values}>
                    {(values) => <Preview values={values} />}
                </form.Subscribe>

                <div className={'ann:grid ann:gap-5 ann:pt-5'}>
                    {formError && <Alert type={'danger'}>{formError}</Alert>}

                    <form.AppField name={'title'} validators={{ onChange: ({ value }) => validateTitle(value) }}>
                        {(field) => (
                            <field.TextField
                                type={'text'}
                                label={'标题'}
                                placeholder={'今晚例行维护'}
                                maxLength={191}
                                autoComplete={'off'}
                                autoFocus
                            />
                        )}
                    </form.AppField>

                    <form.AppField name={'body'} validators={{ onChange: ({ value }) => validateBody(value) }}>
                        {(field) => (
                            <field.TextAreaField
                                label={'正文'}
                                rows={3}
                                description={'可选。显示在标题下方的一两句话。'}
                            />
                        )}
                    </form.AppField>

                    <form.AppField name={'type'}>
                        {(field) => <TypePicker value={field.state.value} onChange={field.handleChange} />}
                    </form.AppField>

                    <div className={'ann:border-t ann:border-border ann:pt-4'}>
                        <form.Subscribe selector={(state) => state.values}>
                            {(values) => (
                                <button
                                    type={'button'}
                                    aria-expanded={showOptions}
                                    aria-controls={optionsId}
                                    onClick={() => setShowOptions((shown) => !shown)}
                                    className={
                                        'ann:flex ann:w-full ann:cursor-pointer ann:items-start ann:gap-3 ann:rounded-sm ann:border-0 ann:bg-transparent ann:p-0 ann:text-left ann:text-foreground'
                                    }
                                >
                                    <span className={'ann:min-w-0 ann:flex-1'}>
                                        <span className={'ann:block ann:text-sm ann:font-medium ann:uppercase'}>
                                            更多选项
                                        </span>
                                        <span
                                            className={
                                                'ann:mt-0.5 ann:block ann:text-xs ann:leading-relaxed ann:text-foreground/70'
                                            }
                                        >
                                            {showOptions
                                                ? '链接、图标、显示位置、生效时间与关闭方式。'
                                                : [
                                                      whereSummary(values.panels),
                                                      scheduleSummary(
                                                          toTime(values.valid_from),
                                                          toTime(values.valid_to),
                                                          Date.now()
                                                      ),
                                                      values.dismissible ? '允许用户关闭' : '不可关闭',
                                                  ].join(' · ')}
                                        </span>
                                    </span>
                                    <ChevronDown
                                        aria-hidden={'true'}
                                        className={`ann:mt-0.5 ann:size-5 ann:shrink-0 ann:transition-transform ${showOptions ? 'ann:rotate-180' : ''}`}
                                    />
                                </button>
                            )}
                        </form.Subscribe>

                        {/* Hidden, not unmounted: the fields keep validating while the section is closed. */}
                        <div id={optionsId} hidden={!showOptions}>
                            <div className={'ann:grid ann:gap-5 ann:pt-5'}>
                                <div>
                                    <div className={'ann:grid ann:gap-4 ann:sm:grid-cols-2'}>
                                        <form.AppField
                                            name={'url_label'}
                                            validators={{
                                                onChange: ({ value }) =>
                                                    value.trim().length > 191
                                                        ? '链接文字请控制在 191 个字符以内。'
                                                        : undefined,
                                                onSubmit: ({ value, fieldApi }) =>
                                                    validateUrlLabel(value, fieldApi.form.getFieldValue('url_link')),
                                            }}
                                        >
                                            {(field) => (
                                                <field.TextField
                                                    type={'text'}
                                                    label={'链接文字'}
                                                    placeholder={'了解更多'}
                                                    autoComplete={'off'}
                                                />
                                            )}
                                        </form.AppField>
                                        <form.AppField
                                            name={'url_link'}
                                            validators={{
                                                onChange: ({ value }) => validateUrlTyping(value),
                                                onSubmit: ({ value, fieldApi }) =>
                                                    validateUrlFinal(value, fieldApi.form.getFieldValue('url_label')),
                                            }}
                                        >
                                            {(field) => (
                                                <field.TextField
                                                    type={'url'}
                                                    inputMode={'url'}
                                                    label={'链接地址'}
                                                    placeholder={'https://example.com/status'}
                                                    autoComplete={'off'}
                                                    spellCheck={false}
                                                />
                                            )}
                                        </form.AppField>
                                    </div>
                                    <Hint>可选。在正文后添加一个链接，两项都填或都不填。</Hint>
                                </div>

                                <form.AppField
                                    name={'icon'}
                                    validators={{ onChange: ({ value }) => validateIcon(value, iconNames) }}
                                >
                                    {(field) => {
                                        const icon = field.state.value.trim();
                                        const drawable =
                                            ICON_PATTERN.test(icon) && (!iconNames || iconNames.includes(icon));

                                        return (
                                            <div className={'ann:flex ann:items-start ann:gap-3'}>
                                                <div className={'ann:min-w-0 ann:flex-1'}>
                                                    <field.TextField
                                                        type={'text'}
                                                        label={'图标'}
                                                        list={`${optionsId}-icons`}
                                                        maxLength={64}
                                                        placeholder={'life-buoy'}
                                                        description={
                                                            '可选，显示在标题之前。输入即可搜索图标名称。'
                                                        }
                                                        autoComplete={'off'}
                                                        autoCapitalize={'none'}
                                                        spellCheck={false}
                                                    />
                                                    <datalist id={`${optionsId}-icons`}>
                                                        {(iconNames ?? []).map((name) => (
                                                            <option key={name} value={name} />
                                                        ))}
                                                    </datalist>
                                                </div>
                                                <div
                                                    aria-hidden={'true'}
                                                    className={
                                                        'ann:mt-6 ann:flex ann:size-12 ann:shrink-0 ann:items-center ann:justify-center ann:rounded-sm ann:border ann:border-dashed ann:border-border ann:text-foreground'
                                                    }
                                                >
                                                    {drawable && <NamedIcon name={icon} size={20} />}
                                                </div>
                                            </div>
                                        );
                                    }}
                                </form.AppField>

                                <form.AppField name={'panels'}>
                                    {(field) => {
                                        const selected = field.state.value;
                                        const error = field.state.meta.errors.find((e) => typeof e === 'string');

                                        return (
                                            <fieldset className={'ann:m-0 ann:min-w-0 ann:border-0 ann:p-0'}>
                                                <Label as={'legend'}>显示位置</Label>
                                                <div
                                                    className={
                                                        'ann:mt-1 ann:flex ann:flex-col ann:gap-x-6 ann:gap-y-3 ann:sm:flex-row ann:sm:flex-wrap'
                                                    }
                                                >
                                                    {AREAS.map((area) => {
                                                        const id = `${optionsId}-area-${area.value}`;

                                                        return (
                                                            <div
                                                                key={area.value}
                                                                className={'ann:flex ann:items-center ann:gap-2'}
                                                            >
                                                                <Checkbox
                                                                    id={id}
                                                                    checked={selected.includes(area.value)}
                                                                    onChange={(checked) =>
                                                                        field.handleChange(
                                                                            AREAS.map((a) => a.value).filter((value) =>
                                                                                value === area.value
                                                                                    ? checked
                                                                                    : selected.includes(value)
                                                                            )
                                                                        )
                                                                    }
                                                                />
                                                                <label
                                                                    htmlFor={id}
                                                                    className={
                                                                        'ann:cursor-pointer ann:text-sm ann:text-foreground'
                                                                    }
                                                                >
                                                                    {area.label}
                                                                </label>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {error ? (
                                                    <FieldError>{error}</FieldError>
                                                ) : (
                                                    <Hint>
                                                        {selected.length === 0
                                                            ? '在所有位置显示。勾选后仅显示在这些位置。'
                                                            : `${whereSummary(selected)}。`}
                                                    </Hint>
                                                )}
                                            </fieldset>
                                        );
                                    }}
                                </form.AppField>

                                <div>
                                    <div className={'ann:grid ann:gap-4 ann:sm:grid-cols-2'}>
                                        <form.AppField name={'valid_from'}>
                                            {(field) => <field.TextField type={'datetime-local'} label={'开始时间'} />}
                                        </form.AppField>
                                        <form.AppField
                                            name={'valid_to'}
                                            validators={{
                                                onChangeListenTo: ['valid_from'],
                                                onChange: ({ value, fieldApi }) =>
                                                    validateEnd(value, fieldApi.form.getFieldValue('valid_from')),
                                            }}
                                        >
                                            {(field) => <field.TextField type={'datetime-local'} label={'结束时间'} />}
                                        </form.AppField>
                                    </div>
                                    <form.Subscribe selector={(state) => state.values}>
                                        {(values) => {
                                            const from = toTime(values.valid_from);
                                            const to = toTime(values.valid_to);

                                            return (
                                                <Hint>
                                                    {from !== null && to !== null && to <= from
                                                        ? '任一项留空即不限制。时间均按你所在的本地时区。'
                                                        : `${scheduleSummary(from, to, Date.now())}。任一项留空即不限制。`}
                                                </Hint>
                                            );
                                        }}
                                    </form.Subscribe>
                                </div>

                                <form.AppField name={'dismissible'}>
                                    {(field) => (
                                        <field.SwitchField
                                            label={'允许用户关闭'}
                                            description={
                                                '关闭后，该用户将不再看到此横幅。若公告必须持续可见，请关闭此选项。'
                                            }
                                        />
                                    )}
                                </form.AppField>
                            </div>
                        </div>
                    </div>
                </div>
            </Form>
            <Dialog.Footer>
                <Button.Text type={'button'} disabled={saving} onClick={onClose}>
                    取消
                </Button.Text>
                <form.AppForm>
                    <form.SubmitButton form={formId}>
                        {editing === 'new' ? '创建公告' : '保存更改'}
                    </form.SubmitButton>
                </form.AppForm>
            </Dialog.Footer>
        </Dialog>
    );
}

/* ---------- confirmations ---------- */

interface ConfirmProps {
    open: boolean;
    onClose: () => void;
    title: string;
    confirm: string;
    danger?: boolean;
    pending: boolean;
    onConfirm: () => void;
    children: ReactNode;
}

/** A confirmation whose button shows that the request is running, so it cannot be sent twice. */
function ConfirmDialog({ open, onClose, title, confirm, danger, pending, onConfirm, children }: ConfirmProps) {
    const ConfirmButton = danger ? Button.Danger : Button;

    return (
        <Dialog open={open} onClose={onClose} title={title} preventExternalClose={pending}>
            <div className={'ann:grid ann:gap-3 ann:text-sm ann:leading-relaxed ann:text-muted-foreground'}>
                {children}
            </div>
            <Dialog.Footer>
                <Button.Text type={'button'} disabled={pending} onClick={onClose}>
                    取消
                </Button.Text>
                <ConfirmButton type={'button'} isLoading={pending} disabled={pending} onClick={onConfirm}>
                    {confirm}
                </ConfirmButton>
            </Dialog.Footer>
        </Dialog>
    );
}

const Strong = ({ children }: { children: ReactNode }) => (
    <strong className={'ann:font-semibold ann:text-foreground'}>{children}</strong>
);

/* ---------- screen ---------- */

export default function AnnouncementsScreen() {
    const queryClient = useQueryClient();
    const { data, isFetching, error, refetch } = useQuery({
        queryKey: ['ext-announcements', 'all'],
        queryFn: fetchAll,
    });
    const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
    const [deleting, setDeleting] = useState<Announcement | null>(null);
    const [emailing, setEmailing] = useState<Announcement | null>(null);
    const editDialog = usePresence(editing);
    const deleteDialog = usePresence(deleting);
    const emailDialog = usePresence(emailing);

    const remove = useMutation({
        mutationFn: (id: number) => deleteAnnouncement(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['ext-announcements'] });
            toast.success('公告已删除。');
            setDeleting(null);
        },
        onError: (cause) => toast.error(httpErrorToHuman(cause)),
    });

    const email = useMutation({
        mutationFn: (id: number) => emailAnnouncement(id),
        onSuccess: (count) => {
            toast.success(`已为 ${count} 位用户排队发送邮件。`);
            setEmailing(null);
        },
        onError: (cause) => toast.error(httpErrorToHuman(cause)),
    });

    const rows = data?.announcements;
    const userCount = data?.userCount ?? null;
    const audience =
        userCount === null ? '所有用户' : userCount === 1 ? '这 1 位用户' : `全部 ${userCount.toLocaleString()} 位用户`;
    const now = Date.now();

    const createButton = (
        <Button type={'button'} onClick={() => setEditing('new')}>
            <span className={'ann:inline-flex ann:items-center ann:gap-2'}>
                <Plus aria-hidden={'true'} className={'ann:size-4'} />
                新建公告
            </span>
        </Button>
    );

    return (
        <PageContentBlock title={'公告'}>
            <header
                className={
                    'ann:mb-6 ann:flex ann:flex-col ann:gap-3 ann:sm:flex-row ann:sm:items-center ann:sm:justify-between'
                }
            >
                <div className={'ann:min-w-0'}>
                    <h1 className={'ann:font-header ann:text-2xl ann:font-semibold ann:text-foreground'}>
                        公告
                    </h1>
                    <p className={'ann:mt-1 ann:text-sm ann:leading-relaxed ann:text-foreground/70'}>
                        向所有使用面板的用户展示的横幅。
                    </p>
                </div>
                {rows && rows.length > 0 && <div className={'ann:shrink-0'}>{createButton}</div>}
            </header>

            {error && (
                <Alert type={'danger'} className={'ann:mb-4'}>
                    <div className={'ann:flex ann:flex-wrap ann:items-center ann:gap-x-4 ann:gap-y-2'}>
                        <span>{httpErrorToHuman(error)}</span>
                        <Button.Text type={'button'} size={'xsmall'} onClick={() => void refetch()}>
                            重试
                        </Button.Text>
                    </div>
                </Alert>
            )}

            {!rows ? (
                !error && <Spinner size={'large'} centered />
            ) : rows.length === 0 ? (
                <section
                    className={
                        'ann:rounded-sm ann:border ann:border-dashed ann:border-border ann:bg-card ann:px-6 ann:py-12 ann:text-center ann:sm:px-10'
                    }
                >
                    <Megaphone aria-hidden={'true'} className={'ann:mx-auto ann:size-8 ann:text-muted-foreground'} />
                    <h2 className={'ann:mt-4 ann:font-header ann:text-lg ann:font-semibold ann:text-foreground'}>
                        暂无公告
                    </h2>
                    <p
                        className={
                            'ann:mx-auto ann:mt-2 ann:max-w-xl ann:text-sm ann:leading-relaxed ann:text-muted-foreground'
                        }
                    >
                        公告是显示在面板顶部的横幅，用于告知用户维护、故障或新动态等信息。
                    </p>
                    <div className={'ann:mt-6'}>{createButton}</div>
                </section>
            ) : (
                <Table
                    rows={rows}
                    isFetching={isFetching}
                    keyOf={(row) => String(row.id)}
                    emptyState={'暂无公告。'}
                    columns={[
                        {
                            id: 'title',
                            label: '公告',
                            cell: (row) => (
                                <div className={'ann:min-w-40 ann:max-w-sm'}>
                                    <p className={'ann:truncate ann:font-medium ann:text-foreground'}>{row.title}</p>
                                    {row.body && (
                                        <p className={'ann:truncate ann:text-xs ann:text-muted-foreground'}>
                                            {row.body}
                                        </p>
                                    )}
                                </div>
                            ),
                        },
                        { id: 'type', label: '类型', cell: (row) => <TypeBadge type={row.type} /> },
                        {
                            id: 'status',
                            label: '状态',
                            cell: (row) => {
                                const from = toTime(row.valid_from);
                                const to = toTime(row.valid_to);
                                const status = statusOf(from, to, now);
                                const detail =
                                    status === 'expired' && to !== null
                                        ? `已于 ${formatDate(to)} 结束`
                                        : status === 'scheduled' && from !== null
                                          ? `将于 ${formatDate(from)} 开始`
                                          : to !== null
                                            ? `至 ${formatDate(to)}`
                                            : '无结束时间';

                                return (
                                    <div>
                                        <StatusBadge status={status} />
                                        <p
                                            className={
                                                'ann:mt-1 ann:whitespace-nowrap ann:text-xs ann:text-muted-foreground'
                                            }
                                        >
                                            {detail}
                                        </p>
                                    </div>
                                );
                            },
                        },
                        {
                            id: 'panels',
                            label: '显示位置',
                            cell: (row) => (
                                <span className={'ann:text-sm'}>
                                    {isEverywhere(row.panels) ? '所有位置' : row.panels.map(areaLabel).join('、')}
                                    {!row.dismissible && (
                                        <span className={'ann:block ann:text-xs ann:text-muted-foreground'}>
                                            不可关闭
                                        </span>
                                    )}
                                </span>
                            ),
                        },
                        {
                            id: 'actions',
                            label: <span className={'ann:sr-only'}>操作</span>,
                            cell: (row) => (
                                <div className={'ann:flex ann:justify-end ann:gap-2'}>
                                    <Button.Text
                                        type={'button'}
                                        size={'xsmall'}
                                        aria-label={`编辑 ${row.title}`}
                                        onClick={() => setEditing(row)}
                                    >
                                        编辑
                                    </Button.Text>
                                    <Button.Text
                                        type={'button'}
                                        size={'xsmall'}
                                        aria-label={`将 ${row.title} 通过邮件发送给${audience}`}
                                        onClick={() => setEmailing(row)}
                                    >
                                        发邮件
                                    </Button.Text>
                                    <Button.Danger
                                        type={'button'}
                                        size={'xsmall'}
                                        isSecondary
                                        aria-label={`删除 ${row.title}`}
                                        onClick={() => setDeleting(row)}
                                    >
                                        删除
                                    </Button.Danger>
                                </div>
                            ),
                        },
                    ]}
                />
            )}

            {editDialog.value && (
                <EditDialog
                    key={editDialog.key}
                    open={editDialog.open}
                    editing={editDialog.value}
                    onClose={() => setEditing(null)}
                />
            )}

            {deleteDialog.value && (
                <ConfirmDialog
                    open={deleteDialog.open}
                    onClose={() => setDeleting(null)}
                    title={'删除公告'}
                    confirm={'删除公告'}
                    danger
                    pending={remove.isPending}
                    onConfirm={() => deleteDialog.value && remove.mutate(deleteDialog.value.id)}
                >
                    <p>
                        此操作将永久删除 <Strong>{deleteDialog.value.title}</Strong>，其横幅会立即对所有人消失。
                    </p>
                </ConfirmDialog>
            )}

            {emailDialog.value && (
                <ConfirmDialog
                    open={emailDialog.open}
                    onClose={() => setEmailing(null)}
                    title={'通过邮件发送此公告'}
                    confirm={
                        userCount === null
                            ? '发送给所有用户'
                            : `发送给 ${userCount.toLocaleString()} 位用户`
                    }
                    pending={email.isPending}
                    onConfirm={() => emailDialog.value && email.mutate(emailDialog.value.id)}
                >
                    <p>
                        将向 <Strong>{audience}</Strong> 发送邮件，内容为{' '}
                        <Strong>{emailDialog.value.title}</Strong>，无论对方是否已关闭横幅。
                    </p>
                    <p>
                        邮件包含标题、正文和链接。发送后无法撤回，再次发送会给所有人重复发送一次。
                    </p>
                </ConfirmDialog>
            )}
        </PageContentBlock>
    );
}
