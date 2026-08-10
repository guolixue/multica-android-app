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
 * Android content height for the tab bar. The iOS 49px default is too
 * short once the labels render at fontSize 16 — the icon (25px) + label
 * (~20px) + the 10px vertical padding already overflows 49px, pushing the
 * label's descender into the gesture-navigation area. We give Android a
 * taller content area (58px) so the icon+label block fits with room to be
 * vertically centered (see tabBarButton in the tabs layout) instead of
 * overflowing into the bottom padding.
 */
export const ANDROID_TAB_CONTENT_HEIGHT = 58;

/** Content height of the tab bar above the bottom padding, per platform. */
export function tabBarContentHeight(): number {
  return Platform.OS === "android" ? ANDROID_TAB_CONTENT_HEIGHT : TAB_BAR_HEIGHT;
}

/**
 * Bottom padding for the tab bar. iOS returns the safe-area inset
 * verbatim — React Navigation already pads by it, so nothing changes.
 *
 * Android gets extra clearance because an edge-to-edge build draws the
 * tab bar behind the gesture-navigation pill; `insets.bottom` alone
 * leaves the Inbox / My Issues / Chat / More labels sitting right on
 * top of it. We add 12px on top of the inset and enforce a 24px floor
 * (the gesture-pill height) so the labels stay clear even when
 * react-native-safe-area-context reports a zero bottom inset.
 */
export function tabBarBottomPadding(insets: EdgeInsets): number {
  return Platform.OS === "android"
    ? Math.max(insets.bottom + 12, 24)
    : insets.bottom;
}
