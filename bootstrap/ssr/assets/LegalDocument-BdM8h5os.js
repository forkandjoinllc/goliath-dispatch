import { t as useI18n } from "../ssr.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/LegalDocument.tsx
/**
* Privacidad y Términos comparten forma: encabezado con fecha, un aviso de que
* el texto no es asesoramiento legal, y N secciones numeradas.
*
* El aviso de revisión por abogado NO es decorativo y no se quita: el sistema
* incluye firma electrónica y consentimiento de rastreo por GPS, y en ningún
* sitio se afirma que la implementación técnica baste para la validez legal.
*/
function LegalDocument({ root, sections }) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs("div", {
		className: "mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8",
		children: [
			/* @__PURE__ */ jsx("p", {
				className: "text-sm text-steel-600",
				children: t(`${root}.hero.lastUpdated`)
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mt-6 rounded border-l-4 border-safety-500 bg-safety-50 p-4",
				children: /* @__PURE__ */ jsx("p", {
					className: "text-sm text-carbon",
					children: t(`${root}.hero.counselNote`)
				})
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mt-12 flex flex-col gap-10",
				children: sections.map((section, index) => /* @__PURE__ */ jsxs("section", {
					id: section,
					children: [/* @__PURE__ */ jsxs("h2", {
						className: "font-display text-xl font-bold text-navy-700",
						children: [
							/* @__PURE__ */ jsxs("span", {
								className: "text-steel-500",
								children: [index + 1, "."]
							}),
							" ",
							t(`${root}.sections.${section}.title`)
						]
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-3 whitespace-pre-line text-steel-700",
						children: t(`${root}.sections.${section}.body`)
					})]
				}, section))
			})
		]
	});
}
//#endregion
export { LegalDocument as t };
