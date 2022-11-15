import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { YokisAccessory } from './platformAccessory';
import { Yokis } from './yokis';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class YokisHomebridgePlugin implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

    // this is used to track restored cached accessories
    public readonly accessories: PlatformAccessory[] = [];
    public readonly yokisDriver: Yokis;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        // Create instance of Yokis
        this.yokisDriver = new Yokis(log);

        this.log.debug('Finished initializing platform:', this.config.name);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });

        // this.yokisDriver.on('ready', (firmwareInfos) => {
        //     log.debug('Yokis USB key ready, firmware infos:', firmwareInfos);
        // });
    }

    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory) {
        this.log.info('Loading accessory from cache:', accessory.context.device.moduleId);

        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    /**
     * This is an example method showing how to register discovered accessories.
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    async discoverDevices() {
        // Lookup and open USB device
        try {
            await this.yokisDriver.initUsbDevice();
        } catch (error: any) {
            this.log.error('Unable to init USB device', error);
            return;
        }

        // Init USB key (unlock if needed)
        try {
            await this.yokisDriver.init();
        } catch (error: any) {
            this.log.error('Unable to initialize Yokis USB dongle', error);
            return;
        }

        this.log.debug('Config:', JSON.stringify(this.config));

        if (typeof (this.config.accessories) === 'undefined') {
            this.log.warn('No accessories found');
            return;
        }

        for (const device of this.config.accessories) {
            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            // const uuid = 'Yokis-' + device.moduleId;
            const uuid = this.api.hap.uuid.generate('Yokis-' + device.moduleId);

            // see if an accessory with the same uuid has already been registered and restored from
            // the cached devices we stored in the `configureAccessory` method above
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

            if (existingAccessory) {
                // the accessory already exists
                this.log.info('Restoring existing accessory from cache:', existingAccessory.context.device.moduleId);

                // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                // existingAccessory.context.device = device;
                // this.api.updatePlatformAccessories([existingAccessory]);

                // create the accessory handler for the restored accessory
                // this is imported from `platformAccessory.ts`
                new YokisAccessory(this, existingAccessory);

                // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
                // remove platform accessories when no longer present
                // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
                // this.log.info('Removing existing accessory from cache:', existingAccessory.moduleId);
            } else {
                // the accessory does not yet exist, so we need to create it
                this.log.info('Adding new accessory:', device.moduleId, uuid);

                // create a new accessory
                const accessory = new this.api.platformAccessory(device.moduleId, uuid);

                // store a copy of the device object in the `accessory.context`
                // the `context` property can be used to store any data about the accessory you may need
                accessory.context.device = device;

                // create the accessory handler for the newly create accessory
                // this is imported from `platformAccessory.ts`
                new YokisAccessory(this, accessory);

                // link the accessory to your platform
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
        }
    }
}
