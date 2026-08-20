import { t as useI18n } from "../ssr.js";
import { Head, Link } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Auth/SignupDone.tsx
function SignupDone({ email }) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Head, { title: t("auth.signup.successPage.title") }), /* @__PURE__ */ jsx("div", {
		className: "flex min-h-dvh items-center justify-center bg-navy-50 px-4",
		children: /* @__PURE__ */ jsxs("div", {
			className: "w-full max-w-lg rounded border-l-4 border-safety-500 bg-white p-8",
			children: [
				/* @__PURE__ */ jsx("img", {
					src: "/brand/logo-primary.png",
					alt: "Goliath Dispatch",
					width: 168,
					height: 40,
					className: "h-9 w-auto"
				}),
				/* @__PURE__ */ jsx("h1", {
					className: "mt-8 font-display text-2xl font-bold text-navy-700",
					children: t("auth.signup.successPage.title")
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-3 text-steel-700",
					children: t("auth.signup.successPage.body", { email: email ?? "" })
				}),
				/* @__PURE__ */ jsx(Link, {
					href: "/login",
					className: "mt-8 inline-flex rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700",
					children: t("auth.signup.successPage.cta")
				})
			]
		})
	})] });
}
//#endregion
export { SignupDone as default };
