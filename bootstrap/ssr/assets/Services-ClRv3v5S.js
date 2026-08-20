import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as Section } from "./Section-DsJrJ0AG.js";
import { n as CtaBand } from "./Cta-kux4IRC9.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/FeatureBlock.tsx
/**
* Un bloque «título + texto + viñetas» a partir de una raíz del diccionario.
*
* Las viñetas se leen como bullet1..bulletN y se para en la primera que falta.
* Es lo que permite que un bloque con dos viñetas y otro con cinco usen el mismo
* componente sin declarar cuántas tiene cada uno en el código: el diccionario ya
* lo dice.
*/
function FeatureBlock({ root, maxBullets = 6 }) {
	const { t, has } = useI18n();
	const bullets = [];
	for (let index = 1; index <= maxBullets; index += 1) {
		const key = `${root}.bullet${index}`;
		if (!has(key)) break;
		bullets.push(t(key));
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "border-l-2 border-safety-500 pl-6",
		children: [
			/* @__PURE__ */ jsx("h3", {
				className: "font-display text-xl font-bold text-navy-700",
				children: t(`${root}.title`)
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-3 text-steel-700",
				children: t(`${root}.body`)
			}),
			bullets.length > 0 ? /* @__PURE__ */ jsx("ul", {
				className: "mt-4 flex flex-col gap-2",
				children: bullets.map((bullet) => /* @__PURE__ */ jsxs("li", {
					className: "flex gap-3 text-sm text-steel-700",
					children: [/* @__PURE__ */ jsx("span", {
						"aria-hidden": "true",
						className: "mt-2 size-1.5 shrink-0 rounded-full bg-safety-600"
					}), /* @__PURE__ */ jsx("span", { children: bullet })]
				}, bullet))
			}) : null
		]
	});
}
//#endregion
//#region resources/js/pages/Marketing/Services.tsx
var BLOCKS = [
	"dispatch",
	"onboardingCompliance",
	"documentManagement",
	"invoicingSettlements",
	"tracking",
	"permitsEscorts"
];
function Services(props) {
	const { t, locale } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [
			/* @__PURE__ */ jsx(PageHero, {
				title: t("marketing.services.hero.title"),
				subtitle: t("marketing.services.hero.subtitle")
			}),
			/* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsx("div", {
				className: "grid gap-12 lg:grid-cols-2",
				children: BLOCKS.map((block) => /* @__PURE__ */ jsx(FeatureBlock, { root: `marketing.services.${block}` }, block))
			}) }),
			/* @__PURE__ */ jsx(CtaBand, {
				title: t("marketing.home.closingCta.title"),
				body: t("marketing.home.closingCta.body"),
				primaryHref: `/${locale}/contact`,
				primaryLabel: t("marketing.home.closingCta.primaryCta"),
				secondaryHref: "/signup",
				secondaryLabel: t("marketing.home.closingCta.secondaryCta")
			})
		]
	});
}
//#endregion
export { Services as default };
