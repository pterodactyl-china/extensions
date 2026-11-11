import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Button,
    Card,
    Dialog,
    PageContentBlock,
    Spinner,
    Switch,
    httpErrorToHuman,
    toast,
} from '@pterodactyl/sdk';
import {
    adjustBalance,
    adjustBalanceBatch,
    fetchConfig,
    fetchUser,
    saveConfig,
    searchUsers,
    type WalletEntry,
    type WalletUser,
} from '../api';

interface Draft {
    currency_name: string;
    currency_symbol: string;
    max_adjust: string;
    allow_negative: boolean;
}

const inputClass =
    'eco:w-full eco:rounded-sm eco:border eco:border-border eco:bg-secondary/40 eco:px-3 eco:py-2 ' +
    'eco:text-sm eco:text-foreground eco:outline-none eco:transition-colors ' +
    'eco:placeholder:text-muted-foreground eco:focus:eco:border-primary eco:focus:eco:bg-secondary/60';

const KIND_LABELS: Record<string, string> = {
    'ai-assistant': 'AI 助手',
    admin: '管理员',
    api: '第三方',
    store: '兑换',
    checkin: '签到',
    redeem: '兑换码',
    transfer: '转账',
    refund: '退款',
};

const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

const formatTime = (value: string | null): string => {
    if (value === null || value === '') {
        return '';
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function History({ entries }: { entries: WalletEntry[] }) {
    if (entries.length === 0) {
        return <p className={'eco:text-xs eco:text-muted-foreground'}>还没有记录。</p>;
    }

    return (
        <div className={'eco:divide-y eco:divide-border'}>
            {entries.map((entry) => (
                <div key={entry.id} className={'eco:flex eco:items-start eco:justify-between eco:gap-3 eco:py-2'}>
                    <div className={'eco:min-w-0 eco:flex-1'}>
                        <p className={'eco:truncate eco:text-xs eco:text-foreground'}>
                            {entry.description ?? kindLabel(entry.kind)}
                        </p>
                        <p className={'eco:mt-0.5 eco:text-[11px] eco:text-muted-foreground'}>
                            {kindLabel(entry.kind)}
                            {entry.created_at !== null && ` · ${formatTime(entry.created_at)}`}
                        </p>
                    </div>

                    <div className={'eco:shrink-0 eco:text-right'}>
                        <p
                            className={
                                'eco:text-xs eco:font-medium ' +
                                (entry.amount > 0 ? 'eco:text-success' : 'eco:text-destructive')
                            }
                        >
                            {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                        </p>
                        <p className={'eco:text-[11px] eco:text-muted-foreground'}>余额 {entry.balance_after}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function AdminEconomyScreen() {
    const queryClient = useQueryClient();

    const config = useQuery({
        queryKey: ['ext-economy', 'config'],
        queryFn: () => fetchConfig(),
        retry: false,
    });

    const [draft, setDraft] = useState<Draft | null>(null);
    const [query, setQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [target, setTarget] = useState<WalletUser | null>(null);
    const [batchOpen, setBatchOpen] = useState(false);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (config.data !== undefined && draft === null) {
            setDraft({
                currency_name: config.data.currency_name,
                currency_symbol: config.data.currency_symbol,
                max_adjust: String(config.data.max_adjust),
                allow_negative: config.data.allow_negative,
            });
        }
    }, [config.data, draft]);

    const users = useQuery({
        queryKey: ['ext-economy', 'users', query],
        queryFn: () => searchUsers(query),
        enabled: config.isSuccess,
        retry: false,
    });

    const detail = useQuery({
        queryKey: ['ext-economy', 'user', target?.id],
        queryFn: () => fetchUser(target === null ? 0 : target.id),
        enabled: target !== null,
        retry: false,
    });

    if (config.isLoading || draft === null) {
        return <Spinner size={'large'} centered />;
    }

    if (config.isError) {
        return (
            <PageContentBlock title={'经济系统'}>
                <Card title={'设置'}>
                    <p className={'eco:text-sm eco:text-warning'}>{httpErrorToHuman(config.error)}</p>
                </Card>
            </PageContentBlock>
        );
    }

    const rows = users.data?.users ?? [];
    const allSelected = rows.length > 0 && rows.every((user) => selectedIds.includes(user.id));

    const update = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch });

    const toggleId = (id: number): void =>
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
        );

    const toggleAll = (): void =>
        setSelectedIds(allSelected ? [] : rows.map((user) => user.id));

    const openSingle = (user: WalletUser): void => {
        setTarget(user);
        setAmount('');
        setNote('');
    };

    const openBatch = (): void => {
        setBatchOpen(true);
        setAmount('');
        setNote('');
    };

    const save = async (): Promise<void> => {
        setBusy('save');

        try {
            const saved = await saveConfig({
                currency_name: draft.currency_name.trim() || '积分',
                currency_symbol: draft.currency_symbol.trim(),
                max_adjust: Number(draft.max_adjust) || 0,
                allow_negative: draft.allow_negative,
            });

            toast.success('设置已保存。');
            setDraft({
                currency_name: saved.currency_name,
                currency_symbol: saved.currency_symbol,
                max_adjust: String(saved.max_adjust),
                allow_negative: saved.allow_negative,
            });
            await config.refetch();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    const submitSingle = async (): Promise<void> => {
        if (target === null) {
            return;
        }

        const value = Number(amount);

        if (!Number.isInteger(value) || value === 0) {
            toast.error('请输入非 0 的整数：正数增加，负数扣减。');

            return;
        }

        setBusy('single');

        try {
            const result = await adjustBalance(target.id, {
                amount: value,
                description: note.trim() === '' ? undefined : note.trim(),
            });

            const applied = result.entry?.amount ?? value;

            toast.success(
                applied === value
                    ? `已调整 ${applied > 0 ? '+' : ''}${applied}，当前余额 ${result.balance}。`
                    : `余额不足，已按实际扣减 ${applied}，当前余额 ${result.balance}。`
            );
            setTarget(null);
            await queryClient.invalidateQueries({ queryKey: ['ext-economy', 'users'] });
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    const submitBatch = async (): Promise<void> => {
        const value = Number(amount);

        if (!Number.isInteger(value) || value === 0) {
            toast.error('请输入非 0 的整数：正数增加，负数扣减。');

            return;
        }

        if (selectedIds.length === 0) {
            toast.error('先勾选要调整的用户。');

            return;
        }

        setBusy('batch');

        try {
            const result = await adjustBalanceBatch({
                ids: selectedIds,
                amount: value,
                description: note.trim() === '' ? undefined : note.trim(),
            });

            const ok = result.adjusted.length;
            const failed = result.failed.length;

            if (failed === 0) {
                toast.success(`已调整 ${ok} 个用户。`);
            } else {
                toast.error(`成功 ${ok} 个，失败 ${failed} 个：${result.failed[0]?.message ?? ''}`);
            }

            setBatchOpen(false);
            setSelectedIds([]);
            await queryClient.invalidateQueries({ queryKey: ['ext-economy', 'users'] });
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(null);
        }
    };

    return (
        <PageContentBlock title={'经济系统'}>
            <div className={'eco:grid eco:gap-4'}>
                <header
                    className={
                        'eco:mb-6 eco:flex eco:flex-col eco:gap-3 eco:sm:flex-row eco:sm:items-center eco:sm:justify-between'
                    }
                >
                    <div className={'eco:min-w-0'}>
                        <h1 className={'eco:font-header eco:text-2xl eco:font-semibold eco:text-foreground'}>
                            经济系统
                        </h1>
                        <p className={'eco:mt-1 eco:text-sm eco:leading-relaxed eco:text-foreground/70'}>
                            统一积分账本：余额、流水与转账集中管理，其它插件通过公共契约记账。
                        </p>
                    </div>

                    <div className={'eco:flex eco:shrink-0 eco:items-center eco:gap-2'}>
                        <Button type={'button'} disabled={busy !== null} onClick={() => void save()}>
                            {busy === 'save' ? '保存中…' : '保存设置'}
                        </Button>
                    </div>
                </header>

                <Card title={'设置'}>
                    <div className={'eco:grid eco:gap-3 eco:md:grid-cols-2'}>
                        <label className={'eco:grid eco:gap-1'}>
                            <span className={'eco:text-xs eco:text-muted-foreground'}>货币名称</span>
                            <input
                                className={inputClass}
                                value={draft.currency_name}
                                placeholder={'积分'}
                                onChange={(event) => update({ currency_name: event.target.value })}
                            />
                        </label>

                        <label className={'eco:grid eco:gap-1'}>
                            <span className={'eco:text-xs eco:text-muted-foreground'}>货币符号（可空）</span>
                            <input
                                className={inputClass}
                                value={draft.currency_symbol}
                                placeholder={'例如 ¥'}
                                onChange={(event) => update({ currency_symbol: event.target.value })}
                            />
                        </label>

                        <label className={'eco:grid eco:gap-1'}>
                            <span className={'eco:text-xs eco:text-muted-foreground'}>
                                单次调整上限（0 = 不限）
                            </span>
                            <input
                                className={inputClass}
                                type={'number'}
                                min={0}
                                value={draft.max_adjust}
                                placeholder={'0 = 不限'}
                                onChange={(event) => update({ max_adjust: event.target.value })}
                            />
                        </label>

                        <label className={'eco:flex eco:cursor-pointer eco:items-center eco:gap-2 eco:self-end eco:text-sm'}>
                            <Switch
                                checked={draft.allow_negative}
                                onChange={(checked) => update({ allow_negative: checked })}
                            />
                            允许透支（扣成负数）
                        </label>
                    </div>

                    <p className={'eco:mt-2 eco:text-xs eco:text-muted-foreground'}>
                        开启后扣款超过余额会记成负数，用户下次充值自动抵扣；购买、续费这类场景仍会被余额预检拦住。
                        关闭时扣款超过余额直接抛余额不足，一分不会欠。
                    </p>
                </Card>

                <Card title={'用户钱包'}>
                    <div className={'eco:flex eco:flex-wrap eco:items-center eco:gap-2'}>
                        <div className={'eco:min-w-0 eco:flex-1'}>
                            <input
                                className={inputClass}
                                value={query}
                                placeholder={'搜索用户名 / 邮箱 / 昵称'}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                        </div>
                        <Button.Text
                            type={'button'}
                            size={'small'}
                            className={'eco:shrink-0'}
                            disabled={users.isFetching}
                            onClick={() => void users.refetch()}
                        >
                            {users.isFetching ? '搜索中…' : '搜索'}
                        </Button.Text>
                    </div>

                    <div
                        className={
                            'eco:mt-3 eco:flex eco:flex-wrap eco:items-center eco:justify-between eco:gap-2 ' +
                            'eco:border-b eco:border-border eco:pb-2'
                        }
                    >
                        <label
                            className={
                                'eco:flex eco:cursor-pointer eco:items-center eco:gap-2 eco:text-xs eco:text-muted-foreground'
                            }
                        >
                            <input type={'checkbox'} checked={allSelected} onChange={toggleAll} />
                            全选当前列表
                            {selectedIds.length > 0 && `（已选 ${selectedIds.length} 人）`}
                        </label>

                        <div className={'eco:flex eco:items-center eco:gap-2'}>
                            {selectedIds.length > 0 && (
                                <Button.Text
                                    type={'button'}
                                    size={'xsmall'}
                                    onClick={() => setSelectedIds([])}
                                >
                                    清空选择
                                </Button.Text>
                            )}
                            <Button
                                type={'button'}
                                size={'small'}
                                disabled={selectedIds.length === 0}
                                onClick={openBatch}
                            >
                                批量调整
                            </Button>
                        </div>
                    </div>

                    <div className={'eco:divide-y eco:divide-border'}>
                        {rows.map((user) => (
                            <div
                                key={user.id}
                                className={'eco:flex eco:flex-wrap eco:items-center eco:gap-3 eco:py-2'}
                            >
                                <input
                                    type={'checkbox'}
                                    aria-label={`选择 ${user.username}`}
                                    checked={selectedIds.includes(user.id)}
                                    onChange={() => toggleId(user.id)}
                                />

                                <div className={'eco:min-w-0 eco:flex-1'}>
                                    <p className={'eco:truncate eco:text-sm eco:text-foreground'}>
                                        {user.username}
                                        {user.name !== null && user.name !== '' && (
                                            <span className={'eco:text-muted-foreground'}>（{user.name}）</span>
                                        )}
                                    </p>
                                    <p className={'eco:truncate eco:text-[11px] eco:text-muted-foreground'}>
                                        {user.email}
                                    </p>
                                </div>

                                <div className={'eco:flex eco:shrink-0 eco:items-center eco:gap-3'}>
                                    <span className={'eco:text-sm eco:text-foreground'}>{user.balance}</span>
                                    <Button.Text type={'button'} size={'xsmall'} onClick={() => openSingle(user)}>
                                        调整
                                    </Button.Text>
                                </div>
                            </div>
                        ))}

                        {users.isSuccess && rows.length === 0 && (
                            <p className={'eco:py-3 eco:text-sm eco:text-muted-foreground'}>没有匹配的用户。</p>
                        )}
                    </div>
                </Card>
            </div>

            <Dialog open={target !== null} title={`调整：${target?.username ?? ''}`} onClose={() => setTarget(null)}>
                <div className={'eco:grid eco:gap-3'}>
                    <p className={'eco:text-sm eco:text-muted-foreground'}>
                        当前余额 <strong className={'eco:text-foreground'}>{target?.balance ?? 0}</strong>
                    </p>

                    <label className={'eco:grid eco:gap-1'}>
                        <span className={'eco:text-xs eco:text-muted-foreground'}>数量（正数增加，负数扣减）</span>
                        <input
                            className={inputClass}
                            type={'number'}
                            value={amount}
                            placeholder={'例如 100 或 -50'}
                            onChange={(event) => setAmount(event.target.value)}
                        />
                    </label>

                    <label className={'eco:grid eco:gap-1'}>
                        <span className={'eco:text-xs eco:text-muted-foreground'}>说明（显示在流水里）</span>
                        <input
                            className={inputClass}
                            value={note}
                            placeholder={'例如 活动奖励'}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </label>

                    <div className={'eco:border-t eco:border-border eco:pt-2'}>
                        <p className={'eco:mb-1 eco:text-xs eco:text-muted-foreground'}>最近流水</p>

                        {detail.isLoading ? (
                            <Spinner size={'small'} />
                        ) : (
                            <div className={'eco:max-h-56 eco:overflow-y-auto'}>
                                <History entries={detail.data?.transactions ?? []} />
                            </div>
                        )}
                    </div>
                </div>

                <div className={'eco:mt-4 eco:flex eco:justify-end eco:gap-2'}>
                    <Button.Text type={'button'} onClick={() => setTarget(null)}>
                        取消
                    </Button.Text>
                    <Button
                        type={'button'}
                        disabled={busy !== null || amount.trim() === ''}
                        onClick={() => void submitSingle()}
                    >
                        {busy === 'single' ? '提交中…' : '提交'}
                    </Button>
                </div>
            </Dialog>

            <Dialog open={batchOpen} title={'批量调整'} onClose={() => setBatchOpen(false)}>
                <div className={'eco:grid eco:gap-3'}>
                    <p className={'eco:text-sm eco:text-muted-foreground'}>
                        将对已选的 <strong className={'eco:text-foreground'}>{selectedIds.length}</strong>{' '}
                        个用户执行同一笔调整，单个失败不影响其他人。
                    </p>

                    <label className={'eco:grid eco:gap-1'}>
                        <span className={'eco:text-xs eco:text-muted-foreground'}>数量（正数增加，负数扣减）</span>
                        <input
                            className={inputClass}
                            type={'number'}
                            value={amount}
                            placeholder={'例如 100 或 -50'}
                            onChange={(event) => setAmount(event.target.value)}
                        />
                    </label>

                    <label className={'eco:grid eco:gap-1'}>
                        <span className={'eco:text-xs eco:text-muted-foreground'}>说明（显示在流水里）</span>
                        <input
                            className={inputClass}
                            value={note}
                            placeholder={'例如 活动奖励'}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </label>
                </div>

                <div className={'eco:mt-4 eco:flex eco:justify-end eco:gap-2'}>
                    <Button.Text type={'button'} onClick={() => setBatchOpen(false)}>
                        取消
                    </Button.Text>
                    <Button
                        type={'button'}
                        disabled={busy !== null || amount.trim() === '' || selectedIds.length === 0}
                        onClick={() => void submitBatch()}
                    >
                        {busy === 'batch' ? '提交中…' : `调整 ${selectedIds.length} 人`}
                    </Button>
                </div>
            </Dialog>
        </PageContentBlock>
    );
}
