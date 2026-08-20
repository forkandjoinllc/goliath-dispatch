import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { n as SectionHeading, t as Section } from "./Section-DsJrJ0AG.js";
import { n as CtaBand } from "./Cta-kux4IRC9.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/HeavyHaul.tsx
var TOPICS = [
	"legalLimits",
	"permitTriggers",
	"escortTriggers",
	"routeSurveys",
	"stateVariation"
];
var FAQ = [
	"q1",
	"q2",
	"q3",
	"q4"
];
function HeavyHaul(props) {
	const { t, locale } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [
			/* @__PURE__ */ jsx(PageHero, {
				title: t("marketing.heavyHaul.hero.title"),
				subtitle: t("marketing.heavyHaul.hero.subtitle")
			}),
			/* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsx("div", {
				className: "grid gap-10 lg:grid-cols-2",
				children: TOPICS.map((topic) => /* @__PURE__ */ jsxs("div", {
					className: "border-l-2 border-safety-500 pl-6",
					children: [/* @__PURE__ */ jsx("h2", {
						className: "font-display text-xl font-bold text-navy-700",
						children: t(`marketing.heavyHaul.${topic}.title`)
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-3 text-steel-700",
						children: t(`marketing.heavyHaul.${topic}.body`)
					})]
				}, topic))
			}) }),
			/* @__PURE__ */ jsx(Section, {
				tone: "tint",
				children: /* @__PURE__ */ jsxs("div", {
					className: "rounded border-l-4 border-safety-500 bg-white p-6",
					children: [/* @__PURE__ */ jsx("h2", {
						className: "uppercase-heading text-sm text-safety-600",
						children: t("marketing.heavyHaul.disclaimer.title")
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-3 text-steel-700",
						children: t("marketing.heavyHaul.disclaimer.body")
					})]
				})
			}),
			/* @__PURE__ */ jsxs(Section, { children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.heavyHaul.faq.heading") }), /* @__PURE__ */ jsx("dl", {
				className: "mt-10 flex flex-col gap-8",
				children: FAQ.map((item) => /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("dt", {
					className: "font-display text-lg font-bold text-navy-700",
					children: t(`marketing.heavyHaul.faq.${item}.question`)
				}), /* @__PURE__ */ jsx("dd", {
					className: "mt-2 text-steel-700",
					children: t(`marketing.heavyHaul.faq.${item}.answer`)
				})] }, item))
			})] }),
			/* @__PURE__ */ jsx(CtaBand, {
				title: t("marketing.home.closingCta.title"),
				body: t("marketing.home.closingCta.body"),
				primaryHref: `/${locale}/contact`,
				primaryLabel: t("marketing.home.closingCta.primaryCta")
			})
		]
	});
}
//#endregion
export { HeavyHaul as default };
