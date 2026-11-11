<?php

declare(strict_types=1);

use Economy\Http\Controllers\ApplicationWalletController;
use Illuminate\Support\Facades\Route;

// 数字 id：User 的路由键是 uuid，用 {user} 会绑定失败。
Route::get('/users/{id}/balance', [ApplicationWalletController::class, 'balance'])->whereNumber('id')->name('users.balance');
Route::post('/users/{id}/adjust', [ApplicationWalletController::class, 'adjust'])->whereNumber('id')->name('users.adjust');
