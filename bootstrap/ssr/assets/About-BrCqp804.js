import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { n as SectionHeading, t as Section } from "./Section-DsJrJ0AG.js";
import { n as CtaBand } from "./Cta-kux4IRC9.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/About.tsx
var VALUES = [
	"operationalHonesty",
	"bilingualByDefault",
	"auditableFinancials"
];
function About(props) {
	const { t, locale } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [
			/* @__PURE__ */ jsx(PageHero, {
				title: t("marketing.about.hero.title"),
				subtitle: t("marketing.about.hero.subtitle")
			}),
			/* @__PURE__ */ jsxs(Section, { children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.about.story.title") }), /* @__PURE__ */ jsx("p", {
				className: "mt-6 max-w-3xl whitespace-pre-line text-lg text-steel-700",
				children: t("marketing.about.story.body")
			})] }),
			/* @__PURE__ */ jsxs(Section, {
				tone: "tint",
				children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.about.values.heading") }), /* @__PURE__ */ jsx("div", {
					className: "mt-10 grid gap-6 lg:grid-cols-3",
					children: VALUES.map((value) => /* @__PURE__ */ jsxs("div", {
						className: "rounded border border-steel-200 bg-white p-6",
						children: [/* @__PURE__ */ jsx("h3", {
							className: "font-display text-lg font-bold text-navy-700",
							children: t(`marketing.about.values.${value}.title`)
						}), /* @__PURE__ */ jsx("p", {
							className: "mt-3 text-steel-700",
							children: t(`marketing.about.values.${value}.body`)
						})]
					}, value))
				})]
			}),
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
export { About as default };
