<?php

namespace Announcements\Notifications;

use Announcements\Models\Announcement;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Pterodactyl\Models\User;

class AnnouncementCreated extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public Announcement $announcement) {}

    /** @return string[] */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(User $notifiable): MailMessage
    {
        $message = (new MailMessage)
            ->subject($this->announcement->title)
            ->greeting('你好，' . $notifiable->username . '：')
            ->line($this->announcement->body ?? $this->announcement->title);

        if ($this->announcement->url_label && $this->announcement->url_link) {
            $message->action($this->announcement->url_label, $this->announcement->url_link);
        }

        return $message;
    }
}
