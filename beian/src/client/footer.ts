import policeBadge from './assets/police-badge.png';

interface BeianConfig {
    icp: string;
    police: string;
    license: string;
}

interface BeianEntry {
    label: string;
    href: string;
    title: string;
    badge?: string;
}

const CONFIG_URL = `${window.location.origin}/beian/config.json`;
const MIIT_URL = 'https://beian.miit.gov.cn/';
const LICENSE_URL = 'https://tsm.miit.gov.cn/dxxzsp/';

// 与面板自身的页脚完全一致的类名，保证字号、颜色、居中方式都相同。
const LINE_CLASS = 'text-center text-muted-foreground text-xs';
const LINK_CLASS = 'no-underline text-muted-foreground hover:text-muted-foreground';

/** 公安备案的查询地址取备案号里的数字，「京公网安备 11010502030146号」与官方查询页的 code 参数一致。 */
const policeUrl = (number: string): string => `https://beian.mps.gov.cn/#/query/webSearch?code=${number.replace(/\D/g, '')}`;

const buildEntries = (config: BeianConfig): BeianEntry[] => {
    const entries: BeianEntry[] = [];

    // 填了哪项就显示哪项，顺序按国内页脚惯例：ICP 备案、公安备案、经营许可证。
    if (config.icp !== '') {
        entries.push({ label: config.icp, href: MIIT_URL, title: '工业和信息化部政务服务平台 · ICP 备案查询' });
    }
    if (config.police !== '') {
        entries.push({
            label: config.police,
            href: policeUrl(config.police),
            title: '全国互联网安全管理服务平台',
            badge: policeBadge,
        });
    }
    if (config.license !== '') {
        entries.push({ label: config.license, href: LICENSE_URL, title: '电信业务市场综合管理信息系统' });
    }

    return entries;
};

const renderLink = (entry: BeianEntry): HTMLAnchorElement => {
    const link = document.createElement('a');
    link.href = entry.href;
    link.target = '_blank';
    link.rel = 'noopener nofollow noreferrer';
    link.title = entry.title;
    link.className = LINK_CLASS;
    link.setAttribute('data-ui', 'page-footer');
    link.setAttribute('data-part', 'link');

    if (entry.badge) {
        // 图标与文字作为一个整体参与换行，否则浏览器会把它们拆到两行、隔开很远。
        Object.assign(link.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
        });

        const image = document.createElement('img');
        image.src = entry.badge;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        Object.assign(image.style, {
            height: '14px',
            width: 'auto',
            flexShrink: '0',
            verticalAlign: 'middle',
        });

        link.append(image);
    }

    link.append(document.createTextNode(entry.label));

    return link;
};

/**
 * 独立的一行（与版权行同款样式），三个备案号用竖线分隔放在这一行里，
 * 不跟版权行挤在一起。
 */
const renderLine = (entries: BeianEntry[]): HTMLParagraphElement => {
    const line = document.createElement('p');
    line.className = LINE_CLASS;
    line.setAttribute('data-ui', 'page-footer');
    line.setAttribute('data-part', 'text');
    line.setAttribute('data-ext-beian', '');

    entries.forEach((entry, index) => {
        if (index > 0) {
            line.append(document.createTextNode(' | '));
        }
        line.append(renderLink(entry));
    });

    return line;
};

let entries: BeianEntry[] = [];
let watching = false;

const ensureMounted = (): void => {
    if (entries.length === 0) {
        return;
    }

    // 面板自己的页脚容器；登录页与内容页各有一个，都要挂上。
    const roots = document.querySelectorAll<HTMLElement>('[data-ui="page-footer"][data-part="root"]');

    roots.forEach((root) => {
        // 上一版把备案号接到了版权行里，先清掉那段，恢复成独立一行。
        root.querySelectorAll('span[data-ext-beian]').forEach((stale) => stale.remove());

        let line = root.querySelector<HTMLParagraphElement>('p[data-ext-beian]');

        if (line === null) {
            line = renderLine(entries);
        }

        // 始终排在版权行下面。
        if (root.lastElementChild !== line) {
            root.append(line);
        }
    });
};

const watch = (): void => {
    if (watching) {
        return;
    }
    watching = true;

    let scheduled = false;
    const schedule = (): void => {
        if (scheduled) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            ensureMounted();
        });
    };

    // 路由切换会重建页脚，变化后把这一行补回去。
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
};

/** 从公开接口取号码，再挂到版权行下面。 */
export const installFooter = async (): Promise<void> => {
    // 旧版本在页面底部挂过一个固定元素，顺手清掉，避免叠在一起。
    document.getElementById('ext-beian-footer')?.remove();

    try {
        const response = await fetch(CONFIG_URL, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });

        if (!response.ok) {
            return;
        }

        const config = (await response.json()) as BeianConfig;
        entries = buildEntries(config);

        if (entries.length === 0) {
            return;
        }

        watch();
    } catch {
        // 面板没启用扩展或接口被挡时不打扰用户。
    }
};
