
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FAVORITE_COLORS, MiiGender, MiiInfo } from './MiiData.js';
import { loadModel } from './MiiStore.js';
import { DepthCapture } from './DepthCapture.js';
import { vec3 } from 'gl-matrix';
import type { Viewer, ViewerOverlay, ViewerRenderInput } from '../viewer.js';

export type BodyModel = 'miitomo' | 'wiiu';

export const BODY_MODEL_BASE_URL = 'https://raw.githubusercontent.com/datkat21/mii-creator/dev/public/assets/models';
export const DEFAULT_RENDERER_URL = 'https://mii-renderer.nxw.pw/miis/image';
export const ALT_RENDERER_URL = 'https://mii-unsecure.ariankordi.net/miis/image';

// Face ids starting with this are PNG pictures in the model store, not .glb exports.
export const IMAGE_FACE_PREFIX = 'img:';

// Mi Creator's expressions; `num` is its expression number, used by the all-emotions import.
export const EXPRESSIONS: { id: string, num: number, name: string }[] = [
    { id: 'normal', num: 0, name: 'Normal' },
    { id: 'smile', num: 1, name: 'Sourire' },
    { id: 'anger', num: 2, name: 'Colère' },
    { id: 'sorrow', num: 3, name: 'Tristesse' },
    { id: 'surprise', num: 4, name: 'Surprise' },
    { id: 'blink', num: 5, name: 'Yeux fermés' },
    { id: 'normal_open_mouth', num: 6, name: 'Normal (bouche ouverte)' },
    { id: 'smile_open_mouth', num: 7, name: 'Sourire (bouche ouverte)' },
    { id: 'anger_open_mouth', num: 8, name: 'Colère (bouche ouverte)' },
    { id: 'sorrow_open_mouth', num: 9, name: 'Tristesse (bouche ouverte)' },
    { id: 'surprise_open_mouth', num: 10, name: 'Surprise (bouche ouverte)' },
    { id: 'blink_open_mouth', num: 11, name: 'Yeux fermés (bouche ouverte)' },
    { id: 'wink_left', num: 12, name: 'Clin d\'œil gauche' },
    { id: 'wink_right', num: 13, name: 'Clin d\'œil droit' },
    { id: 'wink_left_open_mouth', num: 14, name: 'Clin d\'œil gauche (bouche ouverte)' },
    { id: 'wink_right_open_mouth', num: 15, name: 'Clin d\'œil droit (bouche ouverte)' },
    { id: 'like_wink_left', num: 16, name: 'Clin d\'œil souriant gauche' },
    { id: 'like_wink_right', num: 17, name: 'Clin d\'œil souriant droit' },
    { id: 'frustrated', num: 18, name: 'Frustré' },
    { id: '19', num: 19, name: 'Ennuyé' },
    { id: '20', num: 20, name: 'Ennuyé (bouche ouverte)' },
    { id: '21', num: 21, name: 'Soupir (bouche droite)' },
    { id: '22', num: 22, name: 'Soupir' },
    { id: '23', num: 23, name: 'Dégoûté (bouche droite)' },
    { id: '24', num: 24, name: 'Dégoûté' },
    { id: '25', num: 25, name: 'Amoureux' },
    { id: '26', num: 26, name: 'Amoureux (bouche ouverte)' },
    { id: '27', num: 27, name: 'Déterminé (bouche droite)' },
    { id: '28', num: 28, name: 'Déterminé' },
    { id: '29', num: 29, name: 'Pleure (bouche droite)' },
    { id: '30', num: 30, name: 'Pleure' },
    { id: '31', num: 31, name: 'Grand sourire (bouche droite)' },
    { id: '32', num: 32, name: 'Grand sourire' },
    { id: '33', num: 33, name: 'Coquin' },
    { id: '34', num: 34, name: 'Coquin (miroir)' },
    { id: '35', num: 35, name: 'Résolu, bouche rigolote' },
    { id: '36', num: 36, name: 'Résolu, bouche rigolote ouverte' },
    { id: '37', num: 37, name: 'Fier' },
    { id: '38', num: 38, name: 'Fier (bouche ouverte)' },
    { id: '39', num: 39, name: 'Résolu' },
    { id: '40', num: 40, name: 'Résolu (bouche ouverte)' },
    { id: '41', num: 41, name: 'Incrédule' },
    { id: '43', num: 43, name: 'Rusé' },
    { id: '45', num: 45, name: 'Tire la langue' },
    { id: '47', num: 47, name: 'Innocent' },
    { id: '48', num: 48, name: 'Innocent (miroir)' },
    { id: '49', num: 49, name: 'Chat' },
    { id: '51', num: 51, name: 'Chien' },
    { id: '53', num: 53, name: 'Miam' },
    { id: '55', num: 55, name: 'Argent (bouche droite)' },
    { id: '56', num: 56, name: 'Argent' },
    { id: '57', num: 57, name: 'Perdu (bouche droite)' },
    { id: '58', num: 58, name: 'Perdu' },
    { id: '59', num: 59, name: 'Joyeux (bouche droite)' },
    { id: '60', num: 60, name: 'Joyeux' },
    { id: '61', num: 61, name: 'Vide' },
    { id: '63', num: 63, name: 'Grognon (bouche droite)' },
    { id: '64', num: 64, name: 'Grognon' },
    { id: '65', num: 65, name: 'Ému (bouche droite)' },
    { id: '66', num: 66, name: 'Ému (supplie)' },
    { id: '67', num: 67, name: 'Chante (petite bouche)' },
    { id: '68', num: 68, name: 'Chante' },
    { id: '69', num: 69, name: 'Sidéré' },
    { id: '70', num: 70, name: 'Démotivé' },
    { id: '71', num: 71, name: 'Rusé 2' },
    { id: '72', num: 72, name: 'Repu' },
    { id: '73', num: 73, name: 'Endormi' },
    { id: '74', num: 74, name: 'Endormi (œil droit ouvert)' },
    { id: '75', num: 75, name: 'Perdu 2' },
    { id: '76', num: 76, name: 'Étourdi' },
    { id: '77', num: 77, name: 'Clin d\'œil joyeux' },
    { id: '78', num: 78, name: 'Clin d\'œil joyeux (miroir)' },
    { id: '79', num: 79, name: 'Pas intéressé' },
    { id: '80', num: 80, name: 'Espiègle' },
    { id: '81', num: 81, name: 'Furieux' },
];

