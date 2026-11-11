import './styles.css';
import { defineConfiguredExtension } from '@pterodactyl/sdk';
import { ConsecutiveAllocation } from './ConsecutiveAllocation';

interface RouteData {
    params?: Record<string, string>;
}

const number = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
};

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
    (config) => ({
        // 对应 1.0 的 settings.allocations.consecutiveLimit
        maxBatch: Math.max(1, Math.min(64, number(config.max_batch, 16))),
    }),
    {
        setup({ config, slots }) {
            slots.register('server.network.before', ({ data }) => {
                const uuid = serverUuid(data);

                return uuid === null ? null : <ConsecutiveAllocation uuid={uuid} maxBatch={config.maxBatch} />;
            });
        },
    }
);
