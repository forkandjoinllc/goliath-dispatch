import { t as useI18n } from "../ssr.js";
import { Head, Link } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/layouts/AuthLayout.tsx
/**
* El envoltorio de las pantallas de acceso.
*
* Deliberadamente austero comparado con el sitio público: aquí no hay
* navegación, ni pie, ni enlaces a las páginas de marketing más allá del logo.
* Quien llega a esta pantalla viene a entrar, y cada enlace de más es una
* oportunidad de irse.
*/
function AuthLayout({ title, subtitle, children, footer }) {
	const { locale } = useI18n();
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Head, { title }), /* @__PURE__ */ jsxs("div", {
		className: "flex min-h-dvh flex-col bg-navy-50",
		children: [/* @__PURE__ */ jsx("div", {
			className: "hazard-stripe h-1.5",
			"aria-hidden": "true"
		}), /* @__PURE__ */ jsx("div", {
			className: "flex flex-1 items-center justify-center px-4 py-12",
			children: /* @__PURE__ */ jsxs("div", {
				className: "w-full max-w-md",
				children: [
					/* @__PURE__ */ jsx(Link, {
						href: `/${locale}`,
						className: "mb-8 inline-block",
						children: /* @__PURE__ */ jsx("img", {
							src: "/brand/logo-primary.png",
							srcSet: "/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x",
							alt: "Goliath Dispatch",
							width: 168,
							height: 40,
							className: "h-9 w-auto"
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "rounded border border-steel-200 bg-white p-8",
						children: [
							/* @__PURE__ */ jsx("h1", {
								className: "font-display text-2xl font-bold text-navy-700",
								children: title
							}),
							subtitle ? /* @__PURE__ */ jsx("p", {
								className: "mt-2 text-sm text-steel-700",
								children: subtitle
							}) : null,
							/* @__PURE__ */ jsx("div", {
								className: "mt-8",
								children
							})
						]
					}),
					footer ? /* @__PURE__ */ jsx("div", {
						className: "mt-6 text-center text-sm text-steel-700",
						children: footer
					}) : null
				]
			})
		})]
	})] });
}
//#endregion
export { AuthLayout as t };
