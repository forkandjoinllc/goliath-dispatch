import { createInertiaApp, usePage } from "@inertiajs/react";
import createServer from "@inertiajs/react/server";
import ReactDOMServer from "react-dom/server";
import { createContext, useContext, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region resources/js/lib/i18n.tsx
var I18nContext = createContext(null);
function lookup(dictionary, key) {
	let node = dictionary;
	for (const segment of key.split(".")) {
		if (typeof node !== "object" || node === null) return void 0;
		node = node[segment];
	}
	return node;
}
/** Sustituye {name} por su valor. Sin motor de plantillas: no hace falta. */
function interpolate(text, params) {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
function I18nProvider({ children }) {
	const { locale, localeTag, dictionary } = usePage().props;
	const value = useMemo(() => {
		const t = (key, params) => {
			const found = lookup(dictionary, key);
			if (typeof found === "string") return interpolate(found, params);
			return key;
		};
		return {
			locale,
			localeTag,
			t,
			list: (key) => {
				const found = lookup(dictionary, key);
				if (Array.isArray(found)) return found;
				if (found && typeof found === "object") return Object.values(found).filter((v) => typeof v === "string");
				return [];
			},
			has: (key) => lookup(dictionary, key) !== void 0
		};
	}, [
		dictionary,
		locale,
		localeTag
	]);
	return /* @__PURE__ */ jsx(I18nContext.Provider, {
		value,
		children
	});
}
function useI18n() {
	const context = useContext(I18nContext);
	if (context === null) throw new Error("useI18n necesita estar dentro de <I18nProvider>");
	return context;
}
//#endregion
//#region resources/js/lib/resolve-page.ts
/**
* Resuelve el componente de una página por su nombre de Inertia.
*
* Se escribe a mano en vez de usar `resolvePageComponent` de laravel-vite-plugin
* porque el tipo que devuelve ese helper (una promesa de promesa) no encaja con
* el `ComponentResolver` de Inertia y obliga a un cast que apaga la comprobación
* de tipos justo en el punto donde importa: si una página no existe, quiero
* enterarme por un error claro, no por una pantalla en blanco.
*/
function resolvePage(pages) {
	return async (name) => {
		const path = `./pages/${name}.tsx`;
		const loader = pages[path];
		if (!loader) {
			const available = Object.keys(pages).map((p) => p.replace("./pages/", "").replace(".tsx", "")).sort();
			throw new Error(`Página de Inertia "${name}" no encontrada en ${path}.\nDisponibles: ${available.join(", ")}`);
		}
		return (await loader()).default;
	};
}
//#endregion
//#region resources/js/ssr.tsx
var appName = "Goliath Dispatch";
/**
* Añade la marca al título SOLO si no la lleva ya.
*
* Los títulos SEO de las páginas públicas vienen del diccionario y varios ya
* empiezan por «Goliath Dispatch — …». Con un sufijo incondicional salía
* «Goliath Dispatch — Heavy-Haul Dispatch Software · Goliath Dispatch», que en
* un resultado de búsqueda gasta la mitad de los caracteres visibles repitiendo
* el nombre.
*/
function pageTitle(title) {
	if (!title) return appName;
	return title.includes(appName) ? title : `${title} · ${appName}`;
}
createServer((page) => createInertiaApp({
	page,
	render: ReactDOMServer.renderToString,
	title: pageTitle,
	resolve: resolvePage(/* #__PURE__ */ Object.assign({
		"./pages/Auth/Signup.tsx": () => import("./assets/Signup-FkXK-1fD.js"),
		"./pages/Auth/SignupDone.tsx": () => import("./assets/SignupDone-CCBuoK7y.js"),
		"./pages/Marketing/About.tsx": () => import("./assets/About-BrCqp804.js"),
		"./pages/Marketing/CarrierSignup.tsx": () => import("./assets/CarrierSignup-Dk3rSudQ.js"),
		"./pages/Marketing/Contact.tsx": () => import("./assets/Contact-puyfZpQY.js"),
		"./pages/Marketing/ForCarriers.tsx": () => import("./assets/ForCarriers-DFLaZbym.js"),
		"./pages/Marketing/ForClients.tsx": () => import("./assets/ForClients-JDcr-rB0.js"),
		"./pages/Marketing/HeavyHaul.tsx": () => import("./assets/HeavyHaul-Bz2hBCZl.js"),
		"./pages/Marketing/Home.tsx": () => import("./assets/Home-BMdqvnm9.js"),
		"./pages/Marketing/Privacy.tsx": () => import("./assets/Privacy-BhW0aUml.js"),
		"./pages/Marketing/Resources.tsx": () => import("./assets/Resources-Dp1p1T9R.js"),
		"./pages/Marketing/Services.tsx": () => import("./assets/Services-ClRv3v5S.js"),
		"./pages/Marketing/Terms.tsx": () => import("./assets/Terms-C7Ul82U8.js")
	})),
	setup: ({ App, props }) => /* @__PURE__ */ jsx(App, {
		...props,
		children: ({ Component, props: pageProps, key }) => /* @__PURE__ */ jsx(I18nProvider, { children: /* @__PURE__ */ jsx(Component, { ...pageProps }, key) })
	})
}));
//#endregion
export { useI18n as t };
