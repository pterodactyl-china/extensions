import policeBadge from './assets/police-badge.png';

interface BeianNoticeProps {
    /** 已去除首尾空白，空字符串表示不显示。 */
    icp: string;
    police: string;
    license: string;
}

interface BeianLink {
    key: string;
    label: string;
    href: string;
    title: string;
    /** 公安备案要求展示官方徽标，其它两项只有文字。 */
    badge?: string;
}

const MIIT_URL = 'https://beian.miit.gov.cn/';
const LICENSE_URL = 'https://tsm.miit.gov.cn/dxxzsp/';

/**
 * 公安备案的查询地址需要备案号里的数字部分，「京公网安备 11010502030146号」
 * 与官方查询页的 code 参数一致，因此这里只保留数字。
 */
const policeUrl = (number: string): string => {
    const code = number.replace(/\D/g, '');

    return `https://beian.mps.gov.cn/#/query/webSearch?code=${code}`;
};

export default function BeianNotice({ icp, police, license }: BeianNoticeProps) {
    const links: BeianLink[] = [];

    if (icp !== '') {
        links.push({ key: 'icp', label: icp, href: MIIT_URL, title: '工业和信息化部政务服务平台 · ICP 备案查询' });
    }
    if (license !== '') {
        links.push({ key: 'license', label: license, href: LICENSE_URL, title: '电信业务市场综合管理信息系统' });
    }
    if (police !== '') {
        links.push({
            key: 'police',
            label: police,
            href: policeUrl(police),
            title: '全国互联网安全管理服务平台',
            badge: policeBadge,
        });
    }

    // 三项都未填写或都被关闭时什么都不渲染，避免在页面上留下空的容器。
    if (links.length === 0) {
        return null;
    }

    return (
        <div
            className={
                'bcn:flex bcn:flex-wrap bcn:items-center bcn:justify-center bcn:gap-x-4 bcn:gap-y-1 bcn:py-4 bcn:text-xs bcn:leading-relaxed'
            }
        >
            {links.map((link) => (
                <a
                    key={link.key}
                    href={link.href}
                    target={'_blank'}
                    rel={'noopener noreferrer'}
                    title={link.title}
                    className={
                        'bcn:inline-flex bcn:items-center bcn:gap-1 bcn:whitespace-nowrap bcn:text-muted-foreground bcn:no-underline bcn:transition-colors bcn:hover:text-foreground bcn:hover:underline'
                    }
                >
                    {link.badge && (
                        <img src={link.badge} alt={''} aria-hidden={'true'} className={'bcn:h-4 bcn:w-auto bcn:shrink-0'} />
                    )}
                    {link.label}
                </a>
            ))}
        </div>
    );
}
