type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export function createAnalytics(
  measurementId: string | undefined,
  pageUrl: string,
  target: AnalyticsWindow,
  appendScript: (url: string) => void,
) {
  const enabled = Boolean(measurementId && /^G-[A-Z0-9]+$/.test(measurementId) && measurementId !== 'G-XXXXXXXXXX');
  let loaded = false;
  function grant() {
    if (!enabled || loaded) return;
    loaded = true;
    target.dataLayer = target.dataLayer || [];
    target.gtag = (...args: unknown[]) => { target.dataLayer!.push(args); };
    target.gtag('js', new Date());
    // Explicit page_view, with the query string removed, prevents accidental search-term transmission.
    target.gtag('config', measurementId!, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    appendScript(`https://www.googletagmanager.com/gtag/js?id=${measurementId}`);
    target.gtag('event', 'page_view', { page_location: pageUrl });
  }
  function event(name: 'steam_market_click' | 'currency_change', parameters: Record<string, string>) {
    if (loaded) target.gtag?.('event', name, parameters);
  }
  return { enabled, grant, event, isLoaded: () => loaded };
}
