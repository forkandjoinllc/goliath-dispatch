import { t as useI18n } from "../ssr.js";
import { t as MarketingLayout } from "./MarketingLayout-i8h6UMJI.js";
import { n as SectionHeading, t as Section } from "./Section-DsJrJ0AG.js";
import { n as CtaBand, t as Cta } from "./Cta-kux4IRC9.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/pages/Marketing/Home.tsx
var PROOF_POINTS = [
	"item1",
	"item2",
	"item3",
	"item4"
];
var STEPS = [
	"step1",
	"step2",
	"step3",
	"step4",
	"step5"
];
var AUDIENCES = [
	{
		key: "dispatchCompanies",
		route: "services"
	},
	{
		key: "carriers",
		route: "carrier-signup"
	},
	{
		key: "clients",
		route: "for-clients"
	}
];
function Home(props) {
	const { t, locale } = useI18n();
	const path = (route) => `/${locale}/${route}`;
	return /* @__PURE__ */ jsxs(MarketingLayout, {
		...props,
		children: [
			/* @__PURE__ */ jsxs("section", {
				className: "relative overflow-hidden bg-navy-700",
				children: [/* @__PURE__ */ jsx("div", {
					className: "hazard-stripe absolute inset-x-0 top-0 h-1.5",
					"aria-hidden": "true"
				}), /* @__PURE__ */ jsx("div", {
					className: "mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28",
					children: /* @__PURE__ */ jsxs("div", {
						className: "max-w-3xl",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "uppercase-heading text-xs text-safety-500",
								children: t("marketing.home.hero.eyebrow")
							}),
							/* @__PURE__ */ jsx("h1", {
								className: "mt-4 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl",
								children: t("marketing.home.hero.title")
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-6 max-w-2xl text-lg text-steel-100",
								children: t("marketing.home.hero.subtitle")
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "mt-10 flex flex-wrap gap-3",
								children: [/* @__PURE__ */ jsx(Cta, {
									href: "/signup",
									children: t("marketing.home.hero.primaryCta")
								}), /* @__PURE__ */ jsx(Cta, {
									href: path("services"),
									variant: "ghost",
									children: t("marketing.home.hero.secondaryCta")
								})]
							})
						]
					})
				})]
			}),
			/* @__PURE__ */ jsxs(Section, { children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.home.proofPoints.heading") }), /* @__PURE__ */ jsx("div", {
				className: "mt-12 grid gap-8 sm:grid-cols-2",
				children: PROOF_POINTS.map((item) => /* @__PURE__ */ jsxs("div", {
					className: "border-l-2 border-safety-500 pl-6",
					children: [/* @__PURE__ */ jsx("h3", {
						className: "font-display text-xl font-bold text-navy-700",
						children: t(`marketing.home.proofPoints.${item}.title`)
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-3 text-steel-700",
						children: t(`marketing.home.proofPoints.${item}.body`)
					})]
				}, item))
			})] }),
			/* @__PURE__ */ jsx(Section, {
				tone: "tint",
				children: /* @__PURE__ */ jsxs("div", {
					className: "lg:flex lg:items-center lg:gap-12",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "lg:flex-1",
						children: [
							/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.home.oversizeBand.title") }),
							/* @__PURE__ */ jsx("p", {
								className: "mt-4 text-lg text-steel-700",
								children: t("marketing.home.oversizeBand.body")
							}),
							/* @__PURE__ */ jsx(Cta, {
								href: path("heavy-haul"),
								variant: "secondary",
								className: "mt-8",
								children: t("marketing.home.oversizeBand.cta")
							})
						]
					}), /* @__PURE__ */ jsx("div", {
						className: "mt-10 lg:mt-0 lg:w-80 lg:shrink-0",
						children: /* @__PURE__ */ jsx("div", {
							className: "hazard-stripe h-40 rounded",
							role: "img",
							"aria-label": t("marketing.home.hero.illustrationAlt")
						})
					})]
				})
			}),
			/* @__PURE__ */ jsxs(Section, { children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.home.howItWorks.heading") }), /* @__PURE__ */ jsx("ol", {
				className: "mt-12 grid gap-8 md:grid-cols-3 lg:grid-cols-5",
				children: STEPS.map((step, index) => /* @__PURE__ */ jsxs("li", { children: [
					/* @__PURE__ */ jsx("span", {
						className: "uppercase-heading flex size-9 items-center justify-center rounded-full bg-navy-700 text-sm text-white",
						children: index + 1
					}),
					/* @__PURE__ */ jsx("h3", {
						className: "mt-4 font-display text-lg font-bold text-navy-700",
						children: t(`marketing.home.howItWorks.${step}.title`)
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-2 text-sm text-steel-700",
						children: t(`marketing.home.howItWorks.${step}.body`)
					})
				] }, step))
			})] }),
			/* @__PURE__ */ jsxs(Section, {
				tone: "tint",
				children: [/* @__PURE__ */ jsx(SectionHeading, { title: t("marketing.home.audiences.heading") }), /* @__PURE__ */ jsx("div", {
					className: "mt-12 grid gap-6 lg:grid-cols-3",
					children: AUDIENCES.map(({ key, route }) => /* @__PURE__ */ jsxs("div", {
						className: "flex flex-col rounded border border-steel-200 bg-white p-6",
						children: [
							/* @__PURE__ */ jsx("h3", {
								className: "font-display text-xl font-bold text-navy-700",
								children: t(`marketing.home.audiences.${key}.title`)
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-3 grow text-steel-700",
								children: t(`marketing.home.audiences.${key}.body`)
							}),
							/* @__PURE__ */ jsx(Cta, {
								href: path(route),
								variant: "ghost",
								className: "mt-6 self-start",
								children: t(`marketing.home.audiences.${key}.cta`)
							})
						]
					}, key))
				})]
			}),
			/* @__PURE__ */ jsx(CtaBand, {
				title: t("marketing.home.closingCta.title"),
				body: t("marketing.home.closingCta.body"),
				primaryHref: path("contact"),
				primaryLabel: t("marketing.home.closingCta.primaryCta"),
				secondaryHref: "/signup",
				secondaryLabel: t("marketing.home.closingCta.secondaryCta")
			})
		]
	});
}
//#endregion
export { Home as default };
