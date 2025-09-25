import { RTCPeerConnection, RTCSessionDescription } from "@roamhq/wrtc";
const { RTCAudioSink, RTCAudioSource } = require("@roamhq/wrtc").nonstandard;

import { VoiceAgent } from './voice-agent';
import { 
  processInputForMastra,
  processOutputFromMastra,
  createWebRTCAudioData,
} from './audio-utils';

/**
 * CallSession - Manages a complete WebRTC call session with voice processing
 * Encapsulates WebRTC connection, audio processing, and voice agent
 */
export class CallSession {
  private sessionId: string;
  private socket: any;
  private pc: RTCPeerConnection;
  private audioSink: any;
  private audioSource: any;
  private outgoingTrack: any;
  private voiceAgent: VoiceAgent;
  private isActive: boolean = false;
  
  // Audio buffering for smooth playback (output)
  private audioBuffer: ArrayBuffer[] = [];
  private isProcessingAudio: boolean = false;
  private audioProcessingTimer: NodeJS.Timeout | null = null;
  
  // Input audio buffering for better Mastra processing
  private inputAudioBuffer: ArrayBuffer[] = [];
  private isProcessingInput: boolean = false;
  private inputProcessingTimer: NodeJS.Timeout | null = null;
  private lastInputTime: number = 0;

  constructor(sessionId: string, socket: any) {
    this.sessionId = sessionId;
    this.socket = socket;
    
    // Configure Google STUN servers for NAT traversal
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
    
    this.pc = new RTCPeerConnection({ iceServers });
    this.voiceAgent = new VoiceAgent(sessionId);
    this.setupWebRTC();
    this.setupAudioProcessing();
    this.setupConnectionHandlers();
  }

  /**
   * Set up WebRTC peer connection
   */
  private setupWebRTC(): void {
    // Create audio source for outgoing audio
    this.audioSource = new RTCAudioSource();
    this.outgoingTrack = this.audioSource.createTrack();
    
    // Add the audio track to peer connection - this is CRITICAL for sendrecv SDP
    this.pc.addTrack(this.outgoingTrack);
  }

  /**
   * Set up audio processing pipeline
   */
  private setupAudioProcessing(): void {
    // Handle incoming audio from user

    // Listen for voice agent responses with improved buffering
    this.voiceAgent.onSpeaking((audio) => {
      try {
        // Process voice agent audio (24.1kHz mono) for WebRTC (48kHz mono frames)
        const audioFrames = processOutputFromMastra(audio);
        
        if (audioFrames.length > 0) {
          // Add frames to buffer for smooth playback
          this.audioBuffer.push(...audioFrames);
          
          // Start processing if not already running
          if (!this.isProcessingAudio) {
            this.startAudioProcessing();
          }
        }
      } catch (err) {
        // Skip on processing error but maintain stream continuity
      }
    });
  }

  /**
   * Set up audio sink after remote description is established
   */
  setupAudioSink(): void {
    // Find the audio transceiver to get the receiver track
    const audioTransceiver = this.pc.getTransceivers().find(t => 
      t.receiver.track && t.receiver.track.kind === 'audio'
    );
    
    if (audioTransceiver && audioTransceiver.receiver.track) {
      // Set up audio sink for incoming audio
      this.audioSink = new RTCAudioSink(audioTransceiver.receiver.track);
      
      // Handle incoming audio from user with improved buffering
      const onAudioData = async ({ samples: { buffer } }: any) => {
        try {
          const audioBuffer = buffer as ArrayBuffer;
          
          // Only process audio if voice connection is ready
          if (this.voiceAgent.isReady && audioBuffer && audioBuffer.byteLength > 0) {
            // Add to input buffer for batched processing
            this.inputAudioBuffer.push(audioBuffer);
            this.lastInputTime = Date.now();
            
            // Start input processing if not already running
            if (!this.isProcessingInput) {
              this.startInputProcessing();
            }
          }
        } catch (err) {
          // Skip on error but maintain stream
        }
      };

      // Start listening to incoming audio
      this.audioSink.addEventListener('data', onAudioData);
    }
  }

