import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import axios from "axios";
import path from "path";
import { config } from "dotenv";

// Load environment variables
config();

// Session management
import { CallSession } from './call-session';

// --- Express & Socket.IO Setup ---
const app = express();
app.use(express.json()); // Parse JSON bodies

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- Call Session Store ---
const callSessions = new Map<string, CallSession>();

// --- WhatsApp Configuration ---
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v18.0";

if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_VERIFY_TOKEN) {
  throw new Error("Missing required WhatsApp environment variables: WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN");
}

// --- Helper Functions ---

/**
 * Create a call session for WhatsApp call
 */
function createWhatsAppCallSession(callId: string): CallSession {
  const session = new CallSession(callId, null); // No socket for WhatsApp calls
  callSessions.set(callId, session);
  return session;
}

/**
 * Post SDP answer back to WhatsApp/Facebook Graph API
 */
async function postWhatsAppAnswer(phoneNumberId: string, callId: string, answerSdp: string): Promise<void> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/calls`;
    
    const payload = {
      messaging_product: "whatsapp",
      call_id: callId,
      action: "pre_accept",
      session: {
        sdp_type: "answer",
        sdp: answerSdp
      }
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    throw error;
  }
}

// --- Routes ---
app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// WhatsApp webhook verification (required by Facebook)
app.get("/whatsapp/meta-tech-partner/accounts/668cfacf05cdeae70cb8db06/channels/67a9735ff774dcbc7fa7e3f1/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp webhook endpoint to receive call offers
app.post("/whatsapp/meta-tech-partner/accounts/668cfacf05cdeae70cb8db06/channels/67a9735ff774dcbc7fa7e3f1/webhook", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    
    // Acknowledge receipt immediately
    res.status(200).send("OK");

    // Process WhatsApp webhook data
    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === "calls" && change.value?.calls) {
            for (const call of change.value.calls) {
              if (call.event === "connect" && call.session?.sdp) {
                await handleWhatsAppCallOffer(
                  change.value.metadata.phone_number_id,
                  call.id,
                  call.session.sdp,
                  call.from,
                  call.to
                );
              }
            }
          }
        }
      }
    }
  } catch (error) {
    // Don't send error response - webhook is already acknowledged
  }
});

/**
 * Handle WhatsApp call offer and generate answer
 */
async function handleWhatsAppCallOffer(
  phoneNumberId: string,
  callId: string, 
  offerSdp: string,
  fromNumber: string,
  toNumber: string
): Promise<void> {
  try {
    // Create call session for this WhatsApp call
    const session = createWhatsAppCallSession(callId);

    // Set remote description from WhatsApp offer
    const offer = { type: "offer" as RTCSdpType, sdp: offerSdp };
    await session.setRemoteDescription(offer);

    // Set up audio sink now that we have remote tracks
    session.setupAudioSink();

    // Create answer (server responds to WhatsApp offer)
    const answer = await session.createAnswer();

    if (!answer.sdp) {
      throw new Error("Failed to generate SDP answer");
    }

    // Post the answer back to WhatsApp
    await postWhatsAppAnswer(phoneNumberId, callId, answer.sdp);

    // Initialize voice agent for this session
    await session.initializeVoice();

  } catch (error) {
    
    // Clean up session on error
    const session = callSessions.get(callId);
    if (session) {
      session.cleanup();
      callSessions.delete(callId);
    }
  }
}

// --- Helper function to create call session ---
function createCallSession(socket: any): CallSession {
  const session = new CallSession(socket.id, socket);
  callSessions.set(socket.id, session);
  return session;
}

// --- Socket.IO Signaling ---
io.on("connection", (socket) => {
  socket.emit("connected", { message: "Connected to voice agent server" });

  // Handle offer from client (client creates offer)
  socket.on("call-offer", async ({ sdp }) => {
    try {
      const session = createCallSession(socket);

      // Set remote description from client offer
      const offer = { type: "offer" as RTCSdpType, sdp };
      await session.setRemoteDescription(offer);

      // Set up audio sink now that we have remote tracks
      session.setupAudioSink();

      // Create answer (server responds to client offer)
      const answer = await session.createAnswer();

      socket.emit("call-answer", {
        sdp_type: "answer",
        sdp: answer.sdp
      });

      // Initialize voice agent for this session once connection is established
      await session.initializeVoice();

    } catch (err) {
      const session = callSessions.get(socket.id);
      if (session) {
        session.cleanup();
        callSessions.delete(socket.id);
      }
    }
  });


  // Handle ICE candidates from client
  socket.on("ice-candidate", async ({ candidate, sdpMLineIndex, sdpMid }) => {
    try {
      const session = callSessions.get(socket.id);
      if (session) {
        await session.addIceCandidate({
          candidate,
          sdpMLineIndex,
          sdpMid
        });
      }
    } catch (err) {
      // Skip on error
    }
  });

  // Handle call termination
  socket.on("terminate", () => {
    const session = callSessions.get(socket.id);
    if (session) {
      session.cleanup();
    }
    callSessions.delete(socket.id);
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    const session = callSessions.get(socket.id);
    if (session) {
      session.cleanup();
    }
    callSessions.delete(socket.id);
  });

  // Clean up function for when connections fail
  const cleanupSession = () => {
    const session = callSessions.get(socket.id);
    if (session) {
      session.cleanup();
      callSessions.delete(socket.id);
    }
  };

  // Set cleanup timeout for failed connections
  setTimeout(() => {
    const session = callSessions.get(socket.id);
    if (session && !session.active) {
      cleanupSession();
    }
  }, 30000); // 30 second timeout for inactive sessions

  // Handle socket errors
  socket.on("error", (err) => {
    // Skip on error
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  // Server started silently
});