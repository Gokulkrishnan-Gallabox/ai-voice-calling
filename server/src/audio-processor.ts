/**
 * AudioProcessor - Audio processing utilities for voice agents
 */
export class AudioProcessor {
	// Correct sample rates based on Mastra documentation
	private static readonly MASTRA_SAMPLE_RATE = 24100; // 24.1kHz from Mastra docs
	private static readonly WEBRTC_SAMPLE_RATE = 48000; // 48kHz for WebRTC
	private static readonly UPSAMPLE_RATIO = 48000 / 24100; // 1.9917...

	/**
	 * Downsamples audio from 48kHz to 24.1kHz with anti-aliasing
	 * Improved version for better Mastra voice recognition
	 */
	static downsample48kHzTo24100Hz(audioBuffer: ArrayBuffer): ArrayBuffer {
		const sourceData = new Int16Array(audioBuffer);
		if (sourceData.length === 0) return audioBuffer;

		// Correct ratio: 48000/24100 = 1.9917
		const ratio = this.WEBRTC_SAMPLE_RATE / this.MASTRA_SAMPLE_RATE;
		const targetLength = Math.ceil(sourceData.length / ratio);
		const targetData = new Int16Array(targetLength);

		// High-quality downsampling with anti-aliasing filter
		for (let i = 0; i < targetLength; i++) {
			const sourceIndex = i * ratio;
			const index = Math.floor(sourceIndex);
			const fraction = sourceIndex - index;

			if (index < sourceData.length - 1) {
				// Get surrounding samples for anti-aliasing
				const sample1 = sourceData[Math.max(0, index - 1)];
				const sample2 = sourceData[index];
				const sample3 = sourceData[index + 1];
				const sample4 = sourceData[Math.min(sourceData.length - 1, index + 2)];
				
				// Simple 4-point low-pass filter to prevent aliasing
				const filtered = (sample1 + 2 * sample2 + 2 * sample3 + sample4) / 6;
				
				// Get next filtered sample for interpolation
				const nextIndex = Math.min(sourceData.length - 1, index + 1);
				const nextSample1 = sourceData[Math.max(0, nextIndex - 1)];
				const nextSample2 = sourceData[nextIndex];
				const nextSample3 = sourceData[Math.min(sourceData.length - 1, nextIndex + 1)];
				const nextSample4 = sourceData[Math.min(sourceData.length - 1, nextIndex + 2)];
				const nextFiltered = (nextSample1 + 2 * nextSample2 + 2 * nextSample3 + nextSample4) / 6;
				
				// Linear interpolation between filtered samples
				targetData[i] = Math.round(filtered + (nextFiltered - filtered) * fraction);
			} else if (index < sourceData.length) {
				targetData[i] = sourceData[index];
			} else {
				// Pad with last sample
				targetData[i] = sourceData[sourceData.length - 1];
			}
		}

		return targetData.buffer;
	}


	/**
	 * Upsamples audio from 24.1kHz to 48kHz (1.9917x upsampling)
	 * Improved interpolation for better audio quality
	 */
	static resample24100HzTo48kHz(audioBuffer: ArrayBuffer): ArrayBuffer {
		const sourceData = new Int16Array(audioBuffer);
		if (sourceData.length === 0) return audioBuffer;

		// Correct ratio: 48000/24100 = 1.9917...
		const ratio = this.UPSAMPLE_RATIO;
		const targetLength = Math.ceil(sourceData.length * ratio);
		const targetData = new Int16Array(targetLength);

		// High-quality interpolation for non-integer ratio
		for (let i = 0; i < targetLength; i++) {
			const sourceIndex = i / ratio;
			const index = Math.floor(sourceIndex);
			const fraction = sourceIndex - index;

			if (index < sourceData.length - 1) {
				// Simple linear interpolation to avoid overshoots that cause noise
				const sample1 = sourceData[index];
				const sample2 = sourceData[index + 1];
				
				// Linear interpolation
				targetData[i] = Math.round(sample1 + (sample2 - sample1) * fraction);
			} else if (index < sourceData.length) {
				targetData[i] = sourceData[index];
			} else {
				// Pad with last sample
				targetData[i] = sourceData[sourceData.length - 1];
			}
		}

		return targetData.buffer;
	}

	/**
	 * Combined processing pipeline for WebRTC input to Mastra
	 * Converts mono 48kHz to mono 24.1kHz (for Mastra voice agent)
	 */
	static processForMastra(mono48kHz: ArrayBuffer): ArrayBuffer {
		const downsampledAudio = this.downsample48kHzTo24100Hz(mono48kHz);
		return downsampledAudio;
	}

	/**
	 * Combined processing pipeline for Mastra output to WebRTC
	 * Converts mono 24.1kHz to mono 48kHz (for WebRTC output)
	 */
	static processFromMastra(mono24100Hz: ArrayBuffer): ArrayBuffer {
		const resampledAudio = this.resample24100HzTo48kHz(mono24100Hz);
		return resampledAudio;
	}

	/**
	 * Process audio into WebRTC-compatible frame sizes (480 samples = 960 bytes for 16-bit mono)
	 * Improved version that handles incomplete frames instead of dropping them
	 */
	static chunkAudioFrames(audioBuffer: ArrayBuffer): ArrayBuffer[] {
		const sourceData = new Int16Array(audioBuffer);
		const frameSize = 480; // 480 samples per frame (10ms @ 48kHz)
		const frames: ArrayBuffer[] = [];
		
		for (let i = 0; i < sourceData.length; i += frameSize) {
			const frameLength = Math.min(frameSize, sourceData.length - i);
			const frameData = new Int16Array(frameSize);
			
			// Copy available samples
			frameData.set(sourceData.subarray(i, i + frameLength));
			
			// Pad incomplete frames instead of dropping them
			if (frameLength < frameSize) {
				// Use fade-out to avoid clicks on incomplete frames
				const lastSample = frameLength > 0 ? frameData[frameLength - 1] : 0;
				for (let j = frameLength; j < frameSize; j++) {
					// Fade to zero over remaining samples
					const fadeRatio = Math.max(0, 1 - (j - frameLength) / (frameSize - frameLength));
					frameData[j] = Math.round(lastSample * fadeRatio);
				}
			}
			
			frames.push(frameData.buffer);
		}
		
		return frames;
	}

	/**
	 * Combine small input frames into optimal chunks for Mastra processing
	 * Reduces processing overhead and improves voice recognition
	 */
	static combineInputFrames(frames: ArrayBuffer[], targetSizeMs: number = 20): ArrayBuffer {
		if (frames.length === 0) {
			return new ArrayBuffer(0);
		}
		
		// Calculate target size in samples (20ms @ 24.1kHz = ~482 samples)
		const targetSamples = Math.floor((this.MASTRA_SAMPLE_RATE * targetSizeMs) / 1000);
		
		// Combine frames until we reach target size
		let totalSamples = 0;
		const framesToCombine: Int16Array[] = [];
		
		for (const frame of frames) {
			const samples = new Int16Array(frame);
			framesToCombine.push(samples);
			totalSamples += samples.length;
			
			if (totalSamples >= targetSamples) {
				break;
			}
		}
		
		// Create combined buffer
		const combinedData = new Int16Array(Math.min(totalSamples, targetSamples));
		let offset = 0;
		
		for (const frame of framesToCombine) {
			const copyLength = Math.min(frame.length, combinedData.length - offset);
			combinedData.set(frame.subarray(0, copyLength), offset);
			offset += copyLength;
			
			if (offset >= combinedData.length) {
				break;
			}
		}
		
		return combinedData.buffer;
	}

}
