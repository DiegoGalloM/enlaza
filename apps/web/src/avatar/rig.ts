import * as THREE from 'three';
import {
  VRMHumanBoneList,
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere,
  type VRM,
  type VRMHumanBoneName,
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
  /** Superficie de la cara alrededor de la boca, para contactos (A35). */
  face?: FaceProfile;
}

/**
 * Relieve de la cara alrededor de la boca, en reposo: para llevar una yema a
 * tocar los labios o el mentón (Gracias). La silueta de BodyProfile no sirve:
 * sus franjas toman el envolvente de las vecinas y a la altura de los labios
 * ya incluyen la nariz, 1.5 cm más adelante.
 */
export interface FaceProfile {
  /** Centro de la boca (vértices que mueve el morph de boca abierta). */
  mouth: THREE.Vector3;
  /** z de la piel más adelantada en (x, y) de mundo en reposo; NaN fuera de la cara. */
  frontZ(x: number, y: number): number;
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

  return { position, direction, tip, body: measureBody(vrm, position), face: measureFace(vrm) };
}

/** Posiciones de mundo en reposo de cada vértice de las mallas que cumplen `accept`. */
function forEachVertex(
  vrm: VRM,
  accept: (mesh: THREE.Mesh) => boolean,
  visit: (v: THREE.Vector3, mesh: THREE.Mesh, i: number) => void,
): void {
  const v = new THREE.Vector3();
  vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isMesh || !accept(mesh)) return;
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, v);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      visit(v, mesh, i);
    }
  });
}

/** Rejilla del relieve de la cara: celdas de 5 mm, de -6 a 6 cm en x y de -7 a 5 cm en y desde la boca. */
const FACE_CELL = 0.005;
const FACE_X = [-0.06, 0.06];
const FACE_Y = [-0.07, 0.05];

function measureFace(vrm: VRM): FaceProfile | undefined {
  const isSkin = (mesh: THREE.Mesh) =>
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => /SKIN/.test(m.name));

  // Boca: vértices de piel que desplaza el morph de boca abierta (VRoid: *Fcl_MTH_A).
  const mouth = new THREE.Vector3();
  let n = 0;
  forEachVertex(
    vrm,
    (mesh) => isSkin(mesh) && Object.keys(mesh.morphTargetDictionary ?? {}).some((k) => /MTH_A$/.test(k)),
    (v, mesh, i) => {
      const key = Object.keys(mesh.morphTargetDictionary!).find((k) => /MTH_A$/.test(k))!;
      const morph = mesh.geometry.morphAttributes.position?.[mesh.morphTargetDictionary![key]];
      if (!morph || Math.hypot(morph.getX(i), morph.getY(i), morph.getZ(i)) < 0.002) return;
      mouth.add(v);
      n++;
    },
  );
  if (n === 0) return undefined;
  mouth.multiplyScalar(1 / n);

  const cols = Math.round((FACE_X[1] - FACE_X[0]) / FACE_CELL) + 1;
  const rows = Math.round((FACE_Y[1] - FACE_Y[0]) / FACE_CELL) + 1;
  const grid = new Array<number>(cols * rows).fill(-Infinity);
  const cell = (x: number, y: number) => {
    const c = Math.round((x - mouth.x - FACE_X[0]) / FACE_CELL);
    const r = Math.round((y - mouth.y - FACE_Y[0]) / FACE_CELL);
    return c < 0 || c >= cols || r < 0 || r >= rows ? -1 : r * cols + c;
  };
  // La malla de la cara es más gruesa que 5 mm: cada vértice cubre también
  // las celdas vecinas, y los huecos que queden toman el máximo de su entorno.
  // Sin eso había celdas vacías justo en los labios y el contacto se perdía
  // en frames sueltos.
  forEachVertex(vrm, isSkin, (v) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = cell(v.x + dx * FACE_CELL, v.y + dy * FACE_CELL);
        if (k >= 0) grid[k] = Math.max(grid[k], v.z);
      }
    }
  });
  for (let pass = 0; pass < 3; pass++) {
    const prev = grid.slice();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (prev[r * cols + c] !== -Infinity) continue;
        let best = -Infinity;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) best = Math.max(best, prev[rr * cols + cc]);
        }
        grid[r * cols + c] = best;
      }
    }
  }
  return {
    mouth,
    frontZ(x, y) {
      const k = cell(x, y);
      return k < 0 || grid[k] === -Infinity ? NaN : grid[k];
    },
  };
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
 * El antebrazo del modelo tiene una cápsula de 2.9 cm para el pelo, justo su
 * radio: los segmentos del mechón (de ~10 cm, solo se corrige la punta) lo
 * cruzaban cuando el antebrazo pasa por delante del pecho.
 */
