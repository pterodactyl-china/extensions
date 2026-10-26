<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 旧版本用过的文件名执行过同一批建表，表已存在就跳过。
        if (Schema::hasTable('ext_announcements_announcements')) {
            return;
        }

        Schema::create('ext_announcements_announcements', function (Blueprint $table) {
            $table->increments('id');
            $table->string('title');
            $table->text('body')->nullable();
            $table->string('type', 16)->default('info');
            $table->string('url_label')->nullable();
            $table->string('url_link', 2048)->nullable();
            $table->json('panels')->nullable();
            $table->boolean('dismissible')->default(true);
            $table->timestamp('valid_from')->nullable();
            $table->timestamp('valid_to')->nullable();
            $table->timestamps();
        });

        Schema::create('ext_announcements_dismissals', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('announcement_id');
            $table->unsignedInteger('user_id');
            $table->timestamp('created_at')->nullable();

            $table->unique(['announcement_id', 'user_id'], 'ext_announcements_dismissals_unique');
            $table->foreign('announcement_id')->references('id')->on('ext_announcements_announcements')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ext_announcements_dismissals');
        Schema::dropIfExists('ext_announcements_announcements');
    }
};
