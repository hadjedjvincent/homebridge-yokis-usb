const YOKIS_PACKET_SIZE = 64;

/**
 * Wait for a specific delay
 *
 * @param ms milliseconds to wait
 * @returns Promise
 */
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Trim the ending zero from a Buffer object
 *
 * @param input Buffer to trim
 * @returns Buffer
 */
export const trimBuffer = (input: Buffer) => {
    while (input.lastIndexOf(Buffer.from([0x0])) != -1 && input.lastIndexOf(Buffer.from([0x0])) > 0) {
        input = input.slice(0, input.lastIndexOf(Buffer.from([0x0])));
    }

    return input;
}

/**
 * Check if a string can be parsed to JSON, used to check when buffer is full with a valid JSON object
 *
 * @param jsonResult
 * @returns bool
 */
export const canBeParsedAsJSON = (jsonResult: string) => {
    let parseResult = false;
    try {
        JSON.parse(jsonResult);
        parseResult = true;
    } catch (error) {
        parseResult = false;
    }

    return parseResult;
}

/**
 * If packet is too large, return array of Buffer
 *
 * @param buffer
 * @param chunkSize
 * @returns Buffer[]
 */
export const getChunkedBuffer = (buffer: Buffer, chunkSize: number) => {
    const regexChunk = new RegExp(`.{1,${chunkSize}}`, 'g');
    const bufferMatches = buffer.toString().match(regexChunk) ?? [];

    return bufferMatches.map(function (chunk, index) {
        if (index > 0) {
            return Buffer.concat([Buffer.from([0x07]), Buffer.from(chunk)]);
        }
        return Buffer.from(chunk);
    });
}

/**
 * Calculate the footer value (like a crc) for the buffer
 * @param input
 * @returns number
 */
export const crcCalculation = (input: Buffer) => {
    const buffer = Buffer.alloc((input.length < 64 ? YOKIS_PACKET_SIZE : input.length));
    // Remove first byte
    input.copy(buffer, 0, 1, input.length);

    let chk = 0;
    for (let i = 0; i < buffer.length - 1; i++) {
        chk = (chk ^ (buffer[i] & 255));
    }

    return chk;
}
