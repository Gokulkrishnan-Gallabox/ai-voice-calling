/**
 * Audio processing utilities for voice agent
 */
import { AudioProcessor } from './audio-processor';

/**
 * Ensures buffer has even byte length for 16-bit PCM
 */
export function ensureEvenBytes(buf: ArrayBuffer): ArrayBuffer {
	if (buf.byteLength % 2 !== 0) {
		return buf.slice(0, buf.byteLength - 1);
	}
	return buf;
}


/**
 * WebRTC to Mastra: Convert mono 48kHz to mono 24.1kHz (correct ratio)
 * Now uses proper 24.1kHz target rate for better voice recognition
 */
export function processWebRTCToMastra(input48kMono: ArrayBuffer, speexResampler?: any): ArrayBuffer {
	if (input48kMono.byteLength === 0) return input48kMono;

	// Ensure even byte length for 16-bit samples
	const evenInput = ensureEvenBytes(input48kMono);

	// Use improved downsampler (48kHz -> 24.1kHz with anti-aliasing)
	return AudioProcessor.processForMastra(evenInput);
}

/**
 * Mastra to WebRTC: Convert mono 24.1kHz to mono 48kHz (correct ratio)
 * This is the critical conversion that fixes voice breaks
 */
export function processMastraToWebRTC(input24100Mono: ArrayBuffer, speexResampler?: any): ArrayBuffer {
	if (input24100Mono.byteLength === 0) return input24100Mono;

	// Ensure even byte length for 16-bit samples
	const evenInput = ensureEvenBytes(input24100Mono);

	// Use improved upsampler (24.1kHz -> 48kHz with correct ratio)
	return AudioProcessor.processFromMastra(evenInput);
}

/**
 * Convert different audio input types to standardized ArrayBuffer
 * Enhanced version with better error handling and format support
 */
export function normalizeAudioInput(audio: any): ArrayBuffer | null {
	try {
		// Handle Buffer (most common from Mastra - Node.js Buffer)
		if (Buffer.isBuffer(audio)) {
			// Direct buffer conversion for better performance
			const slice = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
			return slice instanceof ArrayBuffer ? slice : null;
		}
		
		// Handle Int16Array (alternative format from Mastra)
		if (audio instanceof Int16Array) {
			const slice = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
			return slice instanceof ArrayBuffer ? slice : null;
		}
		
		// Handle ArrayBuffer (already correct format)
		if (audio instanceof ArrayBuffer) {
			return audio;
		}
		
		// Handle Uint8Array
		if (audio instanceof Uint8Array) {
			const slice = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
			return slice instanceof ArrayBuffer ? slice : null;
		}
		
		// Handle string (base64 encoded audio)
		if (typeof audio === 'string') {
			const buffer = Buffer.from(audio, 'base64');
			const slice = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
			return slice instanceof ArrayBuffer ? slice : null;
		}
		
		// Handle other typed arrays
		if (audio && typeof audio.buffer !== 'undefined' && audio.buffer instanceof ArrayBuffer) {
			const slice = audio.buffer.slice(audio.byteOffset || 0, (audio.byteOffset || 0) + audio.byteLength);
			return slice instanceof ArrayBuffer ? slice : null;
		}
		
		// Fallback: try to convert from array-like objects
		if (audio && typeof audio.length === 'number' && audio.length > 0) {
			const arrayBuffer = new ArrayBuffer(audio.length * 2); // Assume 16-bit samples
			const view = new Int16Array(arrayBuffer);
			for (let i = 0; i < audio.length; i++) {
				view[i] = audio[i] || 0;
			}
			return arrayBuffer;
		}
		
		return null;
	} catch (err) {
		return null;
	}
}

/**
 * Convert ArrayBuffer to Int16Array for Mastra voice agent
 */
export function bufferToInt16Array(buffer: ArrayBuffer): Int16Array {
	return new Int16Array(buffer);
}


/**
 * Process incoming WebRTC audio for Mastra (48kHz mono -> 24.1kHz mono)
 * Enhanced with validation, error handling, and stream continuity
 */
export function processInputForMastra(webrtcBuffer: ArrayBuffer): Int16Array {
	try {
		// Validate input
		if (!webrtcBuffer || webrtcBuffer.byteLength === 0) {
			return new Int16Array(0);
		}
		
		// Ensure minimum viable audio size (at least 2 samples = 4 bytes)
		if (webrtcBuffer.byteLength < 4) {
			return new Int16Array(0);
		}
		
		// Process with correct sample rate conversion
		const processed24100 = processWebRTCToMastra(webrtcBuffer);
		const result = bufferToInt16Array(processed24100);
		
		// Validate output quality
		if (result.length === 0) {
			// Return minimal silence to maintain stream timing
			return new Int16Array(241); // ~10ms of silence at 24.1kHz
		}
		
		// Check for clipping and normalize if needed
		const maxValue = Math.max(...Array.from(result).map(Math.abs));
		if (maxValue > 32767 * 0.95) {
			// Gentle limiting to prevent clipping
			const limitRatio = (32767 * 0.95) / maxValue;
			for (let i = 0; i < result.length; i++) {
				result[i] = Math.round(result[i] * limitRatio);
			}
		}
		
		return result;
	} catch (err) {
		// Return silence instead of nothing to maintain stream continuity
		// This prevents Mastra from losing sync
		return new Int16Array(241); // ~10ms of silence at 24.1kHz
	}
}

/**
 * Process Mastra output for WebRTC (24.1kHz mono -> 48kHz mono frames)
 * Enhanced with error handling and validation
 */
export function processOutputFromMastra(mastraAudio: any): ArrayBuffer[] {
	try {
		// Validate input
		if (!mastraAudio) {
			return [];
		}
		
		// Normalize to ArrayBuffer
		const audioBuffer = normalizeAudioInput(mastraAudio);
		if (!audioBuffer || audioBuffer.byteLength === 0) {
			return [];
		}
		
		// Ensure minimum size for processing
		if (audioBuffer.byteLength < 2) {
			return [];
		}
		
		// Process with correct sample rate conversion
		const processed48k = processMastraToWebRTC(audioBuffer);
		
		// Chunk into WebRTC frames with improved handling
		return AudioProcessor.chunkAudioFrames(processed48k);
	} catch (err) {
		// Return empty array on error to maintain stream continuity
		return [];
	}
}

/**
 * Create WebRTC audio data object from samples
 * Enhanced with validation and proper formatting
 */
export function createWebRTCAudioData(samples: Int16Array, sampleRate: number = 48000): any {
	// Validate input
	if (!samples || samples.length === 0) {
		// Return silent frame to maintain timing
		const silentSamples = new Int16Array(480); // 10ms of silence
		return {
			samples: silentSamples,
			sampleRate: sampleRate,
			bitsPerSample: 16,
			channelCount: 1,
			numberOfFrames: silentSamples.length
		};
	}
	
	return {
		samples: samples,
		sampleRate: sampleRate,
		bitsPerSample: 16,
		channelCount: 1,
		numberOfFrames: samples.length
	};
}
