import { Fragment, type ReactNode } from 'react';
import { ConsoleButton, SidebarLink, type ItemLook } from '../ServerItems';
import { placeholderName, type AdminMeta, type ItemKind, type ItemPosition } from '../api';

const GHOST_BUTTON =
    'cb:rounded-sm cb:border cb:border-border cb:px-4 cb:py-2 cb:text-sm cb:uppercase cb:tracking-wide cb:text-muted-foreground';
const GHOST_LINK = 'cb:whitespace-nowrap cb:px-4 cb:py-3 cb:text-muted-foreground';

/** The entry as users see it, rendered by the components the server page uses. */
export function ItemSample({ kind, item }: { kind: ItemKind; item: ItemLook }) {
    return kind === 'button' ? <ConsoleButton item={item} /> : <SidebarLink item={item} />;
}

/**
 * The entry in place: next to stand-ins for the power buttons or the built-in
 * navigation links, on the side its position puts it.
 */
export function ItemPreview({
    kind,
    item,
    position,
    newTab,
}: {
    kind: ItemKind;
    item: ItemLook;
    position: ItemPosition;
    newTab: boolean;
}) {
    const sample = <ItemSample kind={kind} item={item} />;
    const builtIn =
        kind === 'button' ? (
            <div key={'built-in'} className={'cb:flex cb:gap-2 cb:opacity-60'}>
                {['启动', '重启', '停止'].map((name) => (
                    <span key={name} className={GHOST_BUTTON}>
                        {name}
                    </span>
                ))}
            </div>
        ) : (
            <Fragment key={'built-in'}>
                {['控制台', '文件', '设置'].map((name) => (
                    <span key={name} className={`${GHOST_LINK} cb:opacity-60`}>
                        {name}
                    </span>
                ))}
            </Fragment>
        );
    const custom = <Fragment key={'custom'}>{sample}</Fragment>;
    const order = position === 'before' ? [custom, builtIn] : [builtIn, custom];

    return (
        <figure className={'cb:m-0 cb:overflow-hidden cb:rounded-sm cb:border cb:border-border'}>
            <figcaption
                className={
                    'cb:flex cb:items-center cb:justify-between cb:gap-3 cb:border-b cb:border-border cb:bg-muted cb:px-3 cb:py-1.5 cb:text-xs cb:text-muted-foreground'
                }
            >
                <span className={'cb:font-semibold cb:uppercase cb:tracking-wide'}>预览</span>
                <span>{newTab ? '在新标签页打开' : '在当前标签页打开'}</span>
            </figcaption>
            {/* Decorative: the form fields below carry the same information. */}
            <div aria-hidden={'true'} className={'cb:overflow-x-auto'}>
                {kind === 'button' ? (
                    <div className={'cb:flex cb:min-w-max cb:flex-col cb:items-end cb:gap-2 cb:bg-background cb:p-4'}>
                        {order}
                    </div>
                ) : (
                    <div className={'cb:flex cb:min-w-max cb:items-center cb:bg-card cb:px-2 cb:text-sm'}>{order}</div>
                )}
            </div>
        </figure>
    );
}

/** A URL template with each placeholder token shown by its readable name. */
export function UrlText({ url, placeholders }: { url: string; placeholders: readonly string[] }) {
    let parts: ReactNode[] = [url];
    for (const token of placeholders) {
        parts = parts.flatMap((part) => {
            if (typeof part !== 'string') return [part];

            return part.split(token).flatMap((text, index) =>
                index === 0
                    ? [text]
                    : [
                          <span
                              key={`${token}-${index}`}
                              title={token}
                              className={
                                  'cb:mx-0.5 cb:rounded-sm cb:border cb:border-border cb:bg-popover cb:px-1 cb:font-sans cb:text-foreground'
                              }
                          >
                              {placeholderName(token)}
                          </span>,
                          text,
                      ]
            );
        });
    }

    return (
        <span className={'cb:font-mono cb:text-xs cb:leading-relaxed cb:break-all cb:text-muted-foreground'}>
            {parts.map((part, index) => (
                <Fragment key={index}>{part}</Fragment>
            ))}
        </span>
    );
}

interface Filters {
    egg_id: number | null;
    feature: string | null;
    server_id: number | null;
    server_name?: string | null;
}

/** The filters an entry has, in words. Empty when it is shown on every server. */
export function filterSummary(filters: Filters, eggs: AdminMeta['eggs']): string[] {
    const parts: string[] = [];
    if (filters.egg_id !== null) {
        parts.push(`Egg：${eggs.find((egg) => egg.id === filters.egg_id)?.name ?? `#${filters.egg_id}`}`);
    }
    if (filters.feature) parts.push(`特性或标签：${filters.feature}`);
    if (filters.server_id !== null) parts.push(`服务器：${filters.server_name || `#${filters.server_id}`}`);

    return parts;
}
