import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Plus } from 'lucide-react';
import {
    Alert,
    Button,
    Dialog,
    Form,
    Label,
    httpErrorToHuman,
    loadIconNames,
    toast,
    useAppForm,
    useFieldContext,
} from '@pterodactyl/sdk';
import {
    COLORS,
    POSITION_LABELS,
    createItem,
    placeholderName,
    updateItem,
    type AdminItem,
    type AdminItemInput,
    type AdminMeta,
    type ItemColor,
    type ItemKind,
    type ItemPosition,
} from '../api';
import { BUTTON_CLASS } from '../ServerItems';
import { ItemPreview, filterSummary } from './ItemPreview';

const ANY_EGG = 'any';
const ICON_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

interface FormValues {
    label: string;
    url: string;
    icon: string;
    color: ItemColor;
    position: ItemPosition;
    new_tab: boolean;
    is_active: boolean;
    egg_id: string;
    feature: string;
    server_id: string;
}

type FieldName = keyof FormValues;

const FIELD_NAMES: readonly FieldName[] = [
    'label',
    'url',
    'icon',
    'color',
    'position',
    'new_tab',
    'is_active',
    'egg_id',
    'feature',
    'server_id',
];
const FILTER_FIELDS: readonly FieldName[] = ['egg_id', 'feature', 'server_id'];

const defaultsFor = (kind: ItemKind, item: AdminItem | null): FormValues => ({
    label: item?.label ?? '',
    url: item?.url ?? '',
    icon: item?.icon ?? '',
    color: item?.color ?? 'primary',
    position: item?.position ?? 'after',
    new_tab: item?.new_tab ?? kind === 'button',
    is_active: item?.is_active ?? true,
    egg_id: item?.egg_id == null ? ANY_EGG : String(item.egg_id),
    feature: item?.feature ?? '',
    server_id: item?.server_id == null ? '' : String(item.server_id),
});

const eggIdOf = (value: string): number | null => (value === ANY_EGG ? null : Number.parseInt(value, 10));
const serverIdOf = (value: string): number | null => (value.trim() === '' ? null : Number.parseInt(value.trim(), 10));

const validateLabel = (value: string): string | undefined => {
    if (value.trim() === '') return '请输入要显示的文字。';
    if (value.trim().length > 191) return '请使用 191 个以内的字符。';

    return undefined;
};

// Mirrors the backend rule: placeholders stand in for values, and the rest must be
// an http(s) address or a path on this panel.
const validateUrl = (value: string, placeholders: readonly string[]): string | undefined => {
    let url = value.trim();
    if (url === '') return '请输入此项目要打开的地址。';
    if (url.length > 2048) return '请使用 2048 个以内的字符。';
    for (const token of placeholders) url = url.split(token).join('x');
    if (/[\u0000- \u007f]/.test(url)) return '地址中不能包含空格。';
    if (/^https?:\/\/[^/]+/i.test(url) || /^\/(?![/\\])/.test(url)) return undefined;

    return '请以 https://、http:// 开头，或以 / 开头指向本面板的页面。';
};

const validateIcon = (value: string): string | undefined =>
    value.trim() === '' || (ICON_PATTERN.test(value.trim()) && value.trim().length <= 64)
        ? undefined
        : '请使用小写单词，以短横线连接，例如 life-buoy。';

const validateFeature = (value: string): string | undefined =>
    value.trim().length > 191 ? '请使用 191 个以内的字符。' : undefined;

const validateServerId = (value: string): string | undefined =>
    value.trim() === '' || /^[1-9]\d*$/.test(value.trim()) ? undefined : '请输入服务器编号，例如 12。';

// Fields are checked when they lose focus and on save. Once a field shows an error,
// check it again on every change so the message goes away as soon as it is fixed.
const recheckOnChange = {
    onChange: ({
        fieldApi,
    }: {
        fieldApi: { state: { meta: { errorMap: { onBlur?: unknown } } }; validate(cause: 'blur'): unknown };
    }) => {
        if (fieldApi.state.meta.errorMap.onBlur) void fieldApi.validate('blur');
    },
};

