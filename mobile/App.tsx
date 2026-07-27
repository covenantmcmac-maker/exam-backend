import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { isDarkPalette } from './src/theme';
import { AuthProvider } from './src/context/AuthContext';
import { DialogProvider } from './src/components/Dialog';
import ThemePicker from './src/components/ThemePicker';
import PwaBanners from './src/pwa/PwaBanners';
import RootNavigator from './src/navigation/RootNavigator';

/** Status bar style follows the active theme (light text on dark themes). */
function ThemedStatusBar() {
  const { palette } = useTheme();
  return <StatusBar style={isDarkPalette(palette) ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <DialogProvider>
          <AuthProvider>
            <ThemedStatusBar />
            {/* Install / update / offline notices. Renders nothing on native. */}
            <PwaBanners />
            <View style={{ flex: 1 }}>
              <RootNavigator />
            </View>
            {/* Floating 🎨 theme switcher, shown on every screen. */}
            <ThemePicker />
          </AuthProvider>
        </DialogProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
