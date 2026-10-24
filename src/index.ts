import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { GoogleGenAI, ThinkingLevel, Type, type FunctionDeclaration } from "@google/genai";

const toolDeclarations: FunctionDeclaration[] = [{
  name: "verify_tool",
  description: "A demo tool that proves Gemini can call an app tool. Use it when the user asks to test, verify, or use the tool. Echo their phrase in the result.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      phrase: { type: Type.STRING, description: "A short phrase supplied by the user to echo back." },
    },
    required: ["phrase"],
  },
}, {
  name: "searchFlights",
  description: "Search live Google Flights results for a one-way flight. Call only after you know the departure airport, arrival airport, and travel date. Ask a follow-up if any are missing or ambiguous. Use three-letter IATA airport codes. Set departureWindow when the user requests a time of day.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      origin: { type: Type.STRING, description: "Three-letter IATA departure airport code, for example JFK." },
      destination: { type: Type.STRING, description: "Three-letter IATA arrival airport code, for example MCO." },
      outboundDate: { type: Type.STRING, description: "Departure date in YYYY-MM-DD format." },
      departureWindow: { type: Type.STRING, enum: ["morning", "afternoon", "evening", "any"], description: "Requested local departure time window. Morning is before noon; afternoon is noon to 6 PM; evening is 6 PM to midnight." },
    },
    required: ["origin", "destination", "outboundDate"],
  },
}];

type ChatTurn = { role: "user" | "assistant"; text: string };
const chatMemory = new Map<string, ChatTurn[]>();
const MAX_TURNS_PER_CHAT = 10;
const MAX_CHATS_IN_MEMORY = 100;

function rememberTurn(chatId: string, turn: ChatTurn): void {
  const turns = chatMemory.get(chatId) ?? [];
  turns.push(turn);
  if (turns.length > MAX_TURNS_PER_CHAT * 2) turns.splice(0, turns.length - MAX_TURNS_PER_CHAT * 2);

  // Map insertion order lets the oldest inactive chat be evicted first.
  chatMemory.delete(chatId);
  chatMemory.set(chatId, turns);
  if (chatMemory.size > MAX_CHATS_IN_MEMORY) {
    const oldestChat = chatMemory.keys().next().value;
    if (oldestChat) chatMemory.delete(oldestChat);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function searchFlights(origin: string, destination: string, outboundDate: string, departureWindow: string): Promise<string> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return "Flight search is not configured. Set SERPAPI_API_KEY to a SerpApi key.";
  }

  try {
    const departure = origin.trim().toUpperCase();
    const arrival = destination.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(departure) || !/^[A-Z]{3}$/.test(arrival)) {
      return "Please provide a departure and destination airport using three-letter IATA codes.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(outboundDate)) {
      return "Please provide the travel date in YYYY-MM-DD format.";
    }

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_flights");
    url.searchParams.set("departure_id", departure);
    url.searchParams.set("arrival_id", arrival);
    url.searchParams.set("outbound_date", outboundDate);
    url.searchParams.set("type", "2"); // one-way
    const outboundTimes: Record<string, string> = {
      morning: "0,11",
      afternoon: "12,17",
      evening: "18,23",
    };
    if (outboundTimes[departureWindow]) url.searchParams.set("outbound_times", outboundTimes[departureWindow]);
    url.searchParams.set("currency", "USD");
    url.searchParams.set("hl", "en");
    url.searchParams.set("gl", "us");
    url.searchParams.set("api_key", apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await response.text();
    let result: unknown;
    try {
      result = JSON.parse(body);
    } catch {
      return `Google Flights search failed with HTTP ${response.status}.`;
    }

    if (!response.ok || !isRecord(result)) {
      return `Google Flights search failed with HTTP ${response.status}.`;
    }

    if (typeof result.error === "string") return `Google Flights search failed: ${result.error}`;

    const bestFlights = Array.isArray(result.best_flights) ? result.best_flights : [];
    const otherFlights = Array.isArray(result.other_flights) ? result.other_flights : [];
    const itinerary = isRecord(bestFlights[0]) ? bestFlights[0] : isRecord(otherFlights[0]) ? otherFlights[0] : undefined;
    if (!itinerary || !Array.isArray(itinerary.flights) || itinerary.flights.length === 0) {
      return "No matching flights were found for that route and date.";
    }

    const segments = itinerary.flights.map((segment, index) => {
      if (!isRecord(segment)) return `Segment ${index + 1}: details unavailable`;
      const departureAirport = isRecord(segment.departure_airport) ? segment.departure_airport : {};
      const arrivalAirport = isRecord(segment.arrival_airport) ? segment.arrival_airport : {};
      const flightNumber = typeof segment.flight_number === "string" ? segment.flight_number : "flight number unavailable";
      const airline = typeof segment.airline === "string" ? segment.airline : "Airline unavailable";
      const from = typeof departureAirport.id === "string" ? departureAirport.id : departure;
      const to = typeof arrivalAirport.id === "string" ? arrivalAirport.id : arrival;
      const departTime = typeof departureAirport.time === "string" ? departureAirport.time : "time unavailable";
      const arriveTime = typeof arrivalAirport.time === "string" ? arrivalAirport.time : "time unavailable";
      return `${index + 1}. ${airline} ${flightNumber}: ${from} ${departTime} → ${to} ${arriveTime}`;
    });

    const price = typeof itinerary.price === "number" ? `Price shown: $${itinerary.price} USD.` : "Price unavailable.";
    const totalDuration = typeof itinerary.total_duration === "number" ? `Total duration: ${itinerary.total_duration} minutes.` : "";
    const metadata = isRecord(result.search_metadata) ? result.search_metadata : {};
    const flightsUrl = typeof metadata.google_flights_url === "string" ? metadata.google_flights_url : "";
    return ["Top Google Flights result (not booked):", ...segments, price, totalDuration, flightsUrl].filter(Boolean).join("\n");
  } catch (error) {
    return `Could not reach Google Flights search: ${String(error)}`;
  }
}

