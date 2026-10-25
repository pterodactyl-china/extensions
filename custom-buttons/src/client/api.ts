import { http } from '@pterodactyl/sdk';

export type ItemKind = 'button' | 'sidebar';
export type ItemPosition = 'before' | 'after';
export type ItemColor = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

export const COLORS: { value: ItemColor; label: string }[] = [
    { value: 'primary', label: '主色' },
    { value: 'success', label: '绿色' },
    { value: 'warning', label: '黄色' },
    { value: 'danger', label: '红色' },
    { value: 'info', label: '蓝色' },
    { value: 'gray', label: '灰色' },
];

/** Position values are relative to the built-in items; these say where that is on screen. */
export const POSITION_LABELS: Record<ItemKind, Record<ItemPosition, string>> = {
    button: { before: '在电源按钮上方', after: '在电源按钮下方' },
    sidebar: { before: '在内置链接之前', after: '在内置链接之后' },
};

// Readable names for the placeholder tokens the backend reports in `meta.placeholders`.
// The backend list decides which placeholders exist; a token without a name here is
// shown as it is.
const PLACEHOLDER_NAMES: Record<string, string> = {
    '{{env.P_SERVER_UUID}}': '服务器 UUID',
    '{{env.P_SERVER_UUID_SHORT}}': '短 ID',
    '{{env.P_SERVER_NAME}}': '服务器名称',
    '{{env.P_SERVER_ID}}': '服务器编号',
    '{{env.P_SERVER_ALLOCATION_IP}}': 'IP 地址',
    '{{env.P_SERVER_ALLOCATION_PORT}}': '端口',
    '{{env.P_SERVER_NODE}}': '节点名称',
    '{{env.P_SERVER_OWNER}}': '所有者用户名',
};

export const placeholderName = (token: string): string => PLACEHOLDER_NAMES[token] ?? token;

/** What a server page receives: placeholders already substituted by the backend. */
export interface ServerItem {
    id: number;
    label: string;
    url: string;
    icon: string | null;
    color: ItemColor;
    new_tab: boolean;
    position: ItemPosition;
}

export interface ServerItems {
    buttons: ServerItem[];
    sidebar: ServerItem[];
}

export interface AdminItem {
    id: number;
    kind: ItemKind;
    label: string;
    url: string;
    icon: string | null;
    color: ItemColor;
    new_tab: boolean;
    position: ItemPosition;
    sort: number;
    is_active: boolean;
    server_id: number | null;
    egg_id: number | null;
    feature: string | null;
    /** Name of the server in `server_id`, for display. */
    server_name: string | null;
}

export type AdminItemInput = Omit<AdminItem, 'id' | 'server_name'>;

/** The saved fields of an entry, to send it back with one of them changed. */
export const inputOf = ({ id: _id, server_name: _name, ...input }: AdminItem): AdminItemInput => input;

export interface AdminMeta {
    placeholders: string[];
    eggs: { id: number; name: string }[];
}

const ADMIN = '/api/admin/extensions/custom-buttons';

export const fetchServerItems = async (serverUuid: string): Promise<ServerItems> =>
    (
        await http.get<{ data: ServerItems }>(
            `/api/client/servers/${encodeURIComponent(serverUuid)}/extensions/custom-buttons/items`
        )
    ).data.data;

export const fetchAdminItems = async (): Promise<{ items: AdminItem[]; meta: AdminMeta }> => {
    const body = (await http.get<{ data: AdminItem[]; meta: AdminMeta }>(`${ADMIN}/items`)).data;

    return { items: body.data, meta: body.meta };
};

export const createItem = async (input: AdminItemInput): Promise<void> => {
    await http.post(`${ADMIN}/items`, input);
};

export const updateItem = async (id: number, input: AdminItemInput): Promise<void> => {
    await http.patch(`${ADMIN}/items/${id}`, input);
};

export const deleteItem = async (id: number): Promise<void> => {
    await http.delete(`${ADMIN}/items/${id}`);
};
