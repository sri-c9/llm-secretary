import asyncio
import websockets
import io
from google.cloud import speech_v1p1beta1 as speech
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferMemory

# Initialize components
model = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0,
    max_tokens=None,
    timeout=None,
    max_retries=3,
    # api_key="...",  # if you prefer to pass api key in directly instaed of using env vars
)
memory = ConversationBufferMemory()


async def transcribe_audio(audio_chunk):
    client = speech.SpeechClient()
    audio_data = io.BytesIO(audio_chunk)
    audio = speech.RecognitionAudio(content=audio_data.read())

    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=8000,
        language_code="en-US",
    )

    try:
        response = await client.recognize(config=config, audio=audio)
        if response.results:
            return response.results[0].alternatives[0].transcript
    except Exception as e:
        print(f"Error in transcription: {e}")

    return None


async def generate_ai_response(transcription):
    prompt_template = "You are an AI assistant. Respond to the user’s request: {input}"
    prompt = prompt_template.format(input=transcription)

    try:
        response = await model(prompt)
        memory.append(transcription)
        return response
    except Exception as e:
        print(f"Error generating AI response: {e}")
        return "Sorry, I couldn't generate a response."

# Asynchronous function to process audio


async def process_audio(websocket, path):
    async for audio_chunk in websocket:
        try:
            # Process audio chunk
            transcription = await transcribe_audio(audio_chunk)
            if transcription:
                ai_response = await generate_ai_response(transcription)
                await websocket.send(ai_response)
        except Exception as e:
            print(f"Error processing audio: {e}")

# Main function to start WebSocket server


async def main():
    server = await websockets.serve(process_audio, "localhost", 5000)
    print("Running on localhost:5000")
    await server.wait_closed()

# Entry point
if __name__ == "__main__":
    asyncio.run(main())
