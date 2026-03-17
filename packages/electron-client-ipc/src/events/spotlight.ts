export interface SpotlightBroadcastEvents {
  /**
   * Ask spotlight renderer to focus the input box.
   * Triggered from the main process after showing the spotlight window.
   */
  spotlightFocus: () => void;
}
