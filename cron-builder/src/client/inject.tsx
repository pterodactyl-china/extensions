import { createRoot, type Root } from 'react-dom/client';
import { CronBuilder } from './CronBuilder';

/** 面板里五个 cron 字段的 label（主题为英文文案）。 */
const CRON_LABELS = ['minute', 'hour', 'day of month', 'month', 'day of week'];

const mounted = new Map<HTMLElement, Root>();

/** 按 label 文案找输入框：label[for] → 对应的 input。 */
function byLabel(scope: HTMLElement, text: string): HTMLInputElement | null {
    const label = Array.from(scope.querySelectorAll('label')).find(
        (item) => (item.textContent ?? '').trim().toLowerCase() === text
    );

    const id = label?.getAttribute('for');

    if (id === null || id === undefined || id === '') {
        return null;
    }

    const found = scope.querySelector(`#${CSS.escape(id)}`);

    return found instanceof HTMLInputElement ? found : null;
}

/** 兜底：弹窗里第一个文本框是计划任务名称，后面五个是 cron。 */
function byPosition(scope: HTMLElement): HTMLInputElement[] | null {
    const inputs = Array.from(scope.querySelectorAll('input')).filter(
        (el): el is HTMLInputElement => el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type)
    );

    return inputs.length >= 6 ? inputs.slice(1, 6) : null;
}

function findCronInputs(scope: HTMLElement): HTMLInputElement[] | null {
    const named = CRON_LABELS.map((text) => byLabel(scope, text));

    if (named.every((item): item is HTMLInputElement => item !== null)) {
        return named;
    }

    return byPosition(scope);
}

/** React 受控组件收原生事件，用原型上的 setter 写入才能被侦测到。 */
function writeValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function mount(dialog: HTMLElement): void {
    if (mounted.has(dialog)) {
        return;
    }

    const inputs = findCronInputs(dialog);

    if (inputs === null) {
        return;
    }

    // 每个字段包在 div 里，五个 div 的父级就是那行 grid。
    const grid = inputs[0].parentElement?.parentElement;

    if (!(grid instanceof HTMLElement) || grid.parentElement === null) {
        return;
    }

    const host = document.createElement('div');
    grid.parentElement.insertBefore(host, grid);

    const root = createRoot(host);
    mounted.set(dialog, root);

    root.render(
        <CronBuilder
            grid={grid}
            read={() => inputs.map((input) => input.value)}
            apply={(parts) => {
                inputs.forEach((input, index) => writeValue(input, parts[index] ?? '*'));
            }}
        />
    );
}

function scan(): void {
    for (const [dialog, root] of mounted) {
        if (!document.contains(dialog)) {
            root.unmount();
            mounted.delete(dialog);
        }
    }

    document.querySelectorAll<HTMLElement>('[role="dialog"]').forEach((dialog) => {
        if (dialog.querySelector('label') !== null) {
            mount(dialog);
        }
    });
}

/** 计划任务弹窗是动态挂载的，用 MutationObserver 跟随。 */
export function installCronBuilder(): void {
    let scheduled = false;

    const schedule = (): void => {
        if (scheduled) {
            return;
        }

        scheduled = true;
        window.requestAnimationFrame(() => {
            scheduled = false;
            scan();
        });
    };

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

    schedule();
}