// What each Miitomo body clip looks like, so poses can be picked without trying them all.
const MIITOMO_POSE_NAMES: Record<string, string> = {
    'Wait': 'Attente (debout)',
    'Finish': 'Salut de la main',
    'Pose.01': 'Debout, bras le long du corps',
    'Pose.02': 'Bras écartés',
    'Pose.03': 'Main sur le cœur',
    'Pose.04': 'Coucou (main levée)',
    'Pose.05': 'Bras croisés',
    'Pose.06': 'Un bras levé au ciel',
    'Pose.07': 'Montre du doigt, main sur la hanche',
    'Pose.08': 'Deux bras en l\'air',
    'Pose.09': 'Montre ses muscles',
    'Pose.10': 'Mains devant la bouche',
    'Pose.11': 'Genou levé (course)',
    'Pose.12': 'Mains sur les hanches, se penche',
    'Pose.13': 'Coup de poing',
    'Pose.14': 'Main au menton (réfléchit)',
    'Pose.15': 'Bras en croix sur une jambe',
    'Pose.16': 'Dos voûté (fatigué)',
};

export function animationDisplayName(clip: string, bodyModel: BodyModel = 'miitomo'): string {
    const desc = bodyModel === 'miitomo' ? MIITOMO_POSE_NAMES[clip] : undefined;
    if (clip === 'Wait') return desc ?? 'Attente';
    if (clip === 'Finish') return desc ?? 'Victoire';
    const m = clip.match(/^Pose\.(\d+)$/);
    if (m !== null) return desc !== undefined ? `Pose ${parseInt(m[1], 10)} · ${desc}` : `Pose ${parseInt(m[1], 10)}`;
    return clip;
}

export function animationSortKey(clip: string): number {
    if (clip === 'Wait') return -2;
    if (clip === 'Finish') return -1;
    const m = clip.match(/^Pose\.(\d+)$/);
    return m !== null ? parseInt(m[1], 10) : 1000;
}

export interface LightSettings {
    // Directional light, in degrees: azimuth around the vertical axis, elevation above the horizon.
    intensity: number;
    azimuth: number;
    elevation: number;
    color: string;
    ambient: number;
    shadow: boolean;
    shadowOpacity: number;
}

// Uniforms of the shadow catcher, filled from the scenery depth snapshot and the Mii light.
const depthUniforms = {
    uMiiDepth: { value: null as THREE.Texture | null },
    uMiiClipFromWorld: { value: new THREE.Matrix4() },
    uMiiWorldFromClip: { value: new THREE.Matrix4() },
    uMiiDepthNegOne: { value: 0 },
    uMiiDepthEnabled: { value: 0 },
    uMiiCamWorldFromClip: { value: new THREE.Matrix4() },
    uMiiCamPos: { value: new THREE.Vector3() },
    uMiiResolution: { value: new THREE.Vector2(1, 1) },
    uMiiShadowMatrix: { value: new THREE.Matrix4() },
    uMiiGroundY: { value: 0 },
};

