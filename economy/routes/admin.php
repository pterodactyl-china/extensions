<?php

declare(strict_types=1);

use Economy\Http\Controllers\AdminWalletController;
use Illuminate\Support\Facades\Route;

Route::get('/config', [AdminWalletController::class, 'config'])->name('config.show');
Route::patch('/config', [AdminWalletController::class, 'update'])->name('config.update');

// 用数字 id 而不是 {user}：面板的 User 路由键是 uuid，隐式绑定会把「1」当 uuid 查，必然 404。
Route::get('/users', [AdminWalletController::class, 'users'])->name('users.index');
Route::post('/users/adjust-batch', [AdminWalletController::class, 'adjustBatch'])->name('users.adjust-batch');
Route::get('/users/{id}', [AdminWalletController::class, 'user'])->whereNumber('id')->name('users.show');
Route::post('/users/{id}/adjust', [AdminWalletController::class, 'adjust'])->whereNumber('id')->name('users.adjust');
Route::get('/users/{id}/transactions', [AdminWalletController::class, 'transactions'])->whereNumber('id')->name('users.transactions');
