import { http } from '@pterodactyl/sdk';

const base = (uuid: string): string => `/api/client/servers/${uuid}/extensions/egg-switcher`;

export interface EggOption {
    id: number;
    name: string;
    tags: string[];
    current: boolean;
    /** 与当前预设共享至少一个标签 */
    related: boolean;
    allowed: boolean;
    reason: string | null;
}

export interface EggState {
    current: { id: number; name: string; tags: string[] } | null;
    items: EggOption[];
    /** 可选预设里实际出现过的标签，用于筛选 */
    tags: { slug: string; name: string }[];
    can_switch: boolean;
    /** 后台配置的允许标签，空数组表示不限 */
    allowed_tags: string[];
    /** 后台是否允许跨标签切换（false = 只能在当前预设的标签内选） */
    allow_tag_switch: boolean;
}

export const fetchEggState = async (uuid: string): Promise<EggState> =>
    (await http.get<{ data: EggState }>(base(uuid))).data.data;

export const switchEgg = async (
    uuid: string,
    eggId: number
): Promise<{ egg: string; egg_id: number; requires_restart: boolean }> =>
    (await http.post<{ data: { egg: string; egg_id: number; requires_restart: boolean } }>(`${base(uuid)}/switch`, {
        egg_id: eggId,
    })).data.data;

/* ---------- 后台配置 ---------- */

const admin = '/api/admin/extensions/egg-switcher';

export interface AdminConfig {
    keep_variables: boolean;
    allow_tag_switch: boolean;
    tags: string[];
}

export interface TagOption {
    id: number;
    slug: string;
    name: string;
}

export const fetchAdminConfig = async (): Promise<AdminConfig> =>
    (await http.get<{ data: AdminConfig }>(`${admin}/config`)).data.data;

export const fetchTags = async (): Promise<TagOption[]> =>
    (await http.get<{ data: TagOption[] }>(`${admin}/tags`)).data.data;

export const saveAdminConfig = async (input: {
    keep_variables?: boolean;
    allow_tag_switch?: boolean;
    tags?: string[];
}): Promise<void> => {
    await http.patch(`${admin}/config`, input);
};
