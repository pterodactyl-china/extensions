import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';
import { installFooter } from './footer';

export default definePterodactylExtension({
    setup() {
        // 号码由 /beian/config.json 提供，不依赖前端设置，避免留空时整份配置被丢弃。
        void installFooter();
    },
});
