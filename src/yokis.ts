import * as usb from 'usb';
import os from 'os';
import AsyncLock from 'async-lock';
import { Device } from 'usb/dist/usb'
import { InEndpoint } from 'usb/dist/usb/endpoint';
import { OutEndpoint } from 'usb/dist/usb/endpoint';
import { Interface } from 'usb/dist/usb/interface';
import { delay } from './utils';
import { trimBuffer } from './utils';
import { getChunkedBuffer } from './utils';
import { canBeParsedAsJSON } from './utils';
import { Logger } from 'homebridge';
import { crcCalculation } from './utils';

const TIMEOUT = 500;
const YOKIS_VENDOR_ID = 0x1072;
const YOKIS_PRODUCT_ID = 0x0100;

const YOKIS_PACKET_SIZE = 64;
// INTERRUPT OUT - 64 bytes
const YOKIS_COMMAND_ENDPOINT = 0x01;
// INTERRUPT IN - 64 bytes
const YOKIS_INTERRUPT_ENDPOINT = 0x81;

const YOKIS_SERVER_XML_SEPARATOR = Buffer.from([0x0, 0x0, 0x0, 0x1, 0x0, 0x1, 0x0]);
// const YOKIS_COMMAND_XML_SEPARATOR = Buffer.from([0x0, 0x0, 0x1, 0x0, 0x1, 0x0]);
const YOKIS_NEXT_COMMAND_XML_SEPARATOR = Buffer.from([0x0, 0x0, 0x1, 0x0, 0x0, 0x0]);
const YOKIS_NEXT_BUFFER_HEADER = Buffer.from([0x18, 0x55, 0x12, 0x07, 0x18, 0x0, 0x0]);
// const YOKIS_DATAB_XML_SEPARATOR = Buffer.from([0x0, 0x0, 0x0, 0x0, 0x1, 0x0, 0x1, 0x0]);
// const YOKIS_NEXT_DATAB_XML_SEPARATOR = Buffer.from([0x0, 0x0, 0x0, 0x0, 0x1, 0x0, 0x0, 0x0]);

export class Yokis {
    // Homebridge logger
    log: Logger;
    // Lock
    lock: AsyncLock;
    // USB Device
    device!: Device | undefined;
    // USB Interface
    interface!: Interface;
    // USB Endpoint
    commandEp!: OutEndpoint;
    // USB Endpoint
    interruptEp!: InEndpoint;
    hasDetachedKernelDriver = false;

    /**
     * Constructor
     * @returns void
     */
    constructor(log: Logger) {
        this.log = log;
        this.lock = new AsyncLock();
    }

    /**
     * Lookup and open USB device
     * @returns void
     */
    async initUsbDevice() {
        this.log.debug('Try to find USB device => ' + YOKIS_VENDOR_ID + ':' + YOKIS_PRODUCT_ID);
        this.device = usb.findByIds(YOKIS_VENDOR_ID, YOKIS_PRODUCT_ID);
        if (!this.device) {
            throw new Error('Unable to find Yokis USB/Yokey');
        }
        this.log.debug('Trying to open USB device');
        this.device.open();

        this.interface = this.device.interface(0);
        if (!this.interface) {
            throw new Error('Interface not found on Yokis Device!');
        }
        // Force detach kernel driver if needed
        if (os.platform() !== 'win32' && this.interface.isKernelDriverActive()) {
            this.log.debug('Detach kernel driver');
            this.interface.detachKernelDriver();
        }

        if (os.platform() !== 'darwin') {
            this.log.debug('Claiming interfaces');
            this.interface.claim();
        }

        this.commandEp = <OutEndpoint>this.interface.endpoints.find(e => e.address === YOKIS_COMMAND_ENDPOINT);
        this.interruptEp = <InEndpoint>this.interface.endpoints.find(e => e.address === YOKIS_INTERRUPT_ENDPOINT);
    }

    /**
     * Init & unlock (if needed) Yokis key
     * @returns object
     */
    async init() {
        this.log.info('Try to retrieve Yokis USB key firmware & unlock');
        let firmwareInfos;
        try {
            firmwareInfos = await this.getVersion();
        } catch (error: any) {
            if (error.message == 'LIBUSB_TRANSFER_TIMED_OUT') {
                this.device?.reset((resetError) => {
                    if (resetError !== undefined) {
                        throw resetError;
                    } else {
                        this.log.error('Unable to communicate with Yokis USB key, forcing it to reset, waiting 25s');
                    }
                });

                // Wait 25s after reset
                await delay(25000);

                throw new Error('LIBUSB_TRANSFER_TIMED_OUT - Unable to communicate with Yokis USB key, device has been reset');
            }
        }

        this.log.info('Firmware: ', firmwareInfos);
        if (firmwareInfos && firmwareInfos.firmwareVersion >= 1255) {
            this.log.debug('Dongle needs to be unlocked');
            const unlockResult = await this.unlockKey();
            if (!unlockResult) {
                throw new Error('Unable to unlock Yokis USB device');
            }
            this.log.debug('Unlock result:', unlockResult);
        }

        return firmwareInfos;
    }

