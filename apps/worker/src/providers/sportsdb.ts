type SportsDbEvent = {
  idEvent?: string;
  strSport?: string;
  strLeague?: string;
  strLeagueShort?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  dateEvent?: string;
  strTime?: string;
  strTimestamp?: string;
  strVenue?: string;
  strCountry?: string;
  strSeason?: string;
  strRound?: string;
  strStatus?: string;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  strEvent?: string;
};

const parseScore = (value: SportsDbEvent["intHomeScore"]) => {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
};

const parseEventTime = (event: SportsDbEvent): Date | null => {
  const timestamp = event.strTimestamp?.trim();
  if (timestamp) {
    const normalized = /[zZ]|\+|T/.test(timestamp) ? timestamp : `${timestamp}Z`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }

  const date = event.dateEvent?.trim();
  if (!date) return null;
  const time = (event.strTime ?? "00:00:00").trim();
  const iso = `${date}T${time}`;
  const parsed = new Date(`${iso}Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

export const fetchEventsDay = async (apiKey: string, date: string, sport: string) => {
  const url = new URL(`https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsday.php`);
  url.searchParams.set("d", date);
  url.searchParams.set("s", sport);

  const response = await fetch(url.toString());
  if (!response.ok) {
    return [] as SportsDbEvent[];
  }

  const payload = (await response.json()) as { events?: SportsDbEvent[] | null };
  return payload.events ?? [];
};

export const toMatchData = (event: SportsDbEvent) => {
  if (!event.idEvent || !event.strHomeTeam || !event.strAwayTeam) return null;
  const startTime = parseEventTime(event);
  if (!startTime) return null;

  const statusText = event.strStatus?.trim() ?? "";
  const statusLower = statusText.toLowerCase();
  const status = statusLower.includes("finished") || statusLower === "ft"
    ? "finished"
    : statusLower && statusLower !== "not started"
      ? "live"
      : "scheduled";

  return {
    source: "thesportsdb",
    sourceId: event.idEvent,
    league: event.strLeague?.trim() || "Unknown",
    teamA: event.strHomeTeam.trim(),
    teamB: event.strAwayTeam.trim(),
    startTime,
    status,
    venue: event.strVenue?.trim() || null,
    scoreA: parseScore(event.intHomeScore),
    scoreB: parseScore(event.intAwayScore),
    statusText,
    metaJson: {
      sport: event.strSport,
      leagueShort: event.strLeagueShort,
      country: event.strCountry,
      season: event.strSeason,
      round: event.strRound,
      eventName: event.strEvent
    }
  } as const;
};
