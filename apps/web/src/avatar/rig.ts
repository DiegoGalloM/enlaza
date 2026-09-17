import * as THREE from 'three';
import {
  VRMHumanBoneList,
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere,
  type VRM,
  type VRMSpringBoneColliderGroup,
} from '@pixiv/three-vrm';

/**
 * Medidas del modelo en reposo que necesita el retargeting: dónde está cada
 * articulación, hacia dónde apunta cada hueso y qué volumen ocupa el cuerpo.
 *
 * Antes el retargeting suponía un rig ideal (brazos exactamente en ±X, dedos
 * rectos). Los modelos reales no lo son —el pulgar de VRoid sale en diagonal,
 * los dedos van abiertos—, y esa diferencia se veía como dedos torcidos. Se
 * mide una vez al cargar y se usa como pose de referencia.
 *
 * Todo en coordenadas de mundo del rig normalizado en T-pose (rotaciones
 * locales en identidad), así que "mundo en reposo" y "local" coinciden en
 * orientación para cualquier hueso.
 */
export interface AvatarRig {
  /** Posición de la articulación en reposo. */
  position(bone: string): THREE.Vector3;
  /** Dirección unitaria del hueso hacia su hijo (o su extremo `_end`). */
  direction(bone: string): THREE.Vector3;
  /** Punta del hueso en reposo: su hijo, o su extremo `_end` en las distales. */
  tip(bone: string): THREE.Vector3;
  body: BodyProfile;
}

/**
 * Sección del torso y la cabeza por franjas de altura, como elipses en XZ:
 * suficiente para empujar una mano hacia afuera del cuerpo sin un motor de
 * colisiones. Se mide sobre la malla real (piel, ropa y cara; sin pelo).
 */
export interface BodyProfile {
  minY: number;
  step: number;
  /** Por franja: centro en z, semieje en x y semieje en z; NaN si vacía. */
  centerZ: number[];
  halfWidth: number[];
  halfDepth: number[];
}

const CHILD: Record<string, string> = {
  UpperArm: 'LowerArm',
  LowerArm: 'Hand',
  Hand: 'MiddleProximal',
  ThumbMetacarpal: 'ThumbProximal',
  ThumbProximal: 'ThumbDistal',
  IndexProximal: 'IndexIntermediate',
  IndexIntermediate: 'IndexDistal',
  MiddleProximal: 'MiddleIntermediate',
  MiddleIntermediate: 'MiddleDistal',
  RingProximal: 'RingIntermediate',
  RingIntermediate: 'RingDistal',
  LittleProximal: 'LittleIntermediate',
  LittleIntermediate: 'LittleDistal',
};

export function measureRig(vrm: VRM): AvatarRig {
  // Todo se lee AQUÍ, con el modelo en reposo, y se guarda. Leerlo después
  // (perezosamente) devolvía posiciones de la pose animada: el retargeting de
  // una seña posterior quedaba con direcciones de reposo falsas.
  vrm.scene.updateMatrixWorld(true);
  const positions = new Map<string, THREE.Vector3>();
  const ends = new Map<string, THREE.Vector3>();
  for (const bone of VRMHumanBoneList) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone);
    if (node) positions.set(bone, node.getWorldPosition(new THREE.Vector3()));
    // Falanges distales: la punta es el nodo `_end` hijo del hueso crudo.
    const end = vrm.humanoid.getRawBoneNode(bone)?.children.find((c) => c.name.endsWith('_end'));
    if (end) ends.set(bone, end.getWorldPosition(new THREE.Vector3()));
  }

  const position = (bone: string) => positions.get(bone) ?? new THREE.Vector3();

  const direction = (bone: string): THREE.Vector3 => {
    const side = bone.startsWith('left') ? 'left' : 'right';
    const part = bone.slice(side.length);
    const child = CHILD[part];
    const tip = child ? positions.get(side + child) : ends.get(bone);
    if (!tip || !positions.has(bone)) {
      const parentPart = Object.keys(CHILD).find((k) => CHILD[k] === part);
      return parentPart
        ? direction(side + parentPart)
        : new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0);
    }
    return tip.clone().sub(position(bone)).normalize();
  };

  const tip = (bone: string): THREE.Vector3 => {
    const side = bone.startsWith('left') ? 'left' : 'right';
    const child = CHILD[bone.slice(side.length)];
    const found = child ? positions.get(side + child) : ends.get(bone);
    return (found ?? position(bone)).clone();
  };

  return { position, direction, tip, body: measureBody(vrm, position) };
}

