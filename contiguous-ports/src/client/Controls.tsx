import type { ComponentProps } from 'react';

/**
 * 面板自带的 Input 在深色主题下边框很淡，这里用面板令牌自己画一个，
 * 保证浅色与深色下都能看清输入框。
 */
const BASE =
    'cpt:h-10 cpt:w-full cpt:rounded-sm cpt:border cpt:border-border cpt:bg-secondary/40 cpt:px-3 ' +
    'cpt:text-sm cpt:text-foreground cpt:outline-none cpt:transition-colors ' +
    'cpt:placeholder:text-muted-foreground cpt:focus:border-primary cpt:focus:bg-secondary/60 ' +
    'cpt:disabled:cursor-not-allowed cpt:disabled:opacity-50';

export function TextControl({ className = '', ...props }: ComponentProps<'input'>) {
    return <input {...props} className={`${BASE} ${className}`} />;
}