    /**
     * Build Buffer for specific command (17 bytes)
     * @param xmlPath (command.xml, server.xml...)
     * @param queryArgs
     * @returns Buffer
     */
    buildCommand(xmlPath: string, queryString = '') {
        const queryArgs = new URLSearchParams(queryString);

        // 7 bytes, depending on the command name
        let bufferHeader = [];
        let packetSize = undefined;
        if (xmlPath == 'command.xml') {
            if (queryArgs.get('action') == 'order') {
                bufferHeader = [0x3f, 0x55, 0x10, 0x07, 0x3f];
                // Force packet size for this specific action
                packetSize = YOKIS_PACKET_SIZE;
            } else if (queryArgs.get('action') == 'getstatus') {
                bufferHeader = [0x3f, 0x55, 0x10, 0x07, 0x46];
            } else {
                throw new Error('Unknown action into buildCommand: ' + queryArgs.get('action'));
            }
        } else if (xmlPath == 'server.xml') {
            bufferHeader = [0x2a, 0x55, 0x10, 0x07, 0x2a];
        } else if (xmlPath == 'info.xml') {
            bufferHeader = [0x19, 0x55, 0x10, 0x07, 0x19];
        } else {
            throw new Error('Unknown xmlPath into buildCommand: ' + xmlPath);
        }

        const bufferToSend = Buffer.concat([
            // Header (7 bytes)
            Buffer.concat([Buffer.from(bufferHeader)], 7),
            // Command name (13 bytes)
            Buffer.concat([Buffer.from(xmlPath)], 13),
            // Separator between command & query string (4 bytes)
            Buffer.from([0x1, 0x0, 0x1, 0x0]),
            // Query string
            Buffer.from(queryString),
        ]);

        return Buffer.concat([
            bufferToSend,
            // Separator + CRC
            Buffer.from([0x0, crcCalculation(bufferToSend)]),
        ], packetSize);
    }

    /**
     * Clean the buffer response in order to parse it to JSON
     *
     * @param input
     * @returns String
     */
    cleanBufferData(input: Buffer) {
        // Always remove first byte
        input = input.slice(1);

        // Remove command name, if any
        if (input.toString().match(/.*command\.xml.*/)) {
            input = input.slice(YOKIS_NEXT_BUFFER_HEADER.length + YOKIS_NEXT_COMMAND_XML_SEPARATOR.length + 'command.xml'.length);
        } else if (input.toString().match(/.*server\.xml.*/)) {
            input = input.slice(YOKIS_NEXT_BUFFER_HEADER.length + YOKIS_SERVER_XML_SEPARATOR.length + 'server.xml'.length);
        }

        // Process input depending on the last byte (if = 0x0)
        if (input.at(input.length - 1) == 0) {
            // Always trim 0x0 from the end of the response
            input = trimBuffer(input);
            // Remove the last char before the last 0x0
            input = input.slice(0, input.length - 1);
        }

        // Remove any extra char
        return input.toString().replace(/^[\s\uFEFF\xA0\0]+|[\s\uFEFF\xA0\0]+$/g, '');
    }

    /**
     * Retrieve firmware version & date of USB key
     * Example of received data: fV154201/03/2022
     * @returns object
     */
    async getVersion() {
        return await this.lock.acquire('yokis-usb', async () => {
            // Send the command
            await this.commandTransfer(Buffer.concat([Buffer.from([0x07, 0x55, 0x80, 0xff, 0x07, 0x00, 0x01, 0x2c])], YOKIS_PACKET_SIZE));

            // Wait 100ms
            await delay(100);

            const version = (await this.interruptTransfer()).toString();
            const versionRegex = /.*fV([0-9]{4})([0-9]{2})\/([0-9]{2})\/([0-9]{4}).*/;
            const found = version.match(versionRegex);
            if (!found) {
                throw new Error('Unable to parse response for getVersion: ' + version);
            }

            const firmwareVersion = parseInt(found[1]);
            const firmwareDate = new Date(parseInt(found[4]), parseInt(found[3]), parseInt(found[2]));

            // Send empty interrupt
            await this.interruptTransfer();

            // Wait 50ms
            await delay(50);

            return {
                firmwareVersion, firmwareDate
            };
        });
    }

