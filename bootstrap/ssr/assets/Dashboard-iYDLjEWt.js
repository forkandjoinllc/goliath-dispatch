import { t as useI18n } from "../ssr.js";
import { Head, Link, router, usePage } from "@inertiajs/react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/App/Dashboard.tsx
/** Cada ámbito con su color. El naranja de marca marca lo más ancho. */
var SCOPE_STYLE = {
	platform: "bg-safety-100 text-safety-800",
	tenant: "bg-navy-100 text-navy-800",
	assigned: "bg-steel-100 text-steel-800",
	carrier: "bg-steel-100 text-steel-800",
	own: "bg-steel-100 text-steel-700"
};
function Dashboard({ actor, tenant, memberships, permissions, totals }) {
	const { t, locale } = useI18n();
	const { props } = usePage();
	const resources = Object.keys(permissions);
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Head, { title: actor.role ?? "Goliath Dispatch" }), /* @__PURE__ */ jsxs("div", {
		className: "min-h-dvh bg-navy-50",
		children: [/* @__PURE__ */ jsx("header", {
			className: "border-b border-steel-200 bg-white",
			children: /* @__PURE__ */ jsxs("div", {
				className: "mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6",
				children: [/* @__PURE__ */ jsx(Link, {
					href: `/${locale}`,
					children: /* @__PURE__ */ jsx("img", {
						src: "/brand/logo-primary.png",
						srcSet: "/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x",
						alt: "Goliath Dispatch",
						width: 168,
						height: 40,
						className: "h-8 w-auto"
					})
				}), /* @__PURE__ */ jsxs("div", {
					className: "ml-auto flex items-center gap-4",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "text-right",
						children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-medium text-carbon",
							children: actor.name
						}), /* @__PURE__ */ jsx("p", {
							className: "text-xs text-steel-600",
							children: actor.email
						})]
					}), /* @__PURE__ */ jsx(Link, {
						href: "/logout",
						method: "post",
						as: "button",
						className: "rounded border border-steel-300 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50",
						children: t("common.actions.signOut")
					})]
				})]
			})
		}), /* @__PURE__ */ jsxs("main", {
			className: "mx-auto max-w-6xl px-4 py-10 sm:px-6",
			children: [
				/* @__PURE__ */ jsxs("section", {
					className: "rounded border border-steel-200 bg-white p-6",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap items-start justify-between gap-4",
						children: [/* @__PURE__ */ jsxs("div", { children: [
							/* @__PURE__ */ jsx("p", {
								className: "uppercase-heading text-xs text-steel-600",
								children: tenant ? tenant.display_name : "Goliath Dispatch"
							}),
							/* @__PURE__ */ jsx("h1", {
								className: "mt-2 font-display text-3xl font-bold text-navy-700",
								children: actor.role ? actor.role.replace(/_/g, " ") : actor.isPlatformSuperAdmin ? "platform super admin" : "—"
							}),
							tenant ? /* @__PURE__ */ jsxs("p", {
								className: "mt-1 text-sm text-steel-700",
								children: [
									/* @__PURE__ */ jsx("code", {
										className: "rounded bg-navy-50 px-1.5 py-0.5 text-xs",
										children: tenant.slug
									}),
									" ",
									"· ",
									tenant.status
								]
							}) : /* @__PURE__ */ jsx("p", {
								className: "mt-1 text-sm text-steel-700",
								children: actor.isPlatformSuperAdmin ? "Ámbito de plataforma — sin empresa activa" : "Sin empresa activa"
							})
						] }), /* @__PURE__ */ jsxs("dl", {
							className: "flex gap-6 text-right",
							children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("dt", {
								className: "text-xs text-steel-600",
								children: "permisos"
							}), /* @__PURE__ */ jsx("dd", {
								className: "font-display text-2xl font-bold text-navy-700",
								children: totals.granted
							})] }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("dt", {
								className: "text-xs text-steel-600",
								children: "catálogo"
							}), /* @__PURE__ */ jsx("dd", {
								className: "font-display text-2xl font-bold text-steel-500",
								children: totals.catalog
							})] })]
						})]
					}), actor.mfaRequired && !actor.mfaSatisfied ? /* @__PURE__ */ jsx("p", {
						role: "alert",
						className: "mt-4 rounded border-l-4 border-safety-500 bg-safety-50 p-3 text-sm",
						children: t("auth.mfa.required")
					}) : null]
				}),
				memberships.length > 1 ? /* @__PURE__ */ jsxs("section", {
					className: "mt-6 rounded border border-steel-200 bg-white p-6",
					children: [/* @__PURE__ */ jsxs("h2", {
						className: "uppercase-heading text-xs text-steel-600",
						children: [memberships.length, " empresas"]
					}), /* @__PURE__ */ jsx("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: memberships.map((m) => /* @__PURE__ */ jsxs("button", {
							type: "button",
							onClick: () => router.post("/switch-tenant", { tenant_id: m.id }),
							className: `rounded border px-3 py-2 text-sm transition ${m.id === actor.tenantId ? "border-safety-600 bg-safety-50 font-medium text-navy-800" : "border-steel-300 hover:bg-navy-50"}`,
							children: [
								m.name,
								" ",
								/* @__PURE__ */ jsxs("span", {
									className: "text-xs text-steel-600",
									children: [
										"(",
										m.role.replace(/_/g, " "),
										")"
									]
								})
							]
						}, m.id))
					})]
				}) : null,
				/* @__PURE__ */ jsxs("section", {
					className: "mt-6",
					children: [/* @__PURE__ */ jsx("h2", {
						className: "font-display text-xl font-bold text-navy-700",
						children: locale === "es" ? "Lo que puede hacer este rol" : "What this role can do"
					}), resources.length === 0 ? /* @__PURE__ */ jsxs("p", {
						className: "mt-4 rounded border border-dashed border-steel-300 bg-white p-6 text-sm text-steel-700",
						children: [
							t("common.states.permissionDenied"),
							" — ",
							t("common.states.permissionDeniedHint")
						]
					}) : /* @__PURE__ */ jsx("div", {
						className: "mt-4 grid gap-4 md:grid-cols-2",
						children: resources.map((resource) => /* @__PURE__ */ jsxs("div", {
							className: "rounded border border-steel-200 bg-white p-5",
							children: [/* @__PURE__ */ jsx("h3", {
								className: "uppercase-heading text-xs text-safety-600",
								children: resource
							}), /* @__PURE__ */ jsx("ul", {
								className: "mt-3 flex flex-col gap-2",
								children: permissions[resource].map((p) => /* @__PURE__ */ jsxs("li", {
									className: "flex items-start gap-2 text-sm",
									children: [/* @__PURE__ */ jsx("span", {
										className: `mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SCOPE_STYLE[p.scope ?? "own"] ?? "bg-steel-100 text-steel-700"}`,
										children: p.scope
									}), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("span", {
										className: "font-medium text-carbon",
										children: p.action
									}), /* @__PURE__ */ jsx("span", {
										className: "block text-xs text-steel-600",
										children: p.description
									})] })]
								}, p.key))
							})]
						}, resource))
					})]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-8 text-xs text-steel-600",
					children: props.flash.success ?? ""
				})
			]
		})]
	})] });
}
//#endregion
export { Dashboard as default };
