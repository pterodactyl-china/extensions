import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { assignPorts, createNativeAllocation, fetchOverview } from './api';
import { TextControl } from './Controls';

const HOST_ATTR = 'data-ext-consecutive-ports';

/**
 * 严格按 1.0 分支 NetworkContainer 的行为移植：
 *
 * - 用「连续端口数 + 创建新的网络设置」替换原生的「新建分配」按钮，不并存
 * - 输入默认 1，范围 [1, min(后台上限, 还能创建的额度)]
 * - 数量 > 1 时提交连续分配，数量 = 1 时走面板原生的随机分配（与 1.0 的 count 透传一致）
 * - 额度用完时不显示创建入口（1.0 同样不渲染按钮）
 */
export function ConsecutiveAllocation({ uuid, maxBatch }: { uuid: string; maxBatch: number }) {
    const [host, setHost] = useState<HTMLElement | null>(null);
    const [count, setCount] = useState(1);
    const [pending, setPending] = useState(false);
    const queryClient = useQueryClient();

    const overview = useQuery({
        queryKey: ['ext-consecutive-ports', uuid],
        queryFn: () => fetchOverview(uuid),
        staleTime: 5_000,
    });

    // 剩余额度由后端算好（已扣掉主分配），这里只和后台的单次上限取小。
    const remain = overview.data?.remain ?? 0;
    const maxCount = Math.max(1, Math.min(maxBatch, remain));

    // 原生按钮：换成 1.0 的样式。数据没到之前先保留原生按钮，避免空白。
    useEffect(() => {
        let frame = 0;

        const sync = (): void => {
            const marker = document.querySelector('[data-ui="new-button"]');
            const button = marker?.closest('button') as HTMLButtonElement | null;
            const toolbar = button?.parentElement;

            if (button === null || toolbar === null || toolbar === undefined) {
                return;
            }

            if (overview.data === undefined) {
                button.style.display = '';

                return;
            }

            // 替换而不是并存：原生按钮让位给下面的输入框 + 按钮。
            button.style.display = 'none';

            let slot = toolbar.querySelector<HTMLElement>(`[${HOST_ATTR}]`);

            if (slot === null) {
                slot = document.createElement('div');
                slot.setAttribute(HOST_ATTR, '');
                slot.className = 'cpt:flex cpt:flex-wrap cpt:items-center cpt:gap-2';
                toolbar.insertBefore(slot, button);
            }

            setHost(slot);
        };

        sync();

        // 面板是 SPA，换页或列表重绘后按钮会重建，持续找回并重新替换。
        const observer = new MutationObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(sync);
        });

        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [overview.data]);

    const create = async (): Promise<void> => {
        setPending(true);

        try {
            if (count > 1) {
                const result = await assignPorts(uuid, count, null);
                const first = result.ports[0];
                const last = result.ports[result.ports.length - 1];

                toast.success(
                    `已创建 ${result.ports.length} 个连续端口：${first}${first === last ? '' : `–${last}`}`
                );
            } else {
                // 与 1.0 一致：数量为 1 时不传 count，交给面板原生逻辑随机分配。
                await createNativeAllocation(uuid);
                toast.success('已创建新的网络设置。');
            }

            await queryClient.invalidateQueries();
            await overview.refetch();
        } catch (cause) {
            toast.error(httpErrorToHuman(cause));
        } finally {
            setPending(false);
        }
    };

    if (host === null || overview.data === undefined || remain <= 0) {
        return null;
    }

    return createPortal(
        <>
            <label className={'cpt:text-sm cpt:whitespace-nowrap cpt:text-muted-foreground'}>连续端口数:</label>
            <TextControl
                type={'number'}
                min={1}
                max={maxCount}
                value={String(count)}
                style={{ width: '4rem', height: '2.25rem' }}
                aria-label={'连续端口数'}
                onChange={(event) =>
                    setCount(Math.max(1, Math.min(maxCount, parseInt(event.target.value, 10) || 1)))
                }
            />
            <Button type={'button'} size={'small'} disabled={pending} onClick={() => void create()}>
                {pending ? '创建中…' : '创建新的网络设置'}
            </Button>
        </>,
        host
    );
}
