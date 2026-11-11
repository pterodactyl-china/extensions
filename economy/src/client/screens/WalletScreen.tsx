import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, PageContentBlock, Spinner, httpErrorToHuman } from '@pterodactyl/sdk';
import { fetchTransactions, fetchWallet, type WalletEntry } from '../api';

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

const formatAmount = (amount: number): string => (amount > 0 ? `+${amount}` : String(amount));

const formatTime = (value: string | null): string => {
    if (value === null || value === '') {
        return '';
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function EntryRow({ entry }: { entry: WalletEntry }) {
    return (
        <div className={'eco:flex eco:items-start eco:justify-between eco:gap-3 eco:py-2'}>
            <div className={'eco:min-w-0 eco:flex-1'}>
                <p className={'eco:truncate eco:text-sm eco:text-foreground'}>
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
                        'eco:text-sm eco:font-medium ' +
                        (entry.amount > 0 ? 'eco:text-success' : 'eco:text-destructive')
                    }
                >
                    {formatAmount(entry.amount)}
                </p>
                <p className={'eco:text-[11px] eco:text-muted-foreground'}>余额 {entry.balance_after}</p>
            </div>
        </div>
    );
}

export default function WalletScreen() {
    const [limit, setLimit] = useState(20);

    const wallet = useQuery({
        queryKey: ['ext-economy', 'wallet'],
        queryFn: () => fetchWallet(),
        retry: false,
    });

    const history = useQuery({
        queryKey: ['ext-economy', 'transactions', limit],
        queryFn: () => fetchTransactions(limit),
        enabled: wallet.isSuccess,
        retry: false,
    });

    if (wallet.isLoading) {
        return <Spinner size={'large'} centered />;
    }

    if (wallet.isError || wallet.data === undefined) {
        return (
            <PageContentBlock title={'我的积分'}>
                <Card title={'余额'}>
                    <p className={'eco:text-sm eco:text-warning'}>{httpErrorToHuman(wallet.error)}</p>
                </Card>
            </PageContentBlock>
        );
    }

    const data = wallet.data;
    const entries: WalletEntry[] = history.data ?? data.transactions;

    return (
        <PageContentBlock title={'我的积分'}>
            <div className={'eco:grid eco:gap-4'}>
                <header
                    className={
                        'eco:mb-6 eco:flex eco:flex-col eco:gap-3 eco:sm:flex-row eco:sm:items-center eco:sm:justify-between'
                    }
                >
                    <div className={'eco:min-w-0'}>
                        <h1 className={'eco:font-header eco:text-2xl eco:font-semibold eco:text-foreground'}>
                            我的积分
                        </h1>
                        <p className={'eco:mt-1 eco:text-sm eco:leading-relaxed eco:text-foreground/70'}>
                            查看账户余额与近期积分变动记录。
                        </p>
                    </div>
                </header>

                <Card title={'积分余额'}>
                    <div className={'eco:flex eco:flex-wrap eco:items-baseline eco:gap-2'}>
                        <span className={'eco:font-header eco:text-3xl eco:font-semibold eco:text-foreground'}>
                            {data.balance}
                        </span>
                        <span className={'eco:text-sm eco:text-muted-foreground'}>
                            {data.symbol}
                            {data.currency}
                        </span>
                    </div>

                    <p className={'eco:mt-2 eco:text-xs eco:text-muted-foreground'}>
                        积分可用于平台提供的各项服务，余额与每一笔变动都会记录在下方明细中。
                    </p>
                </Card>

                <Card title={'变动明细'}>
                    {entries.length === 0 ? (
                        <p className={'eco:text-sm eco:text-muted-foreground'}>暂无积分变动记录。</p>
                    ) : (
                        <div className={'eco:divide-y eco:divide-border'}>
                            {entries.map((entry) => (
                                <EntryRow key={entry.id} entry={entry} />
                            ))}
                        </div>
                    )}

                    {entries.length >= limit && limit < 200 && (
                        <div className={'eco:mt-3 eco:flex eco:justify-center'}>
                            <button
                                type={'button'}
                                className={
                                    'eco:cursor-pointer eco:rounded-sm eco:border eco:border-border ' +
                                    'eco:bg-card eco:px-3 eco:py-1 eco:text-xs eco:text-muted-foreground ' +
                                    'eco:transition-colors hover:eco:text-foreground'
                                }
                                onClick={() => setLimit(200)}
                            >
                                查看更多
                            </button>
                        </div>
                    )}
                </Card>
            </div>
        </PageContentBlock>
    );
}
