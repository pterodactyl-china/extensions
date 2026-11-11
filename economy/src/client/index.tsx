import './styles.css';
import { defineConfiguredExtension } from '@pterodactyl/sdk';

export default defineConfiguredExtension(
    () => ({}),
    {
        setup({ screens }) {
            screens.register('economy', () => import('./screens/WalletScreen'));
            screens.register('admin-economy', () => import('./screens/AdminEconomyScreen'));
        },
    }
);
