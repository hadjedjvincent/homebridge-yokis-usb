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
 * @returns
 */
export const trimBuffer = (input: Buffer) => {
    while (input.lastIndexOf(Buffer.from([0x0])) != -1 && input.lastIndexOf(Buffer.from([0x0])) > 0) {
        input = input.slice(0, input.lastIndexOf(Buffer.from([0x0])));
    }

    return input;
}

/**
 * Convert hex to string (may be used later, for CRC)
 *
 * @param byteArray
 * @returns
 */
export const toHexString = (byteArray: any) => {
    return Array.from(byteArray, function (byte: any) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
}

/**
 * Check if a string can be parsed to JSON, used to check when buffer is full with a valid JSON object
 *
 * @param jsonResult
 * @returns
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
 * @returns
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
