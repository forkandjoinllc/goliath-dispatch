import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as LegalDocument } from "./LegalDocument-BdM8h5os.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/Terms.tsx
var SECTIONS = [
	"acceptance",
	"description",
	"accountsEligibility",
	"carrierResponsibilities",
	"feesBilling",
	"prohibitedUses",
	"intellectualProperty",
	"disclaimers",
	"limitationOfLiability",
	"termination",
	"disputeResolutionGoverningLaw",
	"changesToTerms",
	"contactUs"
];
function Terms(props) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [/* @__PURE__ */ jsx(PageHero, { title: t("marketing.terms.hero.title") }), /* @__PURE__ */ jsx(LegalDocument, {
			root: "marketing.terms",
			sections: SECTIONS
		})]
	});
}
//#endregion
export { Terms as default };
