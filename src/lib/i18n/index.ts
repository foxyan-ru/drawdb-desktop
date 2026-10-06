import { register, init, getLocaleFromNavigator } from 'svelte-i18n';

register('en', () => import('./locales/en'));

init({
	fallbackLocale: 'en',
	initialLocale: getLocaleFromNavigator()
});
