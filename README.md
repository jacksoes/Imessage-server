# viato

A [Spectrum](https://photon.codes/docs/spectrum-ts) project. Wired with: imessage.

## Environment

Before running, open `.env` and fill in the values:

From your project Settings on the [Photon dashboard](https://app.photon.codes):

- `PROJECT_ID`
- `PROJECT_SECRET`

For Gemini flight search, add `FLIGHTS_API_BASE_URL` with the base URL supplied by your flight API provider. The app calls `GET {base URL}/flights/search?origin=JFK`. The `api.example.com` URL in the sample OpenAPI document is a placeholder, so replace it with the real service URL. If the service requires authentication, its OpenAPI spec needs to describe that before credentials can be wired in.

## Run

```sh
bun install
bun start
```

## Where to go next

- [Spectrum docs](https://photon.codes/docs/spectrum-ts)
- Edit `src/index.ts` to replace the echo loop with real agent logic.
- Add more providers from `spectrum-ts/providers/*`.

To try the flight tool, ask Gemini to search for flights departing from an airport code, for example: `Find flights departing from JFK.` Tool calls are logged in the app terminal as `[TOOL CALLED] searchFlights(...)`.

The server keeps temporary conversation history in memory: up to 20 messages per chat and 100 chats. It is cleared whenever the app restarts, and it is not shared between server instances.