function measureBody(vrm: VRM, position: (bone: string) => THREE.Vector3): BodyProfile {
  const step = 0.02;
  const minY = position('hips').y - 0.1;
  const maxY = new THREE.Box3().setFromObject(vrm.scene).max.y;
  const bins = Math.ceil((maxY - minY) / step);
  const minZ = new Array<number>(bins).fill(Infinity);
  const maxZ = new Array<number>(bins).fill(-Infinity);
  const maxX = new Array<number>(bins).fill(0);

  // Tope lateral: la articulación del hombro queda por dentro de la camisa,
  // así que se permite un poco más allá de ella, pero no el brazo extendido.
  const maxAbsX = Math.abs(position('leftUpperArm').x) + 0.07;

  const v = new THREE.Vector3();
  vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Solo piel y ropa (convención de nombres de VRoid): el pelo se mueve
    // con física y las cejas/ojos no aportan volumen.
    if (!materials.some((m) => /SKIN|CLOTH/.test(m.name))) return;
    const skinIndex = mesh.isSkinnedMesh ? mesh.geometry.getAttribute('skinIndex') : null;
    const skinWeight = mesh.isSkinnedMesh ? mesh.geometry.getAttribute('skinWeight') : null;
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      // Los brazos (extendidos en T-pose) no son parte del volumen del torso:
      // se descartan los vértices cuyo hueso dominante es de brazo o mano.
      if (skinIndex && skinWeight) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
        const boneName = mesh.skeleton.bones[skinIndex.getComponent(i, best)]?.name ?? '';
        if (ARM_BONE.test(boneName)) continue;
      }
      mesh.getVertexPosition(i, v);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      const bin = Math.floor((v.y - minY) / step);
      if (bin < 0 || bin >= bins || Math.abs(v.x) > maxAbsX) continue;
      minZ[bin] = Math.min(minZ[bin], v.z);
      maxZ[bin] = Math.max(maxZ[bin], v.z);
      maxX[bin] = Math.max(maxX[bin], Math.abs(v.x));
    }
  });

  // Franjas con pocos vértices subestiman el volumen: cada franja toma el
  // envolvente de ella y sus vecinas.
  const around = <T>(arr: T[], i: number) => arr.slice(Math.max(0, i - 1), i + 2);
  const lo = minZ.map((_, i) => Math.min(...around(minZ, i)));
  const hi = maxZ.map((_, i) => Math.max(...around(maxZ, i)));
  const wide = maxX.map((_, i) => Math.max(...around(maxX, i)));
  const empty = (i: number) => lo[i] === Infinity;

  return {
    minY,
    step,
    centerZ: lo.map((z, i) => (empty(i) ? NaN : (z + hi[i]) / 2)),
    halfWidth: wide.map((x, i) => (empty(i) ? NaN : x)),
    halfDepth: lo.map((z, i) => (empty(i) ? NaN : (hi[i] - z) / 2)),
  };
}

const SLEEVE_SCALE = 1.8;
/**
 * Gravedad de los mechones largos. El modelo trae 0.1 en el pelo de atrás y 0
 * en los dos mechones del frente, con rigidez 0.5: el mechón conserva su forma
 * respecto a la cabeza, y cuando la seña inclina la cabeza (Por favor) giraba
 * entero y quedaba en diagonal, "flotando". Con 0.3 cae hacia abajo como pelo
 * real. Solo en los mechones largos: en el flequillo la misma gravedad lo
 * tiraba sobre los ojos. Elegido comparando 0.1/0.3/0.6/1.0 en Hola y Por favor.
 */
const LONG_HAIR_GRAVITY = 0.3;
/**
 * En este modelo (medido): J_Sec_Hair*_01..04 son el flequillo corto,
 * _05..10 el pelo de atrás y _11/_12 los mechones largos del frente.
 */
const FIRST_LONG_STRAND = 5;
const SLEEVE_SCALED = new WeakSet<object>();

/** Huesos de brazo y mano, incluidos los secundarios de las mangas (J_Sec_*Arm*). */
const ARM_BONE = /Arm|Hand|Thumb|Index|Middle|Ring|Little/;

/**
 * Cuánto hay que mover `p` hacia el frente (+z) para que quede fuera del
 * cuerpo con `margin` de holgura. 0 si ya está afuera.
 */
