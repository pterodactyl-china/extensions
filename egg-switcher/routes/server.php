<?php

declare(strict_types=1);

use EggSwitcher\Http\Controllers\EggSwitchController;
use Illuminate\Support\Facades\Route;

Route::get('/', [EggSwitchController::class, 'show'])->name('show');
Route::post('/switch', [EggSwitchController::class, 'change'])->name('switch');
