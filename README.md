<p align="center">
<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" height="100">
<img src="https://www.yokis.com/wp-content/themes/yokis/images/yokis.svg" height="100">
<img src="https://www.yokis.com/wp-content/uploads/2017/06/yokey.png" height="100">
</p>

# Homebridge Yokis Plugin

This plugin allow you to trigger ON/OFF and get current state of Yokis *MTR2000ER* module.
The implementation has been made using the [Yokey](https://www.yokis.com/en/system-configuration-and-management/yokey/), an USB dongle that facilitates acquisition and configuration phase of Yokis radio modules.

Using the [Yokis Pro app](https://www.yokis.com/en/app-yokispro/), you can create Yokis Radio BUS, configure your module etc.
This step is mandatory before using this plugin.
Once you're done with the Yokis Pro app, you can plug the Yokey on your device (tested on Raspberry Pi);

What is currently working :

 - [x] Retrieve state for a module using its ID (ON/OFF and variation value)
 - [x] Toggle state for a module
 - [x] Force ON mode for a module using its ID
 - [x] Force OFF mode for amodule using its ID

By doing some USB traffic capture, I was able to create this plugin, but some additionnal work has to be done **(help needed !**) :

 - [x] Automatically calculate the CRC control value for each request OR loop over 0-128 values in order to find and cache the correct value
 - [ ] Retrieve the modules list from the dongle database / or from the Yokis API
 - [ ] Make this plugin compatible with "Energeasy Connect USB Dongle" (I don't have one)
