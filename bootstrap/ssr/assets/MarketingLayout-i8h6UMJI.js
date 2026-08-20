import { t as useI18n } from "../ssr.js";
import { Head, Link } from "@inertiajs/react";
import { useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region resources/js/components/Marketing/Footer.tsx
function LinkColumn({ heading, links }) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
		className: "uppercase-heading text-xs text-steel-300",
		children: heading
	}), /* @__PURE__ */ jsx("ul", {
		className: "mt-4 flex flex-col gap-2",
		children: links.map((link) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(Link, {
			href: link.href,
			className: "text-sm text-steel-100 transition hover:text-white",
			children: t(link.labelKey)
		}) }, link.route))
	})] });
}
function Footer({ nav, year }) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs("footer", {
		className: "bg-navy-700 text-white",
		children: [/* @__PURE__ */ jsx("div", {
			className: "hazard-stripe-sm h-1",
			"aria-hidden": "true"
		}), /* @__PURE__ */ jsxs("div", {
			className: "mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "grid gap-10 md:grid-cols-2 lg:grid-cols-4",
				children: [
					/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("img", {
						src: "/brand/logo-reversed.png",
						srcSet: "/brand/logo-reversed.png 1x, /brand/logo-reversed@2x.png 2x",
						alt: "Goliath Dispatch",
						width: 168,
						height: 40,
						className: "h-9 w-auto"
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-4 max-w-xs text-sm text-steel-100",
						children: t("marketing.footer.tagline")
					})] }),
					/* @__PURE__ */ jsx(LinkColumn, {
						heading: t("marketing.footer.productHeading"),
						links: nav.footerProduct
					}),
					/* @__PURE__ */ jsx(LinkColumn, {
						heading: t("marketing.footer.companyHeading"),
						links: nav.footerCompany
					}),
					/* @__PURE__ */ jsx(LinkColumn, {
						heading: t("marketing.footer.legalHeading"),
						links: nav.footerLegal
					})
				]
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-10 border-t border-navy-600 pt-6",
				children: /* @__PURE__ */ jsx("p", {
					className: "text-xs text-steel-200",
					children: t("marketing.footer.copyright", { year })
				})
			})]
		})]
	});
}
//#endregion
//#region resources/js/components/Marketing/Header.tsx
/**
* La cabecera del sitio público.
*
* El menú móvil es un `<dialog>`-menos: un panel con `hidden` conmutado, no un
* portal. Un portal aquí obligaría a que el HTML del servidor y el del cliente
* coincidieran exactamente durante la hidratación, y el coste no compra nada:
* son seis enlaces.
*/
function Header({ nav, alternate }) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	return /* @__PURE__ */ jsxs("header", {
		className: "sticky top-0 z-40 border-b border-steel-200 bg-white/95 backdrop-blur",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8",
			children: [
				/* @__PURE__ */ jsx(Link, {
					href: nav.home,
					className: "flex shrink-0 items-center gap-3",
					"aria-label": "Goliath Dispatch",
					children: /* @__PURE__ */ jsx("img", {
						src: "/brand/logo-primary.png",
						srcSet: "/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x",
						alt: "Goliath Dispatch",
						width: 168,
						height: 40,
						className: "h-9 w-auto"
					})
				}),
				/* @__PURE__ */ jsx("nav", {
					className: "hidden flex-1 items-center gap-1 lg:flex",
					"aria-label": t("marketing.header.mobileMenuLabel"),
					children: nav.primary.map((link) => /* @__PURE__ */ jsx(Link, {
						href: link.href,
						className: "rounded px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-navy-50 hover:text-navy-700",
						children: t(link.labelKey)
					}, link.route))
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "ml-auto flex items-center gap-2 lg:ml-0",
					children: [
						/* @__PURE__ */ jsx("a", {
							href: alternate.href,
							lang: alternate.locale,
							hrefLang: alternate.locale,
							className: "hidden rounded px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-navy-50 sm:block",
							children: alternate.label
						}),
						/* @__PURE__ */ jsx(Link, {
							href: "/login",
							className: "hidden rounded px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-navy-50 sm:block",
							children: t("nav.public.login")
						}),
						/* @__PURE__ */ jsx(Link, {
							href: "/signup",
							className: "rounded bg-safety-600 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700",
							children: t("marketing.header.getStartedCta")
						}),
						/* @__PURE__ */ jsxs("button", {
							type: "button",
							onClick: () => setOpen((value) => !value),
							"aria-expanded": open,
							"aria-controls": "mobile-nav",
							className: "rounded p-2 text-navy-800 transition hover:bg-navy-50 lg:hidden",
							children: [/* @__PURE__ */ jsx("span", {
								className: "sr-only",
								children: open ? t("marketing.header.mobileMenuClose") : t("marketing.header.mobileMenuOpen")
							}), /* @__PURE__ */ jsx("svg", {
								viewBox: "0 0 24 24",
								className: "size-6",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: 2,
								"aria-hidden": "true",
								children: open ? /* @__PURE__ */ jsx("path", { d: "M6 6l12 12M18 6L6 18" }) : /* @__PURE__ */ jsx("path", { d: "M4 7h16M4 12h16M4 17h16" })
							})]
						})
					]
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			id: "mobile-nav",
			hidden: !open,
			className: "border-t border-steel-200 bg-white lg:hidden",
			children: /* @__PURE__ */ jsx("nav", {
				className: "mx-auto max-w-7xl px-4 py-3 sm:px-6",
				"aria-label": t("marketing.header.mobileMenuLabel"),
				children: /* @__PURE__ */ jsxs("ul", {
					className: "flex flex-col",
					children: [
						nav.primary.map((link) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(Link, {
							href: link.href,
							onClick: () => setOpen(false),
							className: "block rounded px-3 py-3 text-base font-medium text-navy-800 hover:bg-navy-50",
							children: t(link.labelKey)
						}) }, link.route)),
						/* @__PURE__ */ jsx("li", {
							className: "mt-2 border-t border-steel-200 pt-2",
							children: /* @__PURE__ */ jsx("a", {
								href: alternate.href,
								lang: alternate.locale,
								hrefLang: alternate.locale,
								className: "block rounded px-3 py-3 text-base font-medium text-navy-800 hover:bg-navy-50",
								children: alternate.label
							})
						}),
						/* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(Link, {
							href: "/login",
							className: "block rounded px-3 py-3 text-base font-medium text-navy-800 hover:bg-navy-50",
							children: t("nav.public.login")
						}) })
					]
				})
			})
		})]
	});
}
//#endregion
//#region resources/js/components/Marketing/Seo.tsx
/**
* Las etiquetas de cabecera de una página pública.
*
* Los `hreflang` los calcula el servidor (App\Support\Marketing\Site) y no el
* cliente: son URLs absolutas y el cliente no conoce con fiabilidad el dominio
* canónico detrás de un proxy.
*/
function Seo({ seo }) {
	const { localeTag } = useI18n();
	return /* @__PURE__ */ jsxs(Head, {
		title: seo.title,
		children: [
			/* @__PURE__ */ jsx("meta", {
				name: "description",
				content: seo.description,
				"head-key": "description"
			}),
			/* @__PURE__ */ jsx("link", {
				rel: "canonical",
				href: seo.canonical,
				"head-key": "canonical"
			}),
			Object.entries(seo.alternates).map(([tag, href]) => /* @__PURE__ */ jsx("link", {
				rel: "alternate",
				hrefLang: tag,
				href,
				"head-key": `alt-${tag}`
			}, tag)),
			/* @__PURE__ */ jsx("meta", {
				property: "og:type",
				content: "website",
				"head-key": "og:type"
			}),
			/* @__PURE__ */ jsx("meta", {
				property: "og:site_name",
				content: "Goliath Dispatch",
				"head-key": "og:site_name"
			}),
			/* @__PURE__ */ jsx("meta", {
				property: "og:locale",
				content: localeTag.replace("-", "_"),
				"head-key": "og:locale"
			}),
			/* @__PURE__ */ jsx("meta", {
				property: "og:title",
				content: seo.title,
				"head-key": "og:title"
			}),
			/* @__PURE__ */ jsx("meta", {
				property: "og:description",
				content: seo.description,
				"head-key": "og:description"
			}),
			/* @__PURE__ */ jsx("meta", {
				property: "og:url",
				content: seo.canonical,
				"head-key": "og:url"
			}),
			/* @__PURE__ */ jsx("meta", {
				property: "og:image",
				content: seo.ogImage,
				"head-key": "og:image"
			}),
			/* @__PURE__ */ jsx("meta", {
				name: "twitter:card",
				content: "summary_large_image",
				"head-key": "twitter:card"
			})
		]
	});
}
//#endregion
//#region resources/js/layouts/MarketingLayout.tsx
/**
* El envoltorio de toda página pública: cabecera, pie, SEO y salto al contenido.
*
* El enlace «saltar al contenido» va primero en el DOM y solo se ve al enfocarlo.
* Con seis enlaces de navegación y un conmutador de idioma delante del contenido,
* quien navega con teclado tendría que pasar por ocho paradas en cada página
* para llegar al texto.
*/
function MarketingLayout({ seo, nav, alternate, year, children }) {
	const { t } = useI18n();
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx(Seo, { seo }),
		/* @__PURE__ */ jsx("a", {
			href: "#main",
			className: "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-navy-700 focus:px-4 focus:py-2 focus:text-white",
			children: t("common.a11y.skipToContent")
		}),
		/* @__PURE__ */ jsx(Header, {
			nav,
			alternate
		}),
		/* @__PURE__ */ jsx("main", {
			id: "main",
			className: "min-h-[60vh]",
			children
		}),
		/* @__PURE__ */ jsx(Footer, {
			nav,
			year
		})
	] });
}
//#endregion
export { MarketingLayout as t };
