import type { ComponentProps } from 'react';

/** 面板自带的输入框在深色主题下边框很淡，这里用面板令牌自己画一个。 */
const BASE =
    'aia:w-full aia:rounded-sm aia:border aia:border-border aia:bg-secondary/40 aia:px-3 aia:py-2 ' +
    'aia:text-sm aia:text-foreground aia:outline-none aia:transition-colors ' +
    'aia:placeholder:text-muted-foreground aia:focus:border-primary aia:focus:bg-secondary/60 ' +
    'aia:disabled:cursor-not-allowed aia:disabled:opacity-50';

export function TextArea({ className = '', ...props }: ComponentProps<'textarea'>) {
    return <textarea {...props} className={`${BASE} ${className}`} />;
}

export function TextControl({ className = '', ...props }: ComponentProps<'input'>) {
    return <input {...props} className={`${BASE} ${className}`} />;
}
