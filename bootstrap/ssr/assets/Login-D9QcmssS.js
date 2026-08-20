import { t as useI18n } from "../ssr.js";
import { t as AuthLayout } from "./AuthLayout-CRJBRmNb.js";
import { r as TextField, t as CheckboxField } from "./Field-BQKN739Z.js";
import { Link, useForm } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Auth/Login.tsx
function Login({ status }) {
	const { t, locale } = useI18n();
	const form = useForm({
		email: "",
		password: "",
		remember: false
	});
	return /* @__PURE__ */ jsxs(AuthLayout, {
		title: t("auth.login.title"),
		subtitle: t("auth.login.subtitle"),
		footer: /* @__PURE__ */ jsxs(Fragment, { children: [
			t("auth.login.noAccount"),
			" ",
			/* @__PURE__ */ jsx(Link, {
				href: "/signup",
				className: "font-medium text-navy-700 underline",
				children: t("auth.login.signupLink")
			})
		] }),
		children: [
			status ? /* @__PURE__ */ jsx("div", {
				role: "status",
				className: "mb-6 rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon",
				children: status
			}) : null,
			/* @__PURE__ */ jsxs("form", {
				noValidate: true,
				onSubmit: (event) => {
					event.preventDefault();
					form.post("/login", { onFinish: () => form.reset("password") });
				},
				className: "flex flex-col gap-5",
				children: [
					/* @__PURE__ */ jsx(TextField, {
						label: t("auth.login.email"),
						type: "email",
						required: true,
						autoComplete: "username",
						autoFocus: true,
						value: form.data.email,
						onChange: (e) => form.setData("email", e.target.value),
						error: form.errors.email
					}),
					/* @__PURE__ */ jsx(TextField, {
						label: t("auth.login.password"),
						type: "password",
						required: true,
						autoComplete: "current-password",
						value: form.data.password,
						onChange: (e) => form.setData("password", e.target.value),
						error: form.errors.password
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-between",
						children: [/* @__PURE__ */ jsx(CheckboxField, {
							label: t("auth.login.remember"),
							checked: form.data.remember,
							onChange: (e) => form.setData("remember", e.target.checked)
						}), /* @__PURE__ */ jsx(Link, {
							href: "/forgot-password",
							className: "text-sm font-medium text-navy-700 underline",
							children: t("auth.login.forgot")
						})]
					}),
					/* @__PURE__ */ jsx("button", {
						type: "submit",
						disabled: form.processing,
						className: "rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
						children: form.processing ? t("common.states.loading") : t("auth.login.submit")
					})
				]
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-6 text-center text-xs text-steel-600",
				children: [
					/* @__PURE__ */ jsx(Link, {
						href: `/${locale}/privacy`,
						className: "underline",
						children: t("nav.public.privacy")
					}),
					" · ",
					/* @__PURE__ */ jsx(Link, {
						href: `/${locale}/terms`,
						className: "underline",
						children: t("nav.public.terms")
					})
				]
			})
		]
	});
}
//#endregion
export { Login as default };