// Draws the Miis' shadows on whatever scenery is seen at each pixel (slopes, steps, walls),
// and nothing over the void. It covers the whole screen and is drawn before the Miis.
// Without a depth snapshot (WebGPU), it falls back to a flat ground under the lowest Mii.
function createShadowCatcher(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> {
    const mat = new THREE.ShadowMaterial({ opacity: DEFAULT_LIGHT.shadowOpacity, depthWrite: false, depthTest: false });
    // Drawn first among the opaque objects onto the cleared overlay, so no blending is needed and the Miis cover it.
    mat.transparent = false;
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, depthUniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <project_vertex>', '#include <project_vertex>\n\tgl_Position = vec4(position.xy, 0.0, 1.0);');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <shadowmask_pars_fragment>', 'vec4 miiShadowCoord;\n' +
                THREE.ShaderChunk.shadowmask_pars_fragment.replace(/vDirectionalShadowCoord\[ i \]/g, 'miiShadowCoord'))
            .replace('void main() {', `
uniform sampler2D uMiiDepth;
uniform mat4 uMiiClipFromWorld;
uniform mat4 uMiiWorldFromClip;
uniform float uMiiDepthNegOne;
uniform float uMiiDepthEnabled;
uniform mat4 uMiiCamWorldFromClip;
uniform vec3 uMiiCamPos;
uniform vec2 uMiiResolution;
uniform mat4 uMiiShadowMatrix;
uniform float uMiiGroundY;

vec3 miiDepthPoint(ivec2 texel, vec2 size, float d) {
\tvec2 ndc = (vec2(texel) + 0.5) / size * 2.0 - 1.0;
\tvec4 m = uMiiWorldFromClip * vec4(ndc, uMiiDepthNegOne > 0.5 ? d * 2.0 - 1.0 : d, 1.0);
\treturn m.xyz / m.w;
}

// Scenery point seen at this uv of the depth snapshot, or w = 0 for the void. The snapshot is at half
// resolution, so neighbouring texels are blended on smooth surfaces to keep the shadow's edges clean.
vec4 miiSceneryAt(vec2 uv) {
\tif (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
\tvec2 size = vec2(textureSize(uMiiDepth, 0));
\tvec2 f = uv * size - 0.5;
\tivec2 i0 = ivec2(floor(f));
\tvec2 t = f - floor(f);
\tivec2 maxTexel = ivec2(size) - 1;
\tivec2 a = clamp(i0, ivec2(0), maxTexel), b = clamp(i0 + ivec2(1, 0), ivec2(0), maxTexel);
\tivec2 c = clamp(i0 + ivec2(0, 1), ivec2(0), maxTexel), e = clamp(i0 + ivec2(1, 1), ivec2(0), maxTexel);
\tfloat da = texelFetch(uMiiDepth, a, 0).r, db = texelFetch(uMiiDepth, b, 0).r;
\tfloat dc = texelFetch(uMiiDepth, c, 0).r, de = texelFetch(uMiiDepth, e, 0).r;
\tivec2 nearest = clamp(ivec2(floor(uv * size)), ivec2(0), maxTexel);
\tfloat dn = texelFetch(uMiiDepth, nearest, 0).r;
\tif (dn <= 0.0) return vec4(0.0);
\tvec3 pn = miiDepthPoint(nearest, size, dn);
\tif (da <= 0.0 || db <= 0.0 || dc <= 0.0 || de <= 0.0) return vec4(pn, 1.0);
\tvec3 pa = miiDepthPoint(a, size, da), pb = miiDepthPoint(b, size, db);
\tvec3 pc = miiDepthPoint(c, size, dc), pe = miiDepthPoint(e, size, de);
\tvec3 p = mix(mix(pa, pb, t.x), mix(pc, pe, t.x), t.y);
\t// Across a depth edge, blending would invent a point in mid-air.
\tfloat spread = max(max(distance(pa, pb), distance(pc, pe)), max(distance(pa, pc), distance(pb, pe)));
\tif (spread > 0.05 * distance(pn, uMiiCamPos)) return vec4(pn, 1.0);
\treturn vec4(p, 1.0);
}

void main() {
\tvec2 ndc = gl_FragCoord.xy / uMiiResolution * 2.0 - 1.0;
\tvec4 far = uMiiCamWorldFromClip * vec4(ndc, 1.0, 1.0);
\tvec3 ray = normalize(far.xyz / far.w - uMiiCamPos);
\tvec3 p;
\tif (uMiiDepthEnabled > 0.5) {
\t\tvec4 s = miiSceneryAt(ndc * 0.5 + 0.5);
\t\tif (s.w == 0.0) discard;
\t\t// The snapshot can be a frame or two old: look again where this pixel's ray is at that distance.
\t\tvec4 c = uMiiClipFromWorld * vec4(uMiiCamPos + ray * distance(s.xyz, uMiiCamPos), 1.0);
\t\tif (c.w > 0.0) {
\t\t\tvec4 s2 = miiSceneryAt(c.xy / c.w * 0.5 + 0.5);
\t\t\tif (s2.w > 0.0) s = s2;
\t\t}
\t\tp = s.xyz;
\t} else {
\t\tif (ray.y > -1e-4) discard;
\t\tp = uMiiCamPos + ray * ((uMiiGroundY - uMiiCamPos.y) / ray.y);
\t}
\tmiiShadowCoord = uMiiShadowMatrix * vec4(p, 1.0);`);
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
}

export const DEFAULT_LIGHT: LightSettings = {
    intensity: 1.6, azimuth: 30, elevation: 60, color: '#ffffff', ambient: 1.6, shadow: true, shadowOpacity: 0.45,
};

export interface MiiStep {
    time: number;
    animation: string;
    expression: string;
}

export interface MiiActorState {
    name: string;
    data: string;
    miic?: string;
    gender: MiiGender;
    favoriteColor: number;
    height: number;
    build: number;
    bodyModel: BodyModel;
    position: [number, number, number];
    yaw: number;
    size: number;
    visible: boolean;
    steps: MiiStep[];
    // A full-body model exported from Mi Creator, and one export per extra expression (only its face is used).
    model?: string;
    faces?: Record<string, string>;
}

interface BodyTemplate {
    gltf: GLTF;
    height: number;
}

const HEAD_SCALE = 0.12;
const PANTS_COLOR = 0x404048;

export class MiiActor {
    public root = new THREE.Group();
    public bodyGroup = new THREE.Group();
    public body: THREE.Object3D | null = null;
    public mixer: THREE.AnimationMixer | null = null;
    public clips = new Map<string, THREE.AnimationClip>();
    public head: THREE.Object3D | null = null;
    public placeholderHead: THREE.Mesh;
    // Catches the Mii's shadow on the ground under its feet; only the shadow itself is drawn.
    public headError: string | null = null;
    public currentAnimation: string | null = null;
    public currentExpression: string | null = null;
    private currentAction: THREE.AnimationAction | null = null;
    private headBone: THREE.Object3D | null = null;
    private bodyHeight = 1;
    private loadingExpression: string | null = null;
    private failedExpressions = new Set<string>();
    private tmpMtx = new THREE.Matrix4();
    private tmpInv = new THREE.Matrix4();
    private tmpPos = new THREE.Vector3();
    private tmpQuat = new THREE.Quaternion();
    private tmpScale = new THREE.Vector3();

