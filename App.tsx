import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { markInboxSeen, rememberUserAgent, setupDmNotifications } from './src/dmNotifications';
import { GUARD_SCRIPT } from './src/injected';
import { HOME_URL, describeBlocked, judge, type Verdict } from './src/policy';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <Messenger />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Messenger() {
  const webview = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const { toast, showToast } = useToast();

  const goHome = useCallback(() => {
    webview.current?.injectJavaScript(`location.replace(${JSON.stringify(HOME_URL)}); true;`);
  }, []);

  const apply = useCallback(
    (verdict: Verdict): boolean => {
      switch (verdict.action) {
        case 'allow':
          return true;
        case 'external':
          openExternal(verdict.url);
          return false;
        case 'block':
          showToast(verdict.reason);
          return false;
      }
    },
    [showToast],
  );

  // Full page loads (and iOS iframes).
  const onShouldStartLoadWithRequest = useCallback(
    (req: ShouldStartLoadRequest) => {
      const verdict = judge(req.url, req.isTopFrame ?? true);
      // A blocked full load (e.g. post-login redirect to "/") would leave us
      // stranded on the previous page, so send it to the inbox instead.
      if (verdict.action === 'block' && req.isTopFrame !== false) setTimeout(goHome, 0);
      return apply(verdict);
    },
    [apply, goHome],
  );

  // SPA route changes surface here on both platforms; second line of defence
  // behind the injected guard.
  const onNavigationStateChange = useCallback(
    (nav: WebViewNavigation) => {
      canGoBack.current = nav.canGoBack;
      const verdict = judge(nav.url);
      if (verdict.action === 'block') {
        showToast(verdict.reason);
        goHome();
      }
    },
    [goHome, showToast],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg?.type === 'blocked') showToast(describeBlocked(new URL(msg.url).pathname));
        // The background DM check impersonates this exact browser.
        if (msg?.type === 'ua' && typeof msg.ua === 'string') rememberUserAgent(msg.ua).catch(() => {});
      } catch {
        // not ours
      }
    },
    [showToast],
  );

  // DM notifications: background poller + quiet while the app is open.
  useEffect(() => {
    setupDmNotifications().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') markInboxSeen().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // Android hardware back walks webview history before leaving the app.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      webview.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.root}>
      <WebView
        ref={webview}
        source={{ uri: HOME_URL }}
        style={styles.root}
        injectedJavaScriptBeforeContentLoaded={GUARD_SCRIPT}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        onMessage={onMessage}
        onOpenWindow={(e) => {
          const url = e.nativeEvent.targetUrl;
          // target=_blank to an allowed page (e.g. a call) opens in place.
          if (apply(judge(url))) webview.current?.injectJavaScript(`location.assign(${JSON.stringify(url)}); true;`);
        }}
        onContentProcessDidTerminate={() => webview.current?.reload()}
        onRenderProcessGone={() => webview.current?.reload()}
        // Stay logged in across launches.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        // Voice notes, video replies, calls.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        setSupportMultipleWindows
        allowsLinkPreview={false}
        webviewDebuggingEnabled={__DEV__ || process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === '1'}
        originWhitelist={['https://*', 'http://*', 'about:*', 'blob:*', 'data:*']}
      />
      {toast}
    </View>
  );
}

function openExternal(url: string) {
  if (/^https?:/i.test(url)) {
    WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  } else {
    Linking.openURL(url).catch(() => {});
  }
}

function useToast() {
  const opacity = useRef(new Animated.Value(0)).current;
  const [label, setLabel] = useState('');

  const showToast = useCallback(
    (what: string) => {
      setLabel(`Blocked ${what} 🧠`);
      opacity.stopAnimation();
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    },
    [opacity],
  );

  const toast = (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
      <Text style={styles.toastText}>{label}</Text>
    </Animated.View>
  );

  return { toast, showToast };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  toast: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: 'rgba(30,30,30,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
