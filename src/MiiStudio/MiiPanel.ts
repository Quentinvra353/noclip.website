
import { Panel, COOL_BLUE_COLOR } from '../ui.js';
import type { Viewer } from '../viewer.js';
import { GlobalSaveManager } from '../SaveManager.js';
import { FAVORITE_COLOR_NAMES, MiiGender, parseMiiData } from './MiiData.js';
import { deleteModel, saveModel } from './MiiStore.js';
import { studioVideoSettings, VideoRecorder } from '../Studio.js';
import { ALT_RENDERER_URL, animationDisplayName, animationSortKey, BodyModel, DEFAULT_LIGHT, DEFAULT_RENDERER_URL, EXPRESSIONS, IMAGE_FACE_PREFIX, LightSettings, MiiActor, MiiActorState, MiiLayer } from './MiiLayer.js';

const MII_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="20" fill="white"><circle cx="12" cy="7" r="5"/><path d="M4 23c0-5 3.6-8.5 8-8.5s8 3.5 8 8.5z"/></svg>`;

const LIBRARY_KEY = 'MiiStudio_Library';
const SETTINGS_KEY = 'MiiStudio_Settings';
const SCENE_KEY_PREFIX = 'MiiStudio_Scene_';

type VideoFormat = 'landscape' | 'portrait' | 'window';

interface VideoSettings {
    format: VideoFormat;
    framerate: number;
    // Seconds; 0 means "until the end of the sequence".
    duration: number;
    // Render scale before downsizing to the output size.
    supersample: number;
    showFrame: boolean;
}

interface LibraryEntry {
    name: string;
    data?: string;
    // Imported Mi Creator 3D model, and one export per extra expression.
    model?: string;
    faces?: Record<string, string>;
}

function expressionName(id: string, imported: boolean): string {
    if (imported && id === 'normal')
        return 'Visage de l\'export';
    return EXPRESSIONS.find((e) => e.id === id)?.name ?? id;
}

// What the Mi Creator bookmarklet downloads: every expression face of one Mii, as PNG data URLs.
interface EmotionBundle {
    type: 'mii-studio-emotions';
    version: number;
    name?: string;
    faces: Record<string, string>;
}

function bookmarkletCode(): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    const url = new URL('mii/emotions.js', base).href;
    return `javascript:(()=>{const s=document.createElement('script');s.src='${url}?t='+Date.now();document.body.appendChild(s);})()`;
}

async function dataURLToBytes(url: string): Promise<ArrayBuffer> {
    return (await fetch(url)).arrayBuffer();
}

async function decodeImage(bytes: ArrayBuffer): Promise<ImageBitmap> {
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function smallPixels(img: CanvasImageSource, flip: boolean): Uint8ClampedArray {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    if (flip) {
        ctx.translate(0, 64);
        ctx.scale(1, -1);
    }
    ctx.drawImage(img, 0, 0, 64, 64);
    return ctx.getImageData(0, 0, 64, 64).data;
}

function pixelDistance(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let d = 0;
    for (let i = 0; i < a.length; i++)
        d += Math.abs(a[i] - b[i]);
    return d;
}

// Whether the bundle's faces are upside down compared to the export's own face.
async function bundleNeedsFlip(bundle: EmotionBundle, base: CanvasImageSource | null): Promise<boolean> {
    const neutral = bundle.faces['0'];
    if (base === null || neutral === undefined)
        return false;
    const img = await decodeImage(await dataURLToBytes(neutral));
    const ref = smallPixels(base, false);
    return pixelDistance(smallPixels(img, true), ref) < pixelDistance(smallPixels(img, false), ref);
}

async function flipPNG(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const img = await decodeImage(bytes);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.translate(0, img.height);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (blob === null)
        throw new Error('image illisible');
    return blob.arrayBuffer();
}

function loadJSON<T>(key: string, fallback: T): T {
    try {
        const v = window.localStorage.getItem(key);
        return v !== null ? JSON.parse(v) as T : fallback;
    } catch (e) {
        return fallback;
    }
}

function saveJSON(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
    }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const c of children)
        e.append(c);
    return e;
}

function button(label: string, onclick: () => void, title: string = ''): HTMLButtonElement {
    const b = el('button', { textContent: label, title, onclick: (e: MouseEvent) => { e.stopPropagation(); onclick(); } });
    b.className = 'MiiStudioButton';
    return b;
}

function select(options: { value: string, label: string }[], value: string, onchange: (v: string) => void): HTMLSelectElement {
    const s = el('select');
    for (const o of options)
        s.append(el('option', { value: o.value, textContent: o.label }));
    s.value = value;
    s.onchange = () => onchange(s.value);
    return s;
}

function numberInput(value: number, step: number, onchange: (v: number) => void): HTMLInputElement {
    const i = el('input', { type: 'number', value: String(Math.round(value * 1000) / 1000), step: String(step) });
    i.onchange = () => {
        const v = parseFloat(i.value);
        if (Number.isFinite(v))
            onchange(v);
    };
    return i;
}

function row(label: string, ...children: (Node | string)[]): HTMLElement {
    const r = el('div', { className: 'MiiStudioRow' });
    r.append(el('span', { textContent: label }), ...children);
    return r;
}

function section(title: string): HTMLElement {
    return el('div', { className: 'MiiStudioSection', textContent: title });
}

export class MiiPanel extends Panel {
    private layer: MiiLayer | null = null;
    private viewer: Viewer | null = null;
    private library: LibraryEntry[] = loadJSON(LIBRARY_KEY, []);
    private selected: MiiActor | null = null;
    private sceneKey: string | null = null;
    private messageElem: HTMLElement;
    private clockElem: HTMLElement;
    private bodyElem: HTMLElement;
    private settings: { rendererURL: string, lightSettings: LightSettings, magnet: boolean, video: VideoSettings } = (() => {
        const saved = loadJSON<{ rendererURL?: string, light?: number, lightSettings?: Partial<LightSettings>, magnet?: boolean, video?: Partial<VideoSettings> }>(SETTINGS_KEY, {});
        const lightSettings = { ...DEFAULT_LIGHT, ...saved.lightSettings };
        if (saved.lightSettings === undefined && saved.light !== undefined)
            lightSettings.intensity = lightSettings.ambient = saved.light;
        return { rendererURL: saved.rendererURL ?? DEFAULT_RENDERER_URL, lightSettings, magnet: saved.magnet ?? true,
            video: { format: 'landscape', framerate: 60, duration: 0, supersample: 2, showFrame: true, ...saved.video } };
    })();
    // Emotion picked for an imported Mii that has no face for it yet, waiting for its export file.
    private alignTarget: MiiActor | null = null;
    private recorder: VideoRecorder | null = null;
    private pendingFace: { actor: MiiActor, expression: string, apply: (expression: string) => void } | null = null;

    constructor() {
        super();
        this.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        this.setTitle(MII_ICON, 'Mii');

        document.head.insertAdjacentHTML('beforeend', `
            <style>
                .MiiStudio { font: 14px monospace; line-height: 1.6; padding: 6px 8px 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; box-sizing: border-box; width: 440px; }
                .MiiStudio input, .MiiStudio select, .MiiStudio textarea { font: 13px monospace; background: #222; color: white; border: 1px solid #555; min-width: 0; }
                .MiiStudio textarea { width: 100%; box-sizing: border-box; height: 48px; resize: vertical; }
                .MiiStudioButton { font: bold 13px monospace; border: none; color: white; background: rgb(64, 64, 64); cursor: pointer; padding: 2px 6px; }
                .MiiStudioButton:hover { background: rgb(90, 90, 90); }
                .MiiStudioButton.active { background: rgb(210, 30, 30); }
                .MiiStudioRow { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px; align-items: center; }
                .MiiStudioRow > :not(span) { width: 100%; box-sizing: border-box; }
                .MiiStudioInline { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
                .MiiStudioInline > input[type=number] { width: 80px; }
                .MiiStudioInline > input[type=file] { flex: 1; min-width: 0; }
                .MiiStudioSection { margin-top: 8px; font-weight: bold; border-bottom: 1px solid #666; }
                .MiiStudioItem { display: flex; gap: 4px; align-items: center; }
                .MiiStudioItem > span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
                .MiiStudioItem.selected > span { color: rgb(255, 120, 120); }
                .MiiStudioMessage { color: #ffb070; white-space: pre-wrap; }
                .MiiStudioHint { color: #aaa; font-size: 12px; line-height: 1.4; white-space: pre-line; }
                .MiiStudioBookmarklet { display: inline-block; padding: 4px 10px; border-radius: 6px; background: #5b3aa0; color: white; text-decoration: none; font-weight: bold; cursor: grab; }
            </style>
        `);

        const root = el('div', { className: 'MiiStudio' });
        this.messageElem = el('div', { className: 'MiiStudioMessage' });
        this.clockElem = el('span');
        this.bodyElem = el('div');
        this.bodyElem.style.cssText = 'display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;';
        root.append(this.messageElem, this.bodyElem);
        this.contents.append(root);
        // Keep keyboard input inside the panel instead of moving the camera.
        root.addEventListener('keydown', (e) => e.stopPropagation());
    }

    public setViewer(viewer: Viewer): void {
        if (this.viewer === viewer)
            return;
        if (this.layer !== null)
            this.layer.destroy();
        this.viewer = viewer;
        this.layer = new MiiLayer(viewer);
        this.layer.rendererURL = this.settings.rendererURL;
        this.layer.setLight(this.settings.lightSettings);
        this.layer.magnet = this.settings.magnet;
        this.layer.onactormoved = (actor, done) => {
            this.selected = actor;
            if (done)
                this.changed();
            this.rebuild();
        };
        this.layer.onclock = (t) => { this.clockElem.textContent = `${t.toFixed(2)} s`; };
        this.layer.onactorerror = (actor, error) => {
            this.setMessage(`Impossible de charger la tête de « ${actor.state.name} » depuis le serveur de rendu (${error}).\nEssaie l'autre serveur dans « Réglages ».`);
        };
        this.sceneKey = null;
        this.onSceneChange();
    }

    public onSceneChange(): void {
        if (this.layer === null)
            return;
        this.saveScene();
        const id = GlobalSaveManager.getCurrentSceneDescId();
        this.sceneKey = id !== null ? `${SCENE_KEY_PREFIX}${id}` : null;
        this.layer.clearActors();
        this.selected = null;
        const states: MiiActorState[] = this.sceneKey !== null ? loadJSON(this.sceneKey, []) : [];
        Promise.all(states.map((s) => this.layer!.addActor(s).catch((e) => this.reportLoadError(e)))).then(() => this.rebuild());
        this.rebuild();
    }

    public onSceneDestroyed(): void {
        this.saveScene();
        this.layer?.clearActors();
        this.selected = null;
        this.sceneKey = null;
        this.rebuild();
    }

    private saveScene(): void {
        if (this.layer === null || this.sceneKey === null)
            return;
        saveJSON(this.sceneKey, this.layer.actors.map((a) => a.state));
    }

    private changed(): void {
        this.saveScene();
    }

    private setMessage(m: string): void {
        this.messageElem.textContent = m;
        this.syncSize();
    }

    private reportLoadError(e: unknown): void {
        this.setMessage(`Impossible de charger le corps du Mii (${e}).`);
    }

    private cameraPlacement(size: number): { position: [number, number, number], yaw: number } {
        const m = this.viewer!.camera.worldMatrix;
        const px = m[12], py = m[13], pz = m[14];
        let fx = -m[8], fz = -m[10];
        const len = Math.hypot(fx, fz) || 1;
        fx /= len; fz /= len;
        const dist = size * 2.5;
        const yaw = Math.atan2(-fx, -fz) * 180 / Math.PI;
        // With the magnet on, stand on the scenery seen a bit below the middle of the screen.
        const ground = this.layer!.magnet ? this.layer!.pickScenery(0, -0.3, size) : null;
        if (ground !== null)
            return { position: ground, yaw };
        return { position: [px + fx * dist, py - size * 0.9, pz + fz * dist], yaw };
    }

    private async placeFromLibrary(entry: LibraryEntry): Promise<void> {
        if (this.layer === null || this.viewer === null)
            return;
        const size = this.selected?.state.size ?? 100;
        const { position, yaw } = this.cameraPlacement(size);
        if (entry.model !== undefined) {
            await this.addActor({
                name: entry.name, data: '', gender: MiiGender.Male, favoriteColor: 0, height: 64, build: 64,
                bodyModel: 'miitomo', position, yaw, size, visible: true,
                steps: [{ time: 0, animation: 'Wait', expression: 'normal' }],
                model: entry.model, faces: { ...entry.faces },
            });
            return;
        }
        let info;
        try {
            info = parseMiiData(entry.data ?? '');
        } catch (e) {
            this.setMessage(`${e}`);
            return;
        }
        await this.addActor({
            name: entry.name, data: info.rendererData, miic: info.miic,
            gender: info.gender, favoriteColor: info.favoriteColor,
            height: info.height, build: info.build,
            bodyModel: 'miitomo', position, yaw, size, visible: true,
            steps: [{ time: 0, animation: 'Wait', expression: 'normal' }],
        });
    }

    private async addActor(state: MiiActorState): Promise<void> {
        this.setMessage('Chargement du Mii…');
        try {
            this.selected = await this.layer!.addActor(state);
            this.setMessage('');
        } catch (e) {
            this.reportLoadError(e);
        }
        this.changed();
        this.rebuild();
    }

    private addToLibrary(name: string, data: string): void {
        try {
            const info = parseMiiData(data);
            const label = name.trim() || `Mii ${this.library.length + 1}`;
            this.library.push({ name: label, data: data.trim() });
            saveJSON(LIBRARY_KEY, this.library);
            this.setMessage(`« ${label} » ajouté (format ${info.format}${info.miic !== undefined ? ' + couleurs Mi Creator' : ''}, ${info.gender === MiiGender.Female ? 'fille' : 'garçon'}, ${FAVORITE_COLOR_NAMES[info.favoriteColor].toLowerCase()}).`);
        } catch (e) {
            this.setMessage(`${e} Colle les données copiées depuis Mi Creator (code hexadécimal ou base64), ou choisis les fichiers .charinfo et .miic du Mii.`);
        }
        this.rebuild();
    }

    private async addModelToLibrary(name: string, file: File): Promise<void> {
        try {
            const id = await saveModel(await file.arrayBuffer());
            const label = name.trim() || file.name.replace(/_all_body.*$|\.glb$/i, '') || `Mii ${this.library.length + 1}`;
            this.library.push({ name: label, model: id, faces: {} });
            saveJSON(LIBRARY_KEY, this.library);
            this.setMessage(`« ${label} » ajouté (modèle 3D Mi Creator). Place-le, puis choisis une émotion dans sa liste « Émotion » pour l'ajouter.`);
        } catch (e) {
            this.setMessage(`Impossible d'enregistrer le modèle 3D (${e}).`);
        }
        this.rebuild();
    }

    private async addFace(model: string, name: string, expression: string, file: File): Promise<boolean> {
        try {
            const id = await saveModel(await file.arrayBuffer());
            await this.layer!.loadFace(id);
            for (const entry of this.library)
                if (entry.model === model)
                    entry.faces = { ...entry.faces, [expression]: id };
            saveJSON(LIBRARY_KEY, this.library);
            for (const actor of this.layer!.actors) {
                if (actor.state.model === model) {
                    actor.state.faces = { ...actor.state.faces, [expression]: id };
                    actor.invalidateHead();
                }
            }
            this.changed();
            this.setMessage(`Émotion « ${expressionName(expression, true)} » ajoutée à « ${name} ».`);
            return true;
        } catch (e) {
            this.setMessage(`${e}`);
            return false;
        }
    }

    private expressionOptions(actor: MiiActor): { value: string, label: string }[] {
        if (!actor.isImported())
            return EXPRESSIONS.map((e) => ({ value: e.id, label: e.name }));
        const faces = actor.state.faces ?? {};
        return EXPRESSIONS.map((e) => ({
            value: e.id,
            label: e.id === 'normal' || faces[e.id] !== undefined ? expressionName(e.id, true) : `${e.name} (à importer)`,
        }));
    }

    // Picking an emotion an imported Mii has no face for asks for that emotion's export first.
    private pickExpression(actor: MiiActor, expression: string, apply: (expression: string) => void): void {
        if (actor.isImported() && expression !== 'normal' && actor.state.faces?.[expression] === undefined) {
            this.pendingFace = { actor, expression, apply };
            this.rebuild();
            return;
        }
        this.pendingFace = null;
        apply(expression);
        actor.applyStepAt(this.layer!.clock);
        this.changed();
        this.rebuild();
    }

    // Adds every face from a Mi Creator bookmarklet download to the Mii that uses this model.
    private async importEmotions(actor: MiiActor, file: File): Promise<void> {
        const model = actor.state.model!;
        let bundle: EmotionBundle;
        try {
            bundle = JSON.parse(await file.text());
        } catch (e) {
            this.setMessage('Ce fichier n\'est pas un fichier d\'émotions (.miiemo) de Mi Creator.');
            return;
        }
        if (bundle.type !== 'mii-studio-emotions' || typeof bundle.faces !== 'object') {
            this.setMessage('Ce fichier n\'est pas un fichier d\'émotions (.miiemo) de Mi Creator.');
            return;
        }
        this.setMessage('Import des émotions…');
        try {
            const flip = await bundleNeedsFlip(bundle, actor.getBaseMaskImage());
            const added: Record<string, string> = {};
            for (const [num, url] of Object.entries(bundle.faces)) {
                const expr = EXPRESSIONS.find((e) => String(e.num) === num);
                // The neutral face is already the export's own.
                if (expr === undefined || expr.id === 'normal')
                    continue;
                let bytes = await dataURLToBytes(url);
                if (flip)
                    bytes = await flipPNG(bytes);
                added[expr.id] = IMAGE_FACE_PREFIX + await saveModel(bytes);
            }

            const replaced = new Set<string>();
            for (const entry of this.library) {
                if (entry.model !== model)
                    continue;
                for (const [expr, id] of Object.entries(entry.faces ?? {}))
                    if (added[expr] !== undefined)
                        replaced.add(id);
                entry.faces = { ...entry.faces, ...added };
            }
            for (const a of this.layer!.actors) {
                if (a.state.model !== model)
                    continue;
                for (const [expr, id] of Object.entries(a.state.faces ?? {}))
                    if (added[expr] !== undefined)
                        replaced.add(id);
                a.state.faces = { ...a.state.faces, ...added };
                a.invalidateHead();
            }
            saveJSON(LIBRARY_KEY, this.library);
            for (const id of replaced)
                deleteModel(id.startsWith(IMAGE_FACE_PREFIX) ? id.slice(IMAGE_FACE_PREFIX.length) : id).catch(() => {});
            this.pendingFace = null;
            this.changed();
            this.setMessage(`${Object.keys(added).length + 1} émotions disponibles pour « ${actor.state.name} ».`);
        } catch (e) {
            this.setMessage(`Impossible d'importer les émotions (${e}).`);
        }
        this.rebuild();
    }

    private buildEmotionImport(actor: MiiActor): HTMLElement[] {
        if (!actor.isImported())
            return [];
        const input = el('input', { type: 'file', accept: '.miiemo,.json' });
        input.style.display = 'none';
        input.onchange = async () => {
            const f = input.files?.[0];
            input.value = '';
            if (f !== undefined)
                await this.importEmotions(actor, f);
        };
        const count = Object.keys(actor.state.faces ?? {}).length + 1;
        return [el('div', { className: 'MiiStudioInline' }, [
            button(`📥 Importer toutes les émotions (${count}/${EXPRESSIONS.length})`, () => input.click(), 'Choisis le fichier .miiemo téléchargé avec le favori « Émotions Mii » sur Mi Creator'),
            input,
        ])];
    }

    private buildPendingFace(actor: MiiActor): HTMLElement[] {
        const pending = this.pendingFace;
        if (pending === null || pending.actor !== actor)
            return [];
        const name = expressionName(pending.expression, true);
        const faceInput = el('input', { type: 'file', accept: '.glb,.miiemo,.json' });
        faceInput.style.display = 'none';
        faceInput.onchange = async () => {
            const f = faceInput.files?.[0];
            if (f === undefined)
                return;
            if (!/\.glb$/i.test(f.name)) {
                await this.importEmotions(actor, f);
                if (actor.state.faces?.[pending.expression] !== undefined) {
                    pending.apply(pending.expression);
                    actor.applyStepAt(this.layer!.clock);
                    this.changed();
                }
                return;
            }
            if (await this.addFace(actor.state.model!, actor.state.name, pending.expression, f)) {
                this.pendingFace = null;
                pending.apply(pending.expression);
                actor.applyStepAt(this.layer!.clock);
                this.changed();
            }
            this.rebuild();
        };
        const hint = el('div', { className: 'MiiStudioHint', textContent:
            `Il manque le visage « ${name} ». Le plus simple : récupère toutes les émotions d'un coup avec le favori « Émotions Mii » (voir « Mes Mii »), puis choisis le fichier .miiemo ici. Tu peux aussi choisir un export 3D (.glb) fait avec cette émotion.` });
        return [hint, el('div', { className: 'MiiStudioInline' }, [
            button('Choisir le fichier', () => faceInput.click()),
            button('Annuler', () => { this.pendingFace = null; this.rebuild(); }),
            faceInput,
        ])];
    }

    private buildLibrary(): HTMLElement[] {
        const out: HTMLElement[] = [section('Mes Mii')];

        const nameInput = el('input', { type: 'text', placeholder: 'Nom du Mii' });
        const dataInput = el('textarea', { placeholder: 'Colle ici les « Données CharInfo/Switch (Hex) » de Mi Creator, puis sur une 2e ligne les « Données Mii Creator (Base64) »' });
        const fileInput = el('input', { type: 'file', accept: '.glb,.miic,.mii,.charinfo,.ffsd,.cfsd,.bin,.rcd,.3dsmii,.txt' });
        fileInput.multiple = true;
        fileInput.onchange = async () => {
            const files = Array.from(fileInput.files ?? []);
            if (files.length === 0)
                return;
            const glb = files.find((f) => /\.glb$/i.test(f.name));
            if (glb !== undefined) {
                fileInput.value = '';
                await this.addModelToLibrary(nameInput.value, glb);
                return;
            }
            const parts: string[] = [];
            for (const f of files) {
                const buf = new Uint8Array(await f.arrayBuffer());
                const text = new TextDecoder().decode(buf).trim();
                parts.push(/^[0-9a-fA-F\s]+$/.test(text) ? text.replace(/\s/g, '') : Array.from(buf, (v) => v.toString(16).padStart(2, '0')).join(''));
            }
            this.addToLibrary(nameInput.value || files[0].name.replace(/\.[^.]+$/, ''), parts.join('\n'));
            fileInput.value = '';
        };
        out.push(nameInput, dataInput, el('div', { className: 'MiiStudioInline' }, [
            button('Ajouter', () => this.addToLibrary(nameInput.value, dataInput.value)),
            fileInput,
        ]));

        // A bookmark that runs on Mi Creator and downloads every expression face of a Mii at once.
        const bookmarklet = el('a', { href: bookmarkletCode(), textContent: '⭐ Émotions Mii', className: 'MiiStudioBookmarklet',
            title: 'Fais glisser ce bouton dans ta barre de favoris' });
        bookmarklet.onclick = (e) => {
            e.preventDefault();
            this.setMessage('Ne clique pas ici : fais glisser « ⭐ Émotions Mii » dans ta barre de favoris, puis utilise-le sur Mi Creator.');
        };
        out.push(el('details', {}, [
            el('summary', { textContent: 'Récupérer toutes les émotions d\'un Mii d\'un coup' }),
            el('div', { className: 'MiiStudioHint', textContent:
                '1. Fais glisser ce bouton dans ta barre de favoris (Ctrl+Maj+B pour l\'afficher) :' }),
            el('div', { className: 'MiiStudioInline' }, [bookmarklet]),
            el('div', { className: 'MiiStudioHint', textContent:
                '2. Sur Mi Creator (https://mii.nxw.pw/app), clique sur le favori une fois.\n' +
                '3. Clique sur ton Mii → « Rendu » → « Rendu personnalisé ».\n' +
                '4. Quand le Mii s\'affiche, reclique sur le favori : il télécharge un fichier .miiemo avec toutes les émotions (quelques secondes).\n' +
                '5. Ici, place le Mii (son export 3D .glb), puis « 📥 Importer toutes les émotions » et choisis ce fichier.' }),
        ]));

        this.library.forEach((entry, i) => {
            const faceCount = Object.keys(entry.faces ?? {}).length;
            const label = entry.model !== undefined ? `${entry.name} (3D, ${faceCount + 1} visage${faceCount > 0 ? 's' : ''})` : entry.name;
            out.push(el('div', { className: 'MiiStudioItem' }, [
                el('span', { textContent: label, title: entry.data ?? '' }),
                button('Placer ici', () => this.placeFromLibrary(entry), 'Place ce Mii devant la caméra'),
                button('✕', () => {
                    this.library.splice(i, 1);
                    saveJSON(LIBRARY_KEY, this.library);
                    this.rebuild();
                }, 'Retirer de la bibliothèque'),
            ]));
        });
        return out;
    }

    private buildActors(): HTMLElement[] {
        const layer = this.layer!;
        const out: HTMLElement[] = [section('Dans la map')];
        const moveBtn = button(layer.moveMode ? '🖱 Déplacer à la souris : OUI' : '🖱 Déplacer à la souris : non', () => {
            layer.moveMode = !layer.moveMode;
            this.rebuild();
        }, 'Clique sur un Mii dans la map et fais-le glisser');
        if (layer.moveMode)
            moveBtn.classList.add('active');
        const magnet = el('input', { type: 'checkbox', checked: layer.magnet });
        magnet.onchange = () => {
            layer.magnet = magnet.checked;
            this.settings.magnet = magnet.checked;
            saveJSON(SETTINGS_KEY, this.settings);
        };
        out.push(el('div', { className: 'MiiStudioInline' }, [moveBtn, el('label', { className: 'MiiStudioInline' }, [magnet, '🧲 Aimanter au décor'])]));
        if (layer.moveMode)
            out.push(el('div', { className: 'MiiStudioHint', textContent: 'Clique sur un Mii et fais-le glisser. Avec l\'aimant, il se pose sur la surface sous la souris. Maintiens Maj en cliquant pour le monter ou le descendre. Clique à côté des Mii pour bouger la caméra comme d\'habitude.' }));
        if (!layer.depth.supported)
            out.push(el('div', { className: 'MiiStudioHint', textContent: 'L\'aimant et l\'ombre sur le sol réel ne marchent qu\'avec le rendu WebGL (pas WebGPU).' }));
        if (layer.actors.length === 0) {
            out.push(el('div', { textContent: 'Aucun Mii placé. Vole jusqu\'à l\'endroit voulu puis clique sur « Placer ici ».' }));
            return out;
        }
        for (const actor of layer.actors) {
            const item = el('div', { className: 'MiiStudioItem' + (actor === this.selected ? ' selected' : '') }, [
                el('span', { textContent: actor.state.name, onclick: () => { this.selected = actor; this.rebuild(); } }),
                button(actor.state.visible ? 'Cacher' : 'Montrer', () => {
                    actor.state.visible = !actor.state.visible;
                    actor.syncTransform();
                    this.changed();
                    this.rebuild();
                }),
                button('✕', () => {
                    layer.removeActor(actor);
                    if (this.selected === actor)
                        this.selected = null;
                    this.changed();
                    this.rebuild();
                }, 'Retirer de la map'),
            ]);
            out.push(item);
        }
        return out;
    }

    // Puts the actor next to the target, on the same line, looking the same way.
    private placeBeside(actor: MiiActor, target: MiiActor, side: number): void {
        const t = target.state, yaw = t.yaw * Math.PI / 180;
        // The target's left, seen from the target, is +X turned by its yaw.
        const gap = Math.max(t.size, actor.state.size) * 0.8 * side;
        actor.state.position = [t.position[0] + Math.cos(yaw) * gap, t.position[1], t.position[2] - Math.sin(yaw) * gap];
        actor.state.yaw = t.yaw;
    }

    private placeFacing(actor: MiiActor, target: MiiActor): void {
        const t = target.state, yaw = t.yaw * Math.PI / 180;
        const dist = Math.max(t.size, actor.state.size) * 1.2;
        actor.state.position = [t.position[0] + Math.sin(yaw) * dist, t.position[1], t.position[2] + Math.cos(yaw) * dist];
        actor.state.yaw = t.yaw + 180;
    }

    private buildSelected(): HTMLElement[] {
        const actor = this.selected;
        if (actor === null || !this.layer!.actors.includes(actor))
            return [];
        const s = actor.state;
        const base = s.steps[0];
        const out: HTMLElement[] = [section(`Réglages de « ${s.name} »`)];

        const animOptions = actor.getAnimationNames()
            .sort((a, b) => animationSortKey(a) - animationSortKey(b))
            .map((a) => ({ value: a, label: animationDisplayName(a, s.bodyModel) }));
        const exprOptions = this.expressionOptions(actor);

        out.push(row('Animation', select(animOptions, base.animation, (v) => { base.animation = v; actor.applyStepAt(this.layer!.clock); this.changed(); })));
        out.push(row('Émotion', select(exprOptions, base.expression, (v) => this.pickExpression(actor, v, (e) => { base.expression = e; }))));
        out.push(...this.buildPendingFace(actor));
        out.push(...this.buildEmotionImport(actor));

        const reload = async () => {
            this.changed();
            try {
                await actor.load();
            } catch (e) {
                this.reportLoadError(e);
            }
            this.rebuild();
        };
        out.push(row('Corps', select([{ value: 'miitomo', label: 'Miitomo (16 poses)' }, { value: 'wiiu', label: 'Wii U (14 poses)' }], s.bodyModel, (v) => { s.bodyModel = v as BodyModel; reload(); })));
        if (!actor.isImported()) out.push(row('Sexe', select([{ value: '0', label: 'Garçon' }, { value: '1', label: 'Fille' }], String(s.gender), (v) => { s.gender = Number(v) as MiiGender; reload(); })));
        if (!actor.isImported()) out.push(row('Couleur', select(FAVORITE_COLOR_NAMES.map((n, i) => ({ value: String(i), label: n })), String(s.favoriteColor), (v) => { s.favoriteColor = Number(v); reload(); })));

        const sync = () => { actor.syncTransform(); this.changed(); };
        const pos = el('div', { className: 'MiiStudioInline' });
        for (let i = 0; i < 3; i++)
            pos.append(numberInput(s.position[i], s.size / 10, (v) => { s.position[i] = v; sync(); }));
        out.push(row('Position X Y Z', pos));
        const step = s.size / 10;
        out.push(row('Déplacer', el('div', { className: 'MiiStudioInline' }, [
            button('Devant la caméra', () => {
                const p = this.cameraPlacement(s.size);
                s.position = p.position;
                s.yaw = p.yaw;
                sync();
                this.rebuild();
            }),
            button('Poser au sol', () => {
                if (!this.layer!.dropToGround(actor))
                    this.setMessage('Pas de sol trouvé sous ce Mii. Il faut que le sol sous lui soit visible à l\'écran.');
                else
                    this.setMessage('');
                this.changed();
                this.rebuild();
            }, 'Fait tomber le Mii sur le décor en dessous'),
            button('▲', () => { s.position[1] += step; sync(); this.rebuild(); }, 'Monter'),
            button('▼', () => { s.position[1] -= step; sync(); this.rebuild(); }, 'Descendre'),
        ])));

        const normYaw = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
        const yaw = el('input', { type: 'range', min: '-180', max: '180', step: '1', value: String(Math.round(normYaw(s.yaw))) });
        const yawNum = numberInput(normYaw(s.yaw), 1, (v) => { s.yaw = normYaw(v); yaw.value = String(Math.round(s.yaw)); sync(); });
        yaw.oninput = () => { s.yaw = parseFloat(yaw.value); yawNum.value = yaw.value; sync(); };
        yaw.style.flex = '1';
        out.push(row('Rotation', el('div', { className: 'MiiStudioInline' }, [yaw, yawNum])));
        const turn = (f: (v: number) => number) => () => { s.yaw = normYaw(f(s.yaw)); sync(); this.rebuild(); };
        out.push(row('', el('div', { className: 'MiiStudioInline' }, [
            button('↺ 90°', turn((v) => v + 90)),
            button('↻ 90°', turn((v) => v - 90)),
            button('Demi-tour', turn((v) => v + 180)),
            button('Arrondir à 45°', turn((v) => Math.round(v / 45) * 45), 'Met la rotation pile sur 0, 45, 90°…'),
        ])));

        // Look at something: the Mii's front is +Z, turned by its yaw around the vertical axis.
        const faceTowards = (x: number, z: number) => {
            const dx = x - s.position[0], dz = z - s.position[2];
            if (Math.hypot(dx, dz) > 1e-6)
                s.yaw = normYaw(Math.atan2(dx, dz) * 180 / Math.PI);
            sync();
            this.rebuild();
        };
        const others = this.layer!.actors.filter((a) => a !== actor);
        const cam = this.viewer!.camera.worldMatrix;
        const lookButtons: HTMLElement[] = [
            button('La caméra', () => faceTowards(cam[12], cam[14])),
            button('Un point du décor…', () => {
                this.setMessage('Clique sur l\'endroit que le Mii doit regarder (une porte, un objet…).');
                this.viewer!.canvas.style.cursor = 'crosshair';
                this.layer!.pendingPick = (p) => {
                    if (p === null) {
                        this.setMessage('Pas de décor à cet endroit.');
                        return;
                    }
                    this.setMessage('');
                    faceTowards(p[0], p[2]);
                };
            }),
        ];
        out.push(row('Regarder vers', el('div', { className: 'MiiStudioInline' }, lookButtons)));

        if (others.length > 0) {
            if (this.alignTarget === null || !others.includes(this.alignTarget))
                this.alignTarget = others[0];
            const target = this.alignTarget;
            const targetSelect = select(others.map((a, i) => ({ value: String(i), label: a.state.name })), String(others.indexOf(target)), (v) => {
                this.alignTarget = others[Number(v)];
                this.rebuild();
            });
            out.push(row('Avec le Mii', targetSelect));
            const t = target.state;
            const align = (f: () => void) => () => { f(); sync(); this.rebuild(); };
            out.push(row('', el('div', { className: 'MiiStudioInline' }, [
                button('Regarder', () => faceTowards(t.position[0], t.position[2]), 'Tourne ce Mii vers l\'autre'),
                button('Face à face', () => {
                    faceTowards(t.position[0], t.position[2]);
                    t.yaw = normYaw(s.yaw + 180);
                    target.syncTransform();
                    this.changed();
                }, 'Les deux Mii se regardent'),
                button('Même rotation', align(() => { s.yaw = t.yaw; })),
            ])));
            out.push(row('Aligner', el('div', { className: 'MiiStudioInline' }, [
                button('Même X', align(() => { s.position = [t.position[0], s.position[1], s.position[2]]; })),
                button('Même Z', align(() => { s.position = [s.position[0], s.position[1], t.position[2]]; })),
                button('Même hauteur', align(() => { s.position = [s.position[0], t.position[1], s.position[2]]; })),
                button('Même taille', align(() => { s.size = t.size; })),
            ])));
            out.push(row('Côte à côte', el('div', { className: 'MiiStudioInline' }, [
                button('À sa gauche', align(() => this.placeBeside(actor, target, 1))),
                button('À sa droite', align(() => this.placeBeside(actor, target, -1))),
                button('En face', align(() => this.placeFacing(actor, target))),
            ])));
        }

        out.push(row('Taille', el('div', { className: 'MiiStudioInline' }, [
            numberInput(s.size, s.size / 10, (v) => { if (v > 0) { s.size = v; sync(); } }),
            button('÷10', () => { s.size /= 10; sync(); this.rebuild(); }),
            button('×10', () => { s.size *= 10; sync(); this.rebuild(); }),
        ])));

        out.push(section('Séquence'));
        out.push(el('div', { textContent: 'Changements d\'animation ou d\'émotion pendant le plan (en secondes depuis le début).' }));
        s.steps.forEach((st, i) => {
            if (i === 0)
                return;
            const t = numberInput(st.time, 0.1, (v) => { st.time = Math.max(0, v); s.steps.sort((a, b) => a.time - b.time); this.changed(); this.rebuild(); });
            out.push(el('div', { className: 'MiiStudioInline' }, [
                t,
                select(animOptions, st.animation, (v) => { st.animation = v; this.changed(); }),
                select(exprOptions, st.expression, (v) => this.pickExpression(actor, v, (e) => { st.expression = e; })),
                button('✕', () => { s.steps.splice(i, 1); this.changed(); this.rebuild(); }),
            ]));
        });
        out.push(el('div', { className: 'MiiStudioInline' }, [
            button('+ Changement à l\'instant actuel', () => {
                const cur = actor.getStepAt(this.layer!.clock);
                s.steps.push({ time: Math.round(this.layer!.clock * 10) / 10, animation: cur.animation, expression: cur.expression });
                s.steps.sort((a, b) => a.time - b.time);
                this.changed();
                this.rebuild();
            }),
        ]));
        return out;
    }

    private buildGlobal(): HTMLElement[] {
        const layer = this.layer!;
        const out: HTMLElement[] = [section('Lecture')];
        const playBtn = button(layer.playing ? 'Pause' : 'Lecture', () => { layer.playing = !layer.playing; this.rebuild(); });
        out.push(el('div', { className: 'MiiStudioInline' }, [
            button('⟲ Rejouer depuis 0', () => layer.resetClock()),
            playBtn,
            this.clockElem,
        ]));

        out.push(section('Vidéo'));
        const vs = this.settings.video;
        const saveVideo = () => {
            studioVideoSettings.width = vs.format === 'window' ? 0 : vs.format === 'portrait' ? 1080 : 1920;
            studioVideoSettings.height = vs.format === 'window' ? 0 : vs.format === 'portrait' ? 1920 : 1080;
            studioVideoSettings.framerate = vs.framerate;
            studioVideoSettings.supersample = vs.supersample;
            saveJSON(SETTINGS_KEY, this.settings);
            this.updateFrameGuide();
        };
        saveVideo();
        out.push(row('Format', select([
            { value: 'landscape', label: '1920×1080 (horizontal)' },
            { value: 'portrait', label: '1080×1920 (vertical, TikTok / Shorts)' },
            { value: 'window', label: 'Taille de la fenêtre' },
        ], vs.format, (v) => { vs.format = v as VideoFormat; saveVideo(); })));
        const frameToggle = el('input', { type: 'checkbox', checked: vs.showFrame });
        frameToggle.onchange = () => { vs.showFrame = frameToggle.checked; saveVideo(); };
        out.push(row('Cadre', el('label', { className: 'MiiStudioInline' }, [frameToggle, 'Montrer la zone filmée'])));
        out.push(row('Qualité', select([
            { value: '2', label: 'Maximale (rendu 2× plus grand, plus lent)' },
            { value: '1', label: 'Normale' },
        ], String(vs.supersample), (v) => { vs.supersample = Number(v); saveVideo(); })));
        out.push(row('Images/s', select([{ value: '30', label: '30' }, { value: '60', label: '60' }], String(vs.framerate), (v) => { vs.framerate = Number(v); saveVideo(); })));
        const lastStep = Math.max(0, ...layer.actors.flatMap((a) => a.state.steps.map((st) => st.time)));
        if (vs.duration <= 0)
            vs.duration = Math.ceil(lastStep + 3);
        out.push(row('Durée (s)', el('div', { className: 'MiiStudioInline' }, [
            numberInput(vs.duration, 1, (v) => { if (v > 0) { vs.duration = v; saveVideo(); } }),
            button('Jusqu\'à la fin de la séquence', () => { vs.duration = Math.ceil(lastStep + 2); saveVideo(); this.rebuild(); }),
        ])));
        if (this.recorder === null) {
            out.push(el('div', { className: 'MiiStudioInline' }, [button('🎬 Exporter la vidéo', () => this.exportVideo())]));
        } else {
            out.push(el('div', { className: 'MiiStudioInline' }, [this.videoProgressElem, button('Annuler', () => { if (this.recorder !== null) this.recorder.aborted = true; })]));
        }
        out.push(el('div', { className: 'MiiStudioHint', textContent: 'La vidéo est filmée depuis la vue actuelle (caméra fixe), Mii compris, en rejouant leur séquence depuis 0. Fichier .mp4 lisible dans Premiere, CapCut… Pour une caméra qui bouge, fais une animation dans le Studio : son bouton d\'enregistrement utilise aussi ce format.' }));

        out.push(section('Réglages'));
        out.push(row('Serveur visages', select([
            { value: DEFAULT_RENDERER_URL, label: 'Mi Creator (nxw.pw)' },
            { value: ALT_RENDERER_URL, label: 'ariankordi.net' },
        ], layer.rendererURL, (v) => {
            layer.rendererURL = v;
            this.settings.rendererURL = v;
            saveJSON(SETTINGS_KEY, this.settings);
            for (const a of layer.actors)
                a.invalidateHead();
        })));

        out.push(section('Lumière et ombre'));
        const ls = this.settings.lightSettings;
        const applyLight = () => {
            layer.setLight(ls);
            saveJSON(SETTINGS_KEY, this.settings);
        };
        const slider = (label: string, key: 'intensity' | 'azimuth' | 'elevation' | 'ambient' | 'shadowOpacity', min: number, max: number, stepV: number, fmt: (v: number) => string) => {
            const value = el('span', { textContent: fmt(ls[key]) });
            value.style.cssText = 'min-width: 48px; text-align: right;';
            const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(stepV), value: String(ls[key]) });
            input.style.flex = '1';
            input.oninput = () => {
                ls[key] = parseFloat(input.value);
                value.textContent = fmt(ls[key]);
                applyLight();
            };
            return row(label, el('div', { className: 'MiiStudioInline' }, [input, value]));
        };
        const deg = (v: number) => `${Math.round(v)}°`;
        const num = (v: number) => v.toFixed(1);
        out.push(slider('Force', 'intensity', 0, 5, 0.1, num));
        out.push(slider('Direction', 'azimuth', 0, 360, 1, deg));
        out.push(slider('Hauteur', 'elevation', 5, 90, 1, (v) => v >= 89.5 ? '90° (au-dessus)' : deg(v)));
        const color = el('input', { type: 'color', value: ls.color });
        color.oninput = () => { ls.color = color.value; applyLight(); };
        out.push(row('Couleur', color));
        out.push(slider('Ambiance', 'ambient', 0, 4, 0.1, num));
        const shadow = el('input', { type: 'checkbox', checked: ls.shadow });
        shadow.onchange = () => { ls.shadow = shadow.checked; applyLight(); };
        out.push(row('Ombre au sol', el('label', { className: 'MiiStudioInline' }, [shadow, 'Projeter l\'ombre'])));
        out.push(slider('Opacité', 'shadowOpacity', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`));
        out.push(el('div', { className: 'MiiStudioHint', textContent: 'Direction : tourne la lumière autour des Mii. Hauteur : 90° = soleil juste au-dessus. L\'ombre se dessine sur le décor lui-même (pentes, marches, murs). En WebGPU, elle reste sur un sol plat.' }));
        out.push(el('div', { className: 'MiiStudioInline' }, [
            button('Lumière par défaut', () => { Object.assign(ls, DEFAULT_LIGHT); applyLight(); this.rebuild(); }),
        ]));
        return out;
    }

    private videoProgressElem = el('span', { textContent: '' });
    private frameGuide: HTMLElement | null = null;

    // Shows on top of the view what the exported video will contain. The export keeps the
    // vertical field of view, so the frame is as tall as the view and cut on the sides.
    private updateFrameGuide(): void {
        const viewer = this.viewer;
        if (viewer === null)
            return;
        if (this.frameGuide === null) {
            this.frameGuide = el('div');
            this.frameGuide.style.cssText = 'position: absolute; pointer-events: none; box-sizing: border-box; border: 2px dashed rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);';
            const thirds = el('div');
            thirds.style.cssText = 'position: absolute; inset: 0; background-image: linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.25) calc(33.33% - 0.5px), rgba(255,255,255,0.25) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.25) calc(66.66% - 0.5px), rgba(255,255,255,0.25) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)), linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.25) calc(33.33% - 0.5px), rgba(255,255,255,0.25) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.25) calc(66.66% - 0.5px), rgba(255,255,255,0.25) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px));';
            this.frameGuide.append(thirds);
            window.addEventListener('resize', () => this.updateFrameGuide());
        }
        // Right above the Mii canvas, under the rest of the UI.
        const anchor = this.layer?.canvas ?? viewer.canvas;
        const parent = anchor.parentElement;
        if (parent !== null && this.frameGuide.previousElementSibling !== anchor)
            anchor.insertAdjacentElement('afterend', this.frameGuide);
        const vs = this.settings.video;
        const visible = vs.showFrame && vs.format !== 'window' && this.recorder === null;
        this.frameGuide.style.display = visible ? '' : 'none';
        if (!visible)
            return;
        const rect = viewer.canvas.getBoundingClientRect(), parentRect = parent!.getBoundingClientRect();
        const aspect = vs.format === 'portrait' ? 1080 / 1920 : 1920 / 1080;
        const h = rect.height, w = h * aspect;
        this.frameGuide.style.left = `${rect.left - parentRect.left + (rect.width - w) / 2}px`;
        this.frameGuide.style.top = `${rect.top - parentRect.top}px`;
        this.frameGuide.style.width = `${w}px`;
        this.frameGuide.style.height = `${h}px`;
    }

    private async exportVideo(): Promise<void> {
        if (this.viewer === null || this.recorder !== null)
            return;
        if (typeof VideoEncoder === 'undefined') {
            this.setMessage('Ton navigateur ne sait pas encoder de vidéo (essaie Chrome ou Edge).');
            return;
        }
        const viewer = this.viewer;
        const vs = this.settings.video;
        this.recorder = new VideoRecorder(viewer, null, {
            width: studioVideoSettings.width, height: studioVideoSettings.height, framerate: vs.framerate, supersample: vs.supersample,
            durationMs: vs.duration * 1000, filenamePrefix: 'Mii',
            onProgress: (f) => { this.videoProgressElem.textContent = `Enregistrement… ${Math.round(f * 100)} %`; },
        });
        this.videoProgressElem.textContent = 'Préparation…';
        this.setMessage('');
        this.rebuild();
        this.updateFrameGuide();
        viewer.externalControl = true;
        try {
            await this.recorder.render();
            this.setMessage(this.recorder.aborted ? 'Export annulé.' : 'Vidéo exportée : regarde dans tes téléchargements.');
        } catch (e) {
            this.setMessage(`L'export vidéo a échoué (${e}).`);
        } finally {
            viewer.externalControl = false;
            this.recorder = null;
            this.rebuild();
            this.updateFrameGuide();
        }
    }

    private rebuild(): void {
        if (this.layer === null)
            return;
        this.bodyElem.replaceChildren(
            ...this.buildLibrary(),
            ...this.buildActors(),
            ...this.buildSelected(),
            ...this.buildGlobal(),
        );
        this.syncSize();
    }
}
