// Unified Services Interface using ES6 Proxies
import { LocalAuthService } from './LocalAuthService';
import { OnlineAuthService } from './OnlineAuthService';
import { LocalGameService } from './LocalGameService';
import { OnlineGameService } from './OnlineGameService';
import { isOnlineMode } from './api';

const localAuth = new LocalAuthService();
const onlineAuth = new OnlineAuthService();
const localGame = new LocalGameService();
const onlineGame = new OnlineGameService();

export const authService: any = new Proxy({} as any, {
  get(_, prop) {
    const service = isOnlineMode() ? onlineAuth : localAuth;
    const value = Reflect.get(service, prop);
    if (typeof value === 'function') {
      return value.bind(service);
    }
    return value;
  }
});

export const gameService: any = new Proxy({} as any, {
  get(_, prop) {
    const service = isOnlineMode() ? onlineGame : localGame;
    const value = Reflect.get(service, prop);
    if (typeof value === 'function') {
      return value.bind(service);
    }
    return value;
  }
});
