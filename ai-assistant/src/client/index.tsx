import './styles.css';
import { defineConfiguredExtension } from '@pterodactyl/sdk';

export default defineConfiguredExtension(
    () => ({}),
    {
        setup({ screens }) {
            screens.register('ai-assistant', () => import('./screens/AssistantScreen'));
            screens.register('admin-ai-assistant', () => import('./screens/AdminScreen'));
        },
    }
);