    /**
     * Unlock the key (needed depending on firmware version >= 1255)
     * @returns boolean
     */
    async unlockKey() {
        const result = await this.lock.acquire('yokis-usb', async () => {
            // Send the command
            let bufferData = this.buildCommand('server.xml', 'unlockcode=0xB001');
            await this.commandTransfer(bufferData);

            // Wait 100ms
            await delay(100);

            let result = await this.interruptTransfer();

            // Send empty interrupt
            await this.interruptTransfer();

            if (!result.toString().match(/.*server.xml.*/)) {
                throw new Error('Something went wrong, result: ' + result.toString());
            }

            const bufferFooter = Buffer.from([0x0, 0x0, 0x0, 0x01, 0x0, 0x0, 0x0, 0x0b]);
            bufferData = Buffer.concat([YOKIS_NEXT_BUFFER_HEADER, Buffer.from('server.xml'), bufferFooter], YOKIS_PACKET_SIZE);

            await delay(100);

            // Send empty server.xml
            await this.commandTransfer(bufferData);

            // Wait 100ms
            await delay(100);

            result = await this.interruptTransfer();

            // Send empty interrupt
            await this.interruptTransfer();

            // Wait 50ms
            await delay(50);

            return result;
        });

        if (!result.toString().match(/.*server\.xml.*/)) {
            throw new Error('Something went wrong, result: ' + result.toString());
        }

        const json = JSON.parse(this.cleanBufferData(result));

        return json.status && json.status == 'success';
    }

