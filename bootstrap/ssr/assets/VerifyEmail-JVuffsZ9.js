import { t as useI18n } from "../ssr.js";
import { t as AuthLayout } from "./AuthLayout-CRJBRmNb.js";
import { Link, useForm } from "@inertiajs/react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Auth/VerifyEmail.tsx
function VerifyEmail({ status, email }) {
	const { t } = useI18n();
	const form = useForm({});
	return /* @__PURE__ */ jsxs(AuthLayout, {
		title: t("auth.verify.title"),
		subtitle: t("auth.verify.sent", { email: email ?? "" }),
		footer: /* @__PURE__ */ jsx(Link, {
			href: "/logout",
			method: "post",
			as: "button",
			className: "font-medium text-navy-700 underline",
			children: t("common.actions.signOut")
		}),
		children: [status === "verification-link-sent" ? /* @__PURE__ */ jsx("div", {
			role: "status",
			className: "mb-6 rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon",
			children: t("auth.verify.sent", { email: email ?? "" })
		}) : null, /* @__PURE__ */ jsx("button", {
			type: "button",
			disabled: form.processing,
			onClick: () => form.post("/email/verification-notification"),
			className: "rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60",
			children: form.processing ? t("common.states.loading") : t("auth.verify.resend")
		})]
	});
}
//#endregion
export { VerifyEmail as default };