const GEMINI_MODEL = "gemini-3.8-flash";
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) throw new Error("GEMINI_API_KEY is required to start the agent.");
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    imessage.config(),
  ],
});

for await (const [space, message] of app.messages) {
  if (message.content.type === "text") {
    // This prints EVERY TIME an incoming message arrives
    console.log(`Received incoming message: ${message.content.text}`);

    try {
      const chatId = `${message.platform}:${space.id}`;
      const turns = chatMemory.get(chatId) ?? [];
      const conversation = [
        ...turns.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`),
        `User: ${message.content.text}`,
      ].join("\n");

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: conversation,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: 512,
          systemInstruction: "You are a helpful and concise assistant responding via iMessage/RCS. When the user asks to test or verify tool calling, call verify_tool. For flight searches, use the searchFlights tool only after you have a departure airport, destination airport, and travel date. If a request is ambiguous (for example, a state with several airports) or any detail is missing, ask a concise follow-up instead of guessing. Morning means before noon; if the user also says before 12 AM/midnight, clarify because that conflicts with morning. The tool returns the top Google Flights result and its flight number(s); do not invent, book, or claim that the flight is reserved.",
          tools: [{ functionDeclarations: toolDeclarations }],
        }
      });
      const usage = response.usageMetadata;
      if (usage) {
        console.log(`[GEMINI USAGE] model=${GEMINI_MODEL} input_tokens=${usage.promptTokenCount ?? 0} output_tokens=${usage.candidatesTokenCount ?? 0} total_tokens=${usage.totalTokenCount ?? 0}`);
      }

      const toolCalls = response.functionCalls ?? [];
      let replyText = response.text || "I couldn't generate a response.";

      if (toolCalls.length > 0) {
        const toolResults = await Promise.all(toolCalls.map(async (toolCall) => {
          let result: unknown;

          if (toolCall.name === "verify_tool") {
            const phrase = typeof toolCall.args?.phrase === "string" ? toolCall.args.phrase : "verified";
            console.log(`[TOOL CALLED] verify_tool({ phrase: "${phrase}" })`);
            result = { result: `✅ TOOL RAN: ${phrase}` };
          } else if (toolCall.name === "searchFlights") {
            const origin = typeof toolCall.args?.origin === "string" ? toolCall.args.origin : "";
            const destination = typeof toolCall.args?.destination === "string" ? toolCall.args.destination : "";
            const outboundDate = typeof toolCall.args?.outboundDate === "string" ? toolCall.args.outboundDate : "";
            const departureWindow = typeof toolCall.args?.departureWindow === "string" ? toolCall.args.departureWindow : "any";
            if (!origin.trim() || !destination.trim() || !outboundDate.trim()) {
              result = "Departure airport, destination airport, and travel date are required.";
            } else {
              console.log(`[TOOL CALLED] searchFlights({ origin: "${origin}", destination: "${destination}", outboundDate: "${outboundDate}", departureWindow: "${departureWindow}" })`);
              result = await searchFlights(origin, destination, outboundDate, departureWindow);
            }
          } else {
            result = { error: `Unknown tool: ${toolCall.name}` };
          }

          return { name: toolCall.name, result };
        }));

        replyText = toolResults.map(({ name, result }) => name === "verify_tool"
          ? String((result as { result: string }).result)
          : String(result))
          .join("\n\n");
      }

      rememberTurn(chatId, { role: "user", text: message.content.text });
      rememberTurn(chatId, { role: "assistant", text: replyText });
      try {
        await space.send(replyText);
      } catch (sendError) {
        // Do not send a second message here: the first send may have reached
        // the carrier even when delivery confirmation failed.
        console.error("iMessage send failed; not retrying automatically:", sendError);
      }
      
    } catch (error) {
      console.error("Agent turn failed:", error);
    }
  }
}
