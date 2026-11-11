import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, Spinner, TitledGreyBox, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { fetchEggState, switchEgg } from './api';

const HOST_ATTR = 'data-ext-egg-switcher';

/**
 * 预设切换卡片。
 *
 * 位置：面板启动页的 slot 只有 `server.startup.form`（在命令/镜像之上），
 * 所以要把它移到「启动命令 + Docker 镜像之后、变量之前」——
 * 先挂一个空节点，再把占位 div 插到那一行之后，最后 portal 进去。
 *
 * 视觉：直接用面板的 TitledGreyBox / Select / Button，和原生卡片完全一致。
 */
export function EggSwitcherCard({ uuid }: { uuid: string }) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

    const queryClient = useQueryClient();
    // 标签是单选：点一下切换过去，再点一下取消（回到全部）。
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [pending, setPending] = useState(false);

    // 把自己挪到「命令 + 镜像」这一行之后（即变量区的上面）。
    useEffect(() => {
        const host = hostRef.current;

        if (host === null) {
            return;
        }

        const marker = document.createElement('div');
        marker.setAttribute(HOST_ATTR, '');

        let stopped = false;
        let observer: MutationObserver | null = null;

        const mount = (): void => {
            if (stopped) {
                return;
            }

            const parent = host.parentElement;

            if (parent === null) {
                return;
            }

            // 面板启动页里，命令与镜像是并排的一行（class 含 md:flex）。
            const row = Array.from(parent.children).find(
                (element): element is HTMLElement =>
                    element instanceof HTMLElement &&
                    element !== host &&
                    element !== marker &&
                    /(^|\s)md:flex(\s|$)/.test(element.className)
            );

            if (row === undefined) {
                return;
            }

            if (marker.parentElement !== parent || marker.previousElementSibling !== row) {
                row.insertAdjacentElement('afterend', marker);
            }

            if (marker.parentElement !== null) {
                setPortalTarget(marker);
            }
        };

        mount();
        observer = new MutationObserver(() => mount());
        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            stopped = true;
            observer?.disconnect();
            marker.remove();
        };
    }, []);

    const state = useQuery({
        queryKey: ['ext-egg-switcher', uuid],
        queryFn: () => fetchEggState(uuid),
        retry: false,
    });

    const pickTag = (slug: string | null): void => {
        setActiveTag((current) => (current === slug ? null : slug));
        setSelected(null);
        setConfirming(false);
    };

    const confirm = async (): Promise<void> => {
        if (selected === null) {
            return;
        }

        setPending(true);

        try {
            const result = await switchEgg(uuid, selected);

            toast.success(`已切换到「${result.egg}」，重启服务器后生效。`);
            setConfirming(false);
            setSelected(null);
            await queryClient.invalidateQueries();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setPending(false);
        }
    };

    const renderBody = (): ReactNode => {
        if (state.isLoading) {
            return (
                <TitledGreyBox title={'预设'}>
                    <Spinner size={'small'} />
                </TitledGreyBox>
            );
        }

        // 没有查看权限时后端返回 403：静默隐藏，不打扰普通用户。
        if (state.isError || state.data === undefined) {
            return null;
        }

        const data = state.data;
        const options = data.items.filter(
            (item) => !item.current && (activeTag === null || item.tags.includes(activeTag))
        );
        const allowedOptions = options.filter((item) => item.allowed);
        const target = data.items.find((item) => item.id === selected) ?? null;

        if (data.can_switch !== true && data.items.length <= 1) {
            return null;
        }

        return (
            <TitledGreyBox
                title={'预设'}
                actions={
                    <span className={'egs:text-xs egs:text-muted-foreground'}>
                        当前：{data.current?.name ?? '未知'}
                    </span>
                }
            >
                {/* 用 flex + gap 控制间距：space-y-* 会和外层 card body 的 padding/margin 打架 */}
                <div className={'egs:flex egs:flex-col egs:gap-3'}>
                    {data.tags.length > 0 && (
                        <div className={'egs:flex egs:flex-wrap egs:items-center egs:gap-1.5'}>
                            <span className={'egs:mr-1 egs:text-xs egs:text-muted-foreground'}>标签</span>

                            {data.allow_tag_switch ? (
                                <>
                                    <button
                                        type={'button'}
                                        className={
                                            'egs:cursor-pointer egs:rounded-full egs:border egs:px-2.5 egs:py-0.5 ' +
                                            'egs:text-xs egs:transition-colors ' +
                                            (activeTag === null
                                                ? 'egs:border-primary egs:bg-primary egs:text-primary-foreground'
                                                : 'egs:border-border egs:bg-card egs:text-muted-foreground hover:egs:text-foreground')
                                        }
                                        onClick={() => pickTag(null)}
                                    >
                                        全部
                                    </button>

                                    {data.tags.map((tag) => (
                                        <button
                                            key={tag.slug}
                                            type={'button'}
                                            className={
                                                'egs:cursor-pointer egs:rounded-full egs:border egs:px-2.5 egs:py-0.5 ' +
                                                'egs:text-xs egs:transition-colors ' +
                                                (activeTag === tag.slug
                                                    ? 'egs:border-primary egs:bg-primary egs:text-primary-foreground'
                                                    : 'egs:border-border egs:bg-card egs:text-muted-foreground hover:egs:text-foreground')
                                            }
                                            onClick={() => pickTag(tag.slug)}
                                        >
                                            {tag.name}
                                        </button>
                                    ))}
                                </>
                            ) : (
                                // 关闭跨标签：只展示当前标签，不可点选。
                                <span className={'egs:flex egs:flex-wrap egs:items-center egs:gap-1.5'}>
                                    {data.current?.tags.map((slug) => (
                                        <span
                                            key={slug}
                                            className={
                                                'egs:rounded-full egs:border egs:border-border egs:bg-secondary/50 ' +
                                                'egs:px-2.5 egs:py-0.5 egs:text-xs egs:text-muted-foreground'
                                            }
                                        >
                                            {data.tags.find((tag) => tag.slug === slug)?.name ?? slug}
                                        </span>
                                    ))}
                                </span>
                            )}
                        </div>
                    )}

                    {data.can_switch === true ? (
                        <>
                            <Select
                                id={'egs-egg'}
                                value={selected === null ? '' : String(selected)}
                                options={[
                                    { value: '', label: '请选择预设…' },
                                    ...allowedOptions.map((item) => ({
                                        value: String(item.id),
                                        label:
                                            item.tags.length > 0
                                                ? `${item.name}（${item.tags.join('、')}）`
                                                : item.name,
                                    })),
                                ]}
                                onChange={(value) => {
                                    setSelected(String(value) === '' ? null : Number(value));
                                    setConfirming(false);
                                }}
                            />

                            {allowedOptions.length === 0 && (
                                <p className={'egs:text-xs egs:text-muted-foreground'}>
                                    当前筛选下没有可切换的预设。
                                </p>
                            )}

                            {!confirming && (
                                <div className={'egs:flex egs:shrink-0 egs:justify-end egs:pt-1'}>
                                    <Button
                                        type={'button'}
                                        size={'small'}
                                        disabled={target === null}
                                        onClick={() => setConfirming(true)}
                                    >
                                        切换预设
                                    </Button>
                                </div>
                            )}

                            {confirming && target !== null && (
                                <div
                                    className={
                                        'egs:space-y-2 egs:rounded-sm egs:border egs:border-warning/60 ' +
                                        'egs:bg-warning/10 egs:p-3'
                                    }
                                >
                                    <p className={'egs:text-xs egs:text-warning'}>
                                        确认把预设从「{data.current?.name ?? '当前'}」切换为「{target.name}」？
                                    </p>
                                    <p className={'egs:text-xs egs:text-muted-foreground'}>
                                        启动命令、Docker 镜像与变量会按新预设更新，服务器文件不受影响；
                                        切换后需要重启服务器才会用新预设启动。
                                    </p>
                                    <div className={'egs:flex egs:justify-end egs:gap-2'}>
                                        <Button.Text
                                            type={'button'}
                                            size={'xsmall'}
                                            disabled={pending}
                                            onClick={() => setConfirming(false)}
                                        >
                                            取消
                                        </Button.Text>
                                        <Button
                                            type={'button'}
                                            size={'small'}
                                            disabled={pending}
                                            onClick={() => void confirm()}
                                        >
                                            {pending ? '切换中…' : '确认切换'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className={'egs:text-xs egs:text-muted-foreground'}>
                            你只能查看预设，切换需要「预设切换 → 切换服务器预设」权限。
                        </p>
                    )}


                </div>
            </TitledGreyBox>
        );
    };

    const body = renderBody();

    return (
        <>
            <div ref={hostRef} className={'egs:hidden'} />
            {body !== null &&
                portalTarget !== null &&
                createPortal(<div className={'egs:mt-8'}>{body}</div>, portalTarget)}
        </>
    );
}