/** Validation messages the server sent back, by the form field they belong to. */
function serverFieldErrors(cause: unknown): { field: FieldName; message: string }[] {
    const data = (cause as { response?: { data?: unknown } } | null)?.response?.data;
    const errors = (data as { errors?: unknown } | null | undefined)?.errors;
    if (!Array.isArray(errors)) return [];

    return errors.flatMap((error: { detail?: unknown; meta?: { source_field?: unknown } } | null) => {
        const field = FIELD_NAMES.find((name) => name === error?.meta?.source_field);
        if (!field || typeof error?.detail !== 'string') return [];

        return [{ field, message: field === 'server_id' ? '没有该编号的服务器。' : error.detail }];
    });
}

function SectionHeading({ children }: { children: ReactNode }) {
    return (
        <div className={'cb:flex cb:items-center cb:gap-3'}>
            <h3 className={'cb:m-0 cb:text-xs cb:font-semibold cb:uppercase cb:tracking-wide cb:text-muted-foreground'}>
                {children}
            </h3>
            <div className={'cb:h-px cb:flex-1 cb:bg-border'} />
        </div>
    );
}

interface Choice {
    value: string;
    label: string;
    swatch?: string;
}

/** A small set of options shown all at once, as a radio group bound to the form field. */
function ChoiceField({
    legend,
    choices,
    className,
}: {
    legend: string;
    choices: readonly Choice[];
    className: string;
}) {
    const field = useFieldContext<string>();
    const name = useId();

    return (
        <fieldset className={'cb:m-0 cb:min-w-0 cb:border-0 cb:p-0'}>
            <Label as={'legend'}>{legend}</Label>
            <div className={`cb:grid cb:gap-2 ${className}`}>
                {choices.map((choice) => {
                    const checked = field.state.value === choice.value;

                    return (
                        <label
                            key={choice.value}
                            className={`cb:relative cb:flex cb:min-w-0 cb:cursor-pointer cb:items-center cb:gap-2 cb:rounded-sm cb:border-2 cb:bg-input cb:p-3 cb:text-sm cb:text-foreground cb:transition-colors cb:duration-150 cb:has-[:focus-visible]:ring-2 cb:has-[:focus-visible]:ring-ring/50 ${
                                checked ? 'cb:border-primary' : 'cb:border-input'
                            }`}
                        >
                            <input
                                type={'radio'}
                                className={'cb:sr-only'}
                                name={name}
                                value={choice.value}
                                checked={checked}
                                onChange={() => field.handleChange(choice.value)}
                                onBlur={field.handleBlur}
                            />
                            {choice.swatch && (
                                <span
                                    aria-hidden={'true'}
                                    className={`cb:size-4 cb:shrink-0 cb:rounded-full cb:border cb:ring-1 cb:ring-foreground/25 ${choice.swatch}`}
                                />
                            )}
                            <span className={'cb:min-w-0 cb:flex-1 cb:truncate'}>{choice.label}</span>
                            <Check
                                aria-hidden={'true'}
                                size={16}
                                className={checked ? 'cb:shrink-0 cb:text-primary' : 'cb:invisible cb:shrink-0'}
                            />
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}

const COLOR_CHOICES: readonly Choice[] = COLORS.map((color) => ({ ...color, swatch: BUTTON_CLASS[color.value] }));

/** Buttons that add a placeholder to the URL where the cursor is. */
function PlaceholderChips({
    placeholders,
    onInsert,
}: {
    placeholders: readonly string[];
    onInsert: (token: string) => void;
}) {
    if (placeholders.length === 0) return null;

    return (
        <div className={'cb:mt-2'} role={'group'} aria-label={'把服务器的某个值插入到网址中'}>
            <p className={'cb:m-0 cb:mb-1.5 cb:text-xs cb:text-foreground/70'}>插入打开链接的这台服务器的值：</p>
            <div className={'cb:flex cb:flex-wrap cb:gap-1.5'}>
                {placeholders.map((token) => (
                    <button
                        key={token}
                        type={'button'}
                        title={token}
                        onClick={() => onInsert(token)}
                        className={
                            'cb:inline-flex cb:cursor-pointer cb:items-center cb:gap-1 cb:rounded-sm cb:border cb:border-border cb:bg-popover cb:px-2 cb:py-1 cb:text-xs cb:text-foreground cb:transition-colors cb:duration-150 cb:hover:bg-secondary'
                        }
                    >
                        <Plus aria-hidden={'true'} size={12} className={'cb:text-muted-foreground'} />
                        {placeholderName(token)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function useIconNames(): readonly string[] {
    const [names, setNames] = useState<readonly string[]>([]);
    useEffect(() => {
        let active = true;
        void loadIconNames().then((list) => active && setNames(list));

        return () => {
            active = false;
        };
    }, []);

    return names;
}

export default function ItemDialog({
    editing,
    open,
    kind,
    meta,
    nextSort,
    onClose,
}: {
    editing: AdminItem | null;
    open: boolean;
    kind: ItemKind;
    meta: AdminMeta;
    /** Sort value that puts a new entry last. */
    nextSort: number;
    onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const isButton = kind === 'button';
    const noun = isButton ? '按钮' : '侧边栏项目';
    const formId = useId();
    const urlId = useId();
    const iconListId = useId();
    const filtersId = useId();
    const iconNames = useIconNames();
    const [formError, setFormError] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(
        () => !!editing && (editing.egg_id !== null || editing.feature !== null || editing.server_id !== null)
    );
    // Whether the URL field has had a cursor yet; until then a placeholder goes at the end.
    const urlHasCursor = useRef(false);

    const form = useAppForm({
        defaultValues: defaultsFor(kind, editing),
        onSubmit: async ({ value, formApi }) => {
            const input: AdminItemInput = {
                kind,
                label: value.label.trim(),
                url: value.url.trim(),
                icon: value.icon.trim() || null,
                color: value.color,
                new_tab: value.new_tab,
                position: value.position,
                sort: editing ? editing.sort : nextSort,
                is_active: value.is_active,
                server_id: serverIdOf(value.server_id),
                egg_id: eggIdOf(value.egg_id),
                feature: value.feature.trim() || null,
            };

            setFormError(null);
            try {
                if (editing) {
                    await updateItem(editing.id, input);
                } else {
                    await createItem(input);
                }
            } catch (cause) {
                const errors = serverFieldErrors(cause);
                if (errors.length === 0) {
                    setFormError(httpErrorToHuman(cause));
                }
                for (const { field, message } of errors) {
                    formApi.setFieldMeta(field, (fieldMeta) => ({
                        ...fieldMeta,
                        errorMap: { ...fieldMeta.errorMap, onSubmit: message },
                        errorSourceMap: { ...fieldMeta.errorSourceMap, onSubmit: 'field' },
                    }));
                }

                return;
            }

            await queryClient.invalidateQueries({ queryKey: ['ext-custom-buttons'] });
            toast.success(editing ? '更改已保存。' : isButton ? '按钮已创建。' : '侧边栏项目已创建。');
            onClose();
        },
    });

    const insertPlaceholder = (token: string) => {
        const input = document.getElementById(urlId) as HTMLInputElement | null;
        const current = form.getFieldValue('url');
        const start = urlHasCursor.current ? (input?.selectionStart ?? current.length) : current.length;
        const end = urlHasCursor.current ? (input?.selectionEnd ?? start) : current.length;

        form.setFieldValue('url', current.slice(0, start) + token + current.slice(end));
        if (form.getFieldMeta('url')?.errorMap.onBlur) void form.validateField('url', 'blur');
        urlHasCursor.current = true;
        // Put the cursor after the inserted text once the new value is in the input.
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const eggOptions = [
        { value: ANY_EGG, label: '任意 Egg' },
        ...meta.eggs.map((egg) => ({ value: String(egg.id), label: egg.name })),
    ];

    return (
        <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
                <Dialog
                    open={open}
                    onClose={onClose}
                    preventExternalClose={isSubmitting}
                    hideCloseIcon={isSubmitting}
                    title={`${editing ? '编辑' : '新建'}${noun}`}
                    description={isButton ? '与电源按钮一同显示在服务器控制台上的链接。' : '显示在服务器导航中的链接。'}
                >
                    <Form form={form} id={formId} className={'cb:m-0 cb:grid cb:gap-5'}>
                        <form.Subscribe selector={(state) => state.values}>
                            {(values) => (
                                <ItemPreview
                                    kind={kind}
                                    position={values.position}
                                    newTab={values.new_tab}
                                    item={{
                                        label: values.label.trim() || (isButton ? '按钮文字' : '名称'),
                                        icon: validateIcon(values.icon) ? null : values.icon.trim(),
                                        color: values.color,
                                    }}
                                />
                            )}
                        </form.Subscribe>

                        <form.AppField
                            name={'label'}
                            validators={{ onBlur: ({ value }) => validateLabel(value) }}
                            listeners={recheckOnChange}
                        >
                            {(field) => (
                                <field.TextField
                                    type={'text'}
                                    label={isButton ? '按钮文字' : '名称'}
                                    description={isButton ? '按钮上显示的文字。' : '链接显示的文字。'}
                                    maxLength={191}
                                    autoComplete={'off'}
                                />
                            )}
                        </form.AppField>

                        <div>
                            <form.AppField
                                name={'url'}
                                validators={{ onBlur: ({ value }) => validateUrl(value, meta.placeholders) }}
                                listeners={recheckOnChange}
                            >
                                {(field) => (
                                    <field.TextField
                                        id={urlId}
                                        type={'text'}
                                        inputMode={'url'}
                                        label={'网址'}
                                        description={'完整地址，或 /account 这样的路径（指向本面板的页面）。'}
                                        placeholder={'https://example.com/'}
                                        autoComplete={'off'}
                                        autoCapitalize={'off'}
                                        spellCheck={false}
                                        onSelect={() => {
                                            urlHasCursor.current = true;
                                        }}
                                    />
                                )}
                            </form.AppField>
                            <PlaceholderChips placeholders={meta.placeholders} onInsert={insertPlaceholder} />
                        </div>

                        <SectionHeading>外观</SectionHeading>

                        <form.AppField
                            name={'icon'}
                            validators={{ onBlur: ({ value }) => validateIcon(value) }}
                            listeners={recheckOnChange}
                        >
                            {(field) => {
                                const name = field.state.value.trim();
                                const unknown = name !== '' && iconNames.length > 0 && !iconNames.includes(name);

                                return (
                                    <>
                                        <field.TextField
                                            type={'text'}
                                            label={'图标'}
                                            list={iconListId}
                                            description={
                                                unknown
                                                    ? '没有该名称的图标，将显示链接图标。请从建议列表中选择。'
                                                    : '输入即可搜索图标名称，例如 life-buoy。留空则使用链接图标。'
                                            }
                                            placeholder={'link'}
                                            maxLength={64}
                                            autoComplete={'off'}
                                            autoCapitalize={'off'}
                                            spellCheck={false}
                                        />
                                        <datalist id={iconListId}>
                                            {iconNames.map((iconName) => (
                                                <option key={iconName} value={iconName} />
                                            ))}
                                        </datalist>
                                    </>
                                );
                            }}
                        </form.AppField>

                        {isButton && (
                            <form.AppField name={'color'}>
                                {() => (
                                    <ChoiceField
                                        legend={'配色'}
                                        choices={COLOR_CHOICES}
                                        className={'cb:grid-cols-2 cb:sm:grid-cols-3'}
                                    />
                                )}
                            </form.AppField>
                        )}

                        <form.AppField name={'position'}>
                            {() => (
                                <ChoiceField
                                    legend={'位置'}
                                    choices={(['before', 'after'] as const).map((value) => ({
                                        value,
                                        label: POSITION_LABELS[kind][value],
                                    }))}
                                    className={'cb:sm:grid-cols-2'}
                                />
                            )}
                        </form.AppField>

                        <div className={'cb:grid cb:gap-4 cb:sm:grid-cols-2'}>
                            <form.AppField name={'new_tab'}>
                                {(field) => (
                                    <field.SwitchField
                                        label={'在新标签页打开'}
                                        description={'保持面板页面不被关闭。'}
                                    />
                                )}
                            </form.AppField>
                            <form.AppField name={'is_active'}>
                                {(field) => <field.SwitchField label={'启用'} description={'关闭后暂时隐藏它。'} />}
                            </form.AppField>
                        </div>

                        <form.Subscribe
                            selector={(state) => ({
                                egg_id: state.values.egg_id,
                                feature: state.values.feature,
                                server_id: state.values.server_id,
                                hasError: FILTER_FIELDS.some((name) => (state.fieldMeta[name]?.errors.length ?? 0) > 0),
                            })}
                        >
                            {(filters) => {
                                const serverId = serverIdOf(filters.server_id);
                                const summary = filterSummary(
                                    {
                                        egg_id: eggIdOf(filters.egg_id),
                                        feature: filters.feature.trim() || null,
                                        server_id: Number.isNaN(serverId) ? null : serverId,
                                        server_name:
                                            editing && editing.server_id === serverId ? editing.server_name : null,
                                    },
                                    meta.eggs
                                );
                                // A filter with an error is never left hidden.
                                const expanded = filtersOpen || filters.hasError;

                                return (
                                    <div className={'cb:rounded-sm cb:border cb:border-border'}>
                                        <button
                                            type={'button'}
                                            aria-expanded={expanded}
                                            aria-controls={filtersId}
                                            onClick={() => setFiltersOpen(!expanded)}
                                            className={
                                                'cb:flex cb:w-full cb:cursor-pointer cb:items-center cb:gap-3 cb:rounded-sm cb:border-0 cb:bg-transparent cb:px-3 cb:py-2.5 cb:text-left cb:text-foreground cb:transition-colors cb:duration-150 cb:hover:bg-muted/50'
                                            }
                                        >
                                            <ChevronRight
                                                aria-hidden={'true'}
                                                size={16}
                                                className={`cb:shrink-0 cb:text-muted-foreground cb:transition-transform cb:duration-150 ${
                                                    expanded ? 'cb:rotate-90' : ''
                                                }`}
                                            />
                                            <span className={'cb:min-w-0 cb:flex-1'}>
                                                <span className={'cb:block cb:text-sm cb:font-medium cb:uppercase'}>
                                                    仅在以下位置显示
                                                </span>
                                                <span className={'cb:block cb:text-xs cb:text-muted-foreground'}>
                                                    {summary.length === 0 ? '在所有服务器上显示' : summary.join('、')}
                                                </span>
                                            </span>
                                        </button>
                                        <div id={filtersId} hidden={!expanded}>
                                            <div className={'cb:grid cb:gap-5 cb:border-t cb:border-border cb:p-3'}>
                                                <p
                                                    className={
                                                        'cb:m-0 cb:text-xs cb:leading-relaxed cb:text-foreground/70'
                                                    }
                                                >
                                                    全部留空即在所有服务器上显示。设置了多项筛选时，
                                                    服务器需要同时满足所有条件。
                                                </p>
                                                <form.AppField name={'egg_id'}>
                                                    {(field) => (
                                                        <field.SelectField
                                                            label={'Egg'}
                                                            options={eggOptions}
                                                            description={'仅对使用该 Egg 的服务器显示。'}
                                                        />
                                                    )}
                                                </form.AppField>
                                                <form.AppField
                                                    name={'feature'}
                                                    validators={{ onBlur: ({ value }) => validateFeature(value) }}
                                                    listeners={recheckOnChange}
                                                >
                                                    {(field) => (
                                                        <field.TextField
                                                            type={'text'}
                                                            label={'Egg 特性或标签'}
                                                            description={
                                                                '仅对 Egg 含有该特性或标签的服务器显示，例如 eula。'
                                                            }
                                                            maxLength={191}
                                                            autoComplete={'off'}
                                                            autoCapitalize={'off'}
                                                            spellCheck={false}
                                                        />
                                                    )}
                                                </form.AppField>
                                                <form.AppField
                                                    name={'server_id'}
                                                    validators={{ onBlur: ({ value }) => validateServerId(value) }}
                                                    listeners={recheckOnChange}
                                                >
                                                    {(field) => (
                                                        <field.TextField
                                                            type={'text'}
                                                            inputMode={'numeric'}
                                                            label={'服务器编号'}
                                                            description={
                                                                '仅对这一台服务器显示。编号位于其管理页面地址的末尾，例如 /panel/servers/12 中的 12。'
                                                            }
                                                            autoComplete={'off'}
                                                        />
                                                    )}
                                                </form.AppField>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }}
                        </form.Subscribe>

                        {formError && <Alert type={'danger'}>{formError}</Alert>}
                    </Form>
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={onClose} disabled={isSubmitting}>
                            取消
                        </Button.Text>
                        <form.AppForm>
                            <form.SubmitButton form={formId}>{editing ? '保存更改' : `创建${noun}`}</form.SubmitButton>
                        </form.AppForm>
                    </Dialog.Footer>
                </Dialog>
            )}
        </form.Subscribe>
    );
}
