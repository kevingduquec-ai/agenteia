const USER_AGENT = 'PrefieroIA-CatalogHarvester/0.1 (+https://prefieroacr.com; uso interno para prefieroacr.com y creditoacr.com, respeta robots.txt)';

let lastRequestAt = 0;

/**
 * Fetch respetuoso: un solo request en vuelo, con una pausa minima entre
 * peticiones (ver seccion 21 del documento maestro — antes de operar este
 * mecanismo de forma permanente sobre un sitio ajeno debe existir
 * autorizacion del propietario y una politica razonable de consumo).
 */
export async function politeFetch(url: string, delayMs: number, extraHeaders?: Record<string, string>): Promise<string> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < delayMs) {
    await sleep(delayMs - elapsed);
  }
  lastRequestAt = Date.now();

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...extraHeaders } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`);
  }
  return response.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
