import './styles.css';
import { defineConfiguredExtension } from '@pterodactyl/sdk';
import { EggSwitcherCard } from './EggSwitcherCard';

interface RouteData {
    params?: Record<string, string>;
}

/** 路由参数里有 server 的 uuid；取不到时退回解析地址栏。 */
const serverUuid = (data: unknown): string | null => {
    const params = (data as RouteData | undefined)?.params;
    const fromParams = params?.id ?? params?.server;

    if (typeof fromParams === 'string' && fromParams !== '') {
        return fromParams;
    }

    const segment = window.location.pathname.split('/')[2];

    return segment === undefined || segment === '' ? null : segment;
};

export default defineConfiguredExtension(
    () => ({}),
    {
        setup({ slots, screens }) {
            // 启动页的变量表单区，最贴近 1.0 里选择预设的位置。
            slots.register('server.startup.form', ({ data }) => {
                const uuid = serverUuid(data);

                return uuid === null ? null : <EggSwitcherCard uuid={uuid} />;
            });

            screens.register('admin-egg-switcher', () => import('./screens/AdminScreen'));
        },
    }
);
