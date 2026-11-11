<?php

declare(strict_types=1);

use Economy\Http\Controllers\WalletController;
use Illuminate\Support\Facades\Route;

Route::get('/', [WalletController::class, 'show'])->name('wallet.show');
Route::get('/transactions', [WalletController::class, 'transactions'])->name('wallet.transactions');