    constructor(private layer: MiiLayer, public state: MiiActorState) {
        this.root.add(this.bodyGroup);
        this.placeholderHead = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshLambertMaterial({ color: 0xF0C8A0 }));
        this.placeholderHead.visible = false;
        this.root.add(this.placeholderHead);
    }

    public isImported(): boolean {
        return this.state.model !== undefined;
    }

    public getExpressionIds(): string[] {
        if (!this.isImported())
            return EXPRESSIONS.map((e) => e.id);
        const faces = Object.keys(this.state.faces ?? {});
        return ['normal', ...faces.filter((f) => f !== 'normal')];
    }

    private maskMaterial: THREE.MeshStandardMaterial | null = null;
    private baseMask: THREE.Texture | null = null;

    private async loadImported(): Promise<void> {
        const template = await this.layer.getBodyTemplate(MiiGender.Male, this.state.bodyModel);
        const gltf = await this.layer.loadUserModel(this.state.model!);
        if (this.body !== null)
            this.bodyGroup.remove(this.body);
        if (this.head !== null)
            this.root.remove(this.head);
        this.head = null;

        this.body = SkeletonUtils.clone(gltf.scene);
        this.bodyHeight = this.layer.measureHeight(gltf.scene);
        this.clips.clear();
        // The exported skeleton has different units and proportions than the animated template,
        // so translation keys are rescaled per bone and scale keys are dropped.
        const ratios = new Map<string, number>();
        template.gltf.scene.traverse((tplBone) => {
            const bone = this.body!.getObjectByName(tplBone.name);
            const tplLen = tplBone.position.length();
            if (bone !== undefined && tplLen > 1e-4)
                ratios.set(tplBone.name, bone.position.length() / tplLen);
        });
        for (const clip of template.gltf.animations) {
            const c = clip.clone();
            c.tracks = c.tracks.filter((t) => {
                const [boneName, prop] = t.name.split('.');
                if (prop === 'scale')
                    return false;
                if (prop === 'position') {
                    const ratio = ratios.get(boneName);
                    if (ratio === undefined)
                        return false;
                    const values = t.values.slice();
                    for (let i = 0; i < values.length; i++)
                        values[i] *= ratio;
                    t.values = values;
                }
                return true;
            });
            this.clips.set(c.name, c);
        }

        this.maskMaterial = null;
        this.baseMask = null;
        this.body.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh)
                return;
            mesh.frustumCulled = false;
            const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
            if (mat.isMeshStandardMaterial) {
                mat.metalness = 0;
                mat.roughness = 1;
            }
            mesh.material = mat;
            if (mesh.name === 'Mask') {
                this.maskMaterial = mat;
                this.baseMask = mat.map;
            }
        });

        this.headBone = null;
        this.placeholderHead.visible = false;
        this.body.traverse((o) => { o.castShadow = true; });
        this.bodyGroup.add(this.body);
        this.mixer = new THREE.AnimationMixer(this.body);
        this.currentAction = null;
        this.currentAnimation = null;
        this.currentExpression = null;
        this.syncTransform();
        this.applyStepAt(this.layer.clock, true);
    }

    // Imported face pictures have no sampler of their own, so they take the export's.
    private matchMaskSampler(tex: THREE.Texture): void {
        const base = this.baseMask;
        if (base === null || tex === base || (tex.wrapS === base.wrapS && tex.wrapT === base.wrapT && tex.minFilter === base.minFilter && tex.magFilter === base.magFilter))
            return;
        tex.wrapS = base.wrapS;
        tex.wrapT = base.wrapT;
        tex.minFilter = base.minFilter;
        tex.magFilter = base.magFilter;
        tex.needsUpdate = true;
    }

    // The export's own face picture, to check how imported faces line up with it.
    public getBaseMaskImage(): CanvasImageSource | null {
        const img = this.baseMask?.image as CanvasImageSource | undefined;
        return img ?? null;
    }

    private setImportedFace(expression: string): void {
        if (this.maskMaterial === null)
            return;
        const faceId = this.state.faces?.[expression];
        if (faceId === undefined) {
            this.maskMaterial.map = this.baseMask;
            this.maskMaterial.needsUpdate = true;
            this.currentExpression = expression;
            return;
        }
        const cached = this.layer.getCachedFace(faceId);
        if (cached !== undefined) {
            this.matchMaskSampler(cached);
            this.maskMaterial.map = cached;
            this.maskMaterial.needsUpdate = true;
            this.currentExpression = expression;
            return;
        }
        if (this.loadingExpression === expression || this.failedExpressions.has(expression))
            return;
        this.loadingExpression = expression;
        this.layer.loadFace(faceId).then(() => {
            this.loadingExpression = null;
        }, (e: Error) => {
            this.loadingExpression = null;
            this.failedExpressions.add(expression);
            this.layer.onactorerror(this, `${e}`);
        });
    }

    public async load(): Promise<void> {
        if (this.isImported())
            return this.loadImported();
        const template = await this.layer.getBodyTemplate(this.state.gender, this.state.bodyModel);
        if (this.body !== null)
            this.bodyGroup.remove(this.body);

        this.body = SkeletonUtils.clone(template.gltf.scene);
        this.bodyHeight = template.height;
        this.clips.clear();
        for (const clip of template.gltf.animations)
            this.clips.set(clip.name, clip);

        const shirt = new THREE.MeshLambertMaterial({ color: FAVORITE_COLORS[this.state.favoriteColor] });
        const pants = new THREE.MeshLambertMaterial({ color: PANTS_COLOR });
        this.body.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh)
                return;
            mesh.frustumCulled = false;
            mesh.material = mesh.name.startsWith('legs') ? pants : shirt;
        });

        this.headBone = this.body.getObjectByName('head') ?? this.body.getObjectByName('Head') ?? null;
        this.body.traverse((o) => { o.castShadow = true; });
        this.bodyGroup.add(this.body);

        this.mixer = new THREE.AnimationMixer(this.body);
        this.currentAction = null;
        this.currentAnimation = null;
        this.syncTransform();
        this.applyStepAt(this.layer.clock, true);
    }

    public getAnimationNames(): string[] {
        return [...this.clips.keys()];
    }

    public syncTransform(): void {
        const s = this.state;
        this.root.position.set(s.position[0], s.position[1], s.position[2]);
        this.root.rotation.set(0, s.yaw * Math.PI / 180, 0);
        const scale = s.size / this.bodyHeight;
        this.root.scale.setScalar(scale);
        if (this.isImported()) {
            this.bodyGroup.scale.setScalar(1);
        } else {
            const heightFactor = 0.7 + 0.6 * (s.height / 127);
            const buildFactor = 0.8 + 0.4 * (s.build / 127);
            this.bodyGroup.scale.set(buildFactor, heightFactor, buildFactor);
        }
        this.root.visible = s.visible;
    }

    public getStepAt(time: number): MiiStep {
        const steps = this.state.steps;
        let active = steps[0];
        for (let i = 1; i < steps.length; i++)
            if (steps[i].time <= time)
                active = steps[i];
        return active;
    }

    public applyStepAt(time: number, immediate: boolean = false): void {
        const step = this.getStepAt(time);
        this.playAnimation(step.animation, immediate);
        this.setExpression(step.expression);
    }

    private playAnimation(name: string, immediate: boolean): void {
        if (this.mixer === null || this.currentAnimation === name)
            return;
        const clip = this.clips.get(name) ?? this.clips.get('Wait');
        if (clip === undefined)
            return;

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        if (this.currentAction !== null && this.currentAction !== action && !immediate)
            this.currentAction.crossFadeTo(action, 0.2, false);
        else if (this.currentAction !== null && this.currentAction !== action)
            this.currentAction.stop();
        this.currentAction = action;
        this.currentAnimation = name;
    }

    private setExpression(expression: string): void {
        if (this.currentExpression === expression)
            return;
        if (this.isImported())
            return this.setImportedFace(expression);
        const cached = this.layer.getCachedHead(this.state, expression);
        if (cached !== null) {
            this.setHead(cached.clone());
            this.currentExpression = expression;
            return;
        }
        if (this.loadingExpression === expression || this.failedExpressions.has(expression))
            return;
        this.loadingExpression = expression;
        this.layer.loadHead(this.state, expression).then((head) => {
            this.loadingExpression = null;
            this.headError = null;
            if (this.getStepAt(this.layer.clock).expression !== expression)
                return;
            this.setHead(head.clone());
            this.currentExpression = expression;
        }, (e: Error) => {
            this.loadingExpression = null;
            this.failedExpressions.add(expression);
            this.headError = `${e}`;
            this.layer.onactorerror(this, this.headError);
        });
    }

    private setHead(head: THREE.Object3D): void {
        if (this.head !== null)
            this.root.remove(this.head);
        this.head = head;
        head.traverse((o) => {
            o.frustumCulled = false;
            o.castShadow = true;
            const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            // glTF defaults to fully metallic, which renders black without an environment map.
            if (mat !== undefined && mat.isMeshStandardMaterial) {
                mat.metalness = 0;
                mat.roughness = 1;
            }
        });
        this.root.add(head);
    }

    public invalidateHead(): void {
        this.failedExpressions.clear();
        this.currentExpression = null;
        this.applyStepAt(this.layer.clock, true);
    }

    public update(dt: number, time: number): void {
        this.applyStepAt(time);
        if (this.mixer !== null)
            this.mixer.update(dt);

        if (this.isImported())
            return;

        this.root.updateMatrixWorld(true);
        this.placeholderHead.visible = this.head === null && this.headBone !== null;
        if (this.headBone === null)
            return;

        // Head bone transform relative to the actor root.
        this.tmpInv.copy(this.root.matrixWorld).invert();
        this.tmpMtx.multiplyMatrices(this.tmpInv, this.headBone.matrixWorld);
        this.tmpMtx.decompose(this.tmpPos, this.tmpQuat, this.tmpScale);

        const target = this.head ?? this.placeholderHead;
        target.position.copy(this.tmpPos);
        target.quaternion.copy(this.tmpQuat);
        if (this.state.bodyModel === 'miitomo')
            target.rotation.z -= Math.PI / 2;

        if (this.head !== null) {
            this.head.scale.setScalar(HEAD_SCALE);
        } else {
            this.placeholderHead.scale.setScalar(this.bodyHeight * 0.18);
            this.placeholderHead.position.y += this.bodyHeight * 0.15;
        }
    }

    public dispose(): void {
        this.mixer?.stopAllAction();
        this.root.removeFromParent();
    }
}

