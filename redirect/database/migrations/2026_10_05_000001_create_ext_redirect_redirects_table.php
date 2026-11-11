<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 旧版本用过的文件名执行过同一批建表，表已存在就跳过。
        if (Schema::hasTable('ext_redirect_redirects')) {
            return;
        }

        Schema::create('ext_redirect_redirects', function (Blueprint $table) {
            $table->increments('id');
            $table->string('slug', 64)->unique();
            $table->string('target', 2048);
            $table->unsignedSmallInteger('status_code')->default(302);
            $table->boolean('enabled')->default(true);
            $table->unsignedBigInteger('hits')->default(0);
            $table->timestamp('last_hit_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ext_redirect_redirects');
    }
};
