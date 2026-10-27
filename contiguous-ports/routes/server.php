<?php

use ContiguousPorts\Http\Controllers\BulkPortController;
use Illuminate\Support\Facades\Route;

// Base: /api/client/servers/{server}/extensions/contiguous-ports
Route::get('/', [BulkPortController::class, 'index'])->name('index');
Route::post('/assign', [BulkPortController::class, 'assign'])->name('assign');
