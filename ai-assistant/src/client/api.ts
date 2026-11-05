import { http } from '@pterodactyl/sdk';

const base = (uuid: string): string => `/api/client/servers/${uuid}/extensions/ai-assistant`;

export interface AssistantState {
    enabled: boolean;
    scope: 'all' | 'tags';
    tags: string[];
    allow_execute: boolean;
    allow_files: boolean;
    allow_dirs: string[];
    rate_limit: number;
    /** 免费额度：0 表示不限 */
    daily: {
        limit: number;
        remaining: number | null;
        tokens_limit: number;
        tokens_remaining: number | null;
    };
    has_key: boolean;
    command_rules: number;
    /** 当前用户 + 当前服务器是否真的可以执行命令 */
    can_execute: boolean;
    /** 当前用户 + 当前服务器是否真的可以写文件 */
    can_write: boolean;
    /** 是否有文件读取权限（决定能否分析 mods） */
    can_read: boolean;
    /** 用户自带的 AI 凭据（BYOK） */
    user_ai: {
        has_key: boolean;
        provider: string;
        model: string;
        base_url: string;
        providers: { value: string; label: string; url: string }[];
        /** 用户自带的搜索服务（后台没配也能用） */
        search_provider: string;
        search_base_url: string;
        has_search_key: boolean;
    };
    charge: {
        enabled: boolean;
        tokens_per_credit: number;
        balance: number | null;
    };
    provider: string;
    model: string;
    server: {
        name: string;
        egg: string | null;
        tags: string[];
    };
}

/** 待确认操作：确认前不会执行任何东西。 */
export interface Proposal {
    id: string;
    type: 'command' | 'file';
    commands?: string[];
    path?: string;
    lines?: number;
    bytes?: number;
    preview?: string;
    /** 写入目标是否已存在（true = 会覆盖） */
    exists?: boolean;
    allowed: boolean;
    /** 高风险命令（停机 / 权限 / 封禁 / 插件管理），需要额外勾选确认 */
    dangerous?: boolean;
    reason: string | null;
    expires_at: string;
}

/** Agent 的工具调用轨迹（列表目录 / 读文件 / 搜索…）。 */
export interface ToolTrace {
    name: string;
    ok: boolean;
    summary: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    proposal?: Proposal | null;
    charged?: number;
    tokens?: number;
    trace?: ToolTrace[];
}

export interface ChatResult {
    reply: string;
    proposal: Proposal | null;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    charged: number;
    balance: number | null;
    /** 本次用的是用户自己的 Key（不扣积分） */
    own_key: boolean;
    /** 本轮调用了哪些工具 */
    trace?: ToolTrace[];
}

/** 保存自己的 AI 凭据：用自己的 Key 时不扣积分。 */
export const saveMyAi = async (
    uuid: string,
    input: {
        provider: string;
        model: string;
        base_url: string;
        api_key?: string;
        search_provider?: string;
        search_base_url?: string;
        search_api_key?: string;
    }
): Promise<void> => {
    await http.post(`${base(uuid)}/my-ai`, input);
};

export const clearMyAi = async (uuid: string): Promise<void> => {
    await http.delete(`${base(uuid)}/my-ai`);
};

/** 用用户自己的 Key 拉模型列表。 */
export const myAiModels = async (
    uuid: string,
    input: { provider: string; base_url: string; api_key?: string }
): Promise<string[]> =>
    (await http.post<{ data: { models: string[] } }>(`${base(uuid)}/my-ai/models`, input)).data.data.models;

/** 用用户自己的 Key 测试一条最小请求。 */
export const myAiTest = async (
    uuid: string,
    input: { provider: string; base_url: string; model: string; api_key?: string }
): Promise<{ model: string; ms: number; reply: string }> =>
    (await http.post<{ data: { model: string; ms: number; reply: string } }>(`${base(uuid)}/my-ai/test`, input))
        .data.data;

export const fetchState = async (uuid: string): Promise<AssistantState> =>
    (await http.get<{ data: AssistantState }>(base(uuid))).data.data;

export const fetchLogs = async (uuid: string): Promise<string> =>
    (await http.get<{ data: { text: string } }>(`${base(uuid)}/logs`)).data.data.text;

/** 只把文本发给 AI；回复里的操作会作为 proposal 返回，需用户另行确认。 */
export const chat = async (
    uuid: string,
    messages: ChatMessage[],
    withLogs: boolean,
    files: string[] = [],
    dirs: string[] = []
): Promise<ChatResult> =>
    (
        await http.post<{ data: ChatResult }>(`${base(uuid)}/chat`, {
            messages: messages.map((message) => ({ role: message.role, content: message.content })),
            with_logs: withLogs,
            files,
            dirs,
        })
    ).data.data;

/** 「附加文件」选择器用：列出允许读取的目录。 */
export interface FileEntry {
    name: string;
    path: string;
    is_file: boolean;
    size: number;
}

export interface FileListing {
    dir: string;
    parent: string | null;
    dirs: string[];
    items: FileEntry[];
}

