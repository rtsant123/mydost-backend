import { Redis } from "ioredis";
import { cacheGetJson, cacheSetJson } from "./cache";
import { Env } from "../config";

const cryptoKey = (ids: string[], vs: string) => `markets:crypto:${vs}:${ids.join(",")}`;
const stocksKey = (symbols: string[]) => `markets:stocks:${symbols.join(",")}`;

type CryptoRow = { id: string; price: number | null; change24h: number | null };
type StockRow = { symbol: string; price: string | null; change: string | null; changePercent: string | null };

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const fetchCryptoSnapshot = async (
  redis: Redis,
  env: Env,
  vs: string = "inr"
): Promise<CryptoRow[]> => {
  const ids = parseList(env.MARKET_CRYPTO_IDS);
  const cached = await cacheGetJson<CryptoRow[]>(redis, cryptoKey(ids, vs));
  if (cached) return cached;

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", vs);
  url.searchParams.set("include_24hr_change", "true");

  const response = await fetch(url.toString());
  if (!response.ok) return [];

  const payload = (await response.json()) as Record<string, Record<string, number>>;
  const data = ids.map((id) => ({
    id,
    price: payload?.[id]?.[vs] ?? null,
    change24h: payload?.[id]?.[`${vs}_24h_change`] ?? null
  }));

  await cacheSetJson(redis, cryptoKey(ids, vs), data, 60);
  return data;
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
  const [crypto, stocks] = await Promise.all([
    fetchCryptoSnapshot(redis, env, "inr"),
    fetchStockSnapshot(redis, env)
  ]);

  const lines: string[] = [];
  if (crypto.length) {
    lines.push(
      "Crypto (INR):",
      ...crypto.map((row) => `${row.id.toUpperCase()}: ₹${row.price ?? "—"} (${row.change24h ?? "—"}% 24h)`)
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