    /**
     * Make some loop in order to concat/retrieve the JSON response
     * @returns object
     */
    async getJSONResponse() {
        let jsonResult = '';
        let result = null;

        for (let i = 0; i < 15; i++) {
            await this.commandTransfer(Buffer.concat([YOKIS_NEXT_BUFFER_HEADER, Buffer.from('command.xml'), YOKIS_NEXT_COMMAND_XML_SEPARATOR, Buffer.from('i')], YOKIS_PACKET_SIZE));

            // Wait 100ms
            await delay(100);

            // Excepting command.xmlk
            result = await this.interruptTransfer();
            // Send empty interrupt
            await this.interruptTransfer();

            if (!result.toString().match(/.*command\.xml.*o.*/)) {
                if (result.toString().match(/.*command\.xml.*\{.*/)) {
                    // First JSON part
                    jsonResult += this.cleanBufferData(result);

                    // If JSON can be parsed, end the loop
                    if (canBeParsedAsJSON(jsonResult)) {
                        break;
                    } else {
                        await delay(250);
                        continue;
                    }
                } else if (jsonResult.length) {
                    // Next JSON parts (concat)
                    jsonResult += this.cleanBufferData(result);

                    // If JSON can be parsed, end the loop
                    if (canBeParsedAsJSON(jsonResult)) {
                        break;
                    } else {
                        continue;
                    }
                }
            }

            if (!result.toString().match(/.*command\.xml.*o.*/)) {
                throw new Error('Something went wrong, result: ' + result.toString());
            }

            await delay(250);
        }

        if (canBeParsedAsJSON(jsonResult)) {
            return JSON.parse(jsonResult);
        }

        this.log.error('Unable to parse JSON: ', jsonResult);
        return null;
    }

    /**
     *
     * @param moduleId
     * @returns object
     */
    async toggleLight(moduleId: string) {
        // Send the command
        const bufferData = this.buildCommand('command.xml', 'action=order&id=' + moduleId + '&order=default');

        return await this.lock.acquire('yokis-usb', async () => {
            // Wait 20ms
            await delay(20);

            await this.commandTransfer(bufferData);

            // Wait 100ms
            await delay(100);

            const result = await this.interruptTransfer();
            // Send empty interrupt
            await this.interruptTransfer();

            if (!result.toString().match(/.*command\.xml.*k.*/)) {
                throw new Error('Something went wrong, result: ' + result.toString());
            }

            await delay(100);

            // Retrieve JSON answer
            const json = await this.getJSONResponse();

            // Wait 50ms
            await delay(50);

            return json;
        });
    }

    /**
     * Toggle light ON
     *
     * @param moduleId
     * @returns object
     */
    async toggleOn(moduleId: string) {
        // Send the command
        const bufferData = this.buildCommand('command.xml', 'action=order&id=' + moduleId + '&order=on');

        return await this.lock.acquire('yokis-usb', async () => {
            // Wait 20ms
            await delay(20);

            await this.commandTransfer(bufferData);

            // Wait 100ms
            await delay(100);

            const result = await this.interruptTransfer();
            // Send empty interrupt
            await this.interruptTransfer();

            if (!result.toString().match(/.*command\.xml.*k.*/)) {
                throw new Error('Something went wrong, result: ' + result.toString());
            }

            await delay(100);

            // Retrieve JSON answer
            const json = await this.getJSONResponse();

            // Wait 50ms
            await delay(50);

            return json;
        });
    }

    /**
     * Toggle light OFF
     *
     * @param moduleId
     * @returns object
     */
    async toggleOff(moduleId: string) {
        // Send the command
        const bufferData = this.buildCommand('command.xml', 'action=order&id=' + moduleId + '&order=off');

        return await this.lock.acquire('yokis-usb', async () => {
            // Wait 20ms
            await delay(20);

            await this.commandTransfer(bufferData);

            // Wait 100ms
            await delay(100);

            const result = await this.interruptTransfer();
            // Send empty interrupt
            await this.interruptTransfer();

            if (!result.toString().match(/.*command\.xml.*k.*/)) {
                throw new Error('Something went wrong, result: ' + result.toString());
            }

            await delay(100);

            // Retrieve JSON answer
            const json = await this.getJSONResponse();

            // Wait 50ms
            await delay(50);

            return json;
        });
    }

    /**
     * Retrieve module status (state: 0/1 ; var: 0<>100)
     *
     * @param moduleId
     * @returns object
     */
    async getModuleStatus(moduleId: string) {
        // Send the command
        const bufferData = this.buildCommand('command.xml', 'action=getstatus&id=' + moduleId + '&type=4&correct=1');
        // {"status":"fail","ErrorCode":68} => Unknown ID ?

        return await this.lock.acquire('yokis-usb', async () => {
            // Send the command for each chunk
            const bufferDataChunks = getChunkedBuffer(bufferData, YOKIS_PACKET_SIZE);
            for (let i = 0; i < bufferDataChunks.length; i++) {
                await this.commandTransfer(Buffer.concat([bufferDataChunks[i]], YOKIS_PACKET_SIZE));
                // Wait 50ms
                await delay(25);
            }

            // Wait 100ms
            await delay(100);

            // Excepting command.xmlk
            const result = await this.interruptTransfer();
            // Send empty interrupt
            await this.interruptTransfer();
            if (!result.toString().match(/.*command\.xml.*k.*/)) {
                throw new Error('Something went wrong, result: ' + result.toString());
            }

            // Retrieve JSON answer
            const json = await this.getJSONResponse();
            // Wait 50ms
            await delay(50);

            return json;
        });
    }

    /**
     * Send command
     *
     * @param data
     * @returns Promise
     */
    async commandTransfer(data: Buffer = Buffer.alloc(YOKIS_PACKET_SIZE)): Promise<Buffer> {
        type TransferCallback = Parameters<typeof this.commandEp.makeTransfer>[1];
        return new Promise((resolve, reject) => {
            const callback: TransferCallback = (err, data, length) => {
                if (err) {
                    this.log.error('[commandTransfer] Error: ' + err.toString());
                    return reject(err);
                }

                this.log.debug('[commandTransfer] Callback:', data.slice(0, length), data.slice(0, length).toString());
                return resolve(data.slice(0, length));
            };

            this.log.debug('[commandTransfer] makeTransfer:', data, data.toString());
            const transfer = this.commandEp.makeTransfer(TIMEOUT, callback);
            transfer.submit(data, callback);
        });
    }

    /**
     * Send interrupt
     *
     * @param data
     * @returns Promise
     */
    async interruptTransfer(data: Buffer = Buffer.alloc(YOKIS_PACKET_SIZE)): Promise<Buffer> {
        type TransferCallback = Parameters<typeof this.interruptEp.makeTransfer>[1];
        return new Promise((resolve, reject) => {
            const callback: TransferCallback = (err, data, length) => {
                if (err) {
                    this.log.error('[interruptTransfer] Error: ' + err.toString());
                    return reject(err);
                }

                this.log.debug('[interruptTransfer] Callback:', data.slice(0, length), data.slice(0, length).toString());
                return resolve(data.slice(0, length));
            };

            this.log.debug('[interruptTransfer] makeTransfer:', data, data.toString());
            const transfer = this.interruptEp.makeTransfer(TIMEOUT, callback);
            transfer.submit(data, callback);
        });
    }

    /**
     * Release the object
     */
    release() {
        // Interface
        if (this.interface) {
            this.log.debug('Release interface');
            this.interface.release();

            // Check if interface has to be attached back
            if (this.hasDetachedKernelDriver) {
                this.log.debug('Attach interface to the kernel');
                this.interface.attachKernelDriver();
            }
        }

        // Device
        if (this.device) {
            this.log.debug('Close the USB device');
            this.device.close();
        }
    }
}
