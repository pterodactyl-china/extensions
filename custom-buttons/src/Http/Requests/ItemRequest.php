<?php

namespace CustomButtons\Http\Requests;

use CustomButtons\Models\CustomItem;
use CustomButtons\Services\UrlTemplate;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Pterodactyl\Services\Extensions\ExtensionManifest;

class ItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Access is enforced by the admin-api middleware group (root admins only).
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['required', Rule::in(CustomItem::KINDS)],
            'label' => ['required', 'string', 'max:191'],
            'url' => [
                'required', 'string', 'max:2048',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! is_string($value) || ! UrlTemplate::templateIsSafe($value)) {
                        $fail('网址必须以 http://、https:// 开头，或以单个 "/" 开头（相对链接）。');
                    }
                },
            ],
            'icon' => ['nullable', 'string', 'max:64', 'regex:'.ExtensionManifest::ICON_REGEX],
            'color' => ['required', Rule::in(CustomItem::COLORS)],
            'new_tab' => ['required', 'boolean'],
            'position' => ['required', Rule::in(CustomItem::POSITIONS)],
            'sort' => ['required', 'integer', 'min:-100000', 'max:100000'],
            'is_active' => ['required', 'boolean'],
            'server_id' => ['nullable', 'integer', 'exists:servers,id'],
            'egg_id' => ['nullable', 'integer', 'exists:eggs,id'],
            'feature' => ['nullable', 'string', 'max:191'],
        ];
    }
}
