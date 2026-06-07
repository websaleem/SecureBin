import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';

export function useCamera() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  async function takePicture(): Promise<{ uri: string; width: number; height: number } | null> {
    if (!cameraRef.current || isCapturing) return null;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, base64: false });
      if (!photo) return null;
      return { uri: photo.uri, width: photo.width, height: photo.height };
    } finally {
      setIsCapturing(false);
    }
  }

  return {
    permission,
    requestPermission,
    cameraRef,
    isCapturing,
    takePicture,
  };
}
