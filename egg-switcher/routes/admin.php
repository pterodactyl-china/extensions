<?php

declare(strict_types=1);

use EggSwitcher\Http\Controllers\AdminConfigController;
use Illuminate\Support\Facades\Route;

Route::get('/config', [AdminConfigController::class, 'show'])->name('config.show');
Route::patch('/config', [AdminConfigController::class, 'update'])->name('config.update');
Route::get('/tags', [AdminConfigController::class, 'tags'])->name('tags');
