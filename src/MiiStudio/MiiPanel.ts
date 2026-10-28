
import { Panel, COOL_BLUE_COLOR } from '../ui.js';
import type { Viewer } from '../viewer.js';
import { GlobalSaveManager } from '../SaveManager.js';
import { FAVORITE_COLOR_NAMES, MiiGender, parseMiiData } from './MiiData.js';
import { ALT_RENDERER_URL, animationDisplayName, BodyModel, DEFAULT_RENDERER_URL, EXPRESSIONS, MiiActor, MiiActorState, MiiLayer } from './MiiLayer.js';

const MII_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="20" fill="white"><circle cx="12" cy="7" r="5"/><path d="M4 23c0-5 3.6-8.5 8-8.5s8 3.5 8 8.5z"/></svg>`;

const LIBRARY_KEY = 'MiiStudio_Library';
const SETTINGS_KEY = 'MiiStudio_Settings';
const SCENE_KEY_PREFIX = 'MiiStudio_Scene_';

interface LibraryEntry {
    name: string;
    data: string;
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
    private settings = loadJSON(SETTINGS_KEY, { rendererURL: DEFAULT_RENDERER_URL, light: 1.6 });

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
        this.layer.setLightIntensity(this.settings.light);
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
        return { position: [px + fx * dist, py - size * 0.9, pz + fz * dist], yaw };
    }

    private async placeFromLibrary(entry: LibraryEntry): Promise<void> {
        if (this.layer === null || this.viewer === null)
            return;
        let info;
        try {
            info = parseMiiData(entry.data);
        } catch (e) {
            this.setMessage(`${e}`);
            return;
        }
        const size = this.selected?.state.size ?? 100;
        const { position, yaw } = this.cameraPlacement(size);
        const state: MiiActorState = {
            name: entry.name, data: info.rendererData,
            gender: info.gender, favoriteColor: info.favoriteColor,
            height: info.height, build: info.build,
            bodyModel: 'miitomo', position, yaw, size, visible: true,
            steps: [{ time: 0, animation: 'Wait', expression: 'normal' }],
        };
        this.setMessage('Chargement du Mii…');
        try {
            this.selected = await this.layer.addActor(state);
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
            this.setMessage(`« ${label} » ajouté (format ${info.format}, ${info.gender === MiiGender.Female ? 'fille' : 'garçon'}, ${FAVORITE_COLOR_NAMES[info.favoriteColor].toLowerCase()}).`);
        } catch (e) {
            this.setMessage(`${e} Colle les données copiées depuis Mi Creator (code hexadécimal ou base64), ou choisis un fichier .mii / .charinfo / .ffsd.`);
        }
        this.rebuild();
    }

    private buildLibrary(): HTMLElement[] {
        const out: HTMLElement[] = [section('Mes Mii')];

        const nameInput = el('input', { type: 'text', placeholder: 'Nom du Mii' });
        const dataInput = el('textarea', { placeholder: 'Colle ici les données du Mii (copiées depuis Mi Creator)' });
        const fileInput = el('input', { type: 'file', accept: '.miic,.mii,.charinfo,.ffsd,.cfsd,.bin,.rcd,.3dsmii,.txt' });
        fileInput.onchange = async () => {
            const f = fileInput.files?.[0];
            if (f === undefined)
                return;
            const buf = new Uint8Array(await f.arrayBuffer());
            const text = new TextDecoder().decode(buf).trim();
            const data = /^[0-9a-fA-F\s]+$/.test(text) ? text : Array.from(buf, (v) => v.toString(16).padStart(2, '0')).join('');
            this.addToLibrary(nameInput.value || f.name.replace(/\.[^.]+$/, ''), data);
        };
        out.push(nameInput, dataInput, el('div', { className: 'MiiStudioInline' }, [
            button('Ajouter', () => this.addToLibrary(nameInput.value, dataInput.value)),
            fileInput,
        ]));

        this.library.forEach((entry, i) => {
            out.push(el('div', { className: 'MiiStudioItem' }, [
                el('span', { textContent: entry.name, title: entry.data }),
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

    private buildSelected(): HTMLElement[] {
        const actor = this.selected;
        if (actor === null || !this.layer!.actors.includes(actor))
            return [];
        const s = actor.state;
        const base = s.steps[0];
        const out: HTMLElement[] = [section(`Réglages de « ${s.name} »`)];

        const animOptions = actor.getAnimationNames().map((a) => ({ value: a, label: animationDisplayName(a) }));
        const exprOptions = EXPRESSIONS.map((e) => ({ value: e.id, label: e.name }));

        out.push(row('Animation', select(animOptions, base.animation, (v) => { base.animation = v; actor.applyStepAt(this.layer!.clock); this.changed(); })));
        out.push(row('Émotion', select(exprOptions, base.expression, (v) => { base.expression = v; actor.applyStepAt(this.layer!.clock); this.changed(); })));

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
        out.push(row('Sexe', select([{ value: '0', label: 'Garçon' }, { value: '1', label: 'Fille' }], String(s.gender), (v) => { s.gender = Number(v) as MiiGender; reload(); })));
        out.push(row('Couleur', select(FAVORITE_COLOR_NAMES.map((n, i) => ({ value: String(i), label: n })), String(s.favoriteColor), (v) => { s.favoriteColor = Number(v); reload(); })));

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
            button('▲', () => { s.position[1] += step; sync(); this.rebuild(); }, 'Monter'),
            button('▼', () => { s.position[1] -= step; sync(); this.rebuild(); }, 'Descendre'),
        ])));

        const yaw = el('input', { type: 'range', min: '-180', max: '180', step: '1', value: String(Math.round(((s.yaw + 180) % 360 + 360) % 360 - 180)) });
        yaw.oninput = () => { s.yaw = parseFloat(yaw.value); sync(); };
        out.push(row('Rotation', yaw));

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
                select(exprOptions, st.expression, (v) => { st.expression = v; this.changed(); }),
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
        out.push(el('div', { textContent: 'L\'enregistrement vidéo du mode Studio inclut les Mii et rejoue leur séquence depuis 0.' }));

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
        const light = el('input', { type: 'range', min: '0', max: '4', step: '0.1', value: String(this.settings.light) });
        light.oninput = () => {
            this.settings.light = parseFloat(light.value);
            layer.setLightIntensity(this.settings.light);
            saveJSON(SETTINGS_KEY, this.settings);
        };
        out.push(row('Lumière', light));
        return out;
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
