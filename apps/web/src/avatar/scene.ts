import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

export interface AvatarScene {
  vrm: VRM;
  /** Avanza la simulación (springbones, humanoid) y renderiza un frame. */
  render(deltaSeconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Escena mínima para el PoC del avatar: modelo VRM con encuadre de tren
 * superior (mismo encuadre que los videos de referencia de ICAL).
 */
export async function createAvatarScene(canvas: HTMLCanvasElement): Promise<AvatarScene> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1, 2, 2);
  scene.add(key, new THREE.AmbientLight(0xffffff, 1.1));

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync('/models/avatar-poc.vrm');
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  scene.add(vrm.scene);
  vrm.scene.updateMatrixWorld(true);

  // Encuadre de tren superior calculado desde el rig (la altura del modelo varía).
  const worldY = (bone: 'head' | 'hips') =>
    vrm.humanoid.getNormalizedBoneNode(bone)!.getWorldPosition(new THREE.Vector3()).y;
  const headY = worldY('head');
  const hipsY = worldY('hips');
  const chestY = hipsY + (headY - hipsY) * 0.72;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, chestY + 0.05, (headY - hipsY) * 2.6);
  camera.lookAt(0, chestY, 0);

  return {
    vrm,
    render(deltaSeconds: number) {
      vrm.update(deltaSeconds);
      renderer.render(scene, camera);
    },
    resize(width: number, height: number) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
    },
  };
}
