import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/PageHero.tsx
function PageHero({ title, subtitle, eyebrow, children }) {
	return /* @__PURE__ */ jsxs("section", {
		className: "relative overflow-hidden bg-navy-700",
		children: [/* @__PURE__ */ jsx("div", {
			className: "hazard-stripe absolute inset-x-0 top-0 h-1.5",
			"aria-hidden": "true"
		}), /* @__PURE__ */ jsx("div", {
			className: "mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20",
			children: /* @__PURE__ */ jsxs("div", {
				className: "max-w-3xl",
				children: [
					eyebrow ? /* @__PURE__ */ jsx("p", {
						className: "uppercase-heading text-xs text-safety-500",
						children: eyebrow
					}) : null,
					/* @__PURE__ */ jsx("h1", {
						className: "mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl",
						children: title
					}),
					subtitle ? /* @__PURE__ */ jsx("p", {
						className: "mt-5 text-lg text-steel-100",
						children: subtitle
					}) : null,
					children
				]
			})
		})]
	});
}
//#endregion
export { PageHero as t };
