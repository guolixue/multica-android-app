/**
 * Cross-platform action sheet.
 *
 * iOS: delegates to `ActionSheetIOS.showActionSheetWithOptions` — the
 * native sheet, zero custom layout, same haptics / dismissal behavior.
 *
 * Android: `ActionSheetIOS` is an iOS-only native module — calling it on
 * Android throws "Invariant Violation: ActionSheetManager doesn't exist"
 * and crashes the app. Instead we render a Modal-based centered action
 * card through `<ActionSheetHost />` (mounted once in app/_layout.tsx).
 *
 * Both platforms share the same signature so a call site never branches
 * on `Platform.OS`:
 *
 *   showActionSheet(
 *     { options, cancelButtonIndex, destructiveButtonIndex, title },
 *     (index) => { ... },
 *   )
 *
 * Backdrop tap / Android hardware back dismisses with `cancelButtonIndex`,
 * matching iOS's outside-tap behavior (the explicit Cancel row also fires
 * the callback with `cancelButtonIndex`).
 */
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  ActionSheetIOS,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { create } from "zustand";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { stripMarkdown } from "@/lib/strip-markdown";

export interface ActionSheetOptions {
  title?: string;
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number;
}

interface ActionSheetState {
  visible: boolean;
  config: ActionSheetOptions | null;
  onSelect: ((index: number) => void) | null;
}

const useActionSheetStore = create<ActionSheetState>(() => ({
  visible: false,
  config: null,
  onSelect: null,
}));

interface SelectableTextState {
  visible: boolean;
  /** Optional header label (e.g. message sender). */
  title?: string;
  /** Raw (markdown) content; displayed as stripped plain text. */
  content: string;
}

const useSelectableTextStore = create<SelectableTextState>(() => ({
  visible: false,
  title: undefined,
  content: "",
}));

/**
 * Present content as a centered modal with a plain RN `<Text selectable>`.
 *
 * Android only: the app's markdown renderer (react-native-enriched-markdown)
 * sets a `LinkLongPressMovementMethod` that swallows Android's native
 * long-press text selection, so the in-place `selectable` toggle never
 * produces selection handles there. A plain RN Text on Android maps to a
 * TextView with `textIsSelectable=true` — native selection + Copy, no
 * custom movement method involved. iOS keeps the in-place flow (native
 * magnifier works), so this is only wired from Android call sites.
 */
export function showSelectableText(opts: { title?: string; content: string }) {
  useSelectableTextStore.setState({
    visible: true,
    title: opts.title,
    content: opts.content,
  });
}

/** Cross-platform replacement for ActionSheetIOS.showActionSheetWithOptions. */
export function showActionSheet(
  config: ActionSheetOptions,
  onSelect: (index: number) => void,
) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(config, onSelect);
    return;
  }
  // Android: the centered Modal card would sit on top of an open
  // keyboard, so dismiss the keyboard first — the card then opens in a
  // keyboard-free full-screen window, centered on the real screen.
  Keyboard.dismiss();
  useActionSheetStore.setState({ visible: true, config, onSelect });
}

/**
 * Renders the Android centered action card. Mounted once at the app root
 * (app/_layout.tsx); a no-op on iOS where the native sheet handles it.
 */
export function ActionSheetHost() {
  const { visible, config, onSelect } = useActionSheetStore();
  const selectable = useSelectableTextStore();

  // Both modals are Android-only (iOS uses ActionSheetIOS / native
  // in-place selection). `visible` guards the action card; `selectable`
  // guards the selectable-text modal.
  if (Platform.OS === "ios") return null;

  const dismiss = (index?: number) => {
    useActionSheetStore.setState({
      visible: false,
      config: null,
      onSelect: null,
    });
    if (index !== undefined) onSelect?.(index);
  };

  // Backdrop tap and Android hardware back both count as "dismissed
  // outside" — fire the callback with cancelButtonIndex to match iOS's
  // outside-tap behavior (see showActionSheetWithOptions docs), so the
  // caller's cleanup (e.g. isPressed=false) always runs.
  const dismissOutside = () => {
    dismiss(config?.cancelButtonIndex);
  };

  const closeSelectable = () =>
    useSelectableTextStore.setState({ visible: false, content: "" });

  const copySelectable = async () => {
    await Clipboard.setStringAsync(selectable.content);
    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
  };

  return (
    <>
      {visible ? (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={dismissOutside}
        >
          {/* Backdrop: tap outside dismisses as the cancel button. The inner
              Pressable swallows its own taps so tapping a row never falls
              through to the backdrop. Centered card (not bottom-anchored) —
              the user's phone reports a bottom action sheet sitting too high
              / overlapping the gesture area, so a short menu reads better
              centered like the app's other picker sheets. */}
          <Pressable
            className="flex-1 bg-black/40 items-center justify-center px-8"
            onPress={dismissOutside}
          >
            <Pressable
              onPress={() => {}}
              className="w-full max-w-sm bg-popover rounded-2xl overflow-hidden"
            >
              {config?.title ? (
                <View className="px-4 py-3 border-b border-border">
                  <Text className="text-sm font-medium text-muted-foreground text-center">
                    {config.title}
                  </Text>
                </View>
              ) : null}

              {config?.options.map((label, i) => {
                const isDestructive = i === config.destructiveButtonIndex;
                const isCancel = i === config.cancelButtonIndex;
                return (
                  <Pressable
                    key={i}
                    onPress={() => dismiss(i)}
                    className={cn(
                      "px-4 py-4 border-b border-border/60 active:bg-secondary",
                      isCancel && "border-t border-border",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-base text-center",
                        isDestructive
                          ? "text-destructive font-medium"
                          : "text-foreground",
                        isCancel && "font-semibold",
                      )}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {selectable.visible ? (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={closeSelectable}
        >
          <Pressable
            className="flex-1 bg-black/40 items-center justify-center px-8"
            onPress={closeSelectable}
          >
            <Pressable
              onPress={() => {}}
              className="w-full max-w-sm bg-popover rounded-2xl overflow-hidden"
            >
              {selectable.title ? (
                <View className="px-4 py-3 border-b border-border">
                  <Text className="text-sm font-medium text-muted-foreground text-center">
                    {selectable.title}
                  </Text>
                </View>
              ) : null}

              {/* A plain RN `<Text selectable>` — native Android TextView
                  textIsSelectable=true, so long-press shows selection
                  handles + the system Copy menu. Scrollable for long
                  content. stripMarkdown removes the markdown syntax so
                  the user copies clean text. */}
              <ScrollView className="max-h-72 px-4 py-3">
                <Text
                  selectable
                  className="text-sm text-foreground leading-5"
                >
                  {stripMarkdown(selectable.content)}
                </Text>
              </ScrollView>

              <View className="flex-row border-t border-border">
                <Pressable
                  onPress={() => void copySelectable()}
                  className="flex-1 px-4 py-3 active:bg-secondary"
                >
                  <Text className="text-base text-center text-foreground">
                    Copy all
                  </Text>
                </Pressable>
                <Pressable
                  onPress={closeSelectable}
                  className="flex-1 px-4 py-3 border-l border-border active:bg-secondary"
                >
                  <Text className="text-base text-center text-foreground font-semibold">
                    Close
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}
