import { CameraView } from 'expo-camera';
import { BlurView } from 'expo-blur';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCamera } from '../hooks/useCamera';
import { categorizeImage } from '../services/categorizer';
import { addToHistory, saveImageLocally } from '../services/history';
import { getLocation } from '../services/location';
import { ScanRecord } from '../types';

function measureView(ref: React.RefObject<View | null>): Promise<{ x: number; y: number; width: number; height: number }> {
  return new Promise(resolve => {
    ref.current?.measure((_x, _y, width, height, pageX, pageY) => {
      resolve({ x: pageX, y: pageY, width, height });
    });
  });
}

function computeCrop(
  photoW: number, photoH: number,
  screenW: number, screenH: number,
  reticle: { x: number; y: number; width: number; height: number },
) {
  const scale = Math.max(screenW / photoW, screenH / photoH);
  const overflowX = (photoW * scale - screenW) / 2;
  const overflowY = (photoH * scale - screenH) / 2;
  const originX = Math.round((reticle.x + overflowX) / scale);
  const originY = Math.round((reticle.y + overflowY) / scale);
  const cropW = Math.round(reticle.width / scale);
  const cropH = Math.round(reticle.height / scale);
  return {
    originX: Math.max(0, originX),
    originY: Math.max(0, originY),
    width: Math.min(cropW, photoW - Math.max(0, originX)),
    height: Math.min(cropH, photoH - Math.max(0, originY)),
  };
}

export default function CameraScreen() {
  const router = useRouter();
  const { permission, requestPermission, cameraRef, isCapturing, takePicture } = useCamera();
  const [isCategorizing, setIsClassifying] = useState(false);
  const reticleRef = useRef<View>(null);

  useEffect(() => {
    getLocation().then(loc => {
      if (!loc) router.replace('/setup');
    });
  }, []);

  const busy = isCapturing || isCategorizing;

  async function handleCapture() {
    if (busy) return;

    const photo = await takePicture();
    if (!photo) return;

    const reticle = await measureView(reticleRef);
    if (!reticle.width || !reticle.height) return;
    const { width: screenW, height: screenH } = Dimensions.get('window');
    const cropRegion = computeCrop(photo.width, photo.height, screenW, screenH, reticle);
    const manipulated = await ImageManipulator.manipulate(photo.uri)
      .crop(cropRegion)
      .renderAsync();
    const { uri } = await manipulated.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });

    setIsClassifying(true);
    try {
      const result = await categorizeImage(uri);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const savedUri = saveImageLocally(uri, id);

      const record: ScanRecord = {
        id,
        timestamp: Date.now(),
        imageUri: savedUri,
        bin: result.bin,
        item: result.item,
        reason: result.reason,
        confidence: result.confidence,
      };
      await addToHistory(record);

      router.push({
        pathname: '/result',
        params: {
          imageUri: savedUri,
          bin: result.bin,
          item: result.item,
          reason: result.reason,
          confidence: String(result.confidence),
        },
      });
    } catch (err) {
      console.error('Categorization error:', err);
      Alert.alert(
        'Categorization Failed',
        'Could not categorize the item. Please try again with a clearer photo.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsClassifying(false);
    }
  }

  if (!permission) {
    return <View style={styles.center} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access is required to scan items.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Enable Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Top glass header */}
      <BlurView intensity={100} tint="dark" style={styles.topSection}>
        <View style={styles.topInner}>
          <Text style={styles.title}>SecureBin</Text>
          <Text style={styles.subtitle}>Position the item inside the frame</Text>
        </View>
      </BlurView>

      {/* Middle: glass masks surround the frame, camera shows through only inside it */}
      <View style={styles.frameArea} pointerEvents="none">
        <BlurView intensity={100} tint="dark" style={styles.maskH} />
        <View style={styles.frameRow}>
          <BlurView intensity={100} tint="dark" style={styles.maskV} />
          <View ref={reticleRef} style={styles.frame} />
          <BlurView intensity={100} tint="dark" style={styles.maskV} />
        </View>
        <BlurView intensity={100} tint="dark" style={styles.maskH} />
      </View>

      {/* Bottom glass bar: History | Capture | Settings */}
      <BlurView intensity={100} tint="dark" style={styles.bottomSection}>
        <View style={styles.glassLine} />
        <View style={styles.bottomInner}>
          <TouchableOpacity
            style={styles.sideBtn}
            onPress={() => router.push('/history')}
            disabled={busy}
            activeOpacity={0.75}
          >
            <Text style={styles.sideBtnIcon}>🕐</Text>
            <Text style={styles.sideBtnLabel}>History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.captureBtn, busy && styles.captureBtnBusy]}
            onPress={handleCapture}
            disabled={busy}
            activeOpacity={0.8}
          >
            {busy ? (
              <ActivityIndicator color="#1a1a1a" size="large" />
            ) : (
              <View style={styles.captureRing}>
                <View style={styles.captureCore} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideBtn}
            onPress={() => router.push('/setup')}
            disabled={busy}
            activeOpacity={0.75}
          >
            <Text style={styles.sideBtnIcon}>⚙️</Text>
            <Text style={styles.sideBtnLabel}>Settings</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topSection: {
    overflow: 'hidden',
  },
  topInner: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.25)',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textAlign: 'center',
  },

  frameArea: {
    flex: 1,
  },
  maskH: {
    flex: 1,
    overflow: 'hidden',
  },
  frameRow: {
    flexDirection: 'row',
  },
  maskV: {
    width: '6%',
    overflow: 'hidden',
  },
  frame: {
    flex: 1,
    aspectRatio: 4 / 3,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },

  bottomSection: {
    overflow: 'hidden',
  },
  glassLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  bottomInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingTop: 24,
    paddingBottom: 48,
  },
  sideBtn: {
    width: 64,
    alignItems: 'center',
    gap: 4,
  },
  sideBtnIcon: {
    fontSize: 24,
  },
  sideBtnLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnBusy: {
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  captureRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureCore: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#1a1a1a',
  },
  permText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
