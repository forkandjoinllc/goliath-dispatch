import { t as useI18n } from "../ssr.js";
import { t as AuthLayout } from "./AuthLayout-CRJBRmNb.js";
import { r as TextField } from "./Field-BQKN739Z.js";
import { useForm } from "@inertiajs/react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Auth/ResetPassword.tsx
function ResetPassword({ token, email }) {
	const { t } = useI18n();
	const form = useForm({
		token,
		email,
		password: "",
		password_confirmation: ""
	});
	return /* @__PURE__ */ jsx(AuthLayout, {
		title: t("auth.reset.title"),
		children: /* @__PURE__ */ jsxs("form", {
			noValidate: true,
			onSubmit: (event) => {
				event.preventDefault();
				form.post("/reset-password", { onFinish: () => form.reset("password", "password_confirmation") });
			},
			className: "flex flex-col gap-5",
			children: [
				/* @__PURE__ */ jsx(TextField, {
					label: t("auth.login.email"),
					type: "email",
					required: true,
					autoComplete: "username",
					value: form.data.email,
					onChange: (e) => form.setData("email", e.target.value),
					error: form.errors.email
				}),
				/* @__PURE__ */ jsx(TextField, {
					label: t("auth.reset.password"),
					type: "password",
					required: true,
					autoComplete: "new-password",
					autoFocus: true,
					value: form.data.password,
					onChange: (e) => form.setData("password", e.target.value),
					error: form.errors.password
				}),
				/* @__PURE__ */ jsx(TextField, {
					label: t("auth.reset.confirm"),
					type: "password",
					required: true,
					autoComplete: "new-password",
					value: form.data.password_confirmation,
					onChange: (e) => form.setData("password_confirmation", e.target.value),
					error: form.errors.password_confirmation
				}),
				/* @__PURE__ */ jsx("button", {
					type: "submit",
					disabled: form.processing,
					className: "rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
					children: form.processing ? t("common.states.loading") : t("auth.reset.submit")
				})
			]
		})
	});
}
//#endregion
export { ResetPassword as default };
