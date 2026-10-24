import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI();

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    imessage.config(),
  ],
});

// This prints ONCE when you start the server
console.log("TESST - Agent is online and listening!");

for await (const [space, message] of app.messages) {
  if (message.content.type === "text") {
    // This prints EVERY TIME an incoming message arrives
    console.log(`Received incoming message: ${message.content.text}`);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: message.content.text,
        config: {
          systemInstruction: "You are a helpful and concise assistant responding via iMessage/RCS.",
        }
      });

      const replyText = response.text || "I couldn't generate a response.";
      await space.send(replyText);
      
    } catch (error) {
      console.error("Gemini API Error:", error);
      await space.send("Sorry, I encountered an error processing your message.");
    }
  }
}