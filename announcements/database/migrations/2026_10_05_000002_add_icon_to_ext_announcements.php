<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('ext_announcements_announcements', 'icon')) {
            return;
        }

        Schema::table('ext_announcements_announcements', function (Blueprint $table) {
            $table->string('icon', 64)->nullable()->after('type');
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('ext_announcements_announcements', 'icon')) {
            return;
        }

        Schema::table('ext_announcements_announcements', function (Blueprint $table) {
            $table->dropColumn('icon');
        });
    }
};
