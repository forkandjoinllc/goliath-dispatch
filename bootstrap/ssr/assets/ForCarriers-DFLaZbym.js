import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { n as SectionHeading, t as Section } from "./Section-DsJrJ0AG.js";
import { n as CtaBand } from "./Cta-kux4IRC9.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/ForCarriers.tsx
var DOCUMENTS = [
	"certificateOfAuthority",
	"coi",
	"w9",
	"noticeOfAssignment"
];
function ForCarriers(props) {
	const { t, locale } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [
			/* @__PURE__ */ jsx(PageHero, {
				title: t("marketing.forCarriers.hero.title"),
				subtitle: t("marketing.forCarriers.hero.subtitle")
			}),
			/* @__PURE__ */ jsxs(Section, { children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.forCarriers.onboarding.title") }), /* @__PURE__ */ jsx("div", {
				className: "mt-10 grid gap-6 sm:grid-cols-2",
				children: DOCUMENTS.map((doc) => /* @__PURE__ */ jsxs("div", {
					className: "rounded border border-steel-200 p-6",
					children: [/* @__PURE__ */ jsx("h3", {
						className: "font-display text-lg font-bold text-navy-700",
						children: t(`marketing.forCarriers.onboarding.${doc}.title`)
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-2 text-sm text-steel-700",
						children: t(`marketing.forCarriers.onboarding.${doc}.body`)
					})]
				}, doc))
			})] }),
			/* @__PURE__ */ jsx(Section, {
				tone: "tint",
				children: /* @__PURE__ */ jsx("div", {
					className: "grid gap-10 lg:grid-cols-2",
					children: ["verification", "settlements"].map((block) => /* @__PURE__ */ jsxs("div", {
						className: "border-l-2 border-safety-500 pl-6",
						children: [/* @__PURE__ */ jsx("h2", {
							className: "font-display text-xl font-bold text-navy-700",
							children: t(`marketing.forCarriers.${block}.title`)
						}), /* @__PURE__ */ jsx("p", {
							className: "mt-3 text-steel-700",
							children: t(`marketing.forCarriers.${block}.body`)
						})]
					}, block))
				})
			}),
			/* @__PURE__ */ jsx(CtaBand, {
				title: t("marketing.forCarriers.cta.title"),
				body: t("marketing.forCarriers.cta.body"),
				primaryHref: `/${locale}/carrier-signup`,
				primaryLabel: t("marketing.forCarriers.cta.button")
			})
		]
	});
}
//#endregion
export { ForCarriers as default };
