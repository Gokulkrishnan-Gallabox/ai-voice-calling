import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { OpenAIRealtimeVoice } from "@mastra/voice-openai-realtime";

/**
 * VoiceAgent - Manages individual voice agent sessions
 * Each socket connection gets its own VoiceAgent instance
 */
export class VoiceAgent {
  private agent: Agent;
  private voiceConnectionReady: boolean = false;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing required environment variable: OPENAI_API_KEY");
    }
    
    this.agent = new Agent({
      name: "gallabox-sales-agent",
      description: "AI-powered sales agent for Gallabox conversation-CRM platform",
      instructions: `You are a friendly, knowledgeable sales agent for Gallabox, a conversation-CRM platform built for businesses to engage customers on WhatsApp and convert conversations into revenue.

GOAL: Understand prospect's business needs, show how Gallabox solves their specific pain points, and guide them towards a decision (demo, trial, purchase).

KEY FEATURES TO HIGHLIGHT:
- AI chatbots + WhatsApp Flows (automated responses, lead qualification, FAQs 24/7)
- Shared team inbox (collaboration and no missed messages)
- Broadcast/Campaigns/Drip marketing on WhatsApp
- Integrations with Shopify, Razorpay, Zoho, HubSpot, Google Sheets and more
- Cost/time savings through automation
- Business outcomes: higher lead conversion, revenue growth, customer satisfaction, repeat sales

CONVERSATION FLOW:
1) Greet and build rapport
2) Ask about challenges in customer communication
3) Map their pain points to Gallabox solutions
4) Give concrete use cases (e.g. e-commerce abandoned cart reminders, appointment bookings)
5) Address objections (pricing, learning curve, integrations, reliability)
6) Propose next step (free trial, demo, or case studies)

DISCOVERY QUESTIONS:
- What pain points are you facing in customer chats or support?
- How many agents handle messages now and what is the expected message volume?
- What tools do you already use for CRM, payments, marketing?
- What is your timeline or budget?

CALL-TO-ACTION: "I can walk you through a demo specifically tailored to how your business works so you can see Gallabox in action before you commit."

TONE: Helpful, consultative, clear and concise, highlighting ROI and ease of use.`,
      model: openai("gpt-4o"),
      voice: new OpenAIRealtimeVoice({
        speaker: "alloy",
        apiKey: process.env.OPENAI_API_KEY!
      }),
    });
  }

  /**
   * Initialize the voice connection
   */
  async initialize(): Promise<void> {
    try {
      if (this.agent.voice && this.agent.voice.connect) {
        await this.agent.voice.connect();
      }
      
      this.voiceConnectionReady = true;
    } catch (err) {
      this.voiceConnectionReady = false;
      throw err;
    }
  }

  /**
   * Send audio data to the voice agent
   */
  async sendAudio(audioData: Int16Array): Promise<void> {
    if (this.voiceConnectionReady && this.agent.voice && this.agent.voice.send) {
      try {
        await this.agent.voice.send(audioData);
      } catch (err) {
        // Skip on error
      }
    }
  }

  /**
   * Make the voice agent speak text
   */
  async speak(text: string): Promise<void> {
    try {
      if (this.agent.voice && this.agent.voice.speak) {
        await this.agent.voice.speak(text);
      }
    } catch (err) {
      // Speak failed
    }
  }

  /**
   * Set up event listener for voice responses
   */
  onSpeaking(callback: (audio: any) => void): void {
    try {
      if (this.agent.voice && this.agent.voice.on) {
        this.agent.voice.on('speaking', async ({audio}) => {
          callback(audio);
        });
      }
    } catch (err) {
      // Skip on error
    }
  }

  /**
   * Close the voice connection
   */
  close(): void {
    try {
      if (this.agent.voice.close) {
        this.agent.voice.close();
      } 
    } catch (err) {
      // Close failed
    }
    this.voiceConnectionReady = false;
  }

  /**
   * Get the session ID for this voice agent
   */
  get id(): string {
    return this.sessionId;
  }

  /**
   * Check if the voice connection is ready
   */
  get isReady(): boolean {
    return this.voiceConnectionReady;
  }

  /**
   * Get the underlying Mastra agent (if needed for advanced usage)
   */
  get mastraAgent(): Agent {
    return this.agent;
  }
}
