<?php

declare(strict_types=1);

namespace Economy\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Pterodactyl\Models\User;

/**
 * 钱包余额。
 *
 * @property int $id
 * @property int $user_id
 * @property int $balance
 * @property int $frozen
 */
class WalletAccount extends Model
{
    protected $table = 'ext_economy_wallets';

    protected $fillable = ['user_id', 'balance', 'frozen'];

    protected $casts = [
        'user_id' => 'integer',
        'balance' => 'integer',
        'frozen' => 'integer',
    ];

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** 可用余额（扣掉冻结部分）。 */
    public function available(): int
    {
        return max(0, $this->balance - $this->frozen);
    }
}