export class MiiLayer implements ViewerOverlay {
    public canvas: HTMLCanvasElement;
    public actors: MiiActor[] = [];
    public clock = 0;
    public playing = true;
    public rendererURL = DEFAULT_RENDERER_URL;
    public onactorerror: (actor: MiiActor, error: string) => void = () => {};
    public onclock: (time: number) => void = () => {};
    // Mouse placement: drag the Miis around, optionally stuck to the scenery under the cursor.
    public moveMode = false;
    public magnet = true;
    public onactormoved: (actor: MiiActor, done: boolean) => void = () => {};
    public depth: DepthCapture;
    private depthTexture: THREE.DataTexture | null = null;
    private depthSerial = -1;
    private raycaster = new THREE.Raycaster();
    private drag: { actor: MiiActor, plane: THREE.Plane, offset: THREE.Vector3, vertical: boolean } | null = null;

    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera();
    private hemiLight = new THREE.HemisphereLight(0xFFFFFF, 0x808080, 1.6);
    private dirLight = new THREE.DirectionalLight(0xFFFFFF, 1.6);
    private shadowCatcher = createShadowCatcher();
    private light: LightSettings = { ...DEFAULT_LIGHT };
    private lightDir = new THREE.Vector3();
    private tmpCenter = new THREE.Vector3();
    private loader = new GLTFLoader();
    private bodyTemplates = new Map<string, Promise<BodyTemplate>>();
    private headCache = new Map<string, THREE.Object3D>();
    private headLoads = new Map<string, Promise<THREE.Object3D>>();
    private userModels = new Map<string, Promise<GLTF>>();
    private faceCache = new Map<string, THREE.Texture>();

