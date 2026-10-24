import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";

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
  description: "Search the configured Google Flights API for flights departing from an airport. Call this when the user asks to find, search for, or compare flights. The API currently accepts an origin airport code only.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      origin: { type: Type.STRING, description: "Departure airport code, for example JFK or SFO." },
    },
    required: ["origin"],
  },
}];

type ChatTurn = { role: "user" | "assistant"; text: string };
const chatMemory = new Map<string, ChatTurn[]>();
const MAX_TURNS_PER_CHAT = 20;
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

async function searchFlights(origin: string): Promise<unknown> {
  const baseUrl = process.env.FLIGHTS_API_BASE_URL;
  if (!baseUrl) {
    return { error: "Flight search is not configured. Set FLIGHTS_API_BASE_URL to the real API base URL." };
  }

  try {
    const apiBase = new URL(baseUrl);
    if (apiBase.protocol !== "http:" && apiBase.protocol !== "https:") {
      return { error: "FLIGHTS_API_BASE_URL must be an absolute http(s) URL, such as https://your-flight-api.example." };
    }

    const url = new URL("/flights/search", apiBase);
    url.searchParams.set("origin", origin.trim().toUpperCase());

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await response.text();
    let result: unknown;
    try {
      result = JSON.parse(body);
    } catch {
      result = body.slice(0, 8_000);
    }

    if (!response.ok) {
      return { error: `Flight API returned HTTP ${response.status}.`, details: result };
    }

    return result;
  } catch (error) {
    return { error: "Could not reach the Flight API.", details: String(error) };
  }
}

const ai = new GoogleGenAI();

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
        model: 'gemini-2.5-flash',
        contents: conversation,
        config: {
          systemInstruction: "You are a helpful and concise assistant responding via iMessage/RCS. When the user asks to test or verify tool calling, call verify_tool. When the user asks to search for flights, call searchFlights with their departure airport code, then summarize only the returned API results. If the API reports that it is not configured, tell the user to set FLIGHTS_API_BASE_URL.",
          tools: [{ functionDeclarations: toolDeclarations }],
        }
      });

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
            if (!origin.trim()) {
              result = { error: "An origin airport code is required." };
            } else {
              console.log(`[TOOL CALLED] searchFlights({ origin: "${origin}" })`);
              result = await searchFlights(origin);
            }
          } else {
            result = { error: `Unknown tool: ${toolCall.name}` };
          }

          return { name: toolCall.name, result };
        }));

        replyText = toolResults.map(({ name, result }) => name === "verify_tool"
          ? String((result as { result: string }).result)
          : `Flight search results:\n${JSON.stringify(result, null, 2)}`)
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
