import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import wrtc, { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from "@koush/wrtc";
import { Readable } from "stream";

import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { OpenAIRealtimeVoice } from "@mastra/voice-openai-realtime";

// --- Config ---
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const SYSTEM_MESSAGE =
  "You are an AI receptionist for Barts Automotive. Your job is to politely engage with the client and obtain their name, availability, and service/work required. Ask one question at a time. Do not ask for other contact information, and do not check availability, assume we are free. Ensure the conversation remains friendly and professional.";

// --- Routes ---
app.get("/", (_req: Request, res: Response) => {
  res.send("🎙️ Voice Agent WebRTC Server running");
});

// --- Socket.IO Signaling ---
io.on("connection", async (socket) => {
  console.log("🔗 Client connected:", socket.id);

  // Setup WebRTC peer connection
  const pc = new RTCPeerConnection();

  // --- AI Agent ---
  const voiceAgent = new Agent({
    name: "Voice Agent",
    instructions: SYSTEM_MESSAGE,
    model: openai("gpt-4o"),
    voice: new OpenAIRealtimeVoice({ apiKey: OPENAI_API_KEY }),
  });

  // --- Incoming audio from Browser ---
  pc.ontrack = (event: any) => {
    const [track] = event.streams[0].getAudioTracks();
    if (!track) return;


    const { RTCAudioSink } = wrtc.nonstandard;
    const sink = new RTCAudioSink(track);

    const audioStream = new Readable({ read() {} });

    sink.ondata = (data) => {
      // Convert Float32 samples → Buffer
      console.log("🎤 Sending audio to AI", data.samples.buffer);
      audioStream.push(Buffer.from(data.samples.buffer));
    };
    sink.onclose = () => audioStream.push(null);

    // Pipe audio to AI
    (async () => {
      for await (const chunk of audioStream) {
        console.log("🎤 Sending audio to AI", chunk);
        await voiceAgent.voice.send(chunk);
      }
    })();
  };

  // --- Outgoing audio from AI ---
  const { RTCAudioSource } = wrtc.nonstandard;
  const audioSource = new RTCAudioSource();
  const outTrack = audioSource.createTrack();
  pc.addTrack(outTrack);

  let isCallActive = true;

  voiceAgent.voice.on("speaker", (pcmBuffer: any) => {
    if (!isCallActive) return;

    console.log("🎤 Received audio from AI", pcmBuffer);
    
    // Convert AI PCM (Int16 16kHz mono) → WebRTC
    const samples = new Int16Array(pcmBuffer);
    audioSource.onData({
      samples,
      sampleRate: 16000,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: samples.length,
    });
  });

  // --- Signaling exchange ---
  socket.on("offer", async (offer) => {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", pc.localDescription);
    isCallActive = true;
    console.log("📞 Call started");
  });

  socket.on("ice-candidate", async (candidate) => {
    if (!candidate) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("❌ Failed to add ICE candidate", err);
    }
  });

  // --- Call control signals ---
  socket.on("end-call", () => {
    console.log("📞 Call ended by client");
    isCallActive = false;
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    isCallActive = false;
    pc.close();
  });

  // --- Kick off conversation ---
  await voiceAgent.voice.speak("How can I help you today?");
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Voice Agent Server running on http://localhost:${PORT}`);
});
