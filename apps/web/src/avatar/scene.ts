import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { addHairColliders, measureRig, type AvatarRig } from './rig';

export interface AvatarScene {
  vrm: VRM;
  /** Medidas del modelo en reposo (huesos y silueta), para el retargeting. */
  rig: AvatarRig;
  /** Avanza la simulación (springbones, humanoid) y renderiza un frame. */
  render(deltaSeconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Resolución interna respecto a los píxeles CSS del canvas. Al menos 2×
 * aunque la pantalla sea 1× (supersampling): el panel de la lección mide
 * 320 px de alto y los dedos ocupan pocos píxeles, así que MSAA solo no basta
 * para quitar el dentado. El navegador reduce el canvas al mostrarlo, lo que
 * promedia 2×2 píxeles. Tope en 3× para no disparar el costo en pantallas 4K.
 */
const renderScale = () => Math.min(Math.max(window.devicePixelRatio, 2), 3);

/**
 * La física del pelo (springbones) se integra con el delta real. Tras una
 * pestaña en segundo plano el delta puede ser de segundos y el pelo sale
 * disparado a través del cuerpo; se acota a un paso razonable.
 */
const MAX_PHYSICS_DELTA = 1 / 20;

/**
 * Escena mínima para el PoC del avatar: modelo VRM con encuadre de tren
 * superior (mismo encuadre que los videos de referencia de ICAL).
 */
export async function createAvatarScene(canvas: HTMLCanvasElement): Promise<AvatarScene> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

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
  const rig = measureRig(vrm);
  addHairColliders(vrm, rig);

  // Encuadre de tren superior calculado desde el rig (la altura del modelo varía):
  // de la cintura a la punta del pelo, y a lo ancho el espacio de señas frente al
  // torso. La distancia se ajusta a la proporción del panel para que ni la
  // cabeza ni las manos se corten en paneles anchos o angostos.
  const worldY = (bone: 'head' | 'hips') =>
    vrm.humanoid.getNormalizedBoneNode(bone)!.getWorldPosition(new THREE.Vector3()).y;
  const headY = worldY('head');
  const hipsY = worldY('hips');
  const torso = headY - hipsY;
  // Coronilla desde la caja del modelo (en reposo): incluye el pelo, que una
  // estimación desde el hueso de la cabeza no ve.
  const top = new THREE.Box3().setFromObject(vrm.scene).max.y + torso * 0.04;
  const bottom = hipsY + torso * 0.2;
  const centerY = (top + bottom) / 2;
  const halfHeight = ((top - bottom) / 2) * 1.05;
  const halfWidth = torso * 0.75;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  const frame = () => {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(halfHeight / tanHalf, halfWidth / (tanHalf * camera.aspect));
    camera.position.set(0, centerY, distance);
    camera.lookAt(0, centerY, 0);
  };

  return {
    vrm,
    rig,
    render(deltaSeconds: number) {
      vrm.update(Math.min(deltaSeconds, MAX_PHYSICS_DELTA));
      renderer.render(scene, camera);
    },
    resize(width: number, height: number) {
      renderer.setPixelRatio(renderScale());
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frame();
    },
    dispose() {
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
    },
  };
}
