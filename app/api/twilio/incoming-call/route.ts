import { NextRequest, NextResponse } from "next/server";

import * as twilio from "twilio";
const VoiceResponse = twilio.twiml.VoiceResponse;

export async function POST(request: NextRequest) {
  console.log("Received call");
  // try {
  //   // Use the Twilio Node.js SDK to build an XML response
  //   const twiml = new VoiceResponse();
  //   twiml.say("Hello world!");

  //   // Render the response as XML in reply to the webhook request
  //   return new NextResponse(twiml.toString(), {
  //     headers: { "Content-Type": "text/xml" },
  //   });
  // } catch (error) {
  //   const errorMessage =
  //     error instanceof Error ? error.message : "Unknown error";
  //   return new NextResponse(`Webhook error: ${errorMessage}`, {
  //     status: 400,
  //   });
  // }

  return NextResponse.json({ message: "Received call" });
}
