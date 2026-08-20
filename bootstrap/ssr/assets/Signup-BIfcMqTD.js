import { t as useI18n } from "../ssr.js";
import { r as TextField, t as CheckboxField } from "./Field-BQKN739Z.js";
import { t as AntiSpamFields } from "./AntiSpamFields-CH5apMH2.js";
import { Head, Link, useForm } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/lib/format.ts
var LOCALE_TAGS = {
	en: "en-US",
	es: "es-US"
};
/**
* Formatea céntimos enteros como moneda.
*
* El servidor manda céntimos y el formateo ocurre aquí, con Intl y el idioma ya
* resuelto. Mandar «$99.00» desde PHP obligaría al servidor a decidir el formato
* de un idioma que no debería estar formateando, y a repetir esa decisión en
* cada endpoint que devuelva dinero.
*
* Nunca se divide entre 100 para «convertir a dólares» y luego se redondea: se
* pasan los céntimos a Intl y él coloca la coma. Un `cents / 100` en coma
* flotante es exactamente donde aparecen los céntimos perdidos.
*/
function formatCents(cents, locale, currency = "USD") {
	return new Intl.NumberFormat(LOCALE_TAGS[locale], {
		style: "currency",
		currency,
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2
	}).format(cents / 100);
}
//#endregion
//#region resources/js/pages/Auth/Signup.tsx
function Signup({ plans, formToken, legalLinks }) {
	const { t, locale } = useI18n();
	const form = useForm({
		company_name: "",
		plan_code: plans[0]?.code ?? "",
		first_name: "",
		last_name: "",
		email: "",
		password: "",
		password_confirmation: "",
		locale,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		privacy_consent: false,
		terms_consent: false,
		hp_field: "",
		form_token: formToken
	});
	const set = (key) => (event) => form.setData(key, event.target.value);
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Head, { title: t("auth.signup.title") }), /* @__PURE__ */ jsx("div", {
		className: "min-h-dvh bg-navy-50",
		children: /* @__PURE__ */ jsxs("div", {
			className: "mx-auto max-w-3xl px-4 py-12 sm:px-6",
			children: [
				/* @__PURE__ */ jsx(Link, {
					href: `/${locale}`,
					className: "inline-block",
					children: /* @__PURE__ */ jsx("img", {
						src: "/brand/logo-primary.png",
						srcSet: "/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x",
						alt: "Goliath Dispatch",
						width: 168,
						height: 40,
						className: "h-9 w-auto"
					})
				}),
				/* @__PURE__ */ jsx("h1", {
					className: "mt-8 font-display text-3xl font-bold tracking-tight text-navy-700",
					children: t("auth.signup.title")
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-2 text-steel-700",
					children: t("auth.signup.subtitle")
				}),
				/* @__PURE__ */ jsxs("form", {
					noValidate: true,
					onSubmit: (event) => {
						event.preventDefault();
						form.post("/signup");
					},
					className: "relative mt-10 flex flex-col gap-10",
					children: [
						/* @__PURE__ */ jsx(AntiSpamFields, { token: formToken }),
						/* @__PURE__ */ jsxs("section", {
							className: "rounded border border-steel-200 bg-white p-6",
							children: [
								/* @__PURE__ */ jsx("h2", {
									className: "font-display text-lg font-bold text-navy-700",
									children: t("auth.signup.companyStep.title")
								}),
								/* @__PURE__ */ jsx("p", {
									className: "mt-1 text-sm text-steel-600",
									children: t("auth.signup.companyStep.subtitle")
								}),
								/* @__PURE__ */ jsx("div", {
									className: "mt-5",
									children: /* @__PURE__ */ jsx(TextField, {
										label: t("auth.signup.companyName"),
										required: true,
										autoComplete: "organization",
										value: form.data.company_name,
										onChange: set("company_name"),
										error: form.errors.company_name
									})
								})
							]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "rounded border border-steel-200 bg-white p-6",
							children: [
								/* @__PURE__ */ jsx("h2", {
									className: "font-display text-lg font-bold text-navy-700",
									children: t("auth.signup.planStep.title")
								}),
								/* @__PURE__ */ jsx("p", {
									className: "mt-1 text-sm text-steel-600",
									children: t("auth.signup.planStep.subtitle")
								}),
								/* @__PURE__ */ jsxs("fieldset", {
									className: "mt-5 grid gap-4 sm:grid-cols-3",
									children: [/* @__PURE__ */ jsx("legend", {
										className: "sr-only",
										children: t("auth.signup.plan")
									}), plans.map((plan) => {
										const selected = form.data.plan_code === plan.code;
										return /* @__PURE__ */ jsxs("label", {
											className: `flex cursor-pointer flex-col rounded border-2 p-4 transition ${selected ? "border-safety-600 bg-safety-50" : "border-steel-200 hover:border-steel-300"}`,
											children: [
												/* @__PURE__ */ jsx("input", {
													type: "radio",
													name: "plan_code",
													value: plan.code,
													checked: selected,
													onChange: () => form.setData("plan_code", plan.code),
													className: "sr-only"
												}),
												/* @__PURE__ */ jsx("span", {
													className: "uppercase-heading text-sm text-navy-700",
													children: plan.name
												}),
												/* @__PURE__ */ jsx("span", {
													className: "mt-2 font-display text-2xl font-bold text-navy-700",
													children: t("auth.signup.planStep.perMonth", { price: formatCents(plan.monthlyPriceCents, locale) })
												}),
												plan.description ? /* @__PURE__ */ jsx("span", {
													className: "mt-2 text-xs text-steel-700",
													children: plan.description
												}) : null,
												/* @__PURE__ */ jsx("span", {
													className: "mt-3 text-xs font-medium text-safety-700",
													children: t("auth.signup.planStep.trialNotice", { days: plan.trialDays })
												})
											]
										}, plan.code);
									})]
								}),
								form.errors.plan_code ? /* @__PURE__ */ jsx("p", {
									role: "alert",
									className: "mt-3 text-xs font-medium text-safety-700",
									children: form.errors.plan_code
								}) : null
							]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "rounded border border-steel-200 bg-white p-6",
							children: [
								/* @__PURE__ */ jsx("h2", {
									className: "font-display text-lg font-bold text-navy-700",
									children: t("auth.signup.admin.title")
								}),
								/* @__PURE__ */ jsx("p", {
									className: "mt-1 text-sm text-steel-600",
									children: t("auth.signup.admin.subtitle")
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "mt-5 flex flex-col gap-5",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "grid gap-5 sm:grid-cols-2",
											children: [/* @__PURE__ */ jsx(TextField, {
												label: t("auth.signup.admin.firstName"),
												required: true,
												autoComplete: "given-name",
												value: form.data.first_name,
												onChange: set("first_name"),
												error: form.errors.first_name
											}), /* @__PURE__ */ jsx(TextField, {
												label: t("auth.signup.admin.lastName"),
												required: true,
												autoComplete: "family-name",
												value: form.data.last_name,
												onChange: set("last_name"),
												error: form.errors.last_name
											})]
										}),
										/* @__PURE__ */ jsx(TextField, {
											label: t("auth.signup.admin.email"),
											type: "email",
											required: true,
											autoComplete: "email",
											value: form.data.email,
											onChange: set("email"),
											error: form.errors.email
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "grid gap-5 sm:grid-cols-2",
											children: [/* @__PURE__ */ jsx(TextField, {
												label: t("auth.signup.admin.password"),
												type: "password",
												required: true,
												autoComplete: "new-password",
												value: form.data.password,
												onChange: set("password"),
												error: form.errors.password
											}), /* @__PURE__ */ jsx(TextField, {
												label: t("auth.signup.admin.confirmPassword"),
												type: "password",
												required: true,
												autoComplete: "new-password",
												value: form.data.password_confirmation,
												onChange: set("password_confirmation"),
												error: form.errors.password_confirmation
											})]
										})
									]
								})
							]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "rounded border border-steel-200 bg-white p-6",
							children: [
								/* @__PURE__ */ jsx("h2", {
									className: "font-display text-lg font-bold text-navy-700",
									children: t("auth.signup.consentsStep.title")
								}),
								/* @__PURE__ */ jsx("p", {
									className: "mt-1 text-sm text-steel-600",
									children: t("auth.signup.consentsStep.subtitle")
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "mt-5 flex flex-col gap-4",
									children: [/* @__PURE__ */ jsx(CheckboxField, {
										label: /* @__PURE__ */ jsxs(Fragment, { children: [
											t("marketing.forms.consent.privacyConsentPrefix"),
											" ",
											/* @__PURE__ */ jsx("a", {
												href: legalLinks.privacy,
												className: "font-medium text-navy-700 underline",
												children: t("nav.public.privacy")
											}),
											"."
										] }),
										checked: form.data.privacy_consent,
										onChange: (e) => form.setData("privacy_consent", e.target.checked),
										error: form.errors.privacy_consent
									}), /* @__PURE__ */ jsx(CheckboxField, {
										label: /* @__PURE__ */ jsxs(Fragment, { children: [
											t("marketing.forms.consent.termsConsentPrefix"),
											" ",
											/* @__PURE__ */ jsx("a", {
												href: legalLinks.terms,
												className: "font-medium text-navy-700 underline",
												children: t("nav.public.terms")
											}),
											"."
										] }),
										checked: form.data.terms_consent,
										onChange: (e) => form.setData("terms_consent", e.target.checked),
										error: form.errors.terms_consent
									})]
								})
							]
						}),
						/* @__PURE__ */ jsx("button", {
							type: "submit",
							disabled: form.processing,
							className: "self-start rounded bg-safety-600 px-8 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
							children: form.processing ? t("auth.signup.provisioning") : t("auth.signup.submit")
						})
					]
				})
			]
		})
	})] });
}
//#endregion
export { Signup as default };
