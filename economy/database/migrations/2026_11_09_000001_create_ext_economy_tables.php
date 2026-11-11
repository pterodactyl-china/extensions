<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 钱包：一个用户一条记录，没有记录表示 0。
        Schema::create('ext_economy_wallets', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id')->unique();
            $table->bigInteger('balance')->default(0);
            // 冻结额度（预留给下架/争议处理，当前不参与可用余额计算）。
            $table->bigInteger('frozen')->default(0);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        // 流水：只追加，不修改。
        Schema::create('ext_economy_transactions', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->bigInteger('amount');
            $table->bigInteger('balance_after');
            // 记账来源，例如 ai-assistant、store、checkin、admin。
            $table->string('kind', 32);
            $table->string('description')->nullable();
            // 幂等键：同一个 reference 只会生效一次。
            $table->string('reference', 191)->nullable()->unique();
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['user_id', 'id']);
            $table->index('kind');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ext_economy_transactions');
        Schema::dropIfExists('ext_economy_wallets');
    }
};
