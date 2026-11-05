<?php

use AiAssistant\Http\Controllers\ConfigController;
use Illuminate\Support\Facades\Route;

// Base: /api/admin/extensions/ai-assistant
Route::get('/config', [ConfigController::class, 'show'])->name('config.show');
Route::patch('/config', [ConfigController::class, 'update'])->name('config.update');
Route::get('/tags', [ConfigController::class, 'tags'])->name('tags');
Route::post('/models', [ConfigController::class, 'models'])->name('models');
Route::post('/detect', [ConfigController::class, 'detect'])->name('detect');
Route::post('/test', [ConfigController::class, 'test'])->name('test');
