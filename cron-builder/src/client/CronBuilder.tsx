import { useEffect, useMemo, useState } from 'react';
import { Select } from '@pterodactyl/sdk';

type Mode = 'interval' | 'hourly' | 'daily' | 'weekly' | 'monthly';

interface State {
    mode: Mode;
    /** interval 模式：每 N 分钟 */
    interval: string;
    minute: string;
    hour: string;
    dayOfMonth: string;
    /** 0 = 周日 */
    weekdays: string[];
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const MODES: { value: Mode; label: string }[] = [
    { value: 'interval', label: '按间隔' },
    { value: 'hourly', label: '每小时' },
    { value: 'daily', label: '每天' },
    { value: 'weekly', label: '每周' },
    { value: 'monthly', label: '每月' },
];

const DEFAULT_STATE: State = {
    mode: 'daily',
    interval: '15',
    minute: '0',
    hour: '3',
    dayOfMonth: '1',
    weekdays: ['1'],
};

const num = (value: string, fallback: number): number => {
    const parsed = Number(value);

    return Number.isInteger(parsed) ? parsed : fallback;
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** 把五个 cron 字段解析成可视化状态；认不出来的组合返回 null（保持原值不动）。 */
function parse(values: string[]): State | null {
    const [minute = '*', hour = '*', dom = '*', month = '*', dow = '*'] = values;

    if (minute.startsWith('*/') && [hour, dom, month, dow].every((item) => item === '*')) {
        return { ...DEFAULT_STATE, mode: 'interval', interval: minute.slice(2) || '15' };
    }

    if (/^\d+$/.test(minute) && [hour, dom, month, dow].every((item) => item === '*')) {
        return { ...DEFAULT_STATE, mode: 'hourly', minute };
    }

    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
        return { ...DEFAULT_STATE, mode: 'daily', minute, hour };
    }

    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^[\d,]+$/.test(dow)) {
        return { ...DEFAULT_STATE, mode: 'weekly', minute, hour, weekdays: dow.split(',') };
    }

    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') {
        return { ...DEFAULT_STATE, mode: 'monthly', minute, hour, dayOfMonth: dom };
    }

    return null;
}

/** 可视化状态 → 五个 cron 字段。 */
function toParts(state: State): string[] {
    const interval = Math.max(1, Math.min(59, num(state.interval, 15)));
    const minute = Math.max(0, Math.min(59, num(state.minute, 0)));
    const hour = Math.max(0, Math.min(23, num(state.hour, 0)));
    const dom = Math.max(1, Math.min(31, num(state.dayOfMonth, 1)));
    const weekdays = state.weekdays.length > 0 ? state.weekdays.join(',') : '*';

    switch (state.mode) {
        case 'interval':
            return [`*/${interval}`, '*', '*', '*', '*'];
        case 'hourly':
            return [String(minute), '*', '*', '*', '*'];
        case 'weekly':
            return [String(minute), String(hour), '*', '*', weekdays];
        case 'monthly':
            return [String(minute), String(hour), String(dom), '*', '*'];
        default:
            return [String(minute), String(hour), '*', '*', '*'];
    }
}

function describe(state: State): string {
    const minute = pad(Math.max(0, Math.min(59, num(state.minute, 0))));
    const hour = pad(Math.max(0, Math.min(23, num(state.hour, 0))));
    const interval = Math.max(1, Math.min(59, num(state.interval, 15)));
    const weekdays = state.weekdays.map((item) => WEEKDAYS[num(item, 0)] ?? item).join('、');

    switch (state.mode) {
        case 'interval':
            return `每 ${interval} 分钟执行一次`;
        case 'hourly':
            return `每小时的第 ${minute} 分执行`;
        case 'weekly':
            return `每周${weekdays} ${hour}:${minute} 执行`;
        case 'monthly':
            return `每月 ${num(state.dayOfMonth, 1)} 日 ${hour}:${minute} 执行`;
        default:
            return `每天 ${hour}:${minute} 执行`;
    }
}

interface Props {
    /** 读取弹窗里五个 cron 输入框的当前值。 */
    read: () => string[];
    /** 把五个值写回输入框。 */
    apply: (parts: string[]) => void;
    /** 原始 5 个输入所在的容器，切换时整块隐藏。 */
    grid: HTMLElement;
}

const fieldClass =
    'crb:w-full crb:rounded-sm crb:border crb:border-input-border crb:bg-input crb:px-3 crb:py-2 ' +
    'crb:text-sm crb:text-foreground crb:outline-none crb:transition-colors ' +
    'crb:placeholder:text-muted-foreground crb:focus:border-primary crb:focus:ring-2 crb:focus:ring-ring/50';

const labelClass = 'crb:grid crb:gap-1';

const hintClass = 'crb:text-[11px] crb:text-muted-foreground';