export function forwardPushOut(body: BodyProfile, p: THREE.Vector3, margin: number): number {
  const bin = Math.floor((p.y - body.minY) / body.step);
  const hw = body.halfWidth[bin] + margin;
  const hd = body.halfDepth[bin] + margin;
  const cz = body.centerZ[bin];
  if (!(hw > margin) || Number.isNaN(cz)) return 0;
  const nx = p.x / hw;
  if (Math.abs(nx) >= 1) return 0;
  const front = cz + hd * Math.sqrt(1 - nx * nx);
  const back = cz - hd * Math.sqrt(1 - nx * nx);
  return p.z < front && p.z > back ? front - p.z : 0;
}

/**
 * Colliders para el pelo que siguen la silueta medida (con ropa), no las
 * esferas genéricas del modelo. Los de VRoid cubren columna, pecho alto,
 * cuello, cabeza y brazos, pero no hombros ni el frente del pecho con la
 * camisa holgada: por ahí el pelo largo se metía en la tela.
 *
 * Esferas chicas apoyadas por dentro de la superficie, al frente y atrás de
 * cada franja. Esferas y no cápsulas horizontales porque una cápsula con el
 * radio de la profundidad del torso sobresale por arriba del hombro y deja el
 * pelo flotando.
 */
export function addHairColliders(vrm: VRM, rig: AvatarRig): number {
  const manager = vrm.springBoneManager;
  const anchor = vrm.humanoid.getRawBoneNode('upperChest') ?? vrm.humanoid.getRawBoneNode('chest');
  if (!manager || !anchor) return 0;

  const { body } = rig;
  const radius = 0.03;
  const spacing = 0.035;
  const fromY = rig.position('hips').y;
  const toY = rig.position('neck').y;
  const colliders: VRMSpringBoneCollider[] = [];
  anchor.updateWorldMatrix(true, false);

  for (let bin = 0; bin < body.centerZ.length; bin += 2) {
    const y = body.minY + (bin + 0.5) * body.step;
    const hw = body.halfWidth[bin];
    const hd = body.halfDepth[bin];
    const cz = body.centerZ[bin];
    if (y < fromY || y > toY || Number.isNaN(cz) || hw < radius) continue;
    const columns = Math.max(1, Math.round((2 * hw) / spacing));
    for (let c = 0; c <= columns; c++) {
      const x = -hw + (2 * hw * c) / columns;
      const depth = hd * Math.sqrt(Math.max(0, 1 - (x / hw) ** 2));
      for (const face of [1, -1]) {
        const surface = new THREE.Vector3(x, y, cz + face * Math.max(depth - radius, 0));
        const shape = new VRMSpringBoneColliderShapeSphere({
          radius,
          offset: anchor.worldToLocal(surface),
        });
        const collider = new VRMSpringBoneCollider(shape);
        anchor.add(collider);
        collider.updateWorldMatrix(true, false); // el torso no se anima: basta una vez
        colliders.push(collider);
      }
    }
  }

  // Las mangas de la camisa son más holgadas que las cápsulas de brazo del
  // modelo: se engrosan para el pelo (solo el pelo usa esos grupos).
  for (const joint of manager.joints) {
    if (!/hair/i.test(joint.bone.name)) continue;
    for (const g of joint.colliderGroups) {
      for (const c of g.colliders) {
        const shape = c.shape as { radius?: number };
        if (/UpperArm/.test(c.parent?.name ?? '') && shape.radius && !SLEEVE_SCALED.has(c)) {
          shape.radius *= SLEEVE_SCALE;
          SLEEVE_SCALED.add(c);
        }
      }
    }
  }


  // Mechones largos con más gravedad (ver LONG_HAIR_GRAVITY). El flequillo no.
  for (const joint of manager.joints) {
    const strand = /Hair\d+_(\d+)/.exec(joint.bone.name);
    if (strand && Number(strand[1]) >= FIRST_LONG_STRAND) {
      joint.settings.gravityPower = Math.max(joint.settings.gravityPower, LONG_HAIR_GRAVITY);
    }
  }
  const group: VRMSpringBoneColliderGroup = { name: 'enlaza-torso', colliders };
  for (const joint of manager.joints) {
    if (/hair/i.test(joint.bone.name)) joint.colliderGroups.push(group);
  }
  return colliders.length;
}
