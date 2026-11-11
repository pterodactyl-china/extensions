<?php

use Beian\Http\Controllers\BeianConfigController;
use Illuminate\Support\Facades\Route;

// Base: /beian
Route::get('/config.json', [BeianConfigController::class, 'show'])->name('config');