/** cron 输入上方的可视化面板：默认展开，可切回手动填写。 */
export function CronBuilder({ read, apply, grid }: Props) {
    const parsed = useMemo(() => parse(read()), []);
    const [state, setState] = useState<State>(parsed ?? DEFAULT_STATE);
    const [manual, setManual] = useState(false);
    // 认不出的表达式不立刻覆盖，等用户真正改动一次再写回。
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        grid.style.display = manual ? '' : 'none';

        return () => {
            grid.style.display = '';
        };
    }, [grid, manual]);

    useEffect(() => {
        if (touched && !manual) {
            apply(toParts(state));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state, touched, manual]);

    const preview = touched ? toParts(state).join(' ') : read().join(' ');
    const summary = touched || parsed !== null ? describe(state) : '保持当前的 cron 表达式';

    const update = (patch: Partial<State>): void => {
        setTouched(true);
        setState((current) => ({ ...current, ...patch }));
    };

    const toggleWeekday = (day: string): void =>
        update({
            weekdays: state.weekdays.includes(day)
                ? state.weekdays.filter((item) => item !== day)
                : [...state.weekdays, day].sort(),
        });

    return (
        <div className={'crb:mb-4 crb:rounded-sm crb:border crb:border-border crb:bg-card crb:p-4'}>
            <div className={'crb:flex crb:flex-wrap crb:items-center crb:justify-between crb:gap-2'}>
                <div className={'crb:min-w-0'}>
                    <p className={'crb:text-sm crb:font-medium crb:text-foreground'}>执行时间</p>
                    <p className={hintClass}>选择频率后会自动填写下方的 cron 字段。</p>
                </div>

                <button
                    type={'button'}
                    className={
                        'crb:cursor-pointer crb:rounded-sm crb:border crb:border-border crb:bg-card ' +
                        'crb:px-2.5 crb:py-1 crb:text-xs crb:text-muted-foreground crb:transition-colors ' +
                        'hover:crb:border-primary/60 hover:crb:text-foreground'
                    }
                    onClick={() => setManual(!manual)}
                >
                    {manual ? '用可视化设置' : '手动填写'}
                </button>
            </div>

            {!manual && (
                <>
                    <div className={'crb:mt-3 crb:grid crb:gap-3 crb:sm:grid-cols-2'}>
                        <div className={labelClass}>
                            <span className={hintClass}>频率</span>
                            <Select
                                id={'crb-mode'}
                                value={state.mode}
                                options={MODES}
                                onChange={(value) => update({ mode: String(value) as Mode })}
                            />
                        </div>

                        {state.mode === 'interval' && (
                            <label className={labelClass}>
                                <span className={hintClass}>每多少分钟</span>
                                <input
                                    className={fieldClass}
                                    type={'number'}
                                    min={1}
                                    max={59}
                                    value={state.interval}
                                    onChange={(event) => update({ interval: event.target.value })}
                                />
                            </label>
                        )}

                        {(state.mode === 'daily' || state.mode === 'weekly' || state.mode === 'monthly') && (
                            <div className={'crb:grid crb:grid-cols-2 crb:gap-2'}>
                                <label className={labelClass}>
                                    <span className={hintClass}>小时</span>
                                    <input
                                        className={fieldClass}
                                        type={'number'}
                                        min={0}
                                        max={23}
                                        value={state.hour}
                                        onChange={(event) => update({ hour: event.target.value })}
                                    />
                                </label>
                                <label className={labelClass}>
                                    <span className={hintClass}>分钟</span>
                                    <input
                                        className={fieldClass}
                                        type={'number'}
                                        min={0}
                                        max={59}
                                        value={state.minute}
                                        onChange={(event) => update({ minute: event.target.value })}
                                    />
                                </label>
                            </div>
                        )}

                        {state.mode === 'hourly' && (
                            <label className={labelClass}>
                                <span className={hintClass}>每小时的第几分钟</span>
                                <input
                                    className={fieldClass}
                                    type={'number'}
                                    min={0}
                                    max={59}
                                    value={state.minute}
                                    onChange={(event) => update({ minute: event.target.value })}
                                />
                            </label>
                        )}

                        {state.mode === 'monthly' && (
                            <label className={labelClass}>
                                <span className={hintClass}>每月几日</span>
                                <input
                                    className={fieldClass}
                                    type={'number'}
                                    min={1}
                                    max={31}
                                    value={state.dayOfMonth}
                                    onChange={(event) => update({ dayOfMonth: event.target.value })}
                                />
                            </label>
                        )}
                    </div>

                    {state.mode === 'weekly' && (
                        <div className={'crb:mt-3'}>
                            <p className={hintClass}>星期几（可多选）</p>
                            <div className={'crb:mt-1 crb:flex crb:flex-wrap crb:gap-1.5'}>
                                {WEEKDAYS.map((label, index) => {
                                    const value = String(index);
                                    const active = state.weekdays.includes(value);

                                    return (
                                        <button
                                            key={value}
                                            type={'button'}
                                            className={
                                                'crb:cursor-pointer crb:rounded-full crb:border crb:px-2.5 crb:py-0.5 ' +
                                                'crb:text-xs crb:transition-colors ' +
                                                (active
                                                    ? 'crb:border-primary crb:bg-primary crb:text-primary-foreground'
                                                    : 'crb:border-border crb:bg-card crb:text-muted-foreground hover:crb:text-foreground')
                                            }
                                            onClick={() => toggleWeekday(value)}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div
                        className={
                            'crb:mt-3 crb:flex crb:flex-wrap crb:items-center crb:justify-between crb:gap-2 ' +
                            'crb:border-t crb:border-border crb:pt-2'
                        }
                    >
                        <span className={hintClass}>{summary}</span>
                        <code className={'crb:font-mono crb:text-xs crb:text-foreground'}>{preview}</code>
                    </div>

                    {!touched && parsed === null && (
                        <p className={'crb:mt-1 ' + hintClass}>
                            现有表达式不是常见组合，调整上面的频率后才会覆盖它；不调整就保持原样。
                        </p>
                    )}
                </>
            )}

            {manual && (
                <p className={'crb:mt-3 ' + hintClass}>
                    已切回手动填写，五个字段由你直接编辑。点「用可视化设置」可以再切回来。
                </p>
            )}
        </div>
    );
}
