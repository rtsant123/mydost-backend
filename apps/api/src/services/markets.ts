import { Redis } from "ioredis";
import { cacheGetJson, cacheSetJson } from "./cache";
import { Env } from "../config";

const cryptoSymbolsKey = (symbols: string[], currency: string) =>
  `markets:crypto:${currency}:${symbols.join(",")}`;
const stocksKey = (symbols: string[]) => `markets:stocks:${symbols.join(",")}`;

type CryptoRow = { id: string; price: number | null; change24h: number | null };
type StockRow = { symbol: string; price: string | null; change: string | null; changePercent: string | null };

const STOCKS_INTRADAY_INTERVAL = "5min";
const STOCKS_CACHE_TTL_SECONDS = 60 * 60 * 24;

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const formatSigned = (value: number, decimals = 2) => {
  const fixed = value.toFixed(decimals);
  return value > 0 ? `+${fixed}` : fixed;
};

const parseIntradayQuote = (payload: Record<string, unknown>, interval: string) => {
  const seriesKey = `Time Series (${interval})`;
  const series = payload[seriesKey] as Record<string, Record<string, string>> | undefined;
  if (!series) return null;
  const timestamps = Object.keys(series);
  if (!timestamps.length) return null;
  timestamps.sort((a, b) => (a < b ? 1 : -1));
  const latest = series[timestamps[0]];
  const previous = series[timestamps[1]];
  const latestCloseRaw = latest?.["4. close"];
  if (!latestCloseRaw) return null;
  const latestClose = Number(latestCloseRaw);
  if (!Number.isFinite(latestClose)) return null;
  const previousCloseRaw = previous?.["4. close"];
  const previousClose = previousCloseRaw ? Number(previousCloseRaw) : null;

  let change: number | null = null;
  let changePercent: number | null = null;
  if (previousClose !== null && Number.isFinite(previousClose) && previousClose !== 0) {
    change = latestClose - previousClose;
    changePercent = (change / previousClose) * 100;
  }

  return {
    price: latestClose,
    change,
    changePercent
  };
};

export const fetchCryptoSnapshot = async (redis: Redis, env: Env): Promise<CryptoRow[]> => {
  const apiKey = env.FREECRYPTO_API_KEY;
  if (!apiKey) return [];

  const symbols = parseList(env.MARKET_CRYPTO_SYMBOLS).map((symbol) => symbol.toUpperCase());
  const currency = "INR";
  const cacheKey = cryptoSymbolsKey(symbols, currency);
  const cached = await cacheGetJson<CryptoRow[]>(redis, cacheKey);
  if (cached) return cached;

  const endpoint = "getDataCurrency";
  const results: CryptoRow[] = [];

  for (const symbol of symbols) {
    const url = new URL(`https://api.freecryptoapi.com/v1/${endpoint}`);
    url.searchParams.set("symbol", symbol);
    if (endpoint === "getDataCurrency") {
      url.searchParams.set("currency", currency);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      results.push({ id: symbol, price: null, change24h: null });
      continue;
    }
    const payload = (await response.json()) as {
      symbol?: string;
      price?: number;
      change_24h?: number;
    };
    results.push({
      id: symbol,
      price: payload?.price ?? null,
      change24h: payload?.change_24h ?? null
    });
  }

  await cacheSetJson(redis, cacheKey, results, 60);
  return results;
};

export const fetchStockSnapshot = async (
  redis: Redis,
  env: Env,
  options?: { forceRefresh?: boolean; cacheTtlSeconds?: number }
): Promise<StockRow[]> => {
  const apiKey = env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return [];
  const symbols = parseList(env.MARKET_STOCK_SYMBOLS).map((symbol) => symbol.toUpperCase());

  const cacheKey = stocksKey(symbols);
  const cached = await cacheGetJson<StockRow[]>(redis, cacheKey);
  if (cached && !options?.forceRefresh) return cached;

  const results: StockRow[] = [];
  for (const symbol of symbols) {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "TIME_SERIES_INTRADAY");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", STOCKS_INTRADAY_INTERVAL);
    url.searchParams.set("outputsize", "compact");
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (payload["Note"] || payload["Error Message"] || payload["Information"]) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }

    const quote = parseIntradayQuote(payload, STOCKS_INTRADAY_INTERVAL);
    if (!quote) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }

    results.push({
      symbol,
      price: quote.price.toFixed(2),
      change: quote.change !== null ? formatSigned(quote.change) : null,
      changePercent: quote.changePercent !== null ? `${formatSigned(quote.changePercent)}%` : null
    });
  }

  const shouldFallbackToCache = cached && results.every((row) => row.price === null);
  if (shouldFallbackToCache) return cached;

  await cacheSetJson(redis, cacheKey, results, options?.cacheTtlSeconds ?? STOCKS_CACHE_TTL_SECONDS);
  return results;
};

export const buildMarketsContext = async (redis: Redis, env: Env) => {
  const [crypto, stocks] = await Promise.all([fetchCryptoSnapshot(redis, env), fetchStockSnapshot(redis, env)]);

  const lines: string[] = [];
  if (crypto.length) {
    const currency = "INR";
    const prefix = "₹";
    lines.push(
      `Crypto (${currency}):`,
      ...crypto.map(
        (row) => `${row.id.toUpperCase()}: ${prefix}${row.price ?? "—"} (${row.change24h ?? "—"}% 24h)`
      )
    );
  }
  if (stocks.length) {
    lines.push(
      "Stocks (India):",
      ...stocks.map((row) => `${row.symbol}: ${row.price ?? "—"} (${row.changePercent ?? "—"})`)
    );
  }
  return lines.length ? lines.join("\n") : "";
};
