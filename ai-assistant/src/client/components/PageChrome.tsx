import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 页面标头：与面板原生页面一致——大标题 + 一行灰色说明，右侧放操作。
 *
 * 不加边框卡片、不加分隔线，避免和下方内容重复分块。
 * 不放「返回」——后台挂在主菜单下，服务器页有侧边导航。
 */
export function PageHeader({
    title,
    description,
    meta,
    actions,
}: {
    title: ReactNode;
    description?: ReactNode;
    meta?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div
            className={
                'aia:mb-6 aia:flex aia:flex-col aia:gap-3 aia:sm:flex-row aia:sm:items-center aia:sm:justify-between'
            }
        >
            <div className={'aia:min-w-0 aia:flex-1'}>
                <h1 className={'aia:font-header aia:text-2xl aia:font-semibold aia:text-foreground'}>
                    {title}
                </h1>

                {description !== undefined && (
                    <p className={'aia:mt-1 aia:text-sm aia:leading-relaxed aia:text-foreground/70'}>
                        {description}
                    </p>
                )}

                {meta !== undefined && (
                    <div
                        className={
                            'aia:mt-1 aia:flex aia:flex-wrap aia:items-center aia:gap-x-2 aia:gap-y-1 ' +
                            'aia:text-xs aia:text-muted-foreground'
                        }
                    >
                        {meta}
                    </div>
                )}
            </div>

            {actions !== undefined && (
                <div className={'aia:flex aia:shrink-0 aia:flex-wrap aia:items-center aia:gap-2'}>
                    {actions}
                </div>
            )}
        </div>
    );
}

const TONES = {
    info: 'aia:border-primary/40 aia:bg-primary/10 aia:text-foreground',
    success: 'aia:border-success/40 aia:bg-success/10 aia:text-foreground',
    warning: 'aia:border-warning/50 aia:bg-warning/10 aia:text-foreground',
    error: 'aia:border-destructive/50 aia:bg-destructive/10 aia:text-foreground',
} as const;

/**
 * 公告条：固定出现在标头下方、内容之前。
 *
 * - 同一 `id` 关闭后记在 localStorage，不再重复打扰
 * - `dismissible=false` 时不显示关闭按钮（用于必须处理的错误）
 */
export function Notice({
    id,
    tone = 'info',
    title,
    children,
    dismissible = true,
}: {
    id: string;
    tone?: keyof typeof TONES;
    title: ReactNode;
    children?: ReactNode;
    dismissible?: boolean;
}) {
    const storageKey = `ext-ai-assistant:notice:${id}`;
    const [hidden, setHidden] = useState(() => {
        try {
            return window.localStorage.getItem(storageKey) === '1';
        } catch {
            return false;
        }
    });

    if (hidden) {
        return null;
    }

    const dismiss = (): void => {
        setHidden(true);

        try {
            window.localStorage.setItem(storageKey, '1');
        } catch {
            // 忽略隐私模式
        }
    };

    return (
        <div
            className={
                'aia:flex aia:items-start aia:gap-3 aia:rounded-sm aia:border aia:px-3 aia:py-2 ' +
                'aia:text-sm ' +
                TONES[tone]
            }
        >
            <div className={'aia:min-w-0 aia:flex-1 aia:space-y-0.5'}>
                <p className={'aia:font-medium'}>{title}</p>
                {children !== undefined && (
                    <p className={'aia:text-xs aia:leading-relaxed aia:text-muted-foreground'}>{children}</p>
                )}
            </div>

            {dismissible && (
                <button
                    type={'button'}
                    aria-label={'关闭提示'}
                    className={
                        'aia:shrink-0 aia:cursor-pointer aia:text-xs aia:text-muted-foreground ' +
                        'aia:transition-colors hover:aia:text-foreground'
                    }
                    onClick={dismiss}
                >
                    ×
                </button>
            )}
        </div>
    );
}
