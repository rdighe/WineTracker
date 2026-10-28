/**
 * Retailers for the bulk crawl.
 *
 * tos records what each site's terms of service say about automated access,
 * as checked on 2026-10-11 (2026-10-28 for Flask Fine Wines and Napa Cabs).
 * Sites marked 'prohibits_scraping' were included at the project owner's
 * explicit request; remove them from SITES (or pass --exclude-tos-prohibited
 * to the crawler) to drop them.
 *
 * Not listed because they refuse our crawler (bot protection / 403 / 406): wine.com,
 * totalwine.com, binnys.com, winelibrary.com, astorwines.com, jjbuckley.com,
 * winex.com, kermitlynch.com, ackerwines.com. Not listed because robots.txt
 * disallows it (checked 2026-10-28): klwines.com, unionsquarewines.com,
 * winehousesf.com, wineexchange.com. No crawlable catalog (no feed, no product
 * sitemap): weimax.com, hitimewine.net, whwc.com, cwdc.com, baygrape.com,
 * arlequinwinemerchant.com, morrellwine.com, esquin.com. Feeds whose terms
 * prohibit scraping, skipped at the owner's choice (2026-10-28):
 * flatiron-wines.com, vintagewinemerchants.com.
 */
export type TosStatus = 'prohibits_scraping' | 'no_clause_found' | 'not_found';

export interface SiteConfig {
  domain: string;
  name: string;
  kind: 'shopify' | 'woocommerce' | 'sitemap';
  tos: TosStatus;
  /** sitemap kind: product page URLs to keep */
  productPattern?: RegExp;
  /** sitemap kind: child sitemaps to descend into */
  childPattern?: RegExp;
  sitemaps?: string[];
}

export const SITES: SiteConfig[] = [
  // Shopify stores: the public /products.json feed returns 250 products per request.
  { domain: 'www.zachys.com', name: 'Zachys', kind: 'shopify', tos: 'prohibits_scraping' },
  { domain: 'bottlebarn.com', name: 'Bottle Barn', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'bassins.com', name: 'Bassins', kind: 'shopify', tos: 'prohibits_scraping' },
  { domain: 'lastbottlewines.com', name: 'Last Bottle Wines', kind: 'shopify', tos: 'prohibits_scraping' },
  { domain: 'chambersstwines.com', name: 'Chambers Street Wines', kind: 'shopify', tos: 'prohibits_scraping' },
  { domain: 'primalwine.com', name: 'Primal Wine', kind: 'shopify', tos: 'prohibits_scraping' },
  { domain: 'crushwineco.com', name: 'Crush Wine & Spirits', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'www.missionliquor.com', name: 'Mission Liquor', kind: 'shopify', tos: 'prohibits_scraping' },
  { domain: 'vervewine.com', name: 'Verve Wine', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'plumpjackwines.com', name: 'PlumpJack Wines', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'silverlakewine.com', name: 'Silver Lake Wine', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'solanocellars.com', name: 'Solano Cellars', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'cellar.com', name: "Schneider's of Capitol Hill", kind: 'shopify', tos: 'no_clause_found' },
  { domain: '67wine.com', name: '67 Wine & Spirits', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'wineandcheeseplace.com', name: 'The Wine and Cheese Place', kind: 'shopify', tos: 'not_found' },
  { domain: 'sommselect.com', name: 'SommSelect', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'highlandparkwine.com', name: 'Highland Park Wine', kind: 'shopify', tos: 'not_found' },
  { domain: 'permanwine.com', name: 'Perman Wine Selections', kind: 'shopify', tos: 'no_clause_found' },
  { domain: 'slopecellars.com', name: 'Slope Cellars', kind: 'shopify', tos: 'not_found' },
  { domain: 'linerandelsen.com', name: 'Liner & Elsen', kind: 'shopify', tos: 'not_found' },
  { domain: 'www.flaskfinewines.com', name: 'Flask Fine Wines', kind: 'shopify', tos: 'not_found' },
  // Sitemap + structured data on each product page.
  {
    domain: 'www.wallywine.com', name: "Wally's Wine & Spirits", kind: 'sitemap', tos: 'not_found',
    sitemaps: ['https://www.wallywine.com/sitemap.xml'], childPattern: /\/sitemap\/products\//, productPattern: /\/products\//,
  },
  // WooCommerce Store API, 100 products per request.
  { domain: 'www.saratogawine.com', name: 'Saratoga Wine Exchange', kind: 'woocommerce', tos: 'no_clause_found' },
  {
    // BigCommerce: product sitemaps list wine and spirits alike; spirits, accessories and case bundles are left out by URL.
    domain: 'www.napacabs.com', name: 'Napa Cabs', kind: 'sitemap', tos: 'no_clause_found',
    sitemaps: ['https://www.napacabs.com/xmlsitemap.php'], childPattern: /type=products/,
    productPattern: /^https:\/\/www\.napacabs\.com\/(?![^/]*(bourbon|whisk|vodka|gin|tequila|rum|mezcal|schnapps|shochu|sake|soju|liqueur|brandy|cognac|armagnac|scotch|beer|cider|bitters|vermouth|amaro|aperitif|glass|opener|gift-card|case|pack))[^/]+\.html$/i,
  },
  {
    domain: 'specsonline.com', name: "Spec's", kind: 'sitemap', tos: 'not_found',
    sitemaps: ['https://specsonline.com/sitemap.xml'], childPattern: /products-\d+\.xml/, productPattern: /\/shop\/wine\//,
  },
];