export const listFiles = async (uuid: string, dir: string): Promise<FileListing> =>
    (
        await http.get<{ data: FileListing }>(`${base(uuid)}/files`, {
            params: dir === '' ? {} : { dir },
        })
    ).data.data;

export interface ApplyResult {
    type: 'command' | 'file';
    commands?: string[];
    path?: string;
    bytes?: number;
}

/** 确认执行：命令会二次校验白名单，文件会二次校验目录。 */
export const applyProposal = async (uuid: string, id: string, acknowledge = false): Promise<ApplyResult> =>
    (await http.post<{ data: ApplyResult }>(`${base(uuid)}/apply`, { id, acknowledge })).data.data;

export const rejectProposal = async (uuid: string, id: string): Promise<void> => {
    await http.post(`${base(uuid)}/reject`, { id });
};

/* ---------- 后台配置 ---------- */

const admin = '/api/admin/extensions/ai-assistant';

export interface AdminConfig {
    providers: { value: string; label: string; url: string }[];
    provider: string;
    model: string;
    base_url: string;
    has_key: boolean;
    scope: 'all' | 'tags';
    tags: string[];
    allow_execute: boolean;
    command_mode: 'all' | 'whitelist';
    allow_files: boolean;
    file_allow_dirs: string[];
    file_read_dirs: string[];
    command_allow: string;
    charge_enabled: boolean;
    tokens_per_credit: number;
    rate_limit: number;
    daily_limit: number;
    daily_token_limit: number;
    max_tokens: number;
    max_tokens_guest: number;
    timeout: number;
    enabled: boolean;
    search_provider: string;
    search_base_url: string;
    search_fallback: boolean;
    search_has_key: boolean;
    billing_available: boolean;
    system_prompt: string;
    tools_disabled: string;
    custom_tools: string;
}

export interface TagOption {
    id: number;
    slug: string;
    name: string;
}

export interface SaveConfigInput {
    provider?: string;
    model?: string;
    base_url?: string;
    api_key?: string;
    scope?: 'all' | 'tags';
    tags?: string[];
    allow_execute?: boolean;
    command_mode?: 'all' | 'whitelist';
    allow_files?: boolean;
    file_allow_dirs?: string[];
    file_read_dirs?: string[];
    command_allow?: string;
    charge_enabled?: boolean;
    tokens_per_credit?: number;
    rate_limit?: number;
    daily_limit?: number;
    daily_token_limit?: number;
    max_tokens?: number;
    max_tokens_guest?: number;
    timeout?: number;
    enabled?: boolean;
    search_provider?: string;
    search_api_key?: string;
    search_base_url?: string;
    search_fallback?: boolean;
    system_prompt?: string;
    tools_disabled?: string;
    custom_tools?: string;
}

export const fetchAdminConfig = async (): Promise<AdminConfig> =>
    (await http.get<{ data: AdminConfig }>(`${admin}/config`)).data.data;

export const fetchTagOptions = async (): Promise<TagOption[]> =>
    (await http.get<{ data: TagOption[] }>(`${admin}/tags`)).data.data;

/** 拉取提供商支持的模型（OpenAI 兼容的 /models）。 */
export const fetchModels = async (input: {
    provider: string;
    base_url: string;
    api_key?: string;
}): Promise<string[]> =>
    (await http.post<{ data: { models: string[] } }>(`${admin}/models`, input)).data.data.models;

export const testConnection = async (input: {
    provider: string;
    base_url: string;
    model: string;
    api_key?: string;
}): Promise<{ model: string; ms: number; reply: string }> =>
    (await http.post<{ data: { model: string; ms: number; reply: string } }>(`${admin}/test`, input)).data.data;

/** 自动探测可用地址（CodeBuddy 的模型路由域名随实例变化）。 */
export const detectEndpoint = async (input: {
    provider: string;
    api_key?: string;
}): Promise<{ base_url: string; models: string[] }> =>
    (await http.post<{ data: { base_url: string; models: string[] } }>(`${admin}/detect`, input)).data.data;

export const saveAdminConfig = async (input: SaveConfigInput): Promise<void> => {
    await http.patch(`${admin}/config`, input);
};

/**
 * 把接口错误翻译成人能看懂的一段话。
 * 面板的 httpErrorToHuman 对 5xx 有时只给通用文案，这里优先取后端的 message / errors。
 */
export const describeError = (error: unknown): string => {
    const response = (
        error as {
            response?: {
                status?: number;
                data?: { message?: unknown; errors?: Record<string, string[] | string> };
            };
        }
    ).response;

    const data = response?.data;
    const rawMessage = typeof data?.message === 'string' ? data.message : null;
    const firstError = data?.errors === undefined ? null : Object.values(data.errors)[0];
    const detail = Array.isArray(firstError) ? firstError[0] : firstError;

    const text =
        rawMessage !== null && rawMessage !== 'The given data was invalid.'
            ? rawMessage
            : (detail ?? rawMessage);

    if (text !== null && text !== undefined && text !== '') {
        return response?.status === undefined ? text : `${text}（HTTP ${response.status}）`;
    }

    return error instanceof Error ? error.message : '请求失败，请查看面板日志。';
};

