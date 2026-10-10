import { Config } from '@remotion/cli/config';

// The capture is a 1280x800 window at 2x and the composition is 1920x1080, so a whole window is shown below the
// pixels it was taken at, and even the closest crops barely above them. CRF 17 (package.json) keeps the sidebar's
// labels readable after a re-encode.
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
