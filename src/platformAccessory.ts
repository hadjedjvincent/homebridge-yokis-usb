import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { YokisHomebridgePlugin } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class YokisAccessory {
    private service: Service;

    constructor(
        private readonly platform: YokisHomebridgePlugin,
        private readonly accessory: PlatformAccessory,
    ) {

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Yokis')
            .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.moduleId);

        // get the LightBulb service if it exists, otherwise create a new LightBulb service
        // you can create multiple services for each accessory
        this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

        // set the service name, this is what is displayed as the default name on the Home app
        // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.moduleId);

        // each service must implement at-minimum the "required characteristics" for the given service type
        // see https://developers.homebridge.io/#/service/Lightbulb

        // register handlers for the On/Off Characteristic
        this.service.getCharacteristic(this.platform.Characteristic.On)
            // SET - bind to the `setOn` method below
            .onSet(this.setOn.bind(this))
            // GET - bind to the `getOn` method below
            .onGet(this.getOn.bind(this));

        /**
         * Updating characteristics values asynchronously every 45s-30s
         */
        setInterval(() => {
            this.updateAccessoryState();
        }, Math.floor(Math.random() * (45000 - 30000)) + 30000);
    }

    async updateAccessoryState() {
        try {
            const moduleStatus = await this.platform.yokisDriver.getModuleStatus(this.accessory.context.device.moduleId, this.accessory.context.device.crc.getModuleStatus);
            this.platform.log.debug('[updateAccessoryState] State for module ' + this.accessory.context.device.moduleId + ' : ', moduleStatus);

            if (moduleStatus === null) {
                // Nothing to do, will be tried next time
                return;
            }

            if (moduleStatus.data.state == 0) {
                this.service.updateCharacteristic(this.platform.Characteristic.On, false);
            } else if (moduleStatus.data.state == 1) {
                this.service.updateCharacteristic(this.platform.Characteristic.On, true);
            } else {
                this.platform.log.error('[updateAccessoryState] Unable to parse moduleStatus response:', moduleStatus);
                throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
            }
        } catch (error: any) {
            // if you need to return an error to show the device as "Not Responding" in the Home app:
            this.platform.log.error('[updateAccessoryState] Error on getModuleStatus response:', error);
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
    }

    /**
     * Handle "SET" requests from HomeKit
     * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
     */
    async setOn(value: CharacteristicValue) {
        if (value == true) {
            const toggleResult = await this.platform.yokisDriver.toggleOn(this.accessory.context.device.moduleId, this.accessory.context.device.crc.toggleOn);
            this.platform.log.debug('[setOn] setOn -> toggleOn', toggleResult);
        } else {
            const toggleResult = await this.platform.yokisDriver.toggleOff(this.accessory.context.device.moduleId, this.accessory.context.device.crc.toggleOff);
            this.platform.log.debug('[setOn] setOn -> toggleOff', toggleResult);
        }
    }

    /**
     * Handle the "GET" requests from HomeKit
     * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
     *
     * GET requests should return as fast as possbile. A long delay here will result in
     * HomeKit being unresponsive and a bad user experience in general.
     *
     * If your device takes time to respond you should update the status of your device
     * asynchronously instead using the `updateCharacteristic` method instead.

     * @example
     * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
     */
    async getOn(): Promise<CharacteristicValue> {
        try {
            const moduleStatus = await this.platform.yokisDriver.getModuleStatus(this.accessory.context.device.moduleId, this.accessory.context.device.crc.getModuleStatus);
            this.platform.log.debug('[getOn] State for module ' + this.accessory.context.device.moduleId + ' : ', moduleStatus);

            if (moduleStatus !== null && moduleStatus.data.state == 0) {
                return false;
            } else if (moduleStatus !== null && moduleStatus.data.state == 1) {
                return true;
            } else {
                this.platform.log.error('[getOn] Unable to parse moduleStatus response:', moduleStatus);
                throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
            }
        } catch (error: any) {
            // if you need to return an error to show the device as "Not Responding" in the Home app:
            this.platform.log.error('[getOn] Error on getModuleStatus response:', error);
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
    }
}
