
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FAVORITE_COLORS, MiiGender, MiiInfo } from './MiiData.js';
import type { Viewer, ViewerOverlay, ViewerRenderInput } from '../viewer.js';

export type BodyModel = 'miitomo' | 'wiiu';

export const BODY_MODEL_BASE_URL = 'https://raw.githubusercontent.com/datkat21/mii-creator/dev/public/assets/models';
export const DEFAULT_RENDERER_URL = 'https://mii-renderer.nxw.pw/miis/image';
export const ALT_RENDERER_URL = 'https://mii-unsecure.ariankordi.net/miis/image';

export const EXPRESSIONS: { id: string, name: string }[] = [
    { id: 'normal', name: 'Normal' },
    { id: 'smile', name: 'Sourire' },
    { id: 'anger', name: 'Colère' },
    { id: 'sorrow', name: 'Tristesse' },
    { id: 'surprise', name: 'Surprise' },
    { id: 'blink', name: 'Yeux fermés' },
    { id: 'normal_open_mouth', name: 'Normal (bouche ouverte)' },
    { id: 'smile_open_mouth', name: 'Sourire (bouche ouverte)' },
    { id: 'anger_open_mouth', name: 'Colère (bouche ouverte)' },
    { id: 'surprise_open_mouth', name: 'Surprise (bouche ouverte)' },
    { id: 'sorrow_open_mouth', name: 'Tristesse (bouche ouverte)' },
    { id: 'blink_open_mouth', name: 'Yeux fermés (bouche ouverte)' },
    { id: 'wink_left', name: 'Clin d\'œil gauche' },
    { id: 'wink_right', name: 'Clin d\'œil droit' },
    { id: 'wink_left_open_mouth', name: 'Clin d\'œil gauche (bouche ouverte)' },
    { id: 'wink_right_open_mouth', name: 'Clin d\'œil droit (bouche ouverte)' },
    { id: 'like_wink_left', name: 'Clin d\'œil souriant gauche' },
    { id: 'like_wink_right', name: 'Clin d\'œil souriant droit' },
    { id: 'frustrated', name: 'Frustré' },
    { id: '19', name: 'Ennuyé' },
    { id: '20', name: 'Ennuyé (bouche ouverte)' },
    { id: '22', name: 'Soupir' },
    { id: '24', name: 'Dégoûté' },
    { id: '25', name: 'Amoureux' },
    { id: '26', name: 'Amoureux (bouche ouverte)' },
    { id: '28', name: 'Déterminé' },
    { id: '30', name: 'Pleure' },
    { id: '32', name: 'Grand sourire' },
    { id: '33', name: 'Coquin' },
    { id: '37', name: 'Fier' },
    { id: '39', name: 'Résolu' },
    { id: '41', name: 'Incrédule' },
    { id: '43', name: 'Rusé' },
    { id: '45', name: 'Tire la langue' },
    { id: '47', name: 'Innocent' },
    { id: '53', name: 'Miam' },
    { id: '56', name: 'Argent' },
    { id: '58', name: 'Perdu' },
    { id: '60', name: 'Joyeux' },
    { id: '64', name: 'Grognon' },
    { id: '66', name: 'Ému' },
    { id: '68', name: 'Chante' },
    { id: '69', name: 'Sidéré' },
];

export function animationDisplayName(clip: string): string {
    if (clip === 'Wait') return 'Attente';
    if (clip === 'Finish') return 'Victoire';
    const m = clip.match(/^Pose\.(\d+)$/);
    if (m !== null) return `Pose ${parseInt(m[1], 10)}`;
    return clip;
}

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

    public async load(): Promise<void> {
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
        const heightFactor = 0.7 + 0.6 * (s.height / 127);
        const buildFactor = 0.8 + 0.4 * (s.build / 127);
        this.bodyGroup.scale.set(buildFactor, heightFactor, buildFactor);
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
        head.traverse((o) => { o.frustumCulled = false; });
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

    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera();
    private hemiLight = new THREE.HemisphereLight(0xFFFFFF, 0x808080, 1.6);
    private dirLight = new THREE.DirectionalLight(0xFFFFFF, 1.6);
    private loader = new GLTFLoader();
    private bodyTemplates = new Map<string, Promise<BodyTemplate>>();
    private headCache = new Map<string, THREE.Object3D>();
    private headLoads = new Map<string, Promise<THREE.Object3D>>();

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

        this.dirLight.position.set(0.4, 1, 0.6);
        this.scene.add(this.hemiLight, this.dirLight);

        this.camera.matrixAutoUpdate = false;
        this.camera.matrixWorldAutoUpdate = false;

        viewer.canvas.insertAdjacentElement('afterend', this.canvas);
        viewer.overlays.push(this);
    }

    public setLightIntensity(v: number): void {
        this.hemiLight.intensity = v;
        this.dirLight.intensity = v;
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
            for (const step of actor.state.steps)
                loads.push(this.loadHead(actor.state, step.expression).catch(() => null));
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

        this.renderer.render(this.scene, this.camera);
    }

    public destroy(): void {
        this.clearActors();
        const i = this.viewer.overlays.indexOf(this);
        if (i >= 0)
            this.viewer.overlays.splice(i, 1);
        this.renderer.dispose();
        this.canvas.remove();
    }
}
