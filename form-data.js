export class FormError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Parse a text-only form with a measured byte limit, including streamed bodies.
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<FormData>}
 */
export async function readForm(request, maxBytes = 64 * 1024) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new FormError('Form is too large.', 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  let form;
  try {
    form = await new Request(request, { body: new Blob(chunks) }).formData();
  } catch {
    throw new FormError('Send a valid form.');
  }
  for (const value of form.values()) {
    if (typeof value !== 'string') throw new FormError('File fields are not supported.');
  }
  return form;
}
