import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as Section } from "./Section-DsJrJ0AG.js";
import { n as CtaBand } from "./Cta-kux4IRC9.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/ForClients.tsx
function ForClients(props) {
	const { t, locale } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [
			/* @__PURE__ */ jsx(PageHero, {
				title: t("marketing.forClients.hero.title"),
				subtitle: t("marketing.forClients.hero.subtitle")
			}),
			/* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsxs("div", {
				className: "grid gap-10 lg:grid-cols-2",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "border-l-2 border-safety-500 pl-6",
					children: [/* @__PURE__ */ jsx("h2", {
						className: "font-display text-xl font-bold text-navy-700",
						children: t("marketing.forClients.quoting.title")
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-3 text-steel-700",
						children: t("marketing.forClients.quoting.body")
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "border-l-2 border-safety-500 pl-6",
					children: [
						/* @__PURE__ */ jsx("h2", {
							className: "font-display text-xl font-bold text-navy-700",
							children: t("marketing.forClients.tracking.title")
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-3 text-steel-700",
							children: t("marketing.forClients.tracking.body")
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-3 rounded bg-navy-50 p-3 text-sm text-navy-800",
							children: t("marketing.forClients.tracking.accountNote")
						})
					]
				})]
			}) }),
			/* @__PURE__ */ jsx(CtaBand, {
				title: t("marketing.forClients.cta.title"),
				body: t("marketing.forClients.cta.body"),
				primaryHref: `/${locale}/contact`,
				primaryLabel: t("marketing.forClients.cta.button")
			})
		]
	});
}
//#endregion
export { ForClients as default };
