# viato

A [Spectrum](https://photon.codes/docs/spectrum-ts) project. Wired with: imessage.

## Environment

Before running, open `.env` and fill in the values:

From your project Settings on the [Photon dashboard](https://app.photon.codes):

- `PROJECT_ID`
- `PROJECT_SECRET`

For live Google Flights search, add `SERPAPI_API_KEY` from SerpApi. Google Flights search is available through SerpApi's API; the Google partner integration is invite-only. The app makes one-way searches and reports the top result's segment flight numbers, times, price, and Google Flights link. SerpApi currently lists a free plan with 250 searches/month; paid plans start at $25/month. Searches require departure airport, destination airport, and travel date. The `api.example.com` endpoint from the sample OpenAPI document was only a placeholder and is no longer used.

## Run

```sh
bun install
bun start
```

## Where to go next

- [Spectrum docs](https://photon.codes/docs/spectrum-ts)
- Edit `src/index.ts` to replace the echo loop with real agent logic.
- Add more providers from `spectrum-ts/providers/*`.

To try the flight tool, ask Gemini to search a route and date, for example: `Find a one-way flight from JFK to MCO on 2026-11-02.` If a route, airport, or date is unclear, Gemini should ask a follow-up. Tool calls are logged in the app terminal as `[TOOL CALLED] searchFlights(...)`.

The server keeps temporary conversation history in memory: up to 20 messages per chat and 100 chats. It is cleared whenever the app restarts, and it is not shared between server instances.
