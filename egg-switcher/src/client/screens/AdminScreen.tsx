import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, PageContentBlock, Spinner, Switch, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { fetchAdminConfig, fetchTags, saveAdminConfig, type AdminConfig, type TagOption } from '../api';

interface Draft {
    keep_variables: boolean;
    allow_tag_switch: boolean;
    tags: string[];
}

export default function AdminScreen() {
    const config = useQuery({
        queryKey: ['ext-egg-switcher', 'admin'],
        queryFn: () => fetchAdminConfig(),
        retry: false,
    });

    const tags = useQuery({
        queryKey: ['ext-egg-switcher', 'tags'],
        queryFn: () => fetchTags(),
        retry: false,
    });

    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (config.data !== undefined && draft === null) {
            setDraft({
                keep_variables: config.data.keep_variables,
                allow_tag_switch: config.data.allow_tag_switch,
                tags: config.data.tags,
            });
        }
    }, [config.data, draft]);

    if (config.isLoading || draft === null) {
        return <Spinner size={'large'} centered />;
    }

    if (config.isError) {
        return (
            <PageContentBlock title={'预设切换'}>
                <Card title={'配置'}>
                    <p className={'egs:text-sm egs:text-warning'}>{httpErrorToHuman(config.error)}</p>
                </Card>
            </PageContentBlock>
        );
    }

    const update = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch });

    const toggleTag = (slug: string): void => {
        update({
            tags: draft.tags.includes(slug)
                ? draft.tags.filter((item) => item !== slug)
                : [...draft.tags, slug],
        });
    };

    const save = async (): Promise<void> => {
        setBusy(true);

        try {
            await saveAdminConfig({
                keep_variables: draft.keep_variables,
                allow_tag_switch: draft.allow_tag_switch,
                tags: draft.tags,
            });

            toast.success('已保存。');
            await config.refetch();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setBusy(false);
        }
    };

    const options: TagOption[] = tags.data ?? [];

    return (
        <PageContentBlock title={'预设切换'}>
            <div className={'egs:grid egs:gap-4'}>
                <header
                    className={
                        'egs:mb-6 egs:flex egs:flex-col egs:gap-3 egs:sm:flex-row egs:sm:items-center egs:sm:justify-between'
                    }
                >
                    <div className={'egs:min-w-0'}>
                        <h1 className={'egs:font-header egs:text-2xl egs:font-semibold egs:text-foreground'}>
                            预设切换
                        </h1>
                        <p className={'egs:mt-1 egs:text-sm egs:leading-relaxed egs:text-foreground/70'}>
                            控制用户能在「启动」页切换到哪些预设，以及切换后变量的处理方式。
                        </p>
                    </div>

                    <div className={'egs:flex egs:shrink-0 egs:items-center egs:gap-2'}>
                        <Button type={'button'} disabled={busy} onClick={() => void save()}>
                            {busy ? '保存中…' : '保存设置'}
                        </Button>
                    </div>
                </header>

                <Card title={'切换行为'}>
                    <div className={'egs:grid egs:gap-3'}>
                        <label className={'egs:flex egs:cursor-pointer egs:items-center egs:gap-2 egs:text-sm'}>
                            <Switch
                                checked={draft.keep_variables}
                                onChange={(checked) => update({ keep_variables: checked })}
                            />
                            切换时保留同名变量（关闭则全部回到预设默认值）
                        </label>

                        <label className={'egs:flex egs:cursor-pointer egs:items-center egs:gap-2 egs:text-sm'}>
                            <Switch
                                checked={draft.allow_tag_switch}
                                onChange={(checked) => update({ allow_tag_switch: checked })}
                            />
                            允许切换标签（可跨标签选择其他预设）
                        </label>
                    </div>

                    <p className={'egs:mt-2 egs:text-xs egs:text-muted-foreground'}>
                        {draft.allow_tag_switch
                            ? '开启后：服务器页显示全部标签，用户可以先换标签、再选该标签下的预设。'
                            : '关闭后：服务器页只显示当前预设的标签，用户只能在同标签的预设之间切换。'}
                        下面的标签是「管理员白名单」，两种模式下都会生效；不选表示不额外限制。
                    </p>
                </Card>

                <Card title={'允许的目标预设标签'}>
                    {tags.isLoading && <p className={'egs:text-sm egs:text-muted-foreground'}>读取标签…</p>}

                    {tags.isError && (
                        <p className={'egs:text-sm egs:text-warning'}>{httpErrorToHuman(tags.error)}</p>
                    )}

                    {!tags.isLoading && options.length === 0 && (
                        <p className={'egs:text-sm egs:text-muted-foreground'}>
                            面板里还没有标签，先去「管理 → 标签」创建。
                        </p>
                    )}

                    <div className={'egs:grid egs:gap-2 egs:sm:grid-cols-2 egs:lg:grid-cols-3'}>
                        {options.map((tag) => (
                            <label
                                key={tag.id}
                                className={
                                    'egs:flex egs:cursor-pointer egs:items-center egs:gap-2 ' +
                                    'egs:rounded-sm egs:border egs:border-border egs:px-3 egs:py-2 ' +
                                    'egs:text-sm egs:text-foreground hover:egs:bg-secondary/50'
                                }
                            >
                                <input
                                    type={'checkbox'}
                                    checked={draft.tags.includes(tag.slug)}
                                    onChange={() => toggleTag(tag.slug)}
                                />
                                <span className={'egs:truncate'}>{tag.name}</span>
                                <code className={'egs:ml-auto egs:text-[11px] egs:text-muted-foreground'}>
                                    {tag.slug}
                                </code>
                            </label>
                        ))}
                    </div>

                    <p className={'egs:mt-2 egs:text-xs egs:text-muted-foreground'}>
                        不选表示不限制标签；选了之后，目标预设必须带其中任意一个标签才可切换。
                    </p>
                </Card>
            </div>
        </PageContentBlock>
    );
}
