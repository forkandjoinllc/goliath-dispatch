export interface NavLink {
  route: string
  href: string
  labelKey: string
}

export interface MarketingNav {
  primary: NavLink[]
  footerProduct: NavLink[]
  footerCompany: NavLink[]
  footerLegal: NavLink[]
  home: string
}

export interface MarketingSeo {
  title: string
  description: string
  canonical: string
  alternates: Record<string, string>
  ogImage: string
}

export interface MarketingAlternate {
  locale: string
  label: string
  href: string
}

export interface MarketingPageProps {
  route: string
  seo: MarketingSeo
  nav: MarketingNav
  alternate: MarketingAlternate
  year: number
}
