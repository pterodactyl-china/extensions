<?php

declare(strict_types=1);

namespace Economy\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Pterodactyl\Models\User;

/**
 * 钱包流水，只追加。
 *
 * @property int $id
 * @property int $user_id
 * @property int $amount
 * @property int $balance_after
 * @property string $kind
 * @property string|null $description
 * @property string|null $reference
 */
class WalletTransaction extends Model
{
    protected $table = 'ext_economy_transactions';

    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'amount',
        'balance_after',
        'kind',
        'description',
        'reference',
        'meta',
        'created_at',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'amount' => 'integer',
        'balance_after' => 'integer',
        'meta' => 'array',
        'created_at' => 'datetime',
    ];

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array<string, mixed> */
    public function toPublicArray(): array
    {
        return [
            'id' => $this->id,
            'amount' => $this->amount,
            'balance_after' => $this->balance_after,
            'kind' => $this->kind,
            'description' => $this->description,
            'reference' => $this->reference,
            'meta' => $this->meta ?? [],
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
