import { t as useI18n } from "../ssr.js";
import { r as TextField, t as CheckboxField } from "./Field-BQKN739Z.js";
import { t as AntiSpamFields } from "./AntiSpamFields-CH5apMH2.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as Section } from "./Section-DsJrJ0AG.js";
import { useForm } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/CarrierSignup.tsx
var NEXT_STEPS = [
	"coi",
	"authority",
	"w9",
	"noa",
	"equipmentPhotos"
];
function CarrierSignup({ formToken, ...props }) {
	const { t, locale } = useI18n();
	const form = useForm({
		legal_name: "",
		dba: "",
		dot_number: "",
		mc_number: "",
		website: "",
		contact_first_name: "",
		contact_last_name: "",
		email: "",
		phone: "",
		physical_line1: "",
		physical_line2: "",
		physical_city: "",
		physical_state: "",
		physical_postal_code: "",
		mailing_same_as_physical: true,
		mailing_line1: "",
		mailing_line2: "",
		mailing_city: "",
		mailing_state: "",
		mailing_postal_code: "",
		preferred_locale: locale,
		uses_factoring: false,
		lead_consent: false,
		privacy_consent: false,
		terms_consent: false,
		hp_field: "",
		form_token: formToken
	});
	const label = (key) => t(`marketing.forms.labels.${key}`);
	const section = (key) => t(`marketing.carrierSignup.sections.${key}`);
	if (form.wasSuccessful) return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [/* @__PURE__ */ jsx(PageHero, { title: t("marketing.carrierSignup.hero.title") }), /* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsxs("div", {
			role: "status",
			className: "mx-auto max-w-2xl rounded border-l-4 border-safety-500 bg-navy-50 p-8",
			children: [/* @__PURE__ */ jsx("h2", {
				className: "font-display text-2xl font-bold text-navy-700",
				children: t("marketing.carrierSignup.success.title")
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-3 text-steel-700",
				children: t("marketing.carrierSignup.success.body")
			})]
		}) })]
	});
	const set = (key) => (event) => form.setData(key, event.target.value);
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [/* @__PURE__ */ jsx(PageHero, {
			title: t("marketing.carrierSignup.hero.title"),
			subtitle: t("marketing.carrierSignup.hero.subtitle")
		}), /* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsxs("div", {
			className: "grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]",
			children: [/* @__PURE__ */ jsxs("form", {
				noValidate: true,
				onSubmit: (event) => {
					event.preventDefault();
					form.post("/carrier-signup", { preserveScroll: true });
				},
				className: "relative flex flex-col gap-10",
				children: [
					/* @__PURE__ */ jsx(AntiSpamFields, { token: formToken }),
					/* @__PURE__ */ jsxs("fieldset", {
						className: "flex flex-col gap-5",
						children: [
							/* @__PURE__ */ jsx("legend", {
								className: "uppercase-heading mb-4 text-sm text-navy-700",
								children: section("companyInfo")
							}),
							/* @__PURE__ */ jsx(TextField, {
								label: label("legalName"),
								required: true,
								value: form.data.legal_name,
								onChange: set("legal_name"),
								error: form.errors.legal_name
							}),
							/* @__PURE__ */ jsx(TextField, {
								label: label("dba"),
								value: form.data.dba,
								onChange: set("dba"),
								error: form.errors.dba
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid gap-5 sm:grid-cols-2",
								children: [/* @__PURE__ */ jsx(TextField, {
									label: label("dotNumber"),
									required: true,
									inputMode: "numeric",
									value: form.data.dot_number,
									onChange: set("dot_number"),
									error: form.errors.dot_number
								}), /* @__PURE__ */ jsx(TextField, {
									label: label("mcNumber"),
									value: form.data.mc_number,
									onChange: set("mc_number"),
									error: form.errors.mc_number
								})]
							}),
							/* @__PURE__ */ jsx(TextField, {
								label: label("website"),
								type: "url",
								value: form.data.website,
								onChange: set("website"),
								error: form.errors.website
							})
						]
					}),
					/* @__PURE__ */ jsxs("fieldset", {
						className: "flex flex-col gap-5",
						children: [
							/* @__PURE__ */ jsx("legend", {
								className: "uppercase-heading mb-4 text-sm text-navy-700",
								children: section("contactInfo")
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid gap-5 sm:grid-cols-2",
								children: [/* @__PURE__ */ jsx(TextField, {
									label: label("contactFirstName"),
									required: true,
									autoComplete: "given-name",
									value: form.data.contact_first_name,
									onChange: set("contact_first_name"),
									error: form.errors.contact_first_name
								}), /* @__PURE__ */ jsx(TextField, {
									label: label("contactLastName"),
									required: true,
									autoComplete: "family-name",
									value: form.data.contact_last_name,
									onChange: set("contact_last_name"),
									error: form.errors.contact_last_name
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid gap-5 sm:grid-cols-2",
								children: [/* @__PURE__ */ jsx(TextField, {
									label: label("email"),
									type: "email",
									required: true,
									autoComplete: "email",
									value: form.data.email,
									onChange: set("email"),
									error: form.errors.email
								}), /* @__PURE__ */ jsx(TextField, {
									label: label("phone"),
									type: "tel",
									required: true,
									autoComplete: "tel",
									value: form.data.phone,
									onChange: set("phone"),
									error: form.errors.phone
								})]
							})
						]
					}),
					/* @__PURE__ */ jsxs("fieldset", {
						className: "flex flex-col gap-5",
						children: [
							/* @__PURE__ */ jsx("legend", {
								className: "uppercase-heading mb-4 text-sm text-navy-700",
								children: section("addresses")
							}),
							/* @__PURE__ */ jsx("p", {
								className: "text-sm font-medium text-steel-700",
								children: label("physicalAddress")
							}),
							/* @__PURE__ */ jsx(TextField, {
								label: label("addressLine1"),
								required: true,
								value: form.data.physical_line1,
								onChange: set("physical_line1"),
								error: form.errors.physical_line1
							}),
							/* @__PURE__ */ jsx(TextField, {
								label: label("addressLine2"),
								value: form.data.physical_line2,
								onChange: set("physical_line2"),
								error: form.errors.physical_line2
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid gap-5 sm:grid-cols-3",
								children: [
									/* @__PURE__ */ jsx(TextField, {
										label: label("city"),
										required: true,
										value: form.data.physical_city,
										onChange: set("physical_city"),
										error: form.errors.physical_city
									}),
									/* @__PURE__ */ jsx(TextField, {
										label: label("state"),
										required: true,
										maxLength: 2,
										value: form.data.physical_state,
										onChange: set("physical_state"),
										error: form.errors.physical_state
									}),
									/* @__PURE__ */ jsx(TextField, {
										label: label("postalCode"),
										required: true,
										value: form.data.physical_postal_code,
										onChange: set("physical_postal_code"),
										error: form.errors.physical_postal_code
									})
								]
							}),
							/* @__PURE__ */ jsx(CheckboxField, {
								label: label("mailingSameAsPhysical"),
								checked: form.data.mailing_same_as_physical,
								onChange: (e) => form.setData("mailing_same_as_physical", e.target.checked)
							}),
							!form.data.mailing_same_as_physical ? /* @__PURE__ */ jsxs("div", {
								className: "flex flex-col gap-5 border-l-2 border-steel-200 pl-5",
								children: [
									/* @__PURE__ */ jsx("p", {
										className: "text-sm font-medium text-steel-700",
										children: label("mailingAddress")
									}),
									/* @__PURE__ */ jsx(TextField, {
										label: label("addressLine1"),
										required: true,
										value: form.data.mailing_line1,
										onChange: set("mailing_line1"),
										error: form.errors.mailing_line1
									}),
									/* @__PURE__ */ jsx(TextField, {
										label: label("addressLine2"),
										value: form.data.mailing_line2,
										onChange: set("mailing_line2"),
										error: form.errors.mailing_line2
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "grid gap-5 sm:grid-cols-3",
										children: [
											/* @__PURE__ */ jsx(TextField, {
												label: label("city"),
												required: true,
												value: form.data.mailing_city,
												onChange: set("mailing_city"),
												error: form.errors.mailing_city
											}),
											/* @__PURE__ */ jsx(TextField, {
												label: label("state"),
												required: true,
												maxLength: 2,
												value: form.data.mailing_state,
												onChange: set("mailing_state"),
												error: form.errors.mailing_state
											}),
											/* @__PURE__ */ jsx(TextField, {
												label: label("postalCode"),
												required: true,
												value: form.data.mailing_postal_code,
												onChange: set("mailing_postal_code"),
												error: form.errors.mailing_postal_code
											})
										]
									})
								]
							}) : null
						]
					}),
					/* @__PURE__ */ jsxs("fieldset", {
						className: "flex flex-col gap-5",
						children: [
							/* @__PURE__ */ jsx("legend", {
								className: "uppercase-heading mb-4 text-sm text-navy-700",
								children: section("preferences")
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex flex-col gap-1.5",
								children: [/* @__PURE__ */ jsx("label", {
									htmlFor: "preferred-locale",
									className: "text-sm font-medium text-carbon",
									children: label("preferredLanguage")
								}), /* @__PURE__ */ jsxs("select", {
									id: "preferred-locale",
									value: form.data.preferred_locale,
									onChange: (e) => form.setData("preferred_locale", e.target.value),
									className: "rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200",
									children: [/* @__PURE__ */ jsx("option", {
										value: "en",
										children: "English"
									}), /* @__PURE__ */ jsx("option", {
										value: "es",
										children: "Español"
									})]
								})]
							}),
							/* @__PURE__ */ jsx(CheckboxField, {
								label: label("factoringApplies"),
								checked: form.data.uses_factoring,
								onChange: (e) => form.setData("uses_factoring", e.target.checked)
							})
						]
					}),
					/* @__PURE__ */ jsxs("fieldset", {
						className: "flex flex-col gap-4",
						children: [
							/* @__PURE__ */ jsx("legend", {
								className: "uppercase-heading mb-4 text-sm text-navy-700",
								children: section("consent")
							}),
							/* @__PURE__ */ jsx(CheckboxField, {
								label: t("marketing.forms.consent.leadConsent"),
								checked: form.data.lead_consent,
								onChange: (e) => form.setData("lead_consent", e.target.checked),
								error: form.errors.lead_consent
							}),
							/* @__PURE__ */ jsx(CheckboxField, {
								label: /* @__PURE__ */ jsxs(Fragment, { children: [
									t("marketing.forms.consent.privacyConsentPrefix"),
									" ",
									/* @__PURE__ */ jsx("a", {
										href: `/${locale}/privacy`,
										className: "font-medium text-navy-700 underline",
										children: t("nav.public.privacy")
									}),
									"."
								] }),
								checked: form.data.privacy_consent,
								onChange: (e) => form.setData("privacy_consent", e.target.checked),
								error: form.errors.privacy_consent
							}),
							/* @__PURE__ */ jsx(CheckboxField, {
								label: /* @__PURE__ */ jsxs(Fragment, { children: [
									t("marketing.forms.consent.termsConsentPrefix"),
									" ",
									/* @__PURE__ */ jsx("a", {
										href: `/${locale}/terms`,
										className: "font-medium text-navy-700 underline",
										children: t("nav.public.terms")
									}),
									"."
								] }),
								checked: form.data.terms_consent,
								onChange: (e) => form.setData("terms_consent", e.target.checked),
								error: form.errors.terms_consent
							})
						]
					}),
					/* @__PURE__ */ jsx("button", {
						type: "submit",
						disabled: form.processing,
						className: "self-start rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
						children: form.processing ? t("marketing.forms.buttons.sending") : t("marketing.forms.buttons.submitCarrierSignup")
					})
				]
			}), /* @__PURE__ */ jsxs("aside", {
				className: "h-fit rounded border border-steel-200 bg-navy-50 p-6",
				children: [
					/* @__PURE__ */ jsx("h2", {
						className: "font-display text-lg font-bold text-navy-700",
						children: t("marketing.carrierSignup.whatHappensNext.title")
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-3 text-sm text-steel-700",
						children: t("marketing.carrierSignup.whatHappensNext.intro")
					}),
					/* @__PURE__ */ jsx("ul", {
						className: "mt-4 flex flex-col gap-3",
						children: NEXT_STEPS.map((step) => /* @__PURE__ */ jsxs("li", {
							className: "flex gap-3 text-sm text-steel-700",
							children: [/* @__PURE__ */ jsx("span", {
								"aria-hidden": "true",
								className: "mt-2 size-1.5 shrink-0 rounded-full bg-safety-600"
							}), /* @__PURE__ */ jsx("span", { children: t(`marketing.carrierSignup.whatHappensNext.${step}`) })]
						}, step))
					})
				]
			})]
		}) })]
	});
}
//#endregion
export { CarrierSignup as default };
