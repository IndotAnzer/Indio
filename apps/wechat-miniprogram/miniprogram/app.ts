import { initIndioCloud } from "./utils/config";
import { configureRadioAudioSession } from "./utils/audio";

App({
  onLaunch() {
    initIndioCloud();
    configureRadioAudioSession();
  },

  globalData: {}
});
