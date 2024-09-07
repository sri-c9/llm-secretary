import { NextRequest, NextResponse } from "next/server";
import * as twilio from "twilio";
const VoiceResponse = twilio.twiml.VoiceResponse;

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request body
    const formData = await request.formData();
    const fromNumber = formData.get("From"); // Get the phone number

    // Log the phone number
    console.log("Incoming call from:", fromNumber);

    // Use the Twilio Node.js SDK to build an XML response
    const voiceResponse = new VoiceResponse();

    const audioUrl =
      "https://loved-viper-notable.ngrok-free.app/audio-data/assistant-response.mp3";
    voiceResponse.play(audioUrl);

    // Render the response as XML in reply to the webhook request
    return new NextResponse(voiceResponse.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(`Webhook error: ${errorMessage}`, {
      status: 400,
    });
  }
}
