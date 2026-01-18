import { Redis } from "ioredis";
import { cacheGetJson, cacheSetJson } from "./cache";
import { Env } from "../config";

const cryptoSymbolsKey = (symbols: string[], currency: string) =>
  `markets:crypto:${currency}:${symbols.join(",")}`;
const stocksKey = (symbols: string[]) => `markets:stocks:${symbols.join(",")}`;

type CryptoRow = { id: string; price: number | null; change24h: number | null };
type StockRow = { symbol: string; price: string | null; change: string | null; changePercent: string | null };

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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

export const fetchStockSnapshot = async (redis: Redis, env: Env): Promise<StockRow[]> => {
  const apiKey = env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return [];
  const symbols = parseList(env.MARKET_STOCK_SYMBOLS).map((symbol) => symbol.toUpperCase());

  const cached = await cacheGetJson<StockRow[]>(redis, stocksKey(symbols));
  if (cached) return cached;

  const results: StockRow[] = [];
  for (const symbol of symbols) {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "GLOBAL_QUOTE");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }
    const payload = (await response.json()) as { "Global Quote"?: Record<string, string> };
    const quote = payload["Global Quote"] ?? {};
    results.push({
      symbol,
      price: quote["05. price"] ?? null,
      change: quote["09. change"] ?? null,
      changePercent: quote["10. change percent"] ?? null
    });
  }

  await cacheSetJson(redis, stocksKey(symbols), results, 60);
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
