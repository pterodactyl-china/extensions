<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 旧版本用过的文件名执行过同一批建表，表已存在就跳过。
        if (Schema::hasTable('ext_custom_buttons_items')) {
            return;
        }

        Schema::create('ext_custom_buttons_items', function (Blueprint $table) {
            $table->increments('id');
            $table->string('kind', 16);
            $table->string('label');
            $table->string('url', 2048);
            $table->string('icon', 64)->nullable();
            $table->string('color', 16)->default('primary');
            $table->boolean('new_tab')->default(true);
            $table->string('position', 16)->default('after');
            $table->integer('sort')->default(0);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('egg_id')->nullable();
            $table->string('feature')->nullable();
            $table->timestamps();

            $table->index(['kind', 'is_active']);
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ext_custom_buttons_items');
    }
};