  /**
   * Set up WebRTC connection event handlers
   */
  private setupConnectionHandlers(): void {
    // Connection state handling
    this.pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(this.pc.connectionState)) {
        this.cleanup();
      }
    };

    // ICE candidate handling
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit("ice-candidate", {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid
        });
      }
      // For WhatsApp calls (socket is null), ICE candidates are handled differently
      // They're typically exchanged through the WhatsApp infrastructure
    };
  }

  /**
   * Create WebRTC offer (server-initiated call)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.isActive = true;
    return offer;
  }

  /**
   * Create WebRTC answer (client-initiated call)
   */
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.isActive = true;
    return answer;
  }

  /**
   * Set remote description
   */
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(description));
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(candidate: any): Promise<void> {
    if (this.pc.remoteDescription) {
      await this.pc.addIceCandidate(candidate);
    }
  }


  /**
   * Initialize voice agent and start session
   */
  async initializeVoice(): Promise<void> {
    try {
      await this.voiceAgent.initialize();
      await this.voiceAgent.speak('Hello! I am your Gallabox Sales Agent. How can I help you today?');
    } catch (err) {
      // Initialization failed
    }
  }

  /**
   * Start buffered audio processing for smooth playback
   */
  private startAudioProcessing(): void {
    if (this.isProcessingAudio) {
      return;
    }
    
    this.isProcessingAudio = true;
    this.processNextFrame();
  }

  /**
   * Process audio frames with proper timing
   */
  private processNextFrame(): void {
    if (!this.isProcessingAudio || !this.isActive) {
      this.isProcessingAudio = false;
      return;
    }
    
    try {
      if (this.audioBuffer.length > 0) {
        const frameBuffer = this.audioBuffer.shift();
        if (frameBuffer) {
          const audioSamples = new Int16Array(frameBuffer);
          
        // Accept any frame size and normalize to 480 samples
        let finalSamples: Int16Array;
        
        if (audioSamples.length === 480) {
          finalSamples = audioSamples;
        } else if (audioSamples.length < 480) {
          // Pad shorter frames with silence only
          finalSamples = new Int16Array(480);
          finalSamples.set(audioSamples);
          // Remaining samples are already zero (silence) by default
        } else {
          // Truncate longer frames
          finalSamples = audioSamples.subarray(0, 480);
        }
        
        // No fade-out processing to avoid introducing artifacts
          
          // Create audio data object for RTCAudioSource
          const audioData = createWebRTCAudioData(finalSamples, 48000);
          
          // Send to WebRTC output
          this.audioSource.onData(audioData);
        }
        
        // Schedule next frame (10ms = 480 samples @ 48kHz)
        this.audioProcessingTimer = setTimeout(() => this.processNextFrame(), 10);
      } else {
        // Simple stop - no additional frames to avoid introducing noise
        this.isProcessingAudio = false;
      }
    } catch (err) {
      // Continue processing even if one frame fails
      this.audioProcessingTimer = setTimeout(() => this.processNextFrame(), 10);
    }
  }

  /**
   * Start input audio processing with optimal batching
   */
  private startInputProcessing(): void {
    if (this.isProcessingInput) {
      return;
    }
    
    this.isProcessingInput = true;
    this.processInputBatch();
  }

  /**
   * Process input audio in optimized batches for better Mastra recognition
   */
  private processInputBatch(): void {
    if (!this.isProcessingInput || !this.isActive) {
      this.isProcessingInput = false;
      return;
    }
    
    try {
      const now = Date.now();
      const timeSinceLastInput = now - this.lastInputTime;
      
      // Process if we have enough audio or if it's been too long since last input
      const shouldProcess = this.inputAudioBuffer.length >= 3 || 
                           (this.inputAudioBuffer.length > 0 && timeSinceLastInput > 50);
      
      if (shouldProcess && this.inputAudioBuffer.length > 0) {
        // Combine multiple frames for better processing efficiency
        const combinedBuffer = this.combineInputFrames();
        
        if (combinedBuffer.byteLength > 0) {
          try {
            // Process with enhanced error handling
            const processedAudio = processInputForMastra(combinedBuffer);
            
            if (processedAudio.length > 0) {
              // Send to Mastra voice agent
              this.voiceAgent.sendAudio(processedAudio);
            }
          } catch (err) {
            // Continue processing even if one batch fails
          }
        }
        
        // Clear processed frames
        this.inputAudioBuffer = [];
      }
      
      // Schedule next processing cycle
      this.inputProcessingTimer = setTimeout(() => this.processInputBatch(), 20);
    } catch (err) {
      // Ensure processing continues even on errors
      this.inputProcessingTimer = setTimeout(() => this.processInputBatch(), 20);
    }
  }

  /**
   * Combine input frames into optimal chunks for Mastra
   */
  private combineInputFrames(): ArrayBuffer {
    if (this.inputAudioBuffer.length === 0) {
      return new ArrayBuffer(0);
    }
    
    try {
      // Calculate total size
      const totalBytes = this.inputAudioBuffer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
      
      if (totalBytes === 0) {
        return new ArrayBuffer(0);
      }
      
      // Create combined buffer
      const combinedBuffer = new ArrayBuffer(totalBytes);
      const combinedView = new Uint8Array(combinedBuffer);
      
      let offset = 0;
      for (const buffer of this.inputAudioBuffer) {
        const view = new Uint8Array(buffer);
        combinedView.set(view, offset);
        offset += buffer.byteLength;
      }
      
      return combinedBuffer;
    } catch (err) {
      // Return first buffer if combination fails
      return this.inputAudioBuffer[0] || new ArrayBuffer(0);
    }
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    this.isActive = false;
    this.isProcessingAudio = false;
    this.isProcessingInput = false;
    
    // Clear all audio buffers and timers
    this.audioBuffer = [];
    this.inputAudioBuffer = [];
    
    if (this.audioProcessingTimer) {
      clearTimeout(this.audioProcessingTimer);
      this.audioProcessingTimer = null;
    }
    
    if (this.inputProcessingTimer) {
      clearTimeout(this.inputProcessingTimer);
      this.inputProcessingTimer = null;
    }

    // Stop audio components
    if (this.audioSink) {
      this.audioSink.stop();
    }
    if (this.outgoingTrack) {
      this.outgoingTrack.stop();
    }

    // Close voice agent
    this.voiceAgent.close();

    // Close peer connection
    this.pc.close();
  }

  /**
   * Get session ID
   */
  get id(): string {
    return this.sessionId;
  }

  /**
   * Check if session is active
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Get WebRTC connection state
   */
  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  /**
   * Get voice agent instance
   */
  get voice(): VoiceAgent {
    return this.voiceAgent;
  }
}
