import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a1a' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: '#f5f5f5' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'SecureBin', headerShown: false }} />
        <Stack.Screen name="setup" options={{ title: 'Setup', headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="result" options={{ title: 'Result', presentation: 'modal' }} />
        <Stack.Screen name="history" options={{ title: 'Scan History' }} />
        <Stack.Screen name="about" options={{ title: 'Information Sources' }} />
      </Stack>
    </>
  );
}
