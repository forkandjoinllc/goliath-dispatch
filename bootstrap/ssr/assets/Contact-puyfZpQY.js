import { t as useI18n } from "../ssr.js";
import { i as AntiSpamFields, n as TextArea, r as TextField, t as CheckboxField } from "./Field-BlFpQuPk.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { t as PageHero } from "./PageHero-wWMgwMlM.js";
import { t as Section } from "./Section-DsJrJ0AG.js";
import { useForm } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/LeadForm.tsx
function LeadForm({ token, locale }) {
	const { t } = useI18n();
	const form = useForm({
		first_name: "",
		last_name: "",
		email: "",
		phone: "",
		company_name: "",
		message: "",
		lead_consent: false,
		hp_field: "",
		form_token: token
	});
	const label = (key) => t(`marketing.forms.labels.${key}`);
	if (form.wasSuccessful) return /* @__PURE__ */ jsxs("div", {
		role: "status",
		className: "rounded border-l-4 border-safety-500 bg-navy-50 p-6",
		children: [/* @__PURE__ */ jsx("h3", {
			className: "font-display text-lg font-bold text-navy-700",
			children: t("marketing.forms.success.leadTitle")
		}), /* @__PURE__ */ jsx("p", {
			className: "mt-2 text-steel-700",
			children: t("marketing.forms.success.leadBody")
		})]
	});
	return /* @__PURE__ */ jsxs("form", {
		noValidate: true,
		onSubmit: (event) => {
			event.preventDefault();
			form.post("/leads", { preserveScroll: true });
		},
		className: "relative flex flex-col gap-5",
		children: [
			/* @__PURE__ */ jsx(AntiSpamFields, { token }),
			/* @__PURE__ */ jsxs("div", {
				className: "grid gap-5 sm:grid-cols-2",
				children: [/* @__PURE__ */ jsx(TextField, {
					label: label("firstName"),
					required: true,
					autoComplete: "given-name",
					value: form.data.first_name,
					onChange: (e) => form.setData("first_name", e.target.value),
					error: form.errors.first_name
				}), /* @__PURE__ */ jsx(TextField, {
					label: label("lastName"),
					required: true,
					autoComplete: "family-name",
					value: form.data.last_name,
					onChange: (e) => form.setData("last_name", e.target.value),
					error: form.errors.last_name
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
					onChange: (e) => form.setData("email", e.target.value),
					error: form.errors.email
				}), /* @__PURE__ */ jsx(TextField, {
					label: label("phone"),
					type: "tel",
					autoComplete: "tel",
					value: form.data.phone,
					onChange: (e) => form.setData("phone", e.target.value),
					error: form.errors.phone
				})]
			}),
			/* @__PURE__ */ jsx(TextField, {
				label: label("companyName"),
				autoComplete: "organization",
				value: form.data.company_name,
				onChange: (e) => form.setData("company_name", e.target.value),
				error: form.errors.company_name
			}),
			/* @__PURE__ */ jsx(TextArea, {
				label: label("message"),
				value: form.data.message,
				onChange: (e) => form.setData("message", e.target.value),
				error: form.errors.message
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
					". ",
					t("marketing.forms.consent.leadConsent")
				] }),
				checked: form.data.lead_consent,
				onChange: (e) => form.setData("lead_consent", e.target.checked),
				error: form.errors.lead_consent
			}),
			/* @__PURE__ */ jsx("button", {
				type: "submit",
				disabled: form.processing,
				className: "self-start rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
				children: form.processing ? t("marketing.forms.buttons.sending") : t("marketing.forms.buttons.submitLead")
			})
		]
	});
}
//#endregion
//#region resources/js/pages/Marketing/Contact.tsx
function Contact({ formToken, ...props }) {
	const { t, locale } = useI18n();
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [/* @__PURE__ */ jsx(PageHero, {
			title: t("marketing.contact.hero.title"),
			subtitle: t("marketing.contact.hero.subtitle")
		}), /* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsxs("div", {
			className: "grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]",
			children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
				className: "font-display text-2xl font-bold text-navy-700",
				children: t("marketing.contact.formHeading")
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-8",
				children: /* @__PURE__ */ jsx(LeadForm, {
					token: formToken,
					locale
				})
			})] }), /* @__PURE__ */ jsxs("aside", {
				className: "flex flex-col gap-8",
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
					className: "uppercase-heading text-xs text-steel-600",
					children: t("marketing.contact.hoursHeading")
				}), /* @__PURE__ */ jsx("p", {
					className: "mt-3 text-sm text-steel-700",
					children: t("marketing.contact.mapPlaceholderLabel")
				})] }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
					className: "uppercase-heading text-xs text-steel-600",
					children: t("marketing.contact.addressHeading")
				}), /* @__PURE__ */ jsx("div", {
					className: "mt-3 flex h-40 items-center justify-center rounded border border-dashed border-steel-300 text-center text-xs text-steel-600",
					role: "img",
					"aria-label": t("marketing.contact.mapPlaceholderAlt"),
					children: t("marketing.contact.mapPlaceholderLabel")
				})] })]
			})]
		}) })]
	});
}
//#endregion
export { Contact as default };
