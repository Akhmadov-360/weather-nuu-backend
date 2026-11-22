/** Vectors are stored as Float32Array and, in files, as the raw bytes of it (4 bytes a number, no text parsing). */

export function normalizeVector(vector: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!;
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) throw new Error("Cannot normalize a zero vector");
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / norm;
  return out;
}

/** Cosine similarity (4) of two vectors that are already normalized: the dot product. */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Vector sizes differ: ${a.length} and ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

export function vectorFromBuffer(buffer: Buffer, dim: number): Float32Array {
  if (buffer.length !== dim * 4) throw new Error(`Expected ${dim * 4} bytes for ${dim} numbers, got ${buffer.length}`);
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}
