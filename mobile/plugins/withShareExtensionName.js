/**
 * The name the iOS share sheet shows for the app's share extension
 * (expo-share-intent). That plugin names the extension's Xcode target after
 * it too, and a target can't share the app's own name, so the target keeps
 * its default ("ShareExtension") and this sets the name shown, after every
 * other plugin has written its files.
 */
const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withShareExtensionName(config, { name, target = 'ShareExtension' }) {
  return withFinalizedMod(config, [
    'ios',
    (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, target, `${target}-Info.plist`);
      if (!fs.existsSync(file)) throw new Error(`withShareExtensionName: ${file} not found (is expo-share-intent configured?)`);
      const info = plist.parse(fs.readFileSync(file, 'utf8'));
      info.CFBundleDisplayName = name;
      fs.writeFileSync(file, plist.build(info));
      return config;
    },
  ]);
};
