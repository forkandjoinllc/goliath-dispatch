import { Link } from "@inertiajs/react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/Cta.tsx
var VARIANTS = {
	primary: "bg-safety-600 text-white hover:bg-safety-700",
	secondary: "bg-navy-700 text-white hover:bg-navy-800",
	ghost: "border border-steel-300 bg-white text-navy-700 hover:bg-navy-50"
};
function Cta({ href, children, variant = "primary", className = "" }) {
	return /* @__PURE__ */ jsx(Link, {
		href,
		className: `inline-flex items-center justify-center rounded px-6 py-3 text-sm font-bold uppercase tracking-wide transition ${VARIANTS[variant]} ${className}`,
		children
	});
}
function CtaBand({ title, body, primaryHref, primaryLabel, secondaryHref, secondaryLabel }) {
	return /* @__PURE__ */ jsx("section", {
		className: "bg-navy-800",
		children: /* @__PURE__ */ jsxs("div", {
			className: "mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:flex lg:items-center lg:justify-between lg:px-8",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "max-w-2xl",
				children: [/* @__PURE__ */ jsx("h2", {
					className: "font-display text-2xl font-bold tracking-tight text-white sm:text-3xl",
					children: title
				}), /* @__PURE__ */ jsx("p", {
					className: "mt-3 text-steel-100",
					children: body
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "mt-6 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0",
				children: [/* @__PURE__ */ jsx(Cta, {
					href: primaryHref,
					children: primaryLabel
				}), secondaryHref && secondaryLabel ? /* @__PURE__ */ jsx(Link, {
					href: secondaryHref,
					className: "inline-flex items-center justify-center rounded border border-steel-400 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-navy-700",
					children: secondaryLabel
				}) : null]
			})]
		})
	});
}
//#endregion
export { CtaBand as n, Cta as t };
