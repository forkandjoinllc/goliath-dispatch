import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/Section.tsx
var TONES = {
	white: "bg-white text-carbon",
	tint: "bg-navy-50 text-carbon",
	navy: "bg-navy-700 text-white"
};
function Section({ children, tone = "white", id, className = "" }) {
	return /* @__PURE__ */ jsx("section", {
		id,
		className: `${TONES[tone]} ${className}`,
		children: /* @__PURE__ */ jsx("div", {
			className: "mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24",
			children
		})
	});
}
function SectionHeading({ eyebrow, title, subtitle, tone = "white" }) {
	const onNavy = tone === "navy";
	return /* @__PURE__ */ jsxs("div", {
		className: "max-w-3xl",
		children: [
			eyebrow ? /* @__PURE__ */ jsx("p", {
				className: `uppercase-heading text-xs ${onNavy ? "text-safety-500" : "text-safety-600"}`,
				children: eyebrow
			}) : null,
			/* @__PURE__ */ jsx("h2", {
				className: `mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl ${onNavy ? "text-white" : "text-navy-700"}`,
				children: title
			}),
			subtitle ? /* @__PURE__ */ jsx("p", {
				className: `mt-4 text-lg ${onNavy ? "text-steel-100" : "text-steel-700"}`,
				children: subtitle
			}) : null
		]
	});
}
//#endregion
export { SectionHeading as n, Section as t };
