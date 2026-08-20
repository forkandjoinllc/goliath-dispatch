import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as LegalDocument } from "./LegalDocument-BdM8h5os.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/Privacy.tsx
var SECTIONS = [
	"intro",
	"dataWeCollect",
	"howWeUseData",
	"electronicSignatureConsent",
	"smsConsentAndStop",
	"trackingLocationDriverConsent",
	"retention",
	"subprocessors",
	"yourRights",
	"dataSecurity",
	"childrensPrivacy",
	"changesToPolicy",
	"contactUs"
];
function Privacy(props) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [/* @__PURE__ */ jsx(PageHero, { title: t("marketing.privacy.hero.title") }), /* @__PURE__ */ jsx(LegalDocument, {
			root: "marketing.privacy",
			sections: SECTIONS
		})]
	});
}
//#endregion
export { Privacy as default };
