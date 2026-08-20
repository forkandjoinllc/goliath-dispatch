import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as Section } from "./Section-DsJrJ0AG.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/Resources.tsx
function Resources(props) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [/* @__PURE__ */ jsx(PageHero, {
			title: t("marketing.resources.hero.title"),
			subtitle: t("marketing.resources.hero.subtitle")
		}), /* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsxs("div", {
			className: "mx-auto max-w-xl rounded border border-dashed border-steel-300 p-10 text-center",
			children: [/* @__PURE__ */ jsx("h2", {
				className: "font-display text-xl font-bold text-navy-700",
				children: t("marketing.resources.emptyState.title")
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-3 text-steel-700",
				children: t("marketing.resources.emptyState.body")
			})]
		}) })]
	});
}
//#endregion
export { Resources as default };
