import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, NamedIcon } from '@pterodactyl/sdk';
import { dismissAnnouncement, fetchActive, type ActiveAnnouncement, type AnnouncementArea } from './api';

export type BannerContent = Omit<ActiveAnnouncement, 'id'>;

interface BannerProps {
    announcement: BannerContent;
    onDismiss?: () => void;
    dismissing?: boolean;
}

/** One announcement as users see it. The admin dialog renders its live preview with this too. */
export function Banner({ announcement, onDismiss, dismissing }: BannerProps) {
    return (
        <Alert
            type={announcement.type}
            title={
                announcement.icon ? (
                    <span className={'ann:inline-flex ann:items-center ann:gap-2'}>
                        <NamedIcon name={announcement.icon} size={16} aria-hidden={'true'} />
                        {announcement.title}
                    </span>
                ) : (
                    announcement.title
                )
            }
        >
            <div className={'ann:flex ann:w-full ann:items-center ann:gap-4'}>
                <div
                    className={
                        'ann:flex ann:min-w-0 ann:flex-1 ann:flex-wrap ann:items-center ann:gap-x-4 ann:gap-y-2'
                    }
                >
                    {announcement.body && <span className={'ann:whitespace-pre-line'}>{announcement.body}</span>}
                    {announcement.url_link && announcement.url_label && (
                        <a
                            href={announcement.url_link}
                            target={'_blank'}
                            rel={'noopener noreferrer'}
                            className={'ann:underline'}
                        >
                            {announcement.url_label}
                        </a>
                    )}
                </div>
                {/* 关闭固定在内容区最右侧，正文多长都不会把它挤走。 */}
                {announcement.dismissible && (
                    <div className={'ann:shrink-0'}>
                        <Button.Text type={'button'} size={'xsmall'} disabled={dismissing} onClick={onDismiss}>
                            关闭
                        </Button.Text>
                    </div>
                )}
            </div>
        </Alert>
    );
}

export default function Banners({ area }: { area: AnnouncementArea }) {
    const queryClient = useQueryClient();
    const queryKey = ['ext-announcements', 'active', area];

    const { data } = useQuery({ queryKey, queryFn: () => fetchActive(area), staleTime: 60_000, retry: false });

    const dismiss = useMutation({
        mutationFn: dismissAnnouncement,
        onSuccess: (_result, id) =>
            queryClient.setQueryData<ActiveAnnouncement[]>(queryKey, (current) =>
                (current ?? []).filter((item) => item.id !== id)
            ),
    });

    if (!data || data.length === 0) {
        return null;
    }

    return (
        <div className={'ann:mb-4 ann:grid ann:gap-3'}>
            {data.map((announcement) => (
                <Banner
                    key={announcement.id}
                    announcement={announcement}
                    dismissing={dismiss.isPending}
                    onDismiss={() => dismiss.mutate(announcement.id)}
                />
            ))}
        </div>
    );
}
