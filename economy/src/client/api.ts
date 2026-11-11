import { http } from '@pterodactyl/sdk';

const client = '/api/client/extensions/economy';
const admin = '/api/admin/extensions/economy';

export interface WalletEntry {
    id: number;
    amount: number;
    balance_after: number;
    kind: string;
    description: string | null;
    reference: string | null;
    meta: Record<string, unknown>;
    created_at: string | null;
}

export interface WalletState {
    balance: number;
    currency: string;
    symbol: string;
    transactions: WalletEntry[];
}

export interface EconomyConfig {
    currency_name: string;
    currency_symbol: string;
    max_adjust: number;
    allow_negative: boolean;
}

export interface WalletUser {
    id: number;
    username: string;
    email: string;
    name: string | null;
    balance: number;
}

export const fetchWallet = async (): Promise<WalletState> =>
    (await http.get<{ data: WalletState }>(client)).data.data;

export const fetchTransactions = async (limit = 50, kind?: string): Promise<WalletEntry[]> =>
    (
        await http.get<{ data: WalletEntry[] }>(`${client}/transactions`, {
            params: { limit, kind },
        })
    ).data.data;

export const fetchConfig = async (): Promise<EconomyConfig> =>
    (await http.get<{ data: EconomyConfig }>(`${admin}/config`)).data.data;

export const saveConfig = async (input: Partial<EconomyConfig>): Promise<EconomyConfig> =>
    (await http.patch<{ data: EconomyConfig }>(`${admin}/config`, input)).data.data;

export const searchUsers = async (query: string): Promise<{ users: WalletUser[]; currency: string }> =>
    (await http.get<{ data: { users: WalletUser[]; currency: string } }>(`${admin}/users`, {
        params: { query },
    })).data.data;

export const fetchUser = async (
    id: number
): Promise<WalletUser & { currency: string; transactions: WalletEntry[] }> =>
    (await http.get<{ data: WalletUser & { currency: string; transactions: WalletEntry[] } }>(`${admin}/users/${id}`))
        .data.data;

export const adjustBalance = async (
    id: number,
    input: { amount: number; description?: string }
): Promise<{ entry: WalletEntry; balance: number }> =>
    (await http.post<{ data: { entry: WalletEntry; balance: number } }>(`${admin}/users/${id}/adjust`, input)).data
        .data;

export interface BatchResult {
    adjusted: { id: number; username: string; balance: number }[];
    failed: { id: number; username?: string; message: string }[];
}

export const adjustBalanceBatch = async (input: {
    ids: number[];
    amount: number;
    description?: string;
}): Promise<BatchResult> =>
    (await http.post<{ data: BatchResult }>(`${admin}/users/adjust-batch`, input)).data.data;
