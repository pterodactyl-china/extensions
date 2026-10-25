import { http } from '@pterodactyl/sdk';

export type AnnouncementType = 'info' | 'success' | 'warning' | 'danger';
export type AnnouncementArea = 'dashboard' | 'server' | 'admin';

export const AREAS: { value: AnnouncementArea; label: string }[] = [
    { value: 'dashboard', label: '仪表盘' },
    { value: 'server', label: '服务器控制台' },
    { value: 'admin', label: '管理概览' },
];

export const TYPES: { value: AnnouncementType; label: string }[] = [
    { value: 'info', label: '信息' },
    { value: 'success', label: '成功' },
    { value: 'warning', label: '警告' },
    { value: 'danger', label: '危险' },
];

export interface ActiveAnnouncement {
    id: number;
    title: string;
    body: string | null;
    type: AnnouncementType;
    icon: string | null;
    url_label: string | null;
    url_link: string | null;
    dismissible: boolean;
}

export interface Announcement extends ActiveAnnouncement {
    panels: AnnouncementArea[];
    valid_from: string | null;
    valid_to: string | null;
    created_at: string;
}

export interface AnnouncementInput {
    title: string;
    body: string | null;
    type: AnnouncementType;
    icon: string | null;
    url_label: string | null;
    url_link: string | null;
    panels: AnnouncementArea[];
    dismissible: boolean;
    valid_from: string | null;
    valid_to: string | null;
}

const CLIENT = '/api/client/extensions/announcements';
const ADMIN = '/api/admin/extensions/announcements';

export const fetchActive = async (area: AnnouncementArea): Promise<ActiveAnnouncement[]> =>
    (await http.get<{ data: ActiveAnnouncement[] }>(`${CLIENT}/active`, { params: { area } })).data.data;

export const dismissAnnouncement = async (id: number): Promise<void> => {
    await http.post(`${CLIENT}/${id}/dismiss`);
};

export interface AnnouncementList {
    announcements: Announcement[];
    /** How many users an email goes to; null when the panel did not report it. */
    userCount: number | null;
}

export const fetchAll = async (): Promise<AnnouncementList> => {
    const { data } = await http.get<{ data: Announcement[]; meta?: { user_count?: number } }>(`${ADMIN}/announcements`);

    return { announcements: data.data, userCount: data.meta?.user_count ?? null };
};

export const createAnnouncement = async (input: AnnouncementInput): Promise<void> => {
    await http.post(`${ADMIN}/announcements`, input);
};

export const updateAnnouncement = async (id: number, input: AnnouncementInput): Promise<void> => {
    await http.patch(`${ADMIN}/announcements/${id}`, input);
};

export const deleteAnnouncement = async (id: number): Promise<void> => {
    await http.delete(`${ADMIN}/announcements/${id}`);
};

export const emailAnnouncement = async (id: number): Promise<number> =>
    (await http.post<{ recipients: number }>(`${ADMIN}/announcements/${id}/email`, {})).data.recipients;
