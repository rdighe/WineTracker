import { NativeModule, requireOptionalNativeModule } from 'expo';

/** One wine as the on-device model reads it; prices in the list's units (dollars), 0 when not given. */
export interface DeviceListWine {
  producer: string;
  name: string;
  vintage: string;
  region: string;
  grape: string;
  colour: string;
  style: string;
  section: string;
  glassPrice: number;
  bottlePrice: number;
  bottleMl: number;
}

declare class WineListModule extends NativeModule<{}> {
  /** Whether Apple Intelligence's on-device model can be used right now (iOS 26+, a supported iPhone, turned on). */
  isAvailableAsync(): Promise<boolean>;
  /**
   * The wines in part of a list's text (`heading`: the heading in force where this part starts),
   * or, with mode 'shelf', in the text of a shelf photo's tags.
   */
  readAsync(text: string, heading: string, mode: 'list' | 'shelf'): Promise<DeviceListWine[]>;
}

// Optional: absent in Expo Go and on Android, where the server reads lists instead.
export default requireOptionalNativeModule<WineListModule>('WineList');