const FOREARM_HAIR_SCALE = 1.4;
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
 * Cuánto está `p` dentro del cuerpo (0 si afuera), en metros aproximados: la
 * fracción de radio que le falta para salir de la elipse de su franja, por el
 * semieje menor. No supone que se sale por el frente, así que sirve para
 * comparar poses en las que el codo sale por el costado.
 */
export function bodyPenetration(body: BodyProfile, p: THREE.Vector3, margin: number): number {
  const bin = Math.floor((p.y - body.minY) / body.step);
  const hw = body.halfWidth[bin] + margin;
  const hd = body.halfDepth[bin] + margin;
  const cz = body.centerZ[bin];
  if (!(hw > margin) || Number.isNaN(cz)) return 0;
  const r = Math.hypot(p.x / hw, (p.z - cz) / hd);
  return r < 1 ? (1 - r) * Math.min(hw, hd) : 0;
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
        colliders.push(collider);
      }
    }
  }

  // Las mangas de la camisa son más holgadas que las cápsulas de brazo del
  // modelo, y el antebrazo cruza el mechón: se engrosan para el pelo (solo el
  // pelo usa esos grupos).
  for (const joint of manager.joints) {
    if (!/hair/i.test(joint.bone.name)) continue;
    for (const g of joint.colliderGroups) {
      for (const c of g.colliders) {
        const shape = c.shape as { radius?: number };
        const parent = c.parent?.name ?? '';
        const scale = /UpperArm/.test(parent) ? SLEEVE_SCALE : /LowerArm/.test(parent) ? FOREARM_HAIR_SCALE : 1;
        if (scale !== 1 && shape.radius && !SLEEVE_SCALED.has(c)) {
          shape.radius *= scale;
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
  const groups: VRMSpringBoneColliderGroup[] = [
    { name: 'enlaza-torso', colliders },
    { name: 'enlaza-manos', colliders: handColliders(vrm, rig) },
  ];
  for (const joint of manager.joints) {
    if (/hair/i.test(joint.bone.name)) joint.colliderGroups.push(...groups);
  }
  // three-vrm solo actualiza cada frame la matriz de los colliders que ya
  // existían cuando ordenó las articulaciones (al cargar). Los agregados aquí
  // quedaban congelados en la pose de reposo: las esferas de mano se quedaban
  // en la T-pose y las del torso no seguían la respiración. Volver a agregar
  // una articulación existente (addJoint es idempotente) fuerza a reordenar.
  const [first] = manager.joints;
  if (first) manager.addJoint(first);
  return colliders.length;
}

/**
 * Esferas de mano para el pelo: palma, nudillos y dedos. El modelo solo trae
 * una esfera de 3 cm en la muñeca, así que el resto de la mano atravesaba el
 * pelo; en Por favor el mechón largo del frente pasaba por en medio del puño
 * apoyado en el pecho. Cuelgan de los huesos crudos, así que siguen la mano y
 * la flexión de los dedos.
 */
function handColliders(vrm: VRM, rig: AvatarRig): VRMSpringBoneCollider[] {
  const spheres: [string, string, number, number][] = [
    // [hueso ancla, hueso hacia el que se desplaza, fracción, radio]
    ['Hand', 'MiddleProximal', 0.55, 0.035],
    ['IndexProximal', 'IndexProximal', 0, 0.02],
    ['MiddleProximal', 'MiddleIntermediate', 0.5, 0.02],
    ['LittleProximal', 'LittleProximal', 0, 0.02],
    ['MiddleIntermediate', 'MiddleIntermediate', 0, 0.018],
  ];
  const colliders: VRMSpringBoneCollider[] = [];
  for (const side of ['left', 'right'] as const) {
    for (const [anchorBone, towardBone, fraction, radius] of spheres) {
      const anchor = vrm.humanoid.getRawBoneNode(`${side}${anchorBone}` as VRMHumanBoneName);
      if (!anchor) continue;
      anchor.updateWorldMatrix(true, false);
      const at = rig
        .position(`${side}${anchorBone}`)
        .clone()
        .lerp(rig.position(`${side}${towardBone}`), fraction);
      const shape = new VRMSpringBoneColliderShapeSphere({ radius, offset: anchor.worldToLocal(at) });
      const collider = new VRMSpringBoneCollider(shape);
      anchor.add(collider);
      colliders.push(collider);
    }
  }
  return colliders;
}
