import { get } from 'svelte/store';
import { json, redirect } from '@sveltejs/kit';
import type { Handle, RequestEvent, HandleServerError } from '@sveltejs/kit';
import { initAcceptLanguageHeaderDetector } from 'typesafe-i18n/detectors';
import jwt_decode from "jwt-decode";
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { goto } from '$app/navigation';
import { setSession } from '$houdini';
import { detectLocale, i18n, isLocale } from '$i18n/i18n-util';
import { loadAllLocales } from '$i18n/i18n-util.sync';

loadAllLocales();
const L = i18n();

export const handle: Handle = async ({ event, resolve }) => {

	// read language slug
	const [, lang] = event.url.pathname.split('/');

	// redirect to base locale if no locale slug was found
	if (!lang) {
		const locale = getPreferredLocale(event);
		return new Response(null, {
			status: 302,
			headers: { Location: `/${locale}` },
		});
	}

	// if slug is not a locale, use base locale (e.g. api endpoints)
	const locale: Locales = isLocale(lang) ? (lang as Locales) : getPreferredLocale(event);
	const LL = L[locale];

	// bind locale and translation functions to current request
	event.locals.locale = locale;
	event.locals.LL = LL;

	const { cookies, request } = event;
	const token = cookies.get('Authorization');

	const loginPathName = `/${locale}/login`;
	if (!token && event.url.pathname !== loginPathName) {
		toLoginPage(loginPathName);
	} else {
		setSession(event, { token, locale });
		if (!event.locals.jwt && token) {
			event.locals.jwt = jwt_decode(token.substring(7));
		}
	}

	// replace html lang attribute with correct language
	const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', locale) });
	if (event.url.pathname !== loginPathName && response?.status === 401) {
		if (request.headers.get('Content-Type')?.includes('application/json')) {
			return json({ errors: [{ message: '-40100: unauthorized', extensions: { code: -40100 } }] }, { status: 401 });
		}
		toLoginPage(loginPathName);
	}
	return response;
}

export const handleError: HandleServerError = async ({ error, event }) => {
	console.error(error);
	const { headers } = event.request;
	headers.delete('Accept');
	const [, lang] = event.url.pathname.split('/');
	const locale = isLocale(lang) ? (lang as Locales) : getPreferredLocale(event);
	toLoginPage(`/${locale}/login`);
};

const toLoginPage = (loginPathName: string) => {
	if (browser) {
		goto(loginPathName + `?from=${get(page).url.pathname}`);
	} else {
		throw redirect(307, loginPathName + `?from=${get(page).url.pathname}`);
	}
}

const getPreferredLocale = ({ request }: RequestEvent): Locales => {
	// detect the preferred language the user has configured in his browser
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-Language
	const acceptLanguageDetector = initAcceptLanguageHeaderDetector(request);

	return detectLocale(acceptLanguageDetector);
}