import { t as useI18n } from "../ssr.js";
import { t as AuthLayout } from "./AuthLayout-CRJBRmNb.js";
import { r as TextField } from "./Field-BQKN739Z.js";
import { Link, useForm } from "@inertiajs/react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Auth/ForgotPassword.tsx
function ForgotPassword({ status }) {
	const { t } = useI18n();
	const form = useForm({ email: "" });
	return /* @__PURE__ */ jsx(AuthLayout, {
		title: t("auth.forgot.title"),
		subtitle: t("auth.forgot.subtitle"),
		footer: /* @__PURE__ */ jsx(Link, {
			href: "/login",
			className: "font-medium text-navy-700 underline",
			children: t("auth.login.title")
		}),
		children: status || form.wasSuccessful ? /* @__PURE__ */ jsx("div", {
			role: "status",
			className: "rounded border-l-4 border-safety-500 bg-navy-50 p-4 text-sm text-carbon",
			children: status ?? t("auth.forgot.sent")
		}) : /* @__PURE__ */ jsxs("form", {
			noValidate: true,
			onSubmit: (event) => {
				event.preventDefault();
				form.post("/forgot-password");
			},
			className: "flex flex-col gap-5",
			children: [/* @__PURE__ */ jsx(TextField, {
				label: t("auth.login.email"),
				type: "email",
				required: true,
				autoComplete: "username",
				autoFocus: true,
				value: form.data.email,
				onChange: (e) => form.setData("email", e.target.value),
				error: form.errors.email
			}), /* @__PURE__ */ jsx("button", {
				type: "submit",
				disabled: form.processing,
				className: "rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
				children: form.processing ? t("common.states.loading") : t("auth.forgot.submit")
			})]
		})
	});
}
//#endregion
export { ForgotPassword as default };
