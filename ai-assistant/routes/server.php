<?php

use AiAssistant\Http\Controllers\AssistantController;
use Illuminate\Support\Facades\Route;

// Base: /api/client/servers/{server}/extensions/ai-assistant
Route::get('/', [AssistantController::class, 'state'])->name('state');
Route::post('/chat', [AssistantController::class, 'chat'])->name('chat');
Route::get('/logs', [AssistantController::class, 'logs'])->name('logs');
Route::get('/files', [AssistantController::class, 'files'])->name('files');
Route::post('/my-ai', [AssistantController::class, 'saveUserAi'])->name('my-ai.save');
Route::post('/my-ai/models', [AssistantController::class, 'myAiModels'])->name('my-ai.models');
Route::post('/my-ai/test', [AssistantController::class, 'myAiTest'])->name('my-ai.test');
Route::delete('/my-ai', [AssistantController::class, 'clearUserAi'])->name('my-ai.clear');

// 所有写操作都必须带提案 id：先展示、再确认、后执行。
Route::post('/apply', [AssistantController::class, 'apply'])->name('apply');
Route::post('/reject', [AssistantController::class, 'reject'])->name('reject');
