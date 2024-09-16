import express from "express";
import expressWebSocket from "express-ws";
import { engine } from "express-handlebars";
import websocketStream from "websocket-stream/stream.js";
import WebSocket from "ws";
import dotenv from "dotenv";
import { SpeechClient } from "@google-cloud/speech";

dotenv.config();

const app = express();
expressWebSocket(app, null, { perMessageDeflate: false });
app.engine("hbs", engine());
app.set("view engine", "hbs");

const PORT = process.env.EXPRESS_PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_CUSTOM_VOICE_ID;

const speechClient = new SpeechClient();
app.use(express.json());

app.post("/start-stream", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  const host = req.headers["x-original-host"] || req.hostname;
  res.render("twiml", { host, layout: false });
});

let mediaStream;

app.ws("/media", (ws) => {
  mediaStream = websocketStream(ws, { binary: false });

  const recognizeStream = speechClient.streamingRecognize({
    config: {
      encoding: "MULAW",
      sampleRateHertz: 8000,
      languageCode: "en-US",
    },
    interimResults: false,
  });

  let elevenLabsWs;

  mediaStream.on("data", async (data) => {
    try {
      const parsedData = JSON.parse(data);
      if (parsedData.event === "start") {
        console.log("Call started");
        elevenLabsWs = await connectToElevenLabs();
      } else if (parsedData.event === "media") {
        const audioBuffer = Buffer.from(parsedData.media.payload, "base64");
        recognizeStream.write(audioBuffer);
      } else if (parsedData.event === "stop") {
        console.log("Call ended");
        recognizeStream.end();
        if (elevenLabsWs) elevenLabsWs.close();
      }
    } catch (error) {
      console.error("Error processing media stream:", error);
    }
  });

  recognizeStream.on("data", async (data) => {
    if (data.results[0] && data.results[0].alternatives[0]) {
      const transcription = data.results[0].alternatives[0].transcript;
      console.log(`Transcription: ${transcription}`);

      try {
        // Sending transcription to Python WebSocket server
        const pythonWs = new WebSocket("ws://localhost:5000");
        pythonWs.on("open", () => {
          pythonWs.send(transcription);
        });

        pythonWs.on("message", (aiResponse) => {
          console.log(`AI Response from Python: ${aiResponse}`);
          if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
            elevenLabsWs.send(JSON.stringify({ text: aiResponse }));
          }
        });

        pythonWs.on("error", (error) => {
          console.error("Error in Python WebSocket:", error);
        });
      } catch (error) {
        console.error("Error processing AI response:", error);
      }
    }
  });

  recognizeStream.on("error", (error) => {
    console.error("Error in Google Speech-to-Text stream:", error);
  });

  mediaStream.on("error", (error) => {
    console.error("Error in media stream:", error);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

async function connectToElevenLabs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=eleven_turbo_v2_5`
    );

    ws.on("open", () => {
      console.log("ElevenLabs websocket is open");
      ws.send(
        JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          xi_api_key: ELEVENLABS_API_KEY,
        })
      );
      resolve(ws);
    });

    ws.on("message", (message) => {
      const data = JSON.parse(message);
      if (data.audio) {
        handleElevenLabsAudio(Buffer.from(data.audio, "base64"));
      }
    });

    ws.on("error", (error) => {
      console.error("ElevenLabs WebSocket error:", error);
      reject(error);
    });

    ws.on("close", () => {
      console.log("ElevenLabs WebSocket closed");
    });
  });
}

function handleElevenLabsAudio(audioChunk) {
  if (mediaStream) {
    console.log("Received audio chunk from ElevenLabs");
    mediaStream.write(
      JSON.stringify({
        event: "media",
        media: { payload: audioChunk.toString("base64") },
      })
    );
  } else {
    console.error("mediaStream is not defined");
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
