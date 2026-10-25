<?php

namespace Announcements\Http\Controllers;

use Announcements\Models\Announcement;
use Announcements\Models\Dismissal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class ClientAnnouncementController
{
    /** Announcements currently active for the given area and not dismissed by the requesting user. */
    public function active(Request $request): JsonResponse
    {
        $data = $request->validate(['area' => ['required', Rule::in(Announcement::AREAS)]]);
        $user = $request->user();

        $dismissed = Dismissal::query()->where('user_id', $user->id)->pluck('announcement_id')->all();

        $items = Announcement::query()
            ->active()
            ->whereNotIn('id', $dismissed)
            ->orderBy('id')
            ->get()
            ->filter(fn (Announcement $a) => $a->showsInArea($data['area']))
            ->map(fn (Announcement $a) => [
                'id' => $a->id,
                'title' => $a->title,
                'body' => $a->body,
                'type' => $a->type,
                'icon' => $a->icon,
                'url_label' => $a->url_label,
                'url_link' => $a->url_link,
                'dismissible' => $a->dismissible,
            ])
            ->values()
            ->all();

        return new JsonResponse(['data' => $items]);
    }

    public function dismiss(Request $request, int $id): Response
    {
        $announcement = Announcement::query()->findOrFail($id);

        abort_unless($announcement->dismissible, 422, '该公告不允许关闭。');

        Dismissal::query()->firstOrCreate([
            'announcement_id' => $announcement->id,
            'user_id' => $request->user()->id,
        ]);

        return new Response('', 204);
    }
}
