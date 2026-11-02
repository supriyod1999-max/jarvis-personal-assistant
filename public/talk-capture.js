// A muted audio worklet sends bounded 20 ms PCM blocks to the conversation controller.
class TalkCapture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.sum = 0; this.count = 0; this.position = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const value of input) {
      this.sum += value; this.count++; this.position += 16000;
      if (this.position >= sampleRate) {
        this.position -= sampleRate; this.samples.push(this.sum / this.count); this.sum = 0; this.count = 0;
        if (this.samples.length === 320) {
          const pcm = new Float32Array(this.samples); this.samples = [];
          this.port.postMessage(pcm, [pcm.buffer]);
        }
      }
    }
    return true;
  }
}
registerProcessor('talk-capture', TalkCapture);
