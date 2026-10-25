import './styles.css';
import { defineConfiguredExtension } from '@pterodactyl/sdk';
import BeianNotice from './BeianNotice';

// 三个号码都是 ->frontend()->public() 的，所以未登录的登录页也能拿到它们。
// 面板在登录前加载 bundle 时 config 为空，因此每一个都按字符串兜底。
const read = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// 开关默认开启，只有明确关闭才算关闭；关闭等价于没填，组件只拿要显示的号码。
const on = (value: unknown): boolean => value !== false && value !== 'false' && value !== '0' && value !== 0;

export default defineConfiguredExtension(
    (config) => ({
        icp: on(config.show_icp) ? read(config.icp_number) : '',
        police: on(config.show_police) ? read(config.police_number) : '',
        license: on(config.show_license) ? read(config.license_number) : '',
    }),
    {
        setup({ config, slots }) {
            const notice = { icp: config.icp, police: config.police, license: config.license };
            const footer = () => <BeianNotice {...notice} />;

            // 面板没有页脚插槽，只有每页各自的页面级插槽，因此逐个注册。
            // 名称取自 SDK 的 SLOT_NAMES，写错会导致扩展整体加载失败。

            // 认证页
            slots.register('auth.login.after', footer);
            slots.register('auth.checkpoint.after', footer);
            slots.register('auth.password.after', footer);
            slots.register('auth.passwordReset.after', footer);

            // 仪表盘
            slots.register('dashboard.after', footer);

            // 账户
            slots.register('account.overview.after', footer);
            slots.register('account.api.after', footer);
            slots.register('account.ssh.after', footer);
            slots.register('account.activity.after', footer);

            // 服务器
            slots.register('server.console.after', footer);
            slots.register('server.files.after', footer);
            slots.register('server.files.editor.after', footer);
            slots.register('server.databases.after', footer);
            slots.register('server.schedules.after', footer);
            slots.register('server.schedules.detail.after', footer);
            slots.register('server.users.after', footer);
            slots.register('server.users.create.after', footer);
            slots.register('server.backups.after', footer);
            slots.register('server.network.after', footer);
            slots.register('server.startup.after', footer);
            slots.register('server.settings.after', footer);
            slots.register('server.activity.after', footer);

            // 管理后台
            slots.register('panel.overview.after', footer);
            slots.register('panel.users.after', footer);
            slots.register('panel.users.create.after', footer);
            slots.register('panel.users.detail.after', footer);
            slots.register('panel.locations.after', footer);
            slots.register('panel.locations.detail.after', footer);
            slots.register('panel.nodes.after', footer);
            slots.register('panel.nodes.create.after', footer);
            slots.register('panel.nodes.detail.after', footer);
            slots.register('panel.nodes.detail.about.after', footer);
            slots.register('panel.nodes.detail.settings.after', footer);
            slots.register('panel.nodes.detail.configuration.after', footer);
            slots.register('panel.nodes.detail.allocations.after', footer);
            slots.register('panel.nodes.detail.tags.after', footer);
            slots.register('panel.nodes.detail.servers.after', footer);
            slots.register('panel.servers.after', footer);
            slots.register('panel.servers.create.after', footer);
            slots.register('panel.servers.detail.after', footer);
            slots.register('panel.servers.detail.about.after', footer);
            slots.register('panel.servers.detail.details.after', footer);
            slots.register('panel.servers.detail.build.after', footer);
            slots.register('panel.servers.detail.startup.after', footer);
            slots.register('panel.servers.detail.databases.after', footer);
            slots.register('panel.servers.detail.mounts.after', footer);
            slots.register('panel.servers.detail.manage.after', footer);
            slots.register('panel.servers.detail.delete.after', footer);
            slots.register('panel.databaseHosts.after', footer);
            slots.register('panel.databaseHosts.create.after', footer);
            slots.register('panel.databaseHosts.detail.after', footer);
            slots.register('panel.mounts.after', footer);
            slots.register('panel.mounts.create.after', footer);
            slots.register('panel.mounts.detail.after', footer);
            slots.register('panel.eggs.after', footer);
            slots.register('panel.eggs.create.after', footer);
            slots.register('panel.eggs.detail.after', footer);
            slots.register('panel.eggs.detail.configuration.after', footer);
            slots.register('panel.eggs.detail.tags.after', footer);
            slots.register('panel.eggs.detail.variables.after', footer);
            slots.register('panel.eggs.detail.script.after', footer);
            slots.register('panel.tags.after', footer);
            slots.register('panel.activity.after', footer);
            slots.register('panel.settings.after', footer);
            slots.register('panel.extensions.after', footer);
            slots.register('panel.themes.after', footer);
            slots.register('panel.apiKeys.after', footer);
        },
    }
);
