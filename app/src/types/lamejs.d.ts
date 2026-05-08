declare module '@breezystack/lamejs' {
  export class Mp3Encoder {
    constructor(channels: 1 | 2, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Int32Array;
    flush(): Int32Array;
  }
}
