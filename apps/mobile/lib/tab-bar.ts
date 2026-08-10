import { Platform } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";

/**
 * Bottom tab bar geometry shared by the tab layout
 * (app/(app)/[workspace]/(tabs)/_layout.tsx) and the More-tab dropdown
 * anchor (components/nav/more-tab-dropdown.tsx), so the popover stays
 * aligned with the tab button whenever the bar's bottom padding changes.
 *
 * TAB_BAR_HEIGHT is the iOS default content height above the bottom
 * inset. React Navigation doesn't export it, but the value is stable
 * across Expo Router 55 / RN Screens 4 (see getTabBarHeight in
 * @react-navigation/bottom-tabs).
 */
export const TAB_BAR_HEIGHT = 49;

/**
 * Bottom padding for the tab bar. iOS returns the safe-area inset
 * verbatim — React Navigation already pads by it, so nothing changes.
 *
 * Android gets extra clearance because an edge-to-edge build draws the
 * tab bar behind the gesture-navigation pill; `insets.bottom` alone
 * leaves the Inbox / My Issues / Chat / More labels sitting right on
 * top of it. We add 12px on top of the inset and enforce a 20px floor
 * so the labels stay clear even when react-native-safe-area-context
 * reports a zero bottom inset.
 */
export function tabBarBottomPadding(insets: EdgeInsets): number {
  return Platform.OS === "android"
    ? Math.max(insets.bottom + 12, 20)
    : insets.bottom;
}
