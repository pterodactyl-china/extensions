import { http } from '@pterodactyl/sdk';

const base = (uuid: string): string => `/api/client/servers/${uuid}/extensions/contiguous-ports`;

export interface PortRow {
    id: number;
    ip: string;
    port: number;
    primary: boolean;
}

export interface PortOverview {
    ip: string | null;
    /** 分配总数上限（allocation_limit），主分包含在内 */
    limit: number;
    /** 当前已有的分配数量，主分包含在内 */
    used: number;
    /** 还能创建的分配数量 */
    remain: number;
    max_batch: number;
    auto_allocation: boolean;
    allocations: PortRow[];
}

export const fetchOverview = async (uuid: string): Promise<PortOverview> =>
    (await http.get<{ data: PortOverview }>(base(uuid))).data.data;

export interface AssignResult {
    ip: string;
    ports: number[];
}

/**
 * 面板原生的「新建分配」：随机拿一个空闲端口。
 * 数量为 1 时走这里，保持与 1.0 相同的随机行为。
 */
export const createNativeAllocation = async (uuid: string): Promise<void> => {
    await http.post(`/api/client/servers/${uuid}/network/allocations`);
};

/** 分配 count 个连续端口；start 为 null 时自动找第一段连续空闲端口。 */
export const assignPorts = async (uuid: string, count: number, start: number | null): Promise<AssignResult> =>
    (
        await http.post<{ data: AssignResult }>(`${base(uuid)}/assign`, {
            count,
            start,
        })
    ).data.data;