    constructor(private viewer: Viewer) {
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = '0';
        this.canvas.style.top = '0';
        this.canvas.style.pointerEvents = 'none';

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas, alpha: true, antialias: true,
            preserveDrawingBuffer: true, logarithmicDepthBuffer: true,
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.dirLight.shadow.mapSize.set(2048, 2048);
        this.scene.add(this.hemiLight, this.dirLight, this.dirLight.target, this.shadowCatcher);
        depthUniforms.uMiiShadowMatrix.value = this.dirLight.shadow.matrix;
        this.setLight(this.light);

        this.camera.matrixAutoUpdate = false;
        this.camera.matrixWorldAutoUpdate = false;

        viewer.canvas.insertAdjacentElement('afterend', this.canvas);
        viewer.overlays.push(this);

        this.depth = new DepthCapture(viewer.gfxDevice, viewer);
        depthUniforms.uMiiDepthNegOne.value = 0;
        window.addEventListener('mousedown', this.onMouseDown, { capture: true });
        window.addEventListener('mousemove', this.onMouseMove, { capture: true });
        window.addEventListener('mouseup', this.onMouseUp, { capture: true });
    }

    private mouseNDC(e: MouseEvent): THREE.Vector2 | null {
        const rect = this.viewer.canvas.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientY < rect.top || e.clientX > rect.right || e.clientY > rect.bottom)
            return null;
        return new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height * 2 - 1));
    }

    private actorAt(ndc: THREE.Vector2): { actor: MiiActor, point: THREE.Vector3 } | null {
        this.raycaster.setFromCamera(ndc, this.camera);
        let best: { actor: MiiActor, point: THREE.Vector3 } | null = null, bestDist = Infinity;
        for (const actor of this.actors) {
            if (!actor.state.visible)
                continue;
            const hits = this.raycaster.intersectObject(actor.root, true);
            if (hits.length > 0 && hits[0].distance < bestDist) {
                bestDist = hits[0].distance;
                best = { actor, point: hits[0].point };
            }
        }
        return best;
    }

    // Scenery under the cursor, from the depth snapshot.
    // On a wall, the Mii climbs onto the ledge above it if there's one within its height.
    public pickScenery(ndcX: number, ndcY: number, size: number = 0): [number, number, number] | null {
        const v = vec3.create();
        if (!this.depth.pick(v, ndcX, ndcY))
            return null;
        const up = this.depth.surfaceUpness(ndcX, ndcY);
        if (size > 0 && up !== null && up < 0.6) {
            const y = this.depth.findGroundBelow(v[0], v[1] + size, v[2], size * 1.5, size * 0.5);
            if (y !== null)
                return [v[0], y, v[2]];
        }
        return [v[0], v[1], v[2]];
    }

    // Next click on the scenery goes to this callback instead of moving the camera.
    public pendingPick: ((point: [number, number, number] | null) => void) | null = null;

    private onMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0 || e.target !== this.viewer.canvas)
            return;
        if (this.pendingPick !== null) {
            const ndc = this.mouseNDC(e);
            if (ndc === null)
                return;
            e.stopPropagation();
            e.preventDefault();
            const cb = this.pendingPick;
            this.pendingPick = null;
            this.viewer.canvas.style.cursor = '';
            cb(this.pickScenery(ndc.x, ndc.y));
            return;
        }
        if (!this.moveMode)
            return;
        const ndc = this.mouseNDC(e);
        if (ndc === null)
            return;
        const hit = this.actorAt(ndc);
        if (hit === null)
            return;
        e.stopPropagation();
        e.preventDefault();
        const actor = hit.actor;
        const origin = new THREE.Vector3().fromArray(actor.state.position);
        // Shift moves up and down, on a vertical plane facing the camera.
        let plane: THREE.Plane;
        if (e.shiftKey) {
            const camDir = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2).setY(0);
            if (camDir.lengthSq() < 1e-6)
                camDir.set(0, 0, 1);
            plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.normalize(), hit.point);
        } else {
            plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), origin);
        }
        const start = new THREE.Vector3();
        this.raycaster.setFromCamera(ndc, this.camera);
        if (this.raycaster.ray.intersectPlane(plane, start) === null)
            start.copy(origin);
        this.drag = { actor, plane, offset: origin.clone().sub(start), vertical: e.shiftKey };
        this.viewer.canvas.style.cursor = 'grabbing';
        this.onactormoved(actor, false);
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (this.drag === null) {
            if (this.moveMode && e.target === this.viewer.canvas && e.buttons === 0) {
                const ndc = this.mouseNDC(e);
                this.viewer.canvas.style.cursor = ndc !== null && this.actorAt(ndc) !== null ? 'grab' : '';
            }
            return;
        }
        e.stopPropagation();
        const ndc = this.mouseNDC(e);
        if (ndc === null)
            return;
        const { actor, plane, offset, vertical } = this.drag;
        const s = actor.state;
        if (this.magnet && !vertical) {
            // Stuck to the scenery: over the void, the Mii just waits at its last spot.
            const p = this.pickScenery(ndc.x, ndc.y, s.size);
            if (p !== null) {
                s.position = p;
                actor.syncTransform();
            }
            return;
        }
        const point = new THREE.Vector3();
        this.raycaster.setFromCamera(ndc, this.camera);
        if (this.raycaster.ray.intersectPlane(plane, point) === null)
            return;
        point.add(offset);
        if (vertical)
            s.position = [s.position[0], point.y, s.position[2]];
        else
            s.position = [point.x, s.position[1], point.z];
        actor.syncTransform();
    };

    private onMouseUp = (e: MouseEvent): void => {
        if (this.drag === null)
            return;
        e.stopPropagation();
        const actor = this.drag.actor;
        this.drag = null;
        this.viewer.canvas.style.cursor = '';
        this.onactormoved(actor, true);
    };

    // Drops a Mii onto the scenery below it (only works where that ground is on screen).
    public dropToGround(actor: MiiActor): boolean {
        const s = actor.state;
        const y = this.depth.findGroundBelow(s.position[0], s.position[1] + s.size * 0.5, s.position[2], s.size * 20, s.size * 0.5);
        if (y === null)
            return false;
        s.position = [s.position[0], y, s.position[2]];
        actor.syncTransform();
        return true;
    }

    private updateDepthUniforms(): void {
        const snap = this.depth.snapshot;
        if (snap === null) {
            depthUniforms.uMiiDepthEnabled.value = 0;
            return;
        }
        if (snap.serial !== this.depthSerial) {
            this.depthSerial = snap.serial;
            if (this.depthTexture === null || this.depthTexture.image.width !== snap.width || this.depthTexture.image.height !== snap.height) {
                this.depthTexture?.dispose();
                this.depthTexture = new THREE.DataTexture(snap.depth as Float32Array<ArrayBuffer>, snap.width, snap.height, THREE.RedFormat, THREE.FloatType);
                this.depthTexture.minFilter = THREE.NearestFilter;
                this.depthTexture.magFilter = THREE.NearestFilter;
            } else {
                (this.depthTexture.image as unknown as { data: Float32Array }).data = snap.depth;
            }
            this.depthTexture.needsUpdate = true;
            depthUniforms.uMiiDepth.value = this.depthTexture;
            depthUniforms.uMiiClipFromWorld.value.fromArray(snap.clipFromWorld as Float32Array);
            depthUniforms.uMiiWorldFromClip.value.fromArray(snap.worldFromClip as Float32Array);
            depthUniforms.uMiiDepthNegOne.value = snap.nearZNegativeOne ? 1 : 0;
        }
        depthUniforms.uMiiDepthEnabled.value = 1;
    }

    public setLight(light: LightSettings): void {
        this.light = { ...light };
        this.hemiLight.intensity = light.ambient;
        this.dirLight.intensity = light.intensity;
        this.dirLight.color.set(light.color);
        this.dirLight.castShadow = light.shadow;
        const az = light.azimuth * Math.PI / 180, el = light.elevation * Math.PI / 180;
        this.lightDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    }

    // Fit the light and its shadow camera around the visible Miis.
    private updateLight(): void {
        const box = new THREE.Box3();
        let maxSize = 0;
        let groundY = Infinity;
        for (const actor of this.actors) {
            if (!actor.state.visible)
                continue;
            box.expandByPoint(this.tmpCenter.fromArray(actor.state.position));
            maxSize = Math.max(maxSize, actor.state.size);
            groundY = Math.min(groundY, actor.state.position[1]);
        }
        this.shadowCatcher.visible = this.light.shadow && !box.isEmpty();
        this.shadowCatcher.material.opacity = this.light.shadowOpacity;
        if (box.isEmpty())
            return;
        depthUniforms.uMiiGroundY.value = groundY;
        box.getCenter(this.tmpCenter);
        const radius = box.max.distanceTo(box.min) / 2 + maxSize * 3;
        this.dirLight.target.position.copy(this.tmpCenter);
        this.dirLight.position.copy(this.tmpCenter).addScaledVector(this.lightDir, radius * 2);
        const cam = this.dirLight.shadow.camera;
        cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
        // Deep enough to reach the end of long shadows from a low light.
        cam.near = radius * 0.5; cam.far = radius * 12;
        cam.updateProjectionMatrix();
        this.dirLight.shadow.bias = -0.0005;
        this.dirLight.shadow.normalBias = maxSize * 0.005;
    }

    public measureHeight(obj: THREE.Object3D): number {
        const box = new THREE.Box3().setFromObject(obj);
        return Math.max(box.max.y - box.min.y, 1e-3);
    }

    public loadUserModel(id: string): Promise<GLTF> {
        let p = this.userModels.get(id);
        if (p === undefined) {
            p = loadModel(id).then((data) => this.loader.parseAsync(data, ''));
            p.catch(() => this.userModels.delete(id));
            this.userModels.set(id, p);
        }
        return p;
    }

    public getCachedFace(id: string): THREE.Texture | undefined {
        return this.faceCache.get(id);
    }

    public async loadFace(id: string): Promise<THREE.Texture> {
        const cached = this.faceCache.get(id);
        if (cached !== undefined)
            return cached;
        if (id.startsWith(IMAGE_FACE_PREFIX)) {
            // A face picture from the all-emotions import, laid out like the .glb's Mask texture.
            const blob = new Blob([await loadModel(id.slice(IMAGE_FACE_PREFIX.length))], { type: 'image/png' });
            const tex = new THREE.Texture(await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
            tex.flipY = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            this.faceCache.set(id, tex);
            return tex;
        }
        const gltf = await this.loadUserModel(id);
        let map: THREE.Texture | null = null;
        gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh && mesh.name === 'Mask')
                map = (mesh.material as THREE.MeshStandardMaterial).map;
        });
        if (map === null)
            throw new Error(`Pas de visage trouvé dans ce modèle 3D.`);
        this.faceCache.set(id, map);
        return map;
    }

    public getBodyTemplate(gender: MiiGender, model: BodyModel): Promise<BodyTemplate> {
        const g = gender === MiiGender.Female ? 'F' : 'M';
        const url = `${BODY_MODEL_BASE_URL}/miiBody${g}_${model}.glb`;
        let p = this.bodyTemplates.get(url);
        if (p === undefined) {
            p = this.loader.loadAsync(url).then((gltf) => {
                const box = new THREE.Box3().setFromObject(gltf.scene);
                const height = Math.max(box.max.y - box.min.y, 1e-3);
                return { gltf, height };
            });
            p.catch(() => this.bodyTemplates.delete(url));
            this.bodyTemplates.set(url, p);
        }
        return p;
    }

    private headURL(state: MiiActorState, expression: string): string {
        const params = new URLSearchParams({
            data: state.data,
            type: 'face',
            expression,
            width: '512',
            texResolution: '512',
            shaderType: 'wiiu',
            verifyCharInfo: '0',
        });
        if (state.miic !== undefined)
            params.set('miic', state.miic);
        return `${this.rendererURL}.glb?${params.toString()}`;
    }

    public getCachedHead(state: MiiActorState, expression: string): THREE.Object3D | null {
        return this.headCache.get(this.headURL(state, expression)) ?? null;
    }

    public loadHead(state: MiiActorState, expression: string): Promise<THREE.Object3D> {
        const url = this.headURL(state, expression);
        let p = this.headLoads.get(url);
        if (p === undefined) {
            p = this.loader.loadAsync(url).then((gltf) => {
                this.headCache.set(url, gltf.scene);
                return gltf.scene;
            });
            p.catch(() => this.headLoads.delete(url));
            this.headLoads.set(url, p);
        }
        return p;
    }

    public async addActor(state: MiiActorState): Promise<MiiActor> {
        const actor = new MiiActor(this, state);
        this.actors.push(actor);
        this.scene.add(actor.root);
        await actor.load();
        return actor;
    }

    public removeActor(actor: MiiActor): void {
        const i = this.actors.indexOf(actor);
        if (i >= 0)
            this.actors.splice(i, 1);
        actor.dispose();
    }

    public clearActors(): void {
        for (const actor of this.actors)
            actor.dispose();
        this.actors.length = 0;
    }

    public resetClock(): void {
        this.clock = 0;
        for (const actor of this.actors)
            actor.applyStepAt(0, true);
        this.onclock(this.clock);
    }

    // Load every head a sequence needs so that recording is frame-exact.
    public async prepareForRecording(): Promise<void> {
        const loads: Promise<unknown>[] = [];
        for (const actor of this.actors)
            for (const step of actor.state.steps) {
                const faceId = actor.state.faces?.[step.expression];
                if (faceId !== undefined)
                    loads.push(this.loadFace(faceId).catch(() => null));
                else if (!actor.isImported())
                    loads.push(this.loadHead(actor.state, step.expression).catch(() => null));
            }
        await Promise.all(loads);
        this.resetClock();
    }

    public render(viewerInput: ViewerRenderInput): void {
        const backW = viewerInput.backbufferWidth, backH = viewerInput.backbufferHeight;
        if (this.canvas.width !== backW || this.canvas.height !== backH) {
            this.renderer.setSize(backW, backH, false);
        }
        this.canvas.style.width = this.viewer.canvas.style.width;
        this.canvas.style.height = this.viewer.canvas.style.height;

        this.depth.endFrame();
        this.updateDepthUniforms();

        const dt = this.playing ? viewerInput.deltaTime / 1000 : 0;
        if (dt > 0) {
            this.clock += dt;
            this.onclock(this.clock);
        }

        if (this.actors.length === 0) {
            this.renderer.clear();
            return;
        }

        for (const actor of this.actors)
            actor.update(dt, this.clock);
        this.updateLight();

        const cam = viewerInput.camera;
        let minSize = Infinity;
        for (const actor of this.actors)
            minSize = Math.min(minSize, actor.state.size);
        this.camera.fov = cam.fovY * 180 / Math.PI;
        this.camera.aspect = backW / backH;
        this.camera.near = Math.max(minSize * 0.01, 1e-3);
        this.camera.far = this.camera.near * 1e7;
        this.camera.updateProjectionMatrix();
        this.camera.matrixWorld.fromArray(cam.worldMatrix as Float32Array);
        this.camera.matrixWorldInverse.fromArray(cam.viewMatrix as Float32Array);

        depthUniforms.uMiiCamWorldFromClip.value.multiplyMatrices(this.camera.matrixWorld, this.camera.projectionMatrixInverse);
        depthUniforms.uMiiCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
        this.renderer.getDrawingBufferSize(depthUniforms.uMiiResolution.value);

        this.renderer.render(this.scene, this.camera);
    }

    public destroy(): void {
        window.removeEventListener('mousedown', this.onMouseDown, { capture: true });
        window.removeEventListener('mousemove', this.onMouseMove, { capture: true });
        window.removeEventListener('mouseup', this.onMouseUp, { capture: true });
        this.depth.destroy();
        this.depthTexture?.dispose();
        this.clearActors();
        const i = this.viewer.overlays.indexOf(this);
        if (i >= 0)
            this.viewer.overlays.splice(i, 1);
        this.renderer.dispose();
        this.canvas.remove();
    }
}
