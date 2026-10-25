<?php

namespace Redirect\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Redirect\Models\ShortRedirect;
use Redirect\Rules\AbsoluteHttpUrl;

class RedirectRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Access is enforced by the admin-api middleware group (root admins only).
        return true;
    }

    /** Slugs are case-insensitive: store and match them lowercase. */
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('slug'))) {
            $this->merge(['slug' => mb_strtolower(trim($this->input('slug')))]);
        }
        if (is_string($this->input('target'))) {
            $this->merge(['target' => trim($this->input('target'))]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'slug' => [
                'required',
                'string',
                'max:64',
                'regex:/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/',
                Rule::unique('ext_redirect_redirects', 'slug')->ignore($this->route('id')),
            ],
            'target' => ['required', 'string', 'max:2048', new AbsoluteHttpUrl()],
            'status_code' => ['required', 'integer', Rule::in(ShortRedirect::STATUS_CODES)],
            'enabled' => ['required', 'boolean'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'slug.regex' => '短链接名称只能包含小写字母、数字、连字符和下划线，并且必须以字母或数字开头和结尾。',
        ];
    }
}
