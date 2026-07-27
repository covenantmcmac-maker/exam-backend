import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { DialogProvider } from './src/components/Dialog';
import PwaBanners from './src/pwa/PwaBanners';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <DialogProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          {/* Install / update / offline notices. Renders nothing on native. */}
          <PwaBanners />
          <View style={{ flex: 1 }}>
            <RootNavigator />
          </View>
        </AuthProvider>
      </DialogProvider>
    </SafeAreaProvider>
  );
}
