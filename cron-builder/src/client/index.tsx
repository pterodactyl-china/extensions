import './styles.css';
import { defineConfiguredExtension } from '@pterodactyl/sdk';
import { installCronBuilder } from './inject';

export default defineConfiguredExtension(
    () => ({}),
    {
        setup() {
            // 没有后台设置，也没有独立页面：只在计划任务弹窗里做增强。
            installCronBuilder();
        },
    }
);
